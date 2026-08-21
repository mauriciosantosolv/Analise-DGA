-- CliqueObras v4.1.0 — Fluxo de caixa por medições.
--
-- JÁ APLICADO no Supabase de produção em 21/08/2026
-- (migration `v410_previsoes_e_recebimentos_de_medicao`).
-- Este arquivo existe para ficar versionado no GitHub. Não precisa executar.
--
-- Duas entidades novas, ambas em stores próprios. Nenhuma tabela, política ou
-- gatilho existente muda de comportamento:
--   forecasts             — previsões de faturamento e recebimento por projeto
--   measurement_receipts  — extrato de recebimentos, um lançamento por entrada
--
-- Decisão de arquitetura (D5): o registro da medição NUNCA é alterado por este
-- módulo. A situação de recebimento é calculada a partir do extrato. É isso que
-- mantém intactas a trava de integridade da medição HH ("Os RDOs, vínculos e
-- valores da medição HH não conferem") e a exigência de administrador para
-- gravar uma medição HH.

begin;

-- ---------------------------------------------------------------------------
-- 1. Stores novos aceitos pelo app_records
-- ---------------------------------------------------------------------------
alter table public.app_records
  drop constraint if exists app_records_store_check;

alter table public.app_records
  add constraint app_records_store_check
  check (store=any(array[
    'projects','budgets','purchases','planning','planning_history','clients',
    'categories','settings','measurements','rdos','crew','labor_rates',
    'rdo_financial','workforce_status','forecasts','measurement_receipts'
  ]::text[]));

-- ---------------------------------------------------------------------------
-- 2. Permissões: quem enxerga e edita medições enxerga e edita previsões e
--    recebimentos. Mesmo padrão já usado para planning_history -> planning.
-- ---------------------------------------------------------------------------
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
              when target_store='forecasts' then 'measurements'
              when target_store='measurement_receipts' then 'measurements'
              else target_store
            end
        )
    );
$$;

create or replace function clique_obras_private.can_edit_store(
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
          or coalesce(member.permissions->'edit','[]'::jsonb) ?
            case
              when target_store='planning_history' then 'planning'
              when target_store='forecasts' then 'measurements'
              when target_store='measurement_receipts' then 'measurements'
              else target_store
            end
        )
    );
$$;

-- ---------------------------------------------------------------------------
-- 3. Validação mínima dos registros novos.
--    O gatilho age somente sobre os dois stores criados agora — nenhum fluxo
--    existente passa por ele. A regra de teto da receita é validada na
--    interface, para não engessar correções futuras.
-- ---------------------------------------------------------------------------
create or replace function clique_obras_private.validate_cashflow_records_v410()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  amount numeric;
begin
  if coalesce(new.data->>'id','')<>new.record_id then
    raise exception 'O identificador do registro é inválido.';
  end if;
  if coalesce(new.data->>'projectId','')='' then
    raise exception 'Informe o projeto.';
  end if;
  if not exists (
    select 1 from public.app_records project
    where project.organization_id=new.organization_id
      and project.store='projects'
      and project.record_id=new.data->>'projectId'
  ) then
    raise exception 'O projeto informado não existe nesta organização.';
  end if;

  if coalesce(new.data->>'value','') !~ '^-?[0-9]+([.][0-9]+)?$' then
    raise exception 'Informe um valor numérico.';
  end if;
  amount:=(new.data->>'value')::numeric;
  if amount<=0 or amount>1000000000000 then
    raise exception 'O valor precisa ser maior que zero.';
  end if;

  if new.store='forecasts' then
    if coalesce(new.data->>'billingDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(new.data->>'receiptDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Informe a data prevista de faturamento.';
    end if;
    if (new.data->>'receiptDate')::date < (new.data->>'billingDate')::date then
      raise exception 'A data prevista de recebimento não pode ser anterior ao faturamento.';
    end if;
    if coalesce(new.data->>'paymentTermDays','') !~ '^[0-9]+$'
      or (new.data->>'paymentTermDays')::integer > 3650 then
      raise exception 'Condição de pagamento inválida.';
    end if;
  end if;

  if new.store='measurement_receipts' then
    if coalesce(new.data->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Informe a data do recebimento.';
    end if;
    -- measurementId vazio é permitido de propósito: é o recebimento que ainda
    -- aguarda vínculo manual com uma medição (previsto para a v4.2.0, Omie).
    if coalesce(new.data->>'measurementId','')<>'' and not exists (
      select 1 from public.app_records measurement
      where measurement.organization_id=new.organization_id
        and measurement.store='measurements'
        and measurement.record_id=new.data->>'measurementId'
        and measurement.data->>'projectId'=new.data->>'projectId'
    ) then
      raise exception 'A medição informada não pertence a este projeto.';
    end if;
    if coalesce(new.data->>'origin','manual') not in ('manual','omie') then
      raise exception 'Origem do recebimento inválida.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function clique_obras_private.validate_cashflow_records_v410()
from public,anon,authenticated;

drop trigger if exists cliqueobras_validate_cashflow_v410 on public.app_records;
create trigger cliqueobras_validate_cashflow_v410
before insert or update on public.app_records
for each row
when (new.store in ('forecasts','measurement_receipts'))
execute function clique_obras_private.validate_cashflow_records_v410();

-- ---------------------------------------------------------------------------
-- 4. Índices de leitura
-- ---------------------------------------------------------------------------
create index if not exists app_records_forecasts_project_idx
on public.app_records (organization_id, ((data->>'projectId')), ((data->>'receiptDate')))
where store='forecasts';

create index if not exists app_records_receipts_measurement_idx
on public.app_records (organization_id, ((data->>'measurementId')))
where store='measurement_receipts';

create index if not exists app_records_receipts_project_date_idx
on public.app_records (organization_id, ((data->>'projectId')), ((data->>'date')))
where store='measurement_receipts';

comment on function clique_obras_private.validate_cashflow_records_v410()
is 'Valida previsões e recebimentos de medição. Não alcança nenhum store anterior à v4.1.0.';

notify pgrst,'reload schema';

commit;
