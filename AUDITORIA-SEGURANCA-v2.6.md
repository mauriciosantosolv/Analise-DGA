# Auditoria de segurança e software — CliqueObras v2.6

Data da revisão: 28/07/2026  
Escopo: pacote v2.5 enviado, frontend completo, dependências locais,
persistência IndexedDB, sincronização Supabase, políticas RLS e experiência
mobile.

## Parecer executivo

A v2.5 não deveria ser colocada em teste de mercado sem ajustes. Os riscos mais
relevantes eram:

1. possibilidade de elevação de privilégios em fluxos de membros/convites;
2. divergência entre cache local e nuvem quando uma gravação remota falhava;
3. sobrescrita silenciosa de dados após trabalho offline;
4. versão vulnerável do leitor de planilhas;
5. superfícies de injeção por backup, imagens e handlers HTML;
6. falta de limites para arquivos importados/restaurados.

A v2.6 corrige esses pontos no pacote. A liberação continua condicionada à
execução de `supabase/ATUALIZACAO-SEGURANCA-v2.6.sql`, que foi preparada, mas
**não foi aplicada automaticamente na base de produção durante esta auditoria**.

## Constatações e tratamento

| Severidade | Constatação | Tratamento na v2.6 |
|---|---|---|
| Crítica | Gestor poderia tentar inserir membro com perfil superior ao permitido. | Função `can_assign_member`, políticas RLS com hierarquia e restrição de administrador ao proprietário. |
| Crítica | `schema.sql` não incorporava integralmente a aceitação segura de convites da correção v2.3. | Schema consolidado e RPC atômico de aceitação incluído. |
| Alta | Alteração local ocorria antes da resposta da nuvem; 4xx/RLS deixava cache divergente. | Nuvem é validada primeiro; rejeição remota não altera o cache local. |
| Alta | Fila offline aceitava erros permanentes e poderia sobrescrever versão remota mais nova. | Somente falhas transitórias entram na fila; controle de versão detecta conflito e preserva as duas situações. |
| Alta | `xlsx` 0.18.5 possui vulnerabilidades conhecidas de ReDoS/prototype pollution. | Atualizado para SheetJS 0.20.3, com limites de tamanho, linhas, colunas e conteúdo. |
| Alta | SVG/data URL e valores restaurados podiam chegar a `innerHTML`/atributos. | SVG removido dos uploads; imagens são rasterizadas; origens são validadas; argumentos JavaScript e atributos são codificados. |
| Alta | Backup e planilha sem limites podiam esgotar memória ou introduzir objetos inesperados. | Validação de formato/versão, profundidade, chaves, IDs, volume e cópia automática pré-restauração. |
| Alta | Conteúdo iniciado por operadores de fórmula poderia ser executado ao abrir CSV/XLSX. | Exportações neutralizam essas células sem alterar os dados originais salvos. |
| Média | Logout podia abandonar alterações offline e manter cache sensível no aparelho. | Logout sincroniza antes, bloqueia a saída em conflito e limpa cache/snapshot ao concluir. |
| Média | Não havia cabeçalhos defensivos nem modo instalável coerente. | `.htaccess`, CSP, HSTS, anti-frame, política de permissões e manifesto mobile. |
| Média | Configurações e gráficos tinham hierarquia fraca no celular. | Grade consistente, conta/organização legíveis, tabela orientada para toque, gráficos compactos e planejamento em lista. |

## Estado observado no Supabase

A inspeção foi somente leitura e encontrou:

- projeto ativo e saudável;
- RLS habilitado em `app_records`, `profiles`, `organizations`,
  `organization_members` e `organization_invitations`;
- 893 registros financeiros no momento da consulta;
- 5 perfis/membros, 4 organizações e 4 convites históricos;
- nenhum membro órfão, nenhuma chave duplicada de registro/organização,
  nenhuma organização ativa inválida e nenhuma organização sem proprietário;
- publicação Realtime ativa para registros, membros e organizações;
- nenhuma chave `service_role`, Secret Key ou senha de banco no frontend; a
  Publishable Key presente no navegador é apropriada para esse uso quando o
  RLS está correto.

O Security Advisor indicou uma pendência operacional: proteção contra senhas
comprometidas desativada. Ela deve ser habilitada no painel de Authentication
antes do piloto.

Os índices sinalizados como ainda não utilizados foram mantidos. Em um piloto
com pouco tráfego, essa informação não justifica remoção e os índices dão
suporte a consultas de equipe, convites e organização ativa.

Referências técnicas:

- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase — Product Security](https://supabase.com/docs/guides/security/product-security)
- [Supabase — Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [SheetJS — instalação oficial 0.20.3](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)
- [Snyk — vulnerabilidades do xlsx 0.18.5](https://security.snyk.io/package/npm/xlsx/0.18.5)

## Verificações executadas

- extração segura do ZIP: 109 entradas, sem path traversal ou links simbólicos;
- sintaxe de todos os JavaScripts ativos;
- parsing dos oito arquivos CSS;
- confirmação em runtime do SheetJS 0.20.3;
- smoke test DOM do login mobile, controle de senha, configurações e equipe;
- teste de injeção com identificador malicioso em handler;
- teste de neutralização de fórmulas em exportações CSV/XLSX;
- teste de ordem de gravação: rejeição RLS não persistiu localmente;
- teste de conflito: versão remota mais nova bloqueou sobrescrita e preservou a fila;
- consultas de integridade, RLS, advisors, publicação Realtime e políticas no
  projeto Supabase conectado.

## Riscos residuais

1. A CSP ainda permite `unsafe-inline` porque a aplicação usa handlers e estilos
   inline. Os dados dinâmicos foram codificados, mas remover essa exceção exige
   refatorar os eventos para `addEventListener`.
2. A sessão web usa armazenamento do navegador. Um aparelho comprometido ou
   perfil de navegador compartilhado continua sendo risco; use bloqueio de tela,
   sessão individual e logout.
3. O abatimento de planejamento envolve mais de um registro genérico e não é
   uma transação SQL única. Há rollback no cliente, mas uma RPC transacional é
   recomendada em evolução futura.
4. O manifesto permite instalar como aplicativo, mas não há Service Worker de
   cache offline. Isso é intencional no piloto para evitar servir código/dados
   financeiros desatualizados.
5. Não foram realizados pentest externo, teste em aparelho físico, teste
   multiusuário destrutivo na produção nem validação de restauração do backup
   gerenciado do provedor.

## Condições obrigatórias antes do piloto

1. Exportar backup completo.
2. Executar `supabase/ATUALIZACAO-SEGURANCA-v2.6.sql`.
3. Habilitar proteção contra senhas comprometidas.
4. Publicar todo o pacote de uma vez, incluindo `.htaccess`.
5. Confirmar os cabeçalhos de segurança por HTTPS.
6. Testar proprietário, administrador, editor, leitor e gestor delegado com
   contas de teste.
7. Fazer uma restauração real de backup em ambiente separado.
8. Somente então iniciar o plano de 30 dias.

Este parecer reduz riscos técnicos identificáveis, mas não constitui garantia
de invulnerabilidade nem, isoladamente, aprovação para comercialização.
