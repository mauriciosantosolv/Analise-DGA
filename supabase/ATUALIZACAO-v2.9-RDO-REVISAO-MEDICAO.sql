-- CliqueObras v2.9
-- Exclusão controlada de medições HH, preservando RLS, vínculos e auditoria.
-- Migração idempotente: não remove nem altera registros existentes.

begin;

create or replace function clique_obras_private.protect_rdo_app_records()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  project_data jsonb;
  report_count integer;
  link_count integer;
  snapshot_count integer;
  expected_sale numeric;
  measured_value numeric;
  posting public.rdo_cost_postings%rowtype;
begin
  if tg_op='DELETE' then
    if old.store='rdos'
      and coalesce(old.data->>'status','Rascunho') not in ('Rascunho','Devolvido') then
      raise exception 'Somente RDO em rascunho ou reprovado pode ser excluído.';
    end if;
    if old.store='rdo_financial' then
      raise exception 'Snapshot financeiro não pode ser excluído.';
    end if;
    if old.store='measurements' and old.data->>'source'='rdo-hh' then
      if not clique_obras_private.is_org_admin(old.organization_id) then
        raise exception 'Somente administrador pode excluir medição HH.';
      end if;
      if old.data->>'status'='Faturada' then
        raise exception 'Medição HH faturada não pode ser excluída.';
      end if;
      if exists (
        select 1
        from public.rdo_measurement_links link
        where link.organization_id=old.organization_id
          and link.measurement_id=old.record_id
      ) then
        raise exception 'Use a exclusão controlada para liberar os RDOs da medição.';
      end if;
    end if;
    return old;
  end if;

  if new.store in ('rdos','crew','labor_rates','rdo_financial','measurements')
    and coalesce(new.data->>'id','')<>new.record_id then
    raise exception 'O identificador do registro é inválido.';
  end if;

  if new.store='rdos' then
    if coalesce(new.data->>'projectId','')=''
      or coalesce(new.data->>'date','')=''
      or new.data->>'status' not in ('Rascunho','Enviado','Aprovado','Devolvido')
      or jsonb_typeof(new.data->'entries')<>'array'
      or jsonb_array_length(new.data->'entries')=0 then
      raise exception 'RDO incompleto ou inválido.';
    end if;

    if tg_op='UPDATE' and old.data->>'status'='Aprovado'
      and new.data is distinct from old.data then
      raise exception 'RDO aprovado está bloqueado para edição.';
    end if;

    if tg_op='UPDATE'
      and old.data->>'status'='Enviado'
      and new.data->>'status'='Devolvido' then
      if not clique_obras_private.is_org_admin(new.organization_id) then
        raise exception 'Somente administrador pode reprovar o RDO.';
      end if;
      if coalesce(trim(new.data->>'rejectionComment'),'')='' then
        raise exception 'Informe o comentário da reprovação.';
      end if;
    end if;

    if new.data->>'status'='Aprovado'
      and (tg_op='INSERT' or old.data->>'status'<>'Aprovado') then
      if not clique_obras_private.is_org_admin(new.organization_id) then
        raise exception 'Somente administrador pode aprovar o RDO.';
      end if;

      select * into posting
      from public.rdo_cost_postings cost
      where cost.organization_id=new.organization_id
        and cost.rdo_id=new.record_id;

      if posting.rdo_id is null then
        raise exception 'O custo do RDO precisa ser contabilizado antes da aprovação.';
      end if;

      if not exists (
        select 1 from public.app_records financial
        where financial.organization_id=new.organization_id
          and financial.store='rdo_financial'
          and financial.record_id=new.record_id
      ) then
        raise exception 'O snapshot financeiro do RDO não foi encontrado.';
      end if;

      if not exists (
        select 1 from public.app_records purchase
        where purchase.organization_id=new.organization_id
          and purchase.store='purchases'
          and purchase.record_id=posting.purchase_record_id
          and purchase.data->>'sourceRdoId'=new.record_id
          and abs(coalesce((purchase.data->>'value')::numeric,-1)-posting.amount)<=0.01
      ) then
        raise exception 'O custo realizado do RDO não foi encontrado.';
      end if;
    end if;
  end if;

  if new.store='rdo_financial' and tg_op='UPDATE'
    and new.data is distinct from old.data then
    raise exception 'Snapshot financeiro aprovado é imutável.';
  end if;

  if new.store='measurements' then
    select project.data into project_data
    from public.app_records project
    where project.organization_id=new.organization_id
      and project.store='projects'
      and project.record_id=new.data->>'projectId';

    if tg_op='INSERT'
      and project_data->>'type'='HH'
      and coalesce(new.data->>'source','')<>'rdo-hh' then
      raise exception 'Projetos HH devem ser medidos pelos RDOs aprovados.';
    end if;

    if new.data->>'source'='rdo-hh' then
      if not clique_obras_private.is_org_admin(new.organization_id) then
        raise exception 'Somente administrador pode criar medição HH.';
      end if;
      if project_data is null or project_data->>'type'<>'HH'
        or jsonb_typeof(new.data->'rdoIds')<>'array'
        or jsonb_array_length(new.data->'rdoIds')=0 then
        raise exception 'Medição HH inválida.';
      end if;

      select count(*) into report_count
      from public.app_records report
      where report.organization_id=new.organization_id
        and report.store='rdos'
        and report.record_id in (
          select jsonb_array_elements_text(new.data->'rdoIds')
        )
        and report.data->>'projectId'=new.data->>'projectId'
        and report.data->>'status'='Aprovado'
        and report.data->>'date' between new.data->>'periodFrom' and new.data->>'periodTo';

      select count(*) into link_count
      from public.rdo_measurement_links link
      where link.organization_id=new.organization_id
        and link.measurement_id=new.record_id
        and link.rdo_id in (
          select jsonb_array_elements_text(new.data->'rdoIds')
        );

      select count(*),coalesce(sum((financial.data->>'saleTotal')::numeric),0)
        into snapshot_count,expected_sale
      from public.app_records financial
      where financial.organization_id=new.organization_id
        and financial.store='rdo_financial'
        and financial.record_id in (
          select jsonb_array_elements_text(new.data->'rdoIds')
        );

      measured_value=coalesce((new.data->>'value')::numeric,-1);
      if report_count<>jsonb_array_length(new.data->'rdoIds')
        or link_count<>jsonb_array_length(new.data->'rdoIds')
        or snapshot_count<>jsonb_array_length(new.data->'rdoIds')
        or abs(expected_sale-measured_value)>0.01 then
        raise exception 'Os RDOs, vínculos e valores da medição HH não conferem.';
      end if;

      if tg_op='UPDATE' and (
        new.data->>'projectId' is distinct from old.data->>'projectId'
        or new.data->>'value' is distinct from old.data->>'value'
        or new.data->'rdoIds' is distinct from old.data->'rdoIds'
        or new.data->>'periodFrom' is distinct from old.data->>'periodFrom'
        or new.data->>'periodTo' is distinct from old.data->>'periodTo'
        or new.data->>'source' is distinct from old.data->>'source'
      ) then
        raise exception 'A composição da medição HH está bloqueada.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function clique_obras_private.protect_rdo_app_records()
  from public,anon,authenticated;

create or replace function clique_obras_private.delete_rdo_measurement(
  target_organization_id uuid,
  target_measurement_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  measurement_data jsonb;
  released_count integer;
begin
  if (select auth.uid()) is null
    or not clique_obras_private.is_org_admin(target_organization_id) then
    raise exception 'Somente administrador pode excluir medição HH.';
  end if;

  if coalesce(length(trim(target_measurement_id)),0)=0 then
    raise exception 'Medição inválida.';
  end if;

  select record.data into measurement_data
  from public.app_records record
  where record.organization_id=target_organization_id
    and record.store='measurements'
    and record.record_id=target_measurement_id
  for update;

  if measurement_data is null then
    raise exception 'Medição não encontrada.';
  end if;
  if measurement_data->>'source'<>'rdo-hh' then
    raise exception 'Esta operação é exclusiva para medição por RDO.';
  end if;
  if measurement_data->>'status'='Faturada' then
    raise exception 'Medição HH faturada não pode ser excluída.';
  end if;

  delete from public.rdo_measurement_links link
  where link.organization_id=target_organization_id
    and link.measurement_id=target_measurement_id;
  get diagnostics released_count=row_count;

  delete from public.app_records record
  where record.organization_id=target_organization_id
    and record.store='measurements'
    and record.record_id=target_measurement_id;

  return jsonb_build_object(
    'measurement_id',target_measurement_id,
    'released_rdos',released_count
  );
end;
$$;

revoke all on function clique_obras_private.delete_rdo_measurement(uuid,text)
  from public,anon;
grant execute on function clique_obras_private.delete_rdo_measurement(uuid,text)
  to authenticated;

create or replace function public.clique_obras_delete_rdo_measurement(
  target_organization_id uuid,
  target_measurement_id text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select clique_obras_private.delete_rdo_measurement(
    target_organization_id,
    target_measurement_id
  );
$$;

revoke all on function public.clique_obras_delete_rdo_measurement(uuid,text)
  from public,anon;
grant execute on function public.clique_obras_delete_rdo_measurement(uuid,text)
  to authenticated;

commit;
