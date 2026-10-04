/**
 * v4.2.21 — o seletor de projeto do formulário de RDO mostra só o que está
 * "Em andamento".
 *
 * Recorta o TEXTO de RDO.formProjects e roda num vm isolado (mesma técnica de
 * crew-inactive-date.test.mjs), com um allowedProjects() falso — assim o teste
 * prova o filtro sem carregar o rdo.js inteiro.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../modules/rdo/rdo.js", import.meta.url), "utf8");

const start = source.indexOf("  formProjects(currentProjectId=''){");
assert.ok(start > 0, "RDO.formProjects não encontrada em rdo.js");
const end = source.indexOf("\n  },\n", start) + "\n  },".length;
const functionText = source.slice(start, end);

const State = {
  projects: [
    { id: "1", status: "Em andamento" },
    { id: "2", status: "Concluído" },
    { id: "3", status: "A executar" },
    { id: "4", status: "Paralisado" }
  ]
};
const allowed = [
  { id: "1", label: "798 | PROJETO AURORA" },
  { id: "2", label: "778 | PORTAS CAMARA FRIA" },
  { id: "3", label: "928 | INSTALACAO ELETRICA FORNO REFEITORIO" },
  { id: "4", label: "911 | ADEQUACAO CAMINHAO" }
];

const context = { State, RDO: null, console };
vm.createContext(context);
vm.runInContext(
  `RDO={ allowedProjects(){ return ${JSON.stringify(allowed)}; }, ${functionText} };`,
  context
);
const RDO = context.RDO;

/* 1 — RDO novo: só o projeto "Em andamento" aparece */
assert.equal(RDO.formProjects("").map(p => p.id).join(","), "1",
  "Concluído, A executar e Paralisado não podem aparecer no RDO novo");

/* 2 — editando um RDO antigo, o projeto dele continua na lista, com o status */
const editing = RDO.formProjects("2");
assert.equal(editing.map(p => p.id).join(","), "1,2",
  "o projeto do RDO em edição precisa continuar selecionável");
assert.equal(editing.find(p => p.id === "2").label, "778 | PORTAS CAMARA FRIA · Concluído");
assert.equal(editing.find(p => p.id === "1").label, "798 | PROJETO AURORA",
  "projeto em andamento não ganha sufixo");

/* 3 — allowedProjects continua intacta (permissão, rótulo e listagem) */
assert.equal(RDO.allowedProjects().length, 4);

/* 4 — perfil Apontador não enxerga o store projects: a lista fica como o
       administrador liberou, sem filtro nenhum */
State.projects = [];
assert.equal(RDO.formProjects("").map(p => p.id).join(","), "1,2,3,4",
  "sem status visível o filtro não pode esvaziar a lista do Apontador");

console.log("RDO project filter tests passed");
