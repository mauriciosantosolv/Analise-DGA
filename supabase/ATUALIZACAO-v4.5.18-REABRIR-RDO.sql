-- ============================================================================
-- CliqueObras v4.5.18 - reabrir RDO aprovado que ainda nao foi medido
-- ============================================================================
-- Pedido de 27/11/2026: permitir reabrir um RDO aprovado, desde que ainda nao
-- esteja em medicao, para corrigir e aprovar de novo.
--
-- O que a reabertura faz (tudo numa transacao, so proprietario/administrador):
--   1. confere que o RDO esta Aprovado, nao tem vinculo de medicao
--      (rdo_measurement_links) e nao aparece em nenhuma medicao (rdoIds);
--   2. desfaz a aprovacao exatamente como a exclusao administrativa do RDO
--      (clique_obras_private.delete_rdo) ja faz hoje:
--        - devolve ao planejamento o que o custo do RDO tinha abatido;
--        - apaga o lancamento de custo de mao de obra (purchases.sourceRdoId);
--        - apaga rdo_cost_postings e o snapshot financeiro (rdo_financial);
--   3. em vez de apagar o RDO, volta o status para 'Devolvido' (o mesmo de
--      "Reprovado"), com o motivo da reabertura no comentario. Dai em diante
--      segue o fluxo de sempre: editar, anexar fotos, enviar e aprovar.
--   Fotos e anexos NAO sao tocados.
--
-- Ajustes em funcoes existentes (troca de trecho exato, como na v4.5.17):
--   - protect_rdo_app_records: a trava "RDO aprovado esta bloqueado para
--     edicao" ganha UMA excecao: a propria reabertura (marcador de transacao
--     clique_obras.admin_rdo_reopen = id do RDO, administrador, status novo
--     'Devolvido'). Fora disso, nada muda.
--   - audit_rdo_changes: Aprovado -> outro status passa a ser registrado como
--     'reopened' (Reaberto) no historico interno, em vez de 'rejected'.
-- ============================================================================

-- 1. Excecao na trava de RDO aprovado.
do $patch$
declare
  definition text;
  piece constant text:=$a$if tg_op='UPDATE' and old.data->>'status'='Aprovado'
      and new.data is distinct from old.data then$a$;
begin
  select pg_get_functiondef('clique_obras_private.protect_rdo_app_records()'::regprocedure) into definition;
  if position('clique_obras.admin_rdo_reopen' in definition)>0 then
    raise notice 'protect_rdo_app_records ja contem o ajuste da v4.5.18';
    return;
  end if;
  if (length(definition)-length(replace(definition,piece,'')))/length(piece)<>1 then
    raise exception 'protect_rdo_app_records: trecho esperado nao encontrado exatamente uma vez. Nada foi alterado.';
  end if;
  definition:=replace(definition,piece,
    $b$if tg_op='UPDATE' and old.data->>'status'='Aprovado'
      and new.data is distinct from old.data
      and not (
        current_setting('clique_obras.admin_rdo_reopen',true)=old.record_id
        and new.data->>'status'='Devolvido'
        and clique_obras_private.is_org_admin(new.organization_id)
      ) then$b$);
  execute definition;
end;
$patch$;

-- 2. Historico interno: Aprovado -> Devolvido e "Reaberto".
do $patch$
declare
  definition text;
  piece constant text:=$a$action_name:=case
      when new.data->>'status'='Aprovado' and old.data->>'status'<>'Aprovado'$a$;
begin
  select pg_get_functiondef('clique_obras_private.audit_rdo_changes()'::regprocedure) into definition;
  if position($m$old.data->>'status'='Aprovado' and new.data->>'status'<>'Aprovado'$m$ in definition)>0 then
    raise notice 'audit_rdo_changes ja contem o ajuste da v4.5.18';
    return;
  end if;
  if (length(definition)-length(replace(definition,piece,'')))/length(piece)<>1 then
    raise exception 'audit_rdo_changes: trecho esperado nao encontrado exatamente uma vez. Nada foi alterado.';
  end if;
  definition:=replace(definition,piece,
    $b$action_name:=case
      when old.data->>'status'='Aprovado' and new.data->>'status'<>'Aprovado'
        then 'reopened'
      when new.data->>'status'='Aprovado' and old.data->>'status'<>'Aprovado'$b$);
  execute definition;
end;
$patch$;

-- 3. Reabertura.
create or replace function clique_obras_private.reopen_rdo_v4518(
  target_organization_id uuid,
  target_rdo_id text,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  actor_name text;
  reason text:=left(btrim(coalesce(target_reason,'')),1000);
  rdo_data jsonb;
  project_data jsonb;
  purchase_row record;
  purchase_count integer:=0;
  restored_total numeric:=0;
  posting_count integer:=0;
  snapshot_count integer:=0;
  now_iso text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  comment_text text;
begin
  if actor is null
    or not clique_obras_private.is_org_admin(target_organization_id) then
    raise exception 'Somente proprietário ou administrador pode reabrir RDO aprovado.';
  end if;
  if coalesce(length(btrim(target_rdo_id)),0)=0 or length(target_rdo_id)>180 then
    raise exception 'RDO inválido.';
  end if;
  if length(reason)<3 then
    raise exception 'Informe o motivo da reabertura.';
  end if;

  -- mesma trava da aprovacao: ninguem aprova e reabre o mesmo RDO ao mesmo tempo
  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text||':rdo-approval:'||target_rdo_id,0)
  );

  select record.data into rdo_data
  from public.app_records record
  where record.organization_id=target_organization_id
    and record.store='rdos'
    and record.record_id=target_rdo_id
  for update;

  if rdo_data is null then raise exception 'RDO não encontrado.'; end if;
  if coalesce(rdo_data->>'status','')<>'Aprovado' then
    raise exception 'Somente RDO aprovado pode ser reaberto.';
  end if;

  select project.data into project_data
  from public.app_records project
  where project.organization_id=target_organization_id
    and project.store='projects'
    and project.record_id=rdo_data->>'projectId';
  if coalesce(project_data ? 'archive',false) then
    raise exception 'A obra deste RDO está arquivada.';
  end if;

  if exists (
    select 1 from public.rdo_measurement_links link
    where link.organization_id=target_organization_id
      and link.rdo_id=target_rdo_id
  ) or exists (
    select 1 from public.app_records measurement
    where measurement.organization_id=target_organization_id
      and measurement.store='measurements'
      and jsonb_typeof(measurement.data->'rdoIds')='array'
      and measurement.data->'rdoIds' ? target_rdo_id
  ) then
    raise exception 'O RDO já está em uma medição e não pode ser reaberto. Exclua primeiro a medição correspondente.';
  end if;

  select coalesce(nullif(btrim(profile.full_name),''),nullif(btrim(profile.email),''),actor::text)
    into actor_name
  from public.profiles profile
  where profile.id=actor;
  actor_name:=left(coalesce(actor_name,actor::text),180);

  perform set_config('clique_obras.admin_rdo_delete',target_rdo_id,true);
  perform set_config('clique_obras.admin_rdo_reopen',target_rdo_id,true);

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
      'Planejamento restaurado após reabertura do RDO'
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
  get diagnostics posting_count=row_count;

  delete from public.app_records financial
  where financial.organization_id=target_organization_id
    and financial.store='rdo_financial'
    and financial.record_id=target_rdo_id;
  get diagnostics snapshot_count=row_count;

  comment_text:='Reaberto para correção: '||reason;

  update public.app_records report
  set data=(rdo_data-'approvedAt'-'approvedBy'-'submittedAt')||jsonb_build_object(
        'status','Devolvido',
        'rejectionComment',comment_text,
        'rejectedAt',now_iso,
        'rejectedBy',actor_name,
        'reopenedAt',now_iso,
        'reopenedBy',actor_name,
        'rejectionHistory',(
          select coalesce(jsonb_agg(item.value order by item.ordinality),'[]'::jsonb)
          from jsonb_array_elements(
            (case when jsonb_typeof(rdo_data->'rejectionHistory')='array' then rdo_data->'rejectionHistory' else '[]'::jsonb end)
            ||jsonb_build_array(jsonb_build_object('comment',comment_text,'rejectedAt',now_iso,'rejectedBy',actor_name,'reopened',true))
          ) with ordinality as item(value,ordinality)
          where item.ordinality>greatest(0,jsonb_array_length(
            (case when jsonb_typeof(rdo_data->'rejectionHistory')='array' then rdo_data->'rejectionHistory' else '[]'::jsonb end))+1-20)
        ),
        'reopenHistory',(
          case when jsonb_typeof(rdo_data->'reopenHistory')='array' then rdo_data->'reopenHistory' else '[]'::jsonb end
        )||jsonb_build_array(jsonb_build_object(
          'reason',reason,
          'reopenedAt',now_iso,
          'reopenedBy',actor_name,
          'previousApprovedAt',rdo_data->'approvedAt',
          'previousApprovedBy',rdo_data->'approvedBy'
        )),
        'updatedAt',now_iso
      ),
      user_id=actor,
      updated_at=clock_timestamp()
  where report.organization_id=target_organization_id
    and report.store='rdos'
    and report.record_id=target_rdo_id;

  if not found then raise exception 'RDO não encontrado durante a reabertura.'; end if;

  return jsonb_build_object(
    'status','reopened',
    'rdoId',target_rdo_id,
    'projectId',rdo_data->>'projectId',
    'costEntriesReversed',purchase_count,
    'costPostingsRemoved',posting_count,
    'snapshotsRemoved',snapshot_count,
    'planningRestored',restored_total
  );
end;
$$;

revoke all on function clique_obras_private.reopen_rdo_v4518(uuid,text,text) from public, anon, authenticated;

create or replace function public.clique_obras_reopen_rdo(
  target_organization_id uuid,
  target_rdo_id text,
  target_reason text
)
returns jsonb
language sql
security definer
set search_path=''
as $$
  select clique_obras_private.reopen_rdo_v4518(target_organization_id,target_rdo_id,target_reason);
$$;

revoke all on function public.clique_obras_reopen_rdo(uuid,text,text) from public, anon;
grant execute on function public.clique_obras_reopen_rdo(uuid,text,text) to authenticated;
