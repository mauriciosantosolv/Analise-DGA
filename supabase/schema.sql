-- Clique Obras — estrutura segura para sincronização em nuvem.
-- Execute este arquivo no SQL Editor do Supabase antes de ativar cloud-config.js.

create table if not exists public.app_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  store text not null check (store in (
    'projects','budgets','purchases','planning','clients',
    'categories','settings','measurements'
  )),
  record_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, store, record_id)
);

alter table public.app_records enable row level security;

revoke all on table public.app_records from anon;
grant select, insert, update, delete on table public.app_records to authenticated;

drop policy if exists "Clique Obras: ler dados próprios" on public.app_records;
create policy "Clique Obras: ler dados próprios"
on public.app_records for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Clique Obras: inserir dados próprios" on public.app_records;
create policy "Clique Obras: inserir dados próprios"
on public.app_records for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Clique Obras: atualizar dados próprios" on public.app_records;
create policy "Clique Obras: atualizar dados próprios"
on public.app_records for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Clique Obras: excluir dados próprios" on public.app_records;
create policy "Clique Obras: excluir dados próprios"
on public.app_records for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists app_records_updated_idx
on public.app_records (user_id, updated_at);
