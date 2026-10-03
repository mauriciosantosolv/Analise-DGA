# CliqueObras v4.5.10 — Custo por remessa corrigido · Descontos/adicionais na medição HH · Filtro só com obras em andamento

Base: v4.5.9. Esta versão leva TUDO o que mudou desde a v4.5.9 (o ZIP "-alterados" tem só esses arquivos).
**O servidor já está em produção** (aplicado em 03/10/2026). Falta só publicar o front.

## 1. Custo por remessa — por que alguns projetos ainda mostravam Contas a Pagar

Eram DOIS problemas, nenhum no filtro do cartão (que funciona: nas contas novas ele barra certo).

### 1a. Contas a pagar importadas ANTES da ativação nunca saíam
A v4.5.7 só impede que ENTRE conta nova fora do cartão. O que já estava no CliqueObras quando o
projeto foi ativado ficava para sempre — a sincronização deixa de olhar para essas contas.
Conferido título a título no Omie (pela conta corrente de cada um):

| Projeto | Títulos fora do cartão | Valor |
|---|---|---|
| Construção da Oficina de Veículos Canavieiras | 8 (importados 3 min antes da ativação) | R$ 46.193,30 |
| Adequação da NR-10 no Refeitório | 16 | R$ 5.117,30 |
| Os outros 3 projetos | 0 (tudo é cartão) | — |

**Decisão (Mauricio):** sai TODA conta a pagar fora do cartão, de qualquer data.
**Correção:** Edge Function NOVA `omie-remessa-limpeza` (a `omie-integration` não foi tocada). Roda pelo
pg_cron nos minutos 15, 35 e 55. Lê cada projeto em remessa pelo filtro oficial por projeto e retira o
que não é cartão usando a MESMA rotina de cancelamento do Omie (`clique_obras_apply_omie_entries` com
`active:false`): devolve o valor ao planejamento e grava `omie_restored` no histórico.
- Primeira execução real: 24 retirados (R$ 51.310,60), R$ 1.642,27 devolvidos ao planejamento da NR-10
  (a Oficina não tinha abatido planejamento). Antes, uma simulação (`dryRun`) bateu número a número.
- Projeto ativado no futuro: a limpeza acontece sozinha na rodada seguinte (`payables_cleared_at`).
- Desativar a remessa do projeto + sincronização manual traz as contas de volta.
- Registro de cada rodada: tabela `omie_remessa_cleanup_runs`.

### 1b. Remessas pararam de entrar em 02/10/2026
Às 15:56 o DE-PARA foi salvo e apagou os vínculos das categorias de RECEITA (152 → 143 no registro de
auditoria). `clique_obras_save_omie_config` apaga e regrava a lista inteira, e a aba "Categorias das
remessas" (v4.5.9) só coloca essas linhas na tela depois de carregar — se ainda não tinha carregado ou
falhou, os vínculos não iam no pedido. Desde então as 17 remessas ficavam "sem DE-PARA".
- **Dado:** recoloquei 1.01.01 e 1.01.02 → Compras de Material (os usados pelas 15 remessas já
  lançadas). Sincronização das 11:25: 0 pendentes.
- **Front (`omie-remessa.js`):** ao salvar, os vínculos JÁ SALVOS de categorias que NÃO estão na tela
  vão junto no pedido. O que está na tela continua decidido pelo usuário. `omie.js` não mudou.

### Observação
A conta **Flash Benefícios** está marcada como cartão corporativo, por isso a alimentação paga pela Flash
continua entrando como conta a pagar nos projetos em remessa. Se não deveria, desmarque em
Configurações › Integração Omie › Custo por remessa.

## 2. Medição HH — descontos e valores adicionais
**Decisões:** linhas livres (descrição + valor, marcando Adicional ou Desconto); o total final vale para
Total medido, Saldo a medir e fluxo de caixa.
- Nova medição e edição da medição: quadro "Descontos e valores adicionais" com total ao vivo.
  Medição **Faturada**: ajustes travados (só leitura).
- Valor gravado = soma dos RDOs + adicionais − descontos. Guardados também `laborValue` e `adjustments`.
- **A checagem do saldo contratual continua sobre a soma dos RDOs**, como antes.
- **PDF:** com ajustes, o rodapé da tabela vira "SUBTOTAL MÃO DE OBRA" e aparece o quadro de ajustes
  com o TOTAL DA MEDIÇÃO. Sem ajustes, idêntico ao de antes.
- **XLSX:** a aba "Medicao" não muda; com ajustes ganha a aba "Resumo" (mão de obra, cada ajuste,
  total — números como número, desconto negativo).
- Lista de medições: "N RDO(s) + ajustes".
- **Servidor:** a guarda `protect_rdo_app_records` exigia valor = soma dos RDOs e travava qualquer
  mudança de valor. Mudaram SÓ duas comparações (conferido: desfazendo a troca, o md5 volta exatamente ao
  da função anterior) + função nova `measurement_adjustment_net_v4510` que valida os ajustes.
  Testado em transação desfeita: sem ajuste ok; ajuste coerente ok; valor incoerente bloqueado; valor
  mudando sem ajuste bloqueado; ajuste sem descrição bloqueado; faturada com ajuste alterado bloqueada.

## 3. Filtro de projetos do dashboard — só obras "Em andamento"
Hoje: 40 projetos cadastrados → 17 na lista. Um projeto que JÁ está selecionado continua aparecendo
(com o status ao lado) para não sair do filtro em silêncio. Sem seleção, o dashboard continua mostrando
todos, como antes.

## Arquivos
- `modules/medicoes/medicoes.js` — métodos novos de ajuste + edições pontuais em hhForm, hhStatusForm,
  print, exportXlsx e na lista.
- `modules/dashboard/charts.js` — `projectFilterProjects()` (nova) usada no filtro.
- `modules/integracoes/omie-remessa.js` — `keepUnlistedCategories()` (nova) + envoltório do request.
- `css/rdo.css` — estilos novos do quadro de ajustes (tela e impressão), só acrescentados.
- `index.html`, `js/app.js` — versão 4.5.10 (50 `?v=`, application-version, rótulo).
- `supabase/functions/omie-remessa-limpeza/` (novo) — publicado (versão 3).
- `supabase/ATUALIZACAO-v4.5.10-*.sql` (novos) — registro do que já foi aplicado.
- `tests/v4510-medicao-ajustes-filtro.test.mjs`, `tests/omie-remessa-limpeza.test.mjs` (novos, 9 testes).

Testes: 65/69. As 4 falhas são as mesmas de antes (presas à v4.0.1), com as mesmas mensagens.
