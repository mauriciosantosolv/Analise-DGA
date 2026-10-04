import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const lucide = require(path.join(root, "assets/vendor/lucide.min.js"));
const sourceFiles = [];

const walk = directory => {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    const relative = path.relative(root, file).replaceAll("\\", "/");
    if (relative.startsWith("assets/vendor/") || relative.startsWith("assets/coolicons/")) continue;
    const stat = fs.statSync(file);
    if (stat.isDirectory()) walk(file);
    else if (/\.(?:html|js)$/.test(name)) sourceFiles.push(file);
  }
};

walk(root);

const iconNames = new Set();
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/data-lucide=["']([^"'${}]+)["']/g)) iconNames.add(match[1]);
}

const componentName = name => name
  .split("-")
  .map(part => part.charAt(0).toUpperCase() + part.slice(1))
  .join("");

const missing = [...iconNames]
  .filter(name => !lucide.icons[componentName(name)])
  .sort();

assert.deepEqual(missing, [], `Ícones sem suporte na biblioteca local: ${missing.join(", ")}`);
assert.ok(iconNames.size >= 80, "A cobertura de ícones ficou abaixo do esperado");

console.log(`${iconNames.size} nomes de ícones validados na biblioteca local`);
