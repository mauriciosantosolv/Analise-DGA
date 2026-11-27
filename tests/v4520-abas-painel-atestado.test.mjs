// v4.5.20 - aba com seta para recolher o menu, painel direito recolhivel e
// atestados no Historico de Alocacoes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const hrSource = read('modules/rdo/colaboradores-rh.js');
const reportSource = read('modules/relatorios/relatorios.js');
const appSource = read('js/app.js');
const css = read('css/components.css');
const index = read('index.html');

test('menu: aba com seta presa na borda; ☰ so no celular', () => {
  assert.ok(index.includes('id="nav-collapse-toggle"'));
  assert.ok(index.indexOf('class="brand-row"') < index.indexOf('id="nav-collapse-toggle"'));
  assert.match(css, /@media\(min-width:861px\)\{\s*#menu-toggle\{display:none\}/);
  assert.match(css, /#app\.nav-collapsed \.nav-edge-toggle\{top:12px;right:-27px/);
  assert.ok(appSource.includes("navEdge.onclick=()=>{"));
});

test('painel direito: recolhe para faixa com contadores, sem animar o grid', () => {
  assert.ok(index.includes('id="rightbar-toggle"') && index.includes('id="rightbar-rail"') && index.includes('class="rightbar-body"'));
  assert.match(css, /#content-wrap\.rb-collapsed\{grid-template-columns:minmax\(0,1fr\) 52px\}/);
  assert.ok(!/#content-wrap\.rb-collapsed\{[^}]*transition/.test(css));
  assert.ok(appSource.includes("rightbarCollapsedKey:'cliqueobras.rightbarCollapsed'"));
  assert.ok(appSource.includes('onclick="App.setRightbarCollapsed(false)"'));
});

const loadHR = () => {
  const context = { U: { isoDate: () => '2026-11-27', esc: v => String(v ?? ''), date: v => v }, State: {} };
  vm.runInNewContext(`${hrSource}\nthis.CrewHR=CrewHR;`, context);
  return context.CrewHR;
};

test('atestado: periodo no colaborador', () => {
  const HR = loadHR();
  const employee = { medicalLeaves: [{ id: 'm1', from: '2026-11-24', to: '2026-11-26' }, { from: '2026-12-02', to: '2026-12-01' }] };
  assert.equal(HR.normalize(employee).medicalLeaves.length, 1, 'periodo invertido e descartado');
  assert.equal(HR.leaveDays({ from: '2026-11-24', to: '2026-11-26' }), 3);
  assert.ok(HR.leaveOn(employee, '2026-11-25'));
  assert.equal(HR.leaveOn(employee, '2026-11-27'), null);
  assert.ok(!HR.OCCURRENCE_TYPES.includes('Atestado médico'), 'atestado saiu das ocorrencias (controle proprio)');
});

test('Historico de Alocacoes: atestado em dia util e falta justificada', () => {
  const HR = loadHR();
  const crew = [
    { id: 'e1', name: 'Ana', active: true, medicalLeaves: [{ id: 'm', from: '2026-11-23', to: '2026-11-29' }] },
    { id: 'e2', name: 'Bia', active: true }
  ];
  const context = {
    U: { projLabel: p => p.name, date: v => v },
    CrewHR: HR,
    RDO: {
      dayType: d => ({ '2026-11-28': 'saturday', '2026-11-29': 'sunday' })[d] || 'weekday',
      isAbsent: e => e.attendanceStatus === 'absent',
      displayRoleFor: () => '',
      onVacation: () => false,
      crewActiveOn: e => e.active !== false
    },
    State: {
      crew, projects: [{ id: 'p1', name: 'Obra' }], workforceStatus: [],
      rdos: [{ id: 'r1', projectId: 'p1', date: '2026-11-24', status: 'Aprovado', entries: [{ employeeId: 'e1', attendanceStatus: 'absent' }, { employeeId: 'e2' }] }]
    },
    Views: {}
  };
  vm.runInNewContext(`${reportSource}\nthis.R=Views.relatorios;`, context);
  const rows = context.R.allocationHistoryRows({ dateFrom: '2026-11-23', dateTo: '2026-11-29' });
  const ana = Array.from(rows).filter(r => r.employeeId === 'e1').map(r => `${r.date}:${r.situation}`);
  assert.deepEqual(ana, ['2026-11-23:Atestado', '2026-11-24:Atestado', '2026-11-25:Atestado', '2026-11-26:Atestado', '2026-11-27:Atestado']);
  assert.ok(Array.from(rows).some(r => r.employeeId === 'e2' && r.situation === 'Alocado'));
  assert.ok(!Array.from(rows).some(r => r.employeeId === 'e1' && r.situation === 'Ocioso'), 'atestado nao vira ocioso');
  assert.ok(reportSource.includes("['Falta','Folga','Ocioso','Férias','Atestado'].includes(row.situation)"));
});

test('Medicoes: filtro de obra usa o filtro de projeto ja respeitado pela tela', () => {
  const src = read('modules/medicoes/medicoes.js');
  assert.ok(src.includes('id="md-project-filter"'));
  assert.ok(src.includes("if(projectSelect) State.filters.project=projectSelect.value;"));
  assert.ok(src.includes("if(State.filters.project && String(m.projectId)!==String(State.filters.project)) return false;"));
});
