// v4.5.16 - mesmo colaborador em duas obras no mesmo dia, em horarios que nao se sobrepoem
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../modules/rdo/rdo.js', import.meta.url), 'utf8');
const cloudSrc = fs.readFileSync(new URL('../database/cloud.js', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../supabase/ATUALIZACAO-v4.5.16-RDO-MESMO-DIA-HORARIOS.sql', import.meta.url), 'utf8');

function load({ remote = null } = {}) {
  const state = {
    projects: [{ id: 'p-a', proposal: '778', name: 'A', type: 'Obra' }, { id: 'p-b', proposal: '927', name: 'B', type: 'Obra' }],
    crew: [{ id: 'e-1', name: 'João', internalRole: 'Eletricista', active: true }],
    laborRates: [], measurements: [], rdos: [], workforceStatus: [],
    settings: { rdoDailyHours: 8 }, reload: async () => {}
  };
  const ctx = { State: state, Views: {}, console, App: {}, UI: {}, DB: { put: async () => {} },
    Cloud: remote ? { active: () => true, occupiedRdoSlots: async () => remote, canEditStore: () => true } : { active: () => false },
    U: { projLabel: p => `${p.proposal} | ${p.name}`, isoDate: () => '', num: v => Number(v) || 0, norm: v => String(v).toLowerCase(),
      esc: v => String(v), initials: () => 'CO', id: () => 'id', pct: v => `${v}%`, money: v => String(v), durationMinutes: () => '01:00' } };
  vm.createContext(ctx);
  vm.runInContext(`${source}\nglobalThis.__RDO = RDO;`, ctx);
  return { RDO: ctx.__RDO, state };
}
const rdoA = (entry) => ({ id: 'rdo-a', projectId: 'p-a', date: '2026-11-13', status: 'Rascunho', entries: [{ employeeId: 'e-1', attendanceStatus: 'present', regular: 5, ...entry }] });
const draftB = (entry) => ({ id: 'rdo-b', projectId: 'p-b', date: '2026-11-13', description: '', entries: [{ employeeId: 'e-1', employeeName: 'João', attendanceStatus: 'present', regular: 4, ...entry }] });

test('janela de horario: normal, virada da noite e sem horario', () => {
  const { RDO } = load();
  assert.deepEqual({ ...RDO.entryWindow({ start: '07:00', end: '12:00' }) }, { from: 420, to: 720 });
  assert.deepEqual({ ...RDO.entryWindow({ start: '22:00', end: '06:00' }) }, { from: 1320, to: 1800 });
  assert.equal(RDO.entryWindow({ start: '', end: '12:00' }), null);
  assert.equal(RDO.entryWindow({ start: '07:00', end: '12:00', attendanceStatus: 'absent' }), null);
});

test('manha numa obra e tarde na outra: permitido', () => {
  const { RDO, state } = load();
  state.rdos = [rdoA({ start: '07:00', end: '12:00' })];
  assert.equal(RDO.allocationConflicts('2026-11-13', 'rdo-b', draftB({ start: '13:00', end: '17:00' }).entries).length, 0);
  // encostar nao e sobrepor
  assert.equal(RDO.allocationConflicts('2026-11-13', 'rdo-b', draftB({ start: '12:00', end: '17:00' }).entries).length, 0);
});

test('horarios sobrepostos: bloqueia e diz o horario do outro RDO', async () => {
  const { RDO, state } = load();
  state.rdos = [rdoA({ start: '07:00', end: '12:00' })];
  const conflicts = RDO.allocationConflicts('2026-11-13', 'rdo-b', draftB({ start: '11:00', end: '15:00' }).entries);
  assert.equal(conflicts.length, 1);
  await assert.rejects(() => RDO.save(draftB({ start: '11:00', end: '15:00' }), 'Rascunho'), /das 07:00 às 12:00[\s\S]*não podem se sobrepor/);
});

test('folga, falta ou outro RDO sem horario ocupam o dia inteiro', () => {
  const { RDO, state } = load();
  state.rdos = [rdoA({ start: '', end: '' })];
  assert.equal(RDO.allocationConflicts('2026-11-13', 'rdo-b', draftB({ start: '13:00', end: '17:00' }).entries).length, 1);
  state.rdos = [rdoA({ start: '', end: '', attendanceStatus: 'absent' })];
  assert.match(RDO.allocationConflicts('2026-11-13', 'rdo-b', draftB({ start: '13:00', end: '17:00' }).entries)[0].detail, /falta/);
  state.rdos = [];
  state.workforceStatus = [{ id: 'f', date: '2026-11-13', employeeId: 'e-1', status: 'day_off' }];
  assert.match(RDO.allocationConflicts('2026-11-13', 'rdo-b', draftB({ start: '13:00', end: '17:00' }).entries)[0].detail, /folga/);
});

test('falta neste RDO com o colaborador presente em outro: bloqueia', () => {
  const { RDO, state } = load();
  state.rdos = [rdoA({ start: '07:00', end: '12:00' })];
  assert.equal(RDO.allocationConflicts('2026-11-13', 'rdo-b', draftB({ attendanceStatus: 'absent', start: '', end: '' }).entries).length, 1);
});

test('checagem no servidor (organizacao inteira) tambem usa o horario', async () => {
  const ok = load({ remote: [{ employeeId: 'e-1', situation: 'Outro RDO', start: '07:00', end: '12:00', regular: 5 }] });
  assert.equal((await ok.RDO.remoteAllocationConflicts(draftB({ start: '13:00', end: '17:00' }))).length, 0);
  assert.equal((await ok.RDO.remoteAllocationConflicts(draftB({ start: '08:00', end: '09:00' }))).length, 1);
});

test('horas normais do dia sao um limite so', () => {
  const { RDO } = load();
  const used = RDO.regularUsedIn([{ situation: 'Outro RDO', regular: 5 }, { situation: 'Folga', regular: 0 }]);
  assert.equal(used, 5);
  const hours = RDO.workedHours('13:00', '18:00', 0, Math.max(0, 8 - used), '2026-11-13');
  assert.equal(hours.regular, 3);
  assert.equal(hours.overtime50, 2);
});

test('cloud: RPC nova com recuo para a antiga', () => {
  assert.match(cloudSrc, /clique_obras_rdo_occupied_slots_v4516/);
  assert.match(cloudSrc, /const ids=await occupiedRdoEmployees\(date,excludeRdoId\);/);
});

test('banco: gatilho compara horario e a RPC nova devolve horario sem projeto', () => {
  assert.match(sql, /create or replace function clique_obras_private\.validate_rdo_workforce_reservation\(\)/);
  assert.match(sql, /create or replace function clique_obras_private\.rdo_entry_window_v4516\(/);
  assert.match(sql, /create or replace function public\.clique_obras_rdo_occupied_slots_v4516\(/);
  assert.match(sql, /returns table\(employee_id text, situation text, start_time text, end_time text, regular_hours numeric\)/);
  assert.match(sql, /__day_off__/);
  assert.match(sql, /pg_advisory_xact_lock/);
});
