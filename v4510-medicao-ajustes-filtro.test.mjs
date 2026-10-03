/**
 * v4.5.10 — descontos/valores adicionais da medição HH, filtro de projetos só
 * com obras "Em andamento" e DE-PARA que não apaga vínculos fora da tela.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const money = value => `R$ ${Number(value || 0).toFixed(2)}`;
const U = {
  esc: value => String(value ?? ""), norm: value => String(value || "").toLowerCase(), date: value => String(value || ""),
  money, money2: money, num: value => Number(String(value).replace(",", ".")) || 0, id: () => "x1",
  durationMinutes: () => "01:00", icons: () => {}
};

function medicoes() {
  const context = { State: { measurements: [], rdos: [], rdoFinancial: [], projects: [], filters: {}, settings: {} }, Views: {}, RDO: {}, U,
    Cloud: { active: () => false }, UI: {}, DB: {}, App: {}, Biz: {}, console };
  vm.createContext(context);
  vm.runInContext(read("../modules/medicoes/medicoes.js"), context);
  return context.Views.medicoes;
}

test("medição SEM ajustes: nada muda (sem quadro no PDF, sem aba Resumo, mão de obra = valor)", () => {
  const view = medicoes();
  const m = { id: "m1", source: "rdo-hh", value: 2297.65, rdoIds: ["r1"] };
  const totals = view.measurementAdjustments(m);
  assert.equal(totals.items.length, 0);
  assert.equal(totals.labor, 2297.65);
  assert.equal(totals.total, 2297.65);
  assert.equal(view.adjustmentPrintMarkup(m), "");
  assert.equal(view.adjustmentSheetRows(m).length, 0);
});

test("medição COM ajustes: valor gravado = HH + adicionais − descontos; mão de obra recuperada", () => {
  const view = medicoes();
  const adjustments = [
    { id: "a", type: "add", description: "Materiais elétricos", value: 1500 },
    { id: "b", type: "discount", description: "Desconto comercial", value: 297.65 }
  ];
  const created = view.adjustmentTotals(adjustments, 2297.65);
  assert.equal(created.additions, 1500);
  assert.equal(created.discounts, 297.65);
  assert.equal(created.net, 1202.35);
  assert.equal(created.total, 3500);
  const stored = { id: "m2", source: "rdo-hh", value: created.total, adjustments };
  assert.equal(view.measurementLabor(stored), 2297.65, "a mão de obra precisa voltar exatamente à soma dos RDOs");
  const sheet = view.adjustmentSheetRows(stored);
  assert.equal(sheet.map(row => row.Valor).join(","), "2297.65,1500,-297.65,3500");
  assert.equal(sheet.map(row => typeof row.Valor).join(","), "number,number,number,number");
  const pdf = view.adjustmentPrintMarkup(stored);
  assert.match(pdf, /Subtotal mão de obra \(HH\)<\/td><td>R\$ 2297\.65/);
  assert.match(pdf, /TOTAL DA MEDIÇÃO<\/td><td>R\$ 3500\.00/);
  assert.match(pdf, /− R\$ 297\.65/);
});

test("linhas inválidas de ajuste são descartadas na leitura do registro", () => {
  const view = medicoes();
  const list = view.adjustmentList({ adjustments: [{ type: "add", description: "x", value: 0 }, { type: "outro", value: 10 }, null, { type: "discount", description: "d", value: "12.5" }] });
  assert.equal(list.length, 1);
  assert.equal(list[0].value, 12.5);
});

test("o rodapé do PDF só troca de rótulo quando há ajustes", () => {
  const source = read("../modules/medicoes/medicoes.js");
  assert.match(source, /adjusted\.items\.length\?'SUBTOTAL MÃO DE OBRA':'TOTAL DA MEDIÇÃO'/);
  assert.match(source, /U\.money\(adjusted\.items\.length\?adjusted\.labor:measurement\.value\)/);
  // a checagem do saldo contratual continua sobre a soma dos RDOs (inalterada)
  assert.match(source, /if\(value>completion\.remaining\+0\.01\)/);
});

test("filtro de projetos: só Em andamento, mas o que já está selecionado não some", () => {
  const source = read("../modules/dashboard/charts.js");
  const start = source.indexOf("  projectFilterProjects(selected){");
  const end = source.indexOf("\n  },", start);
  const fn = source.slice(start, end + 4).replace(/^  projectFilterProjects/, "function projectFilterProjects").replace(/\n  },$/, "\n}");
  const context = { State: { projects: [
    { id: "1", status: "Em andamento" }, { id: "2", status: "Concluído" }, { id: "3", status: "A executar" }, { id: "4", status: "Em andamento" }
  ] } };
  vm.createContext(context);
  vm.runInContext(`${fn};globalThis.f=projectFilterProjects;`, context);
  assert.equal(context.f(new Set()).map(p => p.id).join(","), "1,4");
  assert.equal(context.f(new Set(["2"])).map(p => p.id).join(","), "1,2,4");
  assert.match(source, /this\.projectFilterProjects\(selected\)\.map\(project=>/);
});

test("DE-PARA: salvar preserva vínculo salvo que a tela não mostrou; o que está na tela continua do usuário", async () => {
  const sent = [];
  const OmieIntegration = {
    catalog: { categories: [{ code: "2.01.02" }, { code: "1.01.09" }] },
    state: { categoryMappings: [
      { omieCategoryCode: "1.01.01", omieCategoryName: "Receita A", cliqueCategoryId: "c1", cliqueCategoryName: "Compras de Material", enabled: true },
      { omieCategoryCode: "1.01.09", omieCategoryName: "Na tela", cliqueCategoryId: "c1", enabled: true },
      { omieCategoryCode: "1.02.02", omieCategoryName: "Categoria apagada", cliqueCategoryId: "sumiu", enabled: true }
    ] },
    async request(action, payload) { sent.push({ action, payload }); return {}; }
  };
  const context = { OmieIntegration, State: { categories: [{ id: "c1", name: "Compras de Material" }] }, console };
  vm.createContext(context);
  vm.runInContext(`${read("../modules/integracoes/omie-remessa.js")};globalThis.OmieRemessa=OmieRemessa;`, context);
  await OmieIntegration.request("save-config", { categoryMappings: [{ omieCategoryCode: "2.01.02", cliqueCategoryId: "c1", enabled: true }] });
  const codes = sent[0].payload.categoryMappings.map(item => item.omieCategoryCode).join(",");
  assert.equal(codes, "2.01.02,1.01.01", "1.01.01 preservado; 1.01.09 (na tela, desmarcado) e 1.02.02 (categoria apagada) não");
  await OmieIntegration.request("status", { x: 1 });
  assert.equal(JSON.stringify(sent[1].payload), '{"x":1}', "outras ações passam intactas");
});
