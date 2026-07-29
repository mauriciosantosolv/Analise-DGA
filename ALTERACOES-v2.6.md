# CliqueObras v2.6 — segurança, sincronização e mobile

## Segurança

- RLS de membros e convites com hierarquia de privilégios;
- aceitação atômica de convites por RPC;
- perfil público somente leitura, exceto organização ativa;
- validação estrutural das permissões;
- codificação de argumentos em handlers e atributos;
- imagens restritas a PNG/JPEG/WebP e rasterizadas;
- backups e planilhas com limites e validação;
- exportações CSV/XLSX neutralizam células que poderiam executar fórmulas;
- CSP, HSTS, anti-frame, `nosniff` e política de permissões;
- arquivos SQL, Markdown, texto e arquivos ocultos bloqueados pelo servidor.

## Dados e sincronização

- gravação remota validada antes do cache local;
- apenas falhas transitórias entram na fila offline;
- conflito de versão preserva a fila e impede sobrescrita;
- logout sincroniza e limpa dados locais somente após sucesso;
- restauração gera backup preventivo.

## Mobile e usabilidade

- configurações alinhadas em uma grade consistente;
- resumo de conta/organização legível em tela estreita;
- tabela de equipe com orientação de rolagem e primeira coluna fixa;
- marca visível no login mobile e botão mostrar/ocultar senha;
- planejamento inicia em lista no celular;
- gráficos limitam itens e legendas no mobile;
- KPIs permanecem em duas colunas até 370 px;
- manifesto instalável e suporte a safe areas.

## Dependências

- SheetJS 0.20.3;
- Chart.js 4.5.1;
- Supabase JS 2.111.0.

Arquivos mortos das versões 2.2/2.3 e resíduos `desktop.ini` foram removidos.
