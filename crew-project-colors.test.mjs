/**
 * v4.5.4 — uma cor por obra no Gantt, e o planejamento inteiro em uma folha.
 *
 * O que este teste prova, sobre o código REAL:
 *   1. `CrewPlan.projectPalette()` dá slots DISTINTOS às obras do período, é
 *      estável (mesma obra -> mesmo slot, hoje e depois) e não depende da
 *      ordem em que os IDs chegaram nem da posição da obra no cadastro;
 *   2. `paletteClass` devolve '' sem paleta — é o que torna o 3º parâmetro
 *      de `cellFor`/`printCell` OPCIONAL. Os DOIS caminhos são exercitados;
 *   3. a célula colorida carrega a classe da obra, e conflito/férias NÃO —
 *      eles continuam sendo estado e vencem a cor da obra;
 *   4. `printMetrics()` encolhe a linha conforme o número de colaboradores,
 *      PÁRA no piso legível e avisa (`fits:false`) em vez de ficar ilegível;
 *   5. o PDF não monta mais o detalhe por obra nem o resumo por colaborador;
 *   6. a paleta do CSS não tem vermelho nem cinza (são de conflito e férias)
 *      e tela e papel leem os MESMOS tokens.
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
  { id: 'e1', name: 'Ari Nunes',  internalRole: 'Eletricista I',   active: true },
  { id: 'e2', name: 'Bruno Reis', internalRole: 'Eletricista II',  active: true },
  { id: 'e3', name: 'Caio Melo',  internalRole: 'Eletricista I A', active: true },
  { id: 'e4', name: 'Davi Rocha', internalRole: 'Eletricista II A', active: true },
  { id: 'e5', name: 'Gil Souza',  internalRole: 'Encarregado', active: true,
    vacations: [{ id: 'v1', from: '2026-10-01', to: '2026-10-31' }] }
];
const crewAllocations = [
  { id: 'a1', employeeId: 'e1', projectId: 'p1', start: '2026-10-01', end: '2026-10-30', status: 'Planejado' },
  { id: 'a2', employeeId: 'e2', projectId: 'p2', start: '2026-10-05', end: '2026-10-07', status: 'Planejado' },
  // Caio em duas obras no MESMO dia -> conflito
  { id: 'a3', employeeId: 'e3', projectId: 'p1', start: '2026-10-05', end: '2026-10-14', status: 'Planejado' },
  { id: 'a4', employeeId: 'e3', projectId: 'p2', start: '2026-10-12', end: '2026-10-20', status: 'Planejado' },
  // Davi em duas obras na MESMA semana, sem se sobrepor -> não é conflito
  { id: 'a5', employeeId: 'e4', projectId: 'p3', start: '2026-10-05', end: '2026-10-06', status: 'Planejado' },
  { id: 'a6', employeeId: 'e4', projectId: 'p4', start: '2026-10-08', end: '2026-10-09', status: 'Planejado' }
];
const projects = [
  { id: 'p1', proposal: '815', name: 'USF Vila Nova',      status: 'Em andamento' },
  { id: 'p2', proposal: '816', name: 'Residencial Aurora', status: 'A executar' },
  { id: 'p3', proposal: '693', name: 'Fornecimento HH',    status: 'Em andamento' },
  { id: 'p4', proposal: '903', name: 'Adequação NR-10',    status: 'Em andamento' }
];

const context = {
  Views: {}, document: undefined,
  State: { crew, crewAllocations, settings: {}, projects },
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
context.RDO.crewRoles = () => [];
context.RDO.projectLabel = id =>
  (v => v ? `${v.proposal} | ${v.name}` : 'Projeto')(projects.find(p => p.id === id));

const source = fs.readFileSync(new URL('../modules/planejamento/equipe.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/equipe.css', import.meta.url), 'utf8');
vm.createContext(context);
vm.runInContext(`${source}\n;globalThis.CrewPlan=CrewPlan;`, context);
const CrewPlan = context.CrewPlan;
const view = context.Views.planejamentoequipe;
const byId = id => crew.find(i => i.id === id);

/* ================= 1. a paleta ================= */
const todas = ['p1', 'p2', 'p3', 'p4'];
const paleta = CrewPlan.projectPalette(todas);

assert.equal(paleta.size, 4, 'as quatro obras entram na paleta');
assert.equal(new Set([...paleta.values()]).size, 4,
  'duas obras do mesmo planejamento NÃO podem cair na mesma cor');
[...paleta.values()].forEach(slot => {
  assert.ok(Number.isInteger(slot) && slot >= 0 && slot < CrewPlan.paletteSize,
    `slot ${slot} fora da paleta`);
});

// estável: a mesma obra recebe o mesmo slot em outra montagem...
assert.equal(CrewPlan.projectPalette(todas).get('p1'), paleta.get('p1'),
  'a cor da obra tem que ser a mesma na próxima montagem');
// ...e a ordem de entrada dos IDs não muda nada
assert.equal(CrewPlan.projectPalette(['p4', 'p2', 'p3', 'p1']).get('p3'), paleta.get('p3'),
  'a paleta não pode depender da ordem em que os IDs chegaram');
// ...nem a posição da obra no cadastro (o que derrubava a paleta antiga)
const ordemOriginal = context.State.projects.slice();
context.State.projects = [projects[3], projects[0], projects[2], projects[1]];
assert.equal(CrewPlan.projectPalette(todas).get('p1'), paleta.get('p1'),
  'reordenar/apagar obra no cadastro não pode reembaralhar as cores');
context.State.projects = ordemOriginal;

// lixo não vira slot
assert.equal(CrewPlan.projectPalette(['p1', '', null, 'p1']).size, 1,
  'ID vazio e repetido não entram na paleta');
assert.equal(CrewPlan.projectPalette([]).size, 0);

/* ================= 2. o 3º parâmetro é OPCIONAL — os DOIS caminhos ========== */
assert.equal(CrewPlan.paletteClass('p1', paleta, 'cp-obra'), `cp-obra-${paleta.get('p1')}`);
assert.equal(CrewPlan.paletteClass('p1', null, 'cp-obra'), '', 'sem paleta, sem classe');
assert.equal(CrewPlan.paletteClass('', paleta, 'cp-obra'), '', 'sem obra, sem classe');
assert.equal(CrewPlan.paletteClass('p9', paleta, 'cp-obra'), '', 'obra fora da paleta não inventa cor');
assert.equal(CrewPlan.paletteClass('p1', paleta, 'cpg-obra'), `cpg-obra-${paleta.get('p1')}`,
  'o prefixo separa a tela do papel');

const semanaCurta = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
const bucket = { key: 's', days: semanaCurta, label: 'SEM 1', sub: '05–09' };

// SEM paleta: o comportamento da v4.5.2 continua intacto
assert.match(view.printCell(byId('e1'), bucket), /^<td class="cpg-cell cpg-alloc">/,
  'sem paleta, a célula impressa fica exatamente como na v4.5.2');
assert.equal(/cpg-obra-/.test(view.cellFor(byId('e1'), bucket)), false,
  'sem paleta, a célula da tela não ganha cor de obra');

// COM paleta: a classe da obra entra
assert.match(view.printCell(byId('e1'), bucket, paleta),
  new RegExp(`class="cpg-cell cpg-alloc cpg-obra-${paleta.get('p1')}"`),
  'com paleta, a célula impressa carrega a cor da obra');
assert.match(view.cellFor(byId('e1'), bucket, paleta),
  new RegExp(`cp-obra-${paleta.get('p1')}`),
  'com paleta, a célula da tela carrega a cor da obra');

// o código da obra continua NO TEXTO (é o que salva o preto e branco)
assert.match(view.printCell(byId('e1'), bucket, paleta), />815<\/td>$/);

/* ================= 3. estado vence a cor da obra ================= */
// o conflito do Caio é na semana de 12–14/10, onde as duas obras se cruzam
const semanaConflito = { key: 'c', days: ['2026-10-12', '2026-10-13', '2026-10-14'],
  label: 'SEM 2', sub: '12–14' };
const conflito = view.printCell(byId('e3'), semanaConflito, paleta);
assert.match(conflito, /cpg-conflict/);
assert.equal(/cpg-obra-/.test(conflito), false,
  'conflito NÃO pode receber a cor da obra — é exceção e tem que saltar');
assert.match(conflito, />!<\/td>$/);

const ferias = view.printCell(byId('e5'), bucket, paleta);
assert.match(ferias, /cpg-off/);
assert.equal(/cpg-obra-/.test(ferias), false, 'férias/sem vínculo também não recebe cor de obra');
assert.match(ferias, />\/\/<\/td>$/);

// parcial mantém a marca do tracejado E ganha a cor da obra
const parcial = view.printCell(byId('e2'), bucket, paleta);
assert.match(parcial, /cpg-partial/);
assert.match(parcial, new RegExp(`cpg-obra-${paleta.get('p2')}`),
  'parcial é a cor da obra com contorno tracejado, não mais o âmbar fixo');

/* ============ 4. duas obras na mesma coluna: a cor conta parte da história === */
const duasObras = view.printCell(byId('e4'), bucket, paleta);
assert.match(duasObras, /\+<\/td>$/,
  'coluna com duas obras sem sobreposição ganha "+": a célula só tem UMA cor');
assert.equal(/cpg-conflict/.test(duasObras), false, 'duas obras sem se sobrepor NÃO é conflito');
assert.match(view.cellFor(byId('e4'), bucket, paleta), / \+1<\/span>/,
  'na tela o aviso é "+1"');

/* ================= 5. o planejamento em UMA folha ================= */
const m = n => view.printMetrics({ rows: n, cols: 22, projects: 4, alert: false });

const poucos = m(10);
assert.equal(poucos.fits, true, '10 colaboradores cabem folgados');
assert.equal(poucos.rowMm, 6.4, 'com poucas linhas a altura pára no teto, não estica');
assert.equal(poucos.tight, false);

const muitos = m(40);
assert.ok(muitos.rowMm < poucos.rowMm, 'mais colaboradores -> linha mais baixa');
assert.equal(muitos.fits, true, '40 colaboradores ainda cabem em uma folha');
assert.ok(muitos.rowMm * muitos.rows <= muitos.usable + 0.01,
  'a soma das linhas não pode passar da altura útil quando fits é true');

const demais = m(90);
assert.equal(demais.rowMm, 3.2, 'a linha pára no piso legível');
assert.equal(demais.fits, false, 'e avisa que não coube, em vez de ficar ilegível');
assert.equal(demais.tight, true, 'no aperto, a função do colaborador sai da coluna do nome');
assert.ok(demais.cellFont >= 4.6, 'a fonte nunca desce abaixo do piso de 4,6px');

// a coluna do nome cede espaço quando há muitas colunas de data
assert.ok(m(20).nameMm > view.printMetrics({ rows: 20, cols: 31, projects: 4 }).nameMm,
  '31 colunas de data espremem a coluna do nome');
assert.ok(view.printMetrics({ rows: 20, cols: 31, projects: 4 }).colMm >= 7,
  'mesmo com 31 dias a coluna diária tem que caber um código de obra');

// entrada zoada não explode
assert.equal(view.printMetrics().rows, 1);
assert.equal(view.printMetrics({ rows: 0, cols: 0 }).cols, 1);

/* ================= 6. o PDF só tem o planejamento ================= */
assert.equal(source.includes('crewplan-print-summary'), false,
  'o resumo por colaborador saiu do PDF (ele pediu só o planejamento)');
assert.equal(source.includes('crewplan-print-project'), false,
  'o detalhe por obra saiu do PDF');
assert.equal(source.includes('crewplan-print-facts'), false,
  'os quatro KPIs saíram do PDF');
assert.match(source, /printCell\(employee,bucket,palette\)/,
  'o Gantt impresso tem que receber a paleta');
assert.match(source, /projectKeyMarkup\(palette,'cpg-obra'\)/,
  'sem a tradução dos códigos a cor vira enfeite');
assert.match(source, /projectKeyMarkup\(palette,'cp-obra'\)/,
  'a tela também precisa da tradução dos códigos');
assert.match(source, /--cpg-row/, 'a altura da linha impressa vem do printMetrics');

/* ================= 7. o CSS ================= */
const slots = [...css.matchAll(/--cp-obra-(\d+):(#[0-9A-Fa-f]{6})/g)];
assert.equal(slots.length, CrewPlan.paletteSize,
  'o CSS tem que ter um token por slot da paleta do JS');
assert.equal(new Set(slots.map(s => s[2].toLowerCase())).size, CrewPlan.paletteSize,
  'nenhuma cor repetida na paleta');

/* ⚠ Nem vermelho nem cinza na paleta: são de conflito e de férias, e uma obra
   com a cor do conflito faria o PDF mentir na única coisa que não pode.
   A conta é ΔE em CIELab, não "parece diferente": o laranja queimado que eu
   tinha escolhido primeiro ficava a ΔE 16 do vermelho — a mesma cor numa
   célula de 6 px — e só a medição pegou isso. */
const lab = hex => {
  const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const [r, g, b] = ch;
  const xyz = [
    (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047,
    (r * 0.2126 + g * 0.7152 + b * 0.0722),
    (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  ].map(t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
};
const dE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

const CONFLITO = '#B91C1C';   // .cpg-conflict
const FERIAS = '#A1A1AA';     // .cpg-off

assert.ok(dE('#C2410C', CONFLITO) < 20,
  'sanidade do medidor: o laranja queimado TEM que sair perto do vermelho');

slots.forEach(([, slot, hex]) => {
  assert.ok(dE(hex, CONFLITO) >= 40,
    `slot ${slot} (${hex}) está a ΔE ${dE(hex, CONFLITO).toFixed(0)} do vermelho de conflito`);
  assert.ok(dE(hex, FERIAS) >= 30,
    `slot ${slot} (${hex}) está a ΔE ${dE(hex, FERIAS).toFixed(0)} do cinza de férias`);
});
for (let i = 0; i < slots.length; i++) {
  for (let j = i + 1; j < slots.length; j++) {
    assert.ok(dE(slots[i][2], slots[j][2]) >= 20,
      `slots ${slots[i][1]} e ${slots[j][1]} estão a ΔE ${dE(slots[i][2], slots[j][2]).toFixed(0)} — duas obras ficariam parecidas`);
  }
}

// tela e papel leem os MESMOS tokens
for (let slot = 0; slot < CrewPlan.paletteSize; slot++) {
  assert.ok(css.includes(`.cp-cell.cp-busy.cp-obra-${slot}{`), `falta a regra de tela do slot ${slot}`);
  assert.ok(css.includes(`td.cpg-obra-${slot}{`), `falta a regra de papel do slot ${slot}`);
  assert.ok(css.includes(`td.cpg-obra-${slot}{border-color:var(--cp-obra-${slot})`),
    `o papel do slot ${slot} tem que ler o MESMO token da tela`);
}

/* ⚠ A regra da obra vem DEPOIS da do parcial de propósito: as duas têm a mesma
   especificidade, e como a da obra não declara `border-style`, o TRACEJADO do
   parcial sobrevive. Inverter a ordem faz o parcial virar sólido em silêncio. */
assert.ok(css.indexOf('.cp-cell.cp-busy.cp-partial{') < css.indexOf('.cp-cell.cp-busy.cp-obra-0{'),
  'na tela, a cor da obra tem que vir depois do parcial');
assert.ok(css.indexOf('td.cpg-partial{') < css.indexOf('td.cpg-obra-0{'),
  'no papel, a cor da obra tem que vir depois do parcial');
assert.equal(/\.cp-cell\.cp-busy\.cp-obra-\d\{[^}]*border-style/.test(css), false,
  'a regra da obra não pode declarar border-style, senão apaga o tracejado do parcial');

// o relatório continua PAISAGEM
assert.match(css, /@page crewplan-report\{[^}]*size:A4 landscape/);
