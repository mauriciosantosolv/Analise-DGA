# CliqueObras v3.0

Versão de reparos construída sobre o pacote v2.9, preservando a segurança da
v2.6/v2.7 e as funcionalidades de RDO/HH das versões v2.7–v2.9.

## Correções

- O renderizador deixa de zerar a rolagem em atualizações da mesma tela.
- Eventos em tempo real originados pela própria gravação local não provocam uma
  segunda sincronização completa.
- Importações identificam cabeçalhos nas primeiras 20 linhas e passam a salvar
  fornecedor, pedido/nota, categoria, descrição e observações também em mão de
  obra; contas pagas preservam fornecedor e documento quando informados.
- Configurações da empresa, logo e equipe foram unificadas e limitadas a
  proprietário/administrador no frontend e no banco.
- Convites novos são enviados por `send-organization-invite`; o gatilho de
  cadastro não tenta mais aceitar o convite sem `auth.uid()`.
- `clique_obras_delete_rdo_measurement` foi recriada com recarga explícita do
  schema REST.
- `clique_obras_delete_rdo` remove RDO aprovado fora de medição com estorno do
  lançamento de custo, snapshot financeiro e anexos.
- Exclusões de orçamento e cliente são bloqueadas quando existem vínculos
  financeiros.
- A base de cálculo agora possui histórico mensal e snapshot ponderado pelo
  período da obra quando ela é concluída.

## Banco de dados

Execute `supabase/ATUALIZACAO-v3.0-REPAROS.sql` antes de publicar o frontend e
implante `supabase/functions/send-organization-invite/index.ts`.
