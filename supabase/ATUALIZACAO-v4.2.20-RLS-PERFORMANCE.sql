-- =============================================================================
-- CliqueObras v4.2.20 - RLS de leitura resolvida uma vez por query
-- Projeto Supabase: mwelgpjkqljtkzbqxmag (CliqueObras BR, sa-east-1)
-- Aplicado em producao em 02/09/2026.
-- =============================================================================
--
-- POR QUE
-- -------
-- pg_stat_statements mostrava que a query do Cloud.readAll() era 21 minutos de
-- CPU em 1.459 chamadas (media 875 ms, pico 2,9 s) - ~98% de todo o tempo do
-- banco junto com o WAL do realtime. O EXPLAIN (ANALYZE, BUFFERS) mostrou onde:
--
--   Bitmap Index Scan .......................... 0,295 ms   <- o indice esta OK
--   Filter: can_view_record(org, store, data) .. 1.046 ms   <- 99% do custo
--   Sort: external merge, 3.312 kB em disco ....    21 ms
--   -------------------------------------------------------
--   Execution Time ............................. 1.071 ms
--
-- can_view_record e STABLE, mas recebe `store` e `data`, que mudam a cada linha.
-- O cache de STABLE nunca acerta, entao ela roda 4.897 vezes (~214 us cada) e
-- cada chamada faz um EXISTS em organization_members. Por nao ser LEAKPROOF ela
-- ainda impedia o planner de usar app_records_org_updated_idx, o que forcava o
-- bitmap scan e o sort em disco.
--
-- O QUE MUDA
-- ----------
-- NADA na regra de permissao. Apenas ONDE ela e avaliada:
--   antes: uma chamada de funcao por LINHA;
--   agora: uma consulta a organization_members por QUERY (InitPlan), e por
--          linha so uma busca em jsonb.
--
-- can_view_store, can_view_record e can_access_rdo_project continuam intactas,
-- nao foram alteradas, e sao o caminho de rollback (secao no fim do arquivo).
--
-- RESULTADO MEDIDO (mesma query, mesma pagina, org 501a5696-..., 4.897 linhas)
-- ---------------------------------------------------------------------------
--   antes ............... 1.071 ms   10.865 buffers   sort em disco
--   depois ..............    16,9 ms  2.077 buffers   Incremental Sort na RAM
--   piso teorico (sem RLS)  10,8 ms
--   -> 63x mais rapido, 5x menos I/O
--
-- EQUIVALENCIA PROVADA
-- --------------------
-- Para os 18 usuarios com vinculo em organization_members, comparou-se o md5 da
-- lista ordenada de (organization_id|store|record_id) visivel sob a RLS antes e
-- depois: 18/18 IDENTICO, 35.602 linhas visiveis nos dois lados.
--
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Concessoes do usuario logado, resolvidas UMA vez por query.
--    Nao recebe argumento: so consegue devolver as permissoes de auth.uid(),
--    nunca as de outro usuario. Envolvida em (select ...) na policy, o Postgres
--    a transforma em InitPlan e executa uma vez so.
--
--    Formato devolvido, por organizacao:
--      { "<org_uuid>": { "v": [stores visiveis], "p": [obras liberadas no RDO] } }
--    O token '*' significa owner/admin (tudo liberado). Nao ha colisao possivel:
--    o CHECK app_records_store_check nao permite um store chamado '*', a funcao
--    clique_obras_private.valid_permissions fecha a lista de stores, e o '*' e
--    removido das listas de quem nao e owner/admin logo abaixo.
-- -----------------------------------------------------------------------------
create or replace function clique_obras_private.access_grants_v4220()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when (select auth.uid()) is null then null
    else coalesce((
      select jsonb_object_agg(
               m.organization_id::text,
               jsonb_build_object(
                 'v', case when m.role in ('owner','admin') then '["*"]'::jsonb
                           else coalesce((
                             select jsonb_agg(s)
                               from jsonb_array_elements_text(
                                      case when jsonb_typeof(m.permissions->'view') = 'array'
                                           then m.permissions->'view' else '[]'::jsonb end) s
                              where s <> '*'), '[]'::jsonb)
                      end,
                 'p', case when m.role in ('owner','admin') then '["*"]'::jsonb
                           else coalesce((
                             select jsonb_agg(a->>'id')
                               from jsonb_array_elements(
                                      case when jsonb_typeof(m.permissions->'rdo_projects') = 'array'
                                           then m.permissions->'rdo_projects' else '[]'::jsonb end) a
                              where a->>'id' is not null and a->>'id' <> '*'), '[]'::jsonb)
                      end
               ))
        from public.organization_members m
       where m.user_id = (select auth.uid())
    ), '{}'::jsonb)
  end;
$fn$;

revoke all on function clique_obras_private.access_grants_v4220() from public;
grant execute on function clique_obras_private.access_grants_v4220() to authenticated;

-- -----------------------------------------------------------------------------
-- 2) A policy de SELECT. Mesmo nome de antes, mesma semantica.
--
--    A expressao vai embutida de proposito, sem funcao auxiliar: o Postgres
--    guarda a arvore da policy ja resolvida (OIDs fixos), entao nao ha chamada
--    de funcao por linha nem resolucao de search_path em tempo de execucao.
--    Uma versao com funcao auxiliar foi medida em 87 ms; embutida, 16,9 ms.
--
--    Bloco (a) espelha can_view_store, incluindo o mapeamento de stores.
--    Bloco (b) espelha can_access_rdo_project, incluindo a exigencia de
--              projectId nao vazio (RDO sem obra nao aparece nem para o owner).
-- -----------------------------------------------------------------------------
drop policy if exists cliqueobras_records_select on public.app_records;

create policy cliqueobras_records_select
on public.app_records
for select
to authenticated
using (
  coalesce(
    (
      -- (a) o usuario pode ver este store nesta organizacao?
      (
        ((select clique_obras_private.access_grants_v4220()) #> array[organization_id::text, 'v'])
        ?| array['*',
                 case store
                   when 'workforce_status'     then 'rdos'
                   when 'planning_history'     then 'planning'
                   when 'forecasts'            then 'measurements'
                   when 'measurement_receipts' then 'measurements'
                   else store
                 end]
      )
      -- (b) sendo RDO, o usuario pode ver esta obra?
      and (
        store <> 'rdos'
        or (
          coalesce(length(btrim(data ->> 'projectId')), 0) > 0
          and (
            ((select clique_obras_private.access_grants_v4220()) #> array[organization_id::text, 'p'])
            ?| array['*', data ->> 'projectId']
          )
        )
      )
    ), false)
);

comment on policy cliqueobras_records_select on public.app_records is
  'v4.2.20 - mesma regra de can_view_record, avaliada uma vez por query em vez de por linha.';

-- -----------------------------------------------------------------------------
-- 3) Endurecimento: nenhuma RPC SECURITY DEFINER precisa do papel anon.
--
--    As quatro ja recusavam quem nao esta logado (todas chamam
--    can_view_store(org,'rdos'), que exige auth.uid()), entao NAO havia
--    vazamento. Mas SECURITY DEFINER + anon e superficie que nao precisa
--    existir: bastaria uma refatoracao trocar o `raise` por um `return` vazio
--    para virar leitura publica de dado de qualquer organizacao.
-- -----------------------------------------------------------------------------
revoke execute on function public.clique_obras_next_rdo_number_v427(uuid, integer)     from anon;
revoke execute on function public.clique_obras_rdo_hh_gaps_v427(uuid, text, text[])    from anon;
revoke execute on function public.clique_obras_rdo_occupied_employees(uuid, text, text) from anon;
revoke execute on function public.clique_obras_rdo_shift_defaults_v4218(uuid)          from anon;

-- -----------------------------------------------------------------------------
-- 4) Endurecimento: RLS na tabela de controle de rate limit.
--    anon/authenticated nunca tiveram grant nela (nem USAGE no schema), entao
--    isto e defesa em profundidade. A dona (postgres) continua acessando pela
--    funcao clique_obras_check_request_limit, que e SECURITY DEFINER - testado.
--    Sem policy de proposito: ninguem alem da dona deve tocar nesta tabela.
-- -----------------------------------------------------------------------------
alter table clique_obras_private.request_rate_limits enable row level security;

commit;


-- =============================================================================
-- ROLLBACK (volta exatamente ao comportamento da v4.2.19)
-- =============================================================================
-- begin;
--   drop policy if exists cliqueobras_records_select on public.app_records;
--   create policy cliqueobras_records_select
--   on public.app_records
--   for select
--   to authenticated
--   using (clique_obras_private.can_view_record(organization_id, store, data));
--
--   grant execute on function public.clique_obras_next_rdo_number_v427(uuid, integer)      to anon;
--   grant execute on function public.clique_obras_rdo_hh_gaps_v427(uuid, text, text[])     to anon;
--   grant execute on function public.clique_obras_rdo_occupied_employees(uuid, text, text) to anon;
--   grant execute on function public.clique_obras_rdo_shift_defaults_v4218(uuid)           to anon;
--
--   alter table clique_obras_private.request_rate_limits disable row level security;
-- commit;


-- =============================================================================
-- CONFERENCIA (rode depois de aplicar; nao altera nada)
-- =============================================================================
-- Compara, usuario a usuario, o conjunto de linhas visiveis sob a RLS.
-- Guarde o resultado com fase='antes' ANTES de aplicar e 'depois' DEPOIS.
--
-- create table if not exists clique_obras_private.__rls_check(
--   fase text, user_id uuid, n int, h text, primary key (fase, user_id));
--
-- create or replace function clique_obras_private.__rls_snap(p_fase text)
-- returns void language plpgsql set search_path=pg_catalog,public as $fn$
-- declare r record; v_n int; v_h text;
-- begin
--   delete from clique_obras_private.__rls_check where fase = p_fase;
--   for r in select distinct m.user_id from public.organization_members m order by 1 loop
--     perform set_config('request.jwt.claims',
--             json_build_object('sub', r.user_id, 'role','authenticated')::text, true);
--     set local role authenticated;
--     select count(*),
--            coalesce(md5(string_agg(organization_id::text||'|'||store||'|'||record_id, E'\n'
--                    order by organization_id, store, record_id)),'vazio')
--       into v_n, v_h from public.app_records;
--     set local role postgres;
--     insert into clique_obras_private.__rls_check values (p_fase, r.user_id, v_n, v_h);
--   end loop;
--   perform set_config('request.jwt.claims', '', true);
-- end $fn$;
--
-- select clique_obras_private.__rls_snap('antes');   -- antes de aplicar
-- select clique_obras_private.__rls_snap('depois');  -- depois de aplicar
-- select count(*) filter (where a.h = d.h and a.n = d.n) as identicos,
--        count(*) filter (where a.h <> d.h or a.n <> d.n) as divergentes
--   from clique_obras_private.__rls_check a
--   join clique_obras_private.__rls_check d on d.user_id = a.user_id and d.fase='depois'
--  where a.fase = 'antes';
--
-- Limpeza:
-- drop function if exists clique_obras_private.__rls_snap(text);
-- drop table    if exists clique_obras_private.__rls_check;
-- =============================================================================
