import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../modules/rdo/rdo.js", import.meta.url), "utf8");
const state = {
  projects:[{id:"p-hh",proposal:"798",name:"Caramuru",type:"HH"}],
  crew:[{id:"e-1",name:"João",internalRole:"Instrumentista",active:true}],
  laborRates:[{
    id:"p-hh:e-1",projectId:"p-hh",employeeId:"e-1",commercialRole:"Técnico em Elétrica",
    costRegular:60,cost50:90,cost100:120,saleRegular:120,sale50:180,sale100:240,active:true
  }],
  measurements:[],
  rdos:[]
};
const context = {
  State:state,
  Views:{},
  Cloud:{active:()=>false},
  U:{
    projLabel:p=>`${p.proposal} — ${p.name}`,
    isoDate:()=>"",
    num:value=>Number(value)||0,
    norm:value=>String(value).toLowerCase(),
    esc:value=>String(value),
    initials:()=>"CO",
    id:()=>"id",
    pct:value=>`${value}%`,
    money:value=>String(value)
  },
  UI:{},
  DB:{},
  App:{},
  console
};
vm.createContext(context);
vm.runInContext(`${source}\nglobalThis.__RDO = RDO;`, context);
const RDO = context.__RDO;

assert.deepEqual(
  JSON.parse(JSON.stringify(RDO.workedHours("07:30","17:30",60))),
  {total:9,regular:8,overtime50:1,overtime100:0}
);

const result = RDO.calculate({
  projectId:"p-hh",
  entries:[{employeeId:"e-1",regular:8,overtime50:1,overtime100:0}]
});
assert.equal(result.hours,9);
assert.equal(result.costTotal,570);
assert.equal(result.saleTotal,1140);
assert.equal(result.missingRates.length,0);

const missing = RDO.calculate({
  projectId:"p-hh",
  entries:[{employeeId:"not-configured",regular:8,overtime50:0,overtime100:0}]
});
assert.equal(missing.missingRates.length,1);
assert.equal(missing.costTotal,0);
assert.equal(missing.saleTotal,0);

console.log("RDO calculation tests passed");
