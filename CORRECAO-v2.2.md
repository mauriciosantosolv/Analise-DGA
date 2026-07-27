# cliqueobras v2.2 — correção de publicação

## Causa identificada

A hospedagem atualizou o `index.html`, mas continuou entregando versões antigas
dos arquivos JavaScript em cache. Por isso o título e o favicon apareciam,
enquanto perfil, logout, filtros, abatimento e organizações continuavam no
comportamento anterior.

## Correção aplicada

- Os arquivos alterados agora possuem nomes exclusivos com a versão `v2.2.0`.
  Isso impede que navegador ou hospedagem reutilizem o JavaScript antigo.
- O botão **Perfil** faz parte do HTML e abre diretamente **Configurações**.
- O logout limpa a sessão local antes da chamada ao Supabase e funciona mesmo
  se a conexão estiver lenta ou indisponível.
- A abertura de uma importação possui filtros por pesquisa, projeto, origem,
  categoria, período e faixa de valor.
- Um novo lançamento oferece e pré-seleciona o abatimento quando encontra
  planejamento do mesmo projeto e categoria.
- Configurações apresenta organização, membros, convites pendentes e permissões
  de visualização/edição para oito módulos.

## Publicação

Substitua o projeto completo, mantendo as pastas e incluindo todos os novos
arquivos que possuem `.v2.2.0` no nome. Não publique somente o `index.html`.

Depois da publicação, o rodapé deve mostrar `v2.2`.
