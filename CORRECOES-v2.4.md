# CliqueObras v2.4

## Correções deste pacote

- Impede que o navegador misture o HTML atual com arquivos JavaScript e CSS antigos.
- Mantém compatibilidade com versões antigas que ainda procuravam o elemento `company-name`.
- Centraliza a pesquisa no cabeçalho em computadores.
- Coloca a pesquisa em uma linha própria e com largura total em celulares.
- Permite que cada usuário autenticado edite o próprio nome em **Configurações**.
- Atualiza o nome no Supabase Auth e, pelo gatilho já instalado no banco, no perfil compartilhado da organização.
- Limpa a sessão local imediatamente ao sair e limita a espera pelo encerramento remoto.

## Publicação

Substitua os arquivos da raiz do repositório pelos arquivos deste pacote, preservando a mesma estrutura de pastas. Depois que a publicação terminar, o rodapé do menu deve mostrar `v2.4`.

Não é necessário executar um novo SQL no Supabase para estas correções.
