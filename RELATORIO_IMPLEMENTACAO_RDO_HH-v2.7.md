# Clique Obras v2.7 — Relatório de implementação RDO/HH

## Resultado

O módulo separado de RDO e mão de obra foi integrado à base auditada do Clique Obras v2.6.
A implementação mantém os registros existentes e adiciona controles operacionais,
financeiros e de acesso para o fluxo de diário, aprovação e medição HH.

## Regras de negócio implementadas

| Regra | Comportamento |
|---|---|
| RDO por tipo de projeto | RDO disponível para HH, Obra, Fornecimento de material e demais tipos existentes |
| Medição HH | Calculada somente a partir de RDOs aprovados no período |
| Medição não HH | Obra e Fornecimento permanecem no fluxo manual |
| Dupla medição | Um vínculo único no banco impede que o mesmo RDO seja medido novamente |
| Aprovação do RDO | Gera um snapshot financeiro imutável e um lançamento de custo idempotente |
| Realizado do projeto | Recebe somente o custo de mão de obra |
| Valor de venda | Utilizado apenas na composição da medição HH |
| Projetos no RDO | A lista é limitada aos projetos atribuídos ao usuário pelo administrador |
| Horário coletivo | A entrada, saída, intervalo e horas extras gerais preenchem os colaboradores selecionados |
| Ajuste individual | Cada colaborador pode receber horários e horas diferentes do padrão coletivo |
| Permissões | Visualização e edição seguem a configuração administrativa, inclusive menus |

## Interface

Foram adicionadas as áreas:

- **Diários de Obra**: criação, envio, consulta e aprovação de RDO;
- **Colaboradores**: cadastro da equipe operacional;
- **Valores HH**: configuração de custo e venda normal, HE 50% e HE 100%;
- **Medições**: criação automática para HH e manutenção do fluxo manual para os demais projetos;
- **Configurações**: permissões dos novos módulos e seleção dos projetos disponíveis no RDO.

A interface mobile utiliza cartões e campos empilhados, sem depender de tabelas
largas. Os horários gerais são propagados para todos os colaboradores selecionados
e continuam editáveis individualmente.

## Segurança e integridade

A atualização `supabase/ATUALIZACAO-v2.7-RDO-HH.sql` adiciona:

- novas categorias de registros sincronizados;
- `rdo_measurement_links`, com unicidade por organização e RDO;
- `rdo_cost_postings`, com unicidade por organização e RDO;
- RLS para organização, permissões e escopo de projeto;
- validação de que a medição automática pertence a um projeto HH;
- validação do período, projeto, status e valor dos RDOs medidos;
- imutabilidade de RDO aprovado, snapshot financeiro e composição da medição HH;
- exigência do lançamento de custo e da compra correspondente antes da aprovação;
- bloqueio de medição manual em projetos HH.

Os dados operacionais (`rdos` e `crew`) permanecem separados dos valores financeiros
(`labor_rates` e `rdo_financial`). Assim, um usuário pode preencher o diário sem
receber acesso aos valores de custo ou venda.

## Fluxo financeiro

Ao aprovar um RDO:

1. o sistema calcula horas e valores com as taxas registradas;
2. salva o snapshot de custo e venda do RDO;
3. cria um único lançamento de custo de mão de obra;
4. registra esse custo como compra realizada no projeto;
5. marca o RDO como aprovado.

O valor de venda não entra no Realizado. Nos projetos HH, ele é somado somente
quando o administrador cria uma medição com os RDOs aprovados do período.

## Validação realizada

- testes unitários de horas normais, HE 50%, custo e venda;
- detecção de colaborador sem taxa configurada;
- teste estático dos arquivos, rotas, stores e breakpoints;
- validação de sintaxe de todos os arquivos JavaScript não vendorizados;
- aplicação da migração no Supabase;
- teste transacional do fluxo completo como usuário proprietário:
  RDO enviado → snapshot → custo → aprovação → vínculo → medição HH;
- reversão integral dos dados usados no teste.

## Arquivos principais

- `modules/rdo/rdo.js`
- `modules/medicoes/medicoes.js`
- `modules/configuracoes/configuracoes.js`
- `modules/projetos/projetos.js`
- `database/cloud.js`
- `database/indexeddb.js`
- `css/rdo.css`
- `supabase/ATUALIZACAO-v2.7-RDO-HH.sql`
- `tests/rdo.test.mjs`
- `tests/static.test.mjs`

Versão entregue: **2.7.0**  
Data: **29/07/2026**
