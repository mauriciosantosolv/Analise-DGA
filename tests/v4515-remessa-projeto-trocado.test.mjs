import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {remessaRetirements,nonCardPayableIds,retirePayableEntries,isMaterialCategory} from '../supabase/functions/omie-integration/remessa.mjs';

const rec=(id,project,extra={})=>({data:{sourceType:'omieRemessa',externalSource:'omie',externalItemId:`remessa:${id}`,externalId:`rem-${id}`,omieProjectCode:project,projectId:'p-778',category:'Compras de Material',value:1500,nfNumber:'420',...extra}});

test('NF 420: remessa que mudou para outro projeto no Omie é estornada do projeto antigo',()=>{
  const listed=new Map([['9001','8888']]); // 778 -> 778-ferramental (código 8888)
  const out=remessaRetirements([rec('9001','778')],listed,new Set(),new Set(['778']),false);
  assert.equal(out.entries.length,1);
  assert.deepEqual({id:out.entries[0].externalItemId,active:out.entries[0].active,projectId:out.entries[0].projectId,category:out.entries[0].category,value:out.entries[0].value,sourceType:out.entries[0].sourceType},
    {id:'remessa:9001',active:false,projectId:'p-778',category:'Compras de Material',value:1500,sourceType:'omieRemessa'});
  assert.equal(out.moved[0].reason,'moved'); assert.equal(out.moved[0].toProject,'8888');
});

test('remessa que foi para outro projeto TAMBÉM em escopo não é retirada (a rotina normal relança no novo)',()=>{
  const out=remessaRetirements([rec('9001','778')],new Map([['9001','8888']]),new Set(),new Set(['778','8888']),false);
  assert.equal(out.entries.length,0);
});

test('remessa no mesmo projeto e não produzida (aguardando situação/sem DE-PARA) não é tocada',()=>{
  const out=remessaRetirements([rec('9001','778')],new Map([['9001','778']]),new Set(),new Set(['778']),false);
  assert.equal(out.entries.length,0);
});

test('remessa produzida nesta execução não é retirada',()=>{
  const out=remessaRetirements([rec('9001','778')],new Map([['9001','8888']]),new Set(['remessa:9001']),new Set(['778']),false);
  assert.equal(out.entries.length,0);
});

test('remessa excluída no Omie sai só com listagem completa',()=>{
  assert.equal(remessaRetirements([rec('9001','778')],new Map(),new Set(),new Set(['778']),false).entries.length,1);
  assert.equal(remessaRetirements([rec('9001','778')],new Map(),new Set(),new Set(['778']),true).entries.length,0);
});

test('projeto fora da execução e contas a pagar não são tocados',()=>{
  assert.equal(remessaRetirements([rec('9001','555')],new Map(),new Set(),new Set(['778']),false).entries.length,0);
  const payable={data:{...rec('9001','778').data,sourceType:'omiePayable'}};
  assert.equal(remessaRetirements([payable],new Map(),new Set(),new Set(['778']),false).entries.length,0);
});

test('ativação: só "Compras de Material" fora do cartão sai; cartão e outras categorias ficam (regra v4.5.14)',()=>{
  const payables=[
    {codigo_projeto:'778',id_conta_corrente:'111',codigo_lancamento_omie:'A'},
    {codigo_projeto:'778',id_conta_corrente:'222',codigo_lancamento_omie:'B'},
    {codigo_projeto:'778',codigo_lancamento_omie:'C'},
    {codigo_projeto:'999',id_conta_corrente:'222',codigo_lancamento_omie:'D'}
  ];
  const ids=nonCardPayableIds(payables,new Set(['778']),new Set(['111']));
  assert.deepEqual([...ids].sort(),['B','C']);
  const purchases=['A','B','C'].map(id=>({data:{sourceType:'omiePayable',externalSource:'omie',externalId:id,externalItemId:`${id}:1`,omieProjectCode:'778',projectId:'p',category:'Compras de Material',value:10}}));
  // Caso real (10/11/2026): título 2451387787 do 778, "Compra de Serviços" R$ 400, fora do cartão — FICA.
  purchases.push({data:{sourceType:'omiePayable',externalSource:'omie',externalId:'C',externalItemId:'C:2.01.03:1',omieProjectCode:'778',projectId:'p',category:'Compra de Serviços',value:400}});
  const entries=retirePayableEntries(purchases,ids,new Set(['778']));
  assert.deepEqual(entries.map(e=>e.externalItemId).sort(),['B:1','C:1']);
  assert.ok(entries.every(e=>e.active===false&&e.externalSource==='omie'));
});

test('front: salvar dispara a sincronização dos projetos ativados e o aviso não diz mais que as contas permanecem',()=>{
  const src=fs.readFileSync(new URL('../modules/integracoes/omie-remessa.js',import.meta.url),'utf8');
  assert.match(src,/request\('sync',\{projectCodes:turnedOn\}\)/);
  assert.doesNotMatch(src,/<b>permanecem<\/b> como estão/);
});

test('categoria de material: mesma regra da limpeza v4.5.14',()=>{
  for(const name of ['Compras de Material','Compra de Material','compras de materiais','COMPRAS DE MATERIAL']) assert.equal(isMaterialCategory(name),true,name);
  for(const name of ['Compra de Serviços','Hospedagem','Material de escritório','']) assert.equal(isMaterialCategory(name),false,name);
});

test('caso real 10/11/2026: as 6 remessas que mudaram de projeto no Omie saem dos projetos antigos',()=>{
  const moved=[['2448656608','420','2421160628','2456836137'],['2436483433','368','2421160628','2456836137'],['2436008652','352','2421160628','2448163765'],['2445323883','413','2421160628','2448163765'],['2440824685','385','2433563668','2444707008'],['2440921302','386','2433563668','2167517648']];
  const existing=moved.map(([id,nf,from])=>rec(id,from,{nfNumber:nf}));
  existing.push(rec('2447543127','2433563668',{nfNumber:'417'})); // continua no 927
  const listed=new Map(moved.map(([id,,,to])=>[id,to])); listed.set('2447543127','2433563668');
  const out=remessaRetirements(existing,listed,new Set(),new Set(['2421160628','2433563668']),false);
  assert.deepEqual(out.moved.map(m=>m.nfNumber).sort(),['352','368','385','386','413','420']);
});
