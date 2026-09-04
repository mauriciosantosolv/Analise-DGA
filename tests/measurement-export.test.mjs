/**
 * v4.2.21 — VALOR/H no relatório de medição + exportação XLSX.
 *
 * Roda medicoes.js num vm isolado com State/RDO/U falsos, do mesmo jeito que
 * measurement-pdf.test.mjs. Cobre as 3 origens do VALOR/H, a forma da planilha
 * e a estrutura nova da tabela do PDF (sem total do dia).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../modules/medicoes/medicoes.js", import.meta.url), "utf8");

const State = {
  measurements: [{ id: "m1", projectId: "p1", source: "rdo-hh", rdoIds: ["r1"], value: 2297.65, ref: "MED-01" }],
  rdos: [{
    id: "r1", number: "RDO-1", date: "2026-08-01", entries: [
      {
        employeeId: "e1", employeeName: "João", employeeRegistration: "MAT-10", internalRole: "Instrumentista",
        start: "07:30", end: "18:18", breakMinutes: 60, regular: 8.8, overtime50: 1, overtime100: 0
      },
      {
        employeeId: "e2", employeeName: "Ana", employeeRegistration: "MAT-11", internalRole: "Eletricista",
        start: "07:30", end: "17:00", breakMinutes: 60, regular: 8, overtime50: 0, overtime100: 0
      }
    ]
  }],
  rdoFinancial: [{
    id: "r1", rdoId: "r1", rows: [
      {
        employeeId: "e1", internalRole: "Instrumentista", commercialRole: "Técnico em Elétrica",
        roleDisplayMode: "client", saleRegular: 75.5, sale50: 113.25, sale100: 151, sale: 1777.65
      },
      // sem saleRegular: RDO aprovado antes do snapshot guardar as taxas
      {
        employeeId: "e2", internalRole: "Eletricista", commercialRole: "Eletricista Montador",
        roleDisplayMode: "client", sale: 520
      }
    ]
  }],
  crew: [
    { id: "e1", name: "João", registration: "MAT-10", internalRole: "Instrumentista" },
    { id: "e2", name: "Ana", registration: "MAT-11", internalRole: "Eletricista" }
  ],
  laborRates: [], projects: [], filters: {}, settings: {}
};

const context = {
  State, Views: {},
  RDO: {
    crewMembers: () => State.crew,
    rateFor: (projectId, employeeId) => (String(employeeId) === "e2" ? { saleRegular: 65 } : null)
  },
  U: {
    norm: value => String(value || "").toLowerCase(),
    date: value => String(value || ""),
    durationMinutes: value => {
      const total = Math.max(0, Math.round(Number(value) || 0));
      return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    }
  },
  Cloud: { active: () => false }, UI: {}, DB: {}, App: {}, Biz: {}, console
};
vm.createContext(context);
vm.runInContext(source, context);
const view = context.Views.medicoes;

/* 1 — VALOR/H: o valor congelado no snapshot financeiro vence */
const rows = view.measurementRows(State.measurements[0]);
assert.equal(rows.length, 2);
const joao = rows.find(row => row.employeeName === "João");
const ana = rows.find(row => row.employeeName === "Ana");
assert.equal(joao.hourRate, 75.5, "deve usar o saleRegular congelado no snapshot do RDO");

/* 2 — sem taxa no snapshot, cai no cadastro de valor HH atual */
assert.equal(ana.hourRate, 65, "deve cair no valor HH do cadastro quando o snapshot é antigo");

/* 3 — sem snapshot e sem cadastro devolve 0, nunca NaN/undefined */
assert.equal(view.employeeHourRate("p1", "e9", null), 0);
assert.equal(view.employeeHourRate("p1", "e9", { saleRegular: "abc" }), 0);
assert.equal(view.employeeHourRate("p1", "e9", { saleRegular: 0 }), 0);

/* 4 — a planilha tem as 14 colunas na ordem pedida e números como número */
const sheet = view.measurementSheetRows(State.measurements[0]);
assert.equal(sheet.length, 2);
assert.equal(
  Object.keys(sheet[0]).join("|"),
  ["Data", "RDO", "Matrícula", "Colaborador", "Função", "Valor/h", "Entrada", "Intervalo",
    "Saída", "Normal", "HE 50%", "HE 100%", "Total", "Valor medido"].join("|")
);
for (const key of ["Valor/h", "Normal", "HE 50%", "HE 100%", "Total", "Valor medido"]) {
  for (const row of sheet) assert.equal(typeof row[key], "number", `${key} precisa sair como número`);
}
const sheetJoao = sheet.find(row => row.Colaborador === "João");
assert.equal(sheetJoao["Valor medido"], 1777.65);
assert.equal(sheetJoao["Valor/h"], 75.5);
assert.equal(sheetJoao.Total, 9.8);
assert.equal(sheetJoao.Intervalo, "01:00");

/* 5 — a tabela do PDF perdeu o total do dia e ganhou a coluna Valor/h */
assert.ok(!/measurement-day-total/.test(source), "a linha de total do dia deve ter saído do PDF");
assert.ok(!/const grouped=/.test(source), "o agrupamento por dia não é mais usado");
assert.match(source, /<th>Função<\/th><th>Valor\/h<\/th><th>Entrada<\/th>/);
assert.match(source, /<tfoot><tr><td colspan="12">/, "o rodapé precisa acompanhar as 14 colunas");
assert.match(source, /exportXlsx\(id\)\{/);

console.log("Measurement export (VALOR/H + XLSX) tests passed");
