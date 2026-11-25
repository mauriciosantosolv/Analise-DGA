// v4.5.17 - PDF do RDO como arquivo no celular + arquivamento de obras concluidas
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pdfSrc = read('utils/pdf.js');
const rdoSrc = read('modules/rdo/rdo.js');
const archiveSrc = read('modules/projetos/arquivo.js');
const projetosSrc = read('modules/projetos/projetos.js');
const comprasSrc = read('modules/compras/compras.js');
const cloudSrc = read('database/cloud.js');
const index = read('index.html');
const sql = read('supabase/ATUALIZACAO-v4.5.17-ARQUIVAMENTO-OBRAS.sql');
const fn = read('supabase/functions/arquivar-obra/index.ts');

function loadPdf({ ua = '', standalone = false, coarse = false, fine = true } = {}) {
  const ctx = vm.createContext({
    navigator: { userAgent: ua, platform: '', maxTouchPoints: 0, standalone },
    window: {
      print() {},
      matchMedia: q => ({ matches: q.includes('standalone') ? standalone : q.includes('coarse') ? coarse : q.includes('fine') ? fine : false })
    },
    console
  });
  vm.runInContext(`${pdfSrc}\n;globalThis.Pdf=Pdf;`, ctx);
  return ctx.Pdf;
}

test('celular e app instalado geram arquivo; computador continua imprimindo', () => {
  assert.equal(loadPdf({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }).preferFile(), true);
  assert.equal(loadPdf({ ua: 'Mozilla/5.0 (Linux; Android 14)' }).preferFile(), true);
  assert.equal(loadPdf({ ua: 'Mozilla/5.0 (Windows NT 10.0)', standalone: true }).preferFile(), true);
  assert.equal(loadPdf({ ua: 'Mozilla/5.0 (Windows NT 10.0)', coarse: true, fine: false }).preferFile(), true);
  assert.equal(loadPdf({ ua: 'Mozilla/5.0 (Windows NT 10.0)', coarse: true, fine: true }).preferFile(), false);
  assert.equal(loadPdf({ ua: 'Mozilla/5.0 (Windows NT 10.0)' }).preferFile(), false);
});

test('texto do PDF: acentos ficam, simbolos tipograficos viram equivalentes', () => {
  const Pdf = loadPdf();
  assert.equal(Pdf.text('Ação — área “3” ‘x’ … ok'), 'Ação - área "3" \'x\' ... ok');
  assert.equal(Pdf.text('a b​c😀'), 'a b c');
  assert.equal(Pdf.text('linha 1\r\nlinha 2'), 'linha 1\nlinha 2');
});

test('nome de arquivo seguro', () => {
  const Pdf = loadPdf();
  assert.equal(Pdf.fileName('966 | REVITALIZAÇÃO ZED - ADEQUAÇÕES.'), '966 REVITALIZACAO ZED - ADEQUACOES');
  assert.equal(Pdf.fileName('Subestação “Norte”'), 'Subestacao Norte');
  assert.equal(Pdf.fileName('RDO-2026-0790 (966-24-11)'), 'RDO-2026-0790 966-24-11');
  assert.equal(Pdf.fileName('../../etc'), 'etc');
  assert.equal(Pdf.fileName(''), 'documento');
});

test('RDO: celular vai para o PDF em arquivo, sem window.print', () => {
  assert.ok(rdoSrc.includes("if(typeof Pdf!=='undefined'&&Pdf.preferFile()) return this.downloadPdf(id);"));
  const download = rdoSrc.slice(rdoSrc.indexOf('  async downloadPdf(id){'), rdoSrc.indexOf('  async pdfBlob(data){'));
  assert.ok(!download.includes('beginPrint') && !download.includes('window.print'));
  assert.ok(download.includes('Pdf.deliver('));
  // o PDF impresso e o arquivo usam os mesmos dados
  assert.ok(rdoSrc.includes('const data=await this.documentData(rdo);\n      const old=document.getElementById'));
  assert.ok(rdoSrc.includes('report.innerHTML=this.printHtml(data);'));
});

test('entrega no celular: compartilhar e baixar disparam no toque', () => {
  assert.ok(pdfSrc.includes("navigator.share({files:[file],title:name})"));
  assert.ok(pdfSrc.includes('id="pdf-ready-download" href='));
  assert.ok(pdfSrc.includes('download="${U.esc(name)}"'));
});

test('bibliotecas embarcadas e carregadas sob demanda', () => {
  for (const file of ['jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js', 'fflate.min.js']) {
    const body = fs.readFileSync(new URL(`../assets/vendor/${file}`, import.meta.url), 'utf8');
    assert.ok(body.length > 10000, file);
    assert.ok(!/\beval\(|new Function\(/.test(body), `${file} nao pode usar eval (CSP)`);
    assert.ok(read('assets/vendor/INTEGRITY-SHA256.txt').includes(file));
  }
  assert.ok(!index.includes('jspdf.umd.min.js'), 'jsPDF nao entra no carregamento inicial');
  assert.ok(index.includes('<script src="utils/pdf.js?v=4.5.17"></script>'));
  assert.ok(index.includes('<script src="modules/projetos/arquivo.js?v=4.5.17"></script>'));
  assert.ok(index.includes('<meta name="application-version" content="4.5.17">'));
});

test('arquivamento: so dono/admin, so Concluido, ZIP conferido antes de liberar', () => {
  assert.ok(archiveSrc.includes("project.status==='Concluído' && !this.isArchived(project) && this.canManage()"));
  assert.ok(archiveSrc.includes("['owner','admin'].includes(Cloud.role())"));
  assert.ok(archiveSrc.includes('fflate.unzipSync(zipped)'));
  assert.ok(archiveSrc.includes('reread.snapshot.fingerprint!==snapshot.fingerprint'));
  assert.ok(archiveSrc.includes('Nada foi apagado.'));
  assert.ok(archiveSrc.includes('commit.disabled=!(saved.checked&&typed&&typed===expected);'));
  assert.ok(projetosSrc.includes('ProjectArchive.canArchive(p)'));
  assert.ok(projetosSrc.includes('${id&&!archived?'), 'obra arquivada nao mostra Excluir');
  assert.ok(comprasSrc.includes("if(x&&x.archiveSummary) return 'Resumo de obra arquivada"));
  assert.ok(cloudSrc.includes("'/functions/v1/arquivar-obra'"));
  assert.ok(cloudSrc.includes('if(cache) await cacheAttachment(path,result.data);'));
});

test('arquivamento: resumo usa a mesma chave do banco (categoria x mes x origem)', () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(`${archiveSrc}\n;globalThis.ProjectArchive=ProjectArchive;`, ctx);
  const n = ctx.ProjectArchive.summaryPreview([
    { category: 'A', date: '2026-01-02', sourceType: 'labor' },
    { category: 'A', date: '2026-01-30', sourceType: 'labor' },
    { category: 'A', date: '2026-01-30' },
    { category: 'A', date: '2026-02-01' },
    { category: 'B', date: '' }
  ]);
  assert.equal(n, 4);
  assert.ok(sql.includes("coalesce(nullif(purchase.data->>'sourceType',''),'purchase') as origin"));
  assert.ok(sql.includes("left(coalesce(purchase.data->>'date',''),7) as month"));
});

test('SQL: trava de impressao digital, soma conferida, guarda e Omie desligado', () => {
  assert.ok(sql.includes("if current_fingerprint is distinct from expected_fingerprint then"));
  assert.ok(sql.includes('A soma do resumo (%) não confere com a soma das compras (%). Nada foi apagado.'));
  assert.ok(sql.includes("raise exception 'A obra tem RDO em rascunho"));
  assert.ok(sql.includes("if coalesce(project_data->>'status','')<>'Concluído' then"));
  assert.ok(sql.includes('create trigger zz_cliqueobras_archived_project_guard'));
  assert.ok(sql.includes('before insert or update or delete on public.app_records'));
  assert.ok(sql.includes('create trigger cliqueobras_archived_omie_mapping_off'));
  assert.ok(sql.includes('create trigger cliqueobras_archived_omie_remessa_off'));
  assert.ok(sql.includes("perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':omie',0));"));
  assert.ok(sql.includes("'clique-obras-limpeza-historicos','41 4 * * *'"));
  for (const name of ['clique_obras_archive_project_snapshot(uuid,text)', 'clique_obras_archive_project(uuid,text,text,jsonb)', 'clique_obras_archive_finish_photos(uuid,text)']) {
    assert.ok(sql.includes(`revoke all on function public.${name} from public, anon;`), name);
    assert.ok(sql.includes(`grant execute on function public.${name} to authenticated;`), name);
  }
  assert.ok(sql.includes('revoke all on function clique_obras_private.purge_history_v4517(integer) from public, anon, authenticated;'));
});

test('Edge Function: confere dono/admin e so apaga caminhos da propria obra', () => {
  assert.ok(fn.includes('["owner", "admin"].includes(membership.role)'));
  assert.ok(fn.includes('const prefix = `${organizationId}/${projectId}/`;'));
  assert.ok(fn.includes('caller.rpc("clique_obras_archive_project"'));
  assert.ok(fn.includes('admin.storage.from(BUCKET).remove(batch)'));
  assert.ok(!/admin\.rpc\(/.test(fn), 'as funcoes do banco rodam com a sessao de quem pediu');
});
