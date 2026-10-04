// v4.5.7/v4.5.8 — Custo por nota de remessa (Omie).
// v4.5.8: estruturas conforme a documentação oficial do Omie (RemessaProduto,
// NotaEntrada, ContaCorrenteCadastro, LancamentoContaPagar).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {accountListParams,buildRemessaEntries,entradaListParams,entradaTouches,filterPayablesForRemessa,isEmptyListError,isMissingTableError,listRows,matchReturns,OMIE_REMESSA_API,parseAccount,parseEntrada,parseRemessa,parseStatus,referencesOf,remessaListParams,statusIsStale,totalPages} from '../supabase/functions/omie-integration/remessa.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const KEY_A='35260912345678000190550010000012341000012345';
const KEY_B='35260912345678000190550010000012351000012351';
const KEY_RET='35260912345678000190550010000099991000099990';

// remessas[] de ListarRemessas (cExibirDetalhes:'S') — campos da documentação
const remessaRow=(over={})=>({
  cabec:{nCodRem:5001,cCodIntRem:'',nCodCli:77,dPrevisao:'05/09/2026',cNumeroRemessa:'000045',cCancelado:'N',...(over.cabec||{})},
  infAdic:{cCodCateg:'2.01.01',nCodProj:1001,cDadosAdic:'Obra X',...(over.infAdic||{})},
  produtos:[{nCodProd:1,nQtde:10,nValUnit:50,nDesconto:0},{nCodProd:2,nQtde:2,nValUnit:250}]
});
// StatusRemessa
const remessaStatus=(over={})=>({nCodRem:5001,cNumeroRemessa:'000045',cancelada:'N',faturada:'S',cAmbiente:'1',nValorTotal:1000,
  ListaNfe:[{cNumNFe:'000123',cSerieNFe:'1',cChaveNFe:KEY_A,dtEmissao:'10/09/2026',dtFatura:'10/09/2026',cXmlDistribuicao:'<xml/>'}],...over});
// notas[] de ListarNotaEnt
const entradaRow=(over={})=>({
  cabec:{nCodNotaEnt:88,cNumeroNotaEnt:'000012',nCodCli:77,...(over.cabec||{})},
  infAdic:{nCodProj:1001,nfRelacionada:{cChaveRef:KEY_A,nNFRef:'',...(over.ref||{})},...(over.infAdic||{})},
  totais:{nTotalNotaEnt:300}
});
const entradaStatus=(over={})=>({nCodNotaEnt:88,cancelada:'N',faturada:'S',nValorTotal:300,
  ListaNfe:[{cNumNFe:'999',cSerieNFe:'1',cChaveNFe:KEY_RET,dtEmissao:'15/09/2026'}],...over});

test('métodos, chaves de lista e paginação exatamente como a documentação do Omie',()=>{
  assert.equal(OMIE_REMESSA_API.remessa.list,'ListarRemessas');
  assert.equal(OMIE_REMESSA_API.remessa.listKey,'remessas');
  assert.equal(OMIE_REMESSA_API.remessa.status,'StatusRemessa');
  assert.equal(OMIE_REMESSA_API.entrada.list,'ListarNotaEnt');
  assert.equal(OMIE_REMESSA_API.entrada.listKey,'notas');
  assert.equal(OMIE_REMESSA_API.entrada.status,'StatusNotaEnt');
  assert.equal(OMIE_REMESSA_API.conta.list,'ListarContasCorrentes');
  assert.equal(JSON.stringify(remessaListParams(2)),JSON.stringify({nPagina:2,nRegistrosPorPagina:100,cExibirDetalhes:'S'}));
  assert.equal(JSON.stringify(entradaListParams(1)),JSON.stringify({nPagina:1,nRegistrosPorPagina:100,cExibirDetalhes:'S'}));
  assert.equal(JSON.stringify(accountListParams(1)),JSON.stringify({pagina:1,registros_por_pagina:100,apenas_importado_api:'N'}));
  assert.equal(totalPages({nTotalPaginas:3}),3);
  assert.equal(totalPages({total_de_paginas:2}),2);
  assert.equal(listRows({nPagina:1,remessas:[{a:1}]},'remessas').length,1);
  assert.equal(listRows({ListarContasCorrentes:[{nCodCC:1}]},'ListarContasCorrentes').length,1);
  assert.equal(isEmptyListError(new Error('ERROR: Não existem registros para a página [1]!')),true);
});

test('remessa: projeto/categoria de infAdic; NF, valor e faturamento do StatusRemessa',()=>{
  const r=parseRemessa(remessaRow(),remessaStatus());
  assert.equal(r.id,'5001');
  assert.equal(r.number,'000045');
  assert.equal(r.projectCode,'1001');
  assert.equal(r.categoryCode,'2.01.01');
  assert.equal(r.total,1000);
  assert.equal(r.date,'2026-09-10');
  assert.equal(r.nfNumber,'123');
  assert.equal(r.nfKey,KEY_A);
  assert.equal(r.invoiced,true);
  assert.equal(r.cancelled,false);
});

test('remessa sem status não conta como faturada; cCancelado ou cancelada = cancelada; nCodProj 0 = sem projeto',()=>{
  assert.equal(parseRemessa(remessaRow()).invoiced,false);
  assert.equal(parseRemessa(remessaRow()).hasStatus,false);
  assert.equal(parseRemessa(remessaRow({cabec:{cCancelado:'S'}})).cancelled,true);
  assert.equal(parseRemessa(remessaRow(),remessaStatus({cancelada:'S'})).cancelled,true);
  assert.equal(parseRemessa(remessaRow({infAdic:{nCodProj:0}})).projectCode,'');
});

test('NF referenciada DA REMESSA (infAdic.nfRelacionada) não vira a NF dela',()=>{
  const r=parseRemessa(remessaRow({infAdic:{nfRelacionada:{cChaveRef:KEY_B,nNFRef:'555'}}}),remessaStatus({faturada:'N',ListaNfe:[]}));
  assert.equal(r.nfKey,'');
  assert.equal(r.nfNumber,'');
  assert.equal(r.invoiced,false);
});

test('status com mais de uma NF: vale a com chave e mais recente',()=>{
  const s=parseStatus({faturada:'S',nValorTotal:10,ListaNfe:[{cNumNFe:'1',dtEmissao:'11/09/2026'},{cNumNFe:'2',cChaveNFe:KEY_B,dtEmissao:'09/09/2026'},{cNumNFe:'3',cChaveNFe:KEY_A,dtEmissao:'10/09/2026'}]});
  assert.equal(s.nfNumber,'3');
  assert.equal(s.nfKey,KEY_A);
});

test('nota de entrada: referências de nfRelacionada (cChaveRef, nrNF[].nrChave, nNFRef)',()=>{
  const refs=referencesOf(entradaRow({ref:{cChaveRef:KEY_A,nNFRef:'00123',nrNF:[{nrChave:KEY_B}]}}));
  assert.equal(refs.keys.join(','),`${KEY_A},${KEY_B}`);
  assert.equal(refs.numbers.join(','),'123');
  const e=parseEntrada(entradaRow(),entradaStatus());
  assert.equal(e.id,'88');
  assert.equal(e.nfKey,KEY_RET);
  assert.equal(e.total,300);
  assert.equal(e.projectCode,'1001');
  assert.equal(parseEntrada(entradaRow()).total,300,'sem status usa totais.nTotalNotaEnt');
});

test('conta corrente: nCodCC, descricao, tipo_conta_corrente, inativo',()=>{
  const a=parseAccount({nCodCC:4455,descricao:'Cartão Corporativo',tipo_conta_corrente:'CR',inativo:'N'});
  assert.equal(a.code,'4455'); assert.equal(a.name,'Cartão Corporativo'); assert.equal(a.type,'CR'); assert.equal(a.inactive,false);
});

const scopedRemessa=()=>parseRemessa(remessaRow(),remessaStatus());
const projects=new Map([['1001',{cliqueProjectId:'p-remessa',enabled:true}],['2002',{cliqueProjectId:'p-antigo',enabled:true}]]);
const categories=new Map([['2.01.01',{cliqueCategoryName:'Compras de Material',enabled:true}]]);

test('retorno liga pela chave; custo = NF − retorno, estornado na remessa de origem',()=>{
  const built=buildRemessaEntries([scopedRemessa()],[parseEntrada(entradaRow(),entradaStatus())],projects,categories,new Set(['1001']));
  const [entry]=built.entries;
  assert.equal(entry.externalItemId,'remessa:5001');
  assert.equal(entry.sourceType,'omieRemessa');
  assert.equal(entry.grossValue,1000);
  assert.equal(entry.returnedValue,300);
  assert.equal(entry.value,700);
  assert.equal(entry.active,true);
  assert.equal(entry.date,'2026-09-10');
  assert.equal(entry.returns[0].nfNumber,'999');
});

test('retorno pelo número só quando aponta para UMA remessa; ambíguo fica pendente',()=>{
  const r2=parseRemessa(remessaRow({cabec:{nCodRem:5002}}),remessaStatus({ListaNfe:[{cNumNFe:'123',cChaveNFe:KEY_B,dtEmissao:'11/09/2026'}]}));
  const e=parseEntrada(entradaRow({ref:{cChaveRef:'',nNFRef:'123'}}),entradaStatus());
  assert.equal(matchReturns([scopedRemessa(),r2],[e]).matched.size,0);
  assert.equal(matchReturns([scopedRemessa(),r2],[e]).unmatched.length,1);
  assert.equal(matchReturns([scopedRemessa()],[e]).matched.get('5001')[0].value,300);
});

test('retorno cancelado ou não faturado não estorna',()=>{
  assert.equal(matchReturns([scopedRemessa()],[parseEntrada(entradaRow(),entradaStatus({cancelada:'S'}))]).matched.size,0);
  assert.equal(matchReturns([scopedRemessa()],[parseEntrada(entradaRow(),entradaStatus({faturada:'N'}))]).matched.size,0);
});

test('retorno ainda sem status consultado: a remessa de origem ESPERA (não sobe e desce)',()=>{
  const built=buildRemessaEntries([scopedRemessa()],[parseEntrada(entradaRow())],projects,categories,new Set(['1001']));
  assert.equal(built.entries.length,0);
  assert.equal(built.counts.awaitingStatus,1);
});

test('remessa sem status consultado não lança nem estorna; cancelada estorna mesmo sem status',()=>{
  const waiting=buildRemessaEntries([parseRemessa(remessaRow())],[],projects,categories,new Set(['1001']));
  assert.equal(waiting.entries.length,0);
  const cancelled=buildRemessaEntries([parseRemessa(remessaRow({cabec:{cCancelado:'S'}}))],[],projects,categories,new Set(['1001']));
  assert.equal(cancelled.entries[0].active,false);
});

test('retorno total zera a remessa (estorno completo)',()=>{
  const [entry]=buildRemessaEntries([scopedRemessa()],[parseEntrada(entradaRow(),entradaStatus({nValorTotal:1000}))],projects,categories,new Set(['1001'])).entries;
  assert.equal(entry.value,0);
  assert.equal(entry.active,false);
});

test('SÓ projetos ativados; categoria sem DE-PARA fica pendente',()=>{
  const other=parseRemessa(remessaRow({cabec:{nCodRem:6001},infAdic:{nCodProj:2002}}),remessaStatus());
  assert.equal(buildRemessaEntries([other],[],projects,categories,new Set(['1001'])).entries.length,0);
  const noCat=parseRemessa(remessaRow({infAdic:{cCodCateg:'9.99'}}),remessaStatus());
  const built=buildRemessaEntries([noCat],[],projects,categories,new Set(['1001']));
  assert.equal(built.entries.length,0);
  assert.equal(built.pending.length,1);
});

test('entradaTouches: só consulta status de nota que aponta para remessa em escopo ou é de projeto ativado',()=>{
  const remessas=[scopedRemessa()];
  assert.equal(entradaTouches(entradaRow({infAdic:{nCodProj:0}}),remessas,new Set(['1001'])),true,'pela chave');
  assert.equal(entradaTouches(entradaRow({infAdic:{nCodProj:0},ref:{cChaveRef:KEY_B}}),remessas,new Set(['1001'])),false);
  assert.equal(entradaTouches(entradaRow({ref:{cChaveRef:KEY_B}}),remessas,new Set(['1001'])),true,'pelo projeto ativado');
});

test('cache de status: consulta de novo quando nunca consultou, mudou, não faturou ou passou de 24 h',()=>{
  const now=Date.parse('2026-09-20T12:00:00Z');
  const fresh={hash:'h',summary:{invoiced:true,cancelled:false},refreshedAt:'2026-09-20T02:00:00Z'};
  assert.equal(statusIsStale(null,'h',now),true);
  assert.equal(statusIsStale(fresh,'h',now),false);
  assert.equal(statusIsStale(fresh,'outro',now),true);
  assert.equal(statusIsStale({...fresh,summary:{invoiced:false,cancelled:false}},'h',now),true);
  assert.equal(statusIsStale({...fresh,refreshedAt:'2026-09-19T10:00:00Z'},'h',now),true);
});

test('contas a pagar: sem projeto em modo remessa o MESMO array volta intacto',()=>{
  const payables=[{codigo_projeto:1001,id_conta_corrente:1},{codigo_projeto:2002,id_conta_corrente:2}];
  const result=filterPayablesForRemessa(payables,new Set(),new Set(['1']));
  assert.equal(result.kept,payables);
  assert.equal(result.skipped,0);
});

test('contas a pagar: no projeto com remessa só id_conta_corrente do cartão continua; outros projetos intocados',()=>{
  const payables=[
    {codigo_lancamento_omie:1,codigo_projeto:1001,id_conta_corrente:555},
    {codigo_lancamento_omie:2,codigo_projeto:1001,id_conta_corrente:777},
    {codigo_lancamento_omie:3,codigo_projeto:1001},
    {codigo_lancamento_omie:4,codigo_projeto:2002,id_conta_corrente:777}
  ];
  const result=filterPayablesForRemessa(payables,new Set(['1001']),new Set(['555']));
  assert.equal(result.kept.map(row=>row.codigo_lancamento_omie).join(','),'1,4');
  assert.equal(result.skipped,2);
  assert.equal(result.keptCard,1);
  assert.equal(isMissingTableError({code:'PGRST205'}),true);
});

test('Edge Function: remessa é etapa nova e isolada; contas a pagar usam a lista filtrada',()=>{
  const edge=read('supabase/functions/omie-integration/index.ts');
  assert(edge.includes('supplierDirectory(orgId,payableSplit.kept,creds)'));
  assert(edge.includes('buildPayableEntries(payableSplit.kept,projectMap,categoryMap,suppliers.names)'));
  assert(edge.includes('received:payables.length'),'o total recebido do Omie continua sendo o bruto');
  assert(edge.includes('present_ids:presentIds')&&edge.includes('payables.map(row=>cleanText(row.codigo_lancamento_omie'),'os órfãos continuam medidos contra a lista BRUTA — filtrar não vira exclusão');
  assert(edge.includes('clique_obras_apply_omie_remessas_v457'));
  assert(edge.includes('remessas.error=safeOmieError(error)'),'falha de remessa não derruba a sincronização');
  assert(edge.includes('if(remessaCodes.size)'),'sem projeto ativado a etapa nem roda');
  assert(edge.includes('collectRemessas(orgId,creds,remessaCodes)'),'a sincronização só lê remessas dos projetos ativados');
  assert(!/ListarNotasEntrada|ConsultarRemessa|nRegPorPagina/.test(edge+read('supabase/functions/omie-integration/remessa.mjs')),'nenhum nome adivinhado sobrou');
  assert(edge.includes('isMissingTableError(projectError)'),'SQL ainda não aplicado = regra atual');
});

test('SQL: não altera nenhuma função existente; a nova grava omieRemessa (fora da caça a órfãos)',()=>{
  const sql=read('supabase/ATUALIZACAO-v4.5.7-OMIE-REMESSA.sql');
  assert(!/create or replace function public\.clique_obras_apply_omie_entries\(/.test(sql));
  assert(!/clique_obras_reconcile_omie_entries|clique_obras_omie_orphan_candidates_v426\(/.test(sql.replace(/--.*$/gm,'')));
  assert(sql.includes("'sourceType','omieRemessa'"));
  assert(!sql.includes("'omiePayable'"));
  assert(sql.includes("purchase_id:='omie-rm-'"));
  assert(sql.includes("left(item_id,8)<>'remessa:'"),'a rotina nova recusa identidade de conta a pagar');
  const orphan=read('supabase/ATUALIZACAO-v4.2.6-OMIE-ORFAOS.sql');
  assert(orphan.includes("coalesce(record.data->>'sourceType', '') = 'omiePayable'"),'órfãos só olham conta a pagar');
});

test('front: módulo novo carregado depois de compras, painel e Omie; omie.js não é tocado',()=>{
  const html=read('index.html');
  const pos=name=>html.indexOf(`src="${name}?v=`);
  assert(pos('modules/integracoes/omie-remessa.js')>pos('modules/integracoes/omie.js'));
  assert(pos('modules/integracoes/omie-remessa.js')>pos('modules/compras/compras.js'));
  assert(pos('modules/integracoes/omie-remessa.js')>pos('modules/dashboard/panel-tv.js'));
  assert(!read('modules/integracoes/omie.js').includes('remessa'));
});

test('front: rótulo "Omie · remessa" sem mudar o rótulo de nenhum outro lançamento',()=>{
  const source=read('modules/integracoes/omie-remessa.js');
  const original={sourceTag(x){return `ORIG:${x.sourceType}`;}};
  const panel={sourceLabel(entry){return `ORIGP:${entry.sourceType}`;}};
  const context=vm.createContext({Views:{financeiro:original},DashboardPanel:panel,OmieIntegration:{render(){return 'R';},state:null},document:{},U:{},UI:{},console});
  vm.runInContext(`${source}\n;globalThis.OmieRemessa=OmieRemessa;`,context);
  assert.equal(context.Views.financeiro.sourceTag({sourceType:'omiePayable'}),'ORIG:omiePayable');
  assert.equal(context.Views.financeiro.sourceTag({sourceType:'labor'}),'ORIG:labor');
  assert.match(context.Views.financeiro.sourceTag({sourceType:'omieRemessa'}),/Omie · remessa/);
  assert.equal(context.DashboardPanel.sourceLabel({sourceType:'purchase'}),'ORIGP:purchase');
  assert.equal(context.DashboardPanel.sourceLabel({sourceType:'omieRemessa'}),'Omie · remessa');
  assert.equal(context.OmieIntegration.render(),'R','o render original continua respondendo');
  vm.runInContext('OmieRemessa.install()',context);
  assert.equal(context.Views.financeiro.sourceTag({sourceType:'omieRemessa'}).match(/Omie · remessa/g).length,1,'instalar duas vezes não empilha');
});
