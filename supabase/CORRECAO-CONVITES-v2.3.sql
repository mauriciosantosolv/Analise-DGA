-- cliqueobras v2.3 — correção segura da aceitação de convites.
-- Este arquivo documenta a alteração já aplicada no projeto Supabase.

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

revoke all on function clique_obras_private.current_user_email() from public, anon;
grant execute on function clique_obras_private.current_user_email() to authenticated;

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
    select i.*
    from public.organization_invitations i
    where i.status='pending'
      and lower(i.email)=actor_email
    order by i.created_at
    for update
  loop
    insert into public.organization_members (organization_id,user_id,role,permissions)
    values (pending.organization_id,actor_id,pending.role,pending.permissions)
    on conflict (organization_id,user_id) do nothing;

    update public.organization_invitations
    set status='accepted', accepted_at=coalesce(accepted_at,now())
    where id=pending.id;

    accepted_count := accepted_count + 1;
  end loop;

  return accepted_count;
end;
$$;

revoke all on function public.accept_organization_invitations() from public, anon;
grant execute on function public.accept_organization_invitations() to authenticated;

create or replace function clique_obras_private.protect_invitation_acceptance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if clique_obras_private.can_manage_users(old.organization_id) then
    return new;
  end if;
  if lower(old.email) <> clique_obras_private.current_user_email()
    or new.organization_id <> old.organization_id
    or new.email <> old.email
    or new.role <> old.role
    or new.permissions <> old.permissions
    or new.invited_by <> old.invited_by
    or new.status <> 'accepted' then
    raise exception 'O convite só pode ser aceito pelo destinatário.';
  end if;
  return new;
end;
$$;

revoke all on function clique_obras_private.protect_invitation_acceptance() from public, anon, authenticated;

drop policy if exists "cliqueobras_members_insert" on public.organization_members;
create policy "cliqueobras_members_insert"
on public.organization_members for insert to authenticated
with check (
  clique_obras_private.can_manage_users(organization_id)
  or (
    user_id=(select auth.uid())
    and role in ('admin','editor','viewer')
    and exists (
      select 1 from public.organization_invitations i
      where i.organization_id=organization_members.organization_id
        and i.status='pending'
        and lower(i.email)=clique_obras_private.current_user_email()
        and i.role=organization_members.role
        and i.permissions=organization_members.permissions
    )
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
  clique_obras_private.can_manage_users(organization_id)
  or (
    status='accepted'
    and lower(email)=clique_obras_private.current_user_email()
  )
);

-- Repara convites que já tinham criado o membro, mas falharam ao marcar a
-- aceitação por causa da política anterior.
update public.organization_invitations i
set status='accepted',
    accepted_at=coalesce(i.accepted_at,now())
where i.status='pending'
  and exists (
    select 1
    from public.profiles p
    join public.organization_members m on m.user_id=p.id
    where m.organization_id=i.organization_id
      and lower(p.email)=lower(i.email)
  );
