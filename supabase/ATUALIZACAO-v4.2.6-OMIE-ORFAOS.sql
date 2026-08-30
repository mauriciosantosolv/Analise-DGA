-- =====================================================================

create or replace function public.clique_obras_omie_orphan_candidates_v426(
  target_organization_id uuid,
  project_ids text[],
  date_from text,
  date_to text,
  present_ids text[],
  max_rows integer default 40
) returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  rows_out jsonb;
  safe_rows integer := greatest(1, least(coalesce(max_rows, 40), 200));
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'access denied';
  end if;
  if target_organization_id is null then
    raise exception 'organization required';
  end if;
  if project_ids is null or array_length(project_ids, 1) is null then
    return '[]'::jsonb;
  end if;
  if date_from is null or date_to is null or date_from = '' or date_to = '' then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(item order by item->>'date', item->>'externalItemId'), '[]'::jsonb)
    into rows_out
  from (
    select jsonb_build_object(
             'recordId', record.record_id,
             'externalId', record.data->>'externalId',
             'externalItemId', record.data->>'externalItemId',
             'projectId', record.data->>'projectId',
             'category', record.data->>'category',
             'value', coalesce(record.data->'value', '0'::jsonb),
             'date', record.data->>'date',
             'supplier', record.data->>'supplier'
           ) as item
    from public.app_records record
    where record.organization_id = target_organization_id
      and record.store = 'purchases'
      and record.data->>'externalSource' = 'omie'
      and coalesce(record.data->>'sourceType', '') = 'omiePayable'
      and coalesce(record.data->>'externalId', '') <> ''
      and record.data->>'projectId' = any(project_ids)
      and coalesce(record.data->>'date', '') between date_from and date_to
      and not (coalesce(record.data->>'externalId', '') = any(coalesce(present_ids, array[]::text[])))
    order by record.data->>'date', record.data->>'externalItemId'
    limit safe_rows
  ) candidates;

  return rows_out;
end;
$$;

revoke all on function public.clique_obras_omie_orphan_candidates_v426(uuid, text[], text, text, text[], integer) from public;
revoke all on function public.clique_obras_omie_orphan_candidates_v426(uuid, text[], text, text, text[], integer) from anon;
revoke all on function public.clique_obras_omie_orphan_candidates_v426(uuid, text[], text, text, text[], integer) from authenticated;
grant execute on function public.clique_obras_omie_orphan_candidates_v426(uuid, text[], text, text, text[], integer) to service_role;

comment on function public.clique_obras_omie_orphan_candidates_v426(uuid, text[], text, text, text[], integer) is
  'v4.2.6 — Lista contas a pagar do Omie que estao no CliqueObras mas nao vieram na ultima listagem do periodo. Somente leitura; a Edge Function confirma no Omie antes de cancelar.';
