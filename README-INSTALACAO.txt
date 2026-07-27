CLIQUEOBRAS v2.1 — INSTALAÇÃO

Este é o pacote completo do sistema. Não misture arquivos de versões anteriores.

PUBLICAÇÃO NO GITHUB / HOSTINGER
1. Faça um backup da versão publicada.
2. No repositório mauriciosantosolv/Analise-DGA, substitua o conteúdo da branch
   de publicação pelo conteúdo da pasta CliqueObras deste pacote.
3. Preserve config/cloud-config.js com a URL e a Publishable Key atuais.
4. Faça o commit e aguarde a implantação automática da Hostinger.
5. Depois da publicação, abra cliqueobras.com em uma janela anônima e teste:
   login, Dashboard, Financeiro, Planejamento, Configurações e logout.

SUPABASE
- A estrutura v2.1 está em supabase/schema.sql.
- Ela preserva app_records e adiciona organizações, membros, convites, perfis
  e RLS por organização/permissão.
- Nunca coloque service_role, Secret Key ou senha do banco no navegador.

PRINCIPAIS MUDANÇAS
- Perfil abre Configurações.
- Logout no final da rolagem do menu.
- Filtros combináveis dentro dos lotes importados.
- Gastos manuais e importados podem abater o planejamento.
- A exclusão de um gasto conciliado restaura o planejamento.
- Usuários podem compartilhar a mesma organização.
- Proprietário/administrador edita perfil e permissões por módulo.
- Título da página alterado para "cliqueobras".
- Favicon incluído.

COMO VINCULAR OUTRO USUÁRIO
1. Entre como proprietário ou administrador.
2. Abra Configurações > Organização e permissões.
3. Clique em Vincular usuário.
4. Informe o e-mail exato e defina perfil/permissões.
5. O usuário entra na organização no próximo login. Se ainda não tiver conta,
   deverá se cadastrar usando exatamente o e-mail convidado.
