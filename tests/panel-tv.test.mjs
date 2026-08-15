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
assert.match(html,/css\/panel-tv\.css\?v=3\.0\.8\.1/);
assert.match(html,/modules\/dashboard\/panel-tv\.js\?v=3\.0\.8\.1/);
assert.match(app,/DashboardPanel\.enter\(\)/);
assert.match(dashboard,/DashboardPanel\.render/);
assert.match(panel,/slideNames:\['Visão geral','Situação das obras','Medições e alertas'\]/);
assert.match(panel,/25000/);
assert.match(panel,/120000/);
assert.match(panel,/requestFullscreen/);
assert.match(panel,/wakeLock/);
assert.doesNotMatch(panel,/State\.setSetting|DB\.(?:put|add|remove|clear)|Biz\.[A-Za-z]+\s*=/);
assert.match(css,/body\.tv-mode #sidebar/);
assert.match(css,/body\.tv-mode #content\{padding:0\}/);
assert.match(css,/overflow:hidden/);

const context={
  State:{settings:{companyName:'DGA Energia'},selectedProjectIds:()=>[]},
  Cloud:{active:()=>false},
  U:{
    esc:value=>String(value??''),safeImageSrc:()=>'',projLabel:project=>`${project.proposal} | ${project.name}`,
    money:value=>`R$ ${Number(value||0).toFixed(2)}`,pct:value=>value==null?'—':`${Number(value).toFixed(1)}%`
  },
  setInterval,clearInterval,setTimeout,clearTimeout,console
};
vm.createContext(context);
vm.runInContext(`${panel}\nglobalThis.TestPanel=DashboardPanel;`,context);
const project={id:'p1',proposal:'798',name:'Obra teste',client:'Cliente',status:'Em andamento'};
const stats={budgetTotal:1000,spent:400,projected:100,balance:500,marginCurrent:20,consumed:40,health:100,light:'green'};
const rendered=context.TestPanel.render({
  projects:[project],active:[project],stats:[{p:project,s:stats}],revenue:2000,measured:700,invoiced:200,
  approved:300,awaitingApproval:200,budgetTotal:1000,spent:400,projected:100,balance:500,
  marginCurrent:20,profit:1500,critical:[],next7:100,fut:{today:[],d7:[],d15:[],d30:[]}
});
assert.match(rendered,/DGA Energia/);
assert.match(rendered,/798 \| Obra teste/);
assert.equal((rendered.match(/data-tv-slide="/g)||[]).length,3);

console.log('TV panel tests passed');
