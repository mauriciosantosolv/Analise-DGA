-- =============================================================================
-- CliqueObras v4.5.12 — Transferência de propriedade e exclusão de conta SEM
-- perda de dado.  Idempotente: pode rodar mais de uma vez.
--
-- O PROBLEMA (medido em 03/10/2026, projeto mwelgpjkqljtkzbqxmag):
--   app_records.user_id -> auth.users ON DELETE CASCADE.  user_id é "quem gravou
--   por último" (a policy de UPDATE obriga user_id = auth.uid()).  Excluir um
--   usuário apagava em cascata TODO registro que ele tocou por último — a conta
--   designitumbiara "assina" 7.010 registros da DGA.  Outras 12 chaves
--   estrangeiras para auth.users/profiles ou apagavam (convites enviados), ou
--   bloqueavam a exclusão (anexos de RDO, lançamentos, Omie), ou apagavam o autor
--   (SET NULL).
--
-- O QUE MUDA:
--   1) Saem as 13 FKs que apontam para auth.users/profiles a partir de tabelas
--      de DADO.  As colunas e os valores ficam exatamente como estão: viram
--      registro histórico do autor (o UUID continua lá).  Nenhuma linha é
--      alterada por este script.
--      Ficam (de propósito): profiles -> auth.users e organization_members ->
--      profiles.  Sair da organização é o efeito desejado da exclusão.
--   2) Tabela clique_obras_private.deleted_users_v4512: nome, e-mail, vínculos e
--      quantos registros a pessoa assinava, gravados no momento da exclusão —
--      o UUID antigo continua identificável.
--   3) Gatilho NOVO em auth.users (BEFORE DELETE), que vale também para exclusão
--      pelo painel do Supabase:
--        - RECUSA a exclusão do ÚNICO proprietário de organização com outros
--          membros ("transfira a propriedade antes") — decisão do Mauricio;
--        - se a pessoa era o "ator" da sincronização automática do Omie
--          (omie_connections.created_by), passa para outro proprietário/admin
--          da mesma organização — senão a sincronização automática pararia;
--        - grava o arquivo do item 2.
--   4) RPC public.clique_obras_transfer_ownership_v4512(org, novo_dono):
--      só o proprietário chama; o membro escolhido vira proprietário e quem
--      chamou vira Administrador, na MESMA transação.  Não toca em nenhum dado
--      da organização (os registros são da organização, não do dono).
--   5) RPC public.clique_obras_account_deletion_check_v4512(): pré-checagem
--      usada pela tela e pela Edge Function delete-own-account.
--
-- A exclusão pela tela passa pela Edge Function NOVA delete-own-account
-- (senha conferida no servidor + "EXCLUIR" + auth.admin.deleteUser).
--
-- NÃO MUDA: protect_organization_owner, can_assign_member, as policies, os
-- CHECKs de papel, handle_new_user, nenhuma rotina do Omie.
-- =============================================================================

-- 1) FKs que apagavam, bloqueavam ou anulavam dado ----------------------------
alter table public.app_records              drop constraint if exists app_records_user_id_fkey;
alter table public.organization_invitations drop constraint if exists organization_invitations_invited_by_fkey;
alter table public.rdo_attachments          drop constraint if exists rdo_attachments_uploaded_by_fkey;
alter table public.rdo_cost_postings        drop constraint if exists rdo_cost_postings_posted_by_fkey;
alter table public.rdo_measurement_links    drop constraint if exists rdo_measurement_links_linked_by_fkey;
alter table public.omie_category_mappings   drop constraint if exists omie_category_mappings_updated_by_fkey;
alter table public.omie_connections         drop constraint if exists omie_connections_created_by_fkey;
alter table public.omie_project_mappings    drop constraint if exists omie_project_mappings_updated_by_fkey;
alter table public.omie_integration_audit   drop constraint if exists omie_integration_audit_actor_id_fkey;
alter table public.omie_sync_runs           drop constraint if exists omie_sync_runs_triggered_by_fkey;
alter table public.organizations            drop constraint if exists organizations_created_by_fkey;
alter table public.omie_remessa_projects    drop constraint if exists omie_remessa_projects_updated_by_fkey;
alter table public.omie_card_accounts       drop constraint if exists omie_card_accounts_updated_by_fkey;

-- 2) Arquivo de contas excluídas ------------------------------------------------
create table if not exists clique_obras_private.deleted_users_v4512 (
  user_id        uuid primary key,
  email          text not null default '',
  full_name      text not null default '',
  memberships    jsonb not null default '[]'::jsonb,
  records_signed integer not null default 0,
  deleted_at     timestamptz not null default now(),
  deleted_by     text not null default ''
);
revoke all on table clique_obras_private.deleted_users_v4512 from public, anon, authenticated;

-- Organizações em que o usuário é o ÚNICO proprietário e há outros membros.
create or replace function clique_obras_private.account_deletion_blockers_v4512(target_user uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id,
           'name', o.name,
           'members', (select count(*) from public.organization_members x where x.organization_id=o.id)
         ) order by o.name), '[]'::jsonb)
  from public.organization_members m
  join public.organizations o on o.id=m.organization_id
  where m.user_id=target_user
    and m.role='owner'
    and not exists (
      select 1 from public.organization_members x
      where x.organization_id=m.organization_id and x.role='owner' and x.user_id<>target_user)
    and exists (
      select 1 from public.organization_members x
      where x.organization_id=m.organization_id and x.user_id<>target_user);
$fn$;
revoke all on function clique_obras_private.account_deletion_blockers_v4512(uuid) from public, anon, authenticated;

-- 3) Gatilho de exclusão --------------------------------------------------------
create or replace function clique_obras_private.before_auth_user_delete_v4512()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $fn$
declare
  blockers jsonb := clique_obras_private.account_deletion_blockers_v4512(old.id);
  conn record;
  replacement uuid;
begin
  if jsonb_array_length(blockers) > 0 then
    raise exception 'Transfira a propriedade antes de excluir a conta (organização: %).',
      (select string_agg(b->>'name', ', ') from jsonb_array_elements(blockers) b)
      using errcode = 'P0001';
  end if;

  -- A sincronização automática do Omie grava em nome de omie_connections.created_by,
  -- que precisa ser membro.  Passa para outro proprietário/admin da organização.
  for conn in
    select distinct c.organization_id from public.omie_connections c where c.created_by=old.id
  loop
    replacement := null;
    select m.user_id into replacement
    from public.organization_members m
    where m.organization_id=conn.organization_id
      and m.user_id<>old.id
      and m.role in ('owner','admin')
    order by case m.role when 'owner' then 0 else 1 end, m.joined_at
    limit 1;
    if replacement is not null then
      update public.omie_connections
      set created_by=replacement
      where organization_id=conn.organization_id and created_by=old.id;
    end if;
  end loop;

  insert into clique_obras_private.deleted_users_v4512
    (user_id, email, full_name, memberships, records_signed, deleted_at, deleted_by)
  values (
    old.id,
    coalesce(old.email, ''),
    coalesce((select p.full_name from public.profiles p where p.id=old.id), old.raw_user_meta_data->>'full_name', ''),
    coalesce((select jsonb_agg(jsonb_build_object('organization_id', m.organization_id, 'role', m.role,
                                                  'joined_at', m.joined_at))
              from public.organization_members m where m.user_id=old.id), '[]'::jsonb),
    (select count(*) from public.app_records r where r.user_id=old.id),
    now(),
    session_user
  )
  on conflict (user_id) do update
  set email=excluded.email, full_name=excluded.full_name, memberships=excluded.memberships,
      records_signed=excluded.records_signed, deleted_at=excluded.deleted_at, deleted_by=excluded.deleted_by;

  return old;
end;
$fn$;
revoke all on function clique_obras_private.before_auth_user_delete_v4512() from public, anon, authenticated;

drop trigger if exists clique_obras_on_auth_user_deleting on auth.users;
create trigger clique_obras_on_auth_user_deleting
  before delete on auth.users
  for each row execute function clique_obras_private.before_auth_user_delete_v4512();

-- 4) Transferência de propriedade ----------------------------------------------
create or replace function public.clique_obras_transfer_ownership_v4512(
  target_organization_id uuid,
  target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $fn$
declare
  uid uuid := (select auth.uid());
  actor public.organization_members%rowtype;
  target public.organization_members%rowtype;
begin
  if uid is null then
    raise exception 'Sessão autenticada obrigatória.' using errcode = '42501';
  end if;
  select * into actor from public.organization_members
  where organization_id=target_organization_id and user_id=uid
  for update;
  if not found or actor.role <> 'owner' then
    raise exception 'Somente o proprietário pode transferir a propriedade.' using errcode = '42501';
  end if;
  if target_user_id is null or target_user_id = uid then
    raise exception 'Escolha outro membro da organização.' using errcode = '22023';
  end if;
  select * into target from public.organization_members
  where organization_id=target_organization_id and user_id=target_user_id
  for update;
  if not found then
    raise exception 'O novo proprietário precisa ser membro da organização.' using errcode = '22023';
  end if;
  if target.role = 'owner' then
    raise exception 'Este membro já é proprietário.' using errcode = '22023';
  end if;

  -- Ordem importa: primeiro o novo dono entra (o gatilho de proteção exige que
  -- sobre pelo menos um proprietário), depois quem chamou vira Administrador.
  -- As regras de protect_organization_owner continuam valendo nas duas linhas.
  update public.organization_members
  set role='owner', permissions=actor.permissions
  where organization_id=target_organization_id and user_id=target_user_id;

  update public.organization_members
  set role='admin'
  where organization_id=target_organization_id and user_id=uid;

  return jsonb_build_object(
    'organization_id', target_organization_id,
    'new_owner', target_user_id,
    'previous_owner', uid,
    'previous_owner_role', 'admin'
  );
end;
$fn$;
revoke all on function public.clique_obras_transfer_ownership_v4512(uuid, uuid) from public, anon;
grant execute on function public.clique_obras_transfer_ownership_v4512(uuid, uuid) to authenticated;

-- 5) Pré-checagem da exclusão da própria conta --------------------------------
create or replace function public.clique_obras_account_deletion_check_v4512()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $fn$
declare
  uid uuid := (select auth.uid());
  blockers jsonb;
begin
  if uid is null then
    raise exception 'Sessão autenticada obrigatória.' using errcode = '42501';
  end if;
  blockers := clique_obras_private.account_deletion_blockers_v4512(uid);
  return jsonb_build_object(
    'blocked', jsonb_array_length(blockers) > 0,
    'organizations', blockers,
    'records', (select count(*) from public.app_records r where r.user_id=uid),
    -- Organizações em que a pessoa é o ÚNICO membro: não bloqueia (não há a
    -- quem transferir), mas a tela avisa que os dados ficam sem acesso.
    'solo_organizations', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'name', o.name,
               'records', (select count(*) from public.app_records r where r.organization_id=o.id)
             ) order by o.name), '[]'::jsonb)
      from public.organization_members m
      join public.organizations o on o.id=m.organization_id
      where m.user_id=uid
        and not exists (select 1 from public.organization_members x
                        where x.organization_id=m.organization_id and x.user_id<>uid))
  );
end;
$fn$;
revoke all on function public.clique_obras_account_deletion_check_v4512() from public, anon;
grant execute on function public.clique_obras_account_deletion_check_v4512() to authenticated;
