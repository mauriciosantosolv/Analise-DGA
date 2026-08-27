# CliqueObras v4.2.7 — Painel sóbrio, RDO alinhado e fim das duplicidades

Versão construída sobre a **v4.2.6** (o pacote `-completo` continua acumulativo:
publicar a v4.2.7 leva tudo o que veio antes).

> ⚠️ **Numeração fora de ordem — ponto de atenção que continua valendo.**
> As versões v4.3.0 e v4.4.0 existem e já estão dentro deste pacote; o ramo
> 4.2.x é o mais avançado. Antes de publicar, vale decidir se a numeração é
> renumerada para algo sequencial.

---

## 1. Painel/TV — desenho sóbrio, igual ao resto do sistema

O redesign da v4.3.0 (flat, preto/branco/cinza, cor só em status) tinha passado
pelo Painel/TV apenas herdando a paleta. Agora ele foi revisado de fato.
**Nenhum número, cálculo ou filtro mudou — a alteração é de CSS e de cor de
gráfico.**

- **Paleta trocada** do azul-petróleo com brilho para os cinzas neutros do tema
  escuro do sistema (`#0B0B0C` / `#111113` / `#151517` / `#27272A` /
  `#A1A1AA` / `#FAFAFA`). Verde, âmbar e vermelho continuam, **mas só em
  status** (saúde do projeto, falta, alerta, ociosidade).
- **Linhas retas:** todos os cantos arredondados viraram 0 (cartões, KPIs,
  tabelas, filtros, botões). Só os pontinhos indicadores continuam redondos.
- **Sem gradiente, sem sombra, sem brilho:** saíram o halo azul do fundo, o
  gradiente dos cartões, a sombra de 45px e os brilhos (`glow`) dos pontos de
  status.
- **Gráficos com cor controlada:** as barras de "Top gastos" e de "Alocações por
  obra" deixaram de ser azul/ciano e passaram a cinza neutro, com o realce
  branco só no hover. Grade e rótulos seguem a mesma escala de cinza.

## 2. Painel/TV — tela "Equipes em campo" reorganizada

- **Caixas de KPI do topo menores** (altura, fonte e respiro reduzidos), abrindo
  espaço para as listas de nomes.
- **Gráfico de alocação do dia estreito:** deixou de ocupar a largura inteira e
  virou uma coluna estreita à esquerda, com **barras horizontais** (antes eram
  barras verticais de até 48px espalhadas na tela toda). O nome da obra passou
  a ser lido na lateral, e a tabela "Obra / Alocados / Custo parcial"
  acompanha logo abaixo.
- **Nova distribuição:**

  | Coluna 1 (estreita) | Coluna 2 | Coluna 3 (larga, altura inteira) |
  |---|---|---|
  | Alocações por obra | Equipe alocada (em cima) | **Equipe ociosa** |
  |  | Faltas e folgas (embaixo) |  |

- As linhas das listas ficaram mais compactas (menos respiro entre nomes), de
  modo que **Equipe ociosa** usa a coluna inteira e mostra o maior número
  possível de colaboradores sem rolagem.
- No celular/tablet (≤1100px) tudo volta a empilhar em uma coluna, como antes.

## 3. Dashboard e Painel — busca de projeto dentro do filtro

- **Dashboard:** o filtro de projetos (que era só uma lista de caixas de
  seleção) ganhou um **campo de busca** por número da proposta, nome da obra ou
  cliente, com botão de limpar e aviso de "nenhum projeto encontrado".
  Os botões **Selecionar todos / Limpar seleção** passam a agir sobre o que
  está visível — sem busca ativa o efeito é exatamente o de antes.
- **Painel/TV:** a caixa de seleção "Projeto" ganhou um campo de busca acima
  dela; a lista é reconstruída conforme você digita, preservando a seleção.

## 4. RDO — desenho alinhado ao sistema

Mesma revisão sóbria, agora no RDO (lista, compositor guiado, detalhe,
colaboradores e valores HH):

- Cantos arredondados removidos (o sistema usa `--radius: 0`); apenas as
  etiquetas/pílulas ficaram com o raio de badge de 5px do guia de estilo.
- Saíram **todos** os fundos e textos azuis decorativos (`var(--blue)`,
  `blue-soft`, `color-mix` com azul): gabarito de horário, aviso de
  disponibilidade, etapas do compositor, cartões de upload, miniaturas de
  anexo, etiqueta de anexos, chips de filtro, tela de sucesso e trilha de
  auditoria. Tudo passou a preto/branco/cinza.
- O cartão da lista de RDOs não "pula" mais no hover (saiu o `translateY`) e
  perdeu a sombra.
- **Cor mantida onde é status:** falta (vermelho), feriado (âmbar), etapa
  concluída e projeto autorizado (verde), reprovação (vermelho).
- **O layout do PDF não foi tocado** — o bloco `@media print` de `rdo.css`
  ficou byte a byte igual ao da v4.2.6.

## 5. RDO — resumo (etapa 4) mostra o nome de cada pessoa

A revisão mostrava só "12 pessoas / 2 faltas". Agora, abaixo dos mesmos totais,
aparecem duas listas:

- **Colaboradores alocados** — nome, `entrada · intervalo · saída` e o total de
  horas de cada um;
- **Faltas registradas** — nome de cada falta, destacado em vermelho.

O bloco "Equipe e horas" passou a ocupar a largura inteira do resumo para caber
a lista.

## 6. RDO — intervalo no formato 00:00

O campo **Intervalo** era um número em minutos (`60`), diferente de Entrada e
Saída. Agora é um campo de hora **00:00**, igual aos outros, no gabarito da
equipe e em cada colaborador.

- O dado continua sendo gravado em **minutos** (`breakMinutes`): nenhuma conta
  de horas, custo, medição ou relatório mudou.
- Rascunhos antigos, gravados com o número puro, continuam abrindo
  normalmente — a leitura aceita os dois formatos.
- O PDF e os relatórios já mostravam `00:00`; agora a tela combina com eles.

## 7. RDO — duas causas de duplicidade corrigidas (provadas no banco)

### 7.1 Mesmo colaborador em dois diários no mesmo dia

**Causa raiz:** o código chamava a função de servidor
`clique_obras_rdo_occupied_employees` desde a v4.2.x, **mas ela nunca existiu no
banco**. Toda chamada dava 404, o `catch` engolia o erro em silêncio e a única
proteção que sobrava era a lista local `State.rdos` — filtrada pela RLS. Quem só
enxerga um projeto não vê o diário do outro, e por isso o colaborador aparecia
disponível.

**Prova com dados reais:** em 26/08/2026, ALBERTO VIEIRA DO CARMO ficou alocado
ao mesmo tempo no **RDO-2026-0070** (obra 919, rascunho, criado por Maurício às
13:00) e no **RDO-2026-0018** (obra 693, enviado por fabiomarinhodasilva661 às
17:38).

**Correção:**
- a função foi criada no banco (SECURITY DEFINER, enxerga a organização inteira,
  valida a permissão de leitura de `rdos` e devolve também as folgas do dia).
  Com isso a tela volta a **ocultar** quem já está alocado, como sempre foi a
  intenção;
- além disso, a checagem passou a rodar **também na hora de salvar**, não só ao
  montar a tela — antes, quem deixasse a tela aberta e salvasse depois driblava
  a validação.

### 7.2 Números de RDO repetidos

**Causa raiz:** o número saía de `State.rdos.length + 1`. O perfil Apontador
enxerga só os diários do projeto dele (17), então gerou `RDO-2026-0018` — número
que já existia em outro projeto.

**Prova com dados reais:** havia **18 números repetidos** no banco
(`RDO-2026-0034` aparecia 3 vezes).

**Correção:** o número definitivo passou a ser reservado **no momento de salvar**
e vem de uma função de servidor que conta a organização inteira. Sem nuvem (ou
se a função falhar) o cálculo local continua valendo, mas agora **pula os
números já usados** em vez de repetir.

> Os números já duplicados **não foram alterados** — mexer neles significaria
> reescrever diários aprovados, medições e lançamentos vinculados. A correção
> vale daqui para a frente. Se você quiser renumerar o histórico, dá para fazer,
> mas é uma operação separada e precisa ser combinada.

### 7.3 (bônus) Envio de RDO HH sem valor configurado

Foi a porta que deixou o colaborador ser selecionado. `hhConfigurationIssues()`
descobre se o contrato é HH lendo `State.projects` — que o perfil Apontador **não
enxerga**. O tipo vinha nulo, a validação era pulada em silêncio e o diário podia
ser enviado com gente sem valor HH no projeto (era exatamente o caso do ALBERTO
na obra 693: ele tem valor HH cadastrado na 919, não na 693).

Agora existe a mesma validação no servidor, usada só quando a do cliente não
consegue responder. A mensagem indica o que falta (`valor HH`, `custo`,
`função`) e orienta a pedir a configuração ao administrador.

## 8. RDO — PDF do Apontador sem a função vendida ao cliente

No PDF gerado por quem **não tem permissão de leitura em `labor_rates`**
(o perfil Apontador de RDO):

- a coluna **"Função vendida"** passa a se chamar **"Função"** e mostra a
  **função interna** do colaborador;
- o campo **"Serviço contratado"** deixa de listar as funções comerciais
  (continua mostrando o tipo do contrato e a proposta).

Para owner/admin **nada muda**: o PDF continua exatamente como na v4.2.6.
A opção de gerar PDF continua disponível para o Apontador.

---

## Arquivos alterados

| Arquivo | O que mudou |
|---|---|
| `css/panel-tv.css` | paleta sóbria, linhas retas, sem sombra/gradiente/brilho; nova grade da tela de campo; busca no filtro |
| `css/rdo.css` | mesma revisão sóbria (bloco `@media print` intocado); estilo das listas de nomes do resumo e da busca do filtro |
| `modules/dashboard/panel-tv.js` | busca no filtro de projeto, classes dos cartões de campo, gráficos em cinza e alocação em barras horizontais |
| `modules/dashboard/charts.js` | campo de busca dentro do filtro de projetos do Dashboard |
| `modules/rdo/rdo.js` | intervalo 00:00, resumo com nomes, numeração, guardas de duplicidade, PDF sem função vendida |
| `database/cloud.js` | chamadas `nextRdoNumber` e `rdoHhGaps` |
| `index.html` | versão 4.2.7 (45 referências) |
| `js/app.js` | rótulo `v4.2.7` da barra lateral |
| `supabase/ATUALIZACAO-v4.2.7-RDO-DUPLICIDADE.sql` | as três funções novas (**já aplicadas em produção**) |

## Aplicado por mim direto no Supabase (produção)

- `public.clique_obras_rdo_occupied_employees(uuid, text, text)` — **criada**
  (era chamada pelo front e não existia).
- `public.clique_obras_rdo_hh_gaps_v427(uuid, text, text[])` — criada.
- `public.clique_obras_next_rdo_number_v427(uuid, integer)` — criada.

Todas `STABLE SECURITY DEFINER`, sem gravação, com `revoke ... from public` e
`grant execute ... to authenticated`, e validando
`clique_obras_private.can_view_store(org, 'rdos')` antes de responder.
**Nenhum dado foi alterado.**

## O que não foi tocado

- Nenhuma regra de cálculo de horas, custo, venda, medição ou planejamento.
- Nenhuma permissão, RLS ou `App.viewStores`.
- O layout impresso do RDO, das medições e das provisões.
- A sincronização Omie.
- Os 4 testes ainda presos à v4.0.1 (`dashboard-v307`, `panel-tv`,
  `security-regression`, `static`) continuam falhando exatamente como na
  v4.2.6 — conferido rodando a mesma bateria no código original e no novo.
