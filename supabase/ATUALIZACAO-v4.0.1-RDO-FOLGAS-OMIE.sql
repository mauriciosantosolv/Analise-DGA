-- CliqueObras v4.0.1
-- Aprovação atômica de RDO, reparação de custos realizados, controle de folgas
-- e retrocorreção única da data real de inclusão das contas a pagar do Omie.

begin;

alter table public.app_records
  drop constraint if exists app_records_store_check;

alter table public.app_records
  add constraint app_records_store_check
  check (store=any(array[
    'projects','budgets','purchases','planning','planning_history','clients',
    'categories','settings','measurements','rdos','crew','labor_rates',
    'rdo_financial','workforce_status'
  ]::text[]));

alter table public.omie_connections
  add column if not exists inclusion_backfill_completed_at timestamptz;

create index if not exists app_records_workforce_status_org_date_employee_idx
on public.app_records (
  organization_id,
  ((data->>'date')),
  ((data->>'employeeId'))
)
where store='workforce_status';

-- Quem pode visualizar RDO também pode ler as situações diárias necessárias
-- ao relatório. A gravação de folga continua restrita a owner/admin pelo
-- validador abaixo e pela ausência de workforce_status nas permissões comuns.
create or replace function clique_obras_private.can_view_store(
  target_org uuid,
  target_store text
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id=target_org
        and member.user_id=(select auth.uid())
        and (
          member.role in ('owner','admin')
          or coalesce(member.permissions->'view','[]'::jsonb) ?
            case
              when target_store='workforce_status' then 'rdos'
              when target_store='planning_history' then 'planning'
              else target_store
            end
        )
    );
$$;

create or replace function clique_obras_private.validate_workforce_status_v401()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.app_records%rowtype;
  work_date date;
  employee_id text;
begin
  if tg_op='DELETE' then target:=old; else target:=new; end if;
  if target.store<>'workforce_status' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if clique_obras_private.is_org_admin(target.organization_id) is distinct from true then
    raise exception 'Somente proprietário ou administrador pode controlar folgas.';
  end if;
  if tg_op='DELETE' then return old; end if;

  if pg_catalog.jsonb_typeof(new.data)<>'object'
    or coalesce(new.data->>'id','')<>new.record_id
    or coalesce(new.data->>'status','')<>'day_off'
    or coalesce(new.data->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or pg_catalog.length(coalesce(new.data->>'employeeId','')) not between 1 and 120
    or pg_catalog.length(coalesce(new.data->>'employeeName',''))>180
    or pg_catalog.length(coalesce(new.data->>'internalRole',''))>180 then
    raise exception 'Registro de folga inválido.';
  end if;

  begin
    work_date:=(new.data->>'date')::date;
  exception when others then
    raise exception 'Data da folga inválida.';
  end;
  employee_id:=new.data->>'employeeId';

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws('|','cliqueobras-rdo',new.organization_id::text,work_date::text,employee_id),
      0
    )
  );

  if not exists (
    select 1
    from public.app_records employee
    where employee.organization_id=new.organization_id
      and employee.store='crew'
      and employee.record_id=employee_id
      and coalesce(employee.data->>'recordType','')<>'role'
      and coalesce(employee.data->>'active','true')<>'false'
  ) then
    raise exception 'O colaborador da folga não está ativo nesta organização.';
  end if;

  if exists (
    select 1
    from public.app_records report
    where report.organization_id=new.organization_id
      and report.store='rdos'
      and report.data->>'date'=work_date::text
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(report.data->'entries')='array'
            then report.data->'entries' else '[]'::jsonb end
        ) entry
        where entry->>'employeeId'=employee_id
      )
  ) then
    raise exception 'O colaborador já possui alocação ou falta registrada nesta data.';
  end if;

  return new;
end;
$$;

revoke all on function clique_obras_private.validate_workforce_status_v401()
from public,anon,authenticated;

drop trigger if exists zz_cliqueobras_validate_workforce_status_v401
on public.app_records;
create trigger zz_cliqueobras_validate_workforce_status_v401
before insert or update or delete
on public.app_records
for each row execute function clique_obras_private.validate_workforce_status_v401();

-- Mantém a reserva exclusiva também contra folgas, com lock transacional por
-- organização, data e colaborador para impedir conflitos simultâneos.
create or replace function clique_obras_private.validate_rdo_workforce_reservation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  work_date date;
  employee_id text;
  employee_name text;
  conflicting_rdo text;
begin
  if new.store<>'rdos' then return new; end if;
  if new.organization_id is null or coalesce(new.record_id,'')='' then
    raise exception 'A identificação do RDO ou da organização está inválida.';
  end if;
  if pg_catalog.jsonb_typeof(new.data)<>'object'
    or coalesce(new.data->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or pg_catalog.jsonb_typeof(coalesce(new.data->'entries','[]'::jsonb))<>'array' then
    raise exception 'O conteúdo do RDO está inválido.';
  end if;
  begin
    work_date:=(new.data->>'date')::date;
  exception when others then
    raise exception 'A data do RDO está inválida.';
  end;
  if pg_catalog.jsonb_array_length(coalesce(new.data->'entries','[]'::jsonb))>500 then
    raise exception 'O RDO excede o limite de 500 colaboradores.';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(new.data->'entries','[]'::jsonb)) entry
    where pg_catalog.jsonb_typeof(entry)<>'object'
      or pg_catalog.length(coalesce(pg_catalog.btrim(entry->>'employeeId'),'')) not between 1 and 120
      or coalesce(entry->>'attendanceStatus','present') not in ('present','absent')
  ) then
    raise exception 'A equipe contém colaborador ou situação inválida.';
  end if;
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(coalesce(new.data->'entries','[]'::jsonb)) entry
  )<>(
    select pg_catalog.count(distinct entry->>'employeeId')
    from pg_catalog.jsonb_array_elements(coalesce(new.data->'entries','[]'::jsonb)) entry
  ) then
    raise exception 'Um colaborador não pode aparecer duas vezes no mesmo RDO.';
  end if;

  for employee_id in
    select distinct entry->>'employeeId'
    from pg_catalog.jsonb_array_elements(coalesce(new.data->'entries','[]'::jsonb)) entry
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        pg_catalog.concat_ws('|','cliqueobras-rdo',new.organization_id::text,work_date::text,employee_id),
        0
      )
    );

    select existing.record_id
    into conflicting_rdo
    from public.app_records existing
    where existing.organization_id=new.organization_id
      and existing.store='rdos'
      and existing.record_id<>new.record_id
      and existing.data->>'date'=work_date::text
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(existing.data->'entries')='array'
            then existing.data->'entries' else '[]'::jsonb end
        ) existing_entry
        where existing_entry->>'employeeId'=employee_id
      )
    limit 1;

    if conflicting_rdo is null and exists (
      select 1
      from public.app_records status
      where status.organization_id=new.organization_id
        and status.store='workforce_status'
        and status.data->>'date'=work_date::text
        and status.data->>'employeeId'=employee_id
        and status.data->>'status'='day_off'
    ) then
      conflicting_rdo:='__day_off__';
    end if;

    if conflicting_rdo is not null then
      select nullif(pg_catalog.btrim(entry->>'employeeName'),'')
      into employee_name
      from pg_catalog.jsonb_array_elements(coalesce(new.data->'entries','[]'::jsonb)) entry
      where entry->>'employeeId'=employee_id
      limit 1;
      raise exception using
        errcode='23505',
        message=case when conflicting_rdo='__day_off__'
          then pg_catalog.format('O colaborador "%s" está de folga nesta data.',coalesce(employee_name,'selecionado'))
          else pg_catalog.format('O colaborador "%s" já está registrado em outro RDO nesta data. Atualize a tela antes de continuar.',coalesce(employee_name,'selecionado'))
        end;
    end if;
    conflicting_rdo:=null;
  end loop;
  return new;
end;
$$;

revoke all on function clique_obras_private.validate_rdo_workforce_reservation()
from public,anon,authenticated;

create or replace function public.clique_obras_rdo_occupied_employees(
  p_organization_id uuid,
  p_date date,
  p_exclude_rdo_id text default null
)
returns table(employee_id text)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Sessão autenticada obrigatória.'; end if;
  if p_organization_id is null or p_date is null then raise exception 'Organização e data são obrigatórias.'; end if;
  if clique_obras_private.can_view_store(p_organization_id,'rdos') is distinct from true then
    raise exception 'Acesso aos RDOs indisponível.';
  end if;
  return query
  select distinct reserved.employee_id
  from (
    select entry->>'employeeId' as employee_id
    from public.app_records report
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(report.data->'entries')='array'
        then report.data->'entries' else '[]'::jsonb end
    ) entry
    where report.organization_id=p_organization_id
      and report.store='rdos'
      and report.data->>'date'=p_date::text
      and report.record_id<>coalesce(p_exclude_rdo_id,'')
    union all
    select status.data->>'employeeId'
    from public.app_records status
    where status.organization_id=p_organization_id
      and status.store='workforce_status'
      and status.data->>'date'=p_date::text
      and status.data->>'status'='day_off'
  ) reserved
  where coalesce(reserved.employee_id,'')<>'';
end;
$$;

revoke all on function public.clique_obras_rdo_occupied_employees(uuid,date,text)
from public,anon;
grant execute on function public.clique_obras_rdo_occupied_employees(uuid,date,text)
to authenticated;

-- Aprova snapshot, custo realizado, vínculo financeiro e status do RDO dentro
-- da mesma transação. A função não aceita projeto, valor ou identidade que não
-- coincidam com o RDO bloqueado para atualização.
create or replace function public.clique_obras_approve_rdo_v401(
  target_organization_id uuid,
  target_rdo_id text,
  target_financial jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  report public.app_records%rowtype;
  existing_financial jsonb;
  financial_data jsonb;
  purchase_data jsonb;
  purchase_id text;
  project_id text;
  cost_total numeric;
  approved_at timestamptz:=pg_catalog.now();
begin
  if actor is null or clique_obras_private.is_org_admin(target_organization_id) is distinct from true then
    raise exception 'Somente proprietário ou administrador pode aprovar o RDO.';
  end if;
  if coalesce(target_rdo_id,'')='' or pg_catalog.jsonb_typeof(target_financial)<>'object' then
    raise exception 'Dados de aprovação inválidos.';
  end if;

  select record.* into report
  from public.app_records record
  where record.organization_id=target_organization_id
    and record.store='rdos'
    and record.record_id=target_rdo_id
  for update;
  if report.record_id is null then raise exception 'RDO não encontrado.'; end if;
  if report.data->>'status'='Aprovado' then
    if exists (
      select 1 from public.app_records purchase
      where purchase.organization_id=target_organization_id
        and purchase.store='purchases'
        and purchase.data->>'sourceRdoId'=target_rdo_id
    ) then
      return pg_catalog.jsonb_build_object('approved',true,'alreadyApproved',true);
    end if;
    raise exception 'RDO aprovado sem custo realizado. Execute a reparação da versão 4.0.1.';
  end if;
  if report.data->>'status'<>'Enviado' then raise exception 'Somente RDO enviado pode ser aprovado.'; end if;

  project_id:=report.data->>'projectId';
  if coalesce(target_financial->>'id','')<>target_rdo_id
    or coalesce(target_financial->>'rdoId','')<>target_rdo_id
    or coalesce(target_financial->>'projectId','')<>project_id
    or coalesce(target_financial->>'rdoDate','')<>coalesce(report.data->>'date','')
    or coalesce(pg_catalog.jsonb_typeof(target_financial->'costTotal'),'')<>'number'
    or pg_catalog.jsonb_typeof(coalesce(target_financial->'rows','[]'::jsonb))<>'array'
    or pg_catalog.jsonb_array_length(coalesce(target_financial->'rows','[]'::jsonb))>500 then
    raise exception 'O snapshot financeiro não corresponde ao RDO.';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(target_financial->'rows') financial_row
    where pg_catalog.jsonb_typeof(financial_row)<>'object'
      or pg_catalog.length(coalesce(financial_row->>'employeeId','')) not between 1 and 120
      or case when pg_catalog.jsonb_typeof(financial_row->'cost')='number'
        then (financial_row->>'cost')::numeric<0 else true end
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(target_financial->'rows') financial_row
  )<>(
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(report.data->'entries') report_row
    where coalesce(report_row->>'attendanceStatus','present')<>'absent'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(report.data->'entries') report_row
    where coalesce(report_row->>'attendanceStatus','present')<>'absent'
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(target_financial->'rows') financial_row
        where financial_row->>'employeeId'=report_row->>'employeeId'
      )
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(target_financial->'rows') financial_row
  )<>(
    select pg_catalog.count(distinct financial_row->>'employeeId')
    from pg_catalog.jsonb_array_elements(target_financial->'rows') financial_row
  ) then
    raise exception 'As linhas financeiras não correspondem aos colaboradores presentes no RDO.';
  end if;
  cost_total:=pg_catalog.round((target_financial->>'costTotal')::numeric,2);
  if cost_total<=0 or cost_total>1000000000000 then
    raise exception 'O custo de mão de obra precisa ser maior que zero.';
  end if;

  financial_data:=target_financial||pg_catalog.jsonb_build_object(
    'approvedAt',approved_at,
    'approvedByUserId',actor
  );
  insert into public.app_records(organization_id,user_id,store,record_id,data,updated_at)
  values(target_organization_id,actor,'rdo_financial',target_rdo_id,financial_data,approved_at)
  on conflict(organization_id,store,record_id) do nothing;

  select record.data into existing_financial
  from public.app_records record
  where record.organization_id=target_organization_id
    and record.store='rdo_financial'
    and record.record_id=target_rdo_id;
  if existing_financial is null
    or pg_catalog.abs(coalesce((existing_financial->>'costTotal')::numeric,-1)-cost_total)>0.01
    or existing_financial->>'projectId' is distinct from project_id then
    raise exception 'Já existe um snapshot financeiro incompatível para este RDO.';
  end if;

  purchase_id:='rdo-cost-'||target_rdo_id;
  purchase_data:=pg_catalog.jsonb_build_object(
    'id',purchase_id,
    'projectId',project_id,
    'date',report.data->>'date',
    'category','Mão de Obra',
    'desc','Custo da mão de obra · '||coalesce(report.data->>'number',target_rdo_id),
    'supplier','Equipe própria',
    'value',cost_total,
    'source','rdo-cost',
    'sourceType','labor',
    'sourceRdoId',target_rdo_id,
    'abatido',false,
    'createdAt',pg_catalog.floor(extract(epoch from approved_at)*1000)::bigint
  );
  insert into public.app_records(organization_id,user_id,store,record_id,data,updated_at)
  values(target_organization_id,actor,'purchases',purchase_id,purchase_data,approved_at)
  on conflict(organization_id,store,record_id) do update
  set data=excluded.data,user_id=excluded.user_id,updated_at=excluded.updated_at;

  insert into public.rdo_cost_postings(
    organization_id,rdo_id,project_id,purchase_record_id,amount,posted_by,posted_at
  ) values(
    target_organization_id,target_rdo_id,project_id,purchase_id,cost_total,actor,approved_at
  )
  on conflict(organization_id,rdo_id) do update
  set project_id=excluded.project_id,
      purchase_record_id=excluded.purchase_record_id,
      amount=excluded.amount,
      posted_by=excluded.posted_by,
      posted_at=excluded.posted_at;

  update public.app_records
  set data=report.data||pg_catalog.jsonb_build_object(
      'status','Aprovado',
      'approvedAt',approved_at,
      'approvedBy',pg_catalog.left(coalesce(target_financial->>'approvedBy','Usuário'),180),
      'updatedAt',approved_at
    ),
    user_id=actor,
    updated_at=approved_at
  where organization_id=target_organization_id
    and store='rdos'
    and record_id=target_rdo_id;

  return pg_catalog.jsonb_build_object(
    'approved',true,
    'purchaseRecordId',purchase_id,
    'costTotal',cost_total
  );
end;
$$;

revoke all on function public.clique_obras_approve_rdo_v401(uuid,text,jsonb)
from public,anon;
grant execute on function public.clique_obras_approve_rdo_v401(uuid,text,jsonb)
to authenticated;

-- Recria lançamentos/postagens ausentes de RDOs já aprovados usando somente o
-- snapshot imutável gravado na aprovação; nenhuma taxa atual é reaplicada.
create or replace function public.clique_obras_repair_rdo_costs_v401(
  target_organization_id uuid
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  item record;
  purchase_id text;
  purchase_data jsonb;
  cost_total numeric;
  repaired integer:=0;
begin
  if actor is null or clique_obras_private.is_org_admin(target_organization_id) is distinct from true then
    raise exception 'Somente proprietário ou administrador pode reparar custos de RDO.';
  end if;

  for item in
    select report.record_id,report.data as report_data,financial.data as financial_data
    from public.app_records report
    join public.app_records financial
      on financial.organization_id=report.organization_id
      and financial.store='rdo_financial'
      and financial.record_id=report.record_id
    where report.organization_id=target_organization_id
      and report.store='rdos'
      and report.data->>'status'='Aprovado'
      and financial.data->>'projectId'=report.data->>'projectId'
      and coalesce(financial.data->>'costTotal','') ~ '^[0-9]+([.][0-9]+)?$'
      and (financial.data->>'costTotal')::numeric>0
    order by report.record_id
  loop
    cost_total:=pg_catalog.round((item.financial_data->>'costTotal')::numeric,2);
    purchase_id:='rdo-cost-'||item.record_id;
    purchase_data:=pg_catalog.jsonb_build_object(
      'id',purchase_id,
      'projectId',item.report_data->>'projectId',
      'date',item.report_data->>'date',
      'category','Mão de Obra',
      'desc','Custo da mão de obra · '||coalesce(item.report_data->>'number',item.record_id),
      'supplier','Equipe própria',
      'value',cost_total,
      'source','rdo-cost',
      'sourceType','labor',
      'sourceRdoId',item.record_id,
      'abatido',false,
      'createdAt',pg_catalog.floor(extract(epoch from pg_catalog.now())*1000)::bigint,
      'repairedByVersion','4.0.1'
    );

    if not exists (
      select 1 from public.app_records purchase
      where purchase.organization_id=target_organization_id
        and purchase.store='purchases'
        and purchase.record_id=purchase_id
        and purchase.data->>'projectId'=item.report_data->>'projectId'
        and purchase.data->>'category'='Mão de Obra'
        and purchase.data->>'sourceRdoId'=item.record_id
        and coalesce(purchase.data->>'value','') ~ '^[0-9]+([.][0-9]+)?$'
        and pg_catalog.abs((purchase.data->>'value')::numeric-cost_total)<=0.01
    ) then
      insert into public.app_records(organization_id,user_id,store,record_id,data,updated_at)
      values(target_organization_id,actor,'purchases',purchase_id,purchase_data,pg_catalog.now())
      on conflict(organization_id,store,record_id) do update
      set data=excluded.data,user_id=excluded.user_id,updated_at=excluded.updated_at;
      repaired:=repaired+1;
    end if;

    insert into public.rdo_cost_postings(
      organization_id,rdo_id,project_id,purchase_record_id,amount,posted_by,posted_at
    ) values(
      target_organization_id,item.record_id,item.report_data->>'projectId',purchase_id,cost_total,actor,pg_catalog.now()
    )
    on conflict(organization_id,rdo_id) do update
    set project_id=excluded.project_id,
        purchase_record_id=excluded.purchase_record_id,
        amount=excluded.amount,
        posted_by=excluded.posted_by,
        posted_at=excluded.posted_at;
  end loop;
  return repaired;
end;
$$;

revoke all on function public.clique_obras_repair_rdo_costs_v401(uuid)
from public,anon;
grant execute on function public.clique_obras_repair_rdo_costs_v401(uuid)
to authenticated;

-- Valida dInc antes de chamar a rotina financeira. Contas ativas nunca podem
-- usar vencimento ou previsão como data de inclusão.
create or replace function public.clique_obras_apply_omie_entries_v401(
  target_organization_id uuid,
  target_actor_id uuid,
  entries jsonb,
  target_sync_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  result jsonb;
  item jsonb;
  item_id text;
  purchase_id text;
  inclusion_date date;
begin
  if pg_catalog.jsonb_typeof(entries)<>'array'
    or pg_catalog.jsonb_array_length(entries)>500 then
    raise exception 'invalid entries';
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(entries) loop
    if coalesce(item->>'active','true')<>'false' then
      if coalesce(item->>'omieInclusionDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'active Omie entry without info.dInc';
      end if;
      begin
        inclusion_date:=(item->>'omieInclusionDate')::date;
      exception when others then
        raise exception 'invalid Omie inclusion date';
      end;
      if inclusion_date>(pg_catalog.now() at time zone 'America/Sao_Paulo')::date then
        raise exception 'future Omie inclusion date';
      end if;
    end if;
  end loop;

  perform pg_catalog.set_config('clique_obras.omie_write_org',target_organization_id::text,true);
  result:=public.clique_obras_apply_omie_entries(
    target_organization_id,target_actor_id,entries,target_sync_run_id
  );

  for item in select value from pg_catalog.jsonb_array_elements(entries) loop
    item_id:=pg_catalog.left(coalesce(item->>'externalItemId',''),180);
    if item_id='' or coalesce(item->>'externalSource','')<>'omie' then
      raise exception 'invalid entry identity';
    end if;
    purchase_id:='omie-ap-'||pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(item_id,'UTF8'),'sha256'),'hex'
    );
    update public.app_records
    set data=data||pg_catalog.jsonb_build_object(
      'date',nullif(item->>'omieInclusionDate',''),
      'omieInclusionDate',coalesce(item->>'omieInclusionDate',''),
      'omieInclusionTime',coalesce(item->>'omieInclusionTime',''),
      'omieInclusionDateTime',coalesce(item->>'omieInclusionDateTime',''),
      'dueDate',coalesce(item->>'dueDate',''),
      'forecastDate',coalesce(item->>'forecastDate','')
    ),
    updated_at=pg_catalog.now()
    where organization_id=target_organization_id
      and store='purchases'
      and record_id=purchase_id
      and data->>'externalSource'='omie'
      and data->>'externalItemId'=item_id;
  end loop;
  return result;
end;
$$;

revoke all on function public.clique_obras_apply_omie_entries_v401(uuid,uuid,jsonb,uuid)
from public,anon,authenticated;
grant execute on function public.clique_obras_apply_omie_entries_v401(uuid,uuid,jsonb,uuid)
to service_role;

comment on function public.clique_obras_approve_rdo_v401(uuid,text,jsonb)
is 'Aprova RDO e grava snapshot, custo realizado e postagem na mesma transação.';
comment on function public.clique_obras_repair_rdo_costs_v401(uuid)
is 'Recria custo realizado ausente usando exclusivamente o snapshot imutável de RDO aprovado.';
comment on function public.clique_obras_apply_omie_entries_v401(uuid,uuid,jsonb,uuid)
is 'Aplica conta Omie somente com data de inclusão info.dInc válida e preserva vencimento/previsão separadamente.';

notify pgrst,'reload schema';

commit;
