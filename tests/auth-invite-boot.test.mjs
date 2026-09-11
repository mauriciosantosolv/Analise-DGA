/**
 * v4.5.5 — o convite que deixava a conta sem senha, e o flash da tela interna.
 *
 * O que este teste prova, sobre o código REAL:
 *   1. `type=invite` no retorno do link do e-mail PARA na tela de criar senha e
 *      NÃO deixa o sistema abrir — era esse o furo: a pessoa entrava sem senha,
 *      saía e não voltava mais;
 *   2. `type=recovery` continua indo para 'reset' (não foi mexido);
 *   3. `type=signup` e `email_change` NÃO são sequestrados — vêm de quem já tem
 *      senha, e pedir uma nova ali trocaria a senha de quem não pediu;
 *   4. a tela de convite grava a senha (`updatePassword`) e entra direto;
 *   5. a trava de boot existe, nasce no HTML e é baixada em TODO caminho que
 *      termina em tela — inclusive no erro fatal.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const authSource = fs.readFileSync(new URL('../js/auth-ui.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/auth.css', import.meta.url), 'utf8');

/* ---------- monta o wrapper real de App.init num contexto isolado ---------- */
function montar(callback){
  const registro = {telas: [], initOriginalRodou: false, loadingOff: 0};
  const context = {
    console,
    App: {
      init: async () => { registro.initOriginalRodou = true; },
      bootShield: () => {}
    },
    UI: { loading: on => { if(on === false) registro.loadingOff++; } },
    Cloud: {
      configured: () => true,
      consumeAuthCallback: async () => callback,
      updatePassword: async () => { registro.senhaGravada = true; }
    },
    U: { icons(){} },
    document: { getElementById: () => null, createElement: () => ({}), body: {appendChild(){}} },
    setTimeout, location: {reload(){ registro.recarregou = true; }}
  };
  vm.createContext(context);
  vm.runInContext(`${authSource}\n;globalThis.AuthUI=AuthUI;`, context);
  // A tela em si precisa de DOM real; aqui interessa QUAL tela foi pedida.
  context.AuthUI.show = (mode) => { registro.telas.push(mode); };
  return {context, registro};
}

/* ================= 1. o convite para na tela de criar senha ================= */
{
  const {context, registro} = montar({type: 'invite', user: {id: 'u1', email: 'a@b.com'}});
  await context.App.init();
  assert.deepEqual(registro.telas, ['invite'],
    'o convite tem que parar na tela de criar senha');
  assert.equal(registro.initOriginalRodou, false,
    '⚠ o sistema NÃO pode abrir antes de a senha existir — era exatamente o bug');
  assert.ok(registro.loadingOff > 0, 'a tela de carregamento sai antes do formulário');
}

/* ================= 2. recuperação continua como estava ================= */
{
  const {context, registro} = montar({type: 'recovery', user: {id: 'u1'}});
  await context.App.init();
  assert.deepEqual(registro.telas, ['reset']);
  assert.equal(registro.initOriginalRodou, false);
}

/* ========= 3. quem JÁ tem senha não é sequestrado ========= */
for (const tipo of ['signup', 'email_change', 'magiclink', '']) {
  const {context, registro} = montar({type: tipo, user: {id: 'u1'}});
  await context.App.init();
  assert.deepEqual(registro.telas, [],
    `type=${tipo || '(vazio)'} não pode cair na tela de criar senha`);
  assert.equal(registro.initOriginalRodou, true,
    `type=${tipo || '(vazio)'} tem que seguir para o sistema, como antes`);
}

/* ================= 4. sem callback nenhum, nada muda ================= */
{
  const {context, registro} = montar(null);
  await context.App.init();
  assert.deepEqual(registro.telas, []);
  assert.equal(registro.initOriginalRodou, true, 'boot normal não pode ser afetado');
}

/* ================= 5. um convite sem usuário não abre a tela ================= */
{
  const {context, registro} = montar({type: 'invite', user: null});
  await context.App.init();
  assert.deepEqual(registro.telas, [], 'sem sessão válida não há senha para gravar');
}

/* ================= 6. a tela de convite, lida do fonte ================= */
assert.match(authSource, /const views=\{login,signup,recover,reset,invite\}/,
  'a tela de convite precisa estar registrada');
assert.match(authSource, /mode==='invite'[\s\S]{0,400}Cloud\.updatePassword\(password\)/,
  'a tela de convite tem que GRAVAR a senha');
assert.match(authSource, /mode==='invite'[\s\S]{0,600}location\.reload\(\)/,
  'depois de criar a senha, entra direto (escolha dele) — sem signOut');
assert.equal(/mode==='invite'[\s\S]{0,600}Cloud\.signOut/.test(authSource), false,
  'o convite NÃO desconecta: ela acabou de vir do e-mail');
assert.match(authSource, /cloud-password-confirm/, 'confirmação de senha continua exigida');
assert.match(authSource, /Esqueci minha senha<\/b>/,
  'a saída para quem já aceitou convite antes da correção tem que estar no login');
/* ⚠ `.cloud-auth-hint` é `display:flex`: sem o <span> em volta, o <b> do meio da
   frase vira ITEM do flex e o texto sai quebrado em três colunas. Foi o que
   renderizou na primeira tentativa. */
assert.match(authSource, /cloud-auth-hint"><i data-lucide="info"><\/i><span>/,
  'a frase do aviso tem que estar dentro de UM span, senão o flex quebra o <b>');
assert.match(css, /\.cloud-auth-hint>span\{/,
  'o filho direto do flex é o span, não o texto solto');

/* ================= 7. a trava de boot ================= */
assert.match(html, /<html lang="pt-BR" data-theme="light" class="boot-shield">/,
  'a trava tem que nascer no HTML — depois do primeiro paint já é tarde');
assert.match(html, /classList\.remove\('boot-shield','auth-gate'\)/,
  'a rede de segurança de 20s tem que estar no index.html');
assert.match(css, /html\.boot-shield #app,html\.auth-gate #app\{visibility:hidden\}/);
assert.match(css, /html\.boot-shield \.loading-overlay\{display:flex\}/,
  'a tela de carregamento tem que cobrir desde a PRIMEIRA pintura');
assert.equal(/html\.boot-shield #app[^}]*display:none/.test(css), false,
  'display:none zeraria a medição de elementos durante o boot');

assert.match(appSource, /bootShield\(state\)\{/, 'a porta única da trava');
assert.match(appSource, /fatal\(err\)\{[\s\S]{0,200}bootShield\(null\)/,
  '⚠ o erro fatal TEM que baixar a trava, senão a tela de recuperação fica invisível');
assert.match(appSource, /bootShield\(null\);\s*\n\s*const initialView=this\.initHistory\(\)/,
  'a trava só sai quando a primeira tela vai ser desenhada');
assert.match(appSource, /this\.bootShield\('auth-gate'\);[\s\S]{0,200}id='cloud-login'/,
  'o login de emergência do app.js também esconde o sistema');
assert.match(authSource, /App\.bootShield\('auth-gate'\)/,
  'toda tela de autenticação esconde o sistema atrás dela');
