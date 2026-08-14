-- Complemento aplicado após o advisor do Supabase.
create index if not exists omie_connections_created_by_idx on public.omie_connections(created_by);
create index if not exists omie_project_mappings_updated_by_idx on public.omie_project_mappings(updated_by);
create index if not exists omie_category_mappings_updated_by_idx on public.omie_category_mappings(updated_by);
create index if not exists omie_sync_runs_triggered_by_idx on public.omie_sync_runs(triggered_by);
create index if not exists omie_integration_audit_org_idx on public.omie_integration_audit(organization_id,occurred_at desc);
create index if not exists omie_integration_audit_actor_idx on public.omie_integration_audit(actor_id);

drop policy if exists omie_connections_private_deny on public.omie_connections;
create policy omie_connections_private_deny on public.omie_connections for all to anon,authenticated using(false) with check(false);
drop policy if exists omie_project_mappings_private_deny on public.omie_project_mappings;
create policy omie_project_mappings_private_deny on public.omie_project_mappings for all to anon,authenticated using(false) with check(false);
drop policy if exists omie_category_mappings_private_deny on public.omie_category_mappings;
create policy omie_category_mappings_private_deny on public.omie_category_mappings for all to anon,authenticated using(false) with check(false);
drop policy if exists omie_sync_runs_private_deny on public.omie_sync_runs;
create policy omie_sync_runs_private_deny on public.omie_sync_runs for all to anon,authenticated using(false) with check(false);
drop policy if exists omie_integration_audit_private_deny on public.omie_integration_audit;
create policy omie_integration_audit_private_deny on public.omie_integration_audit for all to anon,authenticated using(false) with check(false);
