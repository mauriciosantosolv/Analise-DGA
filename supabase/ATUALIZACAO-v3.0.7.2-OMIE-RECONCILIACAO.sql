-- CliqueObras v3.0.7.2
-- Preserva o previsto inicial e reconcilia rateios removidos de contas a pagar Omie.

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

revoke all on function public.clique_obras_apply_omie_entries(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.clique_obras_reconcile_omie_entries(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.clique_obras_apply_omie_entries(uuid,uuid,jsonb,uuid) to service_role;
grant execute on function public.clique_obras_reconcile_omie_entries(uuid,uuid,jsonb,uuid) to service_role;

