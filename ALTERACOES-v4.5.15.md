# CliqueObras v4.5.15: remessa que mudou de projeto no Omie e troca de material na hora da ativação

Base: v4.5.12 (site) e produção de 10/11/2026. **Sem SQL novo.** Muda a Edge Function `omie-integration`
(produção está na versão 4) e o front (`omie-remessa.js`).

> Numeração: a `omie-remessa-limpeza` em produção já tem mudanças chamadas v4.5.13 (05/10) e v4.5.14
> (07/10) que **não estão** no ZIP v4.5.12. Por isso esta versão é a 4.5.15. A `omie-remessa-limpeza`
> não foi tocada.

## 1. Notas de remessa que mudaram de projeto no Omie continuavam no projeto antigo

### Causa
A sincronização só lia no Omie as remessas cujo projeto **atual** estava em "custo por remessa". Depois
que uma remessa mudava de projeto no Omie, ela deixava de ser lida, e nenhuma etapa retirava o lançamento
que já estava gravado. O mesmo valia para remessa excluída no Omie.

### Medido em produção em 10/11/2026 (Omie real, sem gravar nada)
362 remessas listadas no Omie (listagem completa), 53 gravadas no CliqueObras. **6 mudaram de projeto**,
todas para projetos sem vínculo no CliqueObras:

| NF | De (Omie) | Para (Omie) | Valor |
|---|---|---|---|
| 420 | 778- CORTEVA- ITUMBIARA- GO | 2456836137 | R$ 21.189,33 |
| 368 | 778- CORTEVA- ITUMBIARA- GO | 2456836137 | R$ 1.074,00 |
| 352 | 778- CORTEVA- ITUMBIARA- GO | 2448163765 | R$ 3.240,00 |
| 413 | 778- CORTEVA- ITUMBIARA- GO | 2448163765 | R$ 41,90 |
| 385 | 927 | 2444707008 | R$ 34.396,97 |
| 386 | 927 | 2167517648 | R$ 1.339,40 |

### Correção
A cada sincronização, os lançamentos de remessa gravados nos projetos sincronizados são comparados com a
listagem completa do Omie (`remessaRetirements`, em `remessa.mjs`):

| Situação no Omie | O que acontece |
|---|---|
| Remessa agora em projeto **fora** da execução | Estornada do projeto antigo (devolve o planejamento) |
| Remessa agora em outro projeto **também** em remessa | A rotina normal relança no projeto novo (já fazia isso) |
| Remessa excluída do Omie | Estornada, **só** com a listagem completa |
| Remessa no mesmo projeto, aguardando situação ou sem DE-PARA | **Não é tocada** |

O estorno usa a função de sempre (`clique_obras_apply_omie_remessas_v457`, `active:false`). A **Prévia**
mostra as que vão sair. O resumo da sincronização ganha `remessas.moved` e `remessas.movedItems`.

### Ensaio no banco de produção (transação desfeita, nada gravado)
As 6 estornadas: `cancelled: 6`. Lançamentos de remessa 53 → 47. Planejamento de "Compras de Material"
dos projetos 778 e 927: R$ 60.099,06 → R$ 97.335,43 (+R$ 37.236,37, exatamente o que essas remessas
tinham abatido, conforme `planningOffsetAmount`). 4 registros `omie_restored` no histórico. Depois de
desfazer: 53 lançamentos, NF 420 presente.

## 2. Ao ativar "custo por remessa", o material é trocado na hora
Regra em vigor (v4.5.14, Mauricio 07/10/2026, mantida): a remessa substitui **só "Compras de Material"**.
O material pago no cartão corporativo e **todas as outras categorias** continuam vindo do Contas a Pagar.

Antes, ao ativar um projeto, o material fora do cartão só saía na limpeza agendada e as remessas só
entravam na sincronização seguinte. O aviso da tela ainda dizia que as contas "permanecem".

Agora, ao **Salvar** com projeto novo em remessa:
1. o servidor retira na hora o rateio de **Compras de Material** das contas a pagar fora do cartão desse
   projeto (mesma expressão `isMaterialCategoryV4514` da limpeza) e marca `payables_cleared_at`;
2. a tela sincroniza só esses projetos, e as remessas faturadas entram;
3. o aviso e o resumo mostram o que saiu e o que entrou.

Conferido no Omie real: no 778 há um título fora do cartão em "Compra de Serviços" (R$ 400,00, 2451387787).
Ele **fica**, como manda a regra v4.5.14. Um teste fixa esse caso.

## Arquivos
- `supabase/functions/omie-integration/remessa.mjs`: `remessaRetirements`, `nonCardPayableIds`,
  `isMaterialCategory` e `retirePayableEntries` (novas).
- `supabase/functions/omie-integration/index.ts`: `collectRemessas` devolve o projeto atual de toda remessa
  listada; `remessaRetirementsFor` e `retireNonCardPayables` (novas); etapa de remessa da sincronização,
  `remessa-preview` e `remessa-save`.
- `modules/integracoes/omie-remessa.js`: sincroniza após ativar, novo texto do aviso e da prévia.
- `index.html`, `js/app.js`: versão 4.5.15.
- `tests/v4515-remessa-projeto-trocado.test.mjs`: novo, 10 testes, incluindo os casos reais acima.

## Verificação
- `node --test tests/*.test.mjs`: 76/80. As 4 falhas são as mesmas de sempre (presas à v4.0.1).
- `deno check` da `omie-integration`: só os 2 erros de tipo que já existiam.
- A `omie-integration` de produção (versão 4) é idêntica à base usada.
- Função auxiliar `omie-remessa-teste`, usada só para ler o Omie no ensaio, foi **desativada**
  (responde 410). Pode ser excluída no painel do Supabase.

## Como publicar
1. Publicar a Edge Function `omie-integration`. **Atenção:** o agendador roda a sincronização a cada
   5 min. Na primeira rodada depois da publicação, as 6 remessas da tabela saem dos projetos 778 e 927.
2. Subir os arquivos do site e, **por último**, o `index.html`.
