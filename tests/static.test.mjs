import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
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
assert.doesNotMatch(css, /var\(--(?:radius|shadow-sm|surface3)\)/);

const cloud = fs.readFileSync(path.join(root, "database/cloud.js"), "utf8");
for (const store of ["rdos", "crew", "labor_rates", "rdo_financial"]) {
  assert.match(cloud, new RegExp(`'${store}'`));
}

console.log("Static integration tests passed");
