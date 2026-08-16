import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../modules/relatorios/relatorios.js',import.meta.url),'utf8');
const context={
  Views:{},
  State:{
    projects:[{id:'p2',proposal:'816',name:'Segunda obra'},{id:'p1',proposal:'798',name:'Primeira obra'}],
    crew:[{id:'e1',name:'Ana',registration:'010',internalRole:'Eletricista'}],
    rdos:[
      {id:'r2',number:'RDO-2',projectId:'p2',date:'2026-08-16',status:'Aprovado',isHoliday:false,entries:[{employeeId:'e1',employeeName:'Ana',start:'08:00',end:'12:00',breakMinutes:0,regular:0,overtime50:0,overtime100:4,nightHours:0}]},
      {id:'r1',number:'RDO-1',projectId:'p1',date:'2026-08-15',status:'Rascunho',isHoliday:false,entries:[{employeeId:'e1',employeeName:'Ana',start:'08:00',end:'13:00',breakMinutes:30,regular:0,overtime50:4.5,overtime100:0,nightHours:0}]}
    ]
  },
  RDO:{displayRoleFor:()=> 'Eletricista'},
  U:{projLabel:project=>`${project.proposal} | ${project.name}`},
  console
};
vm.createContext(context);
vm.runInContext(source,context);

const rows=context.Views.relatorios.allocationHistoryRows();
assert.equal(rows.length,2);
assert.equal(rows[0].projectId,'p1');
assert.equal(rows[0].date,'2026-08-15');
assert.equal(rows[0].start,'08:00');
assert.equal(rows[0].end,'13:00');
assert.equal(rows[0].breakMinutes,30);
assert.equal(context.Views.relatorios.allocationHistoryRows({projectId:'p2',status:'Aprovado'}).length,1);
assert.equal(context.Views.relatorios.allocationHistoryRows({dateFrom:'2026-08-16'}).length,1);

console.log('Allocation history report tests passed');
