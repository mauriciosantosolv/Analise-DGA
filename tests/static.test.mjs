import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.match(html, /assets\/logo-clique\.png/);
assert.match(html, /assets\/apple-touch-icon\.png/);
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map(match => match[1].split("?")[0])
  .filter(reference => !/^(?:https?:|data:|#)/.test(reference));

for (const reference of references) {
  assert.ok(fs.existsSync(path.join(root, reference)), `Missing referenced file: ${reference}`);
}

for (const view of ["rdos", "colaboradores", "valoreshh", "medicoes"]) {
  assert.match(html, new RegExp(`data-view="${view}"`));
}
assert.match(html, /<div class="nav-sep">Execução<\/div>[\s\S]*data-view="rdos"[\s\S]*data-view="colaboradores"[\s\S]*data-view="medicoes"[\s\S]*data-view="valoreshh"/);
assert.match(html, /data-view="colaboradores"><i data-lucide="users"><\/i>/);

const css = fs.readFileSync(path.join(root, "css/rdo.css"), "utf8");
assert.match(css, /@media\(max-width:860px\)/);
assert.match(css, /@media\(max-width:560px\)/);
assert.match(css, /\.modal\.rdo-composer-modal/);
assert.match(css, /height:100dvh/);
assert.match(css, /body\.printing-rdo/);
assert.match(css, /@page rdo-report/);
assert.match(css, /size:A4 portrait/);
assert.match(css, /#rdo-next\[hidden\]/);
assert.match(css, /\.rdo-team-template input\[type="time"\][^}]*width:100%[^}]*appearance:none/);
assert.match(css, /\.rdo-worker-fields label\{min-width:0/);
assert.match(css, /\.rdo-team-search/);
assert.doesNotMatch(css, /var\(--(?:radius|shadow-sm|surface3)\)/);

const cloud = fs.readFileSync(path.join(root, "database/cloud.js"), "utf8");
for (const store of ["rdos", "crew", "labor_rates", "rdo_financial"]) {
  assert.match(cloud, new RegExp(`'${store}'`));
}

const auth = fs.readFileSync(path.join(root, "js/auth-ui.js"), "utf8");
assert.match(auth, /assets\/logo-clique\.png/);

const rdo = fs.readFileSync(path.join(root, "modules/rdo/rdo.js"), "utf8");
assert.match(rdo, /onclick="RDO\.remove/);
assert.match(rdo, /Reprovar diário/);
assert.match(rdo, /Custo por hora/);
assert.match(rdo, /customer\.logo/);
assert.match(rdo, /currentStep===4/);
assert.match(rdo, /id="rdo-team-search"/);
assert.match(rdo, /const selected=!!saved/);
assert.match(rdo, /\['2','Equipe e horas','user'\]/);
assert.doesNotMatch(rdo, /users-round/);

const measurements = fs.readFileSync(path.join(root, "modules/medicoes/medicoes.js"), "utf8");
assert.match(measurements, /Excluir medição/);
assert.match(measurements, /deleteRdoMeasurement/);

const importer = fs.readFileSync(path.join(root, "js/importer.js"), "utf8");
assert.match(importer, /labor:[\s\S]*supplier:[\s\S]*order:[\s\S]*notes:/);
assert.match(importer, /findHeader\(rows, MAPS\.labor, 'labor'\)/);
assert.match(importer, /sourceType:'labor'/);

const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
assert.match(app, /previousScroll/);
assert.doesNotMatch(app, /document\.getElementById\('content'\)\.scrollTop = 0/);

const costs = fs.readFileSync(path.join(root, "modules/custos/custos.js"), "utf8");
assert.match(costs, /baseCalcHistory/);
assert.match(costs, /baseRatesForProject/);

const exports = fs.readFileSync(path.join(root, "utils/export.js"), "utf8");
assert.match(exports, /deviationJustification/);
assert.match(exports, /clientLogo/);

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
for (const icon of manifest.icons) {
  assert.ok(fs.existsSync(path.join(root, icon.src)), `Missing manifest icon: ${icon.src}`);
}
assert.ok(manifest.icons.some(icon=>icon.purpose==="maskable"));

console.log("Static integration tests passed");
