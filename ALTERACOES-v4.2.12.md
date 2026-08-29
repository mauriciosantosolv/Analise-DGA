# CliqueObras v4.2.12 — refinamento da página de login

## Direção visual

A tela passou de um cartão centralizado para uma composição editorial em tela
dividida. A fotografia e a marca ocupam uma metade contínua; o formulário fica
em uma superfície clara, sem moldura externa. O resultado é mais sóbrio,
corporativo e próximo de um produto desenhado sob medida.

## Principais mudanças

- Remoção do cartão externo, da borda e da sombra de grande escala.
- Logo ampliada, branca e sem fundo ou caixa.
- Título e texto sobre a foto com contraste reforçado.
- Campos com linha inferior em vez de retângulos arredondados.
- Apenas o botão principal permanece como bloco preenchido.
- Links secundários tratados como texto.
- Itens de confiança separados por uma única linha, sem pílulas.
- Layout móvel com faixa fotográfica superior e formulário fluido.
- Estados de foco visíveis e respeito a `prefers-reduced-motion`.

## Compatibilidade

A lógica existente de autenticação foi mantida: login, criação de conta,
recuperação de senha, redefinição, mensagens de erro e exibição de senha.
