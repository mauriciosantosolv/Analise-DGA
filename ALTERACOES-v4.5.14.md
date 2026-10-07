# CliqueObras v4.5.14 — 07/10/2026 — custo por remessa vale só para material

Só servidor. Publicado direto em produção (projeto mwelgpjkqljtkzbqxmag).
Sem SQL, sem front. A omie-integration NÃO foi alterada (segue na versão 4).

## Regra (Mauricio, 07/10/2026)
Nos projetos com custo por remessa, a nota de remessa substitui APENAS a categoria
"Compras de Material". Todas as outras categorias vêm do Contas a Pagar, pagas no
cartão ou não. Material pago no cartão corporativo continua entrando.

## Sintoma
Projeto 898 (Omie 2422442455): Hospedagem com R$ 270,00 no sistema e R$ 7.390,00 no Omie.
Ativado no custo por remessa em 06/10 13:38 UTC; a limpeza das 13:55 retirou os
títulos fora do cartão de TODAS as categorias (regra anotada em 03/10).

## O que mudou
Edge Function `omie-remessa-limpeza` versão 5 (antes 4):
- `payables-v4514.mjs` (NOVO): regra nova + cópia literal das funções de montagem
  da omie-integration/logic.mjs (mesma identidade título:categoria:índice).
- `index.ts`: retirada passa por `onlyMaterialV4514` (só material sai); nova etapa
  `restoreNonMaterial` traz as outras categorias fora do cartão pelas MESMAS RPCs
  da sincronização (reconcile + apply_omie_entries → abate planejamento,
  histórico omie_consumed). Só grava título que mudou. Listagem com exibir_obs.
- `logic.mjs` e `logic-v4513.mjs`: reenviados idênticos.

## Resultado
- Simulação 17:06 UTC: 10/10 projetos lidos; 59 títulos a entrar; 52 rateios de material seguem fora.
- Execução 17:08 UTC: imported 59, nada retirado.
  46 eram os títulos retirados antes (R$ 96.742,98) + 13 lançados no Omie depois da
  ativação que nunca tinham entrado (R$ 71.125,59).
- Execução agendada 17:15 UTC: settled 59, imported 0 (nada regravado).
- Projeto 898, Hospedagem: 10 títulos, R$ 7.390,00 — igual ao Omie.
