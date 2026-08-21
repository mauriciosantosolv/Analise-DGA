-- CliqueObras v4.2.0 — sincronização de contas a receber do Omie.
--
-- JÁ APLICADO em produção em 21/08/2026. Arquivo versionado para o GitHub.
--
-- D4: o projeto é identificado pelo `codigo_projeto` do título, o MESMO campo
--     que as contas a pagar já usam. Confirmado consultando a API real: todos
--     os títulos com projeto trazem codigo_projeto preenchido. Nenhuma tabela
--     de mapeamento nova foi necessária.
-- D6: roda no mesmo agendamento e na mesma execução do contas a pagar.
--
-- O recebimento importado NUNCA é aplicado sozinho: entra no extrato sem
-- medição vinculada e aguarda confirmação manual, conforme o item 5.

begin;

-- ---------------------------------------------------------------------------
-- 1. O validador da v4.1.0 aceita o recebimento cujo valor ainda depende de
--    conferência. A API do Omie não expõe o valor baixado em recebimento
--    parcial, então esse título entra com zero e o usuário informa o valor
--    ao conciliar. Nenhum número é inventado.
-- ---------------------------------------------------------------------------
create or replace function clique_obras_private.validate_cashflow_records_v410()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  amount numeric;
  awaiting_amount boolean;
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

  awaiting_amount:=new.store='measurement_receipts'
    and coalesce(new.data->>'origin','manual')='omie'
    and coalesce(new.data->>'pendingAmount','false')='true';

  if coalesce(new.data->>'value','') !~ '^-?[0-9]+([.][0-9]+)?$' then
    raise exception 'Informe um valor numérico.';
  end if;
  amount:=(new.data->>'value')::numeric;
  if amount>1000000000000 or amount<0 then
    raise exception 'Valor fora do limite permitido.';
  end if;
  if amount=0 and not awaiting_amount then
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
    if awaiting_amount and coalesce(new.data->>'measurementId','')<>'' then
      raise exception 'Informe o valor recebido antes de vincular à medição.';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A integração passa a poder gravar recebimentos do Omie.
--    A permissão continua estritamente delimitada: somente o service_role,
--    somente dentro da organização travada em clique_obras.omie_write_org, e
--    somente registros marcados como origem Omie.
-- ---------------------------------------------------------------------------
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
      or (tg_op='INSERT' and new.store='measurement_receipts' and new.data->>'origin'='omie')
      or (
        tg_op='UPDATE'
        and new.organization_id=old.organization_id
        and new.store=old.store
        and new.record_id=old.record_id
        and (
          new.store='planning'
          or (new.store='purchases' and new.data->>'externalSource'='omie')
          or (new.store='measurement_receipts'
              and new.data->>'origin'='omie'
              and old.data->>'origin'='omie')
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

-- ---------------------------------------------------------------------------
-- 3. Aplicação dos títulos recebidos. Idempotente por título e, uma vez que o
--    usuário decidiu (conciliou, conferiu ou retirou da fila), a sincronização
--    nunca mais sobrescreve aquele lançamento.
-- ---------------------------------------------------------------------------
create or replace function public.clique_obras_apply_omie_receivables_v420(
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
  item jsonb;
  existing jsonb;
  receipt_id text;
  external_id text;
  project_id text;
  amount numeric;
  pending boolean;
  actor uuid;
  imported integer:=0;
  updated integer:=0;
  untouched integer:=0;
  skipped integer:=0;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'access denied';
  end if;
  if pg_catalog.jsonb_typeof(entries)<>'array'
    or pg_catalog.jsonb_array_length(entries)>500 then
    raise exception 'invalid entries';
  end if;
  if not exists (
    select 1 from public.omie_connections
    where organization_id=target_organization_id and active=true
  ) then
    raise exception 'connection required';
  end if;

  select member.user_id into actor
  from public.organization_members member
  where member.organization_id=target_organization_id
  order by case when member.user_id=target_actor_id then 0
                when member.role='owner' then 1 else 2 end,
    member.joined_at
  limit 1;
  if actor is null then raise exception 'organization actor required'; end if;

  perform pg_catalog.set_config('clique_obras.omie_write_org',target_organization_id::text,true);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text||':omie-cr',0)
  );

  for item in select value from pg_catalog.jsonb_array_elements(entries) loop
    external_id:=pg_catalog.left(coalesce(item->>'externalId',''),100);
    project_id:=pg_catalog.left(coalesce(item->>'projectId',''),180);
    if external_id='' or project_id='' then
      skipped:=skipped+1; continue;
    end if;
    if not exists (
      select 1 from public.app_records project
      where project.organization_id=target_organization_id
        and project.store='projects'
        and project.record_id=project_id
    ) then
      skipped:=skipped+1; continue;
    end if;

    pending:=coalesce(item->>'pendingAmount','false')='true';
    amount:=pg_catalog.round(pg_catalog.abs(coalesce((item->>'value')::numeric,0)),2);
    if not pending and amount<=0 then
      skipped:=skipped+1; continue;
    end if;

    receipt_id:='omie-cr-'||pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(external_id,'UTF8'),'sha256'),'hex'
    );

    select record.data into existing
    from public.app_records record
    where record.organization_id=target_organization_id
      and record.store='measurement_receipts'
      and record.record_id=receipt_id
    for update;

    if existing is not null then
      -- A decisão do usuário é soberana sobre o Omie.
      if coalesce(existing->>'measurementId','')<>''
        or coalesce(existing->>'dismissed','false')='true'
        or (
          coalesce(existing->>'pendingAmount','false')='false'
          and coalesce(existing->>'reviewedByUser','false')='true'
        ) then
        untouched:=untouched+1; continue;
      end if;
      update public.app_records
      set data=existing||pg_catalog.jsonb_build_object(
          'value',amount,
          'date',item->>'date',
          'pendingAmount',pending,
          'omieStatus',pg_catalog.left(coalesce(item->>'status',''),40),
          'documentNumber',pg_catalog.left(coalesce(item->>'documentNumber',''),100),
          'customerName',pg_catalog.left(coalesce(item->>'customerName',''),180),
          'notes',pg_catalog.left(coalesce(item->>'notes',''),500),
          'syncedAt',pg_catalog.now(),
          'syncRunId',target_sync_run_id
        ),
        user_id=actor,
        updated_at=pg_catalog.now()
      where organization_id=target_organization_id
        and store='measurement_receipts'
        and record_id=receipt_id;
      updated:=updated+1;
    else
      insert into public.app_records(organization_id,user_id,store,record_id,data,updated_at)
      values(
        target_organization_id,actor,'measurement_receipts',receipt_id,
        pg_catalog.jsonb_build_object(
          'id',receipt_id,
          'projectId',project_id,
          'measurementId','',
          'value',amount,
          'date',item->>'date',
          'settles',false,
          'origin','omie',
          'pendingAmount',pending,
          'reviewedByUser',false,
          'dismissed',false,
          'externalId',external_id,
          'omieProjectCode',pg_catalog.left(coalesce(item->>'omieProjectCode',''),60),
          'omieStatus',pg_catalog.left(coalesce(item->>'status',''),40),
          'documentNumber',pg_catalog.left(coalesce(item->>'documentNumber',''),100),
          'customerName',pg_catalog.left(coalesce(item->>'customerName',''),180),
          'notes',pg_catalog.left(coalesce(item->>'notes',''),500),
          'importedAt',pg_catalog.floor(extract(epoch from pg_catalog.now())*1000)::bigint,
          'syncedAt',pg_catalog.now(),
          'syncRunId',target_sync_run_id
        ),
        pg_catalog.now()
      );
      imported:=imported+1;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'imported',imported,'updated',updated,'untouched',untouched,'skipped',skipped
  );
end;
$$;

revoke all on function public.clique_obras_apply_omie_receivables_v420(uuid,uuid,jsonb,uuid)
from public,anon,authenticated;
grant execute on function public.clique_obras_apply_omie_receivables_v420(uuid,uuid,jsonb,uuid)
to service_role;

create index if not exists app_records_receipts_pending_idx
on public.app_records (organization_id, ((data->>'origin')), ((data->>'measurementId')))
where store='measurement_receipts';

comment on function public.clique_obras_apply_omie_receivables_v420(uuid,uuid,jsonb,uuid)
is 'Importa contas a receber do Omie para o extrato, sempre sem medição vinculada. A conciliação é manual e uma vez feita nunca é sobrescrita.';

notify pgrst,'reload schema';

commit;
