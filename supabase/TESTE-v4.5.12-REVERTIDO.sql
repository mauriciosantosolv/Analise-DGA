-- =============================================================================
-- TESTE da v4.5.12 — roda tudo e DESFAZ tudo no fim (nada fica gravado).
-- Cole no Supabase › SQL Editor e clique em Run.
-- O resultado aparece como ERRO "RELATORIO (transacao desfeita)" — é proposital:
-- o erro no fim é o que desfaz a transação. Copie o texto do relatório e mande ao Claude.
-- Usa SOMENTE 3 usuários fictícios (teste-v4512-a/b/c@exemplo.invalid) e a organização
-- que o próprio sistema cria para eles. Nenhum usuário ou registro real é tocado.
-- =============================================================================
begin;
set local lock_timeout='8s';
set local statement_timeout='60s';
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

do $t$
declare
  rep text := '';
  a uuid := 'a4512000-0000-4000-8000-00000000000a';
  b uuid := 'a4512000-0000-4000-8000-00000000000b';
  c uuid := 'a4512000-0000-4000-8000-00000000000c';
  org uuid; perms jsonb; r jsonb;
  real_before bigint; real_users_before bigint;
begin
  select count(*) into real_before from public.app_records;
  select count(*) into real_users_before from auth.users;
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','teste-v4512-a@exemplo.invalid','{"full_name":"Teste A dono"}','{}',now(),now()),
         (b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','teste-v4512-b@exemplo.invalid','{"full_name":"Teste B membro"}','{}',now(),now()),
         (c,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','teste-v4512-c@exemplo.invalid','{"full_name":"Teste C admin"}','{}',now(),now());
  select m.organization_id, m.permissions into org, perms from public.organization_members m where m.user_id=a and m.role='owner';
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  insert into public.organization_members(organization_id,user_id,role,permissions) values (org,b,'editor',perms),(org,c,'admin',perms);
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  insert into public.app_records(user_id,store,record_id,data,organization_id) values
    (b,'clients','t4512-1','{"id":"t4512-1","name":"Cliente teste 1"}',org),
    (b,'clients','t4512-2','{"id":"t4512-2","name":"Cliente teste 2"}',org),
    (b,'clients','t4512-3','{"id":"t4512-3","name":"Cliente teste 3"}',org);
  rep := rep||'0 org teste com '||(select count(*) from public.organization_members where organization_id=org)||' membros e '||(select count(*) from public.app_records where organization_id=org)||' registros (de B)'||E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  rep := rep||'1 checagem do dono A: '||public.clique_obras_account_deletion_check_v4512()::text||E'\n';
  begin delete from auth.users where id=a; rep:=rep||'2 ERRO: apagou o unico dono'||E'\n';
  exception when others then rep:=rep||'2 excluir dono A -> RECUSADO: '||sqlerrm||E'\n'; end;
  delete from auth.users where id=b;
  rep := rep||'3 excluir membro B -> ok; registros de B na org: '||(select count(*) from public.app_records where organization_id=org and user_id=b)
     ||'; arquivo: '||(select jsonb_build_object('email',email,'nome',full_name,'registros',records_signed,'vinculos',jsonb_array_length(memberships),'por',deleted_by)::text from clique_obras_private.deleted_users_v4512 where user_id=b)
     ||'; vinculo restante: '||(select count(*) from public.organization_members where user_id=b)||E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  begin perform public.clique_obras_transfer_ownership_v4512(org, c); rep:=rep||'4 ERRO: admin transferiu'||E'\n';
  exception when others then rep:=rep||'4 admin C tenta transferir -> RECUSADO: '||sqlerrm||E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.clique_obras_transfer_ownership_v4512(org, a); rep:=rep||'5 ERRO: transferiu para si'||E'\n';
  exception when others then rep:=rep||'5 transferir para si -> RECUSADO: '||sqlerrm||E'\n'; end;
  r := public.clique_obras_transfer_ownership_v4512(org, c);
  execute 'reset role';
  rep := rep||'6 A transfere para C -> '||r::text||' | A='||(select role from public.organization_members where organization_id=org and user_id=a)
     ||' C='||(select role from public.organization_members where organization_id=org and user_id=c)
     ||' donos='||(select count(*) from public.organization_members where organization_id=org and role='owner')||' registros='||(select count(*) from public.app_records where organization_id=org)||E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  rep := rep||'7 checagem do ex-dono A: '||public.clique_obras_account_deletion_check_v4512()::text||E'\n';
  delete from auth.users where id=a;
  rep := rep||'8 excluir ex-dono A -> ok; registros na org: '||(select count(*) from public.app_records where organization_id=org)||'; C dono: '||(select count(*) from public.organization_members where organization_id=org and role='owner' and user_id=c)||E'\n';
  rep := rep||'9 dados reais: app_records '||(select count(*) from public.app_records where record_id not like 't4512-%')||' (antes '||real_before||'); usuarios reais '||(select count(*) from auth.users where email not like 'teste-v4512-%')||' (antes '||real_users_before||')';
  raise exception E'RELATORIO (transacao desfeita)\n%', rep;
end
$t$;
rollback;
