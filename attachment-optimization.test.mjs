/**
 * v4.2.19 — otimização das evidências do RDO.
 *
 * Três garantias, lidas do código real publicado (não de cópias):
 *
 * 1. A compressão NUNCA pode impedir o salvamento. RDO.prepareAttachmentFile
 *    devolve o arquivo original quando o tipo não é imagem, quando U não tem
 *    a função nova (arquivo antigo em cache do navegador), quando a compressão
 *    lança erro e quando o resultado não ficou menor.
 *
 * 2. As travas que já existiam continuam de pé: 8 MB por arquivo medidos no
 *    arquivo ORIGINAL, MIME restrito e 12 anexos por RDO.
 *
 * 3. O cache local só entra em ação com object_path (que é imutável, tem UUID)
 *    e é apagado no signOut.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const rdoSource = fs.readFileSync(new URL('../modules/rdo/rdo.js', import.meta.url), 'utf8');
const cloudSource = fs.readFileSync(new URL('../database/cloud.js', import.meta.url), 'utf8');
const helpersSource = fs.readFileSync(new URL('../utils/helpers.js', import.meta.url), 'utf8');

/* ---------- 1) prepareAttachmentFile, recortada do arquivo real ---------- */
function metodo(fonte, nome) {
  const inicio = fonte.indexOf(`  async ${nome}(`);
  assert.notEqual(inicio, -1, `${nome} não foi encontrada`);
  const fim = fonte.indexOf('\n  },', inicio);
  assert.notEqual(fim, -1, `não consegui delimitar ${nome}`);
  return fonte.slice(inicio, fim + '\n  }'.length);
}

function contexto(compressor) {
  return vm.runInNewContext(
    `({ attachmentImageLimits:{maxSide:1280,quality:.75},\n${metodo(rdoSource, 'prepareAttachmentFile')} })`,
    { U: compressor === null ? {} : { compressImageFile: compressor } }
  );
}

const original = { name: 'obra.jpg', type: 'image/jpeg', size: 400 * 1024 };

// devolve o original quando o arquivo não é imagem
{
  const pdf = { name: 'nota.pdf', type: 'application/pdf', size: 90 * 1024 };
  const alvo = contexto(async () => ({ name: 'x.jpg', type: 'image/jpeg', size: 10 }));
  assert.equal(await alvo.prepareAttachmentFile(pdf), pdf, 'PDF não pode ser recomprimido');
}

// devolve o original quando o navegador ainda tem o helpers.js antigo em cache
{
  const alvo = contexto(null);
  assert.equal(await alvo.prepareAttachmentFile(original), original,
    'sem U.compressImageFile o upload tem que seguir com o arquivo original');
}

// devolve o original quando a compressão falha
{
  const alvo = contexto(async () => { throw new Error('canvas indisponível'); });
  assert.equal(await alvo.prepareAttachmentFile(original), original,
    'falha na compressão não pode derrubar o salvamento do RDO');
}

// devolve o original quando a compressão não ganhou nada
{
  const alvo = contexto(async () => ({ name: 'obra.jpg', type: 'image/jpeg', size: 400 * 1024 }));
  assert.equal(await alvo.prepareAttachmentFile(original), original,
    'resultado do mesmo tamanho tem que ser descartado');
}

// usa o comprimido quando ele é realmente menor
{
  const menor = { name: 'obra.jpg', type: 'image/jpeg', size: 110 * 1024 };
  const alvo = contexto(async () => menor);
  assert.equal(await alvo.prepareAttachmentFile(original), menor,
    'o arquivo menor tem que ser o que sobe');
}

/* ---------- 2) as travas antigas continuam de pé ---------- */
assert.match(rdoSource, /file\.size>8\*1024\*1024/,
  'o limite de 8 MB por anexo sumiu de modules/rdo/rdo.js');
assert.match(rdoSource, /this\.validateAttachmentFile\(file\);\n\s+const upload=await this\.prepareAttachmentFile\(file\)/,
  'o limite de 8 MB precisa ser medido no arquivo ORIGINAL, antes de comprimir');
assert.match(rdoSource, /savedAttachments\.length\+pendingFiles\.length>=12/,
  'o teto de 12 anexos por RDO sumiu da tela');
assert.match(cloudSource, /size>8\*1024\*1024/,
  'o limite de 8 MB sumiu de database/cloud.js');
assert.match(
  cloudSource,
  /new Set\(\['image\/jpeg','image\/png','image\/webp','application\/pdf'\]\)/,
  'a lista de tipos aceitos mudou'
);

/* ---------- 3) compressão e cache ---------- */
assert.match(rdoSource, /attachmentImageLimits:\{maxSide:1280,quality:\.75\}/,
  'o alvo de compressão (1280 px / 0,75) mudou sem aviso');
assert.match(helpersSource, /compressImageFile\(file, options\)/,
  'U.compressImageFile não está em utils/helpers.js');
assert.match(helpersSource, /resizeImage\(dataUrl, max=256, outputType='image\/png', quality=\.9\)/,
  'U.resizeImage (foto do colaborador) não pode ser alterada');
assert.match(cloudSource, /cacheControl:'31536000'/,
  'o cacheControl longo do bucket de evidências sumiu');
assert.match(cloudSource, /const cached=await cachedAttachment\(path\);\n\s+if\(cached\) return cached;/,
  'downloadRdoAttachment não está consultando o cache');
assert.match(cloudSource, /saveSession\(null\);\n\s+await clearAttachmentCache\(\);/,
  'o cache de evidências precisa ser apagado no signOut');
assert.match(cloudSource, /await forgetAttachment\(String\(row\.objectPath\|\|''\)\);/,
  'anexo removido precisa sair do cache');

console.log('v4.2.19 — compressão, travas e cache das evidências: OK');
