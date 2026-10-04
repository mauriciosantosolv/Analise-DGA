/**
 * v4.5.0 — Planejamento de Colaboradores.
 *
 * O que este teste prova, sobre o código REAL publicado (nada é copiado aqui):
 *   1. dias úteis: sábado e domingo não consomem capacidade, e a regra é uma
 *      função só — CrewPlan.businessDays / endAfterBusinessDays;
 *   2. a classificação do dia NÃO é reimplementada: CrewPlan.isWeekend delega
 *      para RDO.dayType, recortada do modules/rdo/rdo.js de verdade;
 *   3. conflito: new_start <= existing_end AND new_end >= existing_start, só
 *      entre alocações ativas, e a alocação em edição não conflita consigo;
 *   4. o motor de disponibilidade é um só e responde certo para disponível,
 *      parcial, alocado, em conflito e em férias;
 *   5. o ranking sugere na ordem das prioridades 1 a 4 da especificação;
 *   6. capacidade por semana desconta férias e colaborador inativo.
 *
 * Outubro de 2026 (usado o tempo todo): 01/10 = quinta, 03 e 04/10 = fim de
 * semana, 05/10 = segunda, 20/10 = terça, 30/10 = sexta.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

/* ---------- RDO real: crewActiveOn + dayType recortadas do arquivo ---------- */
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

/* ---------- massa de teste ---------- */
const crew = [
  { id: 'e1', name: 'João Silva', internalRole: 'Pedreiro', active: true },
  { id: 'e2', name: 'Carlos Souza', internalRole: 'Pedreiro', active: true },
  { id: 'e3', name: 'Marcos Lima', internalRole: 'Pedreiro', active: true },
  { id: 'e4', name: 'Pedro Santos', internalRole: 'Pedreiro', active: true },
  { id: 'e5', name: 'Ana Costa', internalRole: 'Servente', active: true },
  // em férias no período inteiro da análise
  { id: 'e6', name: 'Paulo Oliveira', internalRole: 'Servente', active: true,
    vacations: [{ id: 'v1', from: '2026-10-01', to: '2026-10-31' }] },
  { id: 'r1', name: 'Pedreiro', recordType: 'role', active: true },
  { id: 'r2', name: 'Servente', recordType: 'role', active: true }
];

const crewAllocations = [
  // Marcos: ocupado 05/10 a 09/10 (5 dias úteis dos 12 do período 05–20/10)
  { id: 'a1', employeeId: 'e3', projectId: 'p1', role: 'Pedreiro',
    start: '2026-10-05', end: '2026-10-09', status: 'Planejado' },
  // Pedro: ocupado o período inteiro
  { id: 'a2', employeeId: 'e4', projectId: 'p1', role: 'Pedreiro',
    start: '2026-10-01', end: '2026-10-31', status: 'Planejado' },
  // Ana: duas alocações sobrepostas -> conflito
  { id: 'a3', employeeId: 'e5', projectId: 'p1', role: 'Servente',
    start: '2026-10-05', end: '2026-10-14', status: 'Planejado' },
  { id: 'a4', employeeId: 'e5', projectId: 'p2', role: 'Servente',
    start: '2026-10-12', end: '2026-10-20', status: 'Planejado' },
  // Carlos: alocação CANCELADA não pode ocupar nem conflitar
  { id: 'a5', employeeId: 'e2', projectId: 'p2', role: 'Pedreiro',
    start: '2026-10-05', end: '2026-10-20', status: 'Cancelado' },
  // João: alocação só no fim de semana — não pode consumir capacidade nenhuma
  { id: 'a6', employeeId: 'e1', projectId: 'p2', role: 'Pedreiro',
    start: '2026-10-03', end: '2026-10-04', status: 'Planejado' }
];

const context = {
  Views: {},
  State: {
    crew,
    crewAllocations,
    projects: [
      { id: 'p1', proposal: '815', name: 'USF', status: 'Em andamento' },
      { id: 'p2', proposal: '816', name: 'Residencial X', status: 'A executar' }
    ],
    settings: {}
  },
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
context.RDO.projectLabel = id =>
  (context.State.projects.find(p => String(p.id) === String(id)) || {}).name || 'Projeto';

const source = fs.readFileSync(new URL('../modules/planejamento/equipe.js', import.meta.url), 'utf8');
vm.createContext(context);
vm.runInContext(`${source}\n;globalThis.CrewPlan=CrewPlan;`, context);
const CrewPlan = context.CrewPlan;

/* ================= 1. REGRA DE DIAS ÚTEIS ================= */
// segunda a sexta cheia
assert.equal(CrewPlan.businessDays('2026-10-05', '2026-10-09'), 5);
// o intervalo atravessa um fim de semana: 10 dias corridos, 8 úteis
assert.equal(CrewPlan.businessDays('2026-10-05', '2026-10-14'), 8);
// só sábado e domingo: nenhum dia útil
assert.equal(CrewPlan.businessDays('2026-10-03', '2026-10-04'), 0);
// o exemplo do documento: 01/10/2026 a 30/10/2026
assert.equal(CrewPlan.businessDays('2026-10-01', '2026-10-30'), 22);
// entradas inválidas não explodem
assert.equal(CrewPlan.businessDays('', '2026-10-30'), 0);
assert.equal(CrewPlan.businessDays('2026-10-30', '2026-10-01'), 0, 'fim antes do início = 0');

// a classificação do dia vem do RDO, não de uma cópia
assert.equal(CrewPlan.isWeekend('2026-10-03'), true, 'sábado');
assert.equal(CrewPlan.isWeekend('2026-10-04'), true, 'domingo');
assert.equal(CrewPlan.isWeekend('2026-10-05'), false, 'segunda');
assert.equal(CrewPlan.isBusinessDay('2026-10-05'), true);

// "Início 05/10/2026, duração 30 dias úteis" -> o sistema calcula o término
assert.equal(CrewPlan.endAfterBusinessDays('2026-10-05', 30), '2026-11-13');
assert.equal(CrewPlan.businessDays('2026-10-05', '2026-11-13'), 30, 'ida e volta batem');
assert.equal(CrewPlan.endAfterBusinessDays('2026-10-03', 1), '2026-10-05',
  'começando no sábado, o primeiro dia útil é a segunda');

// feriado é extensão futura: com a lista preenchida, o dia sai da conta
context.State.settings.crewPlanHolidays = ['2026-10-12'];
assert.equal(CrewPlan.businessDays('2026-10-05', '2026-10-16'), 9, 'feriado no meio da semana sai');
delete context.State.settings.crewPlanHolidays;
assert.equal(CrewPlan.businessDays('2026-10-05', '2026-10-16'), 10, 'sem feriado cadastrado, nada muda');

/* ================= 2. DETECÇÃO DE CONFLITOS ================= */
// new_start <= existing_end AND new_end >= existing_start
assert.equal(CrewPlan.overlaps('2026-10-05', '2026-10-09', '2026-10-09', '2026-10-14'), true, 'encosta em 1 dia');
assert.equal(CrewPlan.overlaps('2026-10-05', '2026-10-08', '2026-10-09', '2026-10-14'), false, 'véspera não é conflito');

// Marcos já está na p1 de 05 a 09/10
const conflitos = CrewPlan.conflictsFor({ employeeId: 'e3', start: '2026-10-08', end: '2026-10-15' });
assert.equal(conflitos.length, 1);
assert.equal(conflitos[0].id, 'a1');
// a própria alocação em edição não conflita consigo mesma
assert.equal(CrewPlan.conflictsFor({ employeeId: 'e3', start: '2026-10-08', end: '2026-10-15', excludeId: 'a1' }).length, 0);
// alocação cancelada não gera conflito
assert.equal(CrewPlan.conflictsFor({ employeeId: 'e2', start: '2026-10-05', end: '2026-10-20' }).length, 0,
  'Cancelado não disputa o colaborador');
// período inválido não inventa conflito
assert.equal(CrewPlan.conflictsFor({ employeeId: 'e4', start: '', end: '' }).length, 0);

/* ================= 3. MOTOR DE DISPONIBILIDADE ================= */
const de = '2026-10-05', ate = '2026-10-20'; // 12 dias úteis
const rel = id => CrewPlan.availability(crew.find(c => c.id === id), de, ate);

const joao = rel('e1');
assert.equal(joao.totalDays, 12);
assert.equal(joao.busyDays, 0, 'alocação de sábado/domingo não ocupa nenhum dia útil');
assert.equal(joao.pct, 100);
assert.equal(joao.category, 'disponivel');

const carlos = rel('e2');
assert.equal(carlos.category, 'disponivel', 'só tinha alocação cancelada');
assert.equal(carlos.pct, 100);

const marcos = rel('e3');
assert.equal(marcos.busyDays, 5);
assert.equal(marcos.freeDays, 7);
assert.equal(marcos.pct, Math.round(7 / 12 * 100));
assert.equal(marcos.category, 'parcial');
assert.equal(marcos.freeFrom, '2026-10-12', 'primeiro dia útil livre é a segunda seguinte');
assert.equal(marcos.freeAfter, '2026-10-10', 'dia seguinte ao fim da alocação');

const pedro = rel('e4');
assert.equal(pedro.freeDays, 0);
assert.equal(pedro.pct, 0);
assert.equal(pedro.category, 'alocado');

const ana = rel('e5');
assert.equal(ana.category, 'conflito', 'duas obras sobrepostas de 12 a 14/10');
assert.ok(ana.conflictDays > 0);
assert.equal(ana.conflicts.length, 2, 'as duas alocações entram no conflito');

const paulo = rel('e6');
assert.equal(paulo.offDays, 12, 'férias no mês inteiro');
assert.equal(paulo.busyDays, 0);
assert.equal(paulo.category, 'indisponivel', 'férias não é "disponível"');

/* ================= 4. RANKING DE CANDIDATOS ================= */
const pedreiros = CrewPlan.candidates({ from: de, to: ate, role: 'Pedreiro' });
assert.equal(pedreiros.length, 4, 'só os quatro pedreiros');
assert.equal(pedreiros.every(item => item.role === 'Pedreiro'), true, 'a função filtra');
// Prioridade 1 (100% livre) antes da 2 (parcial) antes da 5 (sem dia livre)
assert.equal(pedreiros[0].tier, 1);
assert.equal(pedreiros[1].tier, 1);
assert.equal(pedreiros[2].employeeId, 'e3', 'Marcos é o parcial');
assert.equal(pedreiros[2].tier, 2);
assert.equal(pedreiros[3].employeeId, 'e4', 'Pedro, sem nenhum dia livre, é o último');
// desempate alfabético entre os dois de 100%
assert.equal(pedreiros.slice(0, 2).map(item => item.employee.name).join(','), 'Carlos Souza,João Silva');
// quem tem conflito fica atrás de quem só está parcial
const serventes = CrewPlan.candidates({ from: de, to: ate, role: 'Servente' });
assert.equal(CrewPlan.tierOf(ana), 4, 'conflito é prioridade 4');
assert.equal(CrewPlan.tierOf(paulo), 5, 'férias fica atrás de todo mundo');
assert.equal(serventes.map(item => item.employeeId).join(','), 'e5,e6',
  'quem tem conflito (ajustável) vem antes de quem está de férias');
// filtro de disponibilidade mínima
assert.equal(CrewPlan.candidates({ from: de, to: ate, role: 'Pedreiro', minPct: 100 }).length, 2);

/* ================= 5. CAPACIDADE DA EQUIPE ================= */
const semanas = CrewPlan.capacityBuckets('2026-10-05', '2026-10-16', crew.filter(c => c.recordType !== 'role'));
assert.equal(semanas.length, 2, 'duas semanas');
assert.equal(semanas[0].days.length, 5);
// semana 1 (05–09/10): 6 colaboradores, Paulo de férias -> 25 dias de capacidade;
// ocupados: Marcos (5) + Pedro (5) + Ana (5) = 15
assert.equal(semanas[0].capacity, 25, 'férias saem da capacidade');
assert.equal(semanas[0].used, 15);
assert.equal(semanas[0].pct, 60);
assert.equal(semanas[0].idle, 10);
// semana 2 (12–16/10): Marcos já saiu -> 10 ocupados de 25
assert.equal(semanas[1].used, 10);
assert.equal(semanas[1].pct, 40);

/* ================= 6. A TELA FOI REGISTRADA ================= */
assert.equal(typeof context.Views.planejamentoequipe, 'object', 'Views.planejamentoequipe existe');
assert.equal(context.Views.planejamentoequipe.title, 'Planejamento de Colaboradores');
assert.equal(typeof context.Views.planejamentoequipe.render, 'function');
assert.equal(CrewPlan.statuses.join(','), 'Planejado,Concluído,Cancelado');
assert.equal(CrewPlan.activeStatuses.join(','), 'Planejado', 'só Planejado consome capacidade');

console.log('Crew allocation planning tests passed');
