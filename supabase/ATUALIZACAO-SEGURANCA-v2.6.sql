-- CliqueObras v2.6
-- Hardening de perfis, convites, permissões e hierarquia da equipe.
-- Migração idempotente. Execute no SQL Editor antes de publicar o frontend.

begin;

create or replace function clique_obras_private.current_user_email()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select lower(coalesce(u.email,''))
  from auth.users u
  where u.id=(select auth.uid());
$$;

create or replace function clique_obras_private.valid_permissions(input jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_typeof(input)='object'
    and jsonb_typeof(coalesce(input->'view','[]'::jsonb))='array'
    and jsonb_typeof(coalesce(input->'edit','[]'::jsonb))='array'
    and coalesce(input->'manage_users','false'::jsonb) in ('true'::jsonb,'false'::jsonb)
    and not exists (
      select 1 from jsonb_object_keys(input) as permission_key(value)
      where value not in ('view','edit','manage_users')
    )
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(input->'view','[]'::jsonb)) as view_store(value)
      where value not in (
        'projects','budgets','purchases','planning','clients',
        'categories','settings','measurements'
      )
    )
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(input->'edit','[]'::jsonb)) as edit_store(value)
      where value not in (
        'projects','budgets','purchases','planning','clients',
        'categories','settings','measurements'
      )
      or not (coalesce(input->'view','[]'::jsonb) ? value)
    );
$$;

create or replace function clique_obras_private.can_assign_member(
  target_org uuid,
  target_role text,
  target_permissions jsonb
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select clique_obras_private.valid_permissions(target_permissions)
    and exists (
      select 1
      from public.organization_members actor
      where actor.organization_id=target_org
        and actor.user_id=(select auth.uid())
        and (
          actor.role='owner'
          or (
            actor.role in ('admin','editor','viewer')
            and target_role in ('editor','viewer')
            and not coalesce((target_permissions->>'manage_users')::boolean,false)
            and (
              actor.role='admin'
              or coalesce((actor.permissions->>'manage_users')::boolean,false)
            )
          )
        )
    );
$$;

revoke all on function clique_obras_private.current_user_email() from public, anon;
revoke all on function clique_obras_private.valid_permissions(jsonb) from public, anon;
revoke all on function clique_obras_private.can_assign_member(uuid,text,jsonb) from public, anon;
grant execute on function clique_obras_private.current_user_email() to authenticated;
grant execute on function clique_obras_private.valid_permissions(jsonb) to authenticated;
grant execute on function clique_obras_private.can_assign_member(uuid,text,jsonb) to authenticated;

alter table public.organization_members
  drop constraint if exists organization_members_permissions_valid;
alter table public.organization_members
  add constraint organization_members_permissions_valid
  check (clique_obras_private.valid_permissions(permissions)) not valid;
alter table public.organization_members
  validate constraint organization_members_permissions_valid;

alter table public.organization_invitations
  drop constraint if exists organization_invitations_permissions_valid;
alter table public.organization_invitations
  add constraint organization_invitations_permissions_valid
  check (clique_obras_private.valid_permissions(permissions)) not valid;
alter table public.organization_invitations
  validate constraint organization_invitations_permissions_valid;

-- Perfis públicos para a equipe continuam somente leitura. O próprio usuário
-- pode alterar exclusivamente a organização ativa; nome/e-mail vêm do Auth.
revoke update on table public.profiles from authenticated;
grant update(active_organization_id) on table public.profiles to authenticated;

create or replace function clique_obras_private.protect_invitation_acceptance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if lower(old.email)=clique_obras_private.current_user_email()
    and new.organization_id=old.organization_id
    and new.email=old.email
    and new.role=old.role
    and new.permissions=old.permissions
    and new.invited_by=old.invited_by
    and new.status='accepted' then
    return new;
  end if;
  if clique_obras_private.can_manage_users(old.organization_id)
    and clique_obras_private.can_assign_member(
      new.organization_id,new.role,new.permissions
    ) then
    return new;
  end if;
  raise exception 'O convite só pode ser aceito pelo destinatário ou alterado dentro da autoridade do gestor.';
end;
$$;

revoke all on function clique_obras_private.protect_invitation_acceptance()
  from public, anon, authenticated;

drop trigger if exists cliqueobras_protect_invitation on public.organization_invitations;
create trigger cliqueobras_protect_invitation
before update on public.organization_invitations
for each row execute function clique_obras_private.protect_invitation_acceptance();

drop policy if exists "cliqueobras_members_insert" on public.organization_members;
create policy "cliqueobras_members_insert"
on public.organization_members for insert to authenticated
with check (
  (
    role<>'owner'
    and clique_obras_private.can_assign_member(
      organization_id,role,permissions
    )
  )
  or (
    user_id=(select auth.uid())
    and role in ('admin','editor','viewer')
    and exists (
      select 1
      from public.organization_invitations invitation
      where invitation.organization_id=organization_members.organization_id
        and invitation.status='pending'
        and lower(invitation.email)=clique_obras_private.current_user_email()
        and invitation.role=organization_members.role
        and invitation.permissions=organization_members.permissions
    )
  )
);

drop policy if exists "cliqueobras_members_update" on public.organization_members;
create policy "cliqueobras_members_update"
on public.organization_members for update to authenticated
using (clique_obras_private.can_manage_users(organization_id))
with check (
  clique_obras_private.can_assign_member(
    organization_id,role,permissions
  )
);

drop policy if exists "cliqueobras_invitations_select" on public.organization_invitations;
create policy "cliqueobras_invitations_select"
on public.organization_invitations for select to authenticated
using (
  clique_obras_private.can_manage_users(organization_id)
  or (
    lower(email)=clique_obras_private.current_user_email()
    and status in ('pending','accepted')
  )
);

drop policy if exists "cliqueobras_invitations_insert" on public.organization_invitations;
create policy "cliqueobras_invitations_insert"
on public.organization_invitations for insert to authenticated
with check (
  invited_by=(select auth.uid())
  and clique_obras_private.can_assign_member(
    organization_id,role,permissions
  )
);

drop policy if exists "cliqueobras_invitations_update" on public.organization_invitations;
create policy "cliqueobras_invitations_update"
on public.organization_invitations for update to authenticated
using (
  clique_obras_private.can_manage_users(organization_id)
  or (
    status='pending'
    and lower(email)=clique_obras_private.current_user_email()
  )
)
with check (
  (
    clique_obras_private.can_manage_users(organization_id)
    and clique_obras_private.can_assign_member(
      organization_id,role,permissions
    )
  )
  or (
    status='accepted'
    and lower(email)=clique_obras_private.current_user_email()
  )
);

drop policy if exists "cliqueobras_invitations_delete" on public.organization_invitations;
create policy "cliqueobras_invitations_delete"
on public.organization_invitations for delete to authenticated
using (
  clique_obras_private.can_manage_users(organization_id)
  and clique_obras_private.can_assign_member(
    organization_id,role,permissions
  )
);

create or replace function public.accept_organization_invitations()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_email text;
  pending record;
  accepted_count integer := 0;
begin
  if actor_id is null then
    raise exception 'Sessão autenticada obrigatória.';
  end if;

  actor_email := clique_obras_private.current_user_email();
  if coalesce(actor_email,'') = '' then
    raise exception 'A conta autenticada não possui e-mail válido.';
  end if;

  for pending in
    select invitation.*
    from public.organization_invitations invitation
    where invitation.status='pending'
      and lower(invitation.email)=actor_email
    order by invitation.created_at
    for update
  loop
    insert into public.organization_members (
      organization_id,user_id,role,permissions
    )
    values (
      pending.organization_id,actor_id,pending.role,pending.permissions
    )
    on conflict (organization_id,user_id) do nothing;

    update public.organization_invitations
    set status='accepted',
        accepted_at=coalesce(accepted_at,now())
    where id=pending.id;

    accepted_count := accepted_count + 1;
  end loop;

  return accepted_count;
end;
$$;

revoke all on function public.accept_organization_invitations() from public, anon;
grant execute on function public.accept_organization_invitations() to authenticated;

commit;
