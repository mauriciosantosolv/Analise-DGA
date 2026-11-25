-- ============================================================================
-- CliqueObras v4.5.17 - arquivamento de obras concluidas + limpeza de historicos
-- ============================================================================
-- Pedido de 25/11/2026: tirar do banco as obras finalizadas, depois de salvar
-- um arquivo com todos os registros financeiros e RDOs, para reduzir espaco.
--
-- Decisoes (confirmadas com o usuario em 25/11/2026):
--   - a obra fica no sistema como FICHA RESUMIDA: o projeto continua, com
--     orcamento, planejamento, medicoes, recebimentos e previsoes (pequenos e
--     usados nos totais), e os DETALHES saem do banco:
--       * compras/lancamentos -> trocados por 1 linha por categoria x mes x
--         origem, com a soma exata (Dashboard, Curva S e totais continuam iguais);
--       * RDOs, snapshots financeiros dos RDOs, historico do planejamento,
--         custos de RDO (rdo_cost_postings), vinculos RDO x medicao;
--       * fotos dos RDOs (registro em rdo_attachments + arquivo no Storage);
--   - antes, a tela gera um ZIP completo (PDF da obra, Excel, PDF de cada RDO,
--     fotos e JSON com todos os registros) e o usuario confirma que salvou;
--   - historicos automaticos (cron, sincronizacoes do Omie, limpeza de
--     remessas) passam a guardar so 30 dias.
--
-- Garantias:
--   - so proprietario/administrador; obra com status Concluido; nenhum RDO
--     pendente (Rascunho, Enviado ou Reprovado);
--   - IMPRESSAO DIGITAL: o arquivo e montado a partir de
--     clique_obras_archive_project_snapshot, que devolve os registros e uma
--     impressao digital deles. clique_obras_archive_project so apaga se a
--     impressao digital continuar igual. Qualquer lancamento novo ou alterado
--     entre o arquivo e a confirmacao cancela o arquivamento (nada e apagado);
--   - a soma das linhas-resumo e conferida contra a soma das compras apagadas;
--   - depois de arquivada, a obra nao recebe mais compras, RDOs nem
--     historico (gatilho zz_cliqueobras_archived_project_guard). A integracao
--     Omie da obra e desligada e nao pode ser religada para ela;
--   - medicoes da obra arquivada podem mudar de status (ex.: Aprovada ->
--     Faturada), mas valor, ajustes, RDOs e periodo ficam travados.
--
-- O que muda:
--   1. clique_obras_private.project_archive_v4517(uuid,text)           (nova)
--   2. clique_obras_private.guard_archived_project_v4517() + gatilho   (nova)
--   3. clique_obras_private.keep_archived_omie_off_v4517() + gatilhos  (nova)
--      em omie_project_mappings e omie_remessa_projects
--   4. clique_obras_private.protect_rdo_app_records(): a conferencia
--      RDOs x vinculos x snapshots da medicao HH deixa de valer para UPDATE
--      de medicao de obra arquivada (os RDOs nao existem mais). Troca de 2
--      trechos exatos; recusa se nao achar cada um exatamente 1 vez.
--   5. clique_obras_private.protect_planning_history_v402(): aceita a exclusao
--      feita pelo proprio arquivamento.
--   6. clique_obras_private.archive_fingerprint_v4517(uuid,text)       (nova)
--   7. public.clique_obras_archive_project_snapshot(uuid,text)          (nova)
--   8. public.clique_obras_archive_project(uuid,text,text,jsonb)       (nova)
--   9. public.clique_obras_archive_finish_photos(uuid,text)            (nova)
--  10. clique_obras_private.purge_history_v4517() + cron diario        (nova)
--
-- As fotos no Storage sao apagadas pela Edge Function arquivar-obra (a regra
-- do bucket so deixa apagar foto de RDO editavel; a funcao usa a chave de
-- servico depois de conferir que quem chamou e proprietario/administrador).
--
-- JA APLICADO EM PRODUCAO em 25/11/2026 (migration v4517_arquivamento_obras),
-- depois de ensaio completo em transacao desfeita. Edge Function arquivar-obra
-- publicada (versao 1, verify_jwt ligado). Limpeza inicial: 18.037 execucoes do
-- cron, 5.225 sincronizacoes Omie e 1.670 limpezas de remessa; vacuum full nas
-- 3 tabelas. Banco: 73 MB -> 53 MB.
--
-- ORDEM DE PUBLICACAO: aplicar ESTE SQL, publicar a Edge Function
-- arquivar-obra e por ultimo subir o front v4.5.17 (index.html por ultimo).
-- ============================================================================

begin;

-- 1. Dados do arquivamento de um projeto (null = projeto nao arquivado).
create or replace function clique_obras_private.project_archive_v4517(target_org uuid, target_project text)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select project.data->'archive'
  from public.app_records project
  where project.organization_id=target_org
    and project.store='projects'
    and project.record_id=coalesce(target_project,'')
    and jsonb_typeof(project.data->'archive')='object'
  limit 1;
$$;
revoke all on function clique_obras_private.project_archive_v4517(uuid,text) from public, anon, authenticated;

-- 2. Obra arquivada nao recebe mais detalhe nem muda o que define os totais.
create or replace function clique_obras_private.guard_archived_project_v4517()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  bypass text:=coalesce(current_setting('clique_obras.archive_project',true),'');
  row_store text;
  new_project text:='';
  old_project text:='';
  label text;
  num_old numeric;
  num_new numeric;
begin
  row_store:=case when tg_op='DELETE' then old.store else new.store end;

  if row_store='projects' then
    if tg_op='UPDATE' and jsonb_typeof(old.data->'archive')='object' then
      if bypass<>'' and bypass=old.record_id then return new; end if;
      -- o registro do arquivamento nunca se perde numa gravacao da tela
      new.data:=(new.data-'archive')||jsonb_build_object('archive',old.data->'archive');
      num_old:=case when coalesce(old.data->>'saleValue','') ~ '^-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$'
        then (old.data->>'saleValue')::numeric end;
      num_new:=case when coalesce(new.data->>'saleValue','') ~ '^-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$'
        then (new.data->>'saleValue')::numeric end;
      if new.data->>'status' is distinct from old.data->>'status'
        or new.data->>'type' is distinct from old.data->>'type'
        or num_new is distinct from num_old then
        raise exception 'Obra arquivada: status, tipo de contrato e valor de venda não podem ser alterados.';
      end if;
    end if;
    return case when tg_op='DELETE' then old else new end;
  end if;

  if row_store not in ('purchases','rdos','rdo_financial','planning_history','measurements') then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if tg_op<>'DELETE' then new_project:=coalesce(new.data->>'projectId',''); end if;
  if tg_op<>'INSERT' then old_project:=coalesce(old.data->>'projectId',''); end if;

  -- o proprio arquivamento (clique_obras_archive_project) mexe so na obra dele
  if bypass<>''
    and (new_project='' or new_project=bypass)
    and (old_project='' or old_project=bypass) then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if row_store='measurements' then
    if tg_op='UPDATE'
      and clique_obras_private.project_archive_v4517(old.organization_id,old_project) is not null
      and (
        new_project is distinct from old_project
        or new.data->>'value' is distinct from old.data->>'value'
        or new.data->'adjustments' is distinct from old.data->'adjustments'
        or new.data->'rdoIds' is distinct from old.data->'rdoIds'
        or new.data->>'hours' is distinct from old.data->>'hours'
        or new.data->>'laborValue' is distinct from old.data->>'laborValue'
        or new.data->>'periodFrom' is distinct from old.data->>'periodFrom'
        or new.data->>'periodTo' is distinct from old.data->>'periodTo'
        or new.data->>'source' is distinct from old.data->>'source'
      ) then
      raise exception 'Obra arquivada: a medição só pode mudar de status ou observação.';
    end if;
    return case when tg_op='DELETE' then old else new end;
  end if;

  if (new_project<>'' and clique_obras_private.project_archive_v4517(
        case when tg_op='DELETE' then old.organization_id else new.organization_id end,new_project) is not null)
    or (old_project<>'' and clique_obras_private.project_archive_v4517(old.organization_id,old_project) is not null) then
    select coalesce(nullif(trim(concat_ws(' | ',project.data->>'proposal',project.data->>'name')),''),project.record_id)
      into label
    from public.app_records project
    where project.organization_id=case when tg_op='DELETE' then old.organization_id else new.organization_id end
      and project.store='projects'
      and project.record_id in (new_project,old_project)
    limit 1;
    raise exception 'A obra % está arquivada. Lançamentos, RDOs e histórico dela não podem mais ser incluídos, alterados ou excluídos.',coalesce(label,'');
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function clique_obras_private.guard_archived_project_v4517() from public, anon, authenticated;

drop trigger if exists zz_cliqueobras_archived_project_guard on public.app_records;
create trigger zz_cliqueobras_archived_project_guard
before insert or update or delete on public.app_records
for each row execute function clique_obras_private.guard_archived_project_v4517();

-- 3. Integracao Omie de obra arquivada fica desligada (a sincronizacao
--    reimportaria as compras que viraram resumo).
create or replace function clique_obras_private.keep_archived_omie_off_v4517()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.enabled
    and clique_obras_private.project_archive_v4517(new.organization_id,new.clique_project_id) is not null then
    new.enabled:=false;
  end if;
  return new;
end;
$$;
revoke all on function clique_obras_private.keep_archived_omie_off_v4517() from public, anon, authenticated;

drop trigger if exists cliqueobras_archived_omie_mapping_off on public.omie_project_mappings;
create trigger cliqueobras_archived_omie_mapping_off
before insert or update on public.omie_project_mappings
for each row execute function clique_obras_private.keep_archived_omie_off_v4517();

drop trigger if exists cliqueobras_archived_omie_remessa_off on public.omie_remessa_projects;
create trigger cliqueobras_archived_omie_remessa_off
before insert or update on public.omie_remessa_projects
for each row execute function clique_obras_private.keep_archived_omie_off_v4517();

-- 4. Medicao HH de obra arquivada: os RDOs, vinculos e snapshots sairam do
--    banco, entao a conferencia de composicao so vale enquanto a obra nao esta
--    arquivada. A composicao continua travada pelo item 2.
do $patch$
declare
  definition text;
  piece_a constant text:=$a$if report_count<>jsonb_array_length(new.data->'rdoIds')$a$;
  piece_b constant text:=$b$or measured_value<0 then$b$;
begin
  select pg_get_functiondef('clique_obras_private.protect_rdo_app_records()'::regprocedure) into definition;
  if position('project_data ? ''archive''' in definition)>0 then
    raise notice 'protect_rdo_app_records ja contem o ajuste da v4.5.17';
    return;
  end if;
  if (length(definition)-length(replace(definition,piece_a,'')))/length(piece_a)<>1
    or (length(definition)-length(replace(definition,piece_b,'')))/length(piece_b)<>1 then
    raise exception 'protect_rdo_app_records: trecho esperado nao encontrado exatamente uma vez. Nada foi alterado.';
  end if;
  definition:=replace(definition,piece_a,
    $c$if not (tg_op='UPDATE' and coalesce(project_data ? 'archive',false)) and (report_count<>jsonb_array_length(new.data->'rdoIds')$c$);
  definition:=replace(definition,piece_b,$d$or measured_value<0) then$d$);
  execute definition;
end;
$patch$;

-- 5. Historico do planejamento: so o proprio arquivamento pode apagar.
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
  if tg_op='DELETE'
    and coalesce(current_setting('clique_obras.archive_project',true),'')<>''
    and current_setting('clique_obras.archive_project',true)=coalesce(old.data->>'projectId','')
    and clique_obras_private.is_org_admin(old.organization_id) then
    return old;
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

-- 6. Impressao digital de tudo o que o arquivamento apaga.
create or replace function clique_obras_private.archive_fingerprint_v4517(target_org uuid, target_project text)
returns text
language sql
stable
security definer
set search_path=''
as $$
  select md5(
    coalesce((
      select string_agg(record.store||'|'||record.record_id||'|'||md5(record.data::text),',' order by record.store,record.record_id)
      from public.app_records record
      where record.organization_id=target_org
        and record.store in ('purchases','rdos','rdo_financial','planning_history')
        and record.data->>'projectId'=target_project
    ),'')
    ||'#'||
    coalesce((
      select string_agg(attachment.id::text||'|'||attachment.object_path||'|'||coalesce(attachment.size_bytes,0)::text||'|'||md5(coalesce(attachment.description,'')),',' order by attachment.id)
      from public.rdo_attachments attachment
      where attachment.organization_id=target_org
        and attachment.project_id=target_project
    ),'')
  );
$$;
revoke all on function clique_obras_private.archive_fingerprint_v4517(uuid,text) from public, anon, authenticated;

-- 7. Tudo da obra, para montar o arquivo, mais a impressao digital.
create or replace function public.clique_obras_archive_project_snapshot(
  target_organization_id uuid,
  target_project_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  project_data jsonb;
  records jsonb;
  attachments jsonb;
  blockers jsonb;
begin
  if (select auth.uid()) is null
    or not clique_obras_private.is_org_admin(target_organization_id) then
    raise exception 'Somente proprietário ou administrador pode arquivar obras.';
  end if;

  select project.data into project_data
  from public.app_records project
  where project.organization_id=target_organization_id
    and project.store='projects'
    and project.record_id=coalesce(target_project_id,'');
  if project_data is null then raise exception 'Projeto não encontrado.'; end if;

  select coalesce(jsonb_object_agg(grouped.store,grouped.rows),'{}'::jsonb) into records
  from (
    select record.store,jsonb_agg(record.data order by record.record_id) as rows
    from public.app_records record
    where record.organization_id=target_organization_id
      and record.store in ('purchases','rdos','rdo_financial','planning_history','budgets','planning',
        'measurements','measurement_receipts','forecasts','labor_rates','crew_allocations')
      and record.data->>'projectId'=target_project_id
    group by record.store
  ) grouped;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',attachment.id,'rdoId',attachment.rdo_id,'projectId',attachment.project_id,
      'objectPath',attachment.object_path,'fileName',attachment.file_name,
      'description',attachment.description,'mimeType',attachment.mime_type,
      'sizeBytes',attachment.size_bytes,'uploadedBy',attachment.uploaded_by,
      'uploadedAt',attachment.uploaded_at
    ) order by attachment.rdo_id,attachment.uploaded_at,attachment.id),'[]'::jsonb)
    into attachments
  from public.rdo_attachments attachment
  where attachment.organization_id=target_organization_id
    and attachment.project_id=target_project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'rdoId',report.record_id,'number',report.data->>'number',
      'date',report.data->>'date','status',report.data->>'status'
    ) order by report.data->>'date',report.record_id),'[]'::jsonb)
    into blockers
  from public.app_records report
  where report.organization_id=target_organization_id
    and report.store='rdos'
    and report.data->>'projectId'=target_project_id
    and coalesce(report.data->>'status','')<>'Aprovado';

  return jsonb_build_object(
    'version',1,
    'generatedAt',now(),
    'organizationId',target_organization_id,
    'projectId',target_project_id,
    'project',project_data,
    'archived',jsonb_typeof(project_data->'archive')='object',
    'concluded',coalesce(project_data->>'status','')='Concluído',
    'pendingRdos',blockers,
    'fingerprint',clique_obras_private.archive_fingerprint_v4517(target_organization_id,target_project_id),
    'records',records,
    'attachments',attachments,
    'costPostings',coalesce((
      select jsonb_agg(to_jsonb(posting)-'organization_id' order by posting.rdo_id)
      from public.rdo_cost_postings posting
      where posting.organization_id=target_organization_id and posting.project_id=target_project_id
    ),'[]'::jsonb),
    'measurementLinks',coalesce((
      select jsonb_agg(to_jsonb(link)-'organization_id' order by link.measurement_id,link.rdo_id)
      from public.rdo_measurement_links link
      where link.organization_id=target_organization_id and link.project_id=target_project_id
    ),'[]'::jsonb),
    'omieProjects',coalesce((
      select jsonb_agg(jsonb_build_object('omieProjectCode',mapping.omie_project_code,
        'omieProjectName',mapping.omie_project_name,'enabled',mapping.enabled) order by mapping.omie_project_code)
      from public.omie_project_mappings mapping
      where mapping.organization_id=target_organization_id and mapping.clique_project_id=target_project_id
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.clique_obras_archive_project_snapshot(uuid,text) from public, anon;
grant execute on function public.clique_obras_archive_project_snapshot(uuid,text) to authenticated;

-- 8. Arquiva: troca compras por resumo, apaga os detalhes e grava a ficha.
--    Devolve os caminhos das fotos para a Edge Function apagar no Storage.
create or replace function public.clique_obras_archive_project(
  target_organization_id uuid,
  target_project_id text,
  expected_fingerprint text,
  archive_file jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  actor_name text;
  project_data jsonb;
  current_fingerprint text;
  report record;
  summary record;
  summaries jsonb;
  summary_id text;
  purchases_before numeric:=0;
  purchases_after numeric:=0;
  purchase_count integer:=0;
  summary_count integer:=0;
  rdo_count integer:=0;
  financial_count integer:=0;
  history_count integer:=0;
  posting_count integer:=0;
  link_count integer:=0;
  attachment_count integer:=0;
  attachment_bytes bigint:=0;
  object_paths jsonb;
  file_name text:=left(coalesce(archive_file->>'name',''),200);
  file_sha text:=lower(coalesce(archive_file->>'sha256',''));
  file_bytes bigint;
  archive_data jsonb;
begin
  if actor is null or not clique_obras_private.is_org_admin(target_organization_id) then
    raise exception 'Somente proprietário ou administrador pode arquivar obras.';
  end if;
  if coalesce(length(trim(target_project_id)),0)=0 then raise exception 'Projeto inválido.'; end if;
  if file_name='' or file_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'Gere e salve o arquivo da obra antes de arquivar.';
  end if;
  file_bytes:=case when coalesce(archive_file->>'bytes','') ~ '^[0-9]{1,15}$' then (archive_file->>'bytes')::bigint else 0 end;
  if file_bytes<=0 then raise exception 'Gere e salve o arquivo da obra antes de arquivar.'; end if;

  -- mesma trava da sincronizacao do Omie: nada entra na obra durante o arquivamento
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':omie',0));

  select project.data into project_data
  from public.app_records project
  where project.organization_id=target_organization_id
    and project.store='projects'
    and project.record_id=target_project_id
  for update;
  if project_data is null then raise exception 'Projeto não encontrado.'; end if;
  if jsonb_typeof(project_data->'archive')='object' then raise exception 'Esta obra já está arquivada.'; end if;
  if coalesce(project_data->>'status','')<>'Concluído' then
    raise exception 'Só é possível arquivar obra com status Concluído.';
  end if;
  if exists (
    select 1 from public.app_records pending
    where pending.organization_id=target_organization_id
      and pending.store='rdos'
      and pending.data->>'projectId'=target_project_id
      and coalesce(pending.data->>'status','')<>'Aprovado'
  ) then
    raise exception 'A obra tem RDO em rascunho, aguardando aprovação ou reprovado. Resolva esses RDOs antes de arquivar.';
  end if;

  current_fingerprint:=clique_obras_private.archive_fingerprint_v4517(target_organization_id,target_project_id);
  if current_fingerprint is distinct from expected_fingerprint then
    raise exception 'Os dados da obra mudaram depois que o arquivo foi gerado. Gere o arquivo de novo antes de arquivar.';
  end if;

  select coalesce(nullif(trim(profile.full_name),''),nullif(trim(profile.email),''),actor::text)
    into actor_name
  from public.profiles profile where profile.id=actor;

  perform set_config('clique_obras.archive_project',target_project_id,true);

  -- 8.1 compras -> resumo por categoria x mes x origem
  select count(*),coalesce(sum(case when coalesce(purchase.data->>'value','') ~ '^-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$'
      then (purchase.data->>'value')::numeric else 0 end),0)
    into purchase_count,purchases_before
  from public.app_records purchase
  where purchase.organization_id=target_organization_id
    and purchase.store='purchases'
    and purchase.data->>'projectId'=target_project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'category',grouped.category,'month',grouped.month,'origin',grouped.origin,
      'lastDate',grouped.last_date,'total',grouped.total,'items',grouped.items
    ) order by grouped.month,grouped.category,grouped.origin),'[]'::jsonb)
    into summaries
  from (
    select coalesce(purchase.data->>'category','') as category,
           left(coalesce(purchase.data->>'date',''),7) as month,
           coalesce(nullif(purchase.data->>'sourceType',''),'purchase') as origin,
           max(nullif(purchase.data->>'date','')) as last_date,
           sum(case when coalesce(purchase.data->>'value','') ~ '^-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$'
             then (purchase.data->>'value')::numeric else 0 end) as total,
           count(*) as items
    from public.app_records purchase
    where purchase.organization_id=target_organization_id
      and purchase.store='purchases'
      and purchase.data->>'projectId'=target_project_id
    group by 1,2,3
  ) grouped;

  delete from public.app_records purchase
  where purchase.organization_id=target_organization_id
    and purchase.store='purchases'
    and purchase.data->>'projectId'=target_project_id;

  for summary in select value from jsonb_array_elements(summaries) loop
    summary_id:='arq-'||md5(target_project_id||'|'||(summary.value->>'category')||'|'||(summary.value->>'month')||'|'||(summary.value->>'origin'));
    insert into public.app_records(organization_id,user_id,store,record_id,data,updated_at)
    values(target_organization_id,actor,'purchases',summary_id,jsonb_build_object(
      'id',summary_id,
      'projectId',target_project_id,
      'category',summary.value->>'category',
      'costCenter',summary.value->>'category',
      'date',coalesce(summary.value->>'lastDate',''),
      'value',round((summary.value->>'total')::numeric,2),
      'desc',format('Resumo da obra arquivada: %s lançamento(s)%s',summary.value->>'items',
        case when summary.value->>'month'<>''
          then ' de '||substr(summary.value->>'month',6,2)||'/'||substr(summary.value->>'month',1,4)
          else ' sem data' end),
      'supplier','Obra arquivada',
      'order','',
      'notes','Detalhes no arquivo '||file_name,
      'sourceType',summary.value->>'origin',
      'readOnly',true,
      'archiveSummary',true,
      'archivedCount',(summary.value->>'items')::integer,
      'file',file_name,
      'importedAt',floor(extract(epoch from now())*1000)::bigint
    ),now());
    summary_count:=summary_count+1;
    purchases_after:=purchases_after+round((summary.value->>'total')::numeric,2);
  end loop;

  if abs(purchases_after-round(purchases_before,2))>0.005*greatest(summary_count,1) then
    raise exception 'A soma do resumo (%) não confere com a soma das compras (%). Nada foi apagado.',purchases_after,purchases_before;
  end if;

  -- 8.2 RDOs e snapshots aprovados (a trava padrao exige liberar 1 a 1)
  for report in
    select record.store,record.record_id
    from public.app_records record
    where record.organization_id=target_organization_id
      and record.store in ('rdo_financial','rdos')
      and record.data->>'projectId'=target_project_id
    order by case record.store when 'rdo_financial' then 0 else 1 end,record.record_id
  loop
    perform set_config('clique_obras.admin_rdo_delete',report.record_id,true);
    delete from public.app_records record
    where record.organization_id=target_organization_id
      and record.store=report.store
      and record.record_id=report.record_id;
    if report.store='rdos' then rdo_count:=rdo_count+1; else financial_count:=financial_count+1; end if;
  end loop;
  perform set_config('clique_obras.admin_rdo_delete','',true);

  -- 8.3 historico do planejamento
  delete from public.app_records history
  where history.organization_id=target_organization_id
    and history.store='planning_history'
    and history.data->>'projectId'=target_project_id;
  get diagnostics history_count=row_count;

  -- 8.4 tabelas ligadas aos RDOs
  delete from public.rdo_cost_postings posting
  where posting.organization_id=target_organization_id and posting.project_id=target_project_id;
  get diagnostics posting_count=row_count;
  delete from public.rdo_measurement_links link
  where link.organization_id=target_organization_id and link.project_id=target_project_id;
  get diagnostics link_count=row_count;

  -- 8.5 fotos: o registro fica ate o arquivo sair do Storage
  --     (clique_obras_archive_finish_photos)
  select count(*),coalesce(sum(attachment.size_bytes),0),
         coalesce(jsonb_agg(to_jsonb(attachment.object_path) order by attachment.object_path),'[]'::jsonb)
    into attachment_count,attachment_bytes,object_paths
  from public.rdo_attachments attachment
  where attachment.organization_id=target_organization_id
    and attachment.project_id=target_project_id;

  -- 8.6 Omie desligado para a obra
  update public.omie_project_mappings mapping
     set enabled=false,updated_by=actor,updated_at=now()
   where mapping.organization_id=target_organization_id
     and mapping.clique_project_id=target_project_id
     and mapping.enabled;
  update public.omie_remessa_projects remessa
     set enabled=false,updated_by=actor,updated_at=now()
   where remessa.organization_id=target_organization_id
     and remessa.clique_project_id=target_project_id
     and remessa.enabled;

  -- 8.7 ficha resumida
  archive_data:=jsonb_build_object(
    'version',1,
    'status',case when attachment_count>0 then 'photos_pending' else 'done' end,
    'archivedAt',now(),
    'archivedBy',actor,
    'archivedByName',left(coalesce(actor_name,''),180),
    'fingerprint',current_fingerprint,
    'file',jsonb_build_object('name',file_name,'sha256',file_sha,'bytes',file_bytes),
    'counts',jsonb_build_object(
      'purchases',purchase_count,'purchaseSummaries',summary_count,
      'rdos',rdo_count,'rdoFinancial',financial_count,'planningHistory',history_count,
      'costPostings',posting_count,'measurementLinks',link_count,
      'photos',attachment_count,'photoBytes',attachment_bytes,'photosRemaining',attachment_count
    ),
    'purchasesTotal',round(purchases_before,2)
  );
  update public.app_records project
     set data=project.data||jsonb_build_object('archive',archive_data),
         user_id=actor,updated_at=now()
   where project.organization_id=target_organization_id
     and project.store='projects'
     and project.record_id=target_project_id;

  perform set_config('clique_obras.archive_project','',true);

  return jsonb_build_object(
    'archived',true,
    'projectId',target_project_id,
    'archive',archive_data,
    'object_paths',object_paths
  );
end;
$$;
revoke all on function public.clique_obras_archive_project(uuid,text,text,jsonb) from public, anon;
grant execute on function public.clique_obras_archive_project(uuid,text,text,jsonb) to authenticated;

-- 9. Depois que o Storage apagou as fotos: tira os registros das fotos que
--    nao existem mais no bucket e fecha a ficha. Pode ser chamada de novo.
create or replace function public.clique_obras_archive_finish_photos(
  target_organization_id uuid,
  target_project_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  project_data jsonb;
  removed integer:=0;
  remaining integer:=0;
  remaining_paths jsonb;
  archive_data jsonb;
begin
  if actor is null or not clique_obras_private.is_org_admin(target_organization_id) then
    raise exception 'Somente proprietário ou administrador pode arquivar obras.';
  end if;

  select project.data into project_data
  from public.app_records project
  where project.organization_id=target_organization_id
    and project.store='projects'
    and project.record_id=coalesce(target_project_id,'')
  for update;
  if project_data is null or jsonb_typeof(project_data->'archive')<>'object' then
    raise exception 'Esta obra não está arquivada.';
  end if;

  delete from public.rdo_attachments attachment
  where attachment.organization_id=target_organization_id
    and attachment.project_id=target_project_id
    and not exists (
      select 1 from storage.objects object
      where object.bucket_id='rdo-evidencias' and object.name=attachment.object_path
    );
  get diagnostics removed=row_count;

  select count(*),coalesce(jsonb_agg(to_jsonb(attachment.object_path) order by attachment.object_path),'[]'::jsonb)
    into remaining,remaining_paths
  from public.rdo_attachments attachment
  where attachment.organization_id=target_organization_id
    and attachment.project_id=target_project_id;

  archive_data:=jsonb_set(project_data->'archive','{counts,photosRemaining}',to_jsonb(remaining))
    ||jsonb_build_object('status',case when remaining=0 then 'done' else 'photos_pending' end);
  if remaining=0 and not (archive_data ? 'photosRemovedAt') then
    archive_data:=archive_data||jsonb_build_object('photosRemovedAt',now());
  end if;
  perform set_config('clique_obras.archive_project',target_project_id,true);
  update public.app_records project
     set data=project.data||jsonb_build_object('archive',archive_data),
         user_id=actor,updated_at=now()
   where project.organization_id=target_organization_id
     and project.store='projects'
     and project.record_id=target_project_id;
  perform set_config('clique_obras.archive_project','',true);

  return jsonb_build_object('removed',removed,'remaining',remaining,'object_paths',remaining_paths);
end;
$$;
revoke all on function public.clique_obras_archive_finish_photos(uuid,text) from public, anon;
grant execute on function public.clique_obras_archive_finish_photos(uuid,text) to authenticated;

-- 10. Historicos automaticos: 30 dias.
create or replace function clique_obras_private.purge_history_v4517(keep_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  limit_at timestamptz:=now()-make_interval(days=>greatest(keep_days,7));
  cron_rows integer:=0;
  sync_rows integer:=0;
  cleanup_rows integer:=0;
begin
  delete from cron.job_run_details where coalesce(end_time,start_time)<limit_at;
  get diagnostics cron_rows=row_count;
  delete from public.omie_sync_runs where started_at<limit_at;
  get diagnostics sync_rows=row_count;
  delete from public.omie_remessa_cleanup_runs where ran_at<limit_at;
  get diagnostics cleanup_rows=row_count;
  return jsonb_build_object('cron',cron_rows,'omieSyncRuns',sync_rows,'remessaCleanupRuns',cleanup_rows,'before',limit_at);
end;
$$;
revoke all on function clique_obras_private.purge_history_v4517(integer) from public, anon, authenticated;

do $cron$
begin
  if exists (select 1 from cron.job where jobname='clique-obras-limpeza-historicos') then
    perform cron.unschedule('clique-obras-limpeza-historicos');
  end if;
  perform cron.schedule('clique-obras-limpeza-historicos','41 4 * * *',
    'select clique_obras_private.purge_history_v4517(30);');
end;
$cron$;

commit;

-- Depois de aplicar (fora da transacao), para devolver o espaco ao disco:
--   select clique_obras_private.purge_history_v4517(30);
--   vacuum full cron.job_run_details;
--   vacuum full public.omie_sync_runs;
--   vacuum full public.omie_remessa_cleanup_runs;
