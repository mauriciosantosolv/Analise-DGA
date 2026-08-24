-- ============================================================================
-- CliqueObras v4.2.4
-- Cabeçalho completo dos documentos do RDO para usuários apontadores.
--
-- Problema: o perfil que só preenche RDO não tem permissão de leitura nos
-- stores 'settings', 'projects', 'clients' e 'labor_rates'. A RLS
-- (clique_obras_private.can_view_store) bloqueia essas linhas, então o PDF
-- gerado por ele saía sem papel timbrado, sem logo, sem CNPJ da empresa,
-- sem CNPJ do cliente e com "Cliente não informado".
--
-- Solução: uma função SECURITY DEFINER que devolve APENAS o cabeçalho do
-- documento (identidade da empresa, identidade do cliente, dados do projeto
-- e a função comercial vendida ao cliente por colaborador) para quem já pode
-- enxergar aquele RDO. Nenhuma permissão de leitura nova é concedida e
-- nenhuma regra existente é alterada.
--
-- Idempotente: pode ser executado mais de uma vez.
-- ============================================================================

create or replace function public.clique_obras_rdo_document_header(p_rdo_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org       uuid;
  v_rdo       jsonb;
  v_project   jsonb;
  v_client    jsonb;
  v_settings  jsonb;
  v_roles     jsonb;
  v_client_name text;
begin
  if coalesce(btrim(p_rdo_id),'') = '' then
    return null;
  end if;

  -- 1. Localiza o RDO. A leitura é feita sem RLS (security definer), por isso
  --    a permissão é verificada logo em seguida, com a MESMA função usada
  --    pela policy de select de public.app_records.
  select r.organization_id, r.data
    into v_org, v_rdo
    from public.app_records r
   where r.store = 'rdos'
     and r.record_id = p_rdo_id
   limit 1;

  if v_org is null then
    return null;
  end if;

  if not clique_obras_private.can_view_store(v_org, 'rdos') then
    raise exception 'Sem permissão para consultar este diário de obra.'
      using errcode = '42501';
  end if;

  -- 2. Projeto do diário.
  select p.data
    into v_project
    from public.app_records p
   where p.organization_id = v_org
     and p.store = 'projects'
     and p.record_id = v_rdo->>'projectId'
   limit 1;

  v_client_name := nullif(btrim(coalesce(v_project->>'client','')), '');

  -- 3. Cliente do projeto (casamento pelo nome, igual ao RDO.projectClient).
  if v_client_name is not null then
    select c.data
      into v_client
      from public.app_records c
     where c.organization_id = v_org
       and c.store = 'clients'
       and lower(btrim(coalesce(c.data->>'name',''))) = lower(v_client_name)
     limit 1;
  end if;

  -- 4. Identidade da empresa (somente as quatro chaves do cabeçalho).
  select jsonb_object_agg(s.record_id, s.data->'value')
    into v_settings
    from public.app_records s
   where s.organization_id = v_org
     and s.store = 'settings'
     and s.record_id in ('companyName','companyCnpj','companyLogo','pdfLetterhead');

  -- 5. Função comercial vendida ao cliente, por colaborador, neste projeto.
  select jsonb_object_agg(
           l.data->>'employeeId',
           jsonb_build_object(
             'commercialRole',  coalesce(l.data->>'commercialRole',''),
             'roleDisplayMode', coalesce(l.data->>'roleDisplayMode','client')
           )
         )
    into v_roles
    from public.app_records l
   where l.organization_id = v_org
     and l.store = 'labor_rates'
     and l.data->>'projectId' = v_rdo->>'projectId'
     and coalesce(l.data->>'isBaseCost','false') <> 'true'
     and coalesce(btrim(coalesce(l.data->>'employeeId','')),'') <> '';

  return jsonb_build_object(
    'company', jsonb_build_object(
      'name',       coalesce(v_settings->>'companyName',''),
      'cnpj',       coalesce(v_settings->>'companyCnpj',''),
      'logo',       coalesce(v_settings->>'companyLogo',''),
      'letterhead', coalesce(v_settings->>'pdfLetterhead','')
    ),
    'client', jsonb_build_object(
      'name', coalesce(nullif(btrim(coalesce(v_client->>'name','')),''), v_client_name, ''),
      'cnpj', coalesce(v_client->>'cnpj',''),
      'logo', coalesce(v_client->>'logo','')
    ),
    'project', jsonb_build_object(
      'id',       coalesce(v_rdo->>'projectId',''),
      'proposal', coalesce(v_project->>'proposal',''),
      'name',     coalesce(v_project->>'name',''),
      'type',     coalesce(v_project->>'type',''),
      'notes',    coalesce(v_project->>'notes','')
    ),
    'roles', coalesce(v_roles, '{}'::jsonb)
  );
end;
$$;

comment on function public.clique_obras_rdo_document_header(text) is
  'v4.2.4 — devolve o cabeçalho do PDF do RDO (empresa, cliente, projeto e função comercial) para quem já pode visualizar o diário, sem conceder leitura dos stores settings/projects/clients/labor_rates.';

revoke all on function public.clique_obras_rdo_document_header(text) from public;
revoke all on function public.clique_obras_rdo_document_header(text) from anon;
grant execute on function public.clique_obras_rdo_document_header(text) to authenticated;

-- ============================================================================
-- Conferência rápida (opcional), rodando como o próprio usuário logado:
--   select public.clique_obras_rdo_document_header('<id-do-rdo>');
-- ============================================================================
