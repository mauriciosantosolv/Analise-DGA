import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const regexEscape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sha256 = relative => crypto
  .createHash("sha256")
  .update(fs.readFileSync(path.join(root, relative)))
  .digest("hex");

const html = read("index.html");
assert.match(html, /name="application-version" content="2\.7\.0"/);
assert.match(html, /object-src 'none'/);
assert.match(html, /accept="image\/png,image\/jpeg,image\/webp"/);
assert.match(html, /modules\/rdo\/rdo\.js\?v=2\.7\.0/);

const integrity = read("assets/vendor/INTEGRITY-SHA256.txt");
for (const relative of [
  "assets/vendor/chart.min.js",
  "assets/vendor/lucide.min.js",
  "assets/vendor/supabase.js",
  "assets/vendor/xlsx.min.js"
]) {
  assert.match(
    integrity,
    new RegExp(`${sha256(relative)}\\s+${regexEscape(path.basename(relative))}`)
  );
}

const htaccess = read(".htaccess");
assert.match(htaccess, /frame-ancestors 'none'/);
assert.match(htaccess, /X-Frame-Options "DENY"/);
assert.match(htaccess, /X-Content-Type-Options "nosniff"/);
assert.match(htaccess, /Strict-Transport-Security/);

const cloud = read("database/cloud.js");
assert.match(cloud, /rdo_projects:\[\]/);
assert.doesNotMatch(cloud, /service_role|sb_secret/i);

const configuration = read("modules/configuracoes/configuracoes.js");
assert.match(configuration, /Backup\.validate/);
assert.match(configuration, /Exports\.spreadsheetRows\(State\.rdos\)/);
assert.match(configuration, /U\.jsArg\(m\.user_id\)/);

const rdo = read("modules/rdo/rdo.js");
assert.match(rdo, /U\.jsArg\(rdo\.id\)/);
assert.doesNotMatch(rdo, /RDO\.detail\('\\?\$\{U\.esc/);

const measurements = read("modules/medicoes/medicoes.js");
assert.match(measurements, /Cloud\.releaseRdoMeasurement/);
assert.match(measurements, /U\.jsArg\(m\.id\)/);

const securitySql = read("supabase/ATUALIZACAO-SEGURANCA-v2.7.sql");
assert.match(securitySql, /where value not in \('view','edit','manage_users','rdo_projects'\)/);
assert.match(securitySql, /actor\.role='viewer' and target_role='viewer'/);
assert.match(securitySql, /actor\.permissions->'rdo_projects'/);
assert.match(securitySql, /allowed\.item->>'id'=requested\.item->>'id'/);

const rdoSql = read("supabase/ATUALIZACAO-v2.7-RDO-HH.sql");
assert.match(rdoSql, /enable row level security/);
assert.match(rdoSql, /primary key \(organization_id,rdo_id\)/);
assert.match(rdoSql, /create policy "cliqueobras_rdo_links_delete"/);
assert.match(rdoSql, /grant select,insert,delete on table public\.rdo_measurement_links/);
assert.doesNotMatch(rdoSql, /auth\.role\(\)/);

console.log("Security regression tests passed");
