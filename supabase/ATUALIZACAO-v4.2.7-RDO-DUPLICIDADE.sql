-- ============================================================================

create or replace function public.clique_obras_rdo_occupied_employees(
  p_organization_id uuid,
  p_date text,
  p_exclude_rdo_id text default null
)
returns table(employee_id text, employee_name text, situation text)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_date text := left(coalesce(btrim(p_date), ''), 10);
  v_exclude text := nullif(btrim(coalesce(p_exclude_rdo_id, '')), '');
begin
  if p_organization_id is null or v_date = '' then
    return;
  end if;

  if not clique_obras_private.can_view_store(p_organization_id, 'rdos') then
    raise exception 'Sem permissao para consultar os diarios de obra.'
      using errcode = '42501';
  end if;

  return query
  with alocados as (
    select nullif(btrim(coalesce(e->>'employeeId', '')), '') as eid,
           nullif(btrim(coalesce(e->>'employeeName', '')), '') as ename,
           case when lower(coalesce(e->>'attendanceStatus', '')) = 'absent'
                then 'Falta' else 'Outro RDO' end as situacao
      from public.app_records r
           cross join lateral jsonb_array_elements(
             case when jsonb_typeof(r.data->'entries') = 'array'
                  then r.data->'entries' else '[]'::jsonb end) e
     where r.organization_id = p_organization_id
       and r.store = 'rdos'
       and left(coalesce(r.data->>'date', ''), 10) = v_date
       and (v_exclude is null or r.record_id <> v_exclude)
  ),
  folgas as (
    select nullif(btrim(coalesce(w.data->>'employeeId', '')), '') as eid,
           nullif(btrim(coalesce(w.data->>'employeeName', '')), '') as ename,
           'Folga'::text as situacao
      from public.app_records w
     where w.organization_id = p_organization_id
       and w.store = 'workforce_status'
       and coalesce(w.data->>'status', '') = 'day_off'
       and left(coalesce(w.data->>'date', ''), 10) = v_date
  ),
  todos as (
    select * from alocados
    union all
    select * from folgas
  )
  select t.eid,
         coalesce(min(t.ename), 'Colaborador'),
         min(t.situacao)
    from todos t
   where t.eid is not null
   group by t.eid;
end;
$function$;

create or replace function public.clique_obras_rdo_hh_gaps_v427(
  p_organization_id uuid,
  p_project_id text,
  p_employee_ids text[]
)
returns table(employee_id text, employee_name text, missing text)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_project text := nullif(btrim(coalesce(p_project_id, '')), '');
  v_type text;
begin
  if p_organization_id is null or v_project is null
     or p_employee_ids is null or array_length(p_employee_ids, 1) is null then
    return;
  end if;

  if not clique_obras_private.can_view_store(p_organization_id, 'rdos') then
    raise exception 'Sem permissao para consultar os diarios de obra.'
      using errcode = '42501';
  end if;

  select upper(btrim(coalesce(p.data->>'type', '')))
    into v_type
    from public.app_records p
   where p.organization_id = p_organization_id
     and p.store = 'projects'
     and p.record_id = v_project
   limit 1;

  if coalesce(v_type, '') <> 'HH' then
    return;
  end if;

  return query
  with alvos as (
    select distinct nullif(btrim(id), '') as eid
      from unnest(p_employee_ids) as id
  ),
  colaborador as (
    select a.eid,
           coalesce(nullif(btrim(coalesce(c.data->>'name', '')), ''), 'Colaborador') as nome,
           btrim(coalesce(c.data->>'internalRole', '')) as funcao_interna
      from alvos a
           left join public.app_records c
             on c.organization_id = p_organization_id
            and c.store = 'crew'
            and c.record_id = a.eid
     where a.eid is not null
  ),
  taxa as (
    select l.data->>'employeeId' as eid,
           coalesce(l.data->>'roleDisplayMode', 'client') as modo,
           btrim(coalesce(l.data->>'commercialRole', '')) as funcao_vendida,
           coalesce(nullif(l.data->>'costRegular', ''), '0')::numeric as custo
      from public.app_records l
     where l.organization_id = p_organization_id
       and l.store = 'labor_rates'
       and l.data->>'projectId' = v_project
       and coalesce(l.data->>'isBaseCost', 'false') <> 'true'
       and coalesce(l.data->>'active', 'true') <> 'false'
  ),
  base as (
    select l.data->>'employeeId' as eid,
           coalesce(nullif(l.data->>'costRegular', ''), '0')::numeric as custo
      from public.app_records l
     where l.organization_id = p_organization_id
       and l.store = 'labor_rates'
       and (coalesce(l.data->>'isBaseCost', 'false') = 'true'
            or coalesce(l.data->>'projectId', '') = '__base__')
       and coalesce(l.data->>'active', 'true') <> 'false'
  )
  select co.eid,
         co.nome,
         array_to_string(
           array_remove(array[
             case when t.eid is null then 'valor HH' end,
             case when coalesce(nullif(b.custo, 0), nullif(t.custo, 0)) is null
                  then 'custo' end,
             case when coalesce(nullif(case when t.modo = 'internal'
                                            then co.funcao_interna
                                            else t.funcao_vendida end, ''), '') = ''
                  then 'funcao' end
           ], null), ', ')
    from colaborador co
         left join taxa t on t.eid = co.eid
         left join base b on b.eid = co.eid
   where t.eid is null
      or coalesce(nullif(b.custo, 0), nullif(t.custo, 0)) is null
      or coalesce(nullif(case when t.modo = 'internal'
                              then co.funcao_interna
                              else t.funcao_vendida end, ''), '') = '';
end;
$function$;

create or replace function public.clique_obras_next_rdo_number_v427(
  p_organization_id uuid,
  p_year integer default null
)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_year int := coalesce(p_year, extract(year from now())::int);
  v_next int;
begin
  if p_organization_id is null then
    return null;
  end if;

  if not clique_obras_private.can_view_store(p_organization_id, 'rdos') then
    raise exception 'Sem permissao para consultar os diarios de obra.'
      using errcode = '42501';
  end if;

  select coalesce(max((regexp_match(r.data->>'number', '^RDO-' || v_year || '-(\d+)$'))[1]::int), 0) + 1
    into v_next
    from public.app_records r
   where r.organization_id = p_organization_id
     and r.store = 'rdos'
     and r.data->>'number' ~ ('^RDO-' || v_year || '-\d+$');

  return 'RDO-' || v_year || '-' || lpad(coalesce(v_next, 1)::text, 4, '0');
end;
$function$;

revoke all on function public.clique_obras_rdo_occupied_employees(uuid, text, text) from public;
revoke all on function public.clique_obras_rdo_hh_gaps_v427(uuid, text, text[]) from public;
revoke all on function public.clique_obras_next_rdo_number_v427(uuid, integer) from public;

grant execute on function public.clique_obras_rdo_occupied_employees(uuid, text, text) to authenticated;
grant execute on function public.clique_obras_rdo_hh_gaps_v427(uuid, text, text[]) to authenticated;
grant execute on function public.clique_obras_next_rdo_number_v427(uuid, integer) to authenticated;

-- ============================================================================
-- CONSULTA DE CONFERENCIA (opcional) - lista colaboradores em mais de um diario
-- no mesmo dia. Depois de publicar a v4.2.7 nenhum registro novo deve aparecer.
-- ============================================================================
-- with r as (
--   select data->>'date' as d, data->>'number' as num, data->>'projectId' as pid,
--          jsonb_array_elements(coalesce(data->'entries','[]'::jsonb)) as e
--     from public.app_records where store='rdos'
-- )
-- select d, e->>'employeeName' as colaborador, count(*) as vezes,
--        array_agg(distinct num) as rdos, array_agg(distinct pid) as projetos
--   from r
--  where coalesce(e->>'attendanceStatus','present') <> 'absent'
--  group by 1,2 having count(*) > 1
--  order by d desc;
