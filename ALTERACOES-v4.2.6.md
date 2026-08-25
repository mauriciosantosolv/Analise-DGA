# CliqueObras v4.2.6 — 25/08/2026

Cinco pedidos, todos com a causa raiz provada nos dados reais antes do patch.
**Nenhuma regra de cálculo, de permissão ou de gravação foi alterada.**

> ⚠️ **Numeração:** esta versão foi construída sobre a **v4.2.5**, que é a mais
> avançada já entregue. As versões v4.3.0 e v4.4.0 têm número maior mas são
> anteriores no tempo e já estão contidas aqui. **Publicar a v4.2.6 leva tudo.**

---

## 1. RDO — campo "Serviço contratado" só em projeto HH

**O que era.** O PDF do Diário de Obra trazia, desde a v4.2.4, a linha
**"Serviço contratado"** com `Tipo — Proposta N — Funções vendidas`. Esse campo
descreve uma venda por hora-homem: o que se vende é a função apontada do
colaborador. Em projeto de **Obra** ou de **Fornecimento** a venda é por escopo,
então a linha não significava nada.

**O que mudou.** A linha só é impressa quando o projeto é do tipo **HH**. Em
Obra e Fornecimento ela simplesmente não aparece.

O tipo é lido do cabeçalho servido pela RPC `v424_rdo_document_header`, e não do
cadastro local — assim o perfil **Apontador de RDO**, que não enxerga o store de
projetos, continua gerando o PDF correto.

A coluna **"Função vendida"** da tabela de equipe **não foi alterada**, conforme
combinado.

*Arquivo:* `modules/rdo/rdo.js`

---

## 2. Omie — a sincronização automática nunca terminava

Este era o problema mais grave dos cinco, e é maior do que parecia: **nenhuma
sincronização completa terminou entre 21/08/2026 e 25/08/2026**, nem automática
nem manual. Só o sync manual de **um único projeto** funcionava.

### A prova

`omie_sync_runs` mostra a virada exata:

| Execução | Duração | Resultado |
|---|---|---|
| 21/08 até 22:45 (v10 da Edge Function) | **23–24 s** | success |
| 21/08 23:27 — publicada a versão 11 (contas a receber, v4.2.0) | — | — |
| 21/08 em diante | nunca conclui | error em cadeia |

Todas as execuções seguintes ficaram presas em `running` até a execução seguinte
marcá-las com *"Sincronizacao anterior interrompida"*. O `last_sync_at` congelou
em **25/08 09:26** — exatamente o que o print mostrava.

E a resposta HTTP do agendador confirmava:

```
id 3093 → "Timeout of 30000 ms reached"
```

### As duas paredes

1. **pg_net corta em 30 s.** O `pg_cron` chamava a Edge Function com
   `timeout_milliseconds := 30000`. Como a sincronização acontecia *dentro* da
   resposta, ao cortar a conexão o worker morria no meio.
2. **A Edge Function corta em 150 s.** Removido o limite do pg_net só para
   diagnosticar, a resposta passou a ser
   `{"code":"IDLE_TIMEOUT","message":"Request idle timeout limit (150s) reached"}`.
   Ou seja: a execução realmente levava **mais de 150 segundos**.

### A causa raiz do tempo

A etapa de **contas a receber**, introduzida na v4.2.0, fazia **uma consulta ao
Omie por projeto** — 21 consultas na organização de produção. Com o espaçamento
obrigatório de 700 ms por método, a latência do Omie e os *retries* de "método
concorrente", a execução saltou de ~23 s para mais de 150 s.

### A correção

- **Contas a receber passam a usar UMA consulta pelo período**, com o recorte
  por projeto feito localmente — exatamente o padrão que as contas a pagar já
  usavam na rotina incremental. O conjunto de títulos considerado é o mesmo;
  nenhuma regra de negócio mudou.
- **A rota `scheduled` responde na hora** e segue o trabalho como tarefa de
  segundo plano (`EdgeRuntime.waitUntil`). O agendador não é mais o relógio da
  sincronização.
- O `timeout_milliseconds` do `pg_cron` foi elevado para 240 s como rede de
  segurança, caso o runtime não ofereça `waitUntil`.

### O resultado, medido

```
Execução automática de 25/08 15:52  →  status success em 6 segundos
Resposta do agendador               →  {"accepted":1} imediato, HTTP 200
```

De "morria aos 150 s" para **6 segundos**.

### Sobre o intervalo

O intervalo gravado no banco é de **1 hora**, não de 15 minutos — é o que a tela
mostra em "Sincronização automática". Para deixar em 15 minutos, use
**Configurações → Integração Omie → Projetos e categorias → Frequência**.
O `pg_cron` já roda de 5 em 5 minutos e respeita o intervalo configurado.

*Arquivos:* `supabase/functions/omie-integration/index.ts`,
`supabase/functions/omie-integration/logic.mjs` (**já publicados** — versão 12),
`supabase/ATUALIZACAO-v4.2.6-OMIE-ORFAOS.sql` (**já aplicado**).

---

## 3. Projeto 798 — locação de veículo duplicada

**Confirmado na API do Omie, não por dedução:**

| Título | Consulta ao Omie | Situação |
|---|---|---|
| **2420124371** | `ERROR: Lançamento não cadastrado para o Código [2420124371] !` | **excluído no Omie** |
| **2421007984** | responde normalmente — R$ 3.999,50, emissão 19/08/2026, PAGO | válido |

Os dois têm o mesmo valor e a mesma observação
(*"RENOVAÇÃO DO VEICULO ONIX TDC3F48 07/08 A 08/09/2026"*). O primeiro foi
**apagado e refeito** no Omie. O CliqueObras importou o antigo e nunca soube da
exclusão.

**Por que o sistema não percebia.** A reconciliação
(`clique_obras_reconcile_omie_entries`) só cancela rateios de títulos que **ainda
aparecem** no lote vindo do Omie. Um título apagado simplesmente some da
listagem — e some sem deixar rastro. O registro fantasma ficava para sempre,
somando no Realizado e mantendo o planejamento abatido.

**Correção do dado (já aplicada em produção).** O fantasma foi cancelado pela
rotina que já existe para cancelamento (`active:false`), que devolveu
**R$ 1.786,67** ao item de planejamento `ms4v0nwjc6i0gvh` (saldo 0,00 →
1.786,67; realizado 5.400,00 → 3.613,33) e gravou o histórico `omie_restored`.

**Correção da causa (para não repetir).** A sincronização passa a fazer, no fim
de cada execução:

1. lista os candidatos com a nova RPC **somente leitura**
   `clique_obras_omie_orphan_candidates_v426` — lançamentos do Omie que estão
   aqui mas não vieram na listagem do período;
2. **pergunta ao próprio Omie**, título por título (`ConsultarContaPagar`), se
   ele ainda existe;
3. só cancela os que o Omie confirmar como inexistentes, chamando a **mesma
   rotina de cancelamento que já existia** — que devolve o valor ao planejamento
   e grava o histórico.

**Nada é removido por dedução.** Na primeira execução real isso já se provou
necessário: houve 1 candidato, o Omie respondeu que ele existe, e o registro foi
mantido (`{"checked":1,"kept":1,"removed":0}`).

Quando houver remoção, o painel do Omie passa a informar na linha
"Último resultado".

---

## 4. Dashboard — projetos concluídos saem da tela principal

Projeto com status **Concluído** deixa de aparecer no Dashboard: sai do
**Semáforo Financeiro**, dos **KPIs do topo** e dos **gráficos**. O resultado
financeiro completo continua no menu **Projetos**.

Ele volta a aparecer quando o usuário pede de forma explícita:

- filtro **Status → Concluído** na barra de filtros; ou
- seleção manual de projetos no botão de filtro de projetos.

Um aviso discreto ao lado do título do Semáforo informa quantos projetos foram
ocultados, com atalho para o menu Projetos.

O Painel TV herda o mesmo recorte, porque reaproveita os cálculos do Dashboard.

*Arquivos:* `modules/dashboard/dashboard.js`, `css/dashboard.css`

---

## 5. Lançamentos sempre em ordem de data decrescente

A tabela do print é a **"Drill Down — Lançamentos"** (abre ao clicar no gráfico
de categorias, de fornecedores ou de meses). Ela ordenava por **valor
decrescente**, e não por data — por isso as datas apareciam embaralhadas
(14/07, 23/07, 23/07, 14/07, 20/07, 20/07).

Agora ordena por **data decrescente**, com o maior valor desempatando quando a
data é a mesma.

### Varredura das demais listas

Conferi todas as listas de lançamentos do sistema:

| Lista | Situação |
|---|---|
| Drill Down — Lançamentos | ❌ ordenava por valor → **corrigido** |
| Financeiro → tabela de lançamentos | ✅ já em data decrescente |
| Financeiro → bloco de importação | ✅ já em data decrescente |
| Blocos de importação (cards) | ✅ ordenados pela data da importação |
| Medições | ✅ já em data decrescente |
| Diários de Obra (RDO) | ✅ já em data decrescente |
| Painel TV — últimos lançamentos | ✅ já em data decrescente |

**Não foram alteradas** as listas de **previsão** (Planejamento, Fluxo de Caixa
futuro, provisões) nem os relatórios de horas: nelas a ordem **crescente** é a
correta, porque descrevem o que ainda vai acontecer. Em duas delas a ordem também
é funcional — `candidateMeasurements` usa a ordem de data para oferecer as
medições na conciliação de recebimento, e mudá-la alteraria comportamento.

*Arquivo:* `modules/dashboard/charts.js`

---

## Divergência da Edge Function — resolvida em favor de produção

O repositório trazia, em `supabase/functions/omie-integration/`, uma versão da
**v4.0.1 que nunca foi publicada** (data do lançamento vinda de `info.dInc`,
`clique_obras_apply_omie_entries_v401`, backfill de inclusão). Publicá-la por
engano reescreveria a data de **todos** os lançamentos já importados do Omie.

Como a v4.2.6 precisava publicar a Edge Function, aqueles trechos foram
**revertidos para o que roda em produção** antes do deploy — e os arquivos do
repositório agora refletem exatamente o que está publicado (versão 12).

Os auxiliares `payableDates` / `payableInclusionDate` / `payableInclusionTime`
continuam em `logic.mjs`, prontos e comentados, mas **fora do fluxo**. A decisão
sobre adotá-los segue com você e não foi tomada aqui.

---

## Testes

`node --test tests/*.test.mjs` continua com as **mesmas 4 falhas pré-existentes**
(`dashboard-v307`, `panel-tv`, `security-regression`, `static`), que estão presas
à v4.0.1 desde antes da v4.2.4 — conferido rodando a mesma bateria na v4.2.5.

Dois testes do Omie (`omie-integration`, `omie-security`) foram **atualizados**:
eles validavam a versão da v4.0.1 que nunca foi publicada. Agora validam o que
está de fato em produção e passaram a cobrir também as correções da v4.2.6 — que
a rota agendada responde na hora, que contas a receber usam uma consulta por
período, que a rotina de órfãos é somente leitura e que nada é removido sem
confirmação do Omie. Os dois passam.

---

## Arquivos alterados

```
index.html                                   (45 referências de versão)
js/app.js                                    (rótulo da barra lateral)
css/dashboard.css                            (aviso de projetos ocultos)
modules/rdo/rdo.js                           (Serviço contratado só em HH)
modules/dashboard/dashboard.js               (concluídos fora do Dashboard)
modules/dashboard/charts.js                  (Drill Down por data)
modules/integracoes/omie.js                  (linha de removidos)
supabase/functions/omie-integration/index.ts    (publicado — versão 12)
supabase/functions/omie-integration/logic.mjs   (publicado — versão 12)
supabase/ATUALIZACAO-v4.2.6-OMIE-ORFAOS.sql     (já aplicado em produção)
tests/omie-integration.test.mjs              (alinhado com produção)
tests/omie-security.test.mjs                 (alinhado com produção + v4.2.6)
ALTERACOES-v4.2.6.md
LEIA-ME-v4.2.6.txt
```

## Já aplicado no servidor por mim

- RPC `clique_obras_omie_orphan_candidates_v426` criada.
- Edge Function `omie-integration` publicada na **versão 12**.
- `pg_cron` job `clique-obras-omie-auto-sync` com `timeout_milliseconds` 240 s.
- Registro fantasma do projeto 798 cancelado e planejamento restaurado.

Nada disso depende de você publicar o ZIP. O que o ZIP leva é o front-end
(itens 1, 4, 5 e a linha de removidos do painel Omie).
