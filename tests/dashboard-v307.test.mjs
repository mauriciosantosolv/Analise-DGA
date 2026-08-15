import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const dashboard=read('modules/dashboard/dashboard.js');
const charts=read('modules/dashboard/charts.js');
const costs=read('modules/custos/custos.js');
const planning=read('modules/planejamento/planejamento.js');
const app=read('js/app.js');

assert(dashboard.includes("kpi('Saldo Orçado'"));
assert(dashboard.includes("Previsto inicial:"));
assert(charts.includes('projectFilterForm()'));
assert(charts.includes('projetos selecionados'));
assert(charts.includes('Saldo Orçado'));
assert(charts.includes('Composição calculada pela base de incidência'));
assert(charts.includes('Biz.baseRateForCategory'));
assert(!charts.includes('Saldo vs Orçamento'));
assert(costs.includes('State.selectedProjectIds()'));
assert(costs.includes('projectedInitial'));
assert(planning.includes('Histórico do valor projetado'));
assert(planning.includes('Previsto inicial'));
assert(app.includes("State.settings.tickerMetric==='profit'"));

console.log('Dashboard v3.0.8 tests passed');
