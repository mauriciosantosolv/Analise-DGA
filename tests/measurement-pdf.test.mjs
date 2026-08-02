import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync(new URL("../modules/medicoes/medicoes.js",import.meta.url),"utf8");
const State={
  measurements:[{id:"m1",projectId:"p1",source:"rdo-hh",rdoIds:["r1"]}],
  rdos:[{id:"r1",number:"RDO-1",date:"2026-08-01",entries:[{
    employeeId:"e1",employeeName:"João",employeeRegistration:"MAT-10",internalRole:"Instrumentista",
    start:"07:30",end:"18:18",breakMinutes:60,regular:8.8,overtime50:1,overtime100:0
  }]}],
  rdoFinancial:[{id:"r1",rdoId:"r1",rows:[{
    employeeId:"e1",commercialRole:"Técnico em Elétrica",sale:1234.5
  }]}],
  crew:[{id:"e1",name:"João",registration:"MAT-10",internalRole:"Instrumentista"}],
  projects:[],filters:{},settings:{}
};
const context={
  State,Views:{},
  RDO:{crewMembers:()=>State.crew},
  U:{norm:value=>String(value||"").toLowerCase()},
  Cloud:{active:()=>false},UI:{},DB:{},App:{},Biz:{},console
};
vm.createContext(context);
vm.runInContext(source,context);

const rows=context.Views.medicoes.measurementRows(State.measurements[0]);
assert.equal(rows.length,1);
assert.equal(rows[0].registration,"MAT-10");
assert.equal(rows[0].role,"Técnico em Elétrica");
assert.equal(rows[0].hours,9.8);
assert.equal(rows[0].value,1234.5);

console.log("Measurement PDF rows tests passed");
