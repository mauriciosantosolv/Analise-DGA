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

const css = fs.readFileSync(path.join(root, "css/rdo.css"), "utf8");
assert.match(css, /@media\(max-width:860px\)/);
assert.match(css, /@media\(max-width:560px\)/);
assert.match(css, /\.modal\.rdo-composer-modal/);
assert.match(css, /height:100dvh/);
assert.match(css, /body\.printing-rdo/);
assert.match(css, /@page rdo-report/);
assert.match(css, /size:A4 portrait/);
assert.match(css, /#rdo-next\[hidden\]/);
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

const measurements = fs.readFileSync(path.join(root, "modules/medicoes/medicoes.js"), "utf8");
assert.match(measurements, /Excluir medição/);
assert.match(measurements, /deleteRdoMeasurement/);

const exports = fs.readFileSync(path.join(root, "utils/export.js"), "utf8");
assert.match(exports, /deviationJustification/);
assert.match(exports, /clientLogo/);

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
for (const icon of manifest.icons) {
  assert.ok(fs.existsSync(path.join(root, icon.src)), `Missing manifest icon: ${icon.src}`);
}
assert.ok(manifest.icons.some(icon=>icon.purpose==="maskable"));

console.log("Static integration tests passed");
