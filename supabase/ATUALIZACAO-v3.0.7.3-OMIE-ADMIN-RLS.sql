-- CliqueObras v3.0.7.3
-- Corrige a gravacao interna da sincronizacao Omie e aceita a permissao derivada
-- planning_history ao promover membros, sem transferir a propriedade da organizacao.

create or replace function clique_obras_private.valid_permissions(input jsonb)
returns boolean
language sql
immutable
set search_path='pg_catalog'
as $$
  select jsonb_typeof(input)='object'
    and jsonb_typeof(coalesce(input->'view','[]'::jsonb))='array'
    and jsonb_typeof(coalesce(input->'edit','[]'::jsonb))='array'
    and jsonb_typeof(coalesce(input->'rdo_projects','[]'::jsonb))='array'
    and jsonb_array_length(coalesce(input->'rdo_projects','[]'::jsonb))<=500
    and coalesce(input->'manage_users','false'::jsonb)
      in ('true'::jsonb,'false'::jsonb)
    and not exists (
      select 1 from jsonb_object_keys(input) as permission_key(value)
      where value not in ('view','edit','manage_users','rdo_projects')
    )
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(input->'view','[]'::jsonb)) as view_store(value)
      where value not in (
        'projects','budgets','purchases','planning','planning_history','clients','categories',
        'settings','measurements','rdos','crew','labor_rates','rdo_financial'
      )
    )
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(input->'edit','[]'::jsonb)) as edit_store(value)
      where value not in (
        'projects','budgets','purchases','planning','planning_history','clients','categories',
        'settings','measurements','rdos','crew','labor_rates','rdo_financial'
      )
      or not (coalesce(input->'view','[]'::jsonb) ? value)
    )
    and not exists (
      select 1
      from jsonb_array_elements(
        coalesce(input->'rdo_projects','[]'::jsonb)
      ) as assigned(item)
      where jsonb_typeof(item)<>'object'
        or jsonb_typeof(item->'id')<>'string'
        or length(trim(item->>'id')) not between 1 and 200
        or (
          item ? 'label'
          and jsonb_typeof(item->'label')<>'string'
        )
        or length(coalesce(item->>'label',''))>180
        or exists (
          select 1
          from jsonb_object_keys(item) as project_key(value)
          where value not in ('id','label')
        )
    );
$$;

create or replace function clique_obras_private.set_app_record_organization()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  session_user_id uuid := (select auth.uid());
  omie_organization text := current_setting('clique_obras.omie_write_org',true);
  is_omie_service_write boolean := false;
begin
  is_omie_service_write := (select auth.role())='service_role'
    and omie_organization is not null
    and new.organization_id::text=omie_organization
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id=new.organization_id
        and member.user_id=new.user_id
    )
    and (
      (tg_op='INSERT' and new.store='purchases' and new.data->>'externalSource'='omie')
      or (tg_op='INSERT' and new.store='planning_history' and new.data->>'source'='omie')
      or (
        tg_op='UPDATE'
        and new.organization_id=old.organization_id
        and new.store=old.store
        and new.record_id=old.record_id
        and (
          new.store='planning'
          or (new.store='purchases' and new.data->>'externalSource'='omie')
        )
      )
    );

  if is_omie_service_write then
    return new;
  end if;

  if session_user_id is null or new.user_id<>session_user_id then
    raise exception 'Usuario invalido para o registro.';
  end if;
  if new.organization_id is null then
    select member.organization_id into new.organization_id
    from public.organization_members member
    where member.user_id=session_user_id
    order by case member.role when 'owner' then 0 when 'admin' then 1 else 2 end,
      member.joined_at
    limit 1;
  end if;
  if new.organization_id is null then
    raise exception 'Nenhuma organizacao vinculada ao usuario.';
  end if;
  return new;
end;
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
        values(target_organization_id,actor,'planning_history',history_id,jsonb_build_object('id',history_id,'planningId',offset_item->>'planningId','projectId',plan_data->>'projectId','category',plan_data->>'category','action','omie_restored','source','omie','sourceId',item_id,'amount',consumed,'beforeValue',before_value,'afterValue',after_value,'description','Planejamento restaurado por alteracao ou cancelamento no Omie','occurredAt',now()));
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

    purchase_data=jsonb_build_object('id',purchase_id,'projectId',project_id,'category',category_name,'supplier',left(coalesce(item->>'supplier',''),180),'order',left(coalesce(item->>'order',''),100),'value',value_amount,'date',item->>'date','desc',left(coalesce(item->>'description','Conta a pagar Omie'),500),'notes','Status Omie: '||left(coalesce(item->>'status',''),40),'costCenter',category_name,'sourceType','omiePayable','externalSource','omie','externalId',left(coalesce(item->>'externalId',''),100),'externalItemId',item_id,'omieProjectCode',left(coalesce(item->>'omieProjectCode',''),60),'omieCategoryCode',left(coalesce(item->>'omieCategoryCode',''),40),'omieStatus',left(coalesce(item->>'status',''),40),'readOnly',true,'planningOffsets',offsets,'planningOffsetAmount',round(value_amount-remaining,2),'planningUnmatchedAmount',remaining,'importedAt',floor(extract(epoch from now())*1000)::bigint,'file','(Sincronizacao Omie)','syncedAt',now(),'syncRunId',target_sync_run_id);
    insert into public.app_records(organization_id,user_id,store,record_id,data,updated_at)
    values(target_organization_id,actor,'purchases',purchase_id,purchase_data,now())
    on conflict(organization_id,store,record_id) do update set data=excluded.data,user_id=excluded.user_id,updated_at=excluded.updated_at;
    if old_data is null then imported:=imported+1; else updated:=updated+1; end if;
  end loop;
  return jsonb_build_object('imported',imported,'updated',updated,'cancelled',cancelled,'unchanged',unchanged);
end;
$$;

revoke all on function public.clique_obras_apply_omie_entries(uuid,uuid,jsonb,uuid)
from public,anon,authenticated;
grant execute on function public.clique_obras_apply_omie_entries(uuid,uuid,jsonb,uuid)
to service_role;

comment on function public.clique_obras_apply_omie_entries(uuid,uuid,jsonb,uuid)
is 'Aplica contas a pagar Omie com autorizacao transacional limitada a organizacao e aos stores financeiros da integracao.';
