-- CliqueObras v4.0
-- Reserva exclusiva de colaboradores por organização e data.
-- A validação ocorre no mesmo comando que grava o RDO, inclusive em rascunho,
-- e não expõe uma tabela auxiliar pela Data API.

begin;

create index if not exists app_records_rdos_org_date_idx
on public.app_records (organization_id, ((data->>'date')))
where store='rdos';

-- A migração não altera diários históricos. Se já existirem duplicidades,
-- apenas informa quantos grupos precisam ser revisados pelo administrador.
do $$
declare
  duplicate_groups integer;
begin
  select pg_catalog.count(*)
  into duplicate_groups
  from (
    select record.organization_id,record.data->>'date',entry->>'employeeId'
    from public.app_records record
    cross join lateral pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(record.data->'entries')='array'
          then record.data->'entries'
        else '[]'::jsonb
      end
    ) entry
    where record.store='rdos'
      and coalesce(record.data->>'date','')<>''
      and coalesce(entry->>'employeeId','')<>''
    group by record.organization_id,record.data->>'date',entry->>'employeeId'
    having pg_catalog.count(distinct record.record_id)>1
  ) duplicates;

  if duplicate_groups>0 then
    raise warning 'Foram encontrados % grupo(s) histórico(s) com o mesmo colaborador em mais de um RDO na mesma data. A migração não alterou esses diários; revise-os antes da implantação.',duplicate_groups;
  end if;
end
$$;

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
  if new.store<>'rdos' then
    return new;
  end if;

  if new.organization_id is null or coalesce(new.record_id,'')='' then
    raise exception using
      errcode='23514',
      message='A identificação do RDO ou da organização está inválida.';
  end if;

  if pg_catalog.jsonb_typeof(new.data)<>'object' then
    raise exception using
      errcode='23514',
      message='O conteúdo do RDO precisa ser um objeto válido.';
  end if;

  if coalesce(new.data->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using
      errcode='23514',
      message='A data do RDO está inválida.';
  end if;

  begin
    work_date := (new.data->>'date')::date;
  exception when others then
    raise exception using
      errcode='22007',
      message='A data do RDO está inválida.';
  end;

  if pg_catalog.jsonb_typeof(coalesce(new.data->'entries','[]'::jsonb))<>'array' then
    raise exception using
      errcode='23514',
      message='A equipe do RDO está em formato inválido.';
  end if;

  if pg_catalog.jsonb_array_length(coalesce(new.data->'entries','[]'::jsonb))>500 then
    raise exception using
      errcode='54000',
      message='O RDO excede o limite de 500 colaboradores.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(new.data->'entries','[]'::jsonb)) entry
    where pg_catalog.jsonb_typeof(entry)<>'object'
       or coalesce(pg_catalog.btrim(entry->>'employeeId'),'')=''
       or pg_catalog.length(pg_catalog.btrim(entry->>'employeeId'))>120
       or coalesce(entry->>'attendanceStatus','present') not in ('present','absent')
  ) then
    raise exception using
      errcode='23514',
      message='A equipe contém colaborador ou situação inválida.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(coalesce(new.data->'entries','[]'::jsonb)) entry
  ) <> (
    select pg_catalog.count(distinct entry->>'employeeId')
    from pg_catalog.jsonb_array_elements(coalesce(new.data->'entries','[]'::jsonb)) entry
  ) then
    raise exception using
      errcode='23505',
      message='Um colaborador não pode aparecer duas vezes no mesmo RDO.';
  end if;

  -- Todos os locks são obtidos em ordem estável para evitar deadlocks quando
  -- dois RDOs tentam reservar várias pessoas simultaneamente.
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
          case
            when pg_catalog.jsonb_typeof(existing.data->'entries')='array'
              then existing.data->'entries'
            else '[]'::jsonb
          end
        ) existing_entry
        where existing_entry->>'employeeId'=employee_id
      )
    limit 1;

    if conflicting_rdo is not null then
      select nullif(pg_catalog.btrim(entry->>'employeeName'),'')
      into employee_name
      from pg_catalog.jsonb_array_elements(coalesce(new.data->'entries','[]'::jsonb)) entry
      where entry->>'employeeId'=employee_id
      limit 1;

      raise exception using
        errcode='23505',
        message=pg_catalog.format(
          'O colaborador "%s" já está registrado em outro RDO nesta data. Atualize a tela antes de continuar.',
          coalesce(employee_name,'selecionado')
        );
    end if;

    conflicting_rdo := null;
  end loop;

  return new;
end;
$$;

revoke all on function clique_obras_private.validate_rdo_workforce_reservation()
from public,anon,authenticated;

drop trigger if exists zz_cliqueobras_validate_rdo_workforce
on public.app_records;
create trigger zz_cliqueobras_validate_rdo_workforce
before insert or update
on public.app_records
for each row
execute function clique_obras_private.validate_rdo_workforce_reservation();

comment on function clique_obras_private.validate_rdo_workforce_reservation()
is 'Impede que o mesmo colaborador seja alocado ou marcado como falta em RDOs diferentes da mesma organização e data.';

-- Retorna somente identificadores de colaboradores ocupados. O projeto e o
-- conteúdo do outro RDO não são expostos para usuários sem acesso àquela obra.
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
  if (select auth.uid()) is null then
    raise exception 'Sessão autenticada obrigatória.';
  end if;

  if p_organization_id is null or p_date is null then
    raise exception 'Organização e data são obrigatórias.';
  end if;

  if clique_obras_private.can_view_store(p_organization_id,'rdos') is distinct from true then
    raise exception 'Acesso aos RDOs indisponível.';
  end if;

  return query
  select distinct entry->>'employeeId'
  from public.app_records record
  cross join lateral pg_catalog.jsonb_array_elements(
    case
      when pg_catalog.jsonb_typeof(record.data->'entries')='array'
        then record.data->'entries'
      else '[]'::jsonb
    end
  ) entry
  where record.organization_id=p_organization_id
    and record.store='rdos'
    and record.data->>'date'=p_date::text
    and record.record_id<>coalesce(p_exclude_rdo_id,'')
    and coalesce(entry->>'employeeId','')<>'';
end;
$$;

revoke all on function public.clique_obras_rdo_occupied_employees(uuid,date,text)
from public,anon;
grant execute on function public.clique_obras_rdo_occupied_employees(uuid,date,text)
to authenticated;

comment on function public.clique_obras_rdo_occupied_employees(uuid,date,text)
is 'Lista apenas IDs ocupados na data para ocultação segura no formulário, sem revelar outro RDO ou projeto.';

notify pgrst, 'reload schema';

commit;
