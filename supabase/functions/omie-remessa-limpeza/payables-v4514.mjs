// ---------------------------------------------------------------------------
// CliqueObras v4.5.14 (07/10/2026) — Custo por remessa vale SÓ para material.
//
// Regra (Mauricio, 07/10/2026): nos projetos com custo por remessa, a nota de
// remessa substitui APENAS a categoria "Compras de Material". Todas as outras
// categorias (hospedagem, serviços, frete, combustível, locação, pedágio...)
// continuam vindo do Contas a Pagar, pagas no cartão ou não. Material pago no
// cartão corporativo também continua entrando (regra do cartão da v4.5.7).
//
// Sintoma que levou à mudança: projeto 898 (Omie 2422442455) ativado em
// 06/10 13:38 UTC; a limpeza das 13:55 retirou 29 títulos fora do cartão,
// entre eles 9 hospedagens (R$ 7.640,00). Ficou só a de R$ 270,00 do cartão.
// No total a regra antiga tinha retirado 46 títulos de outras categorias
// (R$ 96.742,98) dos projetos em modo remessa.
//
// Como é aplicada (sem tocar na omie-integration nem na regra antiga):
//  * Retirada: a limpeza continua achando os títulos fora do cartão
//    (nonCardTitleIds/retireEntries da v4.5.10, intocadas), mas só retira o
//    rateio cuja categoria no CliqueObras é "Compras de Material".
//  * Entrada: os títulos fora do cartão desses projetos, que a sincronização
//    pula desde a v4.5.7, são montados aqui com as MESMAS funções da
//    sincronização (cópia literal de omie-integration/logic.mjs, abaixo), sem
//    os rateios de material, e gravados pelas MESMAS RPCs
//    (clique_obras_reconcile_omie_entries + clique_obras_apply_omie_entries),
//    que abatem o planejamento e gravam 'omie_consumed'. A identidade
//    (externalItemId = título:categoriaOmie:índice) é a mesma da sincronização,
//    então nada duplica.
//  * Só vai ao banco o título que mudou (novo, valor/categoria/data/status
//    diferente, rateio removido). Título igual ao gravado não é regravado.
// ---------------------------------------------------------------------------

import {cleanText} from './logic.mjs';

// --- Cópia literal de omie-integration/logic.mjs (produção, versão 4) -------
export function money(value){
  const raw=String(value??'').trim();
  const n=typeof value==='number'?value:Number(raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw);
  return Number.isFinite(n)?Math.round(n*100)/100:0;
}

export function ddmmyyyyToIso(value){
  const match=String(value??'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!match) return /^\d{4}-\d{2}-\d{2}$/.test(String(value??''))?String(value):'';
  return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
}

export function isCancelledStatus(value){
  const normalized=String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase();
  return normalized.includes('CANCEL');
}

export function payableAllocations(payable){
  const total=money(payable?.valor_documento);
  const rateio=Array.isArray(payable?.categorias)?payable.categorias:[];
  if(!rateio.length) return [{code:cleanText(payable?.codigo_categoria,40),value:total,index:0}];
  return rateio.map((item,index)=>{
    const explicit=money(item?.valor);
    const percentage=money(item?.percentual);
    return {code:cleanText(item?.codigo_categoria,40),value:explicit||Math.round(total*percentage)/100,index};
  }).filter(item=>item.code&&item.value!==0);
}

export function buildPayableEntries(payables,projectMappings,categoryMappings,supplierMappings=new Map()){
  const projects=projectMappings instanceof Map?projectMappings:new Map();
  const categories=categoryMappings instanceof Map?categoryMappings:new Map();
  const suppliers=supplierMappings instanceof Map?supplierMappings:new Map();
  const entries=[];
  let skipped=0;
  for(const payable of Array.isArray(payables)?payables:[]){
    const externalId=cleanText(payable?.codigo_lancamento_omie??payable?.codigo_lancamento_integracao,100);
    const projectCode=cleanText(payable?.codigo_projeto,60);
    const project=projects.get(projectCode);
    if(!externalId||!project||project.enabled===false){skipped++;continue;}
    const allocations=payableAllocations(payable);
    if(!allocations.length){skipped++;continue;}
    for(const allocation of allocations){
      const category=categories.get(String(allocation.code));
      if(!category||category.enabled===false){skipped++;continue;}
      const date=ddmmyyyyToIso(payable?.data_emissao)||ddmmyyyyToIso(payable?.data_entrada)||ddmmyyyyToIso(payable?.data_previsao)||ddmmyyyyToIso(payable?.data_vencimento);
      entries.push({
        externalId,
        externalItemId:`${externalId}:${allocation.code}:${allocation.index}`,
        omieProjectCode:projectCode,
        projectId:cleanText(project.cliqueProjectId,180),
        omieCategoryCode:String(allocation.code),
        category:cleanText(category.cliqueCategoryName,160),
        value:Math.abs(money(allocation.value)),
        date,
        supplier:cleanText(
          suppliers.get(String(payable?.codigo_cliente_fornecedor??''))
          ??payable?.nome_fantasia??payable?.nome_fornecedor??payable?.razao_social
          ??`Fornecedor Omie ${payable?.codigo_cliente_fornecedor??''}`,
          180
        ),
        order:cleanText(payable?.numero_documento??payable?.numero_documento_fiscal??payable?.numero_pedido,100),
        description:cleanText(payable?.observacao??payable?.descricao??'Conta a pagar Omie',500),
        status:cleanText(payable?.status_titulo,40),
        active:!isCancelledStatus(payable?.status_titulo),
        sourceType:'omiePayable',
        externalSource:'omie'
      });
    }
  }
  return {entries,skipped};
}

export function batchPayableEntries(entries,max=500){
  const groups=new Map();
  for(const entry of Array.isArray(entries)?entries:[]){
    const key=String(entry?.externalId??'');
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(entry);
  }
  const batches=[];
  let current=[];
  for(const group of groups.values()){
    if(group.length>max) throw new Error('Uma conta a pagar possui rateios acima do limite seguro.');
    if(current.length&&current.length+group.length>max){batches.push(current);current=[];}
    current.push(...group);
  }
  if(current.length) batches.push(current);
  return batches;
}
// --- fim da cópia ------------------------------------------------------------

function plain(value){
  return cleanText(value,180).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
}

// Categoria do CliqueObras (depois do DE-PARA) que a remessa substitui.
// Aceita a grafia do cadastro ("Compras de Material") e variações de número.
export function isMaterialCategoryV4514(name){
  return /^compras? de materia(l|is)$/.test(plain(name));
}

// Retirada: dos lançamentos fora do cartão, só os de material saem.
export function onlyMaterialV4514(entries){
  return (Array.isArray(entries)?entries:[]).filter(entry=>isMaterialCategoryV4514(entry?.category));
}

// Títulos fora do cartão dos projetos em modo remessa (mesmo critério de
// nonCardTitleIds da v4.5.10: conta vazia = fora do cartão).
export function nonCardPayablesV4514(payables,remessaCodes,cardAccounts){
  const codes=remessaCodes instanceof Set?remessaCodes:new Set();
  const cards=cardAccounts instanceof Set?cardAccounts:new Set();
  return (Array.isArray(payables)?payables:[]).filter(row=>{
    if(!codes.has(cleanText(row?.codigo_projeto,60))) return false;
    const account=cleanText(row?.id_conta_corrente,40);
    return !(account&&cards.has(account));
  });
}

// Entrada: monta como a sincronização e tira só os rateios de material.
export function payableEntriesV4514(rows,projectMap,categoryMap,suppliers){
  const built=buildPayableEntries(rows,projectMap,categoryMap,suppliers);
  const entries=[];let material=0;
  for(const entry of built.entries){
    if(isMaterialCategoryV4514(entry.category)){material++;continue;}
    entries.push(entry);
  }
  return {entries,skipped:built.skipped,material};
}

function sameText(a,b){return String(a??'')===String(b??'');}
function sameMoney(a,b){return Math.round((Number(a)||0)*100)===Math.round((Number(b)||0)*100);}

// Só o título que realmente mudou vai ao banco. "stored" = registros
// omiePayable gravados desses títulos (o array que a limpeza já lê).
export function titlesToWriteV4514(entries,stored){
  const byItem=new Map(),byTitle=new Map();
  for(const row of Array.isArray(stored)?stored:[]){
    const data=row&&typeof row==='object'&&row.data?row.data:row;
    if(!data||data.sourceType!=='omiePayable'||data.externalSource!=='omie') continue;
    if(isMaterialCategoryV4514(data.category)) continue; // sai pela retirada
    const itemId=cleanText(data.externalItemId,180),title=cleanText(data.externalId,100);
    if(!itemId||!title) continue;
    byItem.set(itemId,data);
    if(!byTitle.has(title)) byTitle.set(title,new Set());
    byTitle.get(title).add(itemId);
  }
  const groups=new Map();
  for(const entry of Array.isArray(entries)?entries:[]){
    if(!groups.has(entry.externalId)) groups.set(entry.externalId,[]);
    groups.get(entry.externalId).push(entry);
  }
  const out=[];let settled=0;
  for(const [title,list] of groups){
    const wanted=new Set(list.filter(entry=>entry.active&&entry.value>0).map(entry=>entry.externalItemId));
    let changed=false;
    for(const entry of list){
      const current=byItem.get(entry.externalItemId);
      const live=entry.active&&entry.value>0;
      if(!live){ if(current){changed=true;break;} continue; }
      if(!current){changed=true;break;}
      if(!sameText(current.projectId,entry.projectId)||!sameText(current.category,entry.category)||!sameMoney(current.value,entry.value)
        ||!sameText(current.date,entry.date)||!sameText(current.omieStatus,entry.status)||!sameText(current.supplier,entry.supplier)
        ||!sameText(current.order,entry.order)||!sameText(current.desc,entry.description)){changed=true;break;}
    }
    if(!changed) for(const itemId of byTitle.get(title)||[]) if(!wanted.has(itemId)){changed=true;break;}
    if(changed) out.push(...list); else settled++;
  }
  return {entries:out,settled};
}

export function summarizeByCategoryV4514(entries){
  const out={};
  for(const entry of Array.isArray(entries)?entries:[]){
    if(!(entry.active&&entry.value>0)) continue;
    const key=entry.category||'?';
    const current=out[key]||{titles:new Set(),value:0};
    current.titles.add(entry.externalId);
    current.value=Math.round((current.value+entry.value)*100)/100;
    out[key]=current;
  }
  const result={};
  for(const [key,item] of Object.entries(out)) result[key]={titles:item.titles.size,value:item.value};
  return result;
}
