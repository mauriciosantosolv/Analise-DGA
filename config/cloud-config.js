/**
 * Configuração da nuvem do Clique Obras.
 *
 * Use SOMENTE a Publishable key (sb_publishable_...) do Supabase.
 * Nunca coloque Secret key, service_role ou senha do banco neste arquivo.
 * Antes de ativar, execute supabase/schema.sql no projeto Supabase.
 */
window.CLIQUE_OBRAS_CLOUD = {
  enabled: false,
  provider: 'supabase',
  url: 'https://SEU-PROJETO.supabase.co',
  publishableKey: 'sb_publishable_SUBSTITUA_AQUI'
};
