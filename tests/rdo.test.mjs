import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../modules/rdo/rdo.js", import.meta.url), "utf8");
const state = {
  projects:[
    {id:"p-hh",proposal:"798",name:"Caramuru",type:"HH"},
    {id:"p-obra",proposal:"815-USF",name:"Unidade",type:"Obra"}
  ],
  crew:[
    {id:"e-1",name:"João",internalRole:"Instrumentista",active:true},
    {id:"e-2",name:"Maria",internalRole:"",active:true}
  ],
  laborRates:[
    {
      id:"base:e-1",projectId:"__base__",employeeId:"e-1",isBaseCost:true,
      costRegular:60,cost50:90,cost100:120,saleRegular:0,sale50:0,sale100:0,active:true
    },
    {
      id:"p-hh:e-1",projectId:"p-hh",employeeId:"e-1",commercialRole:"Técnico em Elétrica",
      costRegular:5,cost50:7.5,cost100:10,saleRegular:120,sale50:180,sale100:240,active:true
    }
  ],
  measurements:[],
  rdos:[],
  settings:{rdoDailyHours:8.8,rdoShiftStart:"07:30",rdoShiftEnd:"17:18",rdoShiftBreakMinutes:60},
  reload:async()=>{}
};
const context = {
  State:state,
  Views:{},
  Cloud:{active:()=>false},
  U:{
    projLabel:p=>`${p.proposal} | ${p.name}`,
    isoDate:()=>"",
    num:value=>Number(value)||0,
    norm:value=>String(value).toLowerCase(),
    esc:value=>String(value),
    initials:()=>"CO",
    id:()=>"id",
    pct:value=>`${value}%`,
    money:value=>String(value),
    durationMinutes:value=>`${String(Math.floor((Number(value)||0)/60)).padStart(2,'0')}:${String((Number(value)||0)%60).padStart(2,'0')}`
  },
  UI:{},
  DB:{put:async()=>{}},
  App:{},
  console
};
vm.createContext(context);
vm.runInContext(`${source}\nglobalThis.__RDO = RDO;`, context);
const RDO = context.__RDO;

assert.deepEqual(
  JSON.parse(JSON.stringify(RDO.workedHours("07:30","17:30",60))),
  {total:9,regular:8.8,overtime50:0.2,overtime100:0}
);
assert.deepEqual(
  JSON.parse(JSON.stringify(RDO.workedHours("07:30","17:18",60))),
  {total:8.8,regular:8.8,overtime50:0,overtime100:0}
);

const result = RDO.calculate({
  projectId:"p-hh",
  entries:[{employeeId:"e-1",regular:8,overtime50:1,overtime100:0}]
});
assert.equal(result.hours,9);
assert.equal(result.costTotal,570);
assert.equal(result.saleTotal,1140);
assert.equal(result.missingRates.length,0);
assert.equal(RDO.rateFor("p-hh","e-1").costRegular,60);
assert.equal(RDO.displayRoleFor("p-hh",{employeeId:"e-1"}),"Técnico em Elétrica");
assert.deepEqual(JSON.parse(JSON.stringify(RDO.hhConfigurationIssues("p-hh",[{employeeId:"e-1"}]))),[]);

state.laborRates[1].roleDisplayMode="internal";
assert.equal(RDO.displayRoleFor("p-hh",{employeeId:"e-1"}),"Instrumentista");
state.laborRates[1].roleDisplayMode="client";

const missing = RDO.calculate({
  projectId:"p-hh",
  entries:[{employeeId:"not-configured",regular:8,overtime50:0,overtime100:0}]
});
assert.equal(missing.missingRates.length,1);
assert.equal(missing.costTotal,0);
assert.equal(missing.saleTotal,0);
assert.match(RDO.hhConfigurationIssues("p-hh",[{employeeId:"not-configured",employeeName:"Sem cadastro"}])[0].missing.join(','),/custo/);

const operational = RDO.calculate({
  projectId:"p-obra",
  entries:[{employeeId:"e-2",regular:8,overtime50:0,overtime100:0}]
});
assert.equal(operational.missingRates.length,0);
assert.equal(operational.costTotal,0);
assert.equal(operational.saleTotal,0);
assert.deepEqual(JSON.parse(JSON.stringify(RDO.hhConfigurationIssues("p-obra",[{employeeId:"e-2"}]))),[]);

state.laborRates[1].active=false;
assert.equal(RDO.rateFor("p-hh","e-1"),null);
state.laborRates[1].active=true;

assert.doesNotThrow(()=>RDO.validateAttachmentFile({
  name:"campo.jpg",type:"image/jpeg",size:1024
}));
assert.throws(()=>RDO.validateAttachmentFile({
  name:"campo.svg",type:"image/svg+xml",size:1024
}),/JPG/);
assert.throws(()=>RDO.validateAttachmentFile({
  name:"grande.jpg",type:"image/jpeg",size:9*1024*1024
}),/8 MB/);

assert.equal(RDO.documentNumber({projectId:'p-hh',date:'2026-08-14'}),'798-14-08');
assert.deepEqual(
  JSON.parse(JSON.stringify(RDO.auditTrail({auditTrail:[{action:'edited',actorName:'Maurício',at:'2026-08-14T22:10:00Z'}]}))),
  [{action:'edited',actorName:'Maurício',at:'2026-08-14T22:10:00Z'}]
);

await assert.doesNotReject(()=>RDO.save({id:'draft-1',projectId:'p-obra',date:'2026-08-15',description:'',entries:[]},'Rascunho'));
await assert.rejects(()=>RDO.save({id:'send-1',projectId:'p-obra',date:'2026-08-15',description:'',entries:[]},'Enviado'),/Descreva o serviço/);

console.log("RDO calculation tests passed");
