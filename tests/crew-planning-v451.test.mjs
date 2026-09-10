/**
 * v4.5.1 — correções do Planejamento de Colaboradores (10/09/2026).
 *
 * O que este teste prova, sobre o código REAL (nada é copiado aqui):
 *   1. família de função: "Eletricista I / II / I A / II A" viram UM atalho,
 *      deduzido do próprio nome já cadastrado — sem campo novo no banco;
 *   2. uma necessidade aceita VÁRIAS funções (CrewPlan.candidates {roles});
 *      e a chamada antiga de uma função só continua respondendo igual;
 *   3. vínculo: antes da admissão e a partir do desligamento não há dia
 *      planejável, e nesse caso o colaborador some da lista do módulo;
 *   4. RDO.crewActiveOn passou a respeitar a data de admissão, sem perder o
 *      comportamento de "inativo a partir de" nem o de férias;
 *   5. o colaborador desligado CONTINUA valendo para os dias anteriores —
 *      é o que mantém o RDO retroativo possível;
 *   6. a escala de ocupação foi invertida (verde = cheio, vermelho = ocioso) e
 *      a célula do Gantt não usa mais a cor da obra.
 *
 * Outubro de 2026: 01/10 = quinta, 03 e 04/10 = fim de semana, 05/10 = segunda,
 * 30/10 = sexta.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

/* ---------- RDO real: as funções são recortadas do arquivo de verdade ---------- */
const rdoSource = fs.readFileSync(new URL('../modules/rdo/rdo.js', import.meta.url), 'utf8');
const cut = (marker, label) => {
  const start = rdoSource.indexOf(marker);
  assert.notEqual(start, -1, `${label} não foi encontrada em modules/rdo/rdo.js`);
  const end = rdoSource.indexOf('\n  },', start);
  assert.notEqual(end, -1, `não consegui delimitar ${label}`);
  return rdoSource.slice(start, end + '\n  }'.length);
};
const rdoParts = [
  cut('  vacationPeriods(employee){', 'RDO.vacationPeriods'),
  cut('  vacationOn(employee,date){', 'RDO.vacationOn'),
  cut('  onVacation(employee,date){', 'RDO.onVacation'),
  cut('  crewActiveOn(employee,date){', 'RDO.crewActiveOn'),
  cut('  dayType(date,isHoliday=false){', 'RDO.dayType')
].join(',\n');

/* ---------- massa: os quatro níveis de eletricista que ele descreveu ---------- */
const crew = [
  { id: 'e1', name: 'Ari Nunes',    internalRole: 'Eletricista I',    active: true },
  { id: 'e2', name: 'Bruno Reis',   internalRole: 'Eletricista II',   active: true },
  { id: 'e3', name: 'Caio Melo',    internalRole: 'Eletricista I A',  active: true },
  { id: 'e4', name: 'Davi Rocha',   internalRole: 'Eletricista II A', active: true },
  { id: 'e5', name: 'Elias Prado',  internalRole: 'Encarregado',      active: true },
  // admitido no meio do período em análise
  { id: 'e6', name: 'Fabio Luz',    internalRole: 'Eletricista I',    active: true,
    admissionDate: '2026-10-15' },
  // admitido DEPOIS do período inteiro
  { id: 'e7', name: 'Gil Souza',    internalRole: 'Eletricista I',    active: true,
    admissionDate: '2026-12-01' },
  // desligado ANTES do período inteiro
  { id: 'e8', name: 'Hugo Dias',    internalRole: 'Eletricista II',   active: false,
    admissionDate: '2024-01-08', inactiveSince: '2026-09-30' },
  // inativo sem data: some de tudo, como sempre foi
  { id: 'e9', name: 'Ivo Santos',   internalRole: 'Eletricista II',   active: false },
  { id: 'r1', name: 'Eletricista I',    recordType: 'role', active: true },
  { id: 'r2', name: 'Eletricista II',   recordType: 'role', active: true },
  { id: 'r3', name: 'Eletricista I A',  recordType: 'role', active: true },
  { id: 'r4', name: 'Eletricista II A', recordType: 'role', active: true },
  { id: 'r5', name: 'Encarregado',      recordType: 'role', active: true }
];

const context = {
  Views: {},
  State: { crew, crewAllocations: [], projects: [], settings: {} },
  U: {
    norm: s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(),
    esc: s => String(s ?? ''),
    id: () => 'gerado',
    isoDate: d => d.toISOString().slice(0, 10),
    projLabel: p => `${p.proposal} | ${p.name}`,
    safeColor: value => value || '#2563EB',
    date: v => v
  },
  console
};
context.RDO = vm.runInNewContext(`({\n${rdoParts}\n})`);
context.RDO.crewMembers = () => crew.filter(item => item.recordType !== 'role');
context.RDO.crewRoles = () => crew.filter(item => item.recordType === 'role');
context.RDO.projectLabel = () => 'Projeto';

const source = fs.readFileSync(new URL('../modules/planejamento/equipe.js', import.meta.url), 'utf8');
vm.createContext(context);
vm.runInContext(`${source}\n;globalThis.CrewPlan=CrewPlan;`, context);
const CrewPlan = context.CrewPlan;

const de = '2026-10-01', ate = '2026-10-30';

/* ================= 1. FAMÍLIA DE FUNÇÃO ================= */
assert.equal(CrewPlan.roleFamily('Eletricista I'), 'Eletricista');
assert.equal(CrewPlan.roleFamily('Eletricista II'), 'Eletricista');
assert.equal(CrewPlan.roleFamily('Eletricista I A'), 'Eletricista');
assert.equal(CrewPlan.roleFamily('Eletricista II A'), 'Eletricista');
// função sem nível NÃO vira família (senão "Encarregado" viraria atalho de si mesmo)
assert.equal(CrewPlan.roleFamily('Encarregado'), 'Encarregado');

const familias = CrewPlan.roleFamilies();
assert.equal(familias.length, 1, 'só "Eletricista" agrupa mais de uma função');
assert.equal(familias[0].name, 'Eletricista');
assert.equal(familias[0].roles.length, 4, 'os quatro níveis entram no atalho');
assert.equal(
  familias[0].roles.slice().sort().join(','),
  'Eletricista I,Eletricista I A,Eletricista II,Eletricista II A'
);

/* ================= 2. VÁRIAS FUNÇÕES NUMA NECESSIDADE ================= */
// era o pedido: "se eu quiser selecionar todos os níveis de eletricista, não consigo".
// É assim que o assistente chama: as quatro funções e a lista já filtrada pelo vínculo.
const pool = CrewPlan.planningCrew(de, ate);
const todosNiveis = CrewPlan.candidates({ from: de, to: ate, roles: familias[0].roles, pool });
assert.equal(todosNiveis.length, 5, 'e1..e4 + e6 (e7/e8/e9 estão fora do vínculo)');
assert.equal(
  todosNiveis.map(r => r.employee.id).slice().sort().join(','),
  'e1,e2,e3,e4,e6'
);
// uma função só, com o mesmo pool
assert.equal(
  CrewPlan.candidates({ from: de, to: ate, role: 'Eletricista I', pool })
    .map(r => r.employee.id).slice().sort().join(','),
  'e1,e6'
);
// ⚠ a assinatura ANTIGA (sem `pool`) tem que continuar respondendo como na
// v4.5.0 — sobre a lista completa — senão `tests/crew-allocation.test.mjs`
// estaria provando outra coisa.
assert.equal(
  CrewPlan.candidates({ from: de, to: ate, role: 'Eletricista I' })
    .map(r => r.employee.id).slice().sort().join(','),
  'e1,e6,e7'
);
assert.equal(CrewPlan.candidates({ from: de, to: ate }).length, 9);

/* ================= 3. VÍNCULO: ADMISSÃO E DESLIGAMENTO ================= */
const byId = id => crew.find(item => item.id === id);
// admitido dentro do período: aparece
assert.equal(CrewPlan.bondOverlaps(byId('e6'), de, ate), true);
// admitido depois do período inteiro: não aparece
assert.equal(CrewPlan.bondOverlaps(byId('e7'), de, ate), false);
// desligado antes do período inteiro: não aparece
assert.equal(CrewPlan.bondOverlaps(byId('e8'), de, ate), false);
// ...mas aparece no período em que ainda trabalhava
assert.equal(CrewPlan.bondOverlaps(byId('e8'), '2026-09-01', '2026-09-15'), true);

const lista = CrewPlan.planningCrew(de, ate).map(item => item.id).sort().join(',');
assert.equal(lista, 'e1,e2,e3,e4,e5,e6', 'e7 (futuro), e8 (desligado) e e9 (inativo) ficam fora');
// crewMembers() continua devolvendo TODO MUNDO — o RDO e o histórico precisam
assert.equal(CrewPlan.crewMembers().length, 9);

/* ================= 4. crewActiveOn RESPEITA A ADMISSÃO ================= */
// Fabio foi admitido em 15/10: 14/10 não conta, 15/10 conta
assert.equal(context.RDO.crewActiveOn(byId('e6'), '2026-10-14'), false);
assert.equal(context.RDO.crewActiveOn(byId('e6'), '2026-10-15'), true);
assert.equal(context.RDO.crewActiveOn(byId('e6'), '2026-10-16'), true);
// quem não tem data de admissão continua exatamente como era
assert.equal(context.RDO.crewActiveOn(byId('e1'), '2020-01-02'), true);

// e a disponibilidade do módulo acompanha: os dias anteriores à admissão saem
// da conta como "indisponível", igual férias — não viram ociosidade paga.
const fabio = CrewPlan.availability(byId('e6'), de, ate);
assert.equal(fabio.totalDays, 22, 'outubro/2026 tem 22 dias úteis');
assert.equal(fabio.offDays, 10, '01/10 a 14/10 = 10 dias úteis fora do vínculo');
assert.equal(fabio.freeDays, 12);
assert.equal(fabio.busyDays, 0);

/* ================= 5. O DESLIGADO CONTINUA VALENDO PARA O PASSADO ================= */
// é isto que mantém o RDO retroativo possível para quem já saiu
assert.equal(context.RDO.crewActiveOn(byId('e8'), '2026-09-29'), true);
assert.equal(context.RDO.crewActiveOn(byId('e8'), '2026-09-30'), false);
// ...e antes da admissão dele, não
assert.equal(context.RDO.crewActiveOn(byId('e8'), '2024-01-07'), false);
assert.equal(context.RDO.crewActiveOn(byId('e8'), '2024-01-08'), true);
// inativo SEM data continua sumindo de tudo (comportamento de sempre)
assert.equal(context.RDO.crewActiveOn(byId('e9'), '2020-01-02'), false);

/* ================= 6. CORES E ESCALA (lidas do código de verdade) ================= */
// A célula do Gantt não pode mais tirar a cor da obra.
assert.equal(source.includes('App.projectColor'), false,
  'a cor da célula não pode mais vir da obra (item 2 do pedido)');
assert.equal(source.includes('--cp-color:${'), false,
  'nenhuma cor de obra é mais injetada inline');

// Escala de ocupação invertida: cheio = ok (verde), vazio = crit (vermelho).
assert.match(source, /bucket\.pct>=85\?'ok':bucket\.pct>=60\?'warn':'crit'/,
  'a barra de capacidade tem que ser verde quando cheia e vermelha quando vazia');
assert.equal(source.includes("bucket.pct>=90?'crit'"), false,
  'a escala antiga (cheio = vermelho) não pode ter sobrado');

// A aba Disponibilidade responde "quem está livre?" e mantém a escala dela.
assert.match(source, /report\.pct>=100\?'ok':report\.pct>0\?'warn':'crit'/,
  'a aba Disponibilidade continua com a escala própria, por decisão dele');

// O seletor de período tem que repintar a aba ativa (item 6 do pedido).
assert.match(source, /setSpan\(span\)\{/, 'setSpan precisa existir');
assert.match(source, /data-cp-span="\$\{key\}"/, 'as abas precisam do marcador');
assert.equal(source.includes("Views.planejamentoequipe.span='${key}';Views.planejamentoequipe.draw()"), false,
  'o clique antigo, que trocava o dado sem repintar a aba, não pode ter sobrado');

console.log('crew-planning-v451: OK');

/* ================= 7. O MOTIVO DE "INDISPONÍVEL" ================= */
/* Achado no render da v4.5.1: a célula dizia "Férias/inativo" também para o
   dia anterior à admissão, o que é mentira na tela. */
const diasForaDoVinculo = CrewPlan.offDaysOf(byId('e6'), de, ate);
assert.equal(diasForaDoVinculo.length, 10, '01/10 a 14/10 = 10 dias úteis');
assert.equal(CrewPlan.offReason(byId('e6'), diasForaDoVinculo).short, 'Sem vínculo');

const feriasIntegral = { id: 'x1', name: 'Zeca', internalRole: 'Encarregado', active: true,
  vacations: [{ id: 'v9', from: '2026-10-01', to: '2026-10-31' }] };
assert.equal(CrewPlan.offReason(feriasIntegral, CrewPlan.offDaysOf(feriasIntegral, de, ate)).short, 'Férias');
// os dois motivos no mesmo período não podem virar nenhum dos dois
const misto = { id: 'x2', name: 'Yuri', internalRole: 'Encarregado', active: true,
  admissionDate: '2026-10-08', vacations: [{ id: 'v8', from: '2026-10-19', to: '2026-10-23' }] };
assert.equal(CrewPlan.offReason(misto, CrewPlan.offDaysOf(misto, de, ate)).short, 'Indisponível');

// a etiqueta curta aceita o motivo e não fixa mais "Férias"
assert.match(CrewPlan.categoryTagShort('indisponivel', 'Sem vínculo'), /Sem vínculo/);
assert.match(CrewPlan.categoryTagShort('indisponivel'), /Indisponível/);
assert.equal(source.includes("indisponivel:'Férias'"), false,
  '"indisponível" não pode mais ser sempre rotulado como férias');

console.log('crew-planning-v451: motivo do indisponível OK');
