# CliqueObras v4.1.0 — Fluxo de Caixa por Medições

Evolução incremental sobre a v4.0.2. Nenhuma estrutura, tela, cálculo ou integração já
finalizada teve o comportamento alterado.

## A decisão que orienta todo o módulo

A especificação pedia, no item 5, para "abater do valor recebido do valor medido". Isso é
rejeitado pelo banco: medições HH têm uma trava que exige que o valor seja exatamente a
soma dos RDOs, e outra que bloqueia qualquer alteração desse valor.

A solução adotada foi um **registro separado**. Os recebimentos vivem num extrato próprio
e **o módulo nunca grava no registro da medição**. Isso evita três problemas de uma vez:

1. A trava de integridade da medição HH continua de pé, intocada.
2. Não é preciso ser administrador para registrar um recebimento — gravar uma medição HH
   exige perfil de administrador, um extrato separado não.
3. O valor medido continua sendo o valor medido. "Total Medido" não cai quando o dinheiro
   entra, "Saldo a Medir" não volta a subir, e o PDF da medição HH continua batendo com o
   detalhamento de horas.

---

## 1. Condição de pagamento no cliente

Campo novo no cadastro: **30, 60 ou 90 DDL**. Aparece também no card do cliente, e fica
em destaque âmbar quando não foi preenchido.

## 2. Nova Previsão

Botão ao lado de "Nova Medição". Informa projeto, valor previsto e **data prevista de
faturamento**. A **data prevista de recebimento** é calculada e não é editável.

- O prazo vem da condição de pagamento do cliente do projeto.
- A contagem é em dias corridos **a partir da data prevista de faturamento** (decisão D2 —
  DDL significa "data de lançamento", que na prática é a emissão da nota).
- Um projeto aceita várias previsões. O teto é
  **receita contratada − medições já lançadas − demais previsões** (decisão D3). O
  formulário mostra os três componentes e o disponível em tempo real.
- Se o cliente não estiver cadastrado ou estiver sem condição de pagamento, a previsão não
  é salva e a mensagem diz qual cliente ajustar.

## 3. Indicadores nos cards

Quatro indicadores novos, ao lado dos existentes:

| Indicador | O que mostra |
|---|---|
| Previsão de Medição | total previsto para faturar no período, com a data mais próxima |
| Previsão de Recebimento | total previsto para receber no período, com a data mais próxima |
| Previsto x Faturado | faturado no período, comparado ao previsto, com a diferença |
| Previsto x Recebido | recebido no período, comparado ao previsto, com a diferença |

As duas diferenças são métricas distintas, como a especificação pede. Cada card de projeto
também ganhou um bloco recolhível com as previsões daquele projeto.

## 4. Registro de medições recebidas

Botão **"Medição Recebida"** em cada linha da tabela.

- **Extrato**: vários lançamentos por medição. Recebimento parcial funciona sozinho, sem
  regra especial — o saldo é o valor medido menos a soma dos lançamentos.
- **"Encerrar a medição com este lançamento"**: para quando o saldo restante não vai
  entrar — retenção contratual, desconto, diferença de arredondamento.
- **Divergência** entre valor medido e valor recebido aparece como aviso e **não bloqueia**
  a confirmação, conforme o item 5.
- **Excluir** um lançamento devolve o valor para "em aberto". Não existe rotina de estorno
  porque nada foi decrementado em lugar nenhum.

## 5. Situação de recebimento e filtros

A situação é **calculada** a partir do extrato: Não recebida, Recebida parcialmente ou
Recebida. Não é um status gravado na medição (decisão D7).

A vantagem prática: o status da medição continua sendo Aguardando / Aprovada / Faturada,
então você enxerga **"faturada e ainda não recebida"** — que é exatamente o que interessa
num fluxo de caixa. Um status único faria essa informação se perder.

Filtros novos na tela: **período (de/até), status e situação de recebimento**. O filtro de
projeto já existia e continua valendo. O período abre no mês corrente.

---

## Alterações no banco

Aplicadas em produção em 21/08/2026 (`v410_previsoes_e_recebimentos_de_medicao`).

| Objeto | O que mudou |
|---|---|
| `app_records_store_check` | aceita `forecasts` e `measurement_receipts` |
| `can_view_store` / `can_edit_store` | mapeiam os dois stores novos para a permissão de `measurements` |
| `validate_cashflow_records_v410` | valida os registros novos — **alcança somente os dois stores criados agora** |
| 3 índices parciais | leitura de previsões e recebimentos |

Nenhuma política RLS existente foi afetada. Nenhuma tabela foi alterada. Nenhum registro
foi apagado.

## Alterações no front

```
modules/medicoes/fluxocaixa.js                       (novo)
supabase/ATUALIZACAO-v4.1.0-FLUXO-CAIXA-MEDICOES.sql (novo)
ALTERACOES-v4.1.0.md                                 (novo)
LEIA-ME-v4.1.0.txt                                   (novo)
modules/medicoes/medicoes.js
modules/clientes/clientes.js
database/indexeddb.js
index.html
```

Quase toda a lógica nova está no arquivo novo. `medicoes.js` recebeu apenas edições
cirúrgicas: o botão, a barra de filtros, os quatro indicadores, duas colunas na tabela e a
chamada do bloco de previsões.

O IndexedDB sobe da versão 6 para a 7 para criar os dois stores locais. A migração é
automática no primeiro acesso e não apaga nada.

## O que NÃO foi alterado

- O registro da medição, em nenhuma hipótese.
- A trava de integridade da medição HH e a exigência de administrador.
- `Biz.measurementCompletion` e o cálculo de saldo contratual.
- A sincronização do Omie, o abatimento do planejamento da v4.0.2, os RDOs e as compras.
- Qualquer política RLS, tabela ou registro existente.

## Testes

25 testes do módulo novo e 9 de regressão da v4.0.2, todos passando.

- DDL de 30/60/90 dias, virada de ano, ano bissexto e horário de verão
- Condição de pagamento resolvida pelo cliente do projeto
- Teto descontando medições e ignorando a própria previsão ao editar
- Situação parcial, quitada pela soma e encerrada com valor menor
- Um teste confirma explicitamente que a medição nunca é alterada
- Os quatro indicadores, com escopo por projeto
- Regressão: FIFO, estorno exato e grafia divergente de categoria da v4.0.2

## Como publicar

1. Substituir os arquivos no GitHub pela pasta desta versão.
2. O SQL **já foi aplicado** no Supabase. O arquivo vai junto apenas para ficar versionado.
3. Publicar na Hostinger. O `index.html` já tem `?v=4.1.0`, então os navegadores buscam os
   arquivos novos sozinhos.

## Pendente para a v4.2.0

Sincronização de contas a receber do Omie, aguardando duas decisões:

- **D4** — "centro de custo" no título do Omie é o mesmo campo de projeto que as contas a
  pagar já usam, ou é a entidade *departamento*?
- **D6** — rodar no mesmo agendamento mas em passo isolado (recomendado), ou tudo na mesma
  execução?

O extrato já aceita lançamento sem medição vinculada — é exatamente onde o recebimento do
Omie vai esperar a conciliação manual. A estrutura da v4.2.0 já está pronta.
