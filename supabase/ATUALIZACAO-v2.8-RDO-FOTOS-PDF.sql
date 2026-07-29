-- CliqueObras v2.8
-- Evidências privadas dos RDOs: metadados, bucket, RLS e imutabilidade.
-- Execute depois das migrações da v2.7.

begin;

create table if not exists public.rdo_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rdo_id text not null check (length(trim(rdo_id)) between 1 and 180),
  project_id text not null check (length(trim(project_id)) between 1 and 180),
  object_path text not null unique check (length(trim(object_path)) between 1 and 700),
  file_name text not null check (length(trim(file_name)) between 1 and 180),
  mime_type text not null check (
    mime_type in ('image/jpeg','image/png','image/webp','application/pdf')
  ),
  size_bytes bigint not null check (size_bytes between 1 and 8388608),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploaded_at timestamptz not null default now()
);

create index if not exists rdo_attachments_org_rdo_idx
  on public.rdo_attachments(organization_id,rdo_id,uploaded_at);
create index if not exists rdo_attachments_project_idx
  on public.rdo_attachments(organization_id,project_id,uploaded_at);
create index if not exists rdo_attachments_uploaded_by_idx
  on public.rdo_attachments(uploaded_by);

alter table public.rdo_attachments enable row level security;
revoke all on table public.rdo_attachments from anon;
revoke all on table public.rdo_attachments from authenticated;
grant select,insert,delete on table public.rdo_attachments to authenticated;

create or replace function clique_obras_private.safe_uuid(input text)
returns uuid
language plpgsql
stable
set search_path = pg_catalog
as $$
begin
  return input::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function clique_obras_private.safe_uuid(text) from public,anon;
grant execute on function clique_obras_private.safe_uuid(text) to authenticated;

create or replace function clique_obras_private.rdo_is_attachment_editable(
  target_org uuid,
  target_project text,
  target_rdo text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select clique_obras_private.can_edit_store(target_org,'rdos')
    and clique_obras_private.can_access_rdo_project(target_org,target_project)
    and exists (
      select 1
      from public.app_records report
      where report.organization_id=target_org
        and report.store='rdos'
        and report.record_id=target_rdo
        and report.data->>'projectId'=target_project
        and coalesce(report.data->>'status','Rascunho') in ('Rascunho','Devolvido')
    );
$$;

revoke all on function clique_obras_private.rdo_is_attachment_editable(uuid,text,text)
  from public,anon;
grant execute on function clique_obras_private.rdo_is_attachment_editable(uuid,text,text)
  to authenticated;

create or replace function clique_obras_private.validate_rdo_attachment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_count integer;
begin
  if (select auth.uid()) is null or new.uploaded_by<>(select auth.uid()) then
    raise exception 'Usuário inválido para anexar a evidência.';
  end if;

  if not clique_obras_private.rdo_is_attachment_editable(
    new.organization_id,new.project_id,new.rdo_id
  ) then
    raise exception 'Este RDO não aceita novos anexos.';
  end if;

  if split_part(new.object_path,'/',1)<>new.organization_id::text
     or split_part(new.object_path,'/',2)<>new.project_id
     or split_part(new.object_path,'/',3)<>new.rdo_id then
    raise exception 'O caminho do anexo não corresponde ao RDO.';
  end if;

  select count(*) into current_count
  from public.rdo_attachments attachment
  where attachment.organization_id=new.organization_id
    and attachment.rdo_id=new.rdo_id;

  if current_count>=12 then
    raise exception 'O limite de 12 anexos por RDO foi atingido.';
  end if;

  return new;
end;
$$;

revoke all on function clique_obras_private.validate_rdo_attachment()
  from public,anon,authenticated;

drop trigger if exists cliqueobras_validate_rdo_attachment
  on public.rdo_attachments;
create trigger cliqueobras_validate_rdo_attachment
before insert on public.rdo_attachments
for each row execute function clique_obras_private.validate_rdo_attachment();

drop policy if exists "cliqueobras_rdo_attachments_select"
  on public.rdo_attachments;
create policy "cliqueobras_rdo_attachments_select"
on public.rdo_attachments for select to authenticated
using (
  clique_obras_private.can_view_store(organization_id,'rdos')
  and clique_obras_private.can_access_rdo_project(organization_id,project_id)
);

drop policy if exists "cliqueobras_rdo_attachments_insert"
  on public.rdo_attachments;
create policy "cliqueobras_rdo_attachments_insert"
on public.rdo_attachments for insert to authenticated
with check (
  uploaded_by=(select auth.uid())
  and clique_obras_private.rdo_is_attachment_editable(
    organization_id,project_id,rdo_id
  )
);

drop policy if exists "cliqueobras_rdo_attachments_delete"
  on public.rdo_attachments;
create policy "cliqueobras_rdo_attachments_delete"
on public.rdo_attachments for delete to authenticated
using (
  clique_obras_private.rdo_is_attachment_editable(
    organization_id,project_id,rdo_id
  )
  and (
    uploaded_by=(select auth.uid())
    or clique_obras_private.is_org_admin(organization_id)
  )
);

insert into storage.buckets (
  id,name,public,file_size_limit,allowed_mime_types
)
values (
  'rdo-evidencias',
  'rdo-evidencias',
  false,
  8388608,
  array['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "cliqueobras_rdo_files_select" on storage.objects;
create policy "cliqueobras_rdo_files_select"
on storage.objects for select to authenticated
using (
  bucket_id='rdo-evidencias'
  and clique_obras_private.can_view_store(
    clique_obras_private.safe_uuid((storage.foldername(name))[1]),
    'rdos'
  )
  and clique_obras_private.can_access_rdo_project(
    clique_obras_private.safe_uuid((storage.foldername(name))[1]),
    (storage.foldername(name))[2]
  )
);

drop policy if exists "cliqueobras_rdo_files_insert" on storage.objects;
create policy "cliqueobras_rdo_files_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='rdo-evidencias'
  and owner_id=(select auth.uid())::text
  and clique_obras_private.rdo_is_attachment_editable(
    clique_obras_private.safe_uuid((storage.foldername(name))[1]),
    (storage.foldername(name))[2],
    (storage.foldername(name))[3]
  )
);

drop policy if exists "cliqueobras_rdo_files_delete" on storage.objects;
create policy "cliqueobras_rdo_files_delete"
on storage.objects for delete to authenticated
using (
  bucket_id='rdo-evidencias'
  and clique_obras_private.rdo_is_attachment_editable(
    clique_obras_private.safe_uuid((storage.foldername(name))[1]),
    (storage.foldername(name))[2],
    (storage.foldername(name))[3]
  )
  and (
    owner_id=(select auth.uid())::text
    or clique_obras_private.is_org_admin(
      clique_obras_private.safe_uuid((storage.foldername(name))[1])
    )
  )
);

commit;
