-- Clique Obras v2.7
-- RDO integrado, medição HH por período, custos realizados e escopo por projeto.
-- Migração idempotente e sem remoção de registros existentes.

begin;

create or replace function clique_obras_private.valid_permissions(input jsonb)
returns boolean
language sql
immutable
set search_path=pg_catalog
as $$
  select jsonb_typeof(input)='object'
    and jsonb_typeof(coalesce(input->'view','[]'::jsonb))='array'
    and jsonb_typeof(coalesce(input->'edit','[]'::jsonb))='array'
    and jsonb_typeof(coalesce(input->'rdo_projects','[]'::jsonb))='array'
    and jsonb_array_length(coalesce(input->'rdo_projects','[]'::jsonb))<=500
    and coalesce(input->'manage_users','false'::jsonb)
      in ('true'::jsonb,'false'::jsonb)
    and not exists (
      select 1
      from jsonb_object_keys(input) as permission_key(value)
      where value not in ('view','edit','manage_users','rdo_projects')
    )
    and not exists (
      select 1
      from jsonb_array_elements_text(
        coalesce(input->'view','[]'::jsonb)
      ) as view_store(value)
      where value not in (
        'projects','budgets','purchases','planning','clients','categories',
        'settings','measurements','rdos','crew','labor_rates','rdo_financial'
      )
    )
    and not exists (
      select 1
      from jsonb_array_elements_text(
        coalesce(input->'edit','[]'::jsonb)
      ) as edit_store(value)
      where value not in (
        'projects','budgets','purchases','planning','clients','categories',
        'settings','measurements','rdos','crew','labor_rates','rdo_financial'
      )
      or not (coalesce(input->'view','[]'::jsonb) ? value)
    )
    and not exists (
      select 1
      from jsonb_array_elements(
        coalesce(input->'rdo_projects','[]'::jsonb)
      ) as assigned(item)
      where jsonb_typeof(item)<>'object'
        or jsonb_typeof(item->'id')<>'string'
        or length(trim(item->>'id')) not between 1 and 200
        or (
          item ? 'label'
          and jsonb_typeof(item->'label')<>'string'
        )
        or length(coalesce(item->>'label',''))>180
        or exists (
          select 1
          from jsonb_object_keys(item) as project_key(value)
          where value not in ('id','label')
        )
    );
$$;

revoke all on function clique_obras_private.valid_permissions(jsonb)
  from public,anon;
grant execute on function clique_obras_private.valid_permissions(jsonb)
  to authenticated;

alter table public.app_records
  drop constraint if exists app_records_store_check;

alter table public.app_records
  add constraint app_records_store_check check (
    store = any (array[
      'projects','budgets','purchases','planning','clients','categories',
      'settings','measurements','rdos','crew','labor_rates','rdo_financial'
    ]::text[])
  );

create table if not exists public.rdo_measurement_links (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rdo_id text not null check (length(trim(rdo_id)) > 0),
  measurement_id text not null check (length(trim(measurement_id)) > 0),
  project_id text not null check (length(trim(project_id)) > 0),
  linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now(),
  primary key (organization_id,rdo_id)
);

create index if not exists rdo_measurement_links_measurement_idx
  on public.rdo_measurement_links(organization_id,measurement_id);
create index if not exists rdo_measurement_links_project_idx
  on public.rdo_measurement_links(organization_id,project_id,linked_at);
create index if not exists rdo_measurement_links_linked_by_idx
  on public.rdo_measurement_links(linked_by);

create table if not exists public.rdo_cost_postings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rdo_id text not null check (length(trim(rdo_id)) > 0),
  project_id text not null check (length(trim(project_id)) > 0),
  purchase_record_id text not null check (length(trim(purchase_record_id)) > 0),
  amount numeric(18,2) not null check (amount >= 0),
  posted_by uuid not null references auth.users(id),
  posted_at timestamptz not null default now(),
  primary key (organization_id,rdo_id),
  unique (organization_id,purchase_record_id)
);

create index if not exists rdo_cost_postings_posted_by_idx
  on public.rdo_cost_postings(posted_by);

create or replace function clique_obras_private.can_access_rdo_project(
  target_org uuid,
  target_project text
)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select (select auth.uid()) is not null
    and coalesce(length(trim(target_project)),0) > 0
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id=target_org
        and member.user_id=(select auth.uid())
        and (
          member.role in ('owner','admin')
          or exists (
            select 1
            from jsonb_array_elements(
              case
                when jsonb_typeof(member.permissions->'rdo_projects')='array'
                  then member.permissions->'rdo_projects'
                else '[]'::jsonb
              end
            ) assigned
            where assigned->>'id'=target_project
          )
        )
    );
$$;

create or replace function clique_obras_private.can_view_record(
  target_org uuid,
  target_store text,
  target_data jsonb
)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select clique_obras_private.can_view_store(target_org,target_store)
    and (
      target_store <> 'rdos'
      or clique_obras_private.can_access_rdo_project(target_org,target_data->>'projectId')
    );
$$;

create or replace function clique_obras_private.can_edit_record(
  target_org uuid,
  target_store text,
  target_data jsonb
)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select clique_obras_private.can_edit_store(target_org,target_store)
    and (
      target_store <> 'rdos'
      or clique_obras_private.can_access_rdo_project(target_org,target_data->>'projectId')
    );
$$;

revoke all on function clique_obras_private.can_access_rdo_project(uuid,text)
  from public,anon;
revoke all on function clique_obras_private.can_view_record(uuid,text,jsonb)
  from public,anon;
revoke all on function clique_obras_private.can_edit_record(uuid,text,jsonb)
  from public,anon;
grant execute on function clique_obras_private.can_access_rdo_project(uuid,text)
  to authenticated;
grant execute on function clique_obras_private.can_view_record(uuid,text,jsonb)
  to authenticated;
grant execute on function clique_obras_private.can_edit_record(uuid,text,jsonb)
  to authenticated;

drop policy if exists "cliqueobras_records_select" on public.app_records;
drop policy if exists "cliqueobras_records_insert" on public.app_records;
drop policy if exists "cliqueobras_records_update" on public.app_records;
drop policy if exists "cliqueobras_records_delete" on public.app_records;

create policy "cliqueobras_records_select"
on public.app_records for select to authenticated
using (clique_obras_private.can_view_record(organization_id,store,data));

create policy "cliqueobras_records_insert"
on public.app_records for insert to authenticated
with check (
  user_id=(select auth.uid())
  and clique_obras_private.can_edit_record(organization_id,store,data)
);

create policy "cliqueobras_records_update"
on public.app_records for update to authenticated
using (clique_obras_private.can_edit_record(organization_id,store,data))
with check (
  user_id=(select auth.uid())
  and clique_obras_private.can_edit_record(organization_id,store,data)
);

create policy "cliqueobras_records_delete"
on public.app_records for delete to authenticated
using (clique_obras_private.can_edit_record(organization_id,store,data));

alter table public.rdo_measurement_links enable row level security;
alter table public.rdo_cost_postings enable row level security;

revoke all on table public.rdo_measurement_links, public.rdo_cost_postings from anon;
revoke all on table public.rdo_measurement_links, public.rdo_cost_postings from authenticated;
grant select,insert,delete on table public.rdo_measurement_links to authenticated;
grant select,insert on table public.rdo_cost_postings to authenticated;

drop policy if exists "cliqueobras_rdo_links_select" on public.rdo_measurement_links;
create policy "cliqueobras_rdo_links_select"
on public.rdo_measurement_links for select to authenticated
using (clique_obras_private.can_view_store(organization_id,'measurements'));

drop policy if exists "cliqueobras_rdo_links_insert" on public.rdo_measurement_links;
create policy "cliqueobras_rdo_links_insert"
on public.rdo_measurement_links for insert to authenticated
with check (
  linked_by=(select auth.uid())
  and clique_obras_private.can_edit_store(organization_id,'measurements')
);

drop policy if exists "cliqueobras_rdo_links_delete" on public.rdo_measurement_links;
create policy "cliqueobras_rdo_links_delete"
on public.rdo_measurement_links for delete to authenticated
using (
  linked_by=(select auth.uid())
  and clique_obras_private.can_edit_store(organization_id,'measurements')
  and not exists (
    select 1
    from public.app_records measurement
    where measurement.organization_id=rdo_measurement_links.organization_id
      and measurement.store='measurements'
      and measurement.record_id=rdo_measurement_links.measurement_id
  )
);

drop policy if exists "cliqueobras_rdo_cost_select" on public.rdo_cost_postings;
create policy "cliqueobras_rdo_cost_select"
on public.rdo_cost_postings for select to authenticated
using (clique_obras_private.is_org_admin(organization_id));

drop policy if exists "cliqueobras_rdo_cost_insert" on public.rdo_cost_postings;
create policy "cliqueobras_rdo_cost_insert"
on public.rdo_cost_postings for insert to authenticated
with check (
  posted_by=(select auth.uid())
  and clique_obras_private.is_org_admin(organization_id)
);

create or replace function clique_obras_private.validate_rdo_measurement_link()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  report_data jsonb;
  project_data jsonb;
begin
  if new.linked_by<>(select auth.uid()) then
    raise exception 'Usuário inválido para o vínculo de medição.';
  end if;

  select record.data into report_data
  from public.app_records record
  where record.organization_id=new.organization_id
    and record.store='rdos'
    and record.record_id=new.rdo_id;

  if report_data is null
    or report_data->>'status'<>'Aprovado'
    or report_data->>'projectId'<>new.project_id then
    raise exception 'O RDO precisa estar aprovado e pertencer ao projeto informado.';
  end if;

  select record.data into project_data
  from public.app_records record
  where record.organization_id=new.organization_id
    and record.store='projects'
    and record.record_id=new.project_id;

  if project_data is null or project_data->>'type'<>'HH' then
    raise exception 'Somente projetos HH podem medir venda por RDO.';
  end if;

  return new;
end;
$$;

revoke all on function clique_obras_private.validate_rdo_measurement_link()
  from public,anon,authenticated;

drop trigger if exists cliqueobras_validate_rdo_measurement_link
  on public.rdo_measurement_links;
create trigger cliqueobras_validate_rdo_measurement_link
before insert on public.rdo_measurement_links
for each row execute function clique_obras_private.validate_rdo_measurement_link();

create or replace function clique_obras_private.validate_rdo_cost_posting()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  report_data jsonb;
  financial_data jsonb;
  expected_amount numeric;
begin
  if new.posted_by<>(select auth.uid())
    or not clique_obras_private.is_org_admin(new.organization_id) then
    raise exception 'Usuário inválido para contabilizar o custo do RDO.';
  end if;

  select record.data into report_data
  from public.app_records record
  where record.organization_id=new.organization_id
    and record.store='rdos'
    and record.record_id=new.rdo_id;

  if report_data is null
    or report_data->>'projectId'<>new.project_id
    or report_data->>'status' not in ('Enviado','Aprovado') then
    raise exception 'RDO inválido para contabilização.';
  end if;

  select record.data into financial_data
  from public.app_records record
  where record.organization_id=new.organization_id
    and record.store='rdo_financial'
    and record.record_id=new.rdo_id;

  expected_amount=coalesce((financial_data->>'costTotal')::numeric,-1);
  if financial_data is null or abs(expected_amount-new.amount)>0.01 then
    raise exception 'O custo não corresponde ao snapshot financeiro do RDO.';
  end if;

  return new;
end;
$$;

revoke all on function clique_obras_private.validate_rdo_cost_posting()
  from public,anon,authenticated;

drop trigger if exists cliqueobras_validate_rdo_cost_posting
  on public.rdo_cost_postings;
create trigger cliqueobras_validate_rdo_cost_posting
before insert on public.rdo_cost_postings
for each row execute function clique_obras_private.validate_rdo_cost_posting();

create or replace function clique_obras_private.protect_rdo_app_records()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
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
    if old.store='rdos' and old.data->>'status'='Aprovado' then
      raise exception 'RDO aprovado não pode ser excluído.';
    end if;
    if old.store='rdo_financial' then
      raise exception 'Snapshot financeiro não pode ser excluído.';
    end if;
    if old.store='measurements' and old.data->>'source'='rdo-hh' then
      raise exception 'Medição HH vinculada a RDO não pode ser excluída.';
    end if;
    return old;
  end if;

  if new.store in ('rdos','crew','labor_rates','rdo_financial','measurements')
    and coalesce(new.data->>'id','')<>new.record_id then
    raise exception 'O identificador do registro é inválido.';
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

drop trigger if exists cliqueobras_protect_rdo_app_records on public.app_records;
create trigger cliqueobras_protect_rdo_app_records
before insert or update or delete on public.app_records
for each row execute function clique_obras_private.protect_rdo_app_records();

commit;
