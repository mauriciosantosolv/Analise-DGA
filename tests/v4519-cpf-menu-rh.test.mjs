// v4.5.19 - CPF do colaborador, cartao clicavel, menu lateral recolhivel e
// alertas de RH no painel lateral direito.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const hrSource = read('modules/rdo/colaboradores-rh.js');
const rdoSource = read('modules/rdo/rdo.js');
const appSource = read('js/app.js');
const css = read('css/components.css');
const index = read('index.html');

const HR = (() => {
  const context = { U: { isoDate: () => '2026-11-27', esc: v => String(v ?? '') }, State: {} };
  vm.runInNewContext(`${hrSource}\nthis.CrewHR=CrewHR;`, context);
  return context.CrewHR;
})();

test('CPF: mascara e digitos verificadores', () => {
  assert.equal(HR.formatCpf('52998224725'), '529.982.247-25');
  assert.equal(HR.formatCpf('5299'), '529.9');
  assert.equal(HR.validCpf('529.982.247-25'), true);
  assert.equal(HR.validCpf('529.982.247-24'), false);
  assert.equal(HR.validCpf('111.111.111-11'), false);
  assert.equal(HR.validCpf('123'), false);
});

test('CPF no cadastro: opcional, valido e unico', () => {
  const form = rdoSource.slice(rdoSource.indexOf("  form(id='',tab='contrato'){"), rdoSource.indexOf('  rolesForm(){'));
  assert.ok(form.includes('id="crew-cpf"'));
  assert.ok(form.includes("CPF inválido. Confira os números."));
  assert.ok(form.includes("Este CPF já pertence a outro colaborador."));
  assert.ok(/registration,\s*cpf,\s*photo,/.test(form), 'CPF gravado no colaborador');
});

test('cartao inteiro abre o cadastro, lapis nao abre duas vezes', () => {
  assert.ok(rdoSource.includes('data-crew-open="${U.esc(employee.id)}"'));
  assert.ok(rdoSource.includes("card.onclick=()=>this.form(card.dataset.crewOpen);"));
  assert.ok(rdoSource.includes('onclick="event.stopPropagation();Views.colaboradores.form('));
});

test('menu recolhivel: so no computador, faixa de icones, sem animar o grid', () => {
  const block = css.slice(css.indexOf('/* ===== Menus laterais recolhíveis'), css.indexOf('/* ===== Estabilidade de layout'));
  assert.match(block, /@media\(min-width:861px\)\{/);
  assert.match(block, /#app\.nav-collapsed\{grid-template-columns:64px minmax\(0,1fr\)\}/);
  assert.ok(!/#app[^{]*\{[^}]*transition/.test(block) && !/#content-wrap[^{]*\{[^}]*transition/.test(block), 'a coluna do grid nao pode ser animada');
  assert.ok(css.includes('.chart-box canvas{position:absolute;inset:0'), 'regra anti-loop dos graficos mantida');
  assert.ok(appSource.includes('if(window.innerWidth > 860) this.toggleDesktopNav();'));
  assert.ok(appSource.includes('if(this.navToggleLock) return;'));
  assert.ok(appSource.includes("localStorage.setItem(this.navCollapsedKey"));
});

test('painel lateral: alertas de RH acima dos gastos futuros', () => {
  assert.ok(index.indexOf('id="rightbar-hr"') < index.indexOf('Gastos Futuros'));
  assert.ok(appSource.includes('hrBox.innerHTML=this.hrAlertsMarkup(5)'));
  assert.ok(appSource.includes("Cloud.canViewStore('crew')"));
  assert.ok(appSource.includes('${this.hrAlertsMarkup(5)}${sections.map'), 'tambem no botao de gastos previstos (tela menor)');
});
