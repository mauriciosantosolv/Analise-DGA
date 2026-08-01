-- CliqueObras v3.0
-- Reparos cumulativos sobre a v2.9: convites, exclusões administrativas,
-- integridade financeira, configurações da empresa e recarga do schema REST.
-- Migração idempotente: não remove nem altera registros existentes.

begin;

create or replace function clique_obras_private.protect_rdo_app_records()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  project_data jsonb;
  report_count integer;
  link_count integer;
  snapshot_count integer;
  expected_sale numeric;
  measured_value numeric;
  posting public.rdo_cost_postings%rowtype;
begin
  if tg_op='DELETE' then
    if old.store='settings'
      and old.record_id in ('companyName','companyLogo')
      and not clique_obras_private.is_org_admin(old.organization_id) then
      raise exception 'Somente proprietário ou administrador pode alterar as configurações da empresa.';
    end if;
    if old.store='budgets' and exists (
      select 1
      from public.app_records financial
      where financial.organization_id=old.organization_id
        and financial.store in ('purchases','planning','measurements')
        and financial.data->>'projectId'=old.data->>'projectId'
    ) then
      raise exception 'O orçamento possui cadastro financeiro vinculado e não pode ser excluído.';
    end if;
    if old.store='clients' and exists (
      select 1
      from public.app_records financial
      where financial.organization_id=old.organization_id
        and financial.store in ('budgets','purchases','planning','measurements')
        and financial.data->>'projectId' in (
          select project.record_id
          from public.app_records project
          where project.organization_id=old.organization_id
            and project.store='projects'
            and lower(trim(coalesce(project.data->>'client','')))=lower(trim(coalesce(old.data->>'name','')))
        )
    ) then
      raise exception 'O cliente possui cadastro financeiro vinculado e não pode ser excluído.';
    end if;
    if old.store='rdos'
      and coalesce(old.data->>'status','Rascunho') not in ('Rascunho','Devolvido')
      and not (
        current_setting('clique_obras.admin_rdo_delete',true)=old.record_id
        and clique_obras_private.is_org_admin(old.organization_id)
      ) then
      raise exception 'Somente RDO em rascunho ou reprovado pode ser excluído.';
    end if;
    if old.store='rdo_financial'
      and not (
        current_setting('clique_obras.admin_rdo_delete',true)=old.record_id
        and clique_obras_private.is_org_admin(old.organization_id)
      ) then
      raise exception 'Snapshot financeiro não pode ser excluído.';
    end if;
    if old.store='measurements' and old.data->>'source'='rdo-hh' then
      if not clique_obras_private.is_org_admin(old.organization_id) then
        raise exception 'Somente administrador pode excluir medição HH.';
      end if;
      if old.data->>'status'='Faturada' then
        raise exception 'Medição HH faturada não pode ser excluída.';
      end if;
      if exists (
        select 1
        from public.rdo_measurement_links link
        where link.organization_id=old.organization_id
          and link.measurement_id=old.record_id
      ) then
        raise exception 'Use a exclusão controlada para liberar os RDOs da medição.';
      end if;
    end if;
    return old;
  end if;

  if new.store in ('rdos','crew','labor_rates','rdo_financial','measurements')
    and coalesce(new.data->>'id','')<>new.record_id then
    raise exception 'O identificador do registro é inválido.';
  end if;

  if new.store='settings'
    and new.record_id in ('companyName','companyLogo')
    and not clique_obras_private.is_org_admin(new.organization_id) then
    raise exception 'Somente proprietário ou administrador pode alterar as configurações da empresa.';
  end if;

  if new.store='rdos' then
    if coalesce(new.data->>'projectId','')=''
      or coalesce(new.data->>'date','')=''
      or new.data->>'status' not in ('Rascunho','Enviado','Aprovado','Devolvido')
      or jsonb_typeof(new.data->'entries')<>'array'
      or jsonb_array_length(new.data->'entries')=0 then
      raise exception 'RDO incompleto ou inválido.';
    end if;

    if tg_op='UPDATE' and old.data->>'status'='Aprovado'
      and new.data is distinct from old.data then
      raise exception 'RDO aprovado está bloqueado para edição.';
    end if;

    if tg_op='UPDATE'
      and old.data->>'status'='Enviado'
      and new.data->>'status'='Devolvido' then
      if not clique_obras_private.is_org_admin(new.organization_id) then
        raise exception 'Somente administrador pode reprovar o RDO.';
      end if;
      if coalesce(trim(new.data->>'rejectionComment'),'')='' then
        raise exception 'Informe o comentário da reprovação.';
      end if;
    end if;

    if new.data->>'status'='Aprovado'
      and (tg_op='INSERT' or old.data->>'status'<>'Aprovado') then
      if not clique_obras_private.is_org_admin(new.organization_id) then
        raise exception 'Somente administrador pode aprovar o RDO.';
      end if;

      select * into posting
      from public.rdo_cost_postings cost
      where cost.organization_id=new.organization_id
        and cost.rdo_id=new.record_id;

      if posting.rdo_id is null then
        raise exception 'O custo do RDO precisa ser contabilizado antes da aprovação.';
      end if;

      if not exists (
        select 1 from public.app_records financial
        where financial.organization_id=new.organization_id
          and financial.store='rdo_financial'
          and financial.record_id=new.record_id
      ) then
        raise exception 'O snapshot financeiro do RDO não foi encontrado.';
      end if;

      if not exists (
        select 1 from public.app_records purchase
        where purchase.organization_id=new.organization_id
          and purchase.store='purchases'
          and purchase.record_id=posting.purchase_record_id
          and purchase.data->>'sourceRdoId'=new.record_id
          and abs(coalesce((purchase.data->>'value')::numeric,-1)-posting.amount)<=0.01
      ) then
        raise exception 'O custo realizado do RDO não foi encontrado.';
      end if;
    end if;
  end if;

  if new.store='rdo_financial' and tg_op='UPDATE'
    and new.data is distinct from old.data then
    raise exception 'Snapshot financeiro aprovado é imutável.';
  end if;

  if new.store='measurements' then
    select project.data into project_data
    from public.app_records project
    where project.organization_id=new.organization_id
      and project.store='projects'
      and project.record_id=new.data->>'projectId';

    if tg_op='INSERT'
      and project_data->>'type'='HH'
      and coalesce(new.data->>'source','')<>'rdo-hh' then
      raise exception 'Projetos HH devem ser medidos pelos RDOs aprovados.';
    end if;

    if new.data->>'source'='rdo-hh' then
      if not clique_obras_private.is_org_admin(new.organization_id) then
        raise exception 'Somente administrador pode criar medição HH.';
      end if;
      if project_data is null or project_data->>'type'<>'HH'
        or jsonb_typeof(new.data->'rdoIds')<>'array'
        or jsonb_array_length(new.data->'rdoIds')=0 then
        raise exception 'Medição HH inválida.';
      end if;

      select count(*) into report_count
      from public.app_records report
      where report.organization_id=new.organization_id
        and report.store='rdos'
        and report.record_id in (
          select jsonb_array_elements_text(new.data->'rdoIds')
        )
        and report.data->>'projectId'=new.data->>'projectId'
        and report.data->>'status'='Aprovado'
        and report.data->>'date' between new.data->>'periodFrom' and new.data->>'periodTo';

      select count(*) into link_count
      from public.rdo_measurement_links link
      where link.organization_id=new.organization_id
        and link.measurement_id=new.record_id
        and link.rdo_id in (
          select jsonb_array_elements_text(new.data->'rdoIds')
        );

      select count(*),coalesce(sum((financial.data->>'saleTotal')::numeric),0)
        into snapshot_count,expected_sale
      from public.app_records financial
      where financial.organization_id=new.organization_id
        and financial.store='rdo_financial'
        and financial.record_id in (
          select jsonb_array_elements_text(new.data->'rdoIds')
        );

      measured_value=coalesce((new.data->>'value')::numeric,-1);
      if report_count<>jsonb_array_length(new.data->'rdoIds')
        or link_count<>jsonb_array_length(new.data->'rdoIds')
        or snapshot_count<>jsonb_array_length(new.data->'rdoIds')
        or abs(expected_sale-measured_value)>0.01 then
        raise exception 'Os RDOs, vínculos e valores da medição HH não conferem.';
      end if;

      if tg_op='UPDATE' and (
        new.data->>'projectId' is distinct from old.data->>'projectId'
        or new.data->>'value' is distinct from old.data->>'value'
        or new.data->'rdoIds' is distinct from old.data->'rdoIds'
        or new.data->>'periodFrom' is distinct from old.data->>'periodFrom'
        or new.data->>'periodTo' is distinct from old.data->>'periodTo'
        or new.data->>'source' is distinct from old.data->>'source'
      ) then
        raise exception 'A composição da medição HH está bloqueada.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function clique_obras_private.protect_rdo_app_records()
  from public,anon,authenticated;

create or replace function clique_obras_private.delete_rdo_measurement(
  target_organization_id uuid,
  target_measurement_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  measurement_data jsonb;
  released_count integer;
begin
  if (select auth.uid()) is null
    or not clique_obras_private.is_org_admin(target_organization_id) then
    raise exception 'Somente administrador pode excluir medição HH.';
  end if;

  if coalesce(length(trim(target_measurement_id)),0)=0 then
    raise exception 'Medição inválida.';
  end if;

  select record.data into measurement_data
  from public.app_records record
  where record.organization_id=target_organization_id
    and record.store='measurements'
    and record.record_id=target_measurement_id
  for update;

  if measurement_data is null then
    raise exception 'Medição não encontrada.';
  end if;
  if measurement_data->>'source'<>'rdo-hh' then
    raise exception 'Esta operação é exclusiva para medição por RDO.';
  end if;
  if measurement_data->>'status'='Faturada' then
    raise exception 'Medição HH faturada não pode ser excluída.';
  end if;

  delete from public.rdo_measurement_links link
  where link.organization_id=target_organization_id
    and link.measurement_id=target_measurement_id;
  get diagnostics released_count=row_count;

  delete from public.app_records record
  where record.organization_id=target_organization_id
    and record.store='measurements'
    and record.record_id=target_measurement_id;

  return jsonb_build_object(
    'measurement_id',target_measurement_id,
    'released_rdos',released_count
  );
end;
$$;

revoke all on function clique_obras_private.delete_rdo_measurement(uuid,text)
  from public,anon;
grant execute on function clique_obras_private.delete_rdo_measurement(uuid,text)
  to authenticated;

create or replace function public.clique_obras_delete_rdo_measurement(
  target_organization_id uuid,
  target_measurement_id text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select clique_obras_private.delete_rdo_measurement(
    target_organization_id,
    target_measurement_id
  );
$$;

revoke all on function public.clique_obras_delete_rdo_measurement(uuid,text)
  from public,anon;
grant execute on function public.clique_obras_delete_rdo_measurement(uuid,text)
  to authenticated;

-- Acelera as verificações de vínculos financeiros realizadas nas exclusões.
create index if not exists app_records_org_store_project_data_idx
  on public.app_records(organization_id,store,(data->>'projectId'));

-- Durante o cadastro ainda não existe auth.uid(). O gatilho cria o perfil e o
-- vínculo, mas deixa a confirmação do convite para o primeiro acesso
-- autenticado. Isso evita que a própria proteção do convite cancele o signup.
create or replace function clique_obras_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  pending record;
  personal_org_id uuid;
  linked_count integer := 0;
  display_name text;
begin
  insert into public.profiles (id,email,full_name)
  values (
    new.id,
    coalesce(new.email,''),
    coalesce(new.raw_user_meta_data->>'full_name','')
  )
  on conflict (id) do update
  set email=excluded.email,
      full_name=excluded.full_name,
      updated_at=now();

  for pending in
    select invitation.*
    from public.organization_invitations invitation
    where invitation.status='pending'
      and lower(trim(invitation.email))=lower(trim(coalesce(new.email,'')))
    order by invitation.created_at
  loop
    insert into public.organization_members (organization_id,user_id,role,permissions)
    values (pending.organization_id,new.id,pending.role,pending.permissions)
    on conflict (organization_id,user_id) do nothing;
    linked_count := linked_count + 1;
  end loop;

  if linked_count = 0 then
    display_name := coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'),''),
      nullif(split_part(coalesce(new.email,''),'@',1),''),
      'Minha organização'
    );
    insert into public.organizations (name,created_by)
    values (display_name,new.id)
    returning id into personal_org_id;

    insert into public.organization_members (organization_id,user_id,role,permissions)
    values (
      personal_org_id,
      new.id,
      'owner',
      '{"view":["projects","budgets","purchases","planning","clients","categories","settings","measurements","rdos","crew","labor_rates","rdo_financial"],"edit":["projects","budgets","purchases","planning","clients","categories","settings","measurements","rdos","crew","labor_rates","rdo_financial"],"manage_users":true,"rdo_projects":[]}'::jsonb
    );
  end if;
  return new;
end;
$$;

revoke all on function clique_obras_private.handle_new_user()
  from public,anon,authenticated;

create or replace function clique_obras_private.protect_invitation_acceptance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if lower(trim(old.email))=clique_obras_private.current_user_email()
    and old.status='pending'
    and new.organization_id=old.organization_id
    and new.email=old.email
    and new.role=old.role
    and new.permissions=old.permissions
    and new.invited_by=old.invited_by
    and new.status='accepted' then
    return new;
  end if;
  if clique_obras_private.is_org_admin(old.organization_id)
    and clique_obras_private.can_assign_member(
      new.organization_id,new.role,new.permissions
    ) then
    return new;
  end if;
  raise exception 'O convite só pode ser aceito pelo destinatário ou alterado por proprietário/administrador.';
end;
$$;

revoke all on function clique_obras_private.protect_invitation_acceptance()
  from public,anon,authenticated;

drop policy if exists "cliqueobras_invitations_insert" on public.organization_invitations;
create policy "cliqueobras_invitations_insert"
on public.organization_invitations for insert to authenticated
with check (
  invited_by=(select auth.uid())
  and clique_obras_private.is_org_admin(organization_id)
  and clique_obras_private.can_assign_member(organization_id,role,permissions)
);

drop policy if exists "cliqueobras_invitations_update" on public.organization_invitations;
create policy "cliqueobras_invitations_update"
on public.organization_invitations for update to authenticated
using (
  clique_obras_private.is_org_admin(organization_id)
  or (status='pending' and lower(trim(email))=clique_obras_private.current_user_email())
)
with check (
  (
    clique_obras_private.is_org_admin(organization_id)
    and clique_obras_private.can_assign_member(organization_id,role,permissions)
  )
  or (status='accepted' and lower(trim(email))=clique_obras_private.current_user_email())
);

drop policy if exists "cliqueobras_invitations_delete" on public.organization_invitations;
create policy "cliqueobras_invitations_delete"
on public.organization_invitations for delete to authenticated
using (
  clique_obras_private.is_org_admin(organization_id)
  and clique_obras_private.can_assign_member(organization_id,role,permissions)
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
  if coalesce(actor_email,'')='' then
    raise exception 'A conta autenticada não possui e-mail válido.';
  end if;

  for pending in
    select invitation.*
    from public.organization_invitations invitation
    where invitation.status='pending'
      and lower(trim(invitation.email))=actor_email
    order by invitation.created_at
    for update
  loop
    insert into public.organization_members (organization_id,user_id,role,permissions)
    values (pending.organization_id,actor_id,pending.role,pending.permissions)
    on conflict (organization_id,user_id) do nothing;

    update public.organization_invitations
    set status='accepted',accepted_at=coalesce(accepted_at,now())
    where id=pending.id;
    accepted_count := accepted_count + 1;
  end loop;
  return accepted_count;
end;
$$;

revoke all on function public.accept_organization_invitations()
  from public,anon;
grant execute on function public.accept_organization_invitations()
  to authenticated;

-- Exclusão atômica de RDO aprovado. RDOs já medidos continuam protegidos;
-- custo realizado, snapshot, postagem e evidências são removidos juntos.
create or replace function clique_obras_private.delete_rdo(
  target_organization_id uuid,
  target_rdo_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  rdo_data jsonb;
  object_paths jsonb := '[]'::jsonb;
  attachment_count integer := 0;
  purchase_count integer := 0;
begin
  if (select auth.uid()) is null
    or not clique_obras_private.is_org_admin(target_organization_id) then
    raise exception 'Somente proprietário ou administrador pode excluir RDO aprovado.';
  end if;
  if coalesce(length(trim(target_rdo_id)),0)=0 then
    raise exception 'RDO inválido.';
  end if;

  select record.data into rdo_data
  from public.app_records record
  where record.organization_id=target_organization_id
    and record.store='rdos'
    and record.record_id=target_rdo_id
  for update;

  if rdo_data is null then raise exception 'RDO não encontrado.'; end if;
  if exists (
    select 1 from public.rdo_measurement_links link
    where link.organization_id=target_organization_id
      and link.rdo_id=target_rdo_id
  ) then
    raise exception 'O RDO pertence a uma medição. Exclua primeiro a medição correspondente.';
  end if;

  perform set_config('clique_obras.admin_rdo_delete',target_rdo_id,true);

  -- O Supabase exige a API do Storage para remover os arquivos físicos.
  -- A RPC devolve os caminhos à Edge Function delete-rdo, que chama remove().
  select coalesce(jsonb_agg(to_jsonb(attachment.object_path) order by attachment.object_path),'[]'::jsonb)
    into object_paths
  from public.rdo_attachments attachment
  where attachment.organization_id=target_organization_id
    and attachment.rdo_id=target_rdo_id;

  delete from public.rdo_attachments attachment
  where attachment.organization_id=target_organization_id
    and attachment.rdo_id=target_rdo_id;
  get diagnostics attachment_count=row_count;

  delete from public.app_records purchase
  where purchase.organization_id=target_organization_id
    and purchase.store='purchases'
    and purchase.data->>'sourceRdoId'=target_rdo_id;
  get diagnostics purchase_count=row_count;

  delete from public.rdo_cost_postings posting
  where posting.organization_id=target_organization_id
    and posting.rdo_id=target_rdo_id;

  delete from public.app_records financial
  where financial.organization_id=target_organization_id
    and financial.store='rdo_financial'
    and financial.record_id=target_rdo_id;

  delete from public.app_records report
  where report.organization_id=target_organization_id
    and report.store='rdos'
    and report.record_id=target_rdo_id;

  return jsonb_build_object(
    'rdo_id',target_rdo_id,
    'attachments_deleted',attachment_count,
    'cost_entries_reversed',purchase_count,
    'object_paths',object_paths
  );
end;
$$;

revoke all on function clique_obras_private.delete_rdo(uuid,text)
  from public,anon;
grant execute on function clique_obras_private.delete_rdo(uuid,text)
  to authenticated;

create or replace function public.clique_obras_delete_rdo(
  target_organization_id uuid,
  target_rdo_id text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select clique_obras_private.delete_rdo(target_organization_id,target_rdo_id);
$$;

revoke all on function public.clique_obras_delete_rdo(uuid,text)
  from public,anon;
grant execute on function public.clique_obras_delete_rdo(uuid,text)
  to authenticated;

-- Força o PostgREST a reconhecer imediatamente as duas RPCs novas/recriadas.
notify pgrst, 'reload schema';

commit;
