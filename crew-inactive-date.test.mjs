/**
 * v4.2.8 — "Inativo a partir de" (crew.inactiveSince).
 *
 * Regra: o colaborador continua sendo apurado em todos os dias ANTERIORES à
 * data e some a partir dela (inclusive). Sem a data, o inativo some de tudo,
 * exatamente como antes da v4.2.8.
 *
 * O teste lê a função real publicada em modules/rdo/rdo.js (não uma cópia) e
 * o Histórico de Alocações real de modules/relatorios/relatorios.js.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const rdoSource = fs.readFileSync(new URL('../modules/rdo/rdo.js', import.meta.url), 'utf8');
const start = rdoSource.indexOf('  crewActiveOn(employee,date){');
assert.notEqual(start, -1, 'RDO.crewActiveOn não foi encontrada em modules/rdo/rdo.js');
const end = rdoSource.indexOf('\n  },', start);
assert.notEqual(end, -1, 'não consegui delimitar RDO.crewActiveOn');
const crewActiveOnSource = rdoSource.slice(start, end + '\n  }'.length);
const RDO = vm.runInNewContext(`({\n${crewActiveOnSource}\n})`);

/* ---------- a função em si ---------- */
const ativo = { id: 'e1', name: 'Ana', active: true };
const inativoSemData = { id: 'e2', name: 'Bruno', active: false };
const inativoComData = { id: 'e3', name: 'Carla', active: false, inactiveSince: '2026-08-20' };

assert.equal(RDO.crewActiveOn(ativo, '2026-08-19'), true);
assert.equal(RDO.crewActiveOn(inativoSemData, '2026-08-19'), false, 'inativo sem data continua fora de tudo');
assert.equal(RDO.crewActiveOn(inativoComData, '2026-08-19'), true, 'véspera da data ainda conta');
assert.equal(RDO.crewActiveOn(inativoComData, '2026-08-20'), false, 'o próprio dia da data já não conta');
assert.equal(RDO.crewActiveOn(inativoComData, '2026-08-21'), false);
assert.equal(RDO.crewActiveOn(inativoComData, ''), false, 'sem data de referência, cai no status');
assert.equal(RDO.crewActiveOn(null, '2026-08-19'), false);

/* ---------- Histórico de Alocações ---------- */
const relatoriosSource = fs.readFileSync(new URL('../modules/relatorios/relatorios.js', import.meta.url), 'utf8');
const context = {
  Views: {},
  State: {
    projects: [{ id: 'p1', proposal: '798', name: 'Primeira obra' }],
    crew: [
      { id: 'e1', name: 'Ana', registration: '010', internalRole: 'Eletricista', active: true },
      { id: 'e3', name: 'Carla', registration: '012', internalRole: 'Técnica', active: false, inactiveSince: '2026-08-20' },
      { id: 'e2', name: 'Bruno', registration: '011', internalRole: 'Ajudante', active: false }
    ],
    workforceStatus: [],
    rdos: [
      {
        id: 'r1', number: 'RDO-1', projectId: 'p1', date: '2026-08-18', status: 'Aprovado', isHoliday: false,
        entries: [{ employeeId: 'e3', employeeName: 'Carla', start: '08:00', end: '17:00', breakMinutes: 60, regular: 8, overtime50: 0, overtime100: 0, nightHours: 0, attendanceStatus: 'present' }]
      }
    ]
  },
  RDO: { ...RDO, displayRoleFor: (projectId, entry) => entry.internalRole || '', isAbsent: entry => entry.attendanceStatus === 'absent' },
  U: { projLabel: project => `${project.proposal} | ${project.name}` },
  console
};
vm.createContext(context);
vm.runInContext(relatoriosSource, context);

const rows = context.Views.relatorios.allocationHistoryRows({ dateFrom: '2026-08-18', dateTo: '2026-08-21' });
const carla = rows.filter(row => row.employeeId === 'e3');

// 18/08 alocada no RDO; 19/08 ociosa; 20 e 21/08 não aparecem mais.
assert.equal(carla.map(row => row.date).join(','), '2026-08-18,2026-08-19');
assert.equal(carla[0].situation, 'Alocado');
assert.equal(carla[0].projectLabel, '798 | Primeira obra');
assert.equal(carla[1].situation, 'Ocioso');

// Bruno é inativo sem data: continua fora do relatório inteiro.
assert.equal(rows.some(row => row.employeeId === 'e2'), false);

// Ana é ativa: um registro por dia do período.
assert.equal(rows.filter(row => row.employeeId === 'e1').length, 4);

console.log('Crew inactivity date tests passed');
