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
assert.match(html, /name="application-version" content="2\.9\.0"/);
assert.match(html, /object-src 'none'/);
assert.match(html, /accept="image\/png,image\/jpeg,image\/webp"/);
assert.match(html, /modules\/rdo\/rdo\.js\?v=2\.9\.0/);

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
assert.match(cloud, /uploadRdoAttachment/);
assert.match(cloud, /downloadRdoAttachment/);
assert.match(cloud, /clique_obras_delete_rdo_measurement/);
assert.doesNotMatch(cloud, /service_role|sb_secret/i);

const configuration = read("modules/configuracoes/configuracoes.js");
assert.match(configuration, /Backup\.validate/);
assert.match(configuration, /Exports\.spreadsheetRows\(State\.rdos\)/);
assert.match(configuration, /U\.jsArg\(m\.user_id\)/);

const rdo = read("modules/rdo/rdo.js");
assert.match(rdo, /U\.jsArg\(rdo\.id\)/);
assert.match(rdo, /Diário enviado para aprovação/);
assert.match(rdo, /capture="environment"/);
assert.match(rdo, /window\.print\(\)/);
assert.match(rdo, /Comentário da reprovação/);
assert.match(rdo, /baseCostFor/);
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

const attachmentSql = read("supabase/ATUALIZACAO-v2.8-RDO-FOTOS-PDF.sql");
assert.match(attachmentSql, /create table if not exists public\.rdo_attachments/);
assert.match(attachmentSql, /alter table public\.rdo_attachments enable row level security/);
assert.match(attachmentSql, /bucket_id='rdo-evidencias'/);
assert.match(attachmentSql, /rdo_is_attachment_editable/);
assert.match(attachmentSql, /grant select,insert,delete on table public\.rdo_attachments/);
assert.doesNotMatch(attachmentSql, /auth\.role\(\)/);

const v29Sql = read("supabase/ATUALIZACAO-v2.9-RDO-REVISAO-MEDICAO.sql");
assert.match(v29Sql, /create or replace function public\.clique_obras_delete_rdo_measurement/);
assert.match(v29Sql, /create or replace function clique_obras_private\.delete_rdo_measurement[\s\S]*security definer[\s\S]*set search_path=''/i);
assert.match(v29Sql, /create or replace function public\.clique_obras_delete_rdo_measurement[\s\S]*security invoker[\s\S]*set search_path=''/i);
assert.match(v29Sql, /Somente administrador pode excluir medição HH/);
assert.match(v29Sql, /Medição HH faturada não pode ser excluída/);
assert.match(v29Sql, /delete from public\.rdo_measurement_links/);
assert.match(v29Sql, /grant execute on function public\.clique_obras_delete_rdo_measurement/);
assert.match(v29Sql, /Somente RDO em rascunho ou reprovado pode ser excluído/);
assert.match(v29Sql, /Somente administrador pode reprovar o RDO/);
assert.match(v29Sql, /Informe o comentário da reprovação/);
assert.doesNotMatch(v29Sql, /auth\.role\(\)/);

console.log("Security regression tests passed");
