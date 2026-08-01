-- CliqueObras v3.0.2
-- Limitação persistente para operações administrativas executadas pelas
-- Edge Functions. A tabela fica fora da Data API e a RPC só pode ser chamada
-- com a service role mantida no ambiente seguro do Supabase.

begin;

create table if not exists clique_obras_private.request_rate_limits (
  actor_id uuid not null,
  action text not null check (
    length(action) between 3 and 180
    and action ~ '^[a-z0-9:_-]+$'
  ),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count between 1 and 100000),
  updated_at timestamptz not null default now(),
  primary key (actor_id,action,window_started_at)
);

revoke all on table clique_obras_private.request_rate_limits
  from public,anon,authenticated,service_role;

create or replace function public.clique_obras_check_request_limit(
  target_user_id uuid,
  target_action text,
  max_requests integer,
  window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  current_window timestamptz;
  current_count integer;
  retry_after_seconds integer;
begin
  if target_user_id is null then
    raise exception 'Usuário inválido.';
  end if;
  if target_action is null
    or length(target_action) not between 3 and 180
    or target_action !~ '^[a-z0-9:_-]+$' then
    raise exception 'Ação inválida.';
  end if;
  if max_requests not between 1 and 1000
    or window_seconds not between 1 and 86400 then
    raise exception 'Limite inválido.';
  end if;

  current_window := pg_catalog.to_timestamp(
    pg_catalog.floor(
      pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()) / window_seconds
    ) * window_seconds
  );

  delete from clique_obras_private.request_rate_limits limits
  where limits.actor_id=target_user_id
    and limits.window_started_at < current_window - interval '2 days';

  insert into clique_obras_private.request_rate_limits(
    actor_id,action,window_started_at,request_count,updated_at
  ) values (
    target_user_id,target_action,current_window,1,pg_catalog.clock_timestamp()
  )
  on conflict (actor_id,action,window_started_at)
  do update set
    request_count=clique_obras_private.request_rate_limits.request_count+1,
    updated_at=excluded.updated_at
  returning request_count into current_count;

  retry_after_seconds := greatest(
    1,
    pg_catalog.ceil(
      pg_catalog.date_part(
        'epoch',(
          current_window
          + pg_catalog.make_interval(secs => window_seconds)
          - pg_catalog.clock_timestamp()
        )
      )
    )::integer
  );

  return pg_catalog.jsonb_build_object(
    'allowed',current_count<=max_requests,
    'remaining',greatest(0,max_requests-current_count),
    'retry_after_seconds',retry_after_seconds
  );
end;
$$;

revoke all on function public.clique_obras_check_request_limit(uuid,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.clique_obras_check_request_limit(uuid,text,integer,integer)
  to service_role;

comment on function public.clique_obras_check_request_limit(uuid,text,integer,integer)
  is 'Uso exclusivo das Edge Functions para limitar operações administrativas por usuário.';

notify pgrst, 'reload schema';

commit;
