# CliqueObras v4.5.23: contraste na rosca, verdes nos indicadores, ícones do menu e PWA

Base: v4.5.22 (27/11/2026). **Sem SQL novo.**

## 1. Distribuição por categoria (rosca)
- Paleta com mais contraste, alternando tons claros e escuros: azul, laranja, navy, verde-água,
  vermelho, amarelo, azul-escuro, roxo, cinza-azulado e marrom. No tema escuro o navy vira cinza-claro.
- Fatias separadas por um pequeno espaço (antes encostavam).

## 2. Indicadores do Dashboard
- Em verde quando positivo: **Total medido**, **Saldo orçado** e **Lucro estimado**.
  Negativo continua em vermelho; zero fica na cor normal do texto.
- Os demais continuam neutros.

## 3. Ícones do menu (eram iguais)
- Planejamento de colaboradores: pessoa com ✓ (`user-check`).
- Clientes: prédio (`building-2`), também na busca global e no estado vazio da tela.
- Colaboradores: crachá (`contact`), também no estado vazio da tela.

## 4. PWA (app instalado no celular/computador)
- Ícones refeitos no azul da marca (`#2E67FF`), cor chapada, com o capacete branco: `icon-192/512`,
  `icon-maskable-192/512`, `apple-touch-icon`, `favicon-32/96` e `favicon.svg`.
  O logotipo usado dentro do sistema (`logo-clique.png`) não foi alterado.
- `manifest.webmanifest`: fundo e cor do tema `#fcfcfc` (antes cinza/preto), `id` e categorias.
- Barra de status do celular segue o tema escolhido no sistema (claro `#fcfcfc`, escuro `#000000`).
- Depois de publicar, pode ser preciso reinstalar o app (ou aguardar a atualização do sistema
  operacional) para o ícone novo aparecer na tela inicial.

## Testes
- `node --test tests/*.mjs`: 109 passam; as mesmas 4 falhas antigas de versão (sem falha nova).
