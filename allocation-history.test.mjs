import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../modules/relatorios/relatorios.js',import.meta.url),'utf8');
const context={
  Views:{},
  State:{
    projects:[{id:'p2',proposal:'816',name:'Segunda obra'},{id:'p1',proposal:'798',name:'Primeira obra'}],
    crew:[
      {id:'e1',name:'Ana',registration:'010',internalRole:'Eletricista'},
      {id:'e2',name:'Bruno',registration:'011',internalRole:'Ajudante'}
    ],
    workforceStatus:[],
    rdos:[
      {id:'r2',number:'RDO-2',projectId:'p2',date:'2026-08-16',status:'Aprovado',isHoliday:false,entries:[{employeeId:'e1',employeeName:'Ana',start:'08:00',end:'12:00',breakMinutes:0,regular:0,overtime50:0,overtime100:4,nightHours:0}]},
      {id:'r1',number:'RDO-1',projectId:'p1',date:'2026-08-15',status:'Rascunho',isHoliday:false,entries:[
        {employeeId:'e1',employeeName:'Ana',start:'08:00',end:'13:00',breakMinutes:30,regular:0,overtime50:4.5,overtime100:0,nightHours:0,attendanceStatus:'present'},
        {employeeId:'e2',employeeName:'Bruno',start:'',end:'',breakMinutes:0,regular:0,overtime50:0,overtime100:0,nightHours:0,attendanceStatus:'absent'}
      ]}
    ]
  },
  RDO:{displayRoleFor:(projectId,entry)=>entry.employeeId==='e2'?'Ajudante':'Eletricista',isAbsent:entry=>entry.attendanceStatus==='absent'},
  U:{projLabel:project=>`${project.proposal} | ${project.name}`},
  console
};
vm.createContext(context);
vm.runInContext(source,context);

const rows=context.Views.relatorios.allocationHistoryRows();
assert.equal(rows.length,3);
assert.equal(rows[0].projectId,'p1');
assert.equal(rows[0].date,'2026-08-15');
assert.equal(rows[0].start,'08:00');
assert.equal(rows[0].end,'13:00');
assert.equal(rows[0].breakMinutes,30);
assert.equal(rows[0].situation,'Alocado');
assert.equal(rows[1].employeeName,'Bruno');
assert.equal(rows[1].situation,'Falta');
assert.equal(context.Views.relatorios.allocationHistoryRows({projectId:'p2',status:'Aprovado'}).length,1);
assert.equal(context.Views.relatorios.allocationHistoryRows({dateFrom:'2026-08-16'}).length,1);

context.State.crew.push(
  {id:'e3',name:'Carla',registration:'012',internalRole:'Técnica',active:true},
  {id:'e4',name:'Diego',registration:'013',internalRole:'Montador',active:true}
);
// v4.2.18 - 15/08/2026 e sabado: o relatorio traz apenas o que foi lancado no
// RDO (Alocado e Falta). Folga e ociosidade so sao apuradas de segunda a sexta.
context.State.workforceStatus=[{id:'day-off:2026-08-15:e3',date:'2026-08-15',employeeId:'e3',employeeName:'Carla',status:'day_off'}];
const sabado=context.Views.relatorios.allocationHistoryRows({dateFrom:'2026-08-15',dateTo:'2026-08-15'});
assert.equal(sabado.length,2);
assert.equal(sabado.every(row=>['Alocado','Falta'].includes(row.situation)),true);
assert.equal(sabado.some(row=>row.situation==='Folga'||row.situation==='Ocioso'),false);

// 17/08/2026 e segunda: folga e ociosidade voltam a ser apuradas.
context.State.workforceStatus=[{id:'day-off:2026-08-17:e3',date:'2026-08-17',employeeId:'e3',employeeName:'Carla',status:'day_off'}];
const complete=context.Views.relatorios.allocationHistoryRows({dateFrom:'2026-08-17',dateTo:'2026-08-17'});
assert.equal(complete.length,4);
const dayOff=complete.find(row=>row.employeeId==='e3');
assert.equal(dayOff.situation,'Folga');
assert.equal(dayOff.projectLabel,'');
assert.equal(dayOff.start,'');
assert.equal(dayOff.regular,0);
const idle=complete.find(row=>row.employeeId==='e4');
assert.equal(idle.situation,'Ocioso');
assert.equal(idle.regular,8.8);
assert.equal(idle.projectLabel,'');

console.log('Allocation history report tests passed');
