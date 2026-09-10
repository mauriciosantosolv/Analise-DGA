/**
 * v4.5.2 — PDF em Gantt paisagem e trava de zoom no aparelho de toque.
 *
 * O que este teste prova, sobre o código REAL:
 *   1. `CrewPlan.bucketState()` é a porta ÚNICA do retrato de uma coluna — a
 *      tela e o PDF consomem o mesmo, e nenhuma das duas reimplementa a regra;
 *   2. as colunas do PDF são dia a dia até um mês inteiro (na tela são 10) e
 *      caem para semana e depois mês em períodos longos;
 *   3. a célula impressa carrega a informação NO TEXTO (código da obra, "!",
 *      "//"), para o caso de sair em preto e branco;
 *   4. o relatório é PAISAGEM;
 *   5. o arquivo que corrige o zoom existe, está por ÚLTIMO no <head> e não
 *      cravou `maximum-scale` no viewport (o que mataria a pinça de zoom).
 *
 * Outubro de 2026: 01/10 = quinta, 03 e 04/10 = fim de semana, 30/10 = sexta.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const rdoSource = fs.readFileSync(new URL('../modules/rdo/rdo.js', import.meta.url), 'utf8');
const cut = (marker, label) => {
  const start = rdoSource.indexOf(marker);
  assert.notEqual(start, -1, `${label} não foi encontrada em modules/rdo/rdo.js`);
  const end = rdoSource.indexOf('\n  },', start);
  return rdoSource.slice(start, end + '\n  }'.length);
};
const rdoParts = [
  cut('  vacationPeriods(employee){', 'RDO.vacationPeriods'),
  cut('  vacationOn(employee,date){', 'RDO.vacationOn'),
  cut('  onVacation(employee,date){', 'RDO.onVacation'),
  cut('  crewActiveOn(employee,date){', 'RDO.crewActiveOn'),
  cut('  dayType(date,isHoliday=false){', 'RDO.dayType')
].join(',\n');

const crew = [
  { id: 'e1', name: 'Ari Nunes',  internalRole: 'Eletricista I',  active: true },
  { id: 'e2', name: 'Bruno Reis', internalRole: 'Eletricista II', active: true },
  { id: 'e3', name: 'Caio Melo',  internalRole: 'Eletricista I A', active: true },
  { id: 'e4', name: 'Davi Rocha', internalRole: 'Eletricista II A', active: true },
  // férias o mês inteiro
  { id: 'e5', name: 'Gil Souza',  internalRole: 'Encarregado', active: true,
    vacations: [{ id: 'v1', from: '2026-10-01', to: '2026-10-31' }] },
  { id: 'r1', name: 'Eletricista I', recordType: 'role', active: true }
];
const crewAllocations = [
  { id: 'a1', employeeId: 'e1', projectId: 'p1', start: '2026-10-01', end: '2026-10-30', status: 'Planejado' },
  // Bruno só na primeira metade -> a coluna semanal dele fica PARCIAL
  { id: 'a2', employeeId: 'e2', projectId: 'p2', start: '2026-10-05', end: '2026-10-07', status: 'Planejado' },
  // Caio em duas obras no mesmo dia -> conflito
  { id: 'a3', employeeId: 'e3', projectId: 'p1', start: '2026-10-05', end: '2026-10-14', status: 'Planejado' },
  { id: 'a4', employeeId: 'e3', projectId: 'p2', start: '2026-10-12', end: '2026-10-20', status: 'Planejado' }
];

const context = {
  Views: {}, document: undefined,
  State: { crew, crewAllocations, settings: {},
    projects: [
      { id: 'p1', proposal: '815', name: 'USF Vila Nova', status: 'Em andamento' },
      { id: 'p2', proposal: '816', name: 'Residencial Aurora', status: 'A executar' }
    ] },
  U: {
    norm: s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(),
    esc: s => String(s ?? ''), id: () => 'gerado',
    isoDate: d => d.toISOString().slice(0, 10),
    projLabel: p => `${p.proposal} | ${p.name}`,
    safeColor: v => v || '#2563EB', date: v => v, jsArg: v => JSON.stringify(String(v ?? ''))
  },
  console
};
context.RDO = vm.runInNewContext(`({\n${rdoParts}\n})`);
context.RDO.crewMembers = () => crew.filter(i => i.recordType !== 'role');
context.RDO.crewRoles = () => crew.filter(i => i.recordType === 'role');
context.RDO.projectLabel = id =>
  (v => v ? `${v.proposal} | ${v.name}` : 'Projeto')(context.State.projects.find(p => p.id === id));

const source = fs.readFileSync(new URL('../modules/planejamento/equipe.js', import.meta.url), 'utf8');
vm.createContext(context);
vm.runInContext(`${source}\n;globalThis.CrewPlan=CrewPlan;`, context);
const CrewPlan = context.CrewPlan;
const view = context.Views.planejamentoequipe;
const byId = id => crew.find(i => i.id === id);

/* ================= 1. bucketState é a porta única ================= */
const semana = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];

const cheio = CrewPlan.bucketState(byId('e1'), semana);
assert.equal(cheio.total, 5);
assert.equal(cheio.busyDays, 5);
assert.equal(cheio.partial, false, 'alocado nos 5 dias não é parcial');
assert.equal(cheio.conflict, false);

const parcial = CrewPlan.bucketState(byId('e2'), semana);
assert.equal(parcial.busyDays, 3);
assert.equal(parcial.partial, true, '3 de 5 dias é parcial');

const conflito = CrewPlan.bucketState(byId('e3'), ['2026-10-12', '2026-10-13', '2026-10-14']);
assert.equal(conflito.conflict, true, 'duas obras no mesmo dia');

const ferias = CrewPlan.bucketState(byId('e5'), semana);
assert.equal(ferias.offDays, 5);
assert.equal(ferias.offList.length, 5, 'offList entrega os dias para o offReason');
assert.equal(CrewPlan.offReason(byId('e5'), ferias.offList).short, 'Férias');

const livre = CrewPlan.bucketState(byId('e4'), semana);
assert.equal(livre.busyDays, 0);
assert.equal(livre.offDays, 0);

// nem a tela nem o PDF podem remontar a regra por conta própria
assert.match(source, /cellFor\(employee,bucket\)\{[\s\S]{0,400}CrewPlan\.bucketState\(employee,bucket\.days\)/,
  'cellFor tem que consumir bucketState');
assert.match(source, /printCell\(employee,bucket\)\{[\s\S]{0,200}CrewPlan\.bucketState\(employee,bucket\.days\)/,
  'printCell tem que consumir bucketState');

/* ================= 2. colunas do Gantt impresso ================= */
const comPeriodo = (from, to, fn) => {
  view.filters = { employee: '', project: '', role: '', status: '', from, to };
  try { return fn(); } finally {
    view.filters = { employee: '', project: '', role: '', status: '', from: '', to: '' };
  }
};

// um mês (22 dias úteis) cabe DIA A DIA no papel deitado; na tela, não
const mes = comPeriodo('2026-10-01', '2026-10-31', () => view.printBuckets());
assert.equal(mes.kind, 'day', '22 dias úteis saem dia a dia no PDF');
assert.equal(mes.list.length, 22);
assert.equal(mes.list[0].label, '01');
assert.equal(mes.list[0].sub, 'qui', '01/10/2026 é quinta');
// a tela continua com o limite dela (10 dias) — quem mudou foi só o papel
const naTela = comPeriodo('2026-10-01', '2026-10-31', () => view.buckets());
assert.equal(naTela.kind, 'week', 'na tela o mesmo período continua por semana');

// um trimestre cai para semana
const trimestre = comPeriodo('2026-10-01', '2026-12-31', () => view.printBuckets());
assert.equal(trimestre.kind, 'week');
assert.match(trimestre.list[0].label, /^SEM 1$/);

// um ano cai para mês
const ano = comPeriodo('2026-01-01', '2026-12-31', () => view.printBuckets());
assert.equal(ano.kind, 'month');
assert.equal(ano.list.length, 12);

/* ================= 3. a célula impressa fala em preto e branco ================= */
assert.equal(CrewPlan.projectShort('p1'), '815', 'o código curto é o número da proposta');

const bucketSemana = { key: 's', days: semana };
const celula = employee => view.printCell(byId(employee), bucketSemana);

assert.match(celula('e1'), /class="cpg-cell cpg-alloc"/);
assert.match(celula('e1'), />815</, 'alocado mostra o código da obra');
assert.match(celula('e2'), /class="cpg-cell cpg-partial"/);
assert.match(celula('e5'), /cpg-off/);
assert.match(celula('e5'), />\/\/</, 'sem vínculo/férias é "//" mesmo sem cor');
assert.match(celula('e4'), /class="cpg-cell"><\/td>/, 'livre fica vazio de propósito');
assert.match(view.printCell(byId('e3'), { key: 'c', days: ['2026-10-12', '2026-10-13'] }),
  /cpg-conflict[^>]*>!</, 'conflito é "!" mesmo sem cor');

/* ================= 4. o relatório é paisagem ================= */
const css = fs.readFileSync(new URL('../css/equipe.css', import.meta.url), 'utf8');
assert.match(css, /@page crewplan-report\{\s*size:A4 landscape/,
  'o PDF do planejamento tem que ser paisagem');
assert.equal(css.includes('size:A4 portrait;\n  margin:12mm;\n}\n\n@media print{\n  body.printing-crewplan'), false);
// a quebra que nunca funcionaria não pode voltar
assert.equal(css.includes('.crewplan-print-project:first-of-type{break-before:page'), false,
  ':first-of-type olha o TIPO do elemento, não a classe — essa regra nunca casaria');

/* ================= 5. a trava de zoom ================= */
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mobileCss = fs.readFileSync(new URL('../css/mobile-forms.css', import.meta.url), 'utf8');

assert.match(index, /<link rel="stylesheet" href="css\/mobile-forms\.css\?v=[\d.]+">/,
  'o arquivo tem que estar no <head>');
// e por ÚLTIMO: se vier antes de rdo/panel-tv/equipe, as regras com classe
// daqueles arquivos ganham por especificidade e o zoom volta
const links = [...index.matchAll(/href="css\/([a-z-]+)\.css/g)].map(m => m[1]);
assert.equal(links[links.length - 1], 'mobile-forms',
  'mobile-forms.css tem que ser o ÚLTIMO css do <head>');

assert.match(mobileCss, /font-size:16px!important/, '16px é o limiar exato do iOS');
assert.match(mobileCss, /pointer:coarse/, 'a correção é só para aparelho de toque');

// nunca cravar maximum-scale no <head>: mata a pinça de zoom do sistema inteiro
const viewport = index.match(/<meta name="viewport" content="([^"]+)"/)[1];
assert.equal(/maximum-scale|user-scalable/.test(viewport), false,
  'o viewport do <head> não pode travar o zoom — a trava é só enquanto o campo está focado');

const helpers = fs.readFileSync(new URL('../utils/helpers.js', import.meta.url), 'utf8');
assert.match(helpers, /focusin/, 'a trava de viewport tem que estar registrada');
assert.match(helpers, /maximum-scale=1/);

console.log('crew-print-gantt: OK');
