// v4.5.16 - dados novos da nuvem nao redesenham a tela e nao mostram aviso
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const appSrc = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');
const panelSrc = fs.readFileSync(new URL('../modules/dashboard/panel-tv.js', import.meta.url), 'utf8');

function load() {
  const appended = [];
  const document = { hidden: false, body: { appendChild(n) { appended.push(n); } }, getElementById: () => null,
    createElement: () => ({}), addEventListener() {} };
  const timers = [];
  const ctx = vm.createContext({ document, window: { addEventListener() {} },
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    UI: { isModalOpen: () => false }, U: { icons() {} }, console });
  vm.runInContext(`${appSrc}\n;globalThis.App=App;`, ctx);
  const App = ctx.App;
  App.renders = 0; App.syncs = [];
  App.render = function () { this.renders++; };
  App.syncCloudNow = async function (toast, options = {}) { this.syncs.push(options); this.lastCloudRefresh++; };
  return { App, timers, appended };
}

test('mudanca vinda da nuvem: le os dados, nao redesenha, nao mostra aviso', async () => {
  const { App, timers, appended } = load();
  App.scheduleRealtimeSync({ payload: { new: { store: 'rdos' } } });
  await timers.shift()();
  assert.equal(App.syncs.length, 1);
  assert.equal(App.syncs[0].render, false);
  assert.equal(App.renders, 0);
  assert.equal(appended.length, 0);
});

test('o aviso "Ha dados novos da nuvem" nao existe mais', () => {
  assert.ok(!appSrc.includes('Há dados novos da nuvem'));
  assert.ok(!appSrc.includes('cloud-update-notice'));
  assert.ok(!css.includes('cloud-update-notice'));
  assert.ok(!/applyCloudRender|showCloudUpdateNotice/.test(appSrc));
});

test('volta da aba e volta da conexao tambem nao redesenham', () => {
  assert.equal((appSrc.match(/backgroundCloudSync\(\)/g) || []).length, 3);
  assert.ok(appSrc.includes("this.syncCloudNow(false,{render:false})\n        .then(()=>Cloud.startRealtime"));
  assert.ok(appSrc.includes("async backgroundCloudSync(){\n    await this.syncCloudNow(false,{render:false});"));
});

test('o botao Sincronizar e o modo Painel/TV continuam redesenhando', () => {
  assert.ok(appSrc.includes("if(options.render!==false) this.render();"));
  assert.ok(panelSrc.includes('App.syncCloudNow(false);'));
});
