-- CliqueObras v4.1.1 — correção de regressão introduzida na v4.0.2.
--
-- JÁ APLICADO em produção em 21/08/2026. Arquivo versionado para o GitHub.
--
-- Sintoma: criar ou editar um item de planejamento manualmente falhava com
--   "permission denied for function category_key_v402".
--
-- Causa: o índice app_records_planning_project_categorykey_idx usa
-- clique_obras_private.category_key_v402() na expressão. A manutenção de um
-- índice de expressão roda com o papel de quem faz a gravação, e a função
-- estava revogada para `authenticated`.
--
-- O abatimento automático (RDO, importação e Omie) não era afetado porque roda
-- dentro de funções SECURITY DEFINER, cujo dono já tinha a permissão. Por isso
-- o erro só aparecia na edição manual.
--
-- A função é um normalizador de texto puro: IMMUTABLE, search_path vazio, sem
-- acesso a nenhuma tabela. Conceder execução não expõe dado algum.

begin;

grant execute on function clique_obras_private.category_key_v402(text)
to authenticated, service_role;

comment on function clique_obras_private.category_key_v402(text)
is 'Chave normalizada de categoria (espelha Biz.categoryKey). Execução liberada porque o índice de expressão de planning a exige em toda gravação.';

commit;
