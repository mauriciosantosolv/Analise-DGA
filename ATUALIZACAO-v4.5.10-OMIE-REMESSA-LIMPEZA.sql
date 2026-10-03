-- =============================================================================
-- CliqueObras v4.5.10 — JÁ APLICADO EM PRODUÇÃO em 03/10/2026 (projeto mwelgpjkqljtkzbqxmag).
-- Guardado aqui só como registro. NÃO precisa rodar de novo (é idempotente se rodar).
--
-- Só ACRESCENTA: coluna nova, tabela de registro e um job do pg_cron.
-- Nenhuma função, política ou tabela existente foi alterada.
-- Edge Function NOVA: omie-remessa-limpeza (v1, verify_jwt=false, autentica pelo
-- mesmo segredo x-omie-cron do agendador). omie-integration intocada (v4).
-- =============================================================================

-- Migration v4510_omie_remessa_limpeza
alter table public.omie_remessa_projects add column if not exists payables_cleared_at timestamptz;

create table if not exists public.omie_remessa_cleanup_runs(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  ran_at timestamptz not null default now(),
  dry_run boolean not null default false,
  status text not null default 'success',
  details jsonb not null default '{}'::jsonb
);
create index if not exists omie_remessa_cleanup_runs_org_idx on public.omie_remessa_cleanup_runs(organization_id, ran_at desc);
alter table public.omie_remessa_cleanup_runs enable row level security;
alter table public.omie_remessa_cleanup_runs force row level security;
drop policy if exists omie_remessa_cleanup_runs_private_deny on public.omie_remessa_cleanup_runs;
create policy omie_remessa_cleanup_runs_private_deny on public.omie_remessa_cleanup_runs
  for all to anon, authenticated using (false) with check (false);
revoke all on public.omie_remessa_cleanup_runs from anon, authenticated;
grant select, insert, update, delete on public.omie_remessa_cleanup_runs to service_role;

-- Job do pg_cron (minutos 15, 35 e 55 — fora dos horários da sincronização)
-- select cron.schedule('clique-obras-omie-remessa-limpeza','15,35,55 * * * *', $cmd$
--   select net.http_post(
--     url:='https://mwelgpjkqljtkzbqxmag.supabase.co/functions/v1/omie-remessa-limpeza',
--     headers:=jsonb_build_object('Content-Type','application/json','x-omie-cron',(select decrypted_secret from vault.decrypted_secrets where name='clique_obras_omie_cron_token')),
--     body:='{}'::jsonb, timeout_milliseconds:=120000);
-- $cmd$);

-- Dado restaurado (vínculos de categoria apagados pelo salvamento do DE-PARA de
-- 02/10/2026 15:56, 152 -> 143 categorias). Os dois códigos são os que as 15
-- remessas já lançadas usavam.
-- insert into public.omie_category_mappings(...) values
--   ('1.01.01' Clientes vendas de mercadorias fabricadas -> Compras de Material),
--   ('1.01.02' Clientes serviços prestados              -> Compras de Material);

-- Para desfazer a limpeza automática (não apaga nada já feito):
--   select cron.unschedule('clique-obras-omie-remessa-limpeza');
-- Para trazer de volta as contas de um projeto: desative o custo por remessa dele e
-- rode a sincronização manual daquele projeto.
