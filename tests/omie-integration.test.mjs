import assert from 'node:assert/strict';
import {batchPayableEntries,buildPayableEntries,ddmmyyyyToIso,isOmieConcurrentMethodError,omieRetryDelay,payableAllocations,payableInclusionDate,safeOmieError} from '../supabase/functions/omie-integration/logic.mjs';

assert.equal(ddmmyyyyToIso('14/08/2026'),'2026-08-14');
assert.equal(payableInclusionDate({info:{dInc:'15/08/2026'},data_entrada:'12/08/2026',data_emissao:'10/08/2026'}),'2026-08-15');
assert.equal(payableInclusionDate({data_entrada:'14/08/2026',data_emissao:'10/08/2026'}),'2026-08-14');
assert.deepEqual(payableAllocations({valor_documento:100,categorias:[
  {codigo_categoria:'2.01.01',percentual:60},{codigo_categoria:'2.02.02',valor:40}
]}),[
  {code:'2.01.01',value:60,index:0},{code:'2.02.02',value:40,index:1}
]);

const projects=new Map([
  ['1001',{cliqueProjectId:'click-815-usf',enabled:true}],
  ['1002',{cliqueProjectId:'click-815-urd',enabled:true}]
]);
const categories=new Map([
  ['2.01.01',{cliqueCategoryName:'Compras de Material',enabled:true}],
  ['2.02.02',{cliqueCategoryName:'Hospedagem',enabled:true}]
]);
const payables=[
  {codigo_lancamento_omie:900,codigo_projeto:1001,valor_documento:100,codigo_categoria:'2.01.01',info:{dInc:'15/08/2026'},data_emissao:'14/08/2026',status_titulo:'EMABERTO'},
  {codigo_lancamento_omie:901,codigo_projeto:1002,valor_documento:200,categorias:[{codigo_categoria:'2.01.01',percentual:75},{codigo_categoria:'2.02.02',percentual:25}],status_titulo:'CANCELADO'}
];
const result=buildPayableEntries(payables,projects,categories);
assert.equal(result.skipped,0);
assert.equal(result.entries.length,3);
assert.equal(result.entries[0].projectId,'click-815-usf');
assert.equal(result.entries[0].date,'2026-08-15');
assert.equal(result.entries[1].projectId,'click-815-urd');
assert.equal(result.entries[1].value,150);
assert.equal(result.entries[2].value,50);
assert.equal(result.entries[1].active,false);
assert.notEqual(result.entries[0].externalItemId,result.entries[1].externalItemId);

const suppliers=new Map([['24040','Depósito Aurora']]);
const fantasy=buildPayableEntries([{
  codigo_lancamento_omie:902,codigo_projeto:1001,codigo_cliente_fornecedor:24040,
  nome_fornecedor:'Razão Social Antiga',valor_documento:75,codigo_categoria:'2.01.01'
}],projects,categories,suppliers);
assert.equal(fantasy.entries[0].supplier,'Depósito Aurora');

const unmapped=buildPayableEntries([{codigo_lancamento_omie:1,codigo_projeto:999,valor_documento:10,codigo_categoria:'2.01.01'}],projects,categories);
assert.equal(unmapped.entries.length,0);
assert.equal(unmapped.skipped,1);
assert.equal(safeOmieError('app_secret=super-segredo app_key=abc123'),'credencial protegida chave protegida');
assert.equal(isOmieConcurrentMethodError('ERROR: Já existe uma requisição desse método sendo executada e você pode tentar novamente.'),true);
assert.equal(isOmieConcurrentMethodError('ERROR: Consumo redundante detectado. Aguarde 56 segundos para tentar novamente.'),true);
assert.equal(isOmieConcurrentMethodError('Credencial inválida'),false);
assert.deepEqual([0,1,2].map(attempt=>omieRetryDelay(attempt)),[1500,3000,6000]);
assert.equal(omieRetryDelay(0,'Aguarde 56 segundos para tentar novamente.'),57000);

const batches=batchPayableEntries([
  {externalId:'a',externalItemId:'a:1'},
  {externalId:'a',externalItemId:'a:2'},
  {externalId:'b',externalItemId:'b:1'}
],2);
assert.deepEqual(batches.map(batch=>batch.map(item=>item.externalId)),[['a','a'],['b']]);

console.log('Omie integration mapping tests passed');
