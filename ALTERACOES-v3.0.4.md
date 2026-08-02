# CliqueObras v3.0.4

Atualização construída diretamente sobre a v3.0.3.

## Configurações e documentos

- removido o card “Preferências do sistema” das Configurações;
- tema mantido exclusivamente no botão do canto superior direito;
- removida a seleção de moeda e fixada a formatação em BRL;
- incluído CNPJ da empresa com validação e exibição nos PDFs;
- papel timbrado aceita JPG e PNG;
- proporção do timbrado preservada no PDF, sem esticamento da imagem;
- ticker financeiro ocupa toda a largura e distribui os projetos em grade no desktop.

## RDO e Valores HH

- valores de venda HH podem ser ativados ou inativados;
- valores inativos deixam de ser usados em novos cálculos;
- cada configuração HH define se o PDF usa a função interna ou a função externa do cliente;
- função escolhida é preservada no RDO, no snapshot financeiro e na medição;
- corrigido o PDF do RDO, que antes exibia diretamente a função interna.

## Ícones

- a biblioteca visual do sistema foi substituída pelos Coolicons anexados;
- os SVGs do pacote são usados como máscaras escaláveis e acompanham as cores dos temas claro e escuro;
- Lucide deixou de ser carregado pela interface.

## Supabase

- nova migração idempotente `ATUALIZACAO-v3.0.4-CNPJ-PNG-HH-RDO.sql`;
- validação de CNPJ, papel timbrado PNG, status HH e modo de função;
- mantida a função de validação como `security invoker`, com `search_path` vazio e privilégios revogados.

