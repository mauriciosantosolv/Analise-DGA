-- cliqueobras — organizações, equipe, permissões e dados compartilhados.
-- Compatível com a estrutura anterior: preserva todos os registros existentes.
-- Execute no SQL Editor do Supabase antes de publicar esta versão do frontend.

create extension if not exists pgcrypto;

create schema if not exists clique_obras_private;
revoke all on schema clique_obras_private from public;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists active_organization_id uuid
  references public.organizations(id) on delete set null;

alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles
  drop constraint if exists profiles_avatar_path_valid;
alter table public.profiles
  add constraint profiles_avatar_path_valid
  check (
    avatar_path is null
    or (
      length(avatar_path) between 40 and 80
      and avatar_path = id::text || '/avatar.jpg'
    )
  ) not valid;
alter table public.profiles
  validate constraint profiles_avatar_path_valid;

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','admin','editor','viewer')),
  permissions jsonb not null default '{"view":["projects"],"edit":[],"manage_users":false}'::jsonb
    check (jsonb_typeof(permissions) = 'object'),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role text not null default 'viewer' check (role in ('admin','editor','viewer')),
  permissions jsonb not null default '{"view":["projects"],"edit":[],"manage_users":false}'::jsonb
    check (jsonb_typeof(permissions) = 'object'),
  status text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  invited_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index if not exists organization_invitations_pending_email_uidx
on public.organization_invitations (organization_id, lower(email))
where status = 'pending';

create index if not exists organization_members_user_idx
on public.organization_members (user_id, organization_id);

create index if not exists organization_invitations_email_idx
on public.organization_invitations (lower(email), status);

create index if not exists organization_invitations_invited_by_idx
on public.organization_invitations (invited_by);

create index if not exists organizations_created_by_idx
on public.organizations (created_by);

create index if not exists profiles_active_organization_idx
on public.profiles (active_organization_id);

-- Estrutura financeira original. Em instalações já existentes, somente a coluna
-- organization_id é acrescentada; nenhuma linha é apagada.
create table if not exists public.app_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  store text not null check (store in (
    'projects','budgets','purchases','planning','clients',
    'categories','settings','measurements'
  )),
  record_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, store, record_id)
);

alter table public.app_records
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

-- Perfis dos usuários existentes.
insert into public.profiles (id, email, full_name, updated_at)
select id, coalesce(email,''), coalesce(raw_user_meta_data->>'full_name',''), now()
from auth.users
on conflict (id) do update
set email = excluded.email,
    full_name = case when excluded.full_name <> '' then excluded.full_name else public.profiles.full_name end,
    updated_at = now();

-- Cada conta antiga vira proprietária de uma organização. Isso mantém os dados
-- atuais visíveis e prepara o compartilhamento sem duplicar registros.
do $$
declare
  account record;
  new_org_id uuid;
  org_name text;
begin
  for account in
    select u.id, u.email, u.raw_user_meta_data
    from auth.users u
    where not exists (
      select 1 from public.organization_members m where m.user_id = u.id
    )
  loop
    org_name := coalesce(
      nullif(trim(account.raw_user_meta_data->>'full_name'),''),
      nullif(split_part(coalesce(account.email,''),'@',1),''),
      'Minha organização'
    );
    insert into public.organizations (name, created_by)
    values (org_name, account.id)
    returning id into new_org_id;

    insert into public.organization_members (organization_id, user_id, role, permissions)
    values (
      new_org_id,
      account.id,
      'owner',
      '{"view":["projects","budgets","purchases","planning","clients","categories","settings","measurements"],"edit":["projects","budgets","purchases","planning","clients","categories","settings","measurements"],"manage_users":true}'::jsonb
    );
  end loop;
end
$$;

update public.app_records r
set organization_id = (
  select m.organization_id
  from public.organization_members m
  where m.user_id = r.user_id
  order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.joined_at
  limit 1
)
where r.organization_id is null;

alter table public.app_records alter column organization_id set not null;

create unique index if not exists app_records_org_store_record_uidx
on public.app_records (organization_id, store, record_id);

-- A identidade do registro compartilhado pertence à organização. user_id
-- continua registrando quem realizou a última gravação.
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
      on public.app_records (organization_id,store,record_id);
    alter table public.app_records
      add constraint app_records_pkey
      primary key using index app_records_org_store_record_uidx;
  end if;
end
$$;

create index if not exists app_records_org_updated_idx
on public.app_records (organization_id, updated_at);

create index if not exists app_records_updated_idx
on public.app_records (user_id, updated_at);

-- Em contas com mais de uma organização, abre por padrão aquela que possui
-- mais dados. A escolha seguinte do usuário passa a ser salva no perfil.
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

-- Funções privadas usadas pelas políticas. SECURITY DEFINER evita recursão nas
-- políticas da tabela de membros; nenhuma função fica exposta no schema public.
create or replace function clique_obras_private.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = target_org
        and m.user_id = (select auth.uid())
    );
$$;

create or replace function clique_obras_private.is_org_owner(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = target_org
        and m.user_id = (select auth.uid())
        and m.role = 'owner'
    );
$$;

create or replace function clique_obras_private.is_org_admin(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = target_org
        and m.user_id = (select auth.uid())
        and m.role in ('owner','admin')
    );
$$;

create or replace function clique_obras_private.can_manage_users(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = target_org
        and m.user_id = (select auth.uid())
        and (
          m.role in ('owner','admin')
          or coalesce((m.permissions->>'manage_users')::boolean,false)
        )
    );
$$;

create or replace function clique_obras_private.current_user_email()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select lower(coalesce(u.email,''))
  from auth.users u
  where u.id=(select auth.uid());
$$;

create or replace function clique_obras_private.valid_permissions(input jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_typeof(input)='object'
    and jsonb_typeof(coalesce(input->'view','[]'::jsonb))='array'
    and jsonb_typeof(coalesce(input->'edit','[]'::jsonb))='array'
    and coalesce(input->'manage_users','false'::jsonb) in ('true'::jsonb,'false'::jsonb)
    and not exists (
      select 1 from jsonb_object_keys(input) as permission_key(value)
      where value not in ('view','edit','manage_users')
    )
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(input->'view','[]'::jsonb)) as view_store(value)
      where value not in (
        'projects','budgets','purchases','planning','clients',
        'categories','settings','measurements'
      )
    )
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(input->'edit','[]'::jsonb)) as edit_store(value)
      where value not in (
        'projects','budgets','purchases','planning','clients',
        'categories','settings','measurements'
      )
      or not (coalesce(input->'view','[]'::jsonb) ? value)
    );
$$;

create or replace function clique_obras_private.can_assign_member(
  target_org uuid,
  target_role text,
  target_permissions jsonb
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select clique_obras_private.valid_permissions(target_permissions)
    and exists (
      select 1
      from public.organization_members actor
      where actor.organization_id=target_org
        and actor.user_id=(select auth.uid())
        and (
          actor.role='owner'
          or (
            actor.role in ('admin','editor','viewer')
            and target_role in ('editor','viewer')
            and not coalesce((target_permissions->>'manage_users')::boolean,false)
            and (
              actor.role='admin'
              or coalesce((actor.permissions->>'manage_users')::boolean,false)
            )
          )
        )
    );
$$;

create or replace function clique_obras_private.can_view_store(target_org uuid, target_store text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = target_org
        and m.user_id = (select auth.uid())
        and (
          m.role in ('owner','admin')
          or coalesce(m.permissions->'view','[]'::jsonb) ? target_store
        )
    );
$$;

create or replace function clique_obras_private.can_edit_store(target_org uuid, target_store text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = target_org
        and m.user_id = (select auth.uid())
        and (
          m.role in ('owner','admin')
          or coalesce(m.permissions->'edit','[]'::jsonb) ? target_store
        )
    );
$$;

create or replace function clique_obras_private.can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and (
      target_user = (select auth.uid())
      or exists (
        select 1
        from public.organization_members mine
        join public.organization_members target
          on target.organization_id = mine.organization_id
        where mine.user_id = (select auth.uid())
          and target.user_id = target_user
          and (
            mine.role in ('owner','admin')
            or coalesce((mine.permissions->>'manage_users')::boolean,false)
          )
      )
    );
$$;

revoke all on all functions in schema clique_obras_private from public;
grant usage on schema clique_obras_private to authenticated;
grant execute on function clique_obras_private.is_org_member(uuid) to authenticated;
grant execute on function clique_obras_private.is_org_owner(uuid) to authenticated;
grant execute on function clique_obras_private.is_org_admin(uuid) to authenticated;
grant execute on function clique_obras_private.can_manage_users(uuid) to authenticated;
grant execute on function clique_obras_private.current_user_email() to authenticated;
grant execute on function clique_obras_private.valid_permissions(jsonb) to authenticated;
grant execute on function clique_obras_private.can_assign_member(uuid,text,jsonb) to authenticated;
grant execute on function clique_obras_private.can_view_store(uuid,text) to authenticated;
grant execute on function clique_obras_private.can_edit_store(uuid,text) to authenticated;
grant execute on function clique_obras_private.can_view_profile(uuid) to authenticated;

alter table public.organization_members
  drop constraint if exists organization_members_permissions_valid;
alter table public.organization_members
  add constraint organization_members_permissions_valid
  check (clique_obras_private.valid_permissions(permissions)) not valid;
alter table public.organization_members
  validate constraint organization_members_permissions_valid;

alter table public.organization_invitations
  drop constraint if exists organization_invitations_permissions_valid;
alter table public.organization_invitations
  add constraint organization_invitations_permissions_valid
  check (clique_obras_private.valid_permissions(permissions)) not valid;
alter table public.organization_invitations
  validate constraint organization_invitations_permissions_valid;

-- Cria o perfil e a organização de novos usuários. Quando houver convite
-- pendente, o usuário entra diretamente na organização convidada.
create or replace function clique_obras_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  pending record;
  personal_org_id uuid;
  accepted_count integer := 0;
  display_name text;
begin
  insert into public.profiles (id,email,full_name)
  values (
    new.id,
    coalesce(new.email,''),
    coalesce(new.raw_user_meta_data->>'full_name','')
  )
  on conflict (id) do update
  set email=excluded.email,
      full_name=excluded.full_name,
      updated_at=now();

  for pending in
    select i.*
    from public.organization_invitations i
    where i.status='pending'
      and lower(i.email)=lower(coalesce(new.email,''))
    order by i.created_at
  loop
    insert into public.organization_members (organization_id,user_id,role,permissions)
    values (pending.organization_id,new.id,pending.role,pending.permissions)
    on conflict (organization_id,user_id) do nothing;

    update public.organization_invitations
    set status='accepted', accepted_at=now()
    where id=pending.id;
    accepted_count := accepted_count + 1;
  end loop;

  if accepted_count = 0 then
    display_name := coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'),''),
      nullif(split_part(coalesce(new.email,''),'@',1),''),
      'Minha organização'
    );
    insert into public.organizations (name,created_by)
    values (display_name,new.id)
    returning id into personal_org_id;

    insert into public.organization_members (organization_id,user_id,role,permissions)
    values (
      personal_org_id,
      new.id,
      'owner',
      '{"view":["projects","budgets","purchases","planning","clients","categories","settings","measurements"],"edit":["projects","budgets","purchases","planning","clients","categories","settings","measurements"],"manage_users":true}'::jsonb
    );
  end if;
  return new;
end;
$$;

revoke all on function clique_obras_private.handle_new_user() from public, anon, authenticated;

drop trigger if exists clique_obras_on_auth_user_created on auth.users;
create trigger clique_obras_on_auth_user_created
after insert on auth.users
for each row execute function clique_obras_private.handle_new_user();

-- Mantém perfis sincronizados quando nome ou e-mail mudarem.
create or replace function clique_obras_private.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.profiles
  set email=coalesce(new.email,''),
      full_name=coalesce(new.raw_user_meta_data->>'full_name',public.profiles.full_name),
      updated_at=now()
  where id=new.id;
  return new;
end;
$$;

revoke all on function clique_obras_private.handle_user_updated() from public, anon, authenticated;

drop trigger if exists clique_obras_on_auth_user_updated on auth.users;
create trigger clique_obras_on_auth_user_updated
after update of email, raw_user_meta_data on auth.users
for each row execute function clique_obras_private.handle_user_updated();

create or replace function clique_obras_private.validate_active_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
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
from public, anon, authenticated;

drop trigger if exists cliqueobras_validate_active_organization on public.profiles;
create trigger cliqueobras_validate_active_organization
before insert or update of active_organization_id on public.profiles
for each row execute function clique_obras_private.validate_active_organization();

create or replace function clique_obras_private.sync_active_organization_membership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  replacement_org uuid;
begin
  if tg_op='INSERT' then
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
from public, anon, authenticated;

drop trigger if exists cliqueobras_sync_active_organization on public.organization_members;
create trigger cliqueobras_sync_active_organization
after insert or delete on public.organization_members
for each row execute function clique_obras_private.sync_active_organization_membership();

-- Preenche organization_id para compatibilidade com a versão anterior do
-- frontend, que enviava apenas user_id.
create or replace function clique_obras_private.set_app_record_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is null or new.user_id <> (select auth.uid()) then
    raise exception 'Usuário inválido para o registro.';
  end if;
  if new.organization_id is null then
    select m.organization_id into new.organization_id
    from public.organization_members m
    where m.user_id=(select auth.uid())
    order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.joined_at
    limit 1;
  end if;
  if new.organization_id is null then
    raise exception 'Nenhuma organização vinculada ao usuário.';
  end if;
  return new;
end;
$$;

revoke all on function clique_obras_private.set_app_record_organization() from public, anon, authenticated;

drop trigger if exists clique_obras_set_app_record_org on public.app_records;
create trigger clique_obras_set_app_record_org
before insert or update on public.app_records
for each row execute function clique_obras_private.set_app_record_organization();

-- Protege proprietários e impede que uma organização fique sem dono.
create or replace function clique_obras_private.protect_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_org uuid := coalesce(old.organization_id,new.organization_id);
  other_owners integer;
  actor_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sessão autenticada obrigatória.';
  end if;
  select m.role into actor_role
  from public.organization_members m
  where m.organization_id=target_org
    and m.user_id=(select auth.uid());

  if actor_role is null then
    raise exception 'Usuário não pertence à organização.';
  end if;
  if actor_role <> 'owner' and (
    old.role in ('owner','admin')
    or (tg_op='UPDATE' and new.role in ('owner','admin'))
  ) then
    raise exception 'Somente um proprietário pode alterar proprietários ou administradores.';
  end if;
  if actor_role not in ('owner','admin')
    and tg_op='UPDATE'
    and coalesce((new.permissions->>'manage_users')::boolean,false) then
    raise exception 'Um gestor delegado não pode conceder gestão de usuários.';
  end if;
  if old.role='owner' then
    if not clique_obras_private.is_org_owner(target_org) then
      raise exception 'Somente um proprietário pode alterar outro proprietário.';
    end if;
    if tg_op='DELETE' or new.role<>'owner' then
      select count(*) into other_owners
      from public.organization_members m
      where m.organization_id=target_org
        and m.role='owner'
        and m.user_id<>old.user_id;
      if other_owners=0 then
        raise exception 'A organização precisa manter pelo menos um proprietário.';
      end if;
    end if;
  elsif tg_op='UPDATE' and new.role='owner'
    and not clique_obras_private.is_org_owner(target_org) then
    raise exception 'Somente um proprietário pode promover outro proprietário.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

revoke all on function clique_obras_private.protect_organization_owner() from public, anon, authenticated;

drop trigger if exists clique_obras_protect_owner on public.organization_members;
create trigger clique_obras_protect_owner
before update or delete on public.organization_members
for each row execute function clique_obras_private.protect_organization_owner();

-- Um convidado pode apenas aceitar o próprio convite; não pode trocar seu
-- perfil ou permissões durante a aceitação.
create or replace function clique_obras_private.protect_invitation_acceptance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if lower(old.email)=clique_obras_private.current_user_email()
    and new.organization_id=old.organization_id
    and new.email=old.email
    and new.role=old.role
    and new.permissions=old.permissions
    and new.invited_by=old.invited_by
    and new.status='accepted' then
    return new;
  end if;
  if clique_obras_private.can_manage_users(old.organization_id)
    and clique_obras_private.can_assign_member(
      new.organization_id,new.role,new.permissions
    ) then
    return new;
  end if;
  raise exception 'O convite só pode ser aceito pelo destinatário ou alterado dentro da autoridade do gestor.';
end;
$$;

revoke all on function clique_obras_private.protect_invitation_acceptance() from public, anon, authenticated;

drop trigger if exists clique_obras_protect_invitation on public.organization_invitations;
create trigger clique_obras_protect_invitation
before update on public.organization_invitations
for each row execute function clique_obras_private.protect_invitation_acceptance();

create or replace function public.accept_organization_invitations()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_email text;
  pending record;
  accepted_count integer := 0;
begin
  if actor_id is null then
    raise exception 'Sessão autenticada obrigatória.';
  end if;

  actor_email := clique_obras_private.current_user_email();
  if coalesce(actor_email,'') = '' then
    raise exception 'A conta autenticada não possui e-mail válido.';
  end if;

  for pending in
    select invitation.*
    from public.organization_invitations invitation
    where invitation.status='pending'
      and lower(invitation.email)=actor_email
    order by invitation.created_at
    for update
  loop
    insert into public.organization_members (
      organization_id,user_id,role,permissions
    )
    values (
      pending.organization_id,actor_id,pending.role,pending.permissions
    )
    on conflict (organization_id,user_id) do nothing;

    update public.organization_invitations
    set status='accepted',
        accepted_at=coalesce(accepted_at,now())
    where id=pending.id;

    accepted_count := accepted_count + 1;
  end loop;

  return accepted_count;
end;
$$;

revoke all on function public.accept_organization_invitations() from public, anon;
grant execute on function public.accept_organization_invitations() to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.app_records enable row level security;

-- Tabelas ficam disponíveis na Data API, mas cada linha continua protegida pelo RLS.
revoke all on table public.profiles, public.organizations, public.organization_members,
  public.organization_invitations, public.app_records from anon;
grant select, update on table public.profiles to authenticated;
grant select, update on table public.organizations to authenticated;
grant select, insert, update, delete on table public.organization_members to authenticated;
grant select, insert, update, delete on table public.organization_invitations to authenticated;
grant select, insert, update, delete on table public.app_records to authenticated;

-- Nome e e-mail são sincronizados exclusivamente pelo Auth. Pela Data API,
-- cada conta pode alterar somente sua organização ativa.
revoke update on table public.profiles from authenticated;
grant update(active_organization_id,avatar_path) on table public.profiles to authenticated;

drop policy if exists "cliqueobras_profiles_select" on public.profiles;
create policy "cliqueobras_profiles_select"
on public.profiles for select to authenticated
using (clique_obras_private.can_view_profile(id));

drop policy if exists "cliqueobras_profiles_update" on public.profiles;
create policy "cliqueobras_profiles_update"
on public.profiles for update to authenticated
using ((select auth.uid())=id)
with check ((select auth.uid())=id);

drop policy if exists "cliqueobras_organizations_select" on public.organizations;
create policy "cliqueobras_organizations_select"
on public.organizations for select to authenticated
using (clique_obras_private.is_org_member(id));

drop policy if exists "cliqueobras_organizations_update" on public.organizations;
create policy "cliqueobras_organizations_update"
on public.organizations for update to authenticated
using (clique_obras_private.is_org_admin(id))
with check (clique_obras_private.is_org_admin(id));

drop policy if exists "cliqueobras_members_select" on public.organization_members;
create policy "cliqueobras_members_select"
on public.organization_members for select to authenticated
using (
  user_id=(select auth.uid())
  or clique_obras_private.can_manage_users(organization_id)
);

drop policy if exists "cliqueobras_members_insert" on public.organization_members;
create policy "cliqueobras_members_insert"
on public.organization_members for insert to authenticated
with check (
  (
    role<>'owner'
    and clique_obras_private.can_assign_member(
      organization_id,role,permissions
    )
  )
  or (
    user_id=(select auth.uid())
    and role in ('admin','editor','viewer')
    and exists (
      select 1 from public.organization_invitations i
      where i.organization_id=organization_members.organization_id
        and i.status='pending'
        and lower(i.email)=clique_obras_private.current_user_email()
        and i.role=organization_members.role
        and i.permissions=organization_members.permissions
    )
  )
);

drop policy if exists "cliqueobras_members_update" on public.organization_members;
create policy "cliqueobras_members_update"
on public.organization_members for update to authenticated
using (clique_obras_private.can_manage_users(organization_id))
with check (
  clique_obras_private.can_assign_member(
    organization_id,role,permissions
  )
);

drop policy if exists "cliqueobras_members_delete" on public.organization_members;
create policy "cliqueobras_members_delete"
on public.organization_members for delete to authenticated
using (clique_obras_private.can_manage_users(organization_id));

drop policy if exists "cliqueobras_invitations_select" on public.organization_invitations;
create policy "cliqueobras_invitations_select"
on public.organization_invitations for select to authenticated
using (
  clique_obras_private.can_manage_users(organization_id)
  or (
    lower(email)=clique_obras_private.current_user_email()
    and status in ('pending','accepted')
  )
);

drop policy if exists "cliqueobras_invitations_insert" on public.organization_invitations;
create policy "cliqueobras_invitations_insert"
on public.organization_invitations for insert to authenticated
with check (
  invited_by=(select auth.uid())
  and clique_obras_private.can_assign_member(
    organization_id,role,permissions
  )
);

drop policy if exists "cliqueobras_invitations_update" on public.organization_invitations;
create policy "cliqueobras_invitations_update"
on public.organization_invitations for update to authenticated
using (
  clique_obras_private.can_manage_users(organization_id)
  or (
    status='pending'
    and lower(email)=clique_obras_private.current_user_email()
  )
)
with check (
  (
    clique_obras_private.can_manage_users(organization_id)
    and clique_obras_private.can_assign_member(
      organization_id,role,permissions
    )
  )
  or (
    status='accepted'
    and lower(email)=clique_obras_private.current_user_email()
  )
);

drop policy if exists "cliqueobras_invitations_delete" on public.organization_invitations;
create policy "cliqueobras_invitations_delete"
on public.organization_invitations for delete to authenticated
using (
  clique_obras_private.can_manage_users(organization_id)
  and clique_obras_private.can_assign_member(
    organization_id,role,permissions
  )
);

drop policy if exists "Clique Obras: ler dados próprios" on public.app_records;
drop policy if exists "Clique Obras: inserir dados próprios" on public.app_records;
drop policy if exists "Clique Obras: atualizar dados próprios" on public.app_records;
drop policy if exists "Clique Obras: excluir dados próprios" on public.app_records;
drop policy if exists "cliqueobras_records_select" on public.app_records;
drop policy if exists "cliqueobras_records_insert" on public.app_records;
drop policy if exists "cliqueobras_records_update" on public.app_records;
drop policy if exists "cliqueobras_records_delete" on public.app_records;

create policy "cliqueobras_records_select"
on public.app_records for select to authenticated
using (clique_obras_private.can_view_store(organization_id,store));

create policy "cliqueobras_records_insert"
on public.app_records for insert to authenticated
with check (
  user_id=(select auth.uid())
  and clique_obras_private.can_edit_store(organization_id,store)
);

create policy "cliqueobras_records_update"
on public.app_records for update to authenticated
using (clique_obras_private.can_edit_store(organization_id,store))
with check (
  user_id=(select auth.uid())
  and clique_obras_private.can_edit_store(organization_id,store)
);

create policy "cliqueobras_records_delete"
on public.app_records for delete to authenticated
using (clique_obras_private.can_edit_store(organization_id,store));

-- Atualização automática dos timestamps.
create or replace function clique_obras_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists clique_obras_touch_organization on public.organizations;
create trigger clique_obras_touch_organization
before update on public.organizations
for each row execute function clique_obras_private.touch_updated_at();

drop trigger if exists clique_obras_touch_member on public.organization_members;
create trigger clique_obras_touch_member
before update on public.organization_members
for each row execute function clique_obras_private.touch_updated_at();

-- Publica somente as tabelas necessárias. Os eventos continuam protegidos
-- pelas mesmas políticas RLS usadas pela Data API.
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
