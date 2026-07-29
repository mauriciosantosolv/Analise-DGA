# Plano de homologação de 30 dias — CliqueObras v2.6

## Critério de entrada (dia 0)

- backup exportado e testado em ambiente separado;
- migração `ATUALIZACAO-SEGURANCA-v2.6.sql` executada;
- proteção contra senhas comprometidas habilitada;
- publicação HTTPS com cabeçalhos de segurança confirmados;
- quatro contas de teste: proprietário, administrador, editor e leitor;
- um celular Android e um iPhone, além de desktop.

Se qualquer item falhar, o piloto não começa.

## Rotina diária

Registre em uma planilha ou issue:

- horário, aparelho, usuário/perfil;
- ação realizada;
- resultado esperado e observado;
- status da sincronização e quantidade de itens pendentes;
- captura de tela e erro do console quando houver;
- impacto: bloqueante, alto, médio ou cosmético.

Ao final de cada dia, exporte backup JSON. Não use dados pessoais ou financeiros
reais de clientes durante a homologação.

## Dias 1–7 — acesso e mobile

- login, logout, recuperação e troca de senha;
- convite e aceitação de cada perfil;
- tentativa deliberada de editor/leitor acessar e editar módulos não liberados;
- tentativa de administrador criar outro administrador — deve ser bloqueada;
- remoção de membro com sessão aberta em outro aparelho;
- navegação por todos os menus em 360, 390 e 430 px;
- configurações, equipe, tabelas horizontais, teclado virtual e rotação;
- instalação pela opção “Adicionar à tela inicial”.

Saída da semana: zero exposição entre organizações e zero elevação de perfil.

## Dias 8–14 — sincronização e recuperação

- criar/editar/excluir dados online em dois aparelhos;
- trabalhar offline e reconectar sem mudança concorrente;
- editar o mesmo registro offline em um aparelho e online em outro;
- confirmar que o conflito bloqueia sobrescrita e mantém a fila;
- desligar a rede durante importação e durante gravação manual;
- tentar logout com fila pendente;
- restaurar backup em ambiente separado e conferir contagens/totais.

Metas:

- perda de dados: 0;
- sobrescrita silenciosa: 0;
- divergência não sinalizada: 0;
- restauração completa em até 15 minutos.

## Dias 15–21 — carga, importação e gráficos

- planilhas pequenas, médias e próximas dos limites documentados;
- arquivo acima de 15 MB e mais de 25 mil linhas — devem ser rejeitados;
- backup inválido, grande ou adulterado — deve ser rejeitado;
- conferir deduplicação de importações repetidas;
- comparar totais de Dashboard, Financeiro, Orçamento, Planejamento e Excel;
- testar gráficos com 1, 6, 20 e mais projetos no celular;
- validar nomes longos, valores negativos e categorias extensas.

Metas:

- totais inconsistentes: 0;
- travamento do navegador: 0;
- arquivo inválido aceito: 0.

## Dias 22–30 — operação e decisão

- simular indisponibilidade do Supabase e retorno do serviço;
- testar expiração de sessão e revogação de usuário;
- validar backup diário e uma segunda restauração completa;
- revisar logs de Auth, Postgres e Realtime sem expor dados pessoais;
- conferir alertas do Security Advisor;
- corrigir todos os itens bloqueantes/altos e repetir o cenário;
- realizar teste final em rede móvel lenta e em aparelhos físicos.

## Gate de aprovação para mercado

Somente aprovar se:

- nenhum incidente crítico ou alto estiver aberto;
- nenhum acesso cruzado entre organizações tiver ocorrido;
- nenhum dado tiver sido perdido ou sobrescrito silenciosamente;
- duas restaurações completas tiverem sido aprovadas;
- todos os perfis tiverem passado nos testes negativos;
- login, configurações, financeiro e planejamento forem utilizáveis nos dois
  sistemas móveis;
- cabeçalhos, RLS e advisors continuarem conformes no dia 30.

Qualquer falha de isolamento, privilégio, restauração ou perda de dados reprova
o piloto e exige novo ciclo após a correção.

## Resposta a incidente

1. interromper novas importações e alterações;
2. registrar horário, usuários e aparelhos envolvidos;
3. exportar backup e preservar logs;
4. revogar a sessão/usuário afetado quando houver suspeita de acesso;
5. não restaurar ou apagar dados antes de comparar nuvem, fila e backup;
6. corrigir em ambiente separado, repetir o cenário e só então retomar.
