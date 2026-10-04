# CliqueObras v4.5.12 — 03/10/2026

Base: v4.5.11 (pasta `V4.5.11`). Arquivos alterados em relação a ela:

| Arquivo | O quê |
|---|---|
| `index.html` | versão 4.5.12 (51 `?v=`) + 1 `<script>` novo: `modules/configuracoes/conta.js` (agora 52) |
| `js/app.js` | rótulo da versão (2 lugares) |
| `database/cloud.js` | 3 funções NOVAS: `transferOwnership`, `accountDeletionCheck`, `deleteOwnAccount` (nenhuma existente mudou) |
| `modules/configuracoes/conta.js` | **NOVO** — telas de Transferir propriedade e Excluir minha conta |
| `modules/medicoes/medicoes.js` | ajustes da medição com quantidade × valor unitário |
| `css/rdo.css` | layout das linhas de ajuste + colunas novas no PDF |
| `supabase/ATUALIZACAO-v4.5.12-CONTA-PROPRIEDADE.sql` | **NOVO** — banco (ver abaixo) |
| `supabase/functions/delete-own-account/index.ts` | **NOVA** Edge Function |
| `tests/v4512-conta-medicao.test.mjs` | **NOVO** — 13 testes |

Testes: 79 passando / 4 falhando — os mesmos 4 presos à v4.0.1 de sempre (o pristine da v4.5.11 dá 66/4).

## 1. Nenhum dado se perde quando uma conta é excluída

**O problema medido no banco:** `app_records.user_id` apontava para `auth.users` com
`ON DELETE CASCADE`. `user_id` é "quem gravou por último" (a regra de UPDATE obriga isso).
Ou seja: excluir um usuário — hoje só pelo painel do Supabase — apagava em cascata todo
registro que ele tocou por último. A conta designitumbiara "assina" 7.010 dos 9.758
registros: excluí-la apagaria quase a DGA inteira. Outras 12 chaves estrangeiras ou
apagavam (convites enviados), ou travavam a exclusão (anexos de RDO, lançamentos, Omie).

**Correção (SQL):**
- saem as 13 chaves estrangeiras de tabelas de DADO para `auth.users`/`profiles`. As
  colunas e os valores ficam iguais — o UUID do autor continua lá como histórico.
  Nenhuma linha é alterada pelo script;
- tabela `clique_obras_private.deleted_users_v4512`: nome, e-mail, vínculos e quantos
  registros a pessoa assinava, gravados na hora da exclusão;
- gatilho novo em `auth.users` (vale também para exclusão pelo painel do Supabase):
  **recusa** excluir o único proprietário de organização com outros membros ("transfira a
  propriedade antes") e, se a pessoa era a dona da conexão do Omie, passa a sincronização
  automática para outro proprietário/admin (senão o Omie pararia).

**Tela:** Configurações › cartão da sua conta › **Excluir minha conta**. Confere
pendências de sincronização, mostra quantos registros ficam, pede senha (conferida no
servidor) e a palavra EXCLUIR. Único proprietário → tela pedindo a transferência.
Se a pessoa é o único membro de alguma organização com dados, a tela avisa que esses dados
ficam guardados, mas sem ninguém com acesso.

## 2. Transferir a propriedade da organização

Configurações › Funcionários e acessos › faixa **Transferir propriedade** (só o
proprietário vê). Escolhe o membro + confirma. Numa única transação o membro vira
**Proprietário** e quem transferiu vira **Administrador** (sua escolha). Nenhum dado muda:
os registros pertencem à organização, não ao dono. As regras de proteção de proprietário
que já existiam continuam valendo nas duas trocas.

## 3. Medição: quantidade, unidade e valor unitário nos descontos/adicionais

Cada linha agora tem **Qtd × Valor unitário = Valor da linha** (calculado na hora), mais
**Unidade** opcional (un, m, kg… com sugestões). O aprovador vê os campos na tela da
medição, no PDF (colunas Qtd · Un. · Valor unit.) e no XLSX (aba Resumo).
- Linha criada na v4.5.10 (só valor) abre como 1 × valor; se ninguém mexer, ela é
  regravada **exatamente como era** — o sistema não inventa quantidade. No PDF sai "—".
- Totais, fluxo de caixa e saldo a medir: mesma regra da v4.5.10 (vale o valor da linha).
- Banco: nada muda para a medição — o servidor continua conferindo o valor de cada linha.

## Ordem de publicação (importante)

1. SQL no banco → 2. Edge Function `delete-own-account` → 3. front (GitHub).
O botão "Excluir minha conta" só funciona depois do passo 1 (antes disso ele mostra erro e
não faz nada). Publicar o front antes não apaga nada.
