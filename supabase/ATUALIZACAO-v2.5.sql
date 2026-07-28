-- Clique Obras v2.5
-- Sincronização da organização ativa entre aparelhos e eventos em tempo real.
-- Migração idempotente: pode ser executada novamente sem duplicar dados.

begin;

alter table public.profiles
  add column if not exists active_organization_id uuid
  references public.organizations(id) on delete set null;

create index if not exists profiles_active_organization_idx
  on public.profiles(active_organization_id);

-- app_records passa a pertencer estruturalmente à organização. user_id
-- continua registrando quem realizou a última gravação, mas deixa de fazer
-- parte da identidade do dado compartilhado.
do $$
declare
  current_pk text;
begin
  select pg_get_constraintdef(oid)
    into current_pk
  from pg_constraint
  where conrelid='public.app_records'::regclass
    and contype='p';

  if coalesce(current_pk,'') <> 'PRIMARY KEY (organization_id, store, record_id)' then
    alter table public.app_records drop constraint if exists app_records_pkey;
    create unique index if not exists app_records_org_store_record_uidx
      on public.app_records(organization_id,store,record_id);
    alter table public.app_records
      add constraint app_records_pkey
      primary key using index app_records_org_store_record_uidx;
  end if;
end
$$;

-- Para contas já existentes, escolhe como organização inicial aquela que
-- possui mais dados. Isso corrige usuários que tinham uma organização pessoal
-- vazia e outra organização compartilhada com os dados reais.
with ranked_memberships as (
  select
    m.user_id,
    m.organization_id,
    row_number() over (
      partition by m.user_id
      order by
        (select count(*) from public.app_records r where r.organization_id=m.organization_id) desc,
        case m.role when 'owner' then 0 when 'admin' then 1 when 'editor' then 2 else 3 end,
        m.joined_at
    ) as position
  from public.organization_members m
)
update public.profiles p
set active_organization_id=ranked.organization_id,
    updated_at=now()
from ranked_memberships ranked
where ranked.user_id=p.id
  and ranked.position=1
  and (
    p.active_organization_id is null
    or not exists (
      select 1
      from public.organization_members current_membership
      where current_membership.user_id=p.id
        and current_membership.organization_id=p.active_organization_id
    )
  );

create or replace function clique_obras_private.validate_active_organization()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if new.active_organization_id is not null
    and not exists (
      select 1
      from public.organization_members m
      where m.user_id=new.id
        and m.organization_id=new.active_organization_id
    ) then
    raise exception 'A organização ativa precisa pertencer ao usuário.';
  end if;
  return new;
end;
$$;

revoke all on function clique_obras_private.validate_active_organization()
  from public,anon,authenticated;

drop trigger if exists cliqueobras_validate_active_organization on public.profiles;
create trigger cliqueobras_validate_active_organization
before insert or update of active_organization_id on public.profiles
for each row execute function clique_obras_private.validate_active_organization();

create or replace function clique_obras_private.sync_active_organization_membership()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  replacement_org uuid;
begin
  if tg_op='INSERT' then
    -- Um vínculo recém-aceito deve abrir a organização que concedeu o acesso,
    -- inclusive quando a conta já possuía uma organização pessoal vazia.
    update public.profiles
    set active_organization_id=new.organization_id,
        updated_at=now()
    where id=new.user_id;
    return new;
  end if;

  if tg_op='DELETE' then
    if exists (
      select 1 from public.profiles p
      where p.id=old.user_id
        and p.active_organization_id=old.organization_id
    ) then
      select m.organization_id
        into replacement_org
      from public.organization_members m
      where m.user_id=old.user_id
      order by
        (select count(*) from public.app_records r where r.organization_id=m.organization_id) desc,
        case m.role when 'owner' then 0 when 'admin' then 1 when 'editor' then 2 else 3 end,
        m.joined_at
      limit 1;

      update public.profiles
      set active_organization_id=replacement_org,
          updated_at=now()
      where id=old.user_id;
    end if;
    return old;
  end if;

  return coalesce(new,old);
end;
$$;

revoke all on function clique_obras_private.sync_active_organization_membership()
  from public,anon,authenticated;

drop trigger if exists cliqueobras_sync_active_organization on public.organization_members;
create trigger cliqueobras_sync_active_organization
after insert or delete on public.organization_members
for each row execute function clique_obras_private.sync_active_organization_membership();

-- Realtime respeita as políticas RLS existentes. Somente membros autorizados
-- recebem as alterações das organizações que podem visualizar.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='app_records'
  ) then
    alter publication supabase_realtime add table public.app_records;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='organization_members'
  ) then
    alter publication supabase_realtime add table public.organization_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='organizations'
  ) then
    alter publication supabase_realtime add table public.organizations;
  end if;
end
$$;

commit;
