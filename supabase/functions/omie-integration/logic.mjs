export const OMIE_ENDPOINTS = Object.freeze({
  projects:'https://app.omie.com.br/api/v1/geral/projetos/',
  categories:'https://app.omie.com.br/api/v1/geral/categorias/',
  clients:'https://app.omie.com.br/api/v1/geral/clientes/',
  payables:'https://app.omie.com.br/api/v1/financas/contapagar/',
  receivables:'https://app.omie.com.br/api/v1/financas/contareceber/'
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

export function normalizeOmieTime(value){
  const raw=String(value??'').trim();
  const separated=raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const compact=!separated&&raw.match(/^(\d{2})(\d{2})(\d{2})$/);
  const match=separated||compact;
  if(!match) return '';
  const hour=Number(match[1]),minute=Number(match[2]),second=Number(match[3]||0);
  if(hour>23||minute>59||second>59) return '';
  return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second).padStart(2,'0')}`;
}

export function isCancelledStatus(value){
  const normalized=String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  return normalized.includes('CANCEL');
}

// O campo info.dInc é a data de inclusão registrada pelo Omie. Datas como
// emissão, entrada, previsão e vencimento descrevem o título financeiro e não
// o momento em que ele passou a existir no Omie.
export function payableInclusionDate(payable){
  const info=payable&&typeof payable.info==='object'?payable.info:{};
  return ddmmyyyyToIso(info?.dInc??info?.dinc)
    ||ddmmyyyyToIso(info?.data_inclusao)
    ||ddmmyyyyToIso(info?.dataInclusao)
    ||ddmmyyyyToIso(payable?.data_inclusao);
}

export function payableInclusionTime(payable){
  const info=payable&&typeof payable.info==='object'?payable.info:{};
  return normalizeOmieTime(info?.hInc??info?.hora_inclusao??payable?.hora_inclusao);
}

export function payableDates(payable){
  const inclusionDate=payableInclusionDate(payable);
  const inclusionTime=payableInclusionTime(payable);
  return {
    inclusionDate,
    inclusionTime,
    inclusionDateTime:inclusionDate?`${inclusionDate}T${inclusionTime||'00:00:00'}`:'',
    dueDate:ddmmyyyyToIso(payable?.data_vencimento),
    forecastDate:ddmmyyyyToIso(payable?.data_previsao)
  };
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

export function buildPayableEntries(payables,projectMappings,categoryMappings,supplierMappings=new Map(),options={}){
  const projects=projectMappings instanceof Map?projectMappings:new Map();
  const categories=categoryMappings instanceof Map?categoryMappings:new Map();
  const suppliers=supplierMappings instanceof Map?supplierMappings:new Map();
  const today=/^\d{4}-\d{2}-\d{2}$/.test(String(options.today||''))
    ?String(options.today):new Date().toISOString().slice(0,10);
  const entries=[];
  let skipped=0;
  for(const payable of Array.isArray(payables)?payables:[]){
    const externalId=cleanText(payable?.codigo_lancamento_omie??payable?.codigo_lancamento_integracao,100);
    const projectCode=cleanText(payable?.codigo_projeto,60);
    const project=projects.get(projectCode);
    if(!externalId||!project||project.enabled===false){skipped++;continue;}
    const dates=payableDates(payable);
    const active=!isCancelledStatus(payable?.status_titulo);
    // Títulos ativos sem info.dInc não recebem uma data aproximada. Usar
    // vencimento/previsão aqui faria o painel apresentar datas futuras como se
    // fossem inclusões. Cancelamentos continuam sendo processados para que uma
    // conta já importada possa ser reconciliada mesmo em respostas incompletas.
    if(active&&(!dates.inclusionDate||dates.inclusionDate>today)){skipped++;continue;}
    const allocations=payableAllocations(payable);
    if(!allocations.length){skipped++;continue;}
    for(const allocation of allocations){
      const category=categories.get(String(allocation.code));
      if(!category||category.enabled===false){skipped++;continue;}
      entries.push({
        externalId,
        externalItemId:`${externalId}:${allocation.code}:${allocation.index}`,
        omieProjectCode:projectCode,
        projectId:cleanText(project.cliqueProjectId,180),
        omieCategoryCode:String(allocation.code),
        category:cleanText(category.cliqueCategoryName,160),
        value:Math.abs(money(allocation.value)),
        date:dates.inclusionDate,
        omieInclusionDate:dates.inclusionDate,
        omieInclusionTime:dates.inclusionTime,
        omieInclusionDateTime:dates.inclusionDateTime,
        dueDate:dates.dueDate,
        forecastDate:dates.forecastDate,
        supplier:cleanText(
          suppliers.get(String(payable?.codigo_cliente_fornecedor??''))
          ??payable?.nome_fantasia??payable?.nome_fornecedor??payable?.razao_social
          ??`Fornecedor Omie ${payable?.codigo_cliente_fornecedor??''}`,
          180
        ),
        order:cleanText(payable?.numero_documento??payable?.numero_documento_fiscal??payable?.numero_pedido,100),
        description:cleanText(payable?.observacao??payable?.descricao??'Conta a pagar Omie',500),
        status:cleanText(payable?.status_titulo,40),
        active,
        sourceType:'omiePayable',
        externalSource:'omie'
      });
    }
  }
  return {entries,skipped};
}

// ---------------------------------------------------------------------------
// v4.2.0 — Contas a receber.
//
// A regra de situacao segue exatamente a especificacao. A ordem das checagens
// importa: "A RECEBER" contem "RECEB" e precisa ser tratada antes.
//
//   Recebido               -> importa o valor integral
//   Recebido parcialmente  -> importa pendente de conferencia (ver abaixo)
//   Atrasado               -> nao sincroniza
//   A vencer / A receber   -> ignora
//   Cancelado              -> ignora
//   qualquer outro         -> nao sincroniza (padrao seguro)
//
// A API do Omie nao expoe o valor efetivamente baixado em recebimento parcial
// (nem em ListarContasReceber nem em ConsultarContaReceber, onde o bloco
// `recebimento` volta nulo). Por isso um titulo parcial entra com valor zero e
// marcado como pendingAmount: o usuario informa o valor recebido no momento da
// conciliacao, que ja e manual por definicao. Nenhum numero e inventado.
export function receivableDisposition(status){
  const normalized=cleanText(status,60)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  if(!normalized) return 'skip';
  if(normalized.includes('CANCEL')) return 'ignore';
  if(normalized.includes('ATRAS')) return 'skip';
  if(normalized.includes('VENCER')||normalized==='A RECEBER') return 'ignore';
  if(normalized.includes('PARCIAL')) return 'partial';
  if(normalized.includes('RECEB')||normalized.includes('LIQUID')) return 'received';
  return 'skip';
}

export function buildReceivableEntries(titles,projectMappings,customerMappings=new Map()){
  const projects=projectMappings instanceof Map?projectMappings:new Map();
  const customers=customerMappings instanceof Map?customerMappings:new Map();
  const entries=[];
  let skipped=0,ignored=0,unmapped=0;
  for(const title of Array.isArray(titles)?titles:[]){
    const externalId=cleanText(title?.codigo_lancamento_omie??title?.codigo_lancamento_integracao,100);
    const projectCode=cleanText(title?.codigo_projeto,60);
    const project=projects.get(projectCode);
    if(!externalId||!project||project.enabled===false){unmapped++;continue;}
    const disposition=receivableDisposition(title?.status_titulo);
    if(disposition==='ignore'){ignored++;continue;}
    if(disposition==='skip'){skipped++;continue;}
    const pendingAmount=disposition==='partial';
    const date=ddmmyyyyToIso(title?.data_vencimento)
      ||ddmmyyyyToIso(title?.data_previsao)
      ||ddmmyyyyToIso(title?.data_registro)
      ||ddmmyyyyToIso(title?.data_emissao);
    if(!date){skipped++;continue;}
    entries.push({
      externalId,
      omieProjectCode:projectCode,
      projectId:cleanText(project.cliqueProjectId,180),
      value:pendingAmount?0:Math.abs(money(title?.valor_documento)),
      pendingAmount,
      date,
      status:cleanText(title?.status_titulo,40),
      documentNumber:cleanText(
        title?.numero_documento_fiscal??title?.numero_documento??title?.numero_parcela,100
      ),
      customerName:cleanText(customers.get(String(title?.codigo_cliente_fornecedor??''))??'',180),
      notes:cleanText(
        `Titulo Omie ${externalId}`
        +(title?.numero_parcela?` - parcela ${title.numero_parcela}`:'')
        +` - vencimento ${cleanText(title?.data_vencimento,10)}`,
        500
      )
    });
  }
  return {entries,skipped,ignored,unmapped};
}

export function chunk(items,max=500){
  const list=Array.isArray(items)?items:[];
  const batches=[];
  for(let index=0;index<list.length;index+=max) batches.push(list.slice(index,index+max));
  return batches;
}

export function isOmieConcurrentMethodError(value){
  const normalized=cleanText(value instanceof Error?value.message:value,500)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return normalized.includes('ja existe uma requisicao desse metodo sendo executada')
    ||normalized.includes('consumo redundante detectado')
    ||normalized.includes('too many requests');
}

export function omieRetryDelay(attempt,value=''){
  const base=[1500,3000,6000][Math.max(0,Math.min(2,Number(attempt)||0))];
  const message=cleanText(value instanceof Error?value.message:value,500);
  const seconds=Number(message.match(/(?:aguarde|em)\s+(\d+)\s+segundos?/i)?.[1]||0);
  return Math.min(65000,Math.max(base,seconds?1000*(seconds+1):0));
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
