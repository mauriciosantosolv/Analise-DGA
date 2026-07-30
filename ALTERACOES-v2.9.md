# CliqueObras v2.9

Base: versão 2.8 completa.

## Identidade visual

- Nova logo aplicada no login, menu lateral e fallback dos relatórios.
- Favicon substituído pelo SVG fornecido.
- Ícones de 192 px, 512 px e Apple Touch Icon gerados a partir da marca.
- Ícones `maskable` com margem segura incluídos no manifesto do aplicativo.

## RDO

- Exclusão disponível para diários em rascunho ou reprovados e ainda não medidos.
- Exclusão remove também as evidências anexadas.
- RDO aprovado permanece imutável e não pode ser excluído.
- Reprovação com comentário obrigatório, autor, data e histórico.
- Comentário de reprovação visível no detalhe e durante a correção.
- Etapa final mostra somente Voltar, Salvar rascunho e Enviar para aprovação.

## Colaboradores e HH

- Custo por hora incluído no cadastro do colaborador.
- Custo-base guardado no módulo financeiro, sem expor o valor a usuários sem permissão.
- HE 50% e HE 100% do custo são calculadas automaticamente.
- Tela Valores HH passa a configurar somente função comercial e valores de venda por obra.

## Medições

- Medição HH não faturada pode ser excluída por proprietário ou administrador.
- A exclusão é atômica no banco e libera os RDOs vinculados.
- Medição faturada permanece protegida contra exclusão.

## PDFs

- RDO configurado em A4 vertical.
- Cabeçalho do RDO exibe logo e nome do cliente, além da contratada.
- Dashboard do projeto exibe a logo do cliente.
- Justificativa do desvio e dados da última atualização aparecem no PDF.
