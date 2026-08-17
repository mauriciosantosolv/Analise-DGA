import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.match(html, /assets\/logo-clique\.png/);
assert.match(html, /assets\/apple-touch-icon\.png/);
assert.match(html, /src="assets\/vendor\/lucide\.min\.js/);
assert.doesNotMatch(html, /assets\/coolicons\/coolicons\.js/);
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
assert.match(css, /\.crew-card>span:nth-child\(2\)>b/);
assert.match(css, /#measurement-print-report/);
assert.match(css, /\.rdo-print-labor-table\{[^}]*table-layout:fixed/);
assert.match(css, /\.rdo-audit-list/);
assert.doesNotMatch(css, /var\(--(?:radius|shadow-sm|surface3)\)/);

const cloud = fs.readFileSync(path.join(root, "database/cloud.js"), "utf8");
for (const store of ["rdos", "crew", "labor_rates", "rdo_financial"]) {
  assert.match(cloud, new RegExp(`'${store}'`));
}
assert.match(cloud, /occupiedRdoEmployees/);
assert.match(cloud, /clique_obras_rdo_occupied_employees/);
assert.match(cloud, /clique_obras_approve_rdo_v401/);
assert.match(cloud, /clique_obras_repair_rdo_costs_v401/);

const database = fs.readFileSync(path.join(root, "database/indexeddb.js"), "utf8");
assert.match(database, /VERSION = 6/);
assert.match(database, /'workforce_status'/);
assert.match(database, /approveRdoLocal/);

const auth = fs.readFileSync(path.join(root, "js/auth-ui.js"), "utf8");
assert.match(auth, /assets\/logo-clique\.png/);

const rdo = fs.readFileSync(path.join(root, "modules/rdo/rdo.js"), "utf8");
assert.match(rdo, /onclick="RDO\.remove/);
assert.match(rdo, /Reprovar diário/);
assert.match(rdo, /Custo padrão por hora/);
assert.match(rdo, /customer\.logo/);
assert.match(rdo, /currentStep===4/);
assert.match(rdo, /id="rdo-team-search"/);
assert.match(rdo, /const selected=!!saved/);
assert.match(rdo, /Registrar falta/);
assert.match(rdo, /Controlar folgas/);
assert.match(rdo, /dayOffForm/);
assert.match(rdo, /visibleEntries/);
assert.match(rdo, /occupiedEmployees/);
assert.match(rdo, /allocationConflicts/);
assert.match(rdo, /\['2','Equipe e horas','user'\]/);
assert.match(rdo, /Buscar por matrícula, nome ou cargo/);
assert.match(rdo, /rolesForm\(\)/);
assert.match(rdo, /rdoDailyHours/);
assert.match(rdo, /id="rdo-holiday"/);
assert.match(rdo, /dayTypeLabel/);
assert.match(rdo, /rdoNightPremiumPct/);
assert.match(rdo, /employeeRegistration/);
assert.match(rdo, /roleDisplayMode/);
assert.match(rdo, /displayRoleFor/);
assert.match(rdo, /id="rate-active"/);
assert.match(rdo, /description\|\|image\.fileName/);
assert.doesNotMatch(rdo, /users-round/);

const measurements = fs.readFileSync(path.join(root, "modules/medicoes/medicoes.js"), "utf8");
assert.match(measurements, /Excluir medição/);
assert.match(measurements, /deleteRdoMeasurement/);
assert.match(measurements, /measurementRows/);
assert.match(measurements, /Valor total da medição/);
assert.match(measurements, /measurement-day-total/);
assert.match(measurements, /U\.durationMinutes\(row\.breakMinutes\)/);

const dashboard = fs.readFileSync(path.join(root, "modules/dashboard/charts.js"), "utf8");
assert.match(dashboard, /Composição calculada pela base de incidência/);
assert.match(dashboard, /Biz\.baseRateForCategory/);

const format = fs.readFileSync(path.join(root, "utils/format.js"), "utf8");
assert.match(format, /\$\{p\.proposal\} \| \$\{p\.name\|\|''\}/);
assert.match(format, /durationMinutes\(value\)/);

const importer = fs.readFileSync(path.join(root, "js/importer.js"), "utf8");
assert.match(importer, /labor:[\s\S]*supplier:[\s\S]*order:[\s\S]*notes:/);
assert.match(importer, /findHeader\(rows, MAPS\.labor, 'labor'\)/);
assert.match(importer, /sourceType:'labor'/);
assert.doesNotMatch(importer, /existingCount|seenCount|\.dedupe\s*=/);
assert.match(importer, /projectParts:splitProject/);

const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
assert.match(app, /previousScroll/);
assert.match(app, /repairApprovedRdoCostsV401/);
assert.doesNotMatch(app, /document\.getElementById\('content'\)\.scrollTop = 0/);

const costs = fs.readFileSync(path.join(root, "modules/custos/custos.js"), "utf8");
assert.match(costs, /baseCalcHistory/);
assert.match(costs, /baseRatesForProject/);
assert.match(costs, /compareCategories/);

const exports = fs.readFileSync(path.join(root, "utils/export.js"), "utf8");
assert.match(exports, /deviationJustification/);
assert.match(exports, /clientLogo/);
assert.match(exports, /stationeryMarkup/);

const configuration = fs.readFileSync(path.join(root, "modules/configuracoes/configuracoes.js"), "utf8");
assert.match(configuration, /cfg-rdo-daily-hours/);
assert.match(configuration, /cfg-rdo-saturday-start/);
assert.match(configuration, /cfg-rdo-sunday-start/);
assert.match(configuration, /cfg-rdo-night-start/);
assert.match(configuration, /cfg-rdo-night-premium/);
assert.match(configuration, /cfg-letterhead-btn/);
assert.match(configuration, /pdfLetterhead/);
assert.match(configuration, /companyCnpj/);
assert.match(configuration, /image\/jpeg,image\/png/);
assert.match(configuration, /cfg-profile-photo-select/);
assert.doesNotMatch(configuration, /id="cfg-currency"/);
assert.doesNotMatch(configuration, /Preferências do sistema/);

const premium = fs.readFileSync(path.join(root, "css/premium.css"), "utf8");
assert.match(premium, /--bg: #f4f4f5/);
assert.match(premium, /--text: #27272a/);
assert.match(premium, /#company-settings-card[\s\S]*grid-column: 1 \/ -1/);
assert.match(premium, /#ticker-projects[\s\S]*grid-template-columns: repeat\(3/);
assert.match(premium, /\[tabindex\]:focus-visible[\s\S]*outline: none/);

const reports = fs.readFileSync(path.join(root, "modules/relatorios/relatorios.js"), "utf8");
assert.match(reports, /Histórico de Alocações/);
assert.match(reports, /allocationHistoryRows/);
assert.match(reports, /'Situação':row\.situation/);
assert.match(reports, /\['Falta','Folga','Ocioso'\]\.includes\(row\.situation\)/);
assert.match(reports, /situation:'Ocioso'[\s\S]*regular:8\.8/);
assert.match(reports, /situation:'Folga'[\s\S]*regular:0/);

const lucide = fs.readFileSync(path.join(root, "assets/vendor/lucide.min.js"), "utf8");
assert.match(lucide, /createIcons/);

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
for (const icon of manifest.icons) {
  assert.ok(fs.existsSync(path.join(root, icon.src)), `Missing manifest icon: ${icon.src}`);
}
assert.ok(manifest.icons.some(icon=>icon.purpose==="maskable"));

console.log("Static integration tests passed");
