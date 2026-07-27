# cliqueobras v2.1 — Supabase

O sistema usa Supabase Auth e uma base compartilhada por organização. Projetos,
orçamentos, financeiro, planejamento, medições, clientes, categorias e
configurações continuam no `app_records`, agora protegidos por RLS de
organização e permissões por módulo.

## Ativação

1. Abra o SQL Editor do projeto Supabase.
2. Execute `supabase/schema.sql` completo.
3. Confira se as tabelas abaixo estão com RLS ativo:
   - `app_records`
   - `profiles`
   - `organizations`
   - `organization_members`
   - `organization_invitations`
4. Em `Authentication > URL Configuration`, use:
   - Site URL: `https://cliqueobras.com`
   - Redirect URL: `https://cliqueobras.com/**`

O SQL é idempotente e migra contas existentes sem apagar registros: cada conta
atual recebe sua própria organização e permanece proprietária dos dados que já
possuía.

## Configuração do frontend

`config/cloud-config.js` deve conter apenas a URL e a Publishable Key:

```js
window.CLIQUE_OBRAS_CLOUD = {
  enabled: true,
  provider: 'supabase',
  url: 'https://ID-DO-PROJETO.supabase.co',
  publishableKey: 'sb_publishable_SUA_CHAVE_PUBLICA'
};
```

Nunca use `sb_secret_...`, `service_role`, senha do banco ou qualquer chave
administrativa no navegador.

## Perfis de acesso

- Proprietário: acesso completo e proteção para a organização nunca ficar sem dono.
- Administrador: acesso completo; gerencia usuários comuns.
- Editor: permissões configuráveis de visualização e edição por módulo.
- Leitor: permissões configuráveis de consulta; edição bloqueada no frontend e no RLS.

Convites são associados ao e-mail autenticado. Se a conta já existir, o vínculo
é aceito no próximo login. Se não existir, o usuário deve se cadastrar com o
mesmo e-mail.

## Ordem segura de publicação

1. Execute o SQL.
2. Publique todos os arquivos da versão v2.1 juntos.
3. Teste com o proprietário atual.
4. Convide um segundo usuário de teste e valide as permissões antes de liberar
   para clientes.
