-- ============================================================================
-- CliqueObras v4.5.16 - mesmo colaborador em duas obras no mesmo dia
-- ============================================================================
-- Pedido de 13/11/2026: permitir que o colaborador seja alocado no MESMO DIA
-- em RDOs de obras diferentes quando os HORARIOS forem diferentes.
--
-- Regra (identica a RDO.entryWindow/slotConflict em modules/rdo/rdo.js):
--   - dois lancamentos do mesmo colaborador na mesma data conflitam quando os
--     horarios Entrada-Saida se sobrepoem. Encostar nao e sobrepor:
--     07:00-12:00 e 12:00-17:00 passam;
--   - Saida menor que Entrada = virada da noite (22:00-06:00 vai ate 06:00 do
--     dia seguinte), igual ao calculo de horas do RDO;
--   - continuam ocupando o DIA INTEIRO (bloqueiam qualquer outro RDO):
--       * falta registrada (attendanceStatus = 'absent');
--       * lancamento sem Entrada/Saida validas;
--       * folga do dia (store workforce_status) - sem mudanca;
--   - o mesmo colaborador duas vezes no MESMO RDO continua proibido;
--   - folga continua proibida quando ha qualquer lancamento no dia (o gatilho
--     validate_workforce_status_v401 nao foi tocado).
--
-- O que muda:
--   1. clique_obras_private.rdo_entry_window_v4516(jsonb)   (nova)
--   2. clique_obras_private.validate_rdo_workforce_reservation() + gatilho
--      zz_cliqueobras_validate_rdo_workforce (mesmos nomes da v4.0; o corpo
--      compara horarios. Base: versao da v4.0.1)
--   3. public.clique_obras_rdo_occupied_slots_v4516(uuid,text,text) (nova)
--      Devolve, por ocupacao, so situacao e horario - nunca o projeto, como a
--      RPC antiga. A antiga clique_obras_rdo_occupied_employees fica como esta
--      (o front cai nela se esta ainda nao existir).
--
-- PRODUCAO (mwelgpjkqljtkzbqxmag), conferido em 13/11/2026 antes de aplicar:
--   - o gatilho zz_cliqueobras_validate_rdo_workforce e a funcao
--     validate_rdo_workforce_reservation da v4.0/v4.0.1 NAO existiam neste
--     projeto. A unica trava era a da tela (State.rdos + RPC
--     clique_obras_rdo_occupied_employees). Este SQL cria o gatilho, agora com
--     a regra de horario;
--   - dados: 686 RDOs / 1.741 lancamentos, nenhum colaborador em dois RDOs no
--     mesmo dia, nenhum presente sem horario, nenhum RDO com formato ou equipe
--     invalidos -> nenhum RDO existente passa a ser recusado ao ser editado
--     ou aprovado;
--   - clique_obras_private.approve_rdo_v401 nao compara RDOs do mesmo dia.
--
-- JA APLICADO EM PRODUCAO em 13/11/2026 (migration v4516_rdo_mesmo_dia_horarios).
-- ORDEM DE PUBLICACAO: aplicar ESTE SQL antes de subir o front v4.5.16.
-- ============================================================================

begin;

-- 1. Janela de horario de um lancamento do RDO, em minutos desde 00:00.
--    null = ocupa o dia inteiro (falta ou horario ausente/invalido).
create or replace function clique_obras_private.rdo_entry_window_v4516(entry jsonb)
returns int4range
language plpgsql
immutable
set search_path=''
as $$
declare
  start_text text;
  end_text text;
  start_min integer;
  end_min integer;
begin
  if entry is null or pg_catalog.jsonb_typeof(entry)<>'object' then
    return null;
  end if;
  if pg_catalog.lower(coalesce(entry->>'attendanceStatus','present'))='absent' then
    return null;
  end if;
  start_text:=coalesce(entry->>'start','');
  end_text:=coalesce(entry->>'end','');
  if start_text !~ '^[0-9]{1,2}:[0-5][0-9]$' or end_text !~ '^[0-9]{1,2}:[0-5][0-9]$' then
    return null;
  end if;
  start_min:=pg_catalog.split_part(start_text,':',1)::integer*60+pg_catalog.split_part(start_text,':',2)::integer;
  end_min:=pg_catalog.split_part(end_text,':',1)::integer*60+pg_catalog.split_part(end_text,':',2)::integer;
  if start_min>=1440 or end_min>=1440 or start_min=end_min then
    return null;
  end if;
  if end_min<start_min then
    end_min:=end_min+1440;
  end if;
  -- int4range e [inicio, fim): 07:00-12:00 e 12:00-17:00 nao se sobrepoem
  return pg_catalog.int4range(start_min,end_min);
end;
$$;

revoke all on function clique_obras_private.rdo_entry_window_v4516(jsonb)
from public,anon,authenticated;

-- 2. Reserva do colaborador por data, agora por horario.
create or replace function clique_obras_private.validate_rdo_workforce_reservation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  work_date date;
  new_entry jsonb;
  new_window int4range;
  employee_id text;
  employee_name text;
  conflicting_rdo text;
  other_start text;
  other_end text;
  other_absent boolean;
  other_timed boolean;
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

  -- locks em ordem estavel (por colaborador) para evitar deadlock
  for new_entry in
    select entry
    from pg_catalog.jsonb_array_elements(coalesce(new.data->'entries','[]'::jsonb)) entry
    order by entry->>'employeeId'
  loop
    employee_id:=new_entry->>'employeeId';
    new_window:=clique_obras_private.rdo_entry_window_v4516(new_entry);

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        pg_catalog.concat_ws('|','cliqueobras-rdo',new.organization_id::text,work_date::text,employee_id),
        0
      )
    );

    select existing.record_id,
           coalesce(existing_entry->>'start',''),
           coalesce(existing_entry->>'end',''),
           pg_catalog.lower(coalesce(existing_entry->>'attendanceStatus',''))='absent',
           clique_obras_private.rdo_entry_window_v4516(existing_entry) is not null
      into conflicting_rdo, other_start, other_end, other_absent, other_timed
      from public.app_records existing
           cross join lateral pg_catalog.jsonb_array_elements(
             case when pg_catalog.jsonb_typeof(existing.data->'entries')='array'
               then existing.data->'entries' else '[]'::jsonb end
           ) existing_entry
     where existing.organization_id=new.organization_id
       and existing.store='rdos'
       and existing.record_id<>new.record_id
       and existing.data->>'date'=work_date::text
       and existing_entry->>'employeeId'=employee_id
       and (
         new_window is null
         or clique_obras_private.rdo_entry_window_v4516(existing_entry) is null
         or new_window && clique_obras_private.rdo_entry_window_v4516(existing_entry)
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
      employee_name:=coalesce(nullif(pg_catalog.btrim(new_entry->>'employeeName'),''),'selecionado');
      raise exception using
        errcode='23505',
        message=case
          when conflicting_rdo='__day_off__'
            then pg_catalog.format('O colaborador "%s" está de folga nesta data.',employee_name)
          when pg_catalog.lower(coalesce(new_entry->>'attendanceStatus',''))='absent'
            then pg_catalog.format('O colaborador "%s" já está registrado em outro RDO nesta data e não pode ter falta registrada neste.',employee_name)
          when other_absent
            then pg_catalog.format('O colaborador "%s" tem falta registrada em outro RDO nesta data.',employee_name)
          when other_timed and new_window is not null
            then pg_catalog.format('O colaborador "%s" já está em outro RDO das %s às %s nesta data. Para alocar em duas obras no mesmo dia, os horários não podem se sobrepor.',employee_name,other_start,other_end)
          else pg_catalog.format('O colaborador "%s" já está registrado em outro RDO nesta data. Para alocar em duas obras no mesmo dia, informe entrada e saída sem sobreposição nos dois diários.',employee_name)
        end;
    end if;
    conflicting_rdo:=null;
  end loop;
  return new;
end;
$$;

revoke all on function clique_obras_private.validate_rdo_workforce_reservation()
from public,anon,authenticated;

-- "zz_" de proposito: gatilhos BEFORE rodam em ordem alfabetica, e este precisa
-- rodar depois de clique_obras_set_app_record_org (que preenche organization_id).
drop trigger if exists zz_cliqueobras_validate_rdo_workforce
on public.app_records;
create trigger zz_cliqueobras_validate_rdo_workforce
before insert or update
on public.app_records
for each row
execute function clique_obras_private.validate_rdo_workforce_reservation();

comment on function clique_obras_private.validate_rdo_workforce_reservation()
is 'v4.5.16 - Impede o mesmo colaborador em RDOs diferentes da mesma organização e data quando os horários se sobrepõem, quando um dos lançamentos é falta ou não tem horário, ou quando há folga no dia.';

-- 3. Ocupacoes do dia com horario (organizacao inteira, sem expor o projeto).
create or replace function public.clique_obras_rdo_occupied_slots_v4516(
  p_organization_id uuid,
  p_date text,
  p_exclude_rdo_id text default null
)
returns table(employee_id text, situation text, start_time text, end_time text, regular_hours numeric)
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
  select nullif(btrim(coalesce(e->>'employeeId', '')), ''),
         case when lower(coalesce(e->>'attendanceStatus', '')) = 'absent'
              then 'Falta' else 'Outro RDO' end,
         coalesce(e->>'start', ''),
         coalesce(e->>'end', ''),
         case when coalesce(e->>'regular', '') ~ '^[0-9]+(\.[0-9]+)?$'
              then (e->>'regular')::numeric else 0::numeric end
    from public.app_records r
         cross join lateral jsonb_array_elements(
           case when jsonb_typeof(r.data->'entries') = 'array'
                then r.data->'entries' else '[]'::jsonb end) e
   where r.organization_id = p_organization_id
     and r.store = 'rdos'
     and left(coalesce(r.data->>'date', ''), 10) = v_date
     and (v_exclude is null or r.record_id <> v_exclude)
     and nullif(btrim(coalesce(e->>'employeeId', '')), '') is not null
  union all
  select nullif(btrim(coalesce(w.data->>'employeeId', '')), ''),
         'Folga'::text, ''::text, ''::text, 0::numeric
    from public.app_records w
   where w.organization_id = p_organization_id
     and w.store = 'workforce_status'
     and coalesce(w.data->>'status', '') = 'day_off'
     and left(coalesce(w.data->>'date', ''), 10) = v_date
     and nullif(btrim(coalesce(w.data->>'employeeId', '')), '') is not null;
end;
$function$;

revoke all on function public.clique_obras_rdo_occupied_slots_v4516(uuid,text,text)
from public,anon;
grant execute on function public.clique_obras_rdo_occupied_slots_v4516(uuid,text,text)
to authenticated;

comment on function public.clique_obras_rdo_occupied_slots_v4516(uuid,text,text)
is 'v4.5.16 - Ocupações do colaborador na data (outro RDO, falta, folga) com horário de entrada/saída e horas normais. Não devolve o projeto.';

commit;
