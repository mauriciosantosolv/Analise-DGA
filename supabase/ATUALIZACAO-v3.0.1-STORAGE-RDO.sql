-- CliqueObras v3.0.1
-- Hotfix para exclusão administrativa de RDO com fotos.
-- Os arquivos físicos são removidos pela Edge Function delete-rdo, porque o
-- Supabase Storage não permite DELETE direto em storage.objects.

begin;

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
  rdo_data jsonb;
  object_paths jsonb := '[]'::jsonb;
  attachment_count integer := 0;
  purchase_count integer := 0;
begin
  if (select auth.uid()) is null
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
    'object_paths',object_paths
  );
end;
$$;

revoke all on function clique_obras_private.delete_rdo(uuid,text)
  from public,anon;
grant execute on function clique_obras_private.delete_rdo(uuid,text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
