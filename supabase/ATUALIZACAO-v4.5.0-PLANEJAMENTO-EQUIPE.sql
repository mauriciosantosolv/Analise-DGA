-- =====================================================================
-- CliqueObras v4.5.0 — Planejamento de Colaboradores
-- =====================================================================
-- O que este script faz, e SOMENTE isto:
--
--   1. libera o store novo 'crew_allocations' no CHECK de public.app_records;
--   2. faz 'crew_allocations' HERDAR a permissão de 'crew' nas três portas de
--      autorização que existem hoje:
--        a) clique_obras_private.can_view_store   (leitura por RPC/funções)
--        b) clique_obras_private.can_edit_store   (INSERT/UPDATE/DELETE, via
--           can_edit_record, usado pelas policies de escrita)
--        c) a policy de SELECT cliqueobras_records_select, que desde a v4.2.20
--           NÃO chama can_view_store: ela tem o mapa store->permissão embutido
--           (foi o que derrubou o readAll de 1.071 ms para 16,9 ms). Se o mapa
--           dela não receber o store novo, quem não é owner/admin simplesmente
--           não enxerga nenhuma alocação — e sem erro nenhum na tela.
--   3. cria dois índices parciais para as consultas do módulo.
--
-- O que este script NÃO faz:
--   - não cria tabela nova (o planejamento cabe no EAV de app_records, como
--     todos os outros stores do sistema);
--   - não cria caixa de permissão nova: nada muda para quem já usa o sistema;
--     quem enxerga Colaboradores passa a enxergar o planejamento deles;
--   - não altera nenhuma policy, função ou índice existente além do mapa
--     acrescentado acima — o restante do texto é idêntico ao da v4.2.20.
--
-- Idempotente: pode ser executado mais de uma vez sem efeito colateral.
-- Rollback ao final do arquivo (comentado).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Store novo no CHECK
-- ---------------------------------------------------------------------
alter table public.app_records
  drop constraint if exists app_records_store_check;

alter table public.app_records
  add constraint app_records_store_check check (store = any (array[
    'projects','budgets','purchases','planning','planning_history','clients',
    'categories','settings','measurements','rdos','crew','labor_rates',
    'rdo_financial','workforce_status','forecasts','measurement_receipts',
    'crew_allocations'
  ]));

-- ---------------------------------------------------------------------
-- 2a. Leitura por função (mapa store -> permissão)
-- ---------------------------------------------------------------------
create or replace function clique_obras_private.can_view_store(target_org uuid, target_store text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id=target_org
        and member.user_id=(select auth.uid())
        and (
          member.role in ('owner','admin')
          or coalesce(member.permissions->'view','[]'::jsonb) ?
            case
              when target_store='workforce_status' then 'rdos'
              when target_store='planning_history' then 'planning'
              when target_store='forecasts' then 'measurements'
              when target_store='measurement_receipts' then 'measurements'
              when target_store='crew_allocations' then 'crew'
              else target_store
            end
        )
    );
$function$;

-- ---------------------------------------------------------------------
-- 2b. Escrita (INSERT/UPDATE/DELETE passam por can_edit_record -> aqui)
-- ---------------------------------------------------------------------
create or replace function clique_obras_private.can_edit_store(target_org uuid, target_store text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id=target_org
        and member.user_id=(select auth.uid())
        and (
          member.role in ('owner','admin')
          or coalesce(member.permissions->'edit','[]'::jsonb) ?
            case
              when target_store='planning_history' then 'planning'
              when target_store='forecasts' then 'measurements'
              when target_store='measurement_receipts' then 'measurements'
              when target_store='crew_allocations' then 'crew'
              else target_store
            end
        )
    );
$function$;

-- ---------------------------------------------------------------------
-- 2c. Policy de SELECT — o mapa embutido da v4.2.20 recebe o store novo.
--     Fora a linha do 'crew_allocations', o texto é o mesmo da v4.2.20:
--     um único access_grants_v4220() por linha, sem can_view_record.
-- ---------------------------------------------------------------------
drop policy if exists cliqueobras_records_select on public.app_records;

create policy cliqueobras_records_select on public.app_records
  for select
  using (
    coalesce(
      (
        ((select clique_obras_private.access_grants_v4220()) #> array[organization_id::text,'v'])
          ?| array['*',
            case store
              when 'workforce_status' then 'rdos'
              when 'planning_history' then 'planning'
              when 'forecasts' then 'measurements'
              when 'measurement_receipts' then 'measurements'
              when 'crew_allocations' then 'crew'
              else store
            end]
      )
      and (
        store <> 'rdos'
        or (
          coalesce(length(btrim(data->>'projectId')),0) > 0
          and ((select clique_obras_private.access_grants_v4220()) #> array[organization_id::text,'p'])
                ?| array['*', data->>'projectId']
        )
      ),
      false
    )
  );

-- ---------------------------------------------------------------------
-- 3. Índices do módulo
--    O índice (organization_id, store, data->>'projectId') já existe e cobre
--    a busca por obra em QUALQUER store, inclusive este. Faltam a busca por
--    colaborador e a varredura por período.
-- ---------------------------------------------------------------------
create index if not exists app_records_crew_alloc_employee_idx
  on public.app_records (organization_id, (data->>'employeeId'), (data->>'start'))
  where store = 'crew_allocations';

create index if not exists app_records_crew_alloc_period_idx
  on public.app_records (organization_id, (data->>'start'), (data->>'end'))
  where store = 'crew_allocations';

commit;

-- =====================================================================
-- CONFERÊNCIA (rodar depois do commit)
-- =====================================================================
-- 1. o store foi liberado?
--    select pg_get_constraintdef(oid) from pg_constraint
--     where conname='app_records_store_check';
--
-- 2. o mapa de permissão pegou? (troque o uuid pelo do usuário a testar)
--    select set_config('request.jwt.claims',
--      json_build_object('sub','<uuid-do-usuario>','role','authenticated')::text,true);
--    select clique_obras_private.can_view_store('<uuid-da-org>','crew_allocations'),
--           clique_obras_private.can_edit_store('<uuid-da-org>','crew_allocations');
--    (rodando como postgres, sem set_config, auth.uid() é null e as duas
--     funções devolvem false — isso é o esperado, não é erro.)
--
-- 3. a policy de SELECT continua com um único access_grants por linha?
--    explain analyze select count(*) from public.app_records
--     where organization_id='<uuid-da-org>';
--
-- =====================================================================
-- ROLLBACK (desfaz tudo, sem perder dado já gravado)
-- =====================================================================
-- begin;
--   drop index if exists public.app_records_crew_alloc_employee_idx;
--   drop index if exists public.app_records_crew_alloc_period_idx;
--   -- recria as três portas SEM a linha do crew_allocations e volta o CHECK
--   -- ao conjunto de 16 stores da v4.2.21. Atenção: se já existirem linhas
--   -- com store='crew_allocations', apague-as antes de repor o CHECK:
--   --   delete from public.app_records where store='crew_allocations';
-- commit;
