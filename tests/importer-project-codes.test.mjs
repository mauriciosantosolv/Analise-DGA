import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const formatSource=fs.readFileSync(new URL("../utils/format.js",import.meta.url),"utf8");
const importerSource=fs.readFileSync(new URL("../js/importer.js",import.meta.url),"utf8");
const context={
  State:{settings:{},projects:[],categories:[],purchases:[]},
  Biz:{},DB:{},UI:{},Views:{},App:{},console
};
vm.createContext(context);
vm.runInContext(`${formatSource}\n${importerSource}\nglobalThis.__U=U;globalThis.__Importer=Importer;`,context);

const {__U:U,__Importer:Importer}=context;
assert.equal(U.projectCodeKey("815 - usf"),"815-USF");
assert.notEqual(U.projectCodeKey("815-USF"),U.projectCodeKey("815-URD"));
assert.deepEqual(
  JSON.parse(JSON.stringify(Importer.projectParts("815-USF Unidade São Francisco"))),
  {proposal:"815-USF",name:"Unidade São Francisco"}
);
assert.deepEqual(
  JSON.parse(JSON.stringify(Importer.projectParts("815.02-A Reforma"))),
  {proposal:"815.02-A",name:"Reforma"}
);
assert.deepEqual(
  JSON.parse(JSON.stringify(Importer.projectParts("649 Caramuru São Simão"))),
  {proposal:"649",name:"Caramuru São Simão"}
);
assert.deepEqual(
  JSON.parse(JSON.stringify(Importer.projectParts("649 - Caramuru São Simão"))),
  {proposal:"649",name:"Caramuru São Simão"}
);

console.log("Importer project-code tests passed");
