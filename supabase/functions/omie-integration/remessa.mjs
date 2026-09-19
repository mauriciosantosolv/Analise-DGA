// ---------------------------------------------------------------------------
// CliqueObras — Custo por NOTA DE REMESSA (módulo isolado).
//
// v4.5.7 — regras combinadas com o Mauricio (19/09/2026):
//   * Vale SOMENTE para os projetos em que o proprietário ativar "custo por
//     remessa". Os demais projetos (em andamento ou finalizados) continuam
//     exatamente como antes: custo vindo do Contas a Pagar.
//   * Documento de custo: módulo "Remessa de Produtos" do Omie.
//   * A remessa só conta depois de FATURADA (NF emitida), na data da NF.
//     Remessa cancelada no Omie é estornada automaticamente.
//   * Valor = total da NF; categoria = a categoria da remessa, pelo MESMO
//     DE-PARA de categorias que o Contas a Pagar já usa.
//   * Retorno = NOTA DE ENTRADA do Omie que traz a NF da remessa como
//     referenciada. O retorno é ESTORNADO NA REMESSA DE ORIGEM: o custo da
//     remessa passa a ser (total da NF − retornos). Retorno sem referência
//     reconhecível fica PENDENTE (aparece na prévia, não lança).
//   * Nos projetos com remessa, do Contas a Pagar só continua entrando o que
//     foi lançado na conta corrente do CARTÃO CORPORATIVO.
//
// v4.5.8 — nomes EXATOS da API do Omie, conferidos na documentação oficial
// (PDFs salvos pelo Mauricio em 19/09/2026). Nada de "procurar por vários
// nomes": cada campo vem do lugar que o Omie documenta.
//
//   produtos/remessa/     ListarRemessas {nPagina,nRegistrosPorPagina,cExibirDetalhes}
//                         -> remessas[] {cabec{nCodRem,cNumeroRemessa,cCancelado},
//                                        infAdic{cCodCateg,nCodProj,nfRelacionada},
//                                        produtos[]{nQtde,nValUnit,nDesconto}}
//                         StatusRemessa {nCodRem}
//                         -> {cancelada,faturada,nValorTotal,
//                             ListaNfe[]{cNumNFe,cSerieNFe,cChaveNFe,dtEmissao,dtFatura}}
//   produtos/notaentrada/ ListarNotaEnt {nPagina,nRegistrosPorPagina,cExibirDetalhes}
//                         -> notas[] {cabec{nCodNotaEnt,cNumeroNotaEnt},
//                                     infAdic{nCodProj,nfRelacionada{cChaveRef,nNFRef,
//                                             nrNF[]{nrChave}}},totais{nTotalNotaEnt}}
//                         StatusNotaEnt {nCodNotaEnt} -> mesmo formato do StatusRemessa
//   geral/contacorrente/  ListarContasCorrentes {pagina,registros_por_pagina,apenas_importado_api}
//                         -> ListarContasCorrentes[]{nCodCC,descricao,tipo_conta_corrente,inativo}
//   financas/contapagar/  conta_pagar_cadastro.id_conta_corrente (já usado)
// ---------------------------------------------------------------------------

import {cleanText,ddmmyyyyToIso,money} from './logic.mjs';

export const REMESSA_ENDPOINTS = Object.freeze({
  remessa:'https://app.omie.com.br/api/v1/produtos/remessa/',
  notaEntrada:'https://app.omie.com.br/api/v1/produtos/notaentrada/',
  contaCorrente:'https://app.omie.com.br/api/v1/geral/contacorrente/'
});

export const OMIE_REMESSA_API = Object.freeze({
  remessa:{endpoint:REMESSA_ENDPOINTS.remessa,list:'ListarRemessas',listKey:'remessas',status:'StatusRemessa',statusKey:'nCodRem'},
  entrada:{endpoint:REMESSA_ENDPOINTS.notaEntrada,list:'ListarNotaEnt',listKey:'notas',status:'StatusNotaEnt',statusKey:'nCodNotaEnt'},
  conta:{endpoint:REMESSA_ENDPOINTS.contaCorrente,list:'ListarContasCorrentes',listKey:'ListarContasCorrentes'}
});

export const PAGE_SIZE=100;

// Remessa e Nota de Entrada paginam com nPagina/nRegistrosPorPagina e
// devolvem nTotalPaginas; Contas Correntes usa pagina/registros_por_pagina e
// devolve total_de_paginas.
export function remessaListParams(page){return {nPagina:page,nRegistrosPorPagina:PAGE_SIZE,cExibirDetalhes:'S'};}
export function entradaListParams(page){return {nPagina:page,nRegistrosPorPagina:PAGE_SIZE,cExibirDetalhes:'S'};}
export function accountListParams(page){return {pagina:page,registros_por_pagina:PAGE_SIZE,apenas_importado_api:'N'};}

export function listRows(data,listKey){
  const rows=data&&typeof data==='object'?data[listKey]:null;
  return Array.isArray(rows)?rows.filter(row=>row&&typeof row==='object'):[];
}

export function totalPages(data){
  const value=Number(data?.nTotalPaginas??data?.total_de_paginas);
  return Number.isFinite(value)&&value>0?value:1;
}

function flag(value){return cleanText(value,4).toUpperCase()==='S';}
function code(value){const text=cleanText(value,60);return text&&text!=='0'?text:'';}
function nfNumber(value){return cleanText(value,20).replace(/^0+(?=\d)/,'');}
function nfKey(value){const digits=String(value??'').replace(/\D/g,'');return digits.length===44?digits:'';}

export function remessaId(row){return code(row?.cabec?.nCodRem);}
export function entradaId(row){return code(row?.cabec?.nCodNotaEnt);}

// Situação da NF (StatusRemessa / StatusNotaEnt). Se houver mais de uma NF na
// lista (ex.: uma rejeitada e depois a autorizada), vale a que tem chave de
// acesso, e entre elas a mais recente.
export function parseStatus(status){
  if(!status||typeof status!=='object') return null;
  const list=(Array.isArray(status.ListaNfe)?status.ListaNfe:[]).filter(item=>item&&typeof item==='object');
  const withKey=list.filter(item=>nfKey(item.cChaveNFe));
  const pool=withKey.length?withKey:list;
  const byDate=item=>ddmmyyyyToIso(item.dtEmissao)||ddmmyyyyToIso(item.dtFatura)||'';
  const nf=pool.slice().sort((a,b)=>byDate(b).localeCompare(byDate(a)))[0]||null;
  return {
    invoiced:flag(status.faturada),
    cancelled:flag(status.cancelada),
    total:Math.round(Math.abs(money(status.nValorTotal))*100)/100,
    nfNumber:nf?nfNumber(nf.cNumNFe):'',
    nfSerie:nf?cleanText(nf.cSerieNFe,5):'',
    nfKey:nf?nfKey(nf.cChaveNFe):'',
    date:nf?byDate(nf):''
  };
}

function itemsTotal(row){
  let total=0;
  for(const item of Array.isArray(row?.produtos)?row.produtos:[]){
    total+=money(item?.nQtde)*money(item?.nValUnit)-money(item?.nDesconto);
  }
  return Math.round(Math.max(0,total)*100)/100;
}

export function parseRemessa(row,status=null){
  const s=parseStatus(status);
  return {
    id:remessaId(row),
    number:cleanText(row?.cabec?.cNumeroRemessa,15),
    projectCode:code(row?.infAdic?.nCodProj),
    categoryCode:cleanText(row?.infAdic?.cCodCateg,20),
    total:s&&s.total?s.total:itemsTotal(row),
    date:s?s.date:'',
    nfNumber:s?s.nfNumber:'',
    nfKey:s?s.nfKey:'',
    invoiced:!!(s&&s.invoiced),
    cancelled:flag(row?.cabec?.cCancelado)||!!(s&&s.cancelled),
    hasStatus:!!s
  };
}

// NF referenciada (infAdic.nfRelacionada): chave principal, outras NF-e
// relacionadas (nrNF[].nrChave) e o número da NF (nNFRef).
export function referencesOf(row){
  const ref=row?.infAdic?.nfRelacionada;
  const blocks=Array.isArray(ref)?ref:ref&&typeof ref==='object'?[ref]:[];
  const keys=new Set(),numbers=new Set();
  for(const block of blocks){
    const main=nfKey(block?.cChaveRef); if(main) keys.add(main);
    for(const item of Array.isArray(block?.nrNF)?block.nrNF:[]){const key=nfKey(item?.nrChave); if(key) keys.add(key);}
    const number=nfNumber(block?.nNFRef); if(number) numbers.add(number);
  }
  return {keys:[...keys],numbers:[...numbers]};
}

export function parseEntrada(row,status=null){
  const s=parseStatus(status);
  const refs=referencesOf(row);
  const declared=Math.abs(money(row?.totais?.nTotalNotaEnt));
  return {
    id:entradaId(row),
    number:cleanText(row?.cabec?.cNumeroNotaEnt,15),
    projectCode:code(row?.infAdic?.nCodProj),
    nfNumber:s?s.nfNumber:'',
    nfKey:s?s.nfKey:'',
    refKeys:refs.keys,
    refNumbers:refs.numbers,
    total:Math.round(((s&&s.total)||declared||itemsTotal(row))*100)/100,
    date:s?s.date:'',
    invoiced:!!(s&&s.invoiced),
    cancelled:!!(s&&s.cancelled),
    hasStatus:!!s
  };
}

export function parseAccount(row){
  return {
    code:code(row?.nCodCC),
    name:cleanText(row?.descricao,120),
    type:cleanText(row?.tipo_conta_corrente,4),
    inactive:flag(row?.inativo)
  };
}

// A nota de entrada aponta para alguma destas remessas? (usado para decidir
// quais notas precisam da consulta de situação — economiza chamadas).
export function entradaTouches(entradaRow,remessas,scopeCodes){
  const refs=referencesOf(entradaRow);
  const project=code(entradaRow?.infAdic?.nCodProj);
  if(project&&scopeCodes instanceof Set&&scopeCodes.has(project)) return true;
  if(!refs.keys.length&&!refs.numbers.length) return false;
  for(const remessa of remessas){
    if(remessa.nfKey&&refs.keys.includes(remessa.nfKey)) return true;
    if(remessa.nfNumber&&refs.numbers.includes(remessa.nfNumber)) return true;
  }
  return false;
}

// Liga cada retorno (nota de entrada FATURADA e não cancelada) à remessa de
// origem pela NF referenciada: 1º pela chave de acesso (inequívoca); 2º pelo
// número da NF, SOMENTE se ele apontar para uma única remessa.
export function matchReturns(remessas,entradas){
  const byKey=new Map(),byNumber=new Map();
  for(const remessa of remessas){
    if(remessa.nfKey) byKey.set(remessa.nfKey,remessa);
    if(remessa.nfNumber){
      if(!byNumber.has(remessa.nfNumber)) byNumber.set(remessa.nfNumber,[]);
      byNumber.get(remessa.nfNumber).push(remessa);
    }
  }
  const matched=new Map(),unmatched=[],blocked=new Set();
  for(const entrada of entradas){
    if(entrada.hasStatus===true&&(entrada.cancelled||!entrada.invoiced)) continue;
    let origin=null;
    for(const key of entrada.refKeys){ if(byKey.has(key)){origin=byKey.get(key);break;} }
    if(!origin){
      for(const number of entrada.refNumbers){
        const list=byNumber.get(number)||[];
        if(list.length===1){origin=list[0];break;}
      }
    }
    // Nota de entrada ainda sem situação consultada (limite por execução):
    // a remessa de origem espera, para o custo não subir e descer à toa.
    if(entrada.hasStatus!==true){ if(origin) blocked.add(origin.id); continue; }
    if(!origin){
      unmatched.push({id:entrada.id,number:entrada.number,nfNumber:entrada.nfNumber,projectCode:entrada.projectCode,date:entrada.date,total:entrada.total,refKeys:entrada.refKeys.slice(0,3),refNumbers:entrada.refNumbers.slice(0,3)});
      continue;
    }
    if(!matched.has(origin.id)) matched.set(origin.id,[]);
    matched.get(origin.id).push({id:entrada.id,nfNumber:entrada.nfNumber||entrada.number,date:entrada.date,value:entrada.total});
  }
  return {matched,unmatched,blocked};
}

export function buildRemessaEntries(remessas,entradas,projectMappings,categoryMappings,enabledCodes){
  const projects=projectMappings instanceof Map?projectMappings:new Map();
  const categories=categoryMappings instanceof Map?categoryMappings:new Map();
  const enabled=enabledCodes instanceof Set?enabledCodes:new Set();
  const counts={remessas:0,outOfScope:0,notInvoiced:0,noCategory:0,cancelled:0,returnsMatched:0,noId:0,awaitingStatus:0};
  const pending=[];
  const scoped=[];
  for(const remessa of remessas){
    if(!remessa.id){counts.noId++;continue;}
    if(!remessa.projectCode||!enabled.has(remessa.projectCode)){counts.outOfScope++;continue;}
    scoped.push(remessa);
  }
  const {matched,unmatched,blocked}=matchReturns(scoped,entradas);
  const entries=[];
  for(const remessa of scoped){
    counts.remessas++;
    // Sem a situação da NF nesta execução (limite de consultas), a remessa
    // não é tocada: nem lança, nem estorna. Entra na próxima execução.
    if(!remessa.cancelled&&(!remessa.hasStatus||blocked.has(remessa.id))){counts.awaitingStatus++;continue;}
    const project=projects.get(remessa.projectCode);
    if(!project||project.enabled===false){counts.outOfScope++;continue;}
    const category=categories.get(String(remessa.categoryCode));
    const returns=(matched.get(remessa.id)||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const returned=Math.round(returns.reduce((sum,item)=>sum+(Number(item.value)||0),0)*100)/100;
    const net=Math.max(0,Math.round((remessa.total-returned)*100)/100);
    counts.returnsMatched+=returns.length;
    const active=remessa.invoiced&&!remessa.cancelled&&net>0;
    if(!remessa.invoiced&&!remessa.cancelled) counts.notInvoiced++;
    if(remessa.cancelled) counts.cancelled++;
    if(!category||category.enabled===false){
      counts.noCategory++;
      pending.push({id:remessa.id,nfNumber:remessa.nfNumber||remessa.number,categoryCode:remessa.categoryCode,total:remessa.total,reason:'Categoria da remessa sem DE-PARA'});
      continue;
    }
    const nfLabel=remessa.nfNumber?`NF ${remessa.nfNumber}`:`Remessa ${remessa.number||remessa.id}`;
    const returnsLabel=returns.length?` · ${returns.length} retorno(s) estornado(s): ${returns.map(item=>`NF ${item.nfNumber||item.id}`).join(', ')}`:'';
    entries.push({
      externalId:`rem-${remessa.id}`,
      externalItemId:`remessa:${remessa.id}`,
      omieProjectCode:remessa.projectCode,
      projectId:cleanText(project.cliqueProjectId,180),
      omieCategoryCode:String(remessa.categoryCode),
      category:cleanText(category.cliqueCategoryName,160),
      value:net,
      grossValue:remessa.total,
      returnedValue:returned,
      returns:returns.slice(0,50),
      date:remessa.date,
      nfNumber:remessa.nfNumber,
      nfKey:remessa.nfKey,
      supplier:'Remessa para obra',
      order:nfLabel,
      description:cleanText(`Remessa de produtos Omie ${nfLabel}${returnsLabel}`,500),
      status:remessa.cancelled?'CANCELADA':remessa.invoiced?'FATURADA':'NAO FATURADA',
      active,
      externalSource:'omie',
      sourceType:'omieRemessa'
    });
  }
  // Pendência só é "do projeto" quando a nota de entrada é de um projeto
  // ativado — notas de outros projetos não poluem a prévia.
  const unmatchedReturns=unmatched.filter(item=>item.projectCode&&enabled.has(item.projectCode));
  return {entries,counts,pending,unmatchedReturns};
}

// Nos projetos com custo por remessa, do Contas a Pagar só fica o que foi
// lançado na conta corrente do cartão corporativo (id_conta_corrente). Sem
// nenhum projeto em modo remessa a função devolve O MESMO array recebido — o
// fluxo atual fica literalmente intocado.
export function filterPayablesForRemessa(payables,remessaCodes,cardAccounts){
  const list=Array.isArray(payables)?payables:[];
  const codes=remessaCodes instanceof Set?remessaCodes:new Set();
  if(!codes.size) return {kept:list,skipped:0,keptCard:0};
  const cards=cardAccounts instanceof Set?cardAccounts:new Set();
  const kept=[];let skipped=0,keptCard=0;
  for(const row of list){
    const project=cleanText(row?.codigo_projeto,60);
    if(!codes.has(project)){kept.push(row);continue;}
    const account=cleanText(row?.id_conta_corrente,40);
    if(account&&cards.has(account)){kept.push(row);keptCard++;continue;}
    skipped++;
  }
  return {kept,skipped,keptCard};
}

// Situação em cache precisa ser consultada de novo? Nunca consultada, o
// registro mudou no Omie, ainda não faturada (aguardando) ou consultada há
// mais de 24 h (pega cancelamento de NF sem alteração no cadastro).
export function statusIsStale(cached,hash,now=Date.now()){
  if(!cached||!cached.summary) return true;
  if(cached.hash!==hash) return true;
  const s=cached.summary;
  if(!s.invoiced&&!s.cancelled) return true;
  const age=now-new Date(cached.refreshedAt||0).getTime();
  return !(age>=0&&age<24*3600*1000);
}

export function isEmptyListError(value){
  const normalized=cleanText(value instanceof Error?value.message:value,400)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return normalized.includes('nao existem registros')||normalized.includes('nenhum registro');
}

// Formato (chaves e tipos, amostra curta) — usado pelo diagnóstico do
// proprietário. Nunca devolve credenciais: elas não fazem parte da resposta.
export function shapeOf(value,depth=0){
  if(depth>6) return '…';
  if(Array.isArray(value)) return value.length?[shapeOf(value[0],depth+1),`(${value.length} item(ns))`]:[];
  if(value&&typeof value==='object'){
    const out={};
    for(const [key,child] of Object.entries(value).slice(0,80)){
      if(key==='cXmlDistribuicao') {out[key]='(XML omitido)';continue;}
      out[key]=shapeOf(child,depth+1);
    }
    return out;
  }
  if(value===null||value===undefined) return null;
  const text=String(value);
  return `${typeof value}: ${text.length>40?text.slice(0,40)+'…':text}`;
}

export function isMissingTableError(error){
  const errorCode=String(error?.code??'');
  const message=String(error?.message??'').toLowerCase();
  return errorCode==='42P01'||errorCode==='PGRST205'||message.includes('does not exist')||message.includes('could not find the table');
}
