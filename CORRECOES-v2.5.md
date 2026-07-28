# Clique Obras v2.5

## Alterações realizadas

- A organização ativa passou a ser salva no perfil da nuvem, deixando de
  depender apenas do armazenamento do navegador. O mesmo usuário abre a mesma
  organização em qualquer aparelho.
- Os registros compartilhados agora são identificados por
  `organização + módulo + registro`, permitindo que usuários diferentes editem
  a mesma informação sem criar cópias por usuário.
- Alterações em dados, membros e organização são recebidas em tempo real.
  O aplicativo também revalida o acesso periodicamente e limpa o cache local
  quando um vínculo é removido.
- O dashboard e o módulo de medições exibem separadamente:
  total medido, faturado, aprovado e aguardando aprovação.
- O ticker e o semáforo financeiro abrem o resultado do projeto com um campo
  para registrar a justificativa do desvio, substituindo o antigo bloco
  "Compromisso financeiro".
- A pesquisa global ganhou um botão `X` para limpar o texto e fechar os
  resultados.
- O lançamento manual com a opção de abatimento agora reduz o planejamento
  antes de concluir a gravação. Se alguma etapa falhar, o saldo planejado é
  restaurado.

## Banco de dados

A migração incremental está em `supabase/ATUALIZACAO-v2.5.sql` e também foi
incorporada ao `supabase/schema.sql` para novas instalações.

Na base de produção, a migração foi aplicada e executada novamente para validar
que é idempotente. A verificação final encontrou:

- 893 registros preservados;
- chave primária de `app_records` em
  `(organization_id, store, record_id)`;
- 3 tabelas publicadas no Realtime;
- nenhum perfil apontando para uma organização sem vínculo;
- gatilhos de validação e troca de organização ativos.

## Validações

- Sintaxe de todos os arquivos JavaScript;
- referências de scripts e IDs do HTML;
- teste funcional dos três estados de medição;
- teste do botão de limpar pesquisa;
- persistência da justificativa;
- abatimento de R$ 200 em um planejamento de R$ 500, resultando em saldo de
  R$ 300 e vínculo de estorno registrado;
- verificação de integridade e idempotência da migração no Supabase.
