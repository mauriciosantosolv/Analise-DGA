-- CliqueObras v3.0.6
-- Foto de perfil privada, gravada fora do JWT e protegida por usuário/RLS.
-- Execute uma vez depois da migração v3.0.4.

begin;

alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles
  drop constraint if exists profiles_avatar_path_valid;
alter table public.profiles
  add constraint profiles_avatar_path_valid
  check (
    avatar_path is null
    or (
      length(avatar_path) between 40 and 80
      and avatar_path = id::text || '/avatar.jpg'
    )
  ) not valid;
alter table public.profiles
  validate constraint profiles_avatar_path_valid;

-- Nome/e-mail continuam exclusivos do Auth. O usuário pode alterar somente
-- sua organização ativa e o caminho fixo da própria foto; a política UPDATE
-- existente também exige auth.uid() = profiles.id.
revoke update on table public.profiles from authenticated;
grant update(active_organization_id,avatar_path) on table public.profiles to authenticated;

insert into storage.buckets (
  id,name,public,file_size_limit,allowed_mime_types
)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "cliqueobras_profile_avatars_select" on storage.objects;
create policy "cliqueobras_profile_avatars_select"
on storage.objects for select to authenticated
using (
  bucket_id='profile-avatars'
  and name=(storage.foldername(name))[1] || '/avatar.jpg'
  and clique_obras_private.can_view_profile(
    clique_obras_private.safe_uuid((storage.foldername(name))[1])
  )
);

drop policy if exists "cliqueobras_profile_avatars_insert" on storage.objects;
create policy "cliqueobras_profile_avatars_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='profile-avatars'
  and owner_id=(select auth.uid())::text
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and name=(select auth.uid())::text || '/avatar.jpg'
);

drop policy if exists "cliqueobras_profile_avatars_update" on storage.objects;
create policy "cliqueobras_profile_avatars_update"
on storage.objects for update to authenticated
using (
  bucket_id='profile-avatars'
  and owner_id=(select auth.uid())::text
  and name=(select auth.uid())::text || '/avatar.jpg'
)
with check (
  bucket_id='profile-avatars'
  and owner_id=(select auth.uid())::text
  and name=(select auth.uid())::text || '/avatar.jpg'
);

drop policy if exists "cliqueobras_profile_avatars_delete" on storage.objects;
create policy "cliqueobras_profile_avatars_delete"
on storage.objects for delete to authenticated
using (
  bucket_id='profile-avatars'
  and owner_id=(select auth.uid())::text
  and name=(select auth.uid())::text || '/avatar.jpg'
);

notify pgrst, 'reload schema';

commit;
