-- CliqueObras v3.0.3
-- Validação dos novos dados de colaboradores e proteção das configurações
-- compartilhadas de jornada e papel timbrado.
-- Migração idempotente e sem alteração dos registros existentes.

begin;

create or replace function clique_obras_private.validate_v303_records()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  target public.app_records%rowtype;
  setting_value jsonb;
  image_value text;
begin
  if tg_op='DELETE' then target := old; else target := new; end if;

  if target.store='settings'
    and target.record_id=any(array[
      'companyName','companyLogo','pdfLetterhead','rdoShiftStart','rdoShiftEnd',
      'rdoShiftBreakMinutes','rdoDailyHours'
    ]::text[])
    and not clique_obras_private.is_org_admin(target.organization_id) then
    raise exception 'Somente proprietário ou administrador pode alterar as configurações da empresa.';
  end if;

  if tg_op='DELETE' then return old; end if;

  if new.store='settings' then
    setting_value := new.data->'value';
    if new.record_id in ('rdoShiftStart','rdoShiftEnd')
      and (jsonb_typeof(setting_value)<>'string' or setting_value#>>'{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      raise exception 'Horário padrão inválido.';
    end if;
    if new.record_id='rdoShiftBreakMinutes'
      and (jsonb_typeof(setting_value)<>'number' or (setting_value#>>'{}')::numeric not between 0 and 360) then
      raise exception 'Intervalo padrão inválido.';
    end if;
    if new.record_id='rdoDailyHours'
      and (jsonb_typeof(setting_value)<>'number' or (setting_value#>>'{}')::numeric not between 0.25 and 24) then
      raise exception 'Limite diário de horas inválido.';
    end if;
    if new.record_id='pdfLetterhead' then
      image_value := coalesce(new.data->>'value','');
      if length(image_value)>2500000
        or (image_value<>'' and image_value !~* '^data:image/jpeg;base64,[a-z0-9+/=]+$') then
        raise exception 'Papel timbrado inválido ou acima do limite permitido.';
      end if;
    end if;
  end if;

  if new.store='crew' then
    if new.data->>'recordType'='role' then
      if length(trim(coalesce(new.data->>'name',''))) not between 1 and 120 then
        raise exception 'Nome da função inválido.';
      end if;
    else
      if length(trim(coalesce(new.data->>'name',''))) not between 1 and 140
        or length(coalesce(new.data->>'registration',''))>60 then
        raise exception 'Cadastro do colaborador inválido.';
      end if;
      image_value := coalesce(new.data->>'photo','');
      if length(image_value)>1000000
        or (image_value<>'' and image_value !~* '^data:image/(jpeg|png|webp);base64,[a-z0-9+/=]+$') then
        raise exception 'Foto do colaborador inválida ou acima do limite permitido.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function clique_obras_private.validate_v303_records()
  from public,anon,authenticated;

drop trigger if exists cliqueobras_validate_v303_records on public.app_records;
create trigger cliqueobras_validate_v303_records
before insert or update or delete on public.app_records
for each row execute function clique_obras_private.validate_v303_records();

notify pgrst, 'reload schema';

commit;
