-- CliqueObras v3.0.7.4
-- Libera o store interno de historico financeiro criado pela integracao Omie.

alter table public.app_records
  drop constraint app_records_store_check;

alter table public.app_records
  add constraint app_records_store_check
  check (store=any(array[
    'projects','budgets','purchases','planning','planning_history','clients',
    'categories','settings','measurements','rdos','crew','labor_rates',
    'rdo_financial'
  ]::text[]));
