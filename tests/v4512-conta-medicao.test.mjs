/**
 * v4.5.12 — (1) medição: quantidade × valor unitário nos descontos/adicionais;
 * (2) transferência de propriedade e "Excluir minha conta" sem perda de dado.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const money = value => `R$ ${Number(value || 0).toFixed(2)}`;
const U = {
  esc: value => String(value ?? ""), norm: value => String(value || "").toLowerCase(), date: value => String(value || ""),
  money, money2: money, num: value => Number(String(value).replace(",", ".")) || 0, id: () => "novo",
  durationMinutes: () => "01:00", icons: () => {}
};

function medicoes(document) {
  const context = { State: { measurements: [], rdos: [], rdoFinancial: [], projects: [], filters: {}, settings: {} }, Views: {}, RDO: {}, U,
    Cloud: { active: () => false }, UI: {}, DB: {}, App: {}, Biz: {}, console, Intl, document };
  vm.createContext(context);
  vm.runInContext(read("../modules/medicoes/medicoes.js"), context);
  return context.Views.medicoes;
}

// DOM mínimo: cada linha responde a querySelector('.classe') e tem dataset.
function fakeRows(rows) {
  const make = row => ({
    dataset: row.dataset || {},
    querySelector: selector => {
      const key = selector.replace(".md-adjust-", "");
      return key in row ? { value: row[key] } : null;
    }
  });
  return { querySelectorAll: () => rows.map(make) };
}

test("valor da linha = quantidade × valor unitário, arredondado em centavos", () => {
  const view = medicoes();
  assert.equal(view.adjustmentLineValue(120, 8.5), 1020);
  assert.equal(view.adjustmentLineValue(3, 0.333), 1);
  assert.equal(view.adjustmentLineValue(2.5, 13.99), 34.98);
  assert.equal(view.adjustmentLineValue(0, 10), 0);
});

test("leitura da tela grava quantidade, unidade, valor unitário e o valor calculado", () => {
  const view = medicoes(fakeRows([
    { type: "add", desc: "Cabo PP 3x2,5", qty: "120", unit: "m", price: "8.5", dataset: { id: "a" } },
    { type: "discount", desc: "Desconto comercial", qty: "1", unit: "vb", price: "200", dataset: { id: "b" } },
    { type: "add", desc: "", qty: "", unit: "", price: "" }
  ]));
  const read = view.readAdjustments();
  assert.equal(read.error, "");
  assert.equal(read.list.length, 2, "linha totalmente vazia é ignorada");
  assert.equal(JSON.stringify(read.list[0]), JSON.stringify({ id: "a", type: "add", description: "Cabo PP 3x2,5", quantity: 120, unit: "m", unitPrice: 8.5, value: 1020 }));
  assert.equal(read.list[1].value, 200);
  const totals = view.adjustmentTotals(read.list, 2297.65);
  assert.equal(totals.total, 3117.65);
});

test("linha da v4.5.10 que ninguém mexeu continua gravada como era (sem inventar quantidade)", () => {
  const untouched = medicoes(fakeRows([
    { type: "add", desc: "Materiais", qty: "1", unit: "", price: "1500", dataset: { id: "old", legacyValue: "1500" } }
  ])).readAdjustments();
  assert.equal(JSON.stringify(untouched.list[0]), JSON.stringify({ id: "old", type: "add", description: "Materiais", value: 1500 }));
  const edited = medicoes(fakeRows([
    { type: "add", desc: "Materiais", qty: "3", unit: "un", price: "500", dataset: { id: "old", legacyValue: "1500" } }
  ])).readAdjustments();
  assert.equal(edited.list[0].quantity, 3);
  assert.equal(edited.list[0].unit, "un");
  assert.equal(edited.list[0].value, 1500);
});

test("leitura recusa linha sem quantidade ou sem valor unitário", () => {
  assert.match(medicoes(fakeRows([{ type: "add", desc: "Cabo", qty: "", unit: "m", price: "8" }])).readAdjustments().error, /quantidade em “Cabo”/);
  assert.match(medicoes(fakeRows([{ type: "add", desc: "Cabo", qty: "10", unit: "m", price: "" }])).readAdjustments().error, /valor unitário em “Cabo”/);
  assert.match(medicoes(fakeRows([{ type: "add", desc: "", qty: "10", unit: "m", price: "8" }])).readAdjustments().error, /descrição/);
});

test("registro: quantidade/unidade/valor unitário preservados; linha antiga sem eles", () => {
  const view = medicoes();
  const list = view.adjustmentList({ adjustments: [
    { id: "a", type: "add", description: "Cabo", quantity: 120, unit: "m", unitPrice: 8.5, value: 1020 },
    { id: "b", type: "discount", description: "Antigo", value: 100 }
  ] });
  assert.equal(list[0].quantity, 120);
  assert.equal(list[0].unit, "m");
  assert.equal(list[0].unitPrice, 8.5);
  assert.equal("quantity" in list[1], false);
});

test("PDF: colunas Qtd, Un. e Valor unit.; linha antiga sai com —; totais iguais", () => {
  const view = medicoes();
  const adjustments = [
    { id: "a", type: "add", description: "Cabo PP", quantity: 120, unit: "m", unitPrice: 8.5, value: 1020 },
    { id: "b", type: "discount", description: "Desconto antigo", value: 20 }
  ];
  const stored = { id: "m", source: "rdo-hh", value: 2297.65 + 1000, adjustments };
  const pdf = view.adjustmentPrintMarkup(stored);
  assert.match(pdf, /<th class="mpa-qty">Qtd<\/th><th class="mpa-unit">Un\.<\/th><th class="mpa-price">Valor unit\.<\/th><th>Valor<\/th>/);
  assert.match(pdf, /<td class="mpa-qty">120<\/td><td class="mpa-unit">m<\/td><td class="mpa-price">R\$\s8,50<\/td><td>\+ R\$ 1020\.00<\/td>/);
  assert.match(pdf, /<td class="mpa-qty">—<\/td><td class="mpa-unit">—<\/td><td class="mpa-price">—<\/td><td>− R\$ 20\.00<\/td>/);
  assert.match(pdf, /<td colspan="5">Subtotal mão de obra \(HH\)<\/td><td>R\$ 2297\.65/);
  assert.match(pdf, /TOTAL DA MEDIÇÃO<\/td><td>R\$ 3297\.65/);
});

test("XLSX: aba Resumo com Quantidade, Unidade e Valor unitário numéricos", () => {
  const view = medicoes();
  const stored = { id: "m", source: "rdo-hh", value: 3317.65, adjustments: [
    { id: "a", type: "add", description: "Cabo PP", quantity: 120, unit: "m", unitPrice: 8.5, value: 1020 }
  ] };
  const rows = view.adjustmentSheetRows(stored);
  assert.equal(Object.keys(rows[0]).join("|"), "Item|Tipo|Quantidade|Unidade|Valor unitário|Valor");
  assert.equal(rows[1].Quantidade, 120);
  assert.equal(rows[1]["Valor unitário"], 8.5);
  assert.equal(rows.map(row => row.Valor).join(","), "2297.65,1020,3317.65");
  assert.match(read("../modules/medicoes/medicoes.js"), /summarySheet\['!cols'\]=\[\{wch:40\},\{wch:12\},\{wch:11\},\{wch:9\},\{wch:14\},\{wch:14\}\]/);
});

test("servidor da v4.5.10 continua conferindo só o VALOR da linha (nada no banco muda para a medição)", () => {
  const sql = read("../supabase/ATUALIZACAO-v4.5.12-CONTA-PROPRIEDADE.sql");
  assert.equal(/measurement_adjustment_net_v4510|protect_rdo_app_records/.test(sql), false);
});

// ---------------------------------------------------------------------------
function conta({ active = false } = {}) {
  const calls = [];
  const configuracoes = {
    render() { calls.push("render"); return "r"; },
    renderTeam() { calls.push("renderTeam"); return "t"; },
    profileLabel: (role) => role
  };
  const context = { Views: { configuracoes }, U, UI: {}, console, document: { getElementById: () => null, querySelector: () => null },
    Cloud: { active: () => active, transferOwnership() {}, deleteOwnAccount() {}, role: () => "owner", user: () => ({ id: "me" }) } };
  vm.createContext(context);
  vm.runInContext(`${read("../modules/configuracoes/conta.js")}\n;globalThis.AccountV4512=AccountV4512;`, context);
  return { context, calls, configuracoes };
}

test("Configurações: render() e renderTeam() originais continuam rodando e devolvendo o mesmo", () => {
  const { calls, configuracoes } = conta();
  assert.equal(configuracoes.render(), "r");
  assert.equal(configuracoes.renderTeam(), "t");
  assert.equal(calls.join(","), "render,renderTeam");
});

test("transferência: candidatos excluem você e quem já é proprietário", () => {
  const { context } = conta();
  const list = context.AccountV4512.transferCandidates([
    { user_id: "me", role: "owner" }, { user_id: "a", role: "admin" }, { user_id: "b", role: "editor" }, { user_id: "c", role: "owner" }
  ], "me");
  assert.equal(list.map(m => m.user_id).join(","), "a,b");
});

test("exclusão: bloqueio e aviso de organização sem outros membros", () => {
  const { context } = conta();
  const blocked = context.AccountV4512.deletionSummary({ blocked: true, organizations: [{ name: "DGA", members: 18 }], records: 7010 });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.blockers[0], "DGA (18 membros)");
  const free = context.AccountV4512.deletionSummary({ blocked: false, organizations: [], records: 4,
    solo_organizations: [{ name: "Pessoal", records: 12 }, { name: "Vazia", records: 0 }] });
  assert.equal(free.blocked, false);
  assert.equal(free.solo.length, 1, "organização vazia não gera aviso");
  assert.equal(free.records, 4);
});

test("cloud.js expõe as 3 funções novas; index.html carrega conta.js depois de configuracoes.js", () => {
  const cloud = read("../database/cloud.js");
  assert.match(cloud, /transferOwnership, accountDeletionCheck, deleteOwnAccount,/);
  assert.match(cloud, /rpc\/clique_obras_transfer_ownership_v4512/);
  assert.match(cloud, /functions\/v1\/delete-own-account/);
  const html = read("../index.html");
  const a = html.indexOf("modules/configuracoes/configuracoes.js?v=4.5.12");
  const b = html.indexOf("modules/configuracoes/conta.js?v=4.5.12");
  assert.ok(a > 0 && b > a);
});

test("banco: nenhuma FK de dado apaga em cascata; gatilho bloqueia único dono; ex-dono vira admin", () => {
  const sql = read("../supabase/ATUALIZACAO-v4.5.12-CONTA-PROPRIEDADE.sql");
  for (const fk of ["app_records_user_id_fkey", "organization_invitations_invited_by_fkey", "rdo_attachments_uploaded_by_fkey",
    "rdo_cost_postings_posted_by_fkey", "rdo_measurement_links_linked_by_fkey", "omie_connections_created_by_fkey"])
    assert.match(sql, new RegExp(`drop constraint if exists ${fk};`));
  const code = sql.replace(/--.*$/gm, "");
  assert.equal(/on delete cascade/i.test(code), false, "o script não cria nenhuma cascata nova (comentários fora)");
  assert.match(sql, /before delete on auth\.users/);
  assert.match(sql, /Transfira a propriedade antes de excluir a conta/);
  assert.match(sql, /set role='owner', permissions=actor\.permissions[\s\S]*set role='admin'/);
  const fn = read("../supabase/functions/delete-own-account/index.ts");
  assert.match(fn, /toUpperCase\(\) !== "EXCLUIR"/);
  assert.match(fn, /signInWithPassword/);
  assert.match(fn, /auth\.admin\.deleteUser\(user\.id\)/);
});
