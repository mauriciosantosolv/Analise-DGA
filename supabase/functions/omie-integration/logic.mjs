export const OMIE_ENDPOINTS = Object.freeze({
  projects:'https://app.omie.com.br/api/v1/geral/projetos/',
  categories:'https://app.omie.com.br/api/v1/geral/categorias/',
  payables:'https://app.omie.com.br/api/v1/financas/contapagar/'
});

export function cleanText(value,max=240){
  return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}

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

export function isoToDdMmYyyy(value){
  const match=String(value??'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match?`${match[3]}/${match[2]}/${match[1]}`:'';
}

export function isCancelledStatus(value){
  const normalized=String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
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

export function buildPayableEntries(payables,projectMappings,categoryMappings){
  const projects=projectMappings instanceof Map?projectMappings:new Map();
  const categories=categoryMappings instanceof Map?categoryMappings:new Map();
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
        supplier:cleanText(payable?.nome_fornecedor??payable?.razao_social??payable?.nome_fantasia??`Fornecedor Omie ${payable?.codigo_cliente_fornecedor??''}`,180),
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

// Mantém todas as parcelas da mesma conta a pagar no mesmo lote. Assim, a
// reconciliação consegue remover rateios antigos sem interpretar uma quebra de
// lote como exclusão de categoria.
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

export function safeOmieError(value){
  const message=cleanText(value instanceof Error?value.message:value,360);
  return message.replace(/app[_ -]?secret\s*[:=]\s*\S+/gi,'credencial protegida')
    .replace(/app[_ -]?key\s*[:=]\s*\S+/gi,'chave protegida');
}
