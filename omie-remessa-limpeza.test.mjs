import test from 'node:test';
import assert from 'node:assert/strict';
import {needsFullScan,nonCardTitleIds,retireEntries,summarize} from '../supabase/functions/omie-remessa-limpeza/logic.mjs';

const codes=new Set(['2433563668']);
const cards=new Set(['2204276461','2200162059']);
const omie=[
  {codigo_lancamento_omie:2435371808,codigo_projeto:'2433563668',id_conta_corrente:2189071352}, // fora do cartão
  {codigo_lancamento_omie:2435517486,codigo_projeto:'2433563668',id_conta_corrente:2204276461}, // cartão
  {codigo_lancamento_omie:2436000001,codigo_projeto:'2433563668',id_conta_corrente:''},         // sem conta = fora
  {codigo_lancamento_omie:2499999999,codigo_projeto:'9999999999',id_conta_corrente:2189071352}  // outro projeto
];

test('mesma regra de conta da v4.5.7: só sai o que não é cartão, só nos projetos em remessa',()=>{
  assert.equal([...nonCardTitleIds(omie,codes,cards)].sort().join(','),'2435371808,2436000001');
});

test('retira pela identidade gravada (rateio, categoria, valor) e só omiePayable',()=>{
  const stored=[
    {data:{sourceType:'omiePayable',externalSource:'omie',externalId:'2435371808',externalItemId:'2435371808:2.01.02:0',projectId:'p1',category:'Compras de Material',value:33317,omieProjectCode:'2433563668'}},
    {data:{sourceType:'omiePayable',externalSource:'omie',externalId:'2435517486',externalItemId:'2435517486:2.01.98:0',projectId:'p1',category:'Alimentação',value:173.28,omieProjectCode:'2433563668'}},
    {data:{sourceType:'omieRemessa',externalSource:'omie',externalId:'2435371808',externalItemId:'remessa:1',projectId:'p1',category:'Compras de Material',value:10,omieProjectCode:'2433563668'}},
    {data:{sourceType:'omiePayable',externalSource:'omie',externalId:'2435371808',externalItemId:'x',projectId:'p2',category:'Frete',value:5,omieProjectCode:'1111'}}
  ];
  const entries=retireEntries(stored,nonCardTitleIds(omie,codes,cards),codes);
  assert.equal(entries.length,1);
  assert.equal(entries[0].externalItemId,'2435371808:2.01.02:0');
  assert.equal(entries[0].active,false);
  assert.equal(entries[0].value,33317);
  assert.deepEqual(JSON.parse(JSON.stringify(summarize(entries))),{'2433563668':{titles:1,records:1,value:33317}});
});

test('leitura completa só quando o projeto ainda não foi limpo desde a (re)ativação',()=>{
  assert.equal(needsFullScan({enabled:true,enabled_at:'2026-10-01T20:39:42Z',payables_cleared_at:null}),true);
  assert.equal(needsFullScan({enabled:true,enabled_at:'2026-10-01T20:39:42Z',payables_cleared_at:'2026-10-03T15:00:00Z'}),false);
  assert.equal(needsFullScan({enabled:true,enabled_at:'2026-10-04T10:00:00Z',payables_cleared_at:'2026-10-03T15:00:00Z'}),true);
  assert.equal(needsFullScan({enabled:false,enabled_at:null,payables_cleared_at:null}),false);
});
