// v4.5.6 - atualizacao da nuvem nao pisca e nao apaga o que esta sendo digitado
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const appSrc = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');

function el(tag, attrs = {}) {
  const node = { nodeType: 1, tagName: tag, isConnected: true, isContentEditable: false, children: [], dataset: {}, hidden: false,
    classList: { set: new Set(), toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); }, contains(c) { return this.set.has(c); }, add(c){this.set.add(c);} },
    listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; }, contains(x) { return x === this || this.children.includes(x); },
    setAttribute() {}, querySelector() { return { onclick: null }; }, ...attrs };
  return node;
}

function load() {
  const content = el('DIV');
  const body = el('BODY', { appendChild(n) { this.children.push(n); byId[n.id] = n; } });
  const byId = { content };
  const document = { hidden: false, activeElement: body, body, getElementById: id => byId[id] || null, createElement: t => el(t.toUpperCase()), addEventListener() {} };
  let modal = false;
  const ctx = vm.createContext({ document, window: { addEventListener() {} }, setTimeout: (f) => 0, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    UI: { isModalOpen: () => modal }, U: { icons() {} }, Chart: { defaults: { animation: { duration: 1000 } } }, console });
  vm.runInContext(`${appSrc}\n;globalThis.App=App;`, ctx);
  const App = ctx.App;
  App.renders = [];
  App.render = function (options = {}) { this.settleCloudRender(options.quiet === true); this.renders.push(options.quiet === true); };
  return { App, content, document, ctx, setModal: v => { modal = v; } };
}

test('sem edicao: redesenha na hora, sem animacao', () => {
  const { App, content } = load();
  App.watchContentEdits();
  App.applyCloudRender();
  assert.equal(App.renders.join(','), 'true');
  assert.equal(content.classList.contains('co-quiet-render'), true);
});

test('campo alterado na tela: segura o redesenho e mostra o aviso', () => {
  const { App, content, document } = load();
  App.watchContentEdits();
  const input = el('INPUT', { type: 'number' }); content.children.push(input);
  content.listeners.input({ target: input, isTrusted: true });
  App.applyCloudRender();
  assert.equal(App.renders.length, 0);
  assert.equal(App.pendingCloudRender, true);
  assert.equal(document.getElementById('cloud-update-notice').hidden, false);
  // salvou: o campo saiu da tela -> ja nao conta
  input.isConnected = false;
  assert.equal(App.userIsEditing(), false);
});

test('campo focado ou janela aberta tambem seguram', () => {
  const { App, content, document, setModal } = load();
  const input = el('TEXTAREA'); content.children.push(input);
  document.activeElement = input;
  App.applyCloudRender();
  assert.equal(App.renders.length, 0);
  document.activeElement = document.body;
  setModal(true);
  assert.equal(App.userIsEditing(), false);
  App.applyCloudRender();
  assert.equal(App.renders.length, 0);
});

test('botao/checkbox focado nao segura', () => {
  const { App, content, document } = load();
  const b = el('INPUT', { type: 'checkbox' }); content.children.push(b);
  document.activeElement = b;
  assert.equal(App.userIsEditing(), false);
});

test('redesenho normal limpa a espera, o aviso e devolve a animacao', () => {
  const { App, content, document } = load();
  App.pendingCloudRender = true; App.showCloudUpdateNotice(true);
  App.render({ quiet: true });
  App.render({});
  assert.equal(App.pendingCloudRender, false);
  assert.equal(document.getElementById('cloud-update-notice').hidden, true);
  assert.equal(content.classList.contains('co-quiet-render'), false);
});

test('realtime e volta de aba passam pela porta nova; syncCloudNow intacto', () => {
  assert.equal((appSrc.match(/backgroundCloudSync\(/g) || []).length, 3);
  assert.ok(appSrc.includes("if(options.render!==false) this.render();"));
  assert.ok(appSrc.includes("this.settleCloudRender(options.quiet===true)"));
  assert.ok(/#content\.co-quiet-render \.card,#content\.co-quiet-render \.kpi\{animation:none!important\}/.test(css));
});
