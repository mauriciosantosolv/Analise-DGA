# CliqueObras v2.8 — RDO completo

A v2.8 usa a v2.7 como base e preserva integralmente as correções de segurança
da v2.6 e as regras de RDO/HH já validadas.

## Interface

- Criação de RDO organizada em quatro etapas: informações, equipe e horas,
  serviço e anexos, revisão.
- Horário geral aplicado automaticamente a todos os colaboradores selecionados,
  com possibilidade de ajuste individual.
- Tela de confirmação após o envio para aprovação.
- Formulário em tela inteira no smartphone, etapas horizontais, conteúdo sem
  rolagem lateral e ações acessíveis no rodapé.

## Fotos e documentos

- Captura pela câmera do celular e seleção de arquivos.
- Formatos aceitos: JPG, PNG, WebP e PDF.
- Limite de 8 MB por arquivo e 12 anexos por RDO.
- Bucket privado `rdo-evidencias`.
- Metadados na tabela `rdo_attachments`.
- RLS por organização, permissão de RDO e projeto autorizado.
- Inclusão e exclusão permitidas somente enquanto o RDO estiver em rascunho ou
  devolvido.

## PDF

- Botão **Gerar PDF** na confirmação de envio e nos detalhes do RDO.
- Documento com identificação do projeto, data, local, descrição, equipe,
  horários, ocorrências, fotos e relação de documentos anexados.
- Custos e valores de venda não são incluídos no PDF operacional.

## Banco

Execute `supabase/ATUALIZACAO-v2.8-RDO-FOTOS-PDF.sql` depois das migrações da
v2.7.

Versão entregue: **2.8.0**
