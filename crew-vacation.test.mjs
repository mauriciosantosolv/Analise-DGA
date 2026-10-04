/**
 * v4.2.18 — férias do colaborador e apuração de ociosidade só em dia útil.
 *
 * Duas regras novas, lidas das funções reais publicadas (não de cópias):
 *
 * 1. crew.vacations é uma lista de períodos {id,from,to}. Em qualquer dia
 *    coberto por um período o colaborador some do RDO, das folgas, do
 *    Painel/TV e do Histórico de Alocações — pela mesma porta já usada pelo
 *    "Inativo a partir de" (RDO.crewActiveOn) — e aparece no relatório como
 *    "Férias", sem custo de ociosidade.
 *
 * 2. Sábado e domingo passam a trazer apenas o que foi lançado no RDO.
 *    Ocioso, Folga e Férias só são apurados de segunda a sexta.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

/* ---------- 1) as funções de férias, lidas de modules/rdo/rdo.js ---------- */
const rdoSource = fs.readFileSync(new URL('../modules/rdo/rdo.js', import.meta.url), 'utf8');

function metodo(nome) {
  const inicio = rdoSource.indexOf(`  ${nome}(`);
  assert.notEqual(inicio, -1, `RDO.${nome} não foi encontrada em modules/rdo/rdo.js`);
  const fim = rdoSource.indexOf('\n  },', inicio);
  assert.notEqual(fim, -1, `não consegui delimitar RDO.${nome}`);
  return rdoSource.slice(inicio, fim + '\n  }'.length);
}

const RDO = vm.runInNewContext(`({
${metodo('vacationPeriods')},
${metodo('vacationDays')},
${metodo('vacationOn')},
${metodo('onVacation')},
${metodo('crewActiveOn')}
})`);

const semFerias = { id: 'e1', name: 'Ana', active: true };
const comFerias = {
  id: 'e2', name: 'Bruno', active: true,
  vacations: [
    { id: 'v2', from: '2026-12-01', to: '2026-12-30' },
    { id: 'v1', from: '2026-09-07', to: '2026-09-16' }
  ]
};

// os períodos saem sempre ordenados e sem lixo
assert.equal(RDO.vacationPeriods(comFerias).map(p => p.from).join(','), '2026-09-07,2026-12-01');
assert.equal(RDO.vacationPeriods({ vacations: [{ from: '2026-09-20', to: '2026-09-10' }] }).length, 0, 'fim antes do início é descartado');
assert.equal(RDO.vacationPeriods({ vacations: [{ from: 'x', to: 'y' }] }).length, 0, 'data inválida é descartada');
assert.equal(RDO.vacationPeriods(semFerias).length, 0);

// contagem de dias, com as duas pontas incluídas
assert.equal(RDO.vacationDays({ from: '2026-09-07', to: '2026-09-16' }), 10);
assert.equal(RDO.vacationDays({ from: '2026-09-07', to: '2026-09-07' }), 1);
assert.equal(RDO.vacationDays({ from: '2026-09-16', to: '2026-09-07' }), 0);

// o período é fechado nas duas pontas
assert.equal(RDO.onVacation(comFerias, '2026-09-06'), false, 'véspera ainda trabalha');
assert.equal(RDO.onVacation(comFerias, '2026-09-07'), true, 'primeiro dia já é férias');
assert.equal(RDO.onVacation(comFerias, '2026-09-16'), true, 'último dia ainda é férias');
assert.equal(RDO.onVacation(comFerias, '2026-09-17'), false, 'dia seguinte volta a trabalhar');
assert.equal(RDO.onVacation(comFerias, '2026-12-15'), true, 'o segundo período também vale');
assert.equal(RDO.onVacation(comFerias, ''), false, 'sem data de referência não há férias');
assert.equal(RDO.vacationOn(comFerias, '2026-09-10').to, '2026-09-16');

// e a disponibilidade do dia passa a considerar as férias
assert.equal(RDO.crewActiveOn(comFerias, '2026-09-06'), true);
assert.equal(RDO.crewActiveOn(comFerias, '2026-09-10'), false, 'em férias o colaborador some do dia');
assert.equal(RDO.crewActiveOn(comFerias, '2026-09-17'), true);
assert.equal(RDO.crewActiveOn(semFerias, '2026-09-10'), true, 'quem não tem férias não muda');

/* ---------- 2) o relatório real de modules/relatorios/relatorios.js ---------- */
const relatoriosSource = fs.readFileSync(new URL('../modules/relatorios/relatorios.js', import.meta.url), 'utf8');
const context = {
  Views: {},
  State: {
    projects: [{ id: 'p1', proposal: '798', name: 'Primeira obra' }],
    crew: [
      { id: 'e1', name: 'Ana', registration: '010', internalRole: 'Eletricista', active: true },
      { id: 'e2', name: 'Bruno', registration: '011', internalRole: 'Ajudante', active: true, vacations: [{ id: 'v1', from: '2026-09-07', to: '2026-09-16' }] }
    ],
    workforceStatus: [],
    rdos: [
      {
        id: 'r1', number: 'RDO-1', projectId: 'p1', date: '2026-09-12', status: 'Aprovado', isHoliday: false,
        entries: [{ employeeId: 'e1', employeeName: 'Ana', start: '08:00', end: '12:00', breakMinutes: 0, regular: 0, overtime50: 4, overtime100: 0, nightHours: 0, attendanceStatus: 'present' }]
      }
    ]
  },
  RDO: { ...RDO, displayRoleFor: (projectId, entry) => entry.internalRole || '', isAbsent: entry => entry.attendanceStatus === 'absent' },
  U: { projLabel: project => `${project.proposal} | ${project.name}` },
  console
};
vm.createContext(context);
vm.runInContext(relatoriosSource, context);

// 07/09 (seg) a 13/09/2026 (dom): 12/09 é sábado e 13/09 é domingo.
const linhas = context.Views.relatorios.allocationHistoryRows({ dateFrom: '2026-09-07', dateTo: '2026-09-13' });

// Bruno está de férias a semana inteira: 5 dias úteis como "Férias" e nada
// no fim de semana.
const bruno = linhas.filter(row => row.employeeId === 'e2');
assert.equal(bruno.map(row => row.date).join(','), '2026-09-07,2026-09-08,2026-09-09,2026-09-10,2026-09-11');
assert.equal(bruno.every(row => row.situation === 'Férias'), true, 'férias não entram como Ocioso');
assert.equal(bruno.every(row => row.regular === 0), true, 'férias não geram custo de ociosidade');

// Ana: ociosa de segunda a sexta e alocada no sábado, porque o RDO do dia 12
// existe. Domingo não traz nada.
const ana = linhas.filter(row => row.employeeId === 'e1');
assert.equal(ana.map(row => row.date).join(','), '2026-09-07,2026-09-08,2026-09-09,2026-09-10,2026-09-11,2026-09-12');
assert.equal(ana.filter(row => row.situation === 'Ocioso').length, 5);
assert.equal(ana.find(row => row.date === '2026-09-12').situation, 'Alocado', 'sábado só mostra o que veio do RDO');
assert.equal(linhas.some(row => row.date === '2026-09-13'), false, 'domingo sem RDO não gera linha nenhuma');

// Uma folga lançada no sábado também não aparece mais.
context.State.workforceStatus = [{ id: 'day-off:2026-09-12:e1', date: '2026-09-12', employeeId: 'e1', employeeName: 'Ana', status: 'day_off' }];
const comFolgaNoSabado = context.Views.relatorios.allocationHistoryRows({ dateFrom: '2026-09-12', dateTo: '2026-09-12' });
assert.equal(comFolgaNoSabado.length, 1);
assert.equal(comFolgaNoSabado[0].situation, 'Alocado');

// A mesma folga num dia útil continua valendo.
context.State.workforceStatus = [{ id: 'day-off:2026-09-17:e1', date: '2026-09-17', employeeId: 'e1', employeeName: 'Ana', status: 'day_off' }];
const folgaUtil = context.Views.relatorios.allocationHistoryRows({ dateFrom: '2026-09-17', dateTo: '2026-09-17' });
assert.equal(folgaUtil.find(row => row.employeeId === 'e1').situation, 'Folga');
assert.equal(folgaUtil.find(row => row.employeeId === 'e2').situation, 'Ocioso', 'fora do período, Bruno volta a ser apurado');

// e a regra de fim de semana isolada
assert.equal(context.Views.relatorios.allocationHistoryWeekend('2026-09-11'), false);
assert.equal(context.Views.relatorios.allocationHistoryWeekend('2026-09-12'), true);
assert.equal(context.Views.relatorios.allocationHistoryWeekend('2026-09-13'), true);
assert.equal(context.Views.relatorios.allocationHistoryWeekend(''), false);

console.log('Crew vacation and weekday idleness tests passed');
