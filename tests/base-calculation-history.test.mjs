import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../modules/custos/custos.js", import.meta.url), "utf8");
const context = {
  State:{
    settings:{
      baseCalc:{tax:30,admin:4,fees:1,other:0},
      baseCalcHistory:[
        {effectiveFrom:"2026-01-01",rates:{tax:10,admin:2,fees:0,other:0}},
        {effectiveFrom:"2026-02-01",rates:{tax:20,admin:4,fees:2,other:0}}
      ]
    },
    categories:[],projects:[],budgets:[],purchases:[],planning:[],measurements:[],filters:{}
  },
  U:{norm:value=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()},
  console
};

vm.createContext(context);
vm.runInContext(`${source}\nglobalThis.__Biz = Biz;`,context);
const Biz=context.__Biz;

const historical=Biz.periodBaseRates("2026-01-01","2026-02-28");
assert.ok(Math.abs(historical.tax-((31*10+28*20)/59))<0.000001);
assert.ok(Math.abs(historical.admin-((31*2+28*4)/59))<0.000001);

assert.equal(Biz.baseRatesForProject({status:"Em andamento"}).tax,30);
assert.equal(Biz.baseRatesForProject({
  status:"Concluído",
  baseCalcSnapshot:{rates:{tax:12,admin:3,fees:1,other:0}}
}).tax,12);

assert.equal(Biz.baseRatesForProject({
  status:"Concluído",start:"2026-01-01",realEnd:"2026-01-31"
}).tax,10);

context.State.categories.push(
  {id:"h",name:"Hospedagem"},
  {id:"m",name:"Compras de Materiais"},
  {id:"a",name:"Alimentação"},
  {id:"l",name:"Mão de Obra"},
  {id:"t",name:"Imposto"},
  {id:"c",name:"Custos Administrativos"}
);
assert.deepEqual(
  JSON.parse(JSON.stringify(Biz.categoryStats([]).map(category=>category.categoryKey))),
  ["custo administrativo","impostos","mao de obra","compras de material","alimentacao","hospedagem"]
);

console.log("Historical base calculation tests passed");
