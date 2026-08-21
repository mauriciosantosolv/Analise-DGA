-- CliqueObras v4.0.2
-- Mão de obra (equipe própria) passa a abater o planejamento automaticamente,
-- exatamente como já acontece com as contas a pagar sincronizadas do Omie.
--
-- O que esta atualização faz:
--   1. Cria as rotinas reutilizáveis de consumo e estorno do planejamento.
--   2. Aprovação de RDO passa a abater o planejado e a gravar histórico.
--   3. Exclusão de RDO estorna o planejamento para o valor anterior.
--   4. Importação de planilha de mão de obra abate pela mesma rotina.
--   5. Reparação opcional dos RDOs já aprovados antes desta versão.
--
-- Nenhuma lógica existente é alterada: a rotina do Omie, a reconciliação
-- manual de compras e o cálculo do realizado permanecem como estão.

begin;

-- ---------------------------------------------------------------------------
-- 0. Chave normalizada de categoria (espelha Biz.categoryKey da interface).
--    Sem isto, "Mão de Obra" gravado pelo RDO nunca encontraria o item
--    planejado cadastrado como "Mão de obra".
-- ---------------------------------------------------------------------------
create or replace function clique_obras_private.category_key_v402(source_value text)
returns text
language sql
immutable
set search_path=''
as $$
  select case
    when normalized ~ '^(compras? de (material|materiais))$' then 'compras de material'
    when normalized ~ '^(material|materiais)$' then 'compras de material'
    when normalized ~ '^(mao de obra|m o|mo)$' then 'mao de obra'
    when normalized ~ '^(custos? administrativos?|administrativo|administracao|adm)$' then 'custo administrativo'
    when normalized ~ '^impostos?$' then 'impostos'
    when normalized ~ '^(alimentacao|refeicao|refeicoes)$' then 'alimentacao'
    when normalized ~ '^(hospedagem|hotel|hoteis)$' then 'hospedagem'
    when normalized ~ '^(taxas?|comissoes?|taxas? e comissoes?)$' then 'taxas'
    when normalized ~ '^(outros encargos|outras despesas|outros custos)$' then 'outros encargos'
    else normalized
  end
  from (
    select pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          pg_catalog.translate(
            pg_catalog.lower(coalesce(source_value,'')),
            'áàâãäéèêëíìîïóòôõöúùûüçñ',
            'aaaaaeeeeiiiiooooouuuucn'
          ),
          '[^a-z0-9[:space:]]+',' ','g'
        ),
        '[[:space:]]+',' ','g'
      )
    ) as normalized
  ) as normalized_value;
$$;

revoke all on function clique_obras_private.category_key_v402(text)
from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 1. Consumo do planejamento (mesma regra FIFO usada pela integração Omie)
-- ---------------------------------------------------------------------------
create or replace function clique_obras_private.consume_planning_v402(
  target_organization_id uuid,
  target_actor_id uuid,
  target_project_id text,
  target_category text,
  target_amount numeric,
  target_source_id text,
  target_action text,
  target_source text,
  target_description text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  plan_row record;
  plan_data jsonb;
  plan_value numeric;
  consumed numeric;
  before_value numeric;
  after_value numeric;
  realized numeric;
  original numeric;
  requested numeric;
  remaining numeric;
  category_key text;
  offsets jsonb:='[]'::jsonb;
  history_id text;
begin
  requested:=pg_catalog.round(coalesce(target_amount,0),2);
  remaining:=requested;
  category_key:=clique_obras_private.category_key_v402(target_category);
  if remaining<=0
    or coalesce(target_project_id,'')=''
    or coalesce(category_key,'')='' then
    return pg_catalog.jsonb_build_object(
      'offsets',offsets,'applied',0::numeric,'unmatched',greatest(requested,0)
    );
  end if;

  -- Serializa o consumo por organização: duas aprovações simultâneas nunca
  -- podem abater o mesmo saldo planejado.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text||':planning',0)
  );

  for plan_row in
    select record.record_id, record.data
    from public.app_records record
    where record.organization_id=target_organization_id
      and record.store='planning'
      and record.data->>'projectId'=target_project_id
      and clique_obras_private.category_key_v402(record.data->>'category')=category_key
      and case
        when coalesce(record.data->>'value','') ~ '^-?[0-9]+([.][0-9]+)?$'
          then (record.data->>'value')::numeric
        else 0
      end > 0
    order by coalesce(record.data->>'date','9999-12-31'), record.record_id
    for update
  loop
    exit when remaining<=0;
    plan_data:=plan_row.data;
    plan_value:=pg_catalog.round(coalesce((plan_data->>'value')::numeric,0),2);
    consumed:=least(remaining,plan_value);
    before_value:=plan_value;
    after_value:=pg_catalog.round(plan_value-consumed,2);
    realized:=pg_catalog.round(coalesce((plan_data->>'realizedAmount')::numeric,0)+consumed,2);
    original:=case
      when coalesce(plan_data->>'originalValue','') ~ '^-?[0-9]+([.][0-9]+)?$'
        then greatest(0,(plan_data->>'originalValue')::numeric)
      else plan_value+coalesce((plan_data->>'realizedAmount')::numeric,0)
    end;

    update public.app_records
    set data=plan_data||pg_catalog.jsonb_build_object(
        'value',after_value,
        'originalValue',original,
        'realizedAmount',realized,
        'consumptionStatus',case when after_value<=0 then 'consumed' else 'partial' end,
        'lastOffsetAt',pg_catalog.now()
      ),
      user_id=target_actor_id,
      updated_at=pg_catalog.now()
    where organization_id=target_organization_id
      and store='planning'
      and record_id=plan_row.record_id;

    offsets:=offsets||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('planningId',plan_row.record_id,'amount',consumed)
    );

    history_id:=pg_catalog.gen_random_uuid()::text;
    insert into public.app_records(organization_id,user_id,store,record_id,data)
    values(
      target_organization_id,target_actor_id,'planning_history',history_id,
      pg_catalog.jsonb_build_object(
        'id',history_id,
        'planningId',plan_row.record_id,
        'projectId',target_project_id,
        'category',plan_data->>'category',
        'action',target_action,
        'source',target_source,
        'sourceId',target_source_id,
        'amount',consumed,
        'beforeValue',before_value,
        'afterValue',after_value,
        'description',target_description,
        'occurredAt',pg_catalog.now()
      )
    );

    remaining:=pg_catalog.round(remaining-consumed,2);
  end loop;

  return pg_catalog.jsonb_build_object(
    'offsets',offsets,
    'applied',pg_catalog.round(requested-remaining,2),
    'unmatched',remaining
  );
end;
$$;

revoke all on function clique_obras_private.consume_planning_v402(uuid,uuid,text,text,numeric,text,text,text,text)
from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 2. Estorno do planejamento (devolve o saldo exatamente como estava)
-- ---------------------------------------------------------------------------
create or replace function clique_obras_private.restore_planning_v402(
  target_organization_id uuid,
  target_actor_id uuid,
  target_offsets jsonb,
  target_source_id text,
  target_action text,
  target_source text,
  target_description text
)
returns numeric
language plpgsql
security definer
set search_path=''
as $$
declare
  offset_item jsonb;
  plan_data jsonb;
  planning_id text;
  consumed numeric;
  before_value numeric;
  after_value numeric;
  realized numeric;
  restored_total numeric:=0;
  history_id text;
begin
  if pg_catalog.jsonb_typeof(target_offsets)<>'array'
    or pg_catalog.jsonb_array_length(target_offsets)=0 then
    return 0;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text||':planning',0)
  );

  for offset_item in select value from pg_catalog.jsonb_array_elements(target_offsets) loop
    planning_id:=coalesce(offset_item->>'planningId','');
    consumed:=pg_catalog.round(coalesce((offset_item->>'amount')::numeric,0),2);
    if planning_id='' or consumed<=0 then continue; end if;

    select record.data into plan_data
    from public.app_records record
    where record.organization_id=target_organization_id
      and record.store='planning'
      and record.record_id=planning_id
    for update;
    -- Item planejado excluído depois do abatimento: nada a restaurar.
    if plan_data is null then continue; end if;

    before_value:=pg_catalog.round(coalesce((plan_data->>'value')::numeric,0),2);
    after_value:=pg_catalog.round(before_value+consumed,2);
    realized:=greatest(0,pg_catalog.round(coalesce((plan_data->>'realizedAmount')::numeric,0)-consumed,2));

    update public.app_records
    set data=plan_data||pg_catalog.jsonb_build_object(
        'value',after_value,
        'realizedAmount',realized,
        'consumptionStatus',case when realized>0 then 'partial' else 'pending' end,
        'lastOffsetAt',pg_catalog.now()
      ),
      user_id=target_actor_id,
      updated_at=pg_catalog.now()
    where organization_id=target_organization_id
      and store='planning'
      and record_id=planning_id;

    history_id:=pg_catalog.gen_random_uuid()::text;
    insert into public.app_records(organization_id,user_id,store,record_id,data)
    values(
      target_organization_id,target_actor_id,'planning_history',history_id,
      pg_catalog.jsonb_build_object(
        'id',history_id,
        'planningId',planning_id,
        'projectId',plan_data->>'projectId',
        'category',plan_data->>'category',
        'action',target_action,
        'source',target_source,
        'sourceId',target_source_id,
        'amount',consumed,
        'beforeValue',before_value,
        'afterValue',after_value,
        'description',target_description,
        'occurredAt',pg_catalog.now()
      )
    );

    restored_total:=pg_catalog.round(restored_total+consumed,2);
  end loop;

  return restored_total;
end;
$$;

revoke all on function clique_obras_private.restore_planning_v402(uuid,uuid,jsonb,text,text,text,text)
from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 3. Aprovação de RDO com abatimento automático do planejamento
--    Reaproveita integralmente a aprovação atômica da v4.0.1 e apenas
--    acrescenta o abatimento, preservando o valor do custo realizado.
-- ---------------------------------------------------------------------------
create or replace function public.clique_obras_approve_rdo_v402(
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
  approval jsonb;
  purchase_id text;
  purchase_data jsonb;
  project_id text;
  category_name text;
  cost_total numeric;
  offset_result jsonb;
  applied numeric;
  unmatched numeric;
begin
  if actor is null
    or clique_obras_private.is_org_admin(target_organization_id) is distinct from true then
    raise exception 'Somente proprietário ou administrador pode aprovar o RDO.';
  end if;

  approval:=public.clique_obras_approve_rdo_v401(
    target_organization_id,target_rdo_id,target_financial
  );

  -- RDO já aprovado anteriormente não é abatido de novo pela aprovação.
  if coalesce((approval->>'alreadyApproved')::boolean,false) then
    return approval;
  end if;

  purchase_id:='rdo-cost-'||target_rdo_id;
  select record.data into purchase_data
  from public.app_records record
  where record.organization_id=target_organization_id
    and record.store='purchases'
    and record.record_id=purchase_id
  for update;
  if purchase_data is null then
    return approval;
  end if;

  -- Idempotência: nunca abate duas vezes o mesmo custo de RDO.
  if pg_catalog.jsonb_typeof(purchase_data->'planningOffsets')='array'
    and pg_catalog.jsonb_array_length(purchase_data->'planningOffsets')>0 then
    return approval;
  end if;

  project_id:=purchase_data->>'projectId';
  category_name:=coalesce(purchase_data->>'category','Mão de Obra');
  cost_total:=pg_catalog.round(coalesce((purchase_data->>'value')::numeric,0),2);

  offset_result:=clique_obras_private.consume_planning_v402(
    target_organization_id,actor,project_id,category_name,cost_total,
    target_rdo_id,'rdo_consumed','rdo',
    'Custo de mão de obra do RDO abatido do planejamento'
  );
  applied:=coalesce((offset_result->>'applied')::numeric,0);
  unmatched:=coalesce((offset_result->>'unmatched')::numeric,cost_total);

  -- Somente campos informativos do abatimento são gravados. O valor do custo
  -- realizado permanece intacto para não violar a validação de aprovação.
  update public.app_records
  set data=purchase_data||pg_catalog.jsonb_build_object(
      'planningOffsets',coalesce(offset_result->'offsets','[]'::jsonb),
      'planningOffsetAmount',applied,
      'planningUnmatchedAmount',unmatched,
      'abatido',applied>0,
      'planningOffsetAt',pg_catalog.now()
    ),
    updated_at=pg_catalog.now()
  where organization_id=target_organization_id
    and store='purchases'
    and record_id=purchase_id;

  return approval||pg_catalog.jsonb_build_object(
    'planningOffsetAmount',applied,
    'planningUnmatchedAmount',unmatched
  );
end;
$$;

revoke all on function public.clique_obras_approve_rdo_v402(uuid,text,jsonb)
from public,anon;
grant execute on function public.clique_obras_approve_rdo_v402(uuid,text,jsonb)
to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Exclusão de RDO devolve o planejamento ao valor anterior
--    Recriação da rotina da v3.0.1 acrescentando apenas o estorno.
-- ---------------------------------------------------------------------------
create or replace function clique_obras_private.delete_rdo(
  target_organization_id uuid,
  target_rdo_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  rdo_data jsonb;
  object_paths jsonb := '[]'::jsonb;
  attachment_count integer := 0;
  purchase_count integer := 0;
  purchase_row record;
  restored_total numeric := 0;
begin
  if actor is null
    or not clique_obras_private.is_org_admin(target_organization_id) then
    raise exception 'Somente proprietário ou administrador pode excluir RDO aprovado.';
  end if;
  if coalesce(length(trim(target_rdo_id)),0)=0 then
    raise exception 'RDO inválido.';
  end if;

  select record.data into rdo_data
  from public.app_records record
  where record.organization_id=target_organization_id
    and record.store='rdos'
    and record.record_id=target_rdo_id
  for update;

  if rdo_data is null then raise exception 'RDO não encontrado.'; end if;
  if exists (
    select 1 from public.rdo_measurement_links link
    where link.organization_id=target_organization_id
      and link.rdo_id=target_rdo_id
  ) then
    raise exception 'O RDO pertence a uma medição. Exclua primeiro a medição correspondente.';
  end if;

  perform set_config('clique_obras.admin_rdo_delete',target_rdo_id,true);

  select coalesce(jsonb_agg(to_jsonb(attachment.object_path) order by attachment.object_path),'[]'::jsonb)
    into object_paths
  from public.rdo_attachments attachment
  where attachment.organization_id=target_organization_id
    and attachment.rdo_id=target_rdo_id;

  delete from public.rdo_attachments attachment
  where attachment.organization_id=target_organization_id
    and attachment.rdo_id=target_rdo_id;
  get diagnostics attachment_count=row_count;

  -- Antes de remover o custo realizado, devolve ao planejamento tudo o que
  -- este RDO havia abatido. Sem isso, o saldo projetado ficaria consumido
  -- por um lançamento que deixou de existir.
  for purchase_row in
    select record.record_id, record.data
    from public.app_records record
    where record.organization_id=target_organization_id
      and record.store='purchases'
      and record.data->>'sourceRdoId'=target_rdo_id
  loop
    restored_total:=restored_total+clique_obras_private.restore_planning_v402(
      target_organization_id,actor,
      coalesce(purchase_row.data->'planningOffsets','[]'::jsonb),
      target_rdo_id,'rdo_restored','rdo',
      'Planejamento restaurado após exclusão do RDO'
    );
  end loop;

  delete from public.app_records purchase
  where purchase.organization_id=target_organization_id
    and purchase.store='purchases'
    and purchase.data->>'sourceRdoId'=target_rdo_id;
  get diagnostics purchase_count=row_count;

  delete from public.rdo_cost_postings posting
  where posting.organization_id=target_organization_id
    and posting.rdo_id=target_rdo_id;

  delete from public.app_records financial
  where financial.organization_id=target_organization_id
    and financial.store='rdo_financial'
    and financial.record_id=target_rdo_id;

  delete from public.app_records report
  where report.organization_id=target_organization_id
    and report.store='rdos'
    and report.record_id=target_rdo_id;

  return jsonb_build_object(
    'rdo_id',target_rdo_id,
    'attachments_deleted',attachment_count,
    'cost_entries_reversed',purchase_count,
    'planning_restored',restored_total,
    'object_paths',object_paths
  );
end;
$$;

revoke all on function clique_obras_private.delete_rdo(uuid,text)
  from public,anon;
grant execute on function clique_obras_private.delete_rdo(uuid,text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Importação de planilha de mão de obra: mesmo abatimento automático
-- ---------------------------------------------------------------------------
create or replace function public.clique_obras_offset_labor_planning_v402(
  target_organization_id uuid,
  target_record_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  purchase_row record;
  purchase_data jsonb;
  offset_result jsonb;
  applied numeric;
  unmatched numeric;
  cost_total numeric;
  offset_count integer:=0;
  total_applied numeric:=0;
  total_unmatched numeric:=0;
begin
  if actor is null
    or clique_obras_private.can_edit_store(target_organization_id,'planning') is distinct from true
    or clique_obras_private.can_edit_store(target_organization_id,'purchases') is distinct from true then
    raise exception 'Seu usuário não possui permissão para abater o planejamento.';
  end if;
  if target_record_ids is null or pg_catalog.array_length(target_record_ids,1) is null then
    return pg_catalog.jsonb_build_object('offsetCount',0,'applied',0,'unmatched',0);
  end if;
  if pg_catalog.array_length(target_record_ids,1)>2000 then
    raise exception 'Quantidade de lançamentos acima do limite seguro.';
  end if;

  for purchase_row in
    select record.record_id, record.data
    from public.app_records record
    where record.organization_id=target_organization_id
      and record.store='purchases'
      and record.record_id=any(target_record_ids)
      and record.data->>'sourceType'='labor'
      and coalesce(record.data->>'externalSource','')<>'omie'
    order by coalesce(record.data->>'date','9999-12-31'), record.record_id
    for update
  loop
    purchase_data:=purchase_row.data;

    -- Nunca abate duas vezes o mesmo lançamento, nem o que já foi conciliado
    -- manualmente pela tela de compras.
    if (pg_catalog.jsonb_typeof(purchase_data->'planningOffsets')='array'
        and pg_catalog.jsonb_array_length(purchase_data->'planningOffsets')>0)
      or pg_catalog.jsonb_typeof(purchase_data->'planningOffset')='object' then
      continue;
    end if;

    cost_total:=pg_catalog.round(coalesce((purchase_data->>'value')::numeric,0),2);
    if cost_total<=0 then continue; end if;

    offset_result:=clique_obras_private.consume_planning_v402(
      target_organization_id,actor,
      purchase_data->>'projectId',
      coalesce(purchase_data->>'category','Mão de Obra'),
      cost_total,purchase_row.record_id,'labor_consumed','labor',
      'Mão de obra importada abatida do planejamento'
    );
    applied:=coalesce((offset_result->>'applied')::numeric,0);
    unmatched:=coalesce((offset_result->>'unmatched')::numeric,cost_total);
    if applied<=0 then
      total_unmatched:=total_unmatched+unmatched;
      continue;
    end if;

    update public.app_records
    set data=purchase_data||pg_catalog.jsonb_build_object(
        'planningOffsets',coalesce(offset_result->'offsets','[]'::jsonb),
        'planningOffsetAmount',applied,
        'planningUnmatchedAmount',unmatched,
        'abatido',true,
        'planningOffsetAt',pg_catalog.now()
      ),
      user_id=actor,
      updated_at=pg_catalog.now()
    where organization_id=target_organization_id
      and store='purchases'
      and record_id=purchase_row.record_id;

    offset_count:=offset_count+1;
    total_applied:=total_applied+applied;
    total_unmatched:=total_unmatched+unmatched;
  end loop;

  return pg_catalog.jsonb_build_object(
    'offsetCount',offset_count,
    'applied',pg_catalog.round(total_applied,2),
    'unmatched',pg_catalog.round(total_unmatched,2)
  );
end;
$$;

revoke all on function public.clique_obras_offset_labor_planning_v402(uuid,text[])
from public,anon;
grant execute on function public.clique_obras_offset_labor_planning_v402(uuid,text[])
to authenticated;

-- Estorno do lançamento de mão de obra importado, quando o usuário exclui o
-- lançamento ou o bloco de importação.
create or replace function public.clique_obras_restore_labor_planning_v402(
  target_organization_id uuid,
  target_record_id text
)
returns numeric
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  purchase_data jsonb;
begin
  if actor is null
    or clique_obras_private.can_edit_store(target_organization_id,'planning') is distinct from true then
    raise exception 'Seu usuário não possui permissão para restaurar o planejamento.';
  end if;

  select record.data into purchase_data
  from public.app_records record
  where record.organization_id=target_organization_id
    and record.store='purchases'
    and record.record_id=target_record_id
  for update;
  if purchase_data is null then return 0; end if;
  if coalesce(purchase_data->>'sourceType','')<>'labor' then return 0; end if;

  return clique_obras_private.restore_planning_v402(
    target_organization_id,actor,
    coalesce(purchase_data->'planningOffsets','[]'::jsonb),
    target_record_id,'labor_restored','labor',
    'Planejamento restaurado após exclusão do custo de mão de obra'
  );
end;
$$;

revoke all on function public.clique_obras_restore_labor_planning_v402(uuid,text)
from public,anon;
grant execute on function public.clique_obras_restore_labor_planning_v402(uuid,text)
to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Reparação opcional: RDOs aprovados antes da v4.0.2 nunca abateram o
--    planejamento. Esta rotina aplica o abatimento retroativo uma única vez
--    por lançamento e só roda quando o administrador solicita.
-- ---------------------------------------------------------------------------
create or replace function public.clique_obras_repair_rdo_planning_v402(
  target_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  purchase_row record;
  purchase_data jsonb;
  offset_result jsonb;
  applied numeric;
  unmatched numeric;
  cost_total numeric;
  repaired integer:=0;
  total_applied numeric:=0;
  total_unmatched numeric:=0;
begin
  if actor is null
    or clique_obras_private.is_org_admin(target_organization_id) is distinct from true then
    raise exception 'Somente proprietário ou administrador pode reparar o abatimento de mão de obra.';
  end if;

  for purchase_row in
    select record.record_id, record.data
    from public.app_records record
    where record.organization_id=target_organization_id
      and record.store='purchases'
      and coalesce(record.data->>'sourceRdoId','')<>''
      and coalesce(record.data->>'externalSource','')<>'omie'
      and exists (
        select 1
        from public.app_records report
        where report.organization_id=record.organization_id
          and report.store='rdos'
          and report.record_id=record.data->>'sourceRdoId'
          and report.data->>'status'='Aprovado'
      )
    order by coalesce(record.data->>'date','9999-12-31'), record.record_id
    for update
  loop
    purchase_data:=purchase_row.data;
    if pg_catalog.jsonb_typeof(purchase_data->'planningOffsets')='array'
      and pg_catalog.jsonb_array_length(purchase_data->'planningOffsets')>0 then
      continue;
    end if;

    cost_total:=pg_catalog.round(coalesce((purchase_data->>'value')::numeric,0),2);
    if cost_total<=0 then continue; end if;

    offset_result:=clique_obras_private.consume_planning_v402(
      target_organization_id,actor,
      purchase_data->>'projectId',
      coalesce(purchase_data->>'category','Mão de Obra'),
      cost_total,purchase_data->>'sourceRdoId','rdo_consumed','rdo',
      'Custo de mão de obra do RDO abatido do planejamento (reparação v4.0.2)'
    );
    applied:=coalesce((offset_result->>'applied')::numeric,0);
    unmatched:=coalesce((offset_result->>'unmatched')::numeric,cost_total);
    total_unmatched:=total_unmatched+unmatched;
    if applied<=0 then continue; end if;

    update public.app_records
    set data=purchase_data||pg_catalog.jsonb_build_object(
        'planningOffsets',coalesce(offset_result->'offsets','[]'::jsonb),
        'planningOffsetAmount',applied,
        'planningUnmatchedAmount',unmatched,
        'abatido',true,
        'planningOffsetAt',pg_catalog.now(),
        'planningRepairedByVersion','4.0.2'
      ),
      updated_at=pg_catalog.now()
    where organization_id=target_organization_id
      and store='purchases'
      and record_id=purchase_row.record_id;

    repaired:=repaired+1;
    total_applied:=total_applied+applied;
  end loop;

  return pg_catalog.jsonb_build_object(
    'repaired',repaired,
    'applied',pg_catalog.round(total_applied,2),
    'unmatched',pg_catalog.round(total_unmatched,2)
  );
end;
$$;

revoke all on function public.clique_obras_repair_rdo_planning_v402(uuid)
from public,anon;
grant execute on function public.clique_obras_repair_rdo_planning_v402(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Correções de segurança e integridade desta versão
-- ---------------------------------------------------------------------------

-- 7.1 Item de planejamento com consumo registrado não pode ser excluído.
-- A regra já existia na interface; agora é garantida também no banco, de modo
-- que a exclusão direta pela API não descarta o histórico financeiro.
create or replace function clique_obras_private.protect_consumed_planning_v402()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if coalesce(
      case
        when coalesce(old.data->>'realizedAmount','') ~ '^-?[0-9]+([.][0-9]+)?$'
          then (old.data->>'realizedAmount')::numeric
        else 0
      end,0)>0 then
    raise exception 'Este item de planejamento possui consumo registrado e não pode ser excluído. Ajuste o saldo mantendo o histórico.';
  end if;
  return old;
end;
$$;

revoke all on function clique_obras_private.protect_consumed_planning_v402()
from public,anon,authenticated;

drop trigger if exists cliqueobras_protect_consumed_planning on public.app_records;
create trigger cliqueobras_protect_consumed_planning
before delete on public.app_records
for each row
when (old.store='planning')
execute function clique_obras_private.protect_consumed_planning_v402();

-- 7.2 O histórico do planejamento é um registro contábil: pode ser lido e
-- criado, nunca alterado nem apagado pela API. A regravação idêntica continua
-- permitida, porque a restauração de backup e o envio da fila offline
-- reenviam o mesmo registro sem modificá-lo.
create or replace function clique_obras_private.protect_planning_history_v402()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if (select auth.role())='service_role' then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_op='UPDATE'
    and new.organization_id=old.organization_id
    and new.store=old.store
    and new.record_id=old.record_id
    and new.data is not distinct from old.data then
    return new;
  end if;
  raise exception 'O histórico do planejamento não pode ser alterado nem excluído.';
end;
$$;

revoke all on function clique_obras_private.protect_planning_history_v402()
from public,anon,authenticated;

drop trigger if exists cliqueobras_protect_planning_history on public.app_records;
create trigger cliqueobras_protect_planning_history
before update or delete on public.app_records
for each row
when (old.store='planning_history')
execute function clique_obras_private.protect_planning_history_v402();

-- 7.3 Índices que sustentam as consultas de abatimento e estorno.
create index if not exists app_records_planning_project_categorykey_idx
on public.app_records (
  organization_id,
  ((data->>'projectId')),
  (clique_obras_private.category_key_v402(data->>'category'))
)
where store='planning';

create index if not exists app_records_planning_history_plan_idx
on public.app_records (
  organization_id,
  ((data->>'planningId'))
)
where store='planning_history';

create index if not exists app_records_purchases_source_rdo_idx
on public.app_records (
  organization_id,
  ((data->>'sourceRdoId'))
)
where store='purchases';

comment on function clique_obras_private.consume_planning_v402(uuid,uuid,text,text,numeric,text,text,text,text)
is 'Abate um custo realizado do saldo planejado do mesmo projeto e categoria, em ordem de data, gravando histórico.';
comment on function clique_obras_private.restore_planning_v402(uuid,uuid,jsonb,text,text,text,text)
is 'Devolve ao planejamento os valores abatidos por um lançamento removido, gravando histórico.';
comment on function public.clique_obras_approve_rdo_v402(uuid,text,jsonb)
is 'Aprova o RDO da v4.0.1 e abate automaticamente o custo de mão de obra do planejamento.';
comment on function public.clique_obras_offset_labor_planning_v402(uuid,text[])
is 'Abate do planejamento os custos de mão de obra recém-importados de planilha.';
comment on function public.clique_obras_restore_labor_planning_v402(uuid,text)
is 'Restaura o planejamento quando um custo de mão de obra importado é excluído.';
comment on function public.clique_obras_repair_rdo_planning_v402(uuid)
is 'Aplica o abatimento retroativo aos RDOs aprovados antes da versão 4.0.2.';

notify pgrst,'reload schema';

commit;
