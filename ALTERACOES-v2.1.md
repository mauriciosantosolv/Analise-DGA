# Alterações da versão 2.1

## Interface

- O título da aba agora é `cliqueobras`.
- Favicon vetorial incluído.
- Clique no perfil direciona para Configurações.
- Logout adicionado ao final da rolagem do menu lateral.

## Financeiro e planejamento

- Lotes importados possuem busca, projeto, origem, categoria e período.
- Novo lançamento manual permite escolher Compra, Conta paga ou Mão de obra.
- Lançamentos manuais podem abater um planejamento compatível.
- Após importar compras, contas pagas ou mão de obra, o resumo oferece
  conciliação em lote com o planejamento.
- O abatimento exige o mesmo projeto e categoria.
- Saldo parcial permanece no planejamento; saldo totalmente consumido sai dos
  gastos futuros.
- Ao excluir o lançamento ou lote, o saldo planejado é restaurado.

## Organizações e segurança

- Dados compartilhados por organização.
- Perfis: proprietário, administrador, editor e leitor.
- Visualização e edição configuráveis por módulo.
- Convites por e-mail, inclusive para contas ainda não cadastradas.
- RLS em todas as tabelas públicas.
- Funções privilegiadas ficam em schema privado e têm execução restrita.
- Migração retrocompatível com os registros existentes.
