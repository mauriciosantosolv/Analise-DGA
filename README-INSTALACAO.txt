CLIQUE OBRAS — LOGIN E BACKEND SUPABASE

O pacote contém somente os arquivos novos ou substituídos:
- config/cloud-config.js
- database/cloud.js
- database/indexeddb.js
- css/auth.css
- js/auth-ui.js
- index.html

O que foi implementado
- Correção da configuração Supabase que estava com URL e chave sem aspas.
- Tela profissional de login.
- Criação de conta.
- Confirmação de e-mail.
- Recuperação e troca de senha.
- Botão de conta e logout no sistema.
- Sessão persistente e renovação do token.
- Sincronização dos dados com o Supabase.
- Fila offline separada por usuário.
- Proteção contra um usuário visualizar o cache local de outra conta no mesmo computador.
- Uso da Publishable Key; nenhuma service_role ou senha do banco é exposta.

COMO INSTALAR NO GITHUB
1. Abra o repositório mauriciosantosolv/Analise-DGA.
2. Substitua cada arquivo existente pelo correspondente deste pacote.
3. Crie os arquivos novos css/auth.css e js/auth-ui.js.
4. Faça commit na branch main.
5. Aguarde a Hostinger executar a implantação automática do GitHub.

CONFIGURAÇÃO OBRIGATÓRIA NO SUPABASE
1. Acesse Authentication > URL Configuration.
2. Em Site URL, coloque a URL pública exata do seu site na Hostinger.
   Exemplo: https://seudominio.com.br
3. Em Redirect URLs, adicione:
   https://seudominio.com.br/**
4. Acesse Authentication > Providers > Email.
5. Mantenha Email habilitado.
6. Para exigir confirmação por e-mail, mantenha Confirm email ativado.
7. Para testes iniciais, você pode desativar temporariamente Confirm email.
8. O banco já possui a tabela public.app_records com RLS e políticas por user_id.

TESTE RECOMENDADO
1. Abra o site em janela anônima.
2. Clique em Criar minha conta.
3. Confirme o e-mail recebido.
4. Entre com a conta.
5. Cadastre um projeto ou importe uma planilha.
6. Saia da conta.
7. Entre em outro navegador com a mesma conta e confirme que os dados aparecem.
8. Crie uma segunda conta e confirme que ela não vê os dados da primeira.

OBSERVAÇÃO SOBRE O GITHUB
A integração automática disponível nesta sessão conseguiu ler e analisar o repositório,
mas o GitHub retornou erro 403 ao tentar criar branch e gravar arquivos. Por isso, este
pacote foi preparado para substituição direta no repositório.
