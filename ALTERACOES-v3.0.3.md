# CliqueObras v3.0.3

Atualização construída sobre a v3.0.2, preservando os reparos de RDO mobile e o endurecimento de segurança.

## Colaboradores

- nomes longos não excedem mais os cards no celular;
- cadastro com matrícula e foto comprimida;
- busca por matrícula, nome ou função/cargo;
- cadastro, edição e exclusão controlada de funções no próprio módulo;
- função em uso por algum colaborador não pode ser excluída.

## Jornada e RDO

- jornada padrão configurável por empresa: entrada, saída, intervalo e limite de horas normais por dia;
- padrão inicial de 8,8 horas/dia;
- excedente calculado automaticamente como HE 50%;
- matrícula e foto passam a acompanhar a seleção da equipe;
- RDOs anteriores não são recalculados nem alterados.

## Medições e PDFs

- PDF detalhado para medições HH;
- tabela por dia e colaborador com matrícula, entrada, intervalo, saída, hora normal, HE 50%, HE 100%, total de horas e valor medido;
- subtotal de cada dia e valor total da medição;
- papel timbrado JPG configurável e aplicado aos PDFs de RDO, medição e dashboard/projeto.

## Interface

- Configurações da empresa ocupam toda a largura disponível no desktop;
- Preferências e ticker ficam distribuídos em duas colunas equilibradas;
- Valores HH podem ser filtrados por projeto;
- tema claro atualizado para a paleta solicitada:
  - fundo `#F4F4F5`;
  - superfícies `#FFFFFF`;
  - divisórias `#E4E4E7`;
  - texto secundário `#52525B`;
  - texto principal `#27272A`;
  - ações primárias `#18181B`.

## Supabase e segurança

- migração `ATUALIZACAO-v3.0.3-COLABORADORES-PDF.sql`;
- jornada, identidade e papel timbrado protegidos para proprietário/administrador;
- validação no banco para horários, limite diário, matrícula, funções e imagens;
- testes transacionais executados com rollback, sem alterar dados de negócio.

## Verificação

- testes de cálculo de RDO;
- testes do consolidado do PDF da medição;
- testes estáticos de integração;
- testes de regressão de segurança;
- checagem de sintaxe de todos os módulos JavaScript.
