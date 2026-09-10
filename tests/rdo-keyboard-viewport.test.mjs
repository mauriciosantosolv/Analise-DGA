/**
 * v4.5.3 — o teclado empurrava a tela no compositor do RDO e não devolvia.
 *
 * ⚠ A causa NÃO era tamanho de fonte (o `#rdo-description` já está em 16px).
 * Era o `#modal-overlay` `position:fixed` num documento que não rola: para
 * trazer o campo à área visível o navegador desloca o visual viewport, e ao
 * fechar o teclado não desfaz.
 *
 * O que este teste prova, sobre o código REAL:
 *   1. com o teclado FECHADO nada é escrito no elemento — o desenho de hoje
 *      não muda em nada;
 *   2. com o teclado ABERTO a camada passa a ocupar só a área visível;
 *   3. ao FECHAR o teclado os estilos são removidos (é isto que faz a tela
 *      voltar sozinha);
 *   4. com o modal fechado a camada nunca é tocada;
 *   5. o CSS parou de medir o modal em `dvh`, que é o que não encolhe com o
 *      teclado no iOS.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const helpers = fs.readFileSync(new URL('../utils/helpers.js', import.meta.url), 'utf8');
const marca = '   v4.5.3 — O TECLADO EMPURRAVA A TELA E NÃO DEVOLVIA';
const inicio = helpers.indexOf(marca);
assert.notEqual(inicio, -1, 'o bloco da v4.5.3 não foi encontrado em utils/helpers.js');
const bloco = helpers.slice(helpers.lastIndexOf('/* ===', inicio));

/* ---------- DOM mínimo ---------- */
const ouvintes = { vv: {}, doc: {} };
const overlay = {
  id: 'modal-overlay',
  style: { top: '', height: '' },
  classList: {
    valores: new Set(['open']),
    contains(nome) { return this.valores.has(nome); },
    add(nome) { this.valores.add(nome); },
    remove(nome) { this.valores.delete(nome); }
  }
};
const visualViewport = {
  height: 844, offsetTop: 0,
  addEventListener(nome, fn) { (ouvintes.vv[nome] = ouvintes.vv[nome] || []).push(fn); }
};
const contexto = {
  window: { innerHeight: 844, visualViewport },
  document: {
    getElementById: id => (id === 'modal-overlay' ? overlay : null),
    addEventListener(nome, fn) { (ouvintes.doc[nome] = ouvintes.doc[nome] || []).push(fn); }
  },
  setTimeout, clearTimeout, console
};
contexto.window.innerHeight = 844;
vm.createContext(contexto);
vm.runInContext(bloco, contexto);

const disparar = nome => (ouvintes.vv[nome] || []).forEach(fn => fn());
const abrirTeclado = altura => { visualViewport.height = altura; disparar('resize'); };

/* ================= 1. teclado fechado: não escreve nada ================= */
assert.equal(ouvintes.vv.resize && ouvintes.vv.resize.length > 0,
  true, 'o bloco tem que ouvir o resize do visualViewport');
disparar('resize');
assert.equal(overlay.style.top, '', 'sem teclado, a camada não pode ser tocada');
assert.equal(overlay.style.height, '');

// variação pequena (barra do navegador aparecendo) também não conta como teclado
abrirTeclado(844 - 60);
assert.equal(overlay.style.height, '', '60px de diferença não é teclado — é barra do navegador');

/* ================= 2. teclado aberto: a camada encolhe ================= */
abrirTeclado(844 - 336);   // teclado do iPhone ≈ 336px
assert.equal(overlay.style.height, '508px', 'a camada passa a ocupar só a área visível');
assert.equal(overlay.style.top, '0px');

// e acompanha o deslocamento quando o iOS empurra a área visível
visualViewport.offsetTop = 74;
disparar('scroll');
assert.equal(overlay.style.top, '74px', 'a camada acompanha o deslocamento do visual viewport');

/* ================= 3. teclado fechado: devolve ================= */
visualViewport.offsetTop = 0;
abrirTeclado(844);
assert.equal(overlay.style.top, '', 'ao fechar o teclado os estilos saem — é isto que faz a tela voltar');
assert.equal(overlay.style.height, '');

/* ================= 4. modal fechado: nunca toca na camada ================= */
overlay.classList.remove('open');
abrirTeclado(844 - 336);
assert.equal(overlay.style.height, '', 'sem modal aberto, a camada não é tocada');
overlay.classList.add('open');

/* ================= 5. o CSS parou de medir em dvh ================= */
const rdoCss = fs.readFileSync(new URL('../css/rdo.css', import.meta.url), 'utf8');
const componentsCss = fs.readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');

assert.equal(rdoCss.includes('.modal.rdo-composer-modal{width:100%;height:100dvh;max-height:100dvh'), false,
  'o compositor do RDO não pode mais ser medido em dvh — dvh não encolhe com o teclado no iOS');
assert.match(rdoCss, /\.modal\.rdo-composer-modal\{width:100%;height:100%;max-height:100%/,
  'o compositor passa a seguir a altura da camada');
assert.equal(componentsCss.includes('max-height:94vh;max-height:94dvh'), false);
assert.match(componentsCss, /\.modal\{width:100%;max-width:none;max-height:94vh;max-height:94%/,
  'o modal genérico também segue a camada (94% = 94dvh quando não há teclado)');

/* ================= 6. o Android resolve pelo <meta viewport> ================= */
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const viewport = index.match(/<meta name="viewport" content="([^"]+)"/)[1];
assert.match(viewport, /interactive-widget=resizes-content/,
  'no Android o teclado tem que redimensionar o conteúdo, não empurrar a área visível');
// e continua sem travar a pinça de zoom (regra da v4.5.2)
assert.equal(/maximum-scale|user-scalable/.test(viewport), false);

console.log('rdo-keyboard-viewport: OK');
