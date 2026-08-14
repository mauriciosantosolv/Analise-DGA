import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const frontend=read('modules/integracoes/omie.js');
const cloud=read('database/cloud.js');
const index=read('index.html');
const edge=read('supabase/functions/omie-integration/index.ts');
const migration=read('supabase/ATUALIZACAO-v3.0.7-OMIE-HISTORICO-FILTROS.sql');

assert(!frontend.includes('localStorage.setItem'), 'Credenciais Omie não podem ir para localStorage');
assert(!frontend.includes('DB.put('), 'Credenciais/mapeamentos Omie não podem passar pelo banco genérico do navegador');
assert(!index.match(/connect-src[^>]*omie\.com/i), 'O navegador não deve ter permissão CSP para chamar o Omie diretamente');
assert(cloud.includes("Cloud.omieRequest")===false, 'A implementação deve expor apenas omieRequest no objeto Cloud, sem autorreferência insegura');
assert(edge.includes('membership.role!=="owner"'), 'A Edge Function deve exigir proprietário');
assert(edge.includes('clique_obras_validate_omie_cron'), 'A automação deve usar autenticação própria');
assert(edge.includes('clique_obras_reconcile_omie_entries'), 'Rateios removidos devem ser reconciliados antes da aplicação');
assert(edge.includes('enforceRateLimit'), 'As ações devem ter limite de requisições');
assert(edge.includes('safeOmieError(error)'), 'Erros devem ser sanitizados antes do log/retorno');
assert(migration.match(/alter table public\.omie_connections force row level security/i));
assert(migration.match(/revoke all on public\.omie_connections[\s\S]*from public, anon, authenticated/i));
assert(migration.match(/grant execute on function public\.clique_obras_omie_credentials\(uuid\) to service_role/i));
assert(!migration.match(/grant execute on function public\.clique_obras_omie_credentials\(uuid\) to (anon|authenticated)/i));
assert(migration.includes("vault.create_secret"));
assert(migration.includes("externalItemId"));
assert(migration.includes("pg_advisory_xact_lock"));
assert(migration.includes("'planning_history'"));
assert(migration.includes('create or replace function public.clique_obras_reconcile_omie_entries'));

console.log('Omie security boundary tests passed');
