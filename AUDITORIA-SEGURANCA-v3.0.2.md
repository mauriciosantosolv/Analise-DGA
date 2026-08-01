# Auditoria de segurança — CliqueObras v3.0.2

Auditoria técnica concluída em 01/08/2026 sobre a aplicação web e o projeto
Supabase publicado. Esta revisão reduz riscos conhecidos, mas não representa
garantia de risco zero: dependências, configurações e padrões de ataque mudam e
devem ser reavaliados periodicamente.

## Resultado

Não foram identificadas chaves administrativas no navegador, buckets públicos,
tabelas de negócio sem RLS ou falhas críticas de autorização nas funções
administrativas avaliadas. As proteções adicionais desta versão foram aplicadas
e verificadas no Supabase de produção.

## Controles verificados

- As tabelas públicas da aplicação mantêm RLS habilitado e políticas limitadas à
  organização do usuário autenticado.
- O bucket `rdo-evidencias` permanece privado, com limite de 8 MiB e tipos
  permitidos JPEG, PNG, WebP e PDF.
- O frontend contém somente a chave pública do Supabase. A `service_role` não é
  exposta em HTML, JavaScript ou arquivos de configuração entregues ao navegador.
- As funções `send-organization-invite` e `delete-rdo` continuam com validação de
  JWT, identidade do usuário e permissão de proprietário/administrador.
- As funções passaram a recusar origens não autorizadas, corpos grandes,
  conteúdo fora de JSON e identificadores malformados.
- Foi adicionada limitação persistente de requisições por usuário, isolada no
  schema privado e executável somente pela `service_role` das Edge Functions.
- Convites têm limite global por usuário e limite adicional por destinatário.
  Exclusões de RDO também têm limite por usuário e devolvem `Retry-After` ao
  exceder a cota.
- Mensagens temporárias e títulos de modal agora inserem conteúdo dinâmico como
  texto, evitando interpretação como HTML e reduzindo a superfície de XSS.
- CSP e cabeçalhos do servidor bloqueiam frames, restringem recursos ao próprio
  domínio e desabilitam comportamentos legados desnecessários.
- As bibliotecas locais foram conferidas contra o arquivo de integridade SHA-256.

## Validação executada

- A RPC de limitação foi exercitada em transação com três solicitações e limite
  de duas; a terceira foi bloqueada, e a transação de teste foi revertida.
- Uma preflight de `https://cliqueobras.com` recebeu HTTP 204 e a origem exata.
- Uma preflight de origem externa não autorizada recebeu HTTP 403.
- Uma chamada sem autenticação às funções protegidas recebeu HTTP 401 antes de
  alcançar a lógica de negócio.
- A função de limite não pode ser executada por `anon` nem `authenticated`, e a
  tabela privada não pode ser consultada por esses papéis.
- Os testes automatizados estáticos, de RDO, histórico de cálculo e regressão de
  segurança passaram integralmente.

## Pendência de configuração

O Security Advisor do Supabase mantém um aviso: a proteção contra senhas vazadas
está desativada. Caso o plano contratado ofereça o recurso, ative **Leaked
password protection** em Authentication no painel do Supabase. A aplicação já
herda os limites nativos do Supabase Auth; limites e CAPTCHA devem ser revisados
no painel conforme o volume e o perfil de risco do ambiente.

Referências oficiais:

- https://supabase.com/docs/guides/auth/password-security
- https://supabase.com/docs/guides/auth/rate-limits
- https://supabase.com/docs/guides/functions/auth
