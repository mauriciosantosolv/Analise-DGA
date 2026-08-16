-- CliqueObras v3.0.8.3
-- Data/hora real de inclusão do Omie e configurações de jornada do RDO.
-- Execute após ATUALIZACAO-v3.0.7.3-OMIE-ADMIN-RLS.sql e
-- ATUALIZACAO-v3.0.8-OMIE-RDO.sql.

begin;

create or replace function clique_obras_private.validate_v3083_records()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  target public.app_records%rowtype;
  setting_value jsonb;
begin
  if tg_op='DELETE' then target:=old; else target:=new; end if;

  if target.store='settings'
    and target.record_id=any(array[
      'rdoSaturdayStart','rdoSaturdayEnd','rdoSaturdayBreakMinutes',
      'rdoSundayStart','rdoSundayEnd','rdoSundayBreakMinutes',
      'rdoNightStart','rdoNightPremiumPct'
    ]::text[])
    and not clique_obras_private.is_org_admin(target.organization_id) then
    raise exception 'Somente proprietário ou administrador pode alterar as configurações de jornada.';
  end if;

  if tg_op='DELETE' then return old; end if;

  if new.store='settings' then
    setting_value:=new.data->'value';
    if new.record_id=any(array[
      'rdoSaturdayStart','rdoSaturdayEnd','rdoSundayStart','rdoSundayEnd','rdoNightStart'
    ]::text[])
      and (jsonb_typeof(setting_value)<>'string'
        or setting_value#>>'{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      raise exception 'Horário de jornada inválido.';
    end if;
    if new.record_id=any(array['rdoSaturdayBreakMinutes','rdoSundayBreakMinutes']::text[])
      and (jsonb_typeof(setting_value)<>'number'
        or (setting_value#>>'{}')::numeric not between 0 and 360) then
      raise exception 'Intervalo de jornada inválido.';
    end if;
    if new.record_id='rdoNightPremiumPct'
      and (jsonb_typeof(setting_value)<>'number'
        or (setting_value#>>'{}')::numeric not between 0 and 300) then
      raise exception 'Percentual de adicional noturno inválido.';
    end if;
  end if;

  if new.store='rdos' then
    if new.data ? 'isHoliday' and jsonb_typeof(new.data->'isHoliday')<>'boolean' then
      raise exception 'Indicador de feriado inválido.';
    end if;
    if new.data ? 'dayType'
      and coalesce(new.data->>'dayType','') not in ('weekday','saturday','sunday','holiday') then
      raise exception 'Classificação do dia inválida.';
    end if;
    if new.data ? 'nightPremiumPct'
      and (jsonb_typeof(new.data->'nightPremiumPct')<>'number'
        or (new.data->>'nightPremiumPct')::numeric not between 0 and 300) then
      raise exception 'Percentual noturno do RDO inválido.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function clique_obras_private.validate_v3083_records()
  from public,anon,authenticated;

drop trigger if exists cliqueobras_validate_v3083_records on public.app_records;
create trigger cliqueobras_validate_v3083_records
before insert or update or delete on public.app_records
for each row execute function clique_obras_private.validate_v3083_records();

create or replace function public.clique_obras_apply_omie_entries_v3083(
  target_organization_id uuid,
  target_actor_id uuid,
  entries jsonb,
  target_sync_run_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  result jsonb;
  item jsonb;
  item_id text;
  purchase_id text;
begin
  if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>500 then
    raise exception 'invalid entries';
  end if;

  perform set_config('clique_obras.omie_write_org',target_organization_id::text,true);
  result:=public.clique_obras_apply_omie_entries(
    target_organization_id,target_actor_id,entries,target_sync_run_id
  );

  for item in select value from jsonb_array_elements(entries) loop
    item_id:=left(coalesce(item->>'externalItemId',''),180);
    if item_id='' or coalesce(item->>'externalSource','')<>'omie' then
      raise exception 'invalid entry identity';
    end if;
    purchase_id:='omie-ap-'||encode(
      extensions.digest(convert_to(item_id,'UTF8'),'sha256'),'hex'
    );
    update public.app_records
    set data=data||jsonb_build_object(
      'date',coalesce(item->>'omieInclusionDate',item->>'date',''),
      'omieInclusionDate',coalesce(item->>'omieInclusionDate',''),
      'omieInclusionTime',coalesce(item->>'omieInclusionTime',''),
      'omieInclusionDateTime',coalesce(item->>'omieInclusionDateTime',''),
      'dueDate',coalesce(item->>'dueDate',''),
      'forecastDate',coalesce(item->>'forecastDate','')
    ),updated_at=now()
    where organization_id=target_organization_id
      and store='purchases'
      and record_id=purchase_id
      and data->>'externalSource'='omie'
      and data->>'externalItemId'=item_id;
  end loop;

  return result;
end;
$$;

revoke all on function public.clique_obras_apply_omie_entries_v3083(uuid,uuid,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.clique_obras_apply_omie_entries_v3083(uuid,uuid,jsonb,uuid)
  to service_role;

comment on function public.clique_obras_apply_omie_entries_v3083(uuid,uuid,jsonb,uuid)
is 'Aplica contas a pagar preservando dInc/hInc, vencimento e previsão em campos independentes.';

notify pgrst,'reload schema';

commit;
