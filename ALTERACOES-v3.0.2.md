# CliqueObras v3.0.2

Revisão corretiva construída diretamente sobre a v3.0.1.

- Campos de entrada e saída do RDO respeitam a largura disponível no celular,
  inclusive no Safari do iPhone.
- A etapa de equipe recebeu ícone compatível, pesquisa por nome/função e botão
  para limpar a pesquisa.
- Um novo RDO não marca toda a equipe automaticamente; o preenchedor escolhe
  explicitamente os colaboradores que participaram.
- Diários de Obra, Colaboradores, Medições e Valores HH foram agrupados em
  **Execução** no menu lateral.
- O menu de Colaboradores usa um ícone presente na versão embarcada do Lucide.
- Títulos de modal e mensagens temporárias tratam conteúdo dinâmico como texto,
  reduzindo a superfície de XSS.
- As Edge Functions agora restringem origens, corpo e formato das solicitações,
  validam identificadores e aplicam limites persistentes por usuário.
- CSP e cabeçalhos da Hostinger foram reforçados.
- RLS, bucket privado, permissões administrativas e ausência de chaves secretas
  no navegador foram revalidados contra o Supabase publicado.

Pendência externa: o verificador do Supabase recomenda ativar a proteção contra
senhas vazadas no painel de Authentication.
