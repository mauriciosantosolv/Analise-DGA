CLIQUEOBRAS v3.0.2 — INSTALAÇÃO SEGURA

Este pacote foi construído diretamente sobre a v3.0.1 e preserva os
endurecimentos de segurança das versões anteriores. Publique todos os arquivos
juntos.

ORDEM OBRIGATÓRIA
1. Exporte um backup do banco no Supabase e mantenha a v2.9 publicada até o
   término dos testes.
2. No SQL Editor do Supabase, execute:
   supabase/ATUALIZACAO-v3.0-REPAROS.sql
   Em seguida, execute:
   supabase/ATUALIZACAO-v3.0.1-STORAGE-RDO.sql
   Por último, execute:
   supabase/ATUALIZACAO-v3.0.2-SEGURANCA-REQUISICOES.sql
3. Implante as duas Edge Functions:
   supabase/functions/send-organization-invite/index.ts
   Nome da função: send-organization-invite
   supabase/functions/delete-rdo/index.ts
   Nome da função: delete-rdo
   Verificação JWT: ativada (padrão).
4. Somente depois substitua no GitHub/Hostinger todos os arquivos do site pela
   pasta CliqueObras-v3.0.2.
5. Preserve config/cloud-config.js com a URL e a Publishable Key atuais.

COMO IMPLANTAR AS EDGE FUNCTIONS
- Pelo Supabase CLI, dentro deste pacote:
  supabase functions deploy send-organization-invite
  supabase functions deploy delete-rdo
- O Supabase fornece automaticamente SUPABASE_URL, SUPABASE_ANON_KEY e
  SUPABASE_SERVICE_ROLE_KEY para a função. Nunca copie a service_role para
  config/cloud-config.js, GitHub, Hostinger ou qualquer arquivo do navegador.
- Em Authentication > URL Configuration, confirme cliqueobras.com entre as
  URLs de redirecionamento permitidas.

PUBLICAÇÃO NO GITHUB / HOSTINGER
1. No repositório mauriciosantosolv/Analise-DGA, substitua o conteúdo da branch
   publicada pelo conteúdo da pasta CliqueObras-v3.0.2.
2. Não remova .htaccess nem manifest.webmanifest.
3. Faça o commit e aguarde a implantação automática da Hostinger.
4. Abra cliqueobras.com em janela anônima e confira se o rodapé mostra v3.0.2.

TESTE DE HOMOLOGAÇÃO
1. Role uma tela longa, altere um registro e confirme que a página não volta ao
   topo.
2. Cadastre um modelo e importe compras, contas pagas e mão de obra com as
   colunas Fornecedor e Pedido/Nota.
3. Convide um novo e-mail e abra o link recebido.
4. Exclua uma medição HH não faturada e confirme que os RDOs foram liberados.
5. Exclua, como administrador, um RDO aprovado que não esteja medido e confirme
   o estorno do custo realizado.
6. Tente excluir orçamento/cliente com cadastro financeiro e confirme o bloqueio.
7. Cadastre duas competências em Base de Cálculo e confirme que uma obra
   concluída mantém o percentual histórico.

PRINCIPAIS REPAROS v3.0.2
- Campos de hora do RDO ajustados para iPhone e demais telas estreitas.
- Busca de colaboradores por nome ou função; novos RDOs exigem seleção
  explícita da equipe para evitar inclusão acidental.
- Menus de RDO, colaboradores, medições e valores HH reunidos em Execução, com
  ícones compatíveis com a biblioteca publicada.
- Edge Functions com origem permitida, limite de corpo, validação de entrada e
  limitação persistente de requisições administrativas.
- Mensagens e títulos de modal deixaram de inserir texto dinâmico como HTML.
- CSP e cabeçalhos HTTP reforçados contra execução de scripts e incorporação.
- Rolagem preservada e eco da própria sincronização ignorado.
- Modelos procuram o cabeçalho nas primeiras 20 linhas e preservam campos
  opcionais de fornecedor, pedido/nota, categoria, descrição e observações.
- Empresa, logo, funcionários e permissões reunidos em uma única seção; somente
  proprietário e administrador podem alterá-los.
- Convite por e-mail implementado e falha de aceite durante o cadastro corrigida.
- RPC de exclusão da medição recriada e cache do PostgREST recarregado.
- Administrador pode excluir RDO aprovado fora de medição, com estorno de custo,
  remoção do snapshot e limpeza das fotos pela API oficial do Storage.
- Título da página reduzido para CliqueObras.
- Orçamento e cliente com cadastro financeiro vinculado não podem ser excluídos.
- Base de cálculo versionada por competência, com snapshot histórico ao concluir
  a obra.

REGRAS PRESERVADAS
- RLS por organização e permissões, sem service_role no navegador.
- RDO aprovado permanece bloqueado para edição.
- Medição faturada não pode ser excluída.
- RDO medido não pode ser excluído antes da medição correspondente.
- Fotos e documentos continuam no bucket privado rdo-evidencias.
- A aprovação do RDO lança somente o custo da mão de obra no realizado.
