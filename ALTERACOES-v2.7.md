# CliqueObras v2.7 — integração segura de RDO e HH

## Base preservada

A versão foi construída sobre a v2.6 auditada. Permanecem preservados:

- cabeçalhos CSP, HSTS, anti-frame, `nosniff` e política de permissões;
- SheetJS 0.20.3 e Chart.js 4.5.1 com arquivos de licença e integridade;
- validação de planilhas, backups, imagens, HTML e argumentos inline;
- proteção da sessão, sincronização, conflitos offline e troca de conta;
- hierarquia de usuários, convites e permissões protegidas por RLS;
- layout mobile corrigido para login, configurações, tabelas e gráficos.

## RDO e contratos HH

- todos os projetos podem receber RDO;
- somente projetos HH geram medição de venda pelos RDOs aprovados;
- obra, fornecimento e painel continuam com medição manual;
- horários gerais preenchem automaticamente os colaboradores selecionados;
- o administrador escolhe os projetos disponíveis para cada usuário no RDO;
- RDO aprovado fica bloqueado para edição;
- RDO já medido não pode ser reutilizado;
- custo da mão de obra entra no realizado após aprovação;
- valor de venda permanece apenas na apuração e medição HH;
- acessos de menu, consulta e edição seguem as permissões administrativas.
- gestores delegados não podem conceder módulos, edições ou projetos de RDO
  além do próprio escopo de acesso.

## Banco de dados

- `ATUALIZACAO-SEGURANCA-v2.7.sql` torna o hardening da v2.6 compatível com os
  novos módulos e com `rdo_projects`;
- `ATUALIZACAO-v2.7-RDO-HH.sql` instala as tabelas, políticas, índices,
  validações e bloqueios do fluxo RDO/HH;
- vínculos de medição incompletos podem ser liberados somente pelo usuário que
  os criou e apenas quando a medição correspondente não existe;
- as duas migrações são idempotentes e não removem registros existentes.

## Versão

Versão entregue: **2.7.0**  
Data: **29/07/2026**
