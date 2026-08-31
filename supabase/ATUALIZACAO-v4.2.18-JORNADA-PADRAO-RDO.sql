-- =====================================================================
-- CliqueObras v4.2.18 — jornada padrão do RDO para perfis restritos
-- =====================================================================
--
-- Problema
-- --------
-- A jornada padrão (entrada, saída, intervalo, limite diário, adicional
-- noturno) mora no store 'settings'. O perfil "Apontador de RDO" — o
-- encarregado que preenche o diário em campo — tem permissão de leitura
-- apenas em 'rdos' e 'crew', então a RLS não entrega nenhum registro de
-- 'settings' para ele. Sem esses registros, RDO.defaultShift() caía no
-- 07:30–17:18 embutido no código e o encarregado via um horário diferente
-- do que a empresa configurou (por exemplo 00:00–00:00), o que fazia o
-- diário ser salvo com a jornada errada quando ninguém corrigia à mão.
--
-- Solução
-- -------
-- Mesmo padrão já usado em clique_obras_rdo_document_header (v4.2.4): uma
-- função SECURITY DEFINER que devolve SÓ o recorte necessário e revalida a
-- permissão com a MESMA função usada na policy. Nenhuma permissão é
-- afrouxada: quem não pode ler os diários continua sem ver nada, e o
-- restante do store 'settings' (logo, timbrado, CNPJ, ticker) continua
-- inacessível para esse perfil.
--
-- Idempotente: pode ser executado mais de uma vez.
-- =====================================================================

create or replace function public.clique_obras_rdo_shift_defaults_v4218(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_out jsonb;
begin
  if p_organization_id is null then
    return '{}'::jsonb;
  end if;

  if not clique_obras_private.can_view_store(p_organization_id, 'rdos') then
    raise exception 'Sem permissao para consultar os diarios de obra.'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(r.record_id, r.data -> 'value'), '{}'::jsonb)
    into v_out
    from public.app_records r
   where r.organization_id = p_organization_id
     and r.store = 'settings'
     and r.record_id in (
       'rdoShiftStart', 'rdoShiftEnd', 'rdoShiftBreakMinutes', 'rdoDailyHours',
       'rdoSaturdayStart', 'rdoSaturdayEnd', 'rdoSaturdayBreakMinutes',
       'rdoSundayStart', 'rdoSundayEnd', 'rdoSundayBreakMinutes',
       'rdoNightStart', 'rdoNightPremiumPct'
     )
     and r.data -> 'value' is not null;

  return coalesce(v_out, '{}'::jsonb);
end;
$function$;

revoke all on function public.clique_obras_rdo_shift_defaults_v4218(uuid) from public;
grant execute on function public.clique_obras_rdo_shift_defaults_v4218(uuid) to authenticated;

comment on function public.clique_obras_rdo_shift_defaults_v4218(uuid) is
  'v4.2.18 - devolve apenas as chaves da jornada padrao do RDO para quem pode ler o store rdos, sem abrir o restante do store settings.';
