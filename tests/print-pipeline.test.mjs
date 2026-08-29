/**
 * v4.2.8 — pipeline único de impressão (Exports.beginPrint / finishPrint).
 *
 * Reproduz, com um DOM mínimo, os três cenários que faziam o PDF sair errado
 * na primeira geração e voltar certo na segunda:
 *   1. resquício de uma impressão anterior cujo afterprint nunca chegou;
 *   2. afterprint precoce (o Chrome dispara ao trocar de pré-visualização) —
 *      era ele que tirava a classe printing-rdo no instante do retrato da
 *      página e fazia o PDF sair com a TELA no lugar do documento;
 *   3. dois cliques seguidos no botão "Gerar PDF".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../utils/export.js', import.meta.url), 'utf8');

function makeDom(){
  const nodes = new Map();
  const bodyClasses = new Set();
  const listeners = new Map();
  const node = id => ({ id, querySelectorAll: () => [], remove(){ nodes.delete(id); } });
  const ctx = {
    console, setTimeout, clearTimeout,
    requestAnimationFrame: cb => setTimeout(cb, 0),
    document:{
      body:{
        classList:{
          add: c => bodyClasses.add(c),
          remove: c => bodyClasses.delete(c),
          contains: c => bodyClasses.has(c)
        },
        querySelectorAll: () => []
      },
      getElementById: id => nodes.get(id) || null,
      querySelectorAll: () => []
    },
    window:{
      addEventListener(type, fn){ if(!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      removeEventListener(type, fn){
        const list = listeners.get(type) || [];
        const index = list.indexOf(fn);
        if(index >= 0) list.splice(index, 1);
      },
      matchMedia: () => ({ matches:false, addEventListener(){}, removeEventListener(){} }),
      print(){ ctx.__printed.push({ classes:[...bodyClasses], reports:[...nodes.keys()] }); }
    },
    __printed: [],
    __bodyClasses: bodyClasses,
    __nodes: nodes,
    __fire: (type, event = {}) => [...(listeners.get(type) || [])].forEach(fn => fn(event)),
    __addNode: id => { nodes.set(id, node(id)); return nodes.get(id); }
  };
  vm.createContext(ctx);
  vm.runInContext(source + '\n;globalThis.Exports=Exports;', ctx);
  return ctx;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 200));

test('resquício de uma impressão anterior não contamina a próxima', async () => {
  const ctx = makeDom();
  ctx.__bodyClasses.add('printing-measurement');      // afterprint que nunca chegou
  ctx.__addNode('measurement-print-report');
  const report = ctx.__addNode('rdo-print-report');
  await ctx.Exports.beginPrint('printing-rdo', report);
  await tick();
  assert.equal(ctx.__printed.length, 1);
  assert.deepEqual(ctx.__printed[0].classes, ['printing-rdo']);
  assert.deepEqual(ctx.__printed[0].reports, ['rdo-print-report']);
  ctx.Exports.finishPrint();
});

test('afterprint precoce não apaga a classe antes do retrato da página', async () => {
  const ctx = makeDom();
  const report = ctx.__addNode('rdo-print-report');
  await ctx.Exports.beginPrint('printing-rdo', report);
  ctx.__fire('afterprint');
  await tick();
  assert.equal(ctx.__printed.length, 1);
  assert.deepEqual(ctx.__printed[0].classes, ['printing-rdo'], 'a classe tem de sobreviver ao afterprint precoce');
  assert.deepEqual(ctx.__printed[0].reports, ['rdo-print-report']);
  ctx.Exports.finishPrint();
});

test('afterprint de verdade limpa a classe e o relatório', async () => {
  const ctx = makeDom();
  const report = ctx.__addNode('rdo-print-report');
  await ctx.Exports.beginPrint('printing-rdo', report);
  await tick();
  ctx.__fire('beforeprint');
  ctx.__fire('afterprint');
  assert.deepEqual([...ctx.__bodyClasses], []);
  assert.equal(ctx.__nodes.has('rdo-print-report'), false);
  ctx.Exports.finishPrint();
});

test('dois cliques seguidos imprimem uma vez só', async () => {
  const ctx = makeDom();
  const first = ctx.__addNode('rdo-print-report');
  const one = ctx.Exports.beginPrint('printing-rdo', first);
  const second = ctx.__addNode('rdo-print-report');
  const two = ctx.Exports.beginPrint('printing-rdo', second);
  await Promise.all([one, two]);
  await tick();
  assert.equal(ctx.__printed.length, 1, 'o window.print() pendente do primeiro clique é cancelado');
  assert.deepEqual(ctx.__printed[0].classes, ['printing-rdo']);
  ctx.Exports.finishPrint();
});
