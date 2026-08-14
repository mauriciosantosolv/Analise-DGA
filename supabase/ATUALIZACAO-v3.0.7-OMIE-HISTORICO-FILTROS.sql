-- CliqueObras v3.0.7
-- Integração Omie privada por organização, histórico do planejamento e automação.
-- Idempotente: pode ser executada novamente sem duplicar tabelas, funções ou cron.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.omie_connections (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  vault_secret_id uuid not null unique,
  app_key_hint text not null check (char_length(app_key_hint) between 3 and 24),
  initial_sync_date date not null,
  auto_sync boolean not null default false,
  auto_interval_minutes integer not null default 60 check (auto_interval_minutes in (15,60,360,1440)),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status is null or last_sync_status in ('success','error')),
  last_sync_error text check (last_sync_error is null or char_length(last_sync_error) <= 500)
);

create table if not exists public.omie_project_mappings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  omie_project_code text not null check (omie_project_code ~ '^[0-9]{1,30}$'),
  omie_project_name text not null check (char_length(omie_project_name) <= 180),
  clique_project_id text not null check (char_length(clique_project_id) between 1 and 180),
  enabled boolean not null default true,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, omie_project_code)
);

create table if not exists public.omie_category_mappings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  omie_category_code text not null check (omie_category_code ~ '^[0-9.]{1,40}$'),
  omie_category_name text not null check (char_length(omie_category_name) <= 180),
  clique_category_id text not null check (char_length(clique_category_id) between 1 and 180),
  clique_category_name text not null check (char_length(clique_category_name) between 1 and 180),
  enabled boolean not null default true,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, omie_category_code)
);

create table if not exists public.omie_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mode text not null check (mode in ('manual','automatic')),
  triggered_by uuid references auth.users(id) on delete set null,
  project_codes text[] not null default '{}',
  status text not null check (status in ('running','success','error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  imported_count integer not null default 0,
  updated_count integer not null default 0,
  cancelled_count integer not null default 0,
  skipped_count integer not null default 0,
  error_message text check (error_message is null or char_length(error_message) <= 500),
  details jsonb not null default '{}'::jsonb
);

create table if not exists public.omie_integration_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event text not null check (event in ('connected','configuration_updated','disconnected')),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists omie_sync_runs_org_started_idx on public.omie_sync_runs(organization_id,started_at desc);
create index if not exists omie_connections_auto_idx on public.omie_connections(auto_sync,active,last_sync_at);
create index if not exists omie_project_mappings_clique_idx on public.omie_project_mappings(organization_id,clique_project_id);
create index if not exists omie_category_mappings_clique_idx on public.omie_category_mappings(organization_id,clique_category_id);
create index if not exists omie_connections_created_by_idx on public.omie_connections(created_by);
create index if not exists omie_project_mappings_updated_by_idx on public.omie_project_mappings(updated_by);
create index if not exists omie_category_mappings_updated_by_idx on public.omie_category_mappings(updated_by);
create index if not exists omie_sync_runs_triggered_by_idx on public.omie_sync_runs(triggered_by);
create index if not exists omie_integration_audit_org_idx on public.omie_integration_audit(organization_id,occurred_at desc);
create index if not exists omie_integration_audit_actor_idx on public.omie_integration_audit(actor_id);

alter table public.omie_connections enable row level security;
alter table public.omie_project_mappings enable row level security;
alter table public.omie_category_mappings enable row level security;
alter table public.omie_sync_runs enable row level security;
alter table public.omie_integration_audit enable row level security;
alter table public.omie_connections force row level security;
alter table public.omie_project_mappings force row level security;
alter table public.omie_category_mappings force row level security;
alter table public.omie_sync_runs force row level security;
alter table public.omie_integration_audit force row level security;

drop policy if exists omie_connections_private_deny on public.omie_connections;
create policy omie_connections_private_deny on public.omie_connections for all to anon,authenticated using(false) with check(false);
drop policy if exists omie_project_mappings_private_deny on public.omie_project_mappings;
create policy omie_project_mappings_private_deny on public.omie_project_mappings for all to anon,authenticated using(false) with check(false);
drop policy if exists omie_category_mappings_private_deny on public.omie_category_mappings;
create policy omie_category_mappings_private_deny on public.omie_category_mappings for all to anon,authenticated using(false) with check(false);
drop policy if exists omie_sync_runs_private_deny on public.omie_sync_runs;
create policy omie_sync_runs_private_deny on public.omie_sync_runs for all to anon,authenticated using(false) with check(false);
drop policy if exists omie_integration_audit_private_deny on public.omie_integration_audit;
create policy omie_integration_audit_private_deny on public.omie_integration_audit for all to anon,authenticated using(false) with check(false);

revoke all on public.omie_connections, public.omie_project_mappings, public.omie_category_mappings,
  public.omie_sync_runs, public.omie_integration_audit from public, anon, authenticated;
grant select,insert,update,delete on public.omie_connections, public.omie_project_mappings,
  public.omie_category_mappings, public.omie_sync_runs, public.omie_integration_audit to service_role;

-- O histórico herda a permissão do Planejamento sem alterar membros ou convites.
create or replace function clique_obras_private.can_view_store(target_org uuid,target_store text)
returns boolean language sql stable security definer set search_path='pg_catalog','public'
as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.organization_members member
    where member.organization_id=target_org and member.user_id=(select auth.uid())
      and (member.role in ('owner','admin') or coalesce(member.permissions->'view','[]'::jsonb) ?
        case when target_store='planning_history' then 'planning' else target_store end)
  )
$$;

create or replace function clique_obras_private.can_edit_store(target_org uuid,target_store text)
returns boolean language sql stable security definer set search_path='pg_catalog','public'
as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.organization_members member
    where member.organization_id=target_org and member.user_id=(select auth.uid())
      and (member.role in ('owner','admin') or coalesce(member.permissions->'edit','[]'::jsonb) ?
        case when target_store='planning_history' then 'planning' else target_store end)
  )
$$;

create or replace function public.clique_obras_store_omie_connection(
  target_organization_id uuid,
  target_actor_id uuid,
  credentials text,
  target_app_key_hint text,
  target_initial_sync_date date
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare secret_id uuid;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'access denied'; end if;
  if not exists(select 1 from public.organization_members where organization_id=target_organization_id and user_id=target_actor_id and role='owner') then raise exception 'owner required'; end if;
  if credentials is null or char_length(credentials) not between 10 and 1000 then raise exception 'invalid credentials'; end if;
  select vault_secret_id into secret_id from public.omie_connections where organization_id=target_organization_id for update;
  if secret_id is null then
    select vault.create_secret(credentials,'clique_obras_omie_'||target_organization_id::text,'Credenciais privadas do Omie para uma única organização',null) into secret_id;
    insert into public.omie_connections(organization_id,vault_secret_id,app_key_hint,initial_sync_date,created_by)
    values(target_organization_id,secret_id,left(target_app_key_hint,24),target_initial_sync_date,target_actor_id);
  else
    perform vault.update_secret(secret_id,credentials,'clique_obras_omie_'||target_organization_id::text,'Credenciais privadas do Omie para uma única organização',null);
    update public.omie_connections set app_key_hint=left(target_app_key_hint,24),initial_sync_date=target_initial_sync_date,
      active=true,created_by=target_actor_id,connected_at=now(),updated_at=now(),last_sync_error=null
    where organization_id=target_organization_id;
  end if;
  insert into public.omie_integration_audit(organization_id,actor_id,event) values(target_organization_id,target_actor_id,'connected');
  return jsonb_build_object('connected',true);
end $$;

create or replace function public.clique_obras_omie_credentials(target_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare result jsonb;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'access denied'; end if;
  select decrypted_secret::jsonb into result
  from vault.decrypted_secrets secret
  join public.omie_connections connection on connection.vault_secret_id=secret.id
  where connection.organization_id=target_organization_id and connection.active=true;
  return result;
end $$;

create or replace function public.clique_obras_save_omie_config(
  target_organization_id uuid,
  target_actor_id uuid,
  project_mappings jsonb,
  category_mappings jsonb,
  automatic_sync boolean,
  interval_minutes integer
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare item jsonb; actual_category_name text; project_count integer:=0; category_count integer:=0;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'access denied'; end if;
  if not exists(select 1 from public.organization_members where organization_id=target_organization_id and user_id=target_actor_id and role='owner') then raise exception 'owner required'; end if;
  if jsonb_typeof(project_mappings)<>'array' or jsonb_array_length(project_mappings)>1000 then raise exception 'invalid project mappings'; end if;
  if jsonb_typeof(category_mappings)<>'array' or jsonb_array_length(category_mappings)>1000 then raise exception 'invalid category mappings'; end if;
  if interval_minutes not in (15,60,360,1440) then raise exception 'invalid interval'; end if;
  if not exists(select 1 from public.omie_connections where organization_id=target_organization_id and active=true) then raise exception 'connection required'; end if;
  delete from public.omie_project_mappings where organization_id=target_organization_id;
  for item in select value from jsonb_array_elements(project_mappings) loop
    if coalesce(item->>'omieProjectCode','') !~ '^[0-9]{1,30}$' then raise exception 'invalid Omie project'; end if;
    if not exists(select 1 from public.app_records where organization_id=target_organization_id and store='projects' and record_id=item->>'cliqueProjectId') then raise exception 'CliqueObras project not found'; end if;
    insert into public.omie_project_mappings(organization_id,omie_project_code,omie_project_name,clique_project_id,enabled,updated_by)
    values(target_organization_id,item->>'omieProjectCode',left(coalesce(item->>'omieProjectName','Projeto Omie'),180),item->>'cliqueProjectId',coalesce((item->>'enabled')::boolean,false),target_actor_id);
    project_count:=project_count+1;
  end loop;
  delete from public.omie_category_mappings where organization_id=target_organization_id;
  for item in select value from jsonb_array_elements(category_mappings) loop
    if coalesce(item->>'omieCategoryCode','') !~ '^[0-9.]{1,40}$' then raise exception 'invalid Omie category'; end if;
    select data->>'name' into actual_category_name from public.app_records where organization_id=target_organization_id and store='categories' and record_id=item->>'cliqueCategoryId';
    if actual_category_name is null then raise exception 'CliqueObras category not found'; end if;
    insert into public.omie_category_mappings(organization_id,omie_category_code,omie_category_name,clique_category_id,clique_category_name,enabled,updated_by)
    values(target_organization_id,item->>'omieCategoryCode',left(coalesce(item->>'omieCategoryName','Categoria Omie'),180),item->>'cliqueCategoryId',left(actual_category_name,180),coalesce((item->>'enabled')::boolean,false),target_actor_id);
    category_count:=category_count+1;
  end loop;
  update public.omie_connections set auto_sync=automatic_sync,auto_interval_minutes=interval_minutes,updated_at=now() where organization_id=target_organization_id;
  insert into public.omie_integration_audit(organization_id,actor_id,event,metadata)
  values(target_organization_id,target_actor_id,'configuration_updated',jsonb_build_object('projects',project_count,'categories',category_count,'auto_sync',automatic_sync,'interval',interval_minutes));
  return jsonb_build_object('saved',true,'projects',project_count,'categories',category_count);
end $$;

create or replace function public.clique_obras_disconnect_omie(target_organization_id uuid,target_actor_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare secret_id uuid;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'access denied'; end if;
  if not exists(select 1 from public.organization_members where organization_id=target_organization_id and user_id=target_actor_id and role='owner') then raise exception 'owner required'; end if;
  select vault_secret_id into secret_id from public.omie_connections where organization_id=target_organization_id for update;
  delete from public.omie_project_mappings where organization_id=target_organization_id;
  delete from public.omie_category_mappings where organization_id=target_organization_id;
  delete from public.omie_connections where organization_id=target_organization_id;
  if secret_id is not null then delete from vault.secrets where id=secret_id; end if;
  insert into public.omie_integration_audit(organization_id,actor_id,event) values(target_organization_id,target_actor_id,'disconnected');
  return true;
end $$;

create or replace function public.clique_obras_validate_omie_cron(provided_token text)
returns boolean language sql stable security definer set search_path=''
as $$
  select (select auth.role())='service_role'
    and char_length(coalesce(provided_token,'')) between 32 and 256
    and exists(
      select 1 from vault.decrypted_secrets
      where name='clique_obras_omie_cron_token'
        and extensions.digest(convert_to(decrypted_secret,'UTF8'),'sha256')=extensions.digest(convert_to(provided_token,'UTF8'),'sha256')
    )
$$;

create or replace function public.clique_obras_apply_omie_entries(
  target_organization_id uuid,
  target_actor_id uuid,
  entries jsonb,
  target_sync_run_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  item jsonb; old_data jsonb; purchase_data jsonb; plan_data jsonb; offset_item jsonb;
  plan_row record; history_id text; purchase_id text; item_id text; project_id text; category_name text;
  value_amount numeric; remaining numeric; plan_value numeric; consumed numeric; before_value numeric; after_value numeric;
  realized numeric; original numeric; offsets jsonb; active_item boolean; same_identity boolean;
  imported integer:=0; updated integer:=0; cancelled integer:=0; unchanged integer:=0; actor uuid;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'access denied'; end if;
  if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>500 then raise exception 'invalid entries'; end if;
  if not exists(select 1 from public.omie_connections where organization_id=target_organization_id and active=true) then raise exception 'connection required'; end if;
  select case when exists(select 1 from auth.users where id=target_actor_id) then target_actor_id else created_by end into actor
  from public.omie_connections where organization_id=target_organization_id;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':omie',0));

  for item in select value from jsonb_array_elements(entries) loop
    item_id:=left(coalesce(item->>'externalItemId',''),180);
    project_id:=left(coalesce(item->>'projectId',''),180);
    category_name:=left(coalesce(item->>'category',''),180);
    if item_id='' or project_id='' or category_name='' or coalesce(item->>'externalSource','')<>'omie' then raise exception 'invalid entry identity'; end if;
    if not exists(select 1 from public.app_records where organization_id=target_organization_id and store='projects' and record_id=project_id) then raise exception 'project not found'; end if;
    if not exists(select 1 from public.app_records where organization_id=target_organization_id and store='categories' and data->>'name'=category_name) then raise exception 'category not found'; end if;
    value_amount:=round(abs(coalesce((item->>'value')::numeric,0)),2);
    if value_amount>1000000000000 then raise exception 'value above limit'; end if;
    active_item:=coalesce((item->>'active')::boolean,true) and value_amount>0;
    purchase_id:='omie-ap-'||encode(extensions.digest(convert_to(item_id,'UTF8'),'sha256'),'hex');
    select data into old_data from public.app_records where organization_id=target_organization_id and store='purchases' and record_id=purchase_id for update;
    if old_data is not null and coalesce(old_data->>'externalItemId','')<>item_id then raise exception 'external id collision'; end if;
    same_identity:=old_data is not null and old_data->>'projectId'=project_id and old_data->>'category'=category_name and round(coalesce((old_data->>'value')::numeric,0),2)=value_amount;

    -- Se o valor/projeto/categoria mudou ou foi cancelado, restaura antes os abatimentos anteriores.
    if old_data is not null and (not same_identity or not active_item) then
      for offset_item in select value from jsonb_array_elements(coalesce(old_data->'planningOffsets','[]'::jsonb)) loop
        select data into plan_data from public.app_records where organization_id=target_organization_id and store='planning' and record_id=offset_item->>'planningId' for update;
        if plan_data is null then continue; end if;
        before_value:=coalesce((plan_data->>'value')::numeric,0);
        consumed:=round(coalesce((offset_item->>'amount')::numeric,0),2);
        after_value:=round(before_value+consumed,2);
        realized:=greatest(0,round(coalesce((plan_data->>'realizedAmount')::numeric,0)-consumed,2));
        update public.app_records set data=plan_data||jsonb_build_object('value',after_value,'realizedAmount',realized,'consumptionStatus',case when realized>0 then 'partial' else 'pending' end,'lastOffsetAt',now()),user_id=actor,updated_at=now()
        where organization_id=target_organization_id and store='planning' and record_id=offset_item->>'planningId';
        history_id:=gen_random_uuid()::text;
        insert into public.app_records(organization_id,user_id,store,record_id,data)
        values(target_organization_id,actor,'planning_history',history_id,jsonb_build_object('id',history_id,'planningId',offset_item->>'planningId','projectId',plan_data->>'projectId','category',plan_data->>'category','action','omie_restored','source','omie','sourceId',item_id,'amount',consumed,'beforeValue',before_value,'afterValue',after_value,'description','Planejamento restaurado por alteração ou cancelamento no Omie','occurredAt',now()));
      end loop;
    end if;

    if not active_item then
      if old_data is not null then
        delete from public.app_records where organization_id=target_organization_id and store='purchases' and record_id=purchase_id;
        cancelled:=cancelled+1;
      else unchanged:=unchanged+1; end if;
      continue;
    end if;

    if same_identity then
      purchase_data=(old_data - 'date' - 'supplier' - 'order' - 'desc' - 'notes' - 'omieStatus' - 'syncedAt' - 'syncRunId') ||
        jsonb_build_object('date',item->>'date','supplier',left(coalesce(item->>'supplier',''),180),'order',left(coalesce(item->>'order',''),100),'desc',left(coalesce(item->>'description','Conta a pagar Omie'),500),'notes','Status Omie: '||left(coalesce(item->>'status',''),40),'omieStatus',left(coalesce(item->>'status',''),40),'syncedAt',now(),'syncRunId',target_sync_run_id);
      update public.app_records set data=purchase_data,user_id=actor,updated_at=now() where organization_id=target_organization_id and store='purchases' and record_id=purchase_id;
      unchanged:=unchanged+1;
      continue;
    end if;

    remaining:=value_amount; offsets:='[]'::jsonb;
    for plan_row in
      select record_id,data from public.app_records
      where organization_id=target_organization_id and store='planning' and data->>'projectId'=project_id and data->>'category'=category_name
        and case when coalesce(data->>'value','') ~ '^-?[0-9]+([.][0-9]+)?$' then (data->>'value')::numeric else 0 end > 0
      order by coalesce(data->>'date','9999-12-31'),record_id for update
    loop
      exit when remaining<=0;
      plan_data:=plan_row.data; plan_value:=round(coalesce((plan_data->>'value')::numeric,0),2);
      consumed:=least(remaining,plan_value); before_value:=plan_value; after_value:=round(plan_value-consumed,2);
      realized:=round(coalesce((plan_data->>'realizedAmount')::numeric,0)+consumed,2);
      original:=case
        when coalesce(plan_data->>'originalValue','') ~ '^-?[0-9]+([.][0-9]+)?$'
          then greatest(0,(plan_data->>'originalValue')::numeric)
        else plan_value+coalesce((plan_data->>'realizedAmount')::numeric,0)
      end;
      update public.app_records set data=plan_data||jsonb_build_object('value',after_value,'originalValue',original,'realizedAmount',realized,'consumptionStatus',case when after_value<=0 then 'consumed' else 'partial' end,'lastOffsetAt',now()),user_id=actor,updated_at=now()
      where organization_id=target_organization_id and store='planning' and record_id=plan_row.record_id;
      offsets:=offsets||jsonb_build_array(jsonb_build_object('planningId',plan_row.record_id,'amount',consumed));
      history_id:=gen_random_uuid()::text;
      insert into public.app_records(organization_id,user_id,store,record_id,data)
      values(target_organization_id,actor,'planning_history',history_id,jsonb_build_object('id',history_id,'planningId',plan_row.record_id,'projectId',project_id,'category',category_name,'action','omie_consumed','source','omie','sourceId',item_id,'amount',consumed,'beforeValue',before_value,'afterValue',after_value,'description','Conta a pagar do Omie abatida do planejamento','occurredAt',now()));
      remaining:=round(remaining-consumed,2);
    end loop;

    purchase_data=jsonb_build_object('id',purchase_id,'projectId',project_id,'category',category_name,'supplier',left(coalesce(item->>'supplier',''),180),'order',left(coalesce(item->>'order',''),100),'value',value_amount,'date',item->>'date','desc',left(coalesce(item->>'description','Conta a pagar Omie'),500),'notes','Status Omie: '||left(coalesce(item->>'status',''),40),'costCenter',category_name,'sourceType','omiePayable','externalSource','omie','externalId',left(coalesce(item->>'externalId',''),100),'externalItemId',item_id,'omieProjectCode',left(coalesce(item->>'omieProjectCode',''),60),'omieCategoryCode',left(coalesce(item->>'omieCategoryCode',''),40),'omieStatus',left(coalesce(item->>'status',''),40),'readOnly',true,'planningOffsets',offsets,'planningOffsetAmount',round(value_amount-remaining,2),'planningUnmatchedAmount',remaining,'importedAt',floor(extract(epoch from now())*1000)::bigint,'file','(Sincronização Omie)','syncedAt',now(),'syncRunId',target_sync_run_id);
    insert into public.app_records(organization_id,user_id,store,record_id,data,updated_at)
    values(target_organization_id,actor,'purchases',purchase_id,purchase_data,now())
    on conflict(organization_id,store,record_id) do update set data=excluded.data,user_id=excluded.user_id,updated_at=excluded.updated_at;
    if old_data is null then imported:=imported+1; else updated:=updated+1; end if;
  end loop;
  return jsonb_build_object('imported',imported,'updated',updated,'cancelled',cancelled,'unchanged',unchanged);
end $$;

-- Remove rateios antigos da mesma conta a pagar antes de aplicar o catálogo
-- atual. Cada chamada recebe grupos completos por externalId.
create or replace function public.clique_obras_reconcile_omie_entries(
  target_organization_id uuid,
  target_actor_id uuid,
  entries jsonb,
  target_sync_run_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare stale record; result jsonb; cancelled integer:=0;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'access denied'; end if;
  if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>500 then raise exception 'invalid entries'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':omie',0));
  for stale in
    select record_id,data from public.app_records existing
    where existing.organization_id=target_organization_id and existing.store='purchases'
      and existing.data->>'externalSource'='omie'
      and exists(select 1 from jsonb_array_elements(entries) incoming
        where incoming->>'externalId'=existing.data->>'externalId')
      and not exists(select 1 from jsonb_array_elements(entries) incoming
        where incoming->>'externalItemId'=existing.data->>'externalItemId')
    for update
  loop
    select public.clique_obras_apply_omie_entries(
      target_organization_id,target_actor_id,
      jsonb_build_array(jsonb_build_object(
        'externalItemId',stale.data->>'externalItemId',
        'externalId',stale.data->>'externalId',
        'projectId',stale.data->>'projectId',
        'category',stale.data->>'category',
        'value',coalesce(stale.data->'value','0'::jsonb),
        'active',false,
        'externalSource','omie'
      )),target_sync_run_id
    ) into result;
    cancelled:=cancelled+coalesce((result->>'cancelled')::integer,0);
  end loop;
  return jsonb_build_object('cancelled',cancelled);
end $$;

revoke all on function public.clique_obras_store_omie_connection(uuid,uuid,text,text,date) from public,anon,authenticated;
revoke all on function public.clique_obras_omie_credentials(uuid) from public,anon,authenticated;
revoke all on function public.clique_obras_save_omie_config(uuid,uuid,jsonb,jsonb,boolean,integer) from public,anon,authenticated;
revoke all on function public.clique_obras_disconnect_omie(uuid,uuid) from public,anon,authenticated;
revoke all on function public.clique_obras_validate_omie_cron(text) from public,anon,authenticated;
revoke all on function public.clique_obras_apply_omie_entries(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.clique_obras_reconcile_omie_entries(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.clique_obras_store_omie_connection(uuid,uuid,text,text,date) to service_role;
grant execute on function public.clique_obras_omie_credentials(uuid) to service_role;
grant execute on function public.clique_obras_save_omie_config(uuid,uuid,jsonb,jsonb,boolean,integer) to service_role;
grant execute on function public.clique_obras_disconnect_omie(uuid,uuid) to service_role;
grant execute on function public.clique_obras_validate_omie_cron(text) to service_role;
grant execute on function public.clique_obras_apply_omie_entries(uuid,uuid,jsonb,uuid) to service_role;
grant execute on function public.clique_obras_reconcile_omie_entries(uuid,uuid,jsonb,uuid) to service_role;

do $$
begin
  if not exists(select 1 from vault.secrets where name='clique_obras_omie_cron_token') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'clique_obras_omie_cron_token','Token privado da automação Omie',null);
  end if;
end $$;

select cron.schedule(
  'clique-obras-omie-auto-sync',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url:='https://ghxpcclqiabbknzjaapl.supabase.co/functions/v1/omie-integration',
    headers:=jsonb_build_object('Content-Type','application/json','x-omie-cron',(select decrypted_secret from vault.decrypted_secrets where name='clique_obras_omie_cron_token')),
    body:='{"action":"scheduled"}'::jsonb,
    timeout_milliseconds:=30000
  );
  $cron$
);
