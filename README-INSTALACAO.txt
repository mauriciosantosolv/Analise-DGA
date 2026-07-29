CLIQUEOBRAS v2.6 — INSTALAÇÃO SEGURA

Este é o pacote completo do sistema. Não misture arquivos de versões anteriores.

PUBLICAÇÃO NO GITHUB / HOSTINGER
1. Faça um backup da versão publicada.
2. No repositório mauriciosantosolv/Analise-DGA, substitua o conteúdo da branch
   de publicação pelo conteúdo da pasta CliqueObras deste pacote.
3. Preserve config/cloud-config.js com a URL e a Publishable Key atuais.
4. Não remova o arquivo .htaccess nem o manifest.webmanifest.
5. Faça o commit e aguarde a implantação automática da Hostinger.
6. Depois da publicação, abra cliqueobras.com em uma janela anônima e teste:
   login, Dashboard, Financeiro, Planejamento, Configurações e logout.

SUPABASE
- Antes de publicar, exporte um backup da base.
- Para instalação existente, execute
  supabase/ATUALIZACAO-SEGURANCA-v2.6.sql.
- Para instalação nova, execute supabase/schema.sql.
- Ela preserva app_records e adiciona organizações, membros, convites, perfis
  e RLS por organização/permissão.
- Nunca coloque service_role, Secret Key ou senha do banco no navegador.
- Ative a proteção contra senhas comprometidas no painel de Authentication.

PRINCIPAIS MUDANÇAS v2.6
- Hierarquia de equipe protegida no RLS contra elevação de privilégios.
- Escrita remota validada antes de alterar o cache local.
- Conflitos offline preservam a fila e não sobrescrevem a nuvem.
- Planilhas, backups e imagens possuem validação e limites.
- SheetJS 0.20.3 e Chart.js 4.5.1.
- Configurações e login reorganizados para celular.
- Manifesto instalável e cabeçalhos de segurança para HTTPS.

COMO VINCULAR OUTRO USUÁRIO
1. Entre como proprietário, administrador ou gestor delegado.
2. Abra Configurações > Organização e permissões.
3. Clique em Vincular usuário.
4. Informe o e-mail exato e defina perfil/permissões.
5. O usuário entra na organização no próximo login. Se ainda não tiver conta,
   deverá se cadastrar usando exatamente o e-mail convidado.
6. Apenas o proprietário pode conceder perfil de administrador ou delegar a
   gestão de usuários.
