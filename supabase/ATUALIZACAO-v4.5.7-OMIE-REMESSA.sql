-- =====================================================================
-- CliqueObras v4.5.7 — Custo por NOTA DE REMESSA (Omie)
--
-- Tudo aqui é NOVO. Nenhuma tabela, função, trigger ou policy existente é
-- alterada. Projetos que NÃO forem ativados continuam com o custo vindo do
-- Contas a Pagar, exatamente como hoje.
--
-- Cria:
--   1. omie_remessa_projects  — quais projetos usam custo por remessa
--   2. omie_card_accounts     — contas correntes do Omie que são o cartão
--                               corporativo (continuam entrando pelo Contas a
--                               Pagar nos projetos com remessa)
--   3. omie_remessa_cache     — cache privado do detalhe das remessas
--   4. clique_obras_apply_omie_remessas_v457 — cópia fiel da rotina de produção
--      clique_obras_apply_omie_entries (FIFO no planejamento, histórico,
--      estorno), com três diferenças: grava sourceType 'omieRemessa' (registro
--      'omie-rm-…', nunca colide com contas a pagar 'omie-ap-…' e nunca entra
--      na caça a órfãos da v4.2.6), histórico com source 'omie_remessa', e guarda
--      valor bruto, retornos estornados e NF da remessa.
--
-- Todas as tabelas são privadas (RLS forçada, só service_role), como
-- omie_supplier_cache. Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.omie_remessa_projects (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  omie_project_code text not null check (omie_project_code ~ '^[0-9]{1,30}$'),
  clique_project_id text not null check (char_length(clique_project_id) between 1 and 180),
  enabled boolean not null default false,
  enabled_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, omie_project_code)
);

create table if not exists public.omie_card_accounts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  omie_account_code text not null check (omie_account_code ~ '^[0-9]{1,40}$'),
  account_name text check (account_name is null or char_length(account_name) <= 120),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, omie_account_code)
);

create table if not exists public.omie_remessa_cache (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  remessa_id text not null check (char_length(remessa_id) between 1 and 60),
  row_hash text not null check (char_length(row_hash) = 64),
  summary jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),
  primary key (organization_id, remessa_id)
);

create index if not exists omie_remessa_projects_updated_by_idx on public.omie_remessa_projects(updated_by);
create index if not exists omie_card_accounts_updated_by_idx on public.omie_card_accounts(updated_by);

alter table public.omie_remessa_projects enable row level security;
alter table public.omie_remessa_projects force row level security;
alter table public.omie_card_accounts enable row level security;
alter table public.omie_card_accounts force row level security;
alter table public.omie_remessa_cache enable row level security;
alter table public.omie_remessa_cache force row level security;

drop policy if exists omie_remessa_projects_private_deny on public.omie_remessa_projects;
create policy omie_remessa_projects_private_deny on public.omie_remessa_projects
  for all to anon,authenticated using (false) with check (false);
drop policy if exists omie_card_accounts_private_deny on public.omie_card_accounts;
create policy omie_card_accounts_private_deny on public.omie_card_accounts
  for all to anon,authenticated using (false) with check (false);
drop policy if exists omie_remessa_cache_private_deny on public.omie_remessa_cache;
create policy omie_remessa_cache_private_deny on public.omie_remessa_cache
  for all to anon,authenticated using (false) with check (false);

revoke all on public.omie_remessa_projects from public,anon,authenticated;
revoke all on public.omie_card_accounts from public,anon,authenticated;
revoke all on public.omie_remessa_cache from public,anon,authenticated;
grant select,insert,update,delete on public.omie_remessa_projects to service_role;
grant select,insert,update,delete on public.omie_card_accounts to service_role;
grant select,insert,update,delete on public.omie_remessa_cache to service_role;

create or replace function public.clique_obras_apply_omie_remessas_v457(
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
  select member.user_id into actor
  from public.organization_members member
  join auth.users account on account.id=member.user_id
  where member.organization_id=target_organization_id
  order by case when member.user_id=target_actor_id then 0 when member.role='owner' then 1 else 2 end,
    member.joined_at
  limit 1;
  if actor is null then raise exception 'organization actor required'; end if;

  perform set_config('clique_obras.omie_write_org',target_organization_id::text,true);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':omie',0));

  for item in select value from jsonb_array_elements(entries) loop
    item_id:=left(coalesce(item->>'externalItemId',''),180);
    project_id:=left(coalesce(item->>'projectId',''),180);
    category_name:=left(coalesce(item->>'category',''),180);
    if item_id='' or project_id='' or category_name='' or coalesce(item->>'externalSource','')<>'omie' or left(item_id,8)<>'remessa:' then raise exception 'invalid entry identity'; end if;
    value_amount:=round(abs(coalesce((item->>'value')::numeric,0)),2);
    if value_amount>1000000000000 then raise exception 'value above limit'; end if;
    active_item:=coalesce((item->>'active')::boolean,true) and value_amount>0;
    -- v4.5.7: projeto/categoria so sao exigidos para LANCAR; o estorno de uma
    -- remessa nunca fica bloqueado por um cadastro apagado depois.
    if active_item and not exists(select 1 from public.app_records where organization_id=target_organization_id and store='projects' and record_id=project_id) then raise exception 'project not found'; end if;
    if active_item and not exists(select 1 from public.app_records where organization_id=target_organization_id and store='categories' and data->>'name'=category_name) then raise exception 'category not found'; end if;
    purchase_id:='omie-rm-'||encode(extensions.digest(convert_to(item_id,'UTF8'),'sha256'),'hex');
    select data into old_data from public.app_records where organization_id=target_organization_id and store='purchases' and record_id=purchase_id for update;
    if old_data is not null and coalesce(old_data->>'externalItemId','')<>item_id then raise exception 'external id collision'; end if;
    same_identity:=old_data is not null and old_data->>'projectId'=project_id and old_data->>'category'=category_name and round(coalesce((old_data->>'value')::numeric,0),2)=value_amount;

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
        values(target_organization_id,actor,'planning_history',history_id,jsonb_build_object('id',history_id,'planningId',offset_item->>'planningId','projectId',plan_data->>'projectId','category',plan_data->>'category','action','omie_restored','source','omie_remessa','sourceId',item_id,'amount',consumed,'beforeValue',before_value,'afterValue',after_value,'description','Planejamento restaurado por retorno, alteracao ou cancelamento de remessa no Omie','occurredAt',now()));
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
      purchase_data=(old_data - 'date' - 'supplier' - 'order' - 'desc' - 'notes' - 'omieStatus' - 'syncedAt' - 'syncRunId' - 'grossValue' - 'returnedValue' - 'returns' - 'nfNumber' - 'nfKey') ||
        jsonb_build_object('date',item->>'date','supplier',left(coalesce(item->>'supplier',''),180),'order',left(coalesce(item->>'order',''),100),'desc',left(coalesce(item->>'description','Remessa Omie'),500),'notes','Status Omie: '||left(coalesce(item->>'status',''),40),'omieStatus',left(coalesce(item->>'status',''),40),'syncedAt',now(),'syncRunId',target_sync_run_id,
          'grossValue',round(abs(coalesce((item->>'grossValue')::numeric,value_amount)),2),'returnedValue',round(abs(coalesce((item->>'returnedValue')::numeric,0)),2),'returns',coalesce(item->'returns','[]'::jsonb),'nfNumber',left(coalesce(item->>'nfNumber',''),20),'nfKey',left(coalesce(item->>'nfKey',''),44));
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
      values(target_organization_id,actor,'planning_history',history_id,jsonb_build_object('id',history_id,'planningId',plan_row.record_id,'projectId',project_id,'category',category_name,'action','omie_consumed','source','omie_remessa','sourceId',item_id,'amount',consumed,'beforeValue',before_value,'afterValue',after_value,'description','Remessa de produtos do Omie abatida do planejamento','occurredAt',now()));
      remaining:=round(remaining-consumed,2);
    end loop;

    purchase_data=jsonb_build_object('id',purchase_id,'projectId',project_id,'category',category_name,'supplier',left(coalesce(item->>'supplier',''),180),'order',left(coalesce(item->>'order',''),100),'value',value_amount,'date',item->>'date','desc',left(coalesce(item->>'description','Remessa Omie'),500),'notes','Status Omie: '||left(coalesce(item->>'status',''),40),'costCenter',category_name,'sourceType','omieRemessa','externalSource','omie','externalId',left(coalesce(item->>'externalId',''),100),'externalItemId',item_id,'omieProjectCode',left(coalesce(item->>'omieProjectCode',''),60),'omieCategoryCode',left(coalesce(item->>'omieCategoryCode',''),40),'omieStatus',left(coalesce(item->>'status',''),40),'readOnly',true,'planningOffsets',offsets,'planningOffsetAmount',round(value_amount-remaining,2),'planningUnmatchedAmount',remaining,'importedAt',floor(extract(epoch from now())*1000)::bigint,'file','(Sincronizacao Omie - Remessas)','syncedAt',now(),'syncRunId',target_sync_run_id)
      ||jsonb_build_object('grossValue',round(abs(coalesce((item->>'grossValue')::numeric,value_amount)),2),'returnedValue',round(abs(coalesce((item->>'returnedValue')::numeric,0)),2),'returns',coalesce(item->'returns','[]'::jsonb),'nfNumber',left(coalesce(item->>'nfNumber',''),20),'nfKey',left(coalesce(item->>'nfKey',''),44));
    insert into public.app_records(organization_id,user_id,store,record_id,data,updated_at)
    values(target_organization_id,actor,'purchases',purchase_id,purchase_data,now())
    on conflict(organization_id,store,record_id) do update set data=excluded.data,user_id=excluded.user_id,updated_at=excluded.updated_at;
    if old_data is null then imported:=imported+1; else updated:=updated+1; end if;
  end loop;
  return jsonb_build_object('imported',imported,'updated',updated,'cancelled',cancelled,'unchanged',unchanged);
end;
$$;

revoke all on function public.clique_obras_apply_omie_remessas_v457(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.clique_obras_apply_omie_remessas_v457(uuid,uuid,jsonb,uuid) to service_role;

comment on function public.clique_obras_apply_omie_remessas_v457(uuid,uuid,jsonb,uuid) is
  'v4.5.7 — Aplica remessas de produtos do Omie (liquidas dos retornos) nos projetos com custo por remessa. Mesma logica FIFO/estorno de clique_obras_apply_omie_entries, com sourceType omieRemessa.';

-- Conferência (opcional):
--   select to_regclass('public.omie_remessa_projects'), to_regclass('public.omie_card_accounts'),
--          to_regclass('public.omie_remessa_cache'),
--          to_regprocedure('public.clique_obras_apply_omie_remessas_v457(uuid,uuid,jsonb,uuid)');
