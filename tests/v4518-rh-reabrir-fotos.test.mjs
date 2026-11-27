// v4.5.18 - RH do colaborador (integracoes, ASO, EPIs, ocorrencias), reabertura
// de RDO aprovado nao medido e setas no visualizador de fotos do RDO.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const hrSource = read('modules/rdo/colaboradores-rh.js');
const rdoSource = read('modules/rdo/rdo.js');
const cloudSource = read('database/cloud.js');
const sql = read('supabase/ATUALIZACAO-v4.5.18-REABRIR-RDO.sql');
const index = read('index.html');

function loadHR(state = {}) {
  const context = {
    U: {
      isoDate: () => '2026-11-27',
      id: (() => { let n = 0; return () => `id${++n}`; })(),
      esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
      date: value => String(value || '').split('-').reverse().join('/')
    },
    State: { clients: [], projects: [], ...state }
  };
  vm.runInNewContext(`${hrSource}\nthis.CrewHR=CrewHR;`, context);
  return context.CrewHR;
}

test('dados novos ficam no proprio colaborador e sao limpos ao gravar', () => {
  const HR = loadHR();
  const clean = HR.serialize({
    clientIntegrations: [{ id: 'a', clientId: 'c1', clientName: 'Braskem', onboardingDate: '2026-01-10', renewalDate: '2027-01-10' }, { clientId: 'c1' }],
    asos: [{ id: 'x', type: 'Periódico', examDate: '2026-02-01', expiryDate: '2027-02-01', result: 'Apto' }, { examDate: 'lixo' }],
    ppe: [{ id: 'p', item: 'Capacete', ca: '12345', quantity: '2', receivedDate: '2026-03-01' }, { item: '', receivedDate: '2026-03-01' }],
    occurrences: [{ id: 'o', date: '2026-04-01', type: 'Falta', description: 'x' }, { date: '' }],
    name: 'nao deve sair daqui'
  });
  assert.deepEqual(Array.from(Object.keys(clean)).sort(), ['asos', 'clientIntegrations', 'medicalLeaves', 'occurrences', 'ppe']);
  assert.equal(clean.clientIntegrations.length, 1);
  assert.equal(clean.asos.length, 1);
  assert.equal(clean.ppe.length, 1);
  assert.equal(clean.ppe[0].quantity, 2);
  assert.equal(clean.occurrences.length, 1);
});

test('vencimentos: vencido, vence em ate 30 dias, em dia e substituido', () => {
  const HR = loadHR();
  assert.equal(HR.status('2026-11-20', { today: '2026-11-27' }).level, 'expired');
  assert.equal(HR.status('2026-11-27', { today: '2026-11-27' }).label, 'Vence hoje');
  assert.equal(HR.status('2026-12-27', { today: '2026-11-27' }).level, 'soon');
  assert.equal(HR.status('2026-12-28', { today: '2026-11-27' }).level, 'ok');
  assert.equal(HR.status('', { today: '2026-11-27' }).level, 'none');
  assert.equal(HR.status('2026-11-20', { current: false }).level, 'old');
});

test('alerta so do registro mais recente e so de quem esta na empresa', () => {
  const HR = loadHR({ clients: [{ id: 'c1', name: 'Braskem' }] });
  const employee = {
    name: 'Alan', active: true,
    asos: [
      { id: 'a1', type: 'Admissional', examDate: '2025-10-29', expiryDate: '2026-10-29', result: 'Apto' },
      { id: 'a2', type: 'Periódico', examDate: '2026-10-20', expiryDate: '2026-12-10', result: 'Apto' }
    ],
    clientIntegrations: [
      { id: 'i1', clientId: 'c1', onboardingDate: '2025-11-01', renewalDate: '2026-11-01' },
      { id: 'i2', clientId: 'c1', onboardingDate: '2026-11-02', renewalDate: '2027-11-02' },
      { id: 'i3', clientId: 'c1', unit: 'Camaçari', onboardingDate: '2025-11-15', renewalDate: '2026-11-15' }
    ],
    ppe: [
      { id: 'p1', item: 'Capacete', receivedDate: '2025-06-01', renewalDate: '2026-06-01' },
      { id: 'p2', item: 'capacete ', receivedDate: '2026-06-01', renewalDate: '2027-06-01' },
      { id: 'p3', item: 'Botina', receivedDate: '2026-01-01', renewalDate: '2026-12-01' }
    ]
  };
  const alerts = HR.alerts(employee, '2026-11-27');
  assert.deepEqual(Array.from(alerts, a => `${a.kind}:${a.level}`), ['integration:expired', 'ppe:soon', 'aso:soon']);
  assert.match(alerts[0].label, /Braskem · Camaçari/);
  assert.equal(HR.alerts({ ...employee, active: false }, '2026-11-27').length, 0, 'inativo nao gera alerta');
  assert.equal(HR.alerts({ ...employee, active: false, inactiveSince: '2026-12-15' }, '2026-11-27').length, 3, 'desligamento futuro ainda gera');
  assert.equal(HR.alerts({ ...employee, asos: [{ id: 'd', type: 'Demissional', examDate: '2026-11-01', result: 'Apto' }], clientIntegrations: [], ppe: [] }, '2026-11-27').length, 0);
});

test('tela: abas no cadastro, sem textos explicativos, mesma gravacao', () => {
  const form = rdoSource.slice(rdoSource.indexOf("  form(id='',tab='contrato'){"), rdoSource.indexOf('  rolesForm(){'));
  for (const tab of ['Contrato', 'RH', 'EPIs', 'Ocorrências']) assert.ok(form.includes(`'${tab}'`), `aba ${tab}`);
  for (const removed of ['JPG, PNG ou WebP', 'Cadastre novas funções', 'Obrigatório somente', 'Antes dela o colaborador', 'Inativo = não trabalha', 'Com a data, os dias anteriores'])
    assert.ok(!form.includes(removed), `texto removido: ${removed}`);
  for (const id of ['crew-registration', 'crew-name', 'crew-role', 'crew-hourly-cost', 'crew-admission', 'crew-active', 'crew-inactive-since', 'crew-vacation-box'])
    assert.ok(form.includes(`id="${id}"`), `campo ${id} mantido`);
  assert.ok(form.includes('...employee,'), 'grava sobre o registro existente (campos antigos preservados)');
  assert.ok(form.includes('...(hr?CrewHR.serialize(hr):{})'));
  assert.match(index, /<script src="modules\/rdo\/colaboradores-rh\.js\?v=\d+\.\d+\.\d+"><\/script>/);
  assert.ok(index.indexOf('modules/rdo/rdo.js') < index.indexOf('modules/rdo/colaboradores-rh.js'));
  assert.ok(hrSource.includes('Pdf.deliver('), 'PDF dos EPIs usa a mesma entrega do PDF do RDO');
});

test('reabrir RDO: so aprovado, nao medido, por admin, pelo banco', () => {
  assert.ok(sql.includes("raise exception 'Somente proprietário ou administrador pode reabrir RDO aprovado.'"));
  assert.ok(sql.includes("rdo_measurement_links"));
  assert.ok(sql.includes("measurement.data->'rdoIds' ? target_rdo_id"));
  assert.ok(sql.includes("'status','Devolvido'"));
  assert.ok(sql.includes('restore_planning_v402'), 'devolve o abatimento ao planejamento');
  assert.ok(sql.includes("current_setting('clique_obras.admin_rdo_reopen',true)=old.record_id"));
  assert.ok(/exatamente uma vez\. Nada foi alterado/.test(sql), 'troca de trecho exato, como na v4.5.17');
  assert.ok(sql.includes('revoke all on function public.clique_obras_reopen_rdo(uuid,text,text) from public, anon;'));
  assert.ok(!/delete from public\.rdo_attachments/.test(sql), 'fotos e anexos nao sao apagados');
  assert.ok(cloudSource.includes("'/rest/v1/rpc/clique_obras_reopen_rdo'"));
  assert.ok(rdoSource.includes('canReopen(rdo){'));
  assert.ok(rdoSource.includes("this.canReopen(rdo)?`<button class=\"btn btn-ghost\" onclick=\"RDO.reopen("));
});

test('fotos do RDO: setas, teclado e deslizar', () => {
  const viewer = rdoSource.slice(rdoSource.indexOf('  async previewAttachment('), rdoSource.indexOf('  async downloadAttachment('));
  assert.ok(viewer.includes('rdo-photo-prev') && viewer.includes('rdo-photo-next'));
  assert.ok(viewer.includes("event.key==='ArrowLeft'") && viewer.includes("event.key==='ArrowRight'"));
  assert.ok(viewer.includes('touchend'));
  assert.ok(viewer.includes('this.downloadAttachment(rdoId,photos[index].id)'), 'Baixar baixa a foto que esta na tela');
});
