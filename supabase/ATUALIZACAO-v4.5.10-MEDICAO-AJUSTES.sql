-- =============================================================================
-- CliqueObras v4.5.10 — Ajustes (desconto / valor adicional) na medição HH.
-- JÁ APLICADO EM PRODUÇÃO em 03/10/2026 pelo Claude. Idempotente.
--
-- A guarda do servidor (clique_obras_private.protect_rdo_app_records) exigia que o
-- valor da medição HH fosse EXATAMENTE a soma dos RDOs e bloqueava qualquer
-- mudança de valor depois de criada. Mudam SÓ duas comparações dessa função; todo
-- o resto é idêntico (a troca é feita por âncora exata, conferida antes de gravar):
--
--   1) valor = soma dos RDOs  +  adicionais  −  descontos   (e nunca negativo)
--      Sem "adjustments" o ajuste é ZERO — medições existentes: regra idêntica.
--   2) o valor pode mudar depois de criada SOMENTE se os ajustes mudaram junto e
--      a medição ainda não está Faturada. Faturada: ajustes também travados.
--
-- Os ajustes são validados por uma função NOVA:
--   tipo 'add' ou 'discount', valor > 0, descrição obrigatória (até 200), até 50 linhas.
-- =============================================================================

create or replace function clique_obras_private.measurement_adjustment_net_v4510(measurement jsonb)
returns numeric
language plpgsql
immutable
set search_path to ''
as $fn$
declare item jsonb; total numeric:=0; amount numeric; kind text;
begin
  if measurement is null or measurement->'adjustments' is null or jsonb_typeof(measurement->'adjustments')='null' then
    return 0;
  end if;
  if jsonb_typeof(measurement->'adjustments')<>'array' or jsonb_array_length(measurement->'adjustments')>50 then
    raise exception 'Ajustes da medição inválidos.';
  end if;
  for item in select value from jsonb_array_elements(measurement->'adjustments') loop
    kind:=coalesce(item->>'type','');
    if jsonb_typeof(item)<>'object' or kind not in ('add','discount') then
      raise exception 'Tipo de ajuste da medição inválido.';
    end if;
    if coalesce(item->>'value','') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Valor de ajuste da medição inválido.';
    end if;
    amount:=(item->>'value')::numeric;
    if amount<=0 or amount>1000000000 then
      raise exception 'Valor de ajuste da medição fora do limite.';
    end if;
    if length(trim(coalesce(item->>'description','')))=0 or length(item->>'description')>200 then
      raise exception 'Informe a descrição de cada ajuste da medição.';
    end if;
    total:=total+case when kind='add' then amount else -amount end;
  end loop;
  return round(total,2);
end;
$fn$;
revoke all on function clique_obras_private.measurement_adjustment_net_v4510(jsonb) from public, anon, authenticated;

do $do$
declare
  src text; out text;
  a1 text:='or abs(expected_sale-measured_value)>0.01 then';
  b1 text:='or abs(expected_sale+clique_obras_private.measurement_adjustment_net_v4510(new.data)-measured_value)>0.01
        or measured_value<0 then';
  a2 text:='or new.data->>''value'' is distinct from old.data->>''value''';
  b2 text:='or (new.data->>''value'' is distinct from old.data->>''value''
          and (coalesce(old.data->>''status'','''')=''Faturada''
            or new.data->''adjustments'' is not distinct from old.data->''adjustments''))
        or (coalesce(old.data->>''status'','''')=''Faturada''
          and new.data->''adjustments'' is distinct from old.data->''adjustments'')';
begin
  src:=pg_get_functiondef('clique_obras_private.protect_rdo_app_records()'::regprocedure);
  if position('measurement_adjustment_net_v4510' in src)>0 then
    raise notice 'v4.5.10 já aplicada — nada a fazer.'; return;
  end if;
  if (length(src)-length(replace(src,a1,'')))/length(a1)<>1 then raise exception 'âncora 1 não encontrada exatamente uma vez'; end if;
  if (length(src)-length(replace(src,a2,'')))/length(a2)<>1 then raise exception 'âncora 2 não encontrada exatamente uma vez'; end if;
  out:=replace(replace(src,a1,b1),a2,b2);
  execute out;
end
$do$;
