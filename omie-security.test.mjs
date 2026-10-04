import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const frontend=read('modules/integracoes/omie.js');
const cloud=read('database/cloud.js');
const index=read('index.html');
const edge=read('supabase/functions/omie-integration/index.ts');
const migration=read('supabase/ATUALIZACAO-v3.0.7-OMIE-HISTORICO-FILTROS.sql');
const migration308=read('supabase/ATUALIZACAO-v3.0.8-OMIE-RDO.sql');
const migration3084=read('supabase/ATUALIZACAO-v3.0.8.4-OMIE-JORNADA.sql');
const migration401=read('supabase/ATUALIZACAO-v4.0.1-RDO-FOLGAS-OMIE.sql');
const migration426=read('supabase/ATUALIZACAO-v4.2.6-OMIE-ORFAOS.sql');

assert(!frontend.includes('localStorage.setItem'), 'Credenciais Omie não podem ir para localStorage');
assert(!frontend.includes('DB.put('), 'Credenciais/mapeamentos Omie não podem passar pelo banco genérico do navegador');
assert(!index.match(/connect-src[^>]*omie\.com/i), 'O navegador não deve ter permissão CSP para chamar o Omie diretamente');
assert(cloud.includes("Cloud.omieRequest")===false, 'A implementação deve expor apenas omieRequest no objeto Cloud, sem autorreferência insegura');
assert(edge.includes('membership.role!=="owner"'), 'A Edge Function deve exigir proprietário');
assert(edge.includes('clique_obras_validate_omie_cron'), 'A automação deve usar autenticação própria');
assert(edge.includes('clique_obras_reconcile_omie_entries'), 'Rateios removidos devem ser reconciliados antes da aplicação');
assert(edge.includes('enforceRateLimit'), 'As ações devem ter limite de requisições');
assert(edge.includes('safeOmieError(error)'), 'Erros devem ser sanitizados antes do log/retorno');
assert(edge.includes('clique_obras_acquire_omie_sync_lease'), 'Cada organização deve reservar a sincronização antes de chamar o Omie');
assert(edge.includes('last_sync_attempt_at'), 'Tentativas com erro devem respeitar o intervalo automático');
assert(edge.includes('ConsultarCliente'), 'O fornecedor deve vir do cadastro de clientes do Omie');
assert(edge.includes('omie_supplier_cache'), 'O catálogo de fornecedores deve usar cache privado por organização');
assert(edge.includes('isOmieConcurrentMethodError'), 'A falha temporária de concorrência do Omie deve receber retentativa específica');
assert(edge.includes('supplier_backfill_completed_at'), 'Fornecedores históricos devem receber um backfill único');
assert(edge.includes('[...refreshCodes].slice(0,24)'), 'O backfill deve limitar fornecedores por execução');
assert(edge.includes('filtrar_por_projeto:Number(projectCode)'), 'A carga histórica deve limitar as contas a pagar pelo projeto no Omie');
// v4.2.6 — o que está publicado é a rotina de produção. A variante v401
// (data de inclusão info.dInc) existe no repositório apenas como migração
// pronta e NÃO deve estar no fluxo da Edge Function enquanto a decisão de
// adotá-la estiver pendente.
assert(edge.includes('clique_obras_apply_omie_entries"'), 'A aplicação publicada deve usar a rotina de produção');
assert(!edge.includes('clique_obras_apply_omie_entries_v401'), 'A variante v401 não pode entrar em produção sem decisão');
assert(!edge.includes('inclusion_backfill_completed_at'), 'O backfill de inclusão da v4.0.1 não pode entrar em produção sem decisão');
// v4.2.6 — correções desta versão.
assert(edge.includes('runtime.waitUntil(work)'), 'A rota agendada deve responder na hora e sincronizar em segundo plano');
assert(edge.includes('"ListarContasReceber","conta_receber_cadastro",baseReceivableFilter'), 'Contas a receber devem usar uma consulta por período, não uma por projeto');
assert(edge.includes('clique_obras_omie_orphan_candidates_v426'), 'Lançamentos excluídos no Omie devem ser identificados por uma rotina de leitura');
assert(edge.includes('isOmieMissingEntryError(error)'), 'A remoção só pode ocorrer com confirmação do próprio Omie');
assert(edge.includes('active:false'), 'A remoção deve reutilizar a rotina de cancelamento que restaura o planejamento');
assert(edge.includes('for(const projectCode of selected)'), 'As consultas históricas por projeto devem ser seriais');
assert(edge.includes('if(needsHistoricalBackfill||mode==="manual")'), 'Somente cargas históricas/manuais devem consultar por projeto');
assert(edge.includes('rows.filter(row=>selectedSet.has'), 'A sincronização incremental deve filtrar localmente os projetos selecionados');
assert(migration.match(/alter table public\.omie_connections force row level security/i));
assert(migration.match(/revoke all on public\.omie_connections[\s\S]*from public, anon, authenticated/i));
assert(migration.match(/grant execute on function public\.clique_obras_omie_credentials\(uuid\) to service_role/i));
assert(!migration.match(/grant execute on function public\.clique_obras_omie_credentials\(uuid\) to (anon|authenticated)/i));
assert(migration.includes("vault.create_secret"));
assert(migration.includes("externalItemId"));
assert(migration.includes("pg_advisory_xact_lock"));
assert(migration.includes("'planning_history'"));
assert(migration.includes('create or replace function public.clique_obras_reconcile_omie_entries'));
assert(migration308.match(/revoke all on function public\.clique_obras_acquire_omie_sync_lease[\s\S]*from public,anon,authenticated/i));
assert(migration308.match(/alter table public\.omie_supplier_cache force row level security/i));
assert(migration3084.includes("'omieInclusionTime'"));
assert(migration3084.includes("'dueDate'"));
assert(migration3084.includes("'forecastDate'"));
assert(migration3084.match(/revoke all on function public\.clique_obras_apply_omie_entries_v3084[\s\S]*from public,anon,authenticated/i));
assert(migration3084.match(/grant execute on function public\.clique_obras_apply_omie_entries_v3084[\s\S]*to service_role/i));
assert(migration401.match(/create or replace function public\.clique_obras_apply_omie_entries_v401/i));
assert(migration401.match(/future Omie inclusion date/i));
assert(migration401.match(/revoke all on function public\.clique_obras_apply_omie_entries_v401[\s\S]*from public,anon,authenticated/i));
assert(migration401.match(/grant execute on function public\.clique_obras_apply_omie_entries_v401[\s\S]*to service_role/i));
assert(migration426.match(/create or replace function public\.clique_obras_omie_orphan_candidates_v426/i));
assert(migration426.match(/\bstable\b/i), 'A rotina de órfãos deve ser somente leitura');
assert(!migration426.match(/\b(delete|update|insert)\s+(from|into|public)/i), 'A rotina de órfãos não pode gravar nada');
assert(migration426.match(/revoke all on function public\.clique_obras_omie_orphan_candidates_v426[\s\S]*from authenticated/i));
assert(migration426.match(/grant execute on function public\.clique_obras_omie_orphan_candidates_v426[\s\S]*to service_role/i));

console.log('Omie security boundary tests passed');
