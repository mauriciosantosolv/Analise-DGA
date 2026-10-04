import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const html=read('index.html');
const app=read('js/app.js');
const dashboard=read('modules/dashboard/dashboard.js');
const panel=read('modules/dashboard/panel-tv.js');
const css=read('css/panel-tv.css');

assert.match(html,/id="tv-mode-toggle"/);
assert.doesNotMatch(html,/id="tv-mode-toggle"[^>]*\shidden/);
assert.match(html,/meta name="application-version" content="4\.0\.1"/);
assert.match(html,/css\/panel-tv\.css\?v=4\.0\.1/);
assert.match(html,/modules\/rdo\/rdo\.js\?v=4\.0\.1/);
assert.match(html,/modules\/dashboard\/panel-tv\.js\?v=4\.0\.1/);
assert.doesNotMatch(html,/3\.0\.8\.3\.1/);
assert.match(app,/DashboardPanel\.enter\(\)/);
assert.match(dashboard,/DashboardPanel\.render/);
assert.match(dashboard,/projects,purchases,active,stats/);
assert.match(panel,/slideNames:\['Orçado e realizado','Monitoramento de medições','Equipes em campo'\]/);
assert.match(panel,/25000/);
assert.match(panel,/120000/);
assert.match(panel,/requestFullscreen/);
assert.match(panel,/wakeLock/);
assert.match(panel,/id="tv-filter-project"/);
assert.match(panel,/id="tv-suppliers-chart"/);
assert.match(panel,/Últimos lançamentos/);
assert.match(panel,/Data de inclusão/);
assert.match(panel,/Monitoramento de Medições/);
assert.match(panel,/Custo parcial em campo/);
assert.match(panel,/Custo da ociosidade/);
assert.match(panel,/id="tv-field-date"/);
assert.match(panel,/id="tv-field-allocation-chart"/);
assert.match(panel,/class="tv-field-cost-table"/);
assert.doesNotMatch(panel,/id="tv-field-roles-chart"/);
assert.doesNotMatch(panel,/tvFieldRoles/);
assert.doesNotMatch(panel,/type:'doughnut'/);
assert.match(panel,/Faltas e folgas/);
assert.match(panel,/renderSupplierChart/);
assert.doesNotMatch(panel,/Alertas do monitoramento/);
assert.doesNotMatch(panel,/State\.setSetting|DB\.(?:put|add|remove|clear)|Biz\.[A-Za-z]+\s*=/);
assert.match(css,/body\.tv-mode #sidebar/);
assert.match(css,/body\.tv-mode #finance-ticker\{display:flex!important/);
assert.doesNotMatch(css,/body\.tv-mode #sidebar,[^\n]*#finance-ticker/);
assert.match(css,/body\.tv-mode #content\{padding:0\}/);
assert.match(css,/overflow:hidden/);
assert.match(css,/\.tv-latest-wrap\{[^}]*overflow-y:auto/);
assert.match(css,/\.tv-supplier-chart\{[^}]*min-height:0/);
assert.match(css,/\.tv-field-grid/);

const context={
  State:{settings:{companyName:'DGA Energia'},filters:{project:'',projects:[],client:'',category:'',status:'',type:''},projects:[],crew:[],rdos:[],laborRates:[],workforceStatus:[],selectedProjectIds:()=>[]},
  Cloud:{active:()=>false},
  U:{
    esc:value=>String(value??''),safeImageSrc:()=>'',projLabel:project=>`${project.proposal} | ${project.name}`,
    money:value=>`R$ ${Number(value||0).toFixed(2)}`,money2:value=>`R$ ${Number(value||0).toFixed(2)}`,
    pct:value=>value==null?'—':`${Number(value).toFixed(1)}%`,date:value=>String(value||''),isoDate:()=> '2026-08-15'
  },
  RDO:{
    standardDailyHours:()=>8.8,
    rdoRateFor:(projectId,employeeId)=>({costRegular:employeeId==='e1'?10:20,cost50:employeeId==='e1'?15:30,cost100:employeeId==='e1'?20:40}),
    baseCostFor:employeeId=>({costRegular:employeeId==='e1'?10:20}),
    entryTotals:(entry,rate)=>({cost:(Number(entry.regular)||0)*rate.costRegular+(Number(entry.overtime50)||0)*rate.cost50+(Number(entry.overtime100)||0)*rate.cost100})
  },
  setInterval,clearInterval,setTimeout,clearTimeout,console
};
vm.createContext(context);
vm.runInContext(`${panel}\nglobalThis.TestPanel=DashboardPanel;`,context);
const project={id:'p1',proposal:'798',name:'Obra teste',client:'Cliente',status:'Em andamento'};
context.State.projects=[project];
context.State.crew=[
  {id:'e1',name:'Ana Alocada',internalRole:'Eletricista',active:true},
  {id:'e2',name:'Bruno Ocioso',internalRole:'Ajudante',active:true},
  {id:'e3',name:'Carla Ausente',internalRole:'Técnica',active:true},
  {id:'e4',name:'Daniela de Folga',internalRole:'Montadora',active:true}
];
context.State.workforceStatus=[{id:'day-off:2026-08-15:e4',date:'2026-08-15',employeeId:'e4',employeeName:'Daniela de Folga',status:'day_off'}];
context.State.rdos=[{id:'r1',projectId:'p1',date:'2026-08-15',status:'Rascunho',updatedAt:'2026-08-15T10:00:00Z',entries:[
  {employeeId:'e1',regular:8,overtime50:0,overtime100:0,attendanceStatus:'present'},
  {employeeId:'e3',regular:0,overtime50:0,overtime100:0,attendanceStatus:'absent'}
]}];
const stats={budgetTotal:1000,spent:400,projected:100,balance:500,marginCurrent:20,consumed:40,health:100,light:'green'};
const rendered=context.TestPanel.render({
  projects:[project],purchases:[
    {id:'x1',projectId:'p1',supplier:'Fornecedor antigo',category:'Material',value:125,date:'2026-08-14',importedAt:999,sourceType:'omiePayable'},
    {id:'x2',projectId:'p1',supplier:'Fornecedor novo cedo',category:'Material',value:150,date:'2026-08-15',omieInclusionDate:'2026-08-15',omieInclusionTime:'08:30:00',importedAt:999,sourceType:'omiePayable'},
    {id:'x3',projectId:'p1',supplier:'Fornecedor novo tarde',category:'Material',value:175,date:'2026-08-15',omieInclusionDate:'2026-08-15',omieInclusionTime:'16:45:00',importedAt:1,sourceType:'omiePayable'}
  ],active:[project],stats:[{p:project,s:{...stats,measured:700,measuredPct:35}}],revenue:2000,measured:700,invoiced:200,
  approved:300,awaitingApproval:200,budgetTotal:1000,spent:400,projected:100,balance:500,
  marginCurrent:20,profit:1500,critical:[],next7:100,fut:{today:[],d7:[],d15:[],d30:[]}
});
assert.match(rendered,/DGA Energia/);
assert.match(rendered,/798 \| Obra teste/);
assert.match(rendered,/Fornecedor novo tarde/);
assert.match(rendered,/Omie · conta a pagar/);
assert.ok(rendered.indexOf('Fornecedor novo tarde')<rendered.indexOf('Fornecedor novo cedo'),'lançamentos do mesmo dia devem usar info.hInc');
assert.ok(rendered.indexOf('Fornecedor novo cedo')<rendered.indexOf('Fornecedor antigo'),'lançamentos devem ser ordenados pela data efetiva, não pela hora de importação');
assert.equal(context.TestPanel.entryInclusionDate({sourceType:'omiePayable',omieInclusionDate:'2026-08-30',date:'2026-08-30',importedAt:Date.UTC(2026,7,14)}),'2026-08-14');
const field=context.TestPanel.fieldSnapshot();
assert.equal(field.allocated.length,1);
assert.equal(field.absent.length,1);
assert.equal(field.dayOff.length,1);
assert.equal(field.idle.length,1);
assert.equal(field.partialCost,80);
assert.equal(field.idleCost,176);
assert.equal(field.projects[0].name,'798');
assert.match(rendered,/Ana Alocada/);
assert.match(rendered,/Bruno Ocioso/);
assert.match(rendered,/Carla Ausente/);
assert.match(rendered,/Daniela de Folga/);
assert.equal((rendered.match(/data-tv-slide="/g)||[]).length,3);

console.log('TV panel tests passed');
