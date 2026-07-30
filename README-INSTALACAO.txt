CLIQUEOBRAS v2.9 — INSTALAÇÃO SEGURA

Este é o pacote completo do sistema. Não misture arquivos de versões anteriores.

PUBLICAÇÃO NO GITHUB / HOSTINGER
1. Faça um backup da versão publicada.
2. No repositório mauriciosantosolv/Analise-DGA, substitua o conteúdo da branch
   de publicação pelo conteúdo da pasta CliqueObras deste pacote.
3. Preserve config/cloud-config.js com a URL e a Publishable Key atuais.
4. Não remova o arquivo .htaccess nem o manifest.webmanifest.
5. Faça o commit e aguarde a implantação automática da Hostinger.
6. Depois da publicação, abra cliqueobras.com em uma janela anônima e teste:
   login, Dashboard, RDO, Medições, Financeiro, Configurações e logout.

SUPABASE
- Antes de publicar, exporte um backup da base.
- Para instalação existente, execute nesta ordem:
  1. supabase/ATUALIZACAO-SEGURANCA-v2.7.sql
  2. supabase/ATUALIZACAO-v2.7-RDO-HH.sql
  3. supabase/ATUALIZACAO-v2.8-RDO-FOTOS-PDF.sql
  4. supabase/ATUALIZACAO-v2.9-RDO-REVISAO-MEDICAO.sql
- Para instalação nova, execute supabase/schema.sql e as quatro atualizações
  acima, na mesma ordem.
- Ela preserva app_records e adiciona organizações, membros, convites, perfis
  e RLS por organização/permissão.
- Nunca coloque service_role, Secret Key ou senha do banco no navegador.
- Ative a proteção contra senhas comprometidas no painel de Authentication.

PRINCIPAIS MUDANÇAS v2.9
- Nova identidade visual no favicon, login, menu e atalho instalado no celular.
- Ícones PWA próprios para Android e iPhone, incluindo máscara segura.
- Exclusão de RDO em rascunho ou reprovado, com remoção dos anexos.
- Reprovação de RDO com comentário obrigatório e histórico de revisão.
- Custo por hora centralizado no cadastro do colaborador; a venda varia por obra.
- Exclusão controlada de medição HH não faturada, liberando os RDOs vinculados.
- PDF de RDO em A4 vertical com logo e nome do cliente.
- PDF do dashboard com logo do cliente e justificativa do desvio.

REGRAS PRESERVADAS DA v2.8
- Hierarquia de equipe protegida no RLS contra elevação de privilégios.
- Escrita remota validada antes de alterar o cache local.
- Conflitos offline preservam a fila e não sobrescrevem a nuvem.
- Planilhas, backups e imagens possuem validação e limites.
- SheetJS 0.20.3 e Chart.js 4.5.1.
- Configurações e login reorganizados para celular.
- Manifesto instalável e cabeçalhos de segurança para HTTPS.
- RDO disponível para todos os projetos, com seleção por usuário.
- Medição automática por RDO apenas para contratos HH.
- RDO medido não pode entrar em outra medição.
- Aprovação lança somente o custo da mão de obra no realizado.
- Custos, valores comerciais e snapshots possuem permissões separadas.
- RDO guiado em quatro etapas, alinhado ao modelo operacional aprovado.
- Fotos e PDFs anexados em bucket privado, com RLS por organização e projeto.
- Confirmação visual após o envio para aprovação.
- PDF individual do RDO com equipe, horas, serviço, ocorrências e fotos.
- Formulário do RDO reconstruído para uso em smartphone sem rolagem horizontal.

COMO VINCULAR OUTRO USUÁRIO
1. Entre como proprietário, administrador ou gestor delegado.
2. Abra Configurações > Organização e permissões.
3. Clique em Vincular usuário.
4. Informe o e-mail exato e defina perfil/permissões.
5. O usuário entra na organização no próximo login. Se ainda não tiver conta,
   deverá se cadastrar usando exatamente o e-mail convidado.
6. Apenas o proprietário pode conceder perfil de administrador ou delegar a
   gestão de usuários.
7. Selecione também os projetos que aparecerão na lista de RDO daquele usuário.
