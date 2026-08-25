# CliqueObras v4.2.5 — fim dos piscas e recarregamentos durante a sincronização

**Data:** 25/08/2026
**Base:** v4.2.4 (que já inclui v4.2.0, v4.3.0, v4.4.0, v4.2.1, v4.2.2 e v4.2.3)
**Tipo:** correção de desempenho e usabilidade. **Nenhuma regra de cálculo, de
permissão ou de gravação foi alterada.**

> ⚠️ **Numeração:** continuamos no ramo 4.2.x a seu pedido. Os pacotes v4.3.0 e
> v4.4.0 têm número maior mas são *anteriores* — publicar a v4.2.5 leva tudo.

---

## 1. O que estava acontecendo

Você relatou que a tela "pisca e recarrega em vários momentos, aparentemente
sincronizando dados na nuvem". Não era impressão nem problema do monitor: o
sistema estava mesmo redesenhando a tela inteira várias vezes por minuto. Foram
encontradas **cinco causas**, e a principal é um bug real.

### Causa 1 (a principal) — o filtro de "eco" nunca funcionou

O sistema escuta as mudanças da tabela `app_records` em tempo real. Para não
reagir às suas *próprias* gravações, o `database/cloud.js` guardava o carimbo de
tempo de cada gravação e comparava com o carimbo que voltava pelo tempo real
(`isLocalRecordEcho`).

O problema é que **o mesmo instante chega escrito de três jeitos diferentes**:

| Origem | Formato |
|---|---|
| O navegador, ao gravar (`record()`) | `2026-08-25T01:20:29.412Z` |
| O PostgREST, na leitura (`readAll`) | `2026-08-25T01:20:29.412+00:00` |
| O Realtime, no aviso de mudança | `2026-08-25 01:20:29.412+00` |

A comparação era feita com `===` entre as strings cruas, então **nunca dava
igual**. Conferido no pacote real (`assets/vendor/supabase.js`): o conversor de
`timestamptz` do Supabase é `ge = e => e`, ou seja, devolve o texto do banco sem
tocar. E o `updated_at` da tabela é `timestamp with time zone` com precisão de 6
casas.

Consequência: **toda vez que você salvava qualquer coisa**, o próprio sistema
tratava a sua gravação como se fosse alteração de outra pessoa e disparava uma
sincronização completa + redesenho da tela.

### Causa 2 — cada aviso disparava uma releitura completa da base

O aviso de mudança chamava `App.syncCloudNow()` depois de 350 ms. Esse método faz
`DB.syncFromCloud()`, que **baixa todos os registros da organização** (hoje são
**3.216 registros, ~2,8 MB**), regrava todas as tabelas locais e recarrega o
`State` — e só então redesenha.

Como o intervalo era de 350 ms e não havia trava de reentrância, uma carga que
grava muitos registros seguidos (a sincronização automática do Omie é o caso
clássico) provocava **uma enxurrada de releituras completas encavaladas**, cada
uma redesenhando a tela. Era exatamente o "pisca em vários momentos".

### Causa 3 — a cópia de segurança em `localStorage` travava a tela

Dentro de `syncFromCloud`, a cada sincronização o sistema serializa a base
inteira (`JSON.stringify` de ~3 MB) e grava em `localStorage`. Isso é
**síncrono**: trava a interface por alguns instantes toda vez.

### Causa 4 — a logo piscava de minuto em minuto

`App.validateCloudAccess()` roda a cada 60 segundos e chama `applyBranding()`,
que **reescrevia o `innerHTML`** da caixa da logo. Recriar o `<img>` faz o
navegador repintar a imagem — a piscada da barra lateral a cada minuto.

### Causa 5 — o letreiro financeiro voltava para o começo

`renderTicker()` reconstrói o `<div class="ticker-track">`, e a animação CSS
`ticker-scroll` **reinicia do zero** quando o elemento é recriado. A cada
sincronização em segundo plano o rodapé "pulava" de volta ao início.

### Bônus — o recarregamento inesperado

`validateCloudAccess()` derrubava a sessão (`signOut()` + `location.reload()`) na
**primeira** resposta vazia da consulta de organizações. Uma falha momentânea de
rede ou de token bastava para o sistema recarregar sozinho.

---

## 2. O que foi corrigido

### `database/cloud.js`
- Novo par de funções `versionStamp()` / `sameVersion()`: comparam carimbos de
  tempo pelo **instante** (`Date.parse`), não pelo texto.
- `isLocalRecordEcho()` passa a usar `sameVersion()` → **o filtro de eco volta a
  funcionar** e as suas próprias gravações deixam de redesenhar a tela.
- O mesmo comparador foi aplicado na limpeza de `pendingWriteEchoes` e em
  `conflictFor()` — este último acusava "Conflito de sincronização" falso ao
  esvaziar a fila offline, pela mesmíssima diferença de formato.

### `js/app.js`
- **Agrupamento das mudanças (`scheduleRealtimeSync`)**: em vez de sincronizar
  350 ms depois de cada linha alterada, espera **1,2 s de silêncio**, com espera
  máxima de **10 s**. Uma carga do Omie que antes gerava dezenas de redesenhos
  agora gera dois ou três.
- **Trava de reentrância (`syncCloudNow`)**: uma sincronização de cada vez. Se
  chegarem avisos durante a leitura, ela é repetida **uma única vez** ao final.
- **Redesenho só quando faz diferença**: o aviso do tempo real diz *qual tabela*
  mudou. Se a tela aberta não mostra aquela tabela, os dados são atualizados em
  memória mas a tela não é redesenhada. O mapa `viewExtraStores` (novo) lista as
  tabelas extras de cada tela; `viewStores` **não foi tocado** de propósito,
  porque ele também decide quem pode abrir cada menu.
- **Aba em segundo plano**: nada é redesenhado enquanto a aba está escondida. A
  atualização acontece quando ela volta a ficar visível.
- **`applyBranding()` idempotente**: a logo só é recriada quando a imagem
  realmente muda (marca `data-brand-signature`). Fim da piscada de minuto a
  minuto.
- **`renderTicker()` idempotente**: se o conteúdo do letreiro é o mesmo, ele não
  é reconstruído e a animação não reinicia (marca `data-ticker-signature`).
- **`validateCloudAccess()` mais tolerante**: só encerra a sessão depois de
  **duas** respostas vazias seguidas. Uma falha isolada de rede não derruba mais
  o usuário.

### `database/indexeddb.js`
- `syncFromCloud(options)` aceita `{background:true}`. Nas sincronizações em
  segundo plano a cópia de `localStorage` é regravada **no máximo a cada 2
  minutos**. A sincronização manual (o botão) continua gravando sempre.

### `index.html`
- 45 referências de versão `4.2.4` → `4.2.5` (43 `?v=`, o `<meta
  application-version>` e o rodapé). Isso também força o navegador a baixar os
  arquivos novos em vez de usar o cache.

---

## 3. O que você deve notar depois de publicar

| Situação | Antes | Depois |
|---|---|---|
| Você salva um lançamento | releitura completa + redesenho da tela | nada |
| Outra pessoa salva algo da tela aberta | redesenho em 350 ms | redesenho único ~1,2 s depois |
| Outra pessoa salva algo de outra tela | redesenho | dados atualizados, tela parada |
| Sincronização do Omie (centenas de linhas) | dezenas de redesenhos encavalados | 2 a 3 |
| Aba em segundo plano | continuava redesenhando | espera você voltar |
| Logo da barra lateral | piscava a cada 60 s | estável |
| Letreiro financeiro do rodapé | voltava ao início a cada sincronização | contínuo |
| Falha momentânea de rede | podia deslogar e recarregar | ignorada; só sai após 2 falhas |

---

## 4. Como testar

1. Abra o sistema em **duas abas** com o mesmo usuário.
2. Na aba A, cadastre/edite qualquer registro. **A própria aba A não deve mais
   piscar.** A aba B deve atualizar sozinha cerca de 1 segundo depois.
3. Fique na tela **Colaboradores** na aba B e edite uma **compra** na aba A: a
   aba B não deve redesenhar (mas ao ir para Financeiro os dados já estarão lá).
4. Deixe o rodapé (letreiro financeiro) à vista e espere alguns minutos: ele não
   pode mais voltar ao começo sozinho.
5. Olhe a logo da barra lateral por 2–3 minutos: sem piscadas.
6. Rode uma sincronização do Omie e acompanhe: a tela deve se atualizar poucas
   vezes, não continuamente.

---

## 5. Arquivos alterados

```
index.html               (bump de versão, 45 ocorrências)
js/app.js
database/cloud.js
database/indexeddb.js
```

Não há SQL nem Edge Function nesta versão. **Nada precisa ser rodado no
Supabase.**

---

## 6. Verificações feitas

- `node --check` em todos os `.js` do projeto: OK.
- `diff` de cada arquivo contra a v4.2.4: só as alterações acima.
- Teste do comparador de carimbo de tempo com os três formatos reais:
  antes `false`/`false`, depois `true`/`true`, e `false` para instantes
  realmente diferentes.
- Formatos e tipos conferidos direto no banco de produção
  (`updated_at` = `timestamp with time zone`, precisão 6; `to_json` devolve
  `+00:00`) e no pacote `assets/vendor/supabase.js` (`timestamptz → ge = e=>e`).
- Contagem real da base usada no diagnóstico: 3.216 registros / ~2,8 MB.

### Ponto de atenção herdado (não é desta versão)

Quatro testes de `tests/` já falhavam na v4.2.4 e continuam falhando pelo mesmo
motivo: estão presos à v4.0.1 (`security-regression` exige
`application-version content="4.0.1"`, `static` exige
`clique_obras_approve_rdo_v401` em `cloud.js`). Não foram tocados para não mexer
no que não foi pedido — vale atualizá-los numa próxima entrega.
