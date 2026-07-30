# CliqueObras v2.9 — Supabase

O sistema usa Supabase Auth e uma base compartilhada por organização. Projetos,
orçamentos, financeiro, planejamento, RDOs, colaboradores, valores HH,
medições, clientes, categorias e configurações continuam no `app_records`,
protegidos por RLS de organização, módulo e projeto autorizado.

## Ativação

1. Exporte um backup antes de qualquer alteração.
2. Abra o SQL Editor do projeto Supabase.
3. Em instalação nova, execute `supabase/schema.sql` completo e depois, nesta
   ordem:
   - `supabase/ATUALIZACAO-SEGURANCA-v2.7.sql`;
   - `supabase/ATUALIZACAO-v2.7-RDO-HH.sql`;
   - `supabase/ATUALIZACAO-v2.8-RDO-FOTOS-PDF.sql`;
   - `supabase/ATUALIZACAO-v2.9-RDO-REVISAO-MEDICAO.sql`.
4. Em uma instalação já existente, execute nesta ordem:
   - `supabase/ATUALIZACAO-SEGURANCA-v2.7.sql`;
   - `supabase/ATUALIZACAO-v2.7-RDO-HH.sql`;
   - `supabase/ATUALIZACAO-v2.8-RDO-FOTOS-PDF.sql`;
   - `supabase/ATUALIZACAO-v2.9-RDO-REVISAO-MEDICAO.sql`.
5. Confira se as tabelas abaixo estão com RLS ativo:
   - `app_records`
   - `profiles`
   - `organizations`
   - `organization_members`
   - `organization_invitations`
   - `rdo_measurement_links`
   - `rdo_cost_postings`
   - `rdo_attachments`
6. Em `Authentication > URL Configuration`, use:
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

O administrador também seleciona quais projetos aparecem no preenchimento de
RDO de cada usuário. Valores de custo e venda possuem permissões próprias.

Somente o proprietário pode criar administradores ou delegar a gestão de
usuários. Administradores e gestores delegados gerenciam leitores e editores,
sem poder elevar privilégios. Um gestor delegado só pode conceder módulos,
edições e projetos de RDO que já façam parte do próprio acesso; leitores
delegados também não podem criar editores.

Convites são associados ao e-mail autenticado. Se a conta já existir, o vínculo
é aceito no próximo login. Se não existir, o usuário deve se cadastrar com o
mesmo e-mail.

## Ordem segura de publicação

1. Exporte um backup e execute as migrações na ordem indicada.
2. Publique todos os arquivos da versão v2.9 juntos.
3. Teste com o proprietário atual.
4. Convide um segundo usuário de teste e valide as permissões antes de liberar
   para clientes.

Depois da publicação, confirme que `.htaccess` está ativo e que as respostas
incluem CSP, `X-Content-Type-Options`, `X-Frame-Options`, HSTS e
`Permissions-Policy`. Não publique por HTTP.
