# CliqueObras v4.2.4

Três correções pedidas em 24/08/2026: o **Saldo a Medir** que ignorava as
medições de outros meses, a opção de ver **todos os períodos**, e o **perfil de
apontador de RDO** com PDF completo.

> ⚠️ **Numeração fora de ordem (mesmo ponto de atenção da v4.2.1).**
> Esta versão foi construída sobre a **v4.2.3**, que é o código mais avançado já
> entregue e que já contém a v4.2.0, a v4.3.0, a v4.4.0, a v4.2.1 e a v4.2.2.
> Publicar a v4.2.4 leva tudo junto. As pastas `V4.3.0/` e `V4.4.0/` existem
> apenas como histórico — não republique a partir delas.

---

## 1. Saldo a Medir deixa de depender do filtro de período

### O problema (reproduzido nos dados reais)

Na tela **Medições**, com o filtro de 01/08/2026 a 31/08/2026 e o projeto 798
(PROJETO AURORA) selecionado, o sistema mostrava:

| Indicador | Antes | Correto |
|---|---:|---:|
| Receita Contratada | R$ 956.396,03 | R$ 956.396,03 |
| Total Medido (no período) | R$ 258.226,93 | R$ 258.226,93 |
| **Saldo a Medir** | **R$ 698.169,10** | **R$ 602.529,50** |
| **% medido do projeto** | **27,0 %** | **37,0 %** |

O projeto tem **duas** medições lançadas, somando R$ 353.866,53. Só uma delas
(R$ 258.226,93) cai dentro de agosto. Como o saldo era calculado com
`Receita − Total Medido no período`, a medição do mês anterior simplesmente não
abatia o saldo — o contrato parecia ter R$ 95.637,03 a mais para medir do que
realmente tem.

Causa raiz, em `modules/medicoes/medicoes.js`:

```js
const totalMeasured = rows.reduce(...);        // rows = já filtrado por período
... U.money(totalRevenue - totalMeasured)      // saldo a medir
const pct = measured / project.saleValue*100;  // measured = também só do período
```

### O que mudou

Novo método `Views.medicoes.measuredAllTime(projectId)`: soma **todas** as
medições já lançadas do projeto (ou de todos os projetos, respeitando o filtro
de projeto do topo do sistema), sem recorte de período, status ou recebimento.

- **Saldo a Medir** passa a ser `Receita Contratada − medido acumulado`, e ganhou
  a linha de apoio `Medido acumulado: R$ …` para deixar a conta explícita.
- O **percentual medido** e a barra de progresso de cada projeto passam a usar o
  acumulado (a etiqueta agora diz `37,0 % medido (acumulado)`).
- **Total Medido, Aprovado e Aguardando aprovação continuam sendo do período** —
  é isso que responde "quanto eu medi neste mês". Nada mudou neles.
- Abaixo dos indicadores entrou uma linha explicando qual período está na tela e
  que o saldo é acumulado.

Nenhuma fórmula existente foi reescrita: `filtered()`, `CashFlow.inPeriod`,
`CashFlow.situation` e o lançamento de medições estão intocados.

---

## 2. "Limpar" passa a significar "todos os períodos"

Antes, o botão **Limpar** chamava `ensurePeriod()`, que reescrevia o período
para o mês corrente — ou seja, era impossível ver o histórico inteiro.

Agora existe a flag `Views.medicoes.allPeriods`:

- **Limpar** zera os quatro filtros e liga `allPeriods` → a tela lista tudo,
  desde a primeira medição, e o rótulo mostra `Período exibido: Todos os
  períodos`.
- Apagar as duas datas na mão e clicar em **Aplicar** tem o mesmo efeito.
- Preencher qualquer data volta ao comportamento de sempre.
- O mês corrente continua sendo o padrão na **primeira abertura** da tela.

`CashFlow.inPeriod` já tratava período vazio como "sem limite", então nenhuma
função de filtro precisou ser alterada.

---

## 3. Perfil "Apontador de RDO"

### O perfil

Na tela **Configurações → Convidar usuário** (e também ao editar as permissões
de um usuário existente) há um terceiro perfil: **Apontador de RDO**.

Ao escolhê-lo, as permissões são preenchidas e **travadas**:

| | |
|---|---|
| Visualizar | Diários de Obra, Colaboradores |
| Editar | Diários de Obra |
| Gerenciar usuários | não |
| Projetos no RDO | os que você marcar na própria tela |

O que esse usuário passa a ver:

- **Menu:** somente **Diários de Obra** (e o próprio perfil em Configurações).
  Projetos, Orçamentos, Financeiro, Planejamento, Clientes, Categorias,
  Medições, Valores HH, Colaboradores, Relatórios e Backup ficam ocultos.
- **Dentro do RDO:** apenas os projetos autorizados aparecem no seletor, e a
  equipe alocada para montar o apontamento.
- **Nunca:** custo-hora, valor de venda, apuração HH, medições, faturamento,
  identidade da empresa ou qualquer outro cadastro. Isso já era garantido pela
  RLS do banco (`clique_obras_private.can_view_store`), que continua igual.

### Por que o papel gravado no banco continua sendo `editor`

O perfil é **derivado do formato das permissões**, não de um novo valor de
`role`. Criar um `role='apontador'` exigiria mexer em duas *check constraints*
(`organization_members` e `organization_invitations`), na função
`clique_obras_private.can_assign_member`, no gatilho de guarda dos membros e no
fluxo de aceite de convite — cinco regras já em produção. Optei por **não tocar
em nenhuma delas**: no banco o registro é `role='editor'` com
`view=['rdos','crew'] · edit=['rdos'] · manage_users=false`, e o sistema
reconhece esse desenho como "Apontador de RDO" na interface (cartão do usuário,
tabela da equipe e formulários). A validação de permissões, as policies e o
`can_assign_member` continuam exatamente como estavam.

Consequência prática: se algum dia você marcar as caixas manualmente nesse mesmo
desenho, o usuário será rotulado como Apontador de RDO — o que é o
comportamento desejado.

---

## 4. PDF do RDO completo, inclusive para o apontador

### Causa raiz do print enviado

O PDF saía com a marca "CliqueObras", sem CNPJ, com "Cliente não informado" e
sem papel timbrado **porque quem gerou o documento não tinha permissão de
leitura** nos stores `settings`, `projects`, `clients` e `labor_rates`. A RLS de
`public.app_records` bloqueia essas linhas no banco, então elas nunca chegaram
ao navegador e o PDF montou o cabeçalho com os valores padrão.

Confirmado nos dados: a empresa **está** cadastrada (DGA Energia, CNPJ
25.014.360/0001-73, logo e papel timbrado salvos) e o projeto 693 **está**
ligado ao cliente ADM PORTO FRANCO-MA (CNPJ 02.003.402/0139-00, com logo).

### A solução

Nova função no banco, `public.clique_obras_rdo_document_header(p_rdo_id)`,
`SECURITY DEFINER`, que devolve **apenas o cabeçalho do documento**:

```
company { name, cnpj, logo, letterhead }
client  { name, cnpj, logo }
project { id, proposal, name, type, notes }
roles   { <employeeId>: { commercialRole, roleDisplayMode } }
```

A função valida a permissão com a **mesma** verificação usada pela policy de
leitura dos RDOs (`clique_obras_private.can_view_store(org,'rdos')`): quem não
pode ver o diário recebe erro `42501`. Nenhuma permissão de leitura nova é
concedida — o apontador continua sem acesso aos cadastros; ele só recebe o
cabeçalho do documento que ele mesmo está imprimindo.

### O que o PDF passou a mostrar

- Papel timbrado da empresa (rascunho e envio para aprovação, em qualquer perfil);
- Logo e nome da empresa + **CNPJ da empresa**;
- Logo e nome do cliente + **CNPJ do cliente** (é novo — não existia no layout);
- Bloco **Serviço contratado**: tipo de contrato — proposta — funções vendidas
  ao cliente apontadas naquele diário;
- Coluna da tabela renomeada de *Função* para **Função vendida**, e a função
  comercial agora é resolvida também pela RPC (antes dependia de `labor_rates`
  em memória, invisível para o apontador).

Se a RPC não existir ou falhar, `RDO.documentHeader()` devolve um objeto vazio e
o PDF volta a montar pelo `State`, exatamente como na v4.2.3.

### Correção de layout no mesmo bloco

`css/rdo.css` tinha o typo `dsplay:flex` em `.rdo-print-facts>span`, que fazia
rótulo e valor saírem colados no PDF — no print enviado aparece como
"Projeto693", "Data20/08/2026", "LocalNão informado", "Total apontado17,6h".
Corrigido para `display:flex`. É a única alteração de CSS desta versão.

---

## Arquivos alterados

| Arquivo | O que mudou |
|---|---|
| `modules/medicoes/medicoes.js` | `measuredAllTime()`, saldo a medir acumulado, `allPeriods` |
| `modules/rdo/rdo.js` | `documentHeader()` + cabeçalho completo do PDF |
| `modules/configuracoes/configuracoes.js` | perfil Apontador de RDO (preset, rótulo, trava) |
| `database/cloud.js` | `isRdoOnly()` e `rdoDocumentHeader()` |
| `js/app.js` | menu restrito do apontador + versão |
| `css/rdo.css` | typo `dsplay:flex` → `display:flex` |
| `index.html` | versão 4.2.3 → 4.2.4 (45 referências) |
| `supabase/ATUALIZACAO-v4.2.4-RDO-CABECALHO-DOCUMENTO.sql` | **novo** — a RPC do cabeçalho |

## Como publicar

1. Rode `supabase/ATUALIZACAO-v4.2.4-RDO-CABECALHO-DOCUMENTO.sql` no SQL Editor
   do Supabase (é idempotente e não altera nenhuma função existente).
   *Já foi aplicado no projeto `ghxpcclqiabbknzjaapl` durante o desenvolvimento —
   rodar de novo não faz mal.*
2. Suba os arquivos do ZIP `-alterados` no GitHub, substituindo os existentes.
3. Limpe o cache do navegador (o `?v=4.2.4` já força o recarregamento).
4. Nada de Edge Function nesta versão.

## Para conferir depois de publicar

- Medições → filtro de agosto no projeto 798: **Saldo a Medir R$ 602.529,50** e
  **37,0 % medido (acumulado)**.
- Medições → **Limpar**: rótulo "Todos os períodos" e as duas medições na lista.
- Configurações → Convidar usuário → perfil **Apontador de RDO**: as caixas
  travam sozinhas e só sobra a lista de projetos para marcar.
- Entrar com esse usuário: só o menu Diários de Obra.
- Gerar o PDF de um rascunho com ele: timbrado, os dois logos, os dois CNPJs e
  o bloco "Serviço contratado".
