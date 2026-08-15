-- CliqueObras v3.0.8
-- Sincronizacao Omie serializada, cache privado de fornecedores e auditoria
-- inviolavel dos RDOs, com descricao editavel para suas evidencias.

begin;

alter table public.omie_connections
  add column if not exists last_sync_attempt_at timestamptz,
  add column if not exists sync_lease_token uuid,
  add column if not exists sync_lease_expires_at timestamptz,
  add column if not exists supplier_backfill_completed_at timestamptz;

create index if not exists omie_connections_due_idx
  on public.omie_connections(auto_sync,active,last_sync_attempt_at,last_sync_at);

create table if not exists public.omie_supplier_cache (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  omie_supplier_code text not null
    check (length(trim(omie_supplier_code)) between 1 and 60),
  fantasy_name text not null
    check (length(trim(fantasy_name)) between 1 and 180),
  legal_name text check (
    legal_name is null or length(trim(legal_name)) between 1 and 180
  ),
  refreshed_at timestamptz not null default now(),
  primary key (organization_id,omie_supplier_code)
);

create index if not exists omie_supplier_cache_refreshed_idx
  on public.omie_supplier_cache(organization_id,refreshed_at);

alter table public.omie_supplier_cache enable row level security;
alter table public.omie_supplier_cache force row level security;

drop policy if exists omie_supplier_cache_private_deny
  on public.omie_supplier_cache;
create policy omie_supplier_cache_private_deny
on public.omie_supplier_cache for all to anon,authenticated
using (false) with check (false);

revoke all on public.omie_supplier_cache from public,anon,authenticated;
grant select,insert,update,delete on public.omie_supplier_cache to service_role;

create or replace function public.clique_obras_acquire_omie_sync_lease(
  target_organization_id uuid,
  target_lease_token uuid,
  lease_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  changed integer;
  safe_seconds integer:=greatest(60,least(coalesce(lease_seconds,600),600));
begin
  if (select auth.role())<>'service_role' then
    raise exception 'access denied';
  end if;
  if target_lease_token is null then
    raise exception 'invalid lease token';
  end if;

  update public.omie_connections connection
  set sync_lease_token=target_lease_token,
      sync_lease_expires_at=clock_timestamp()+make_interval(secs=>safe_seconds),
      last_sync_attempt_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where connection.organization_id=target_organization_id
    and connection.active=true
    and (
      connection.sync_lease_token is null
      or connection.sync_lease_expires_at is null
      or connection.sync_lease_expires_at<=clock_timestamp()
      or connection.sync_lease_token=target_lease_token
    );
  get diagnostics changed=row_count;
  if changed=1 then
    update public.omie_sync_runs run
    set status='error',finished_at=clock_timestamp(),
        error_message='Sincronizacao anterior interrompida; uma nova tentativa foi liberada.'
    where run.organization_id=target_organization_id
      and run.status='running'
      and run.started_at<clock_timestamp()-interval '1 minute';
  end if;
  return changed=1;
end;
$$;

create or replace function public.clique_obras_release_omie_sync_lease(
  target_organization_id uuid,
  target_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  changed integer;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'access denied';
  end if;
  update public.omie_connections connection
  set sync_lease_token=null,
      sync_lease_expires_at=null,
      updated_at=clock_timestamp()
  where connection.organization_id=target_organization_id
    and connection.sync_lease_token=target_lease_token;
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;

revoke all on function public.clique_obras_acquire_omie_sync_lease(uuid,uuid,integer)
  from public,anon,authenticated;
revoke all on function public.clique_obras_release_omie_sync_lease(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.clique_obras_acquire_omie_sync_lease(uuid,uuid,integer)
  to service_role;
grant execute on function public.clique_obras_release_omie_sync_lease(uuid,uuid)
  to service_role;

comment on function public.clique_obras_acquire_omie_sync_lease(uuid,uuid,integer)
is 'Reserva atomica e temporariamente a sincronizacao Omie de uma unica organizacao.';

alter table public.rdo_attachments
  add column if not exists description text;

alter table public.rdo_attachments
  drop constraint if exists rdo_attachments_description_check;
alter table public.rdo_attachments
  add constraint rdo_attachments_description_check
  check (
    description is null
    or length(trim(description)) between 1 and 180
  );

grant update(description) on public.rdo_attachments to authenticated;

create or replace function clique_obras_private.validate_rdo_attachment_update()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.rdo_id is distinct from old.rdo_id
    or new.project_id is distinct from old.project_id
    or new.object_path is distinct from old.object_path
    or new.file_name is distinct from old.file_name
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
    or new.uploaded_by is distinct from old.uploaded_by
    or new.uploaded_at is distinct from old.uploaded_at then
    raise exception 'Somente a descricao da evidencia pode ser alterada.';
  end if;

  if not clique_obras_private.rdo_is_attachment_editable(
    old.organization_id,old.project_id,old.rdo_id
  ) then
    raise exception 'Este RDO nao aceita alteracoes nos anexos.';
  end if;

  new.description=nullif(left(trim(coalesce(new.description,'')),180),'');
  return new;
end;
$$;

revoke all on function clique_obras_private.validate_rdo_attachment_update()
  from public,anon,authenticated;

drop trigger if exists cliqueobras_validate_rdo_attachment_update
  on public.rdo_attachments;
create trigger cliqueobras_validate_rdo_attachment_update
before update on public.rdo_attachments
for each row execute function clique_obras_private.validate_rdo_attachment_update();

drop policy if exists cliqueobras_rdo_attachments_update
  on public.rdo_attachments;
create policy cliqueobras_rdo_attachments_update
on public.rdo_attachments for update to authenticated
using (
  clique_obras_private.rdo_is_attachment_editable(
    organization_id,project_id,rdo_id
  )
)
with check (
  clique_obras_private.rdo_is_attachment_editable(
    organization_id,project_id,rdo_id
  )
);

create or replace function clique_obras_private.audit_rdo_changes()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  actor_id uuid:=(select auth.uid());
  actor_name text;
  action_name text;
  previous_trail jsonb:='[]'::jsonb;
  complete_trail jsonb;
  safe_trail jsonb;
  clean_old jsonb;
  clean_new jsonb;
begin
  if new.store<>'rdos' then
    return new;
  end if;
  if actor_id is null then
    raise exception 'Usuario invalido para auditar o RDO.';
  end if;

  select coalesce(nullif(trim(profile.full_name),''),nullif(trim(profile.email),''),actor_id::text)
    into actor_name
  from public.profiles profile
  where profile.id=actor_id;
  actor_name:=coalesce(actor_name,actor_id::text);

  if tg_op='INSERT' then
    action_name:='created';
  else
    previous_trail:=case
      when jsonb_typeof(old.data->'auditTrail')='array' then old.data->'auditTrail'
      else '[]'::jsonb
    end;
    clean_old:=old.data-'auditTrail';
    clean_new:=new.data-'auditTrail';
    if clean_new is not distinct from clean_old then
      new.data:=clean_new||jsonb_build_object('auditTrail',previous_trail);
      return new;
    end if;
    action_name:=case
      when new.data->>'status'='Aprovado' and old.data->>'status'<>'Aprovado'
        then 'approved'
      when new.data->>'status'='Devolvido' and old.data->>'status'<>'Devolvido'
        then 'rejected'
      when new.data->>'status'='Enviado' and old.data->>'status'<>'Enviado'
        then 'submitted'
      when new.data->>'status'='Rascunho' and old.data->>'status'='Enviado'
        then 'reopened'
      else 'edited'
    end;
  end if;

  complete_trail:=previous_trail||jsonb_build_array(jsonb_build_object(
    'action',action_name,
    'actorId',actor_id,
    'actorName',left(actor_name,180),
    'at',clock_timestamp()
  ));

  select coalesce(jsonb_agg(item.value order by item.ordinality),'[]'::jsonb)
    into safe_trail
  from jsonb_array_elements(complete_trail) with ordinality as item(value,ordinality)
  where item.ordinality>greatest(0,jsonb_array_length(complete_trail)-100);

  new.data:=(new.data-'auditTrail')||jsonb_build_object('auditTrail',safe_trail);
  return new;
end;
$$;

revoke all on function clique_obras_private.audit_rdo_changes()
  from public,anon,authenticated;

drop trigger if exists cliqueobras_audit_rdo_changes on public.app_records;
create trigger cliqueobras_audit_rdo_changes
before insert or update on public.app_records
for each row execute function clique_obras_private.audit_rdo_changes();

comment on function clique_obras_private.audit_rdo_changes()
is 'Cria no servidor o historico interno e imutavel de criacao, edicao e decisao dos RDOs.';

notify pgrst,'reload schema';

commit;
