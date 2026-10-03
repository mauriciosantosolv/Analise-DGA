// ---------------------------------------------------------------------------
// CliqueObras v4.5.10 — Limpeza das contas a pagar nos projetos com custo por
// NOTA DE REMESSA (Edge Function NOVA e separada: omie-remessa-limpeza).
//
// Causa corrigida (achada em 03/10/2026): a v4.5.7 só impede que ENTREM contas a
// pagar fora do cartão corporativo. O que já estava importado quando o projeto
// foi ativado nunca saía, porque a sincronização simplesmente deixa de olhar
// para essas contas. Ex.: Oficina de Veículos Canavieiras — 8 títulos,
// R$ 46.193,30, importados 3 minutos antes da ativação.
//
// Regra (Mauricio, 03/10/2026): nos projetos com custo por remessa sai TODA conta
// a pagar fora do cartão, de qualquer data. A saída usa a MESMA rotina de
// cancelamento do Omie (clique_obras_apply_omie_entries com active:false), que
// devolve o valor ao planejamento e grava 'omie_restored'. Desativando a
// remessa do projeto, a sincronização manual traz as contas de volta.
//
// Mesma regra de conta da v4.5.7 (filterPayablesForRemessa em remessa.mjs):
// fica só o título cuja id_conta_corrente está entre as contas marcadas como
// cartão; conta vazia = fora do cartão.
// ---------------------------------------------------------------------------

export function cleanText(value,max=240){
  return String(value??'').replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}

export function isoToDdMmYyyy(value){
  const match=String(value??'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match?`${match[3]}/${match[2]}/${match[1]}`:'';
}

function normalized(value){
  return cleanText(value instanceof Error?value.message:value,500)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}

export function isConcurrentMethodError(value){
  const text=normalized(value);
  return text.includes('ja existe uma requisicao desse metodo sendo executada')
    ||text.includes('consumo redundante detectado')
    ||text.includes('too many requests');
}

export function isEmptyListError(value){
  const text=normalized(value);
  return text.includes('nao existem registros')||text.includes('nenhum registro');
}

// Projeto ainda não limpo desde a (re)ativação → leitura completa do projeto.
export function needsFullScan(row){
  if(!row||row.enabled!==true) return false;
  if(!row.payables_cleared_at) return true;
  const cleared=new Date(row.payables_cleared_at).getTime();
  const enabled=new Date(row.enabled_at||0).getTime();
  return !(cleared>=enabled);
}

// Títulos do Omie, nos projetos em modo remessa, que NÃO são do cartão.
export function nonCardTitleIds(payables,remessaCodes,cardAccounts){
  const codes=remessaCodes instanceof Set?remessaCodes:new Set();
  const cards=cardAccounts instanceof Set?cardAccounts:new Set();
  const ids=new Set();
  for(const row of Array.isArray(payables)?payables:[]){
    const project=cleanText(row?.codigo_projeto,60);
    if(!codes.has(project)) continue;
    const account=cleanText(row?.id_conta_corrente,40);
    if(account&&cards.has(account)) continue;
    const id=cleanText(row?.codigo_lancamento_omie??row?.codigo_lancamento_integracao,100);
    if(id) ids.add(id);
  }
  return ids;
}

// Lançamentos JÁ GRAVADOS no CliqueObras que devem sair. A identidade vem do
// próprio registro (rateio, categoria, valor), exatamente como a limpeza de
// órfãos da v4.2.6 faz — nada é recalculado.
export function retireEntries(purchases,retireIds,remessaCodes){
  const ids=retireIds instanceof Set?retireIds:new Set();
  const codes=remessaCodes instanceof Set?remessaCodes:new Set();
  const entries=[];
  for(const row of Array.isArray(purchases)?purchases:[]){
    const data=row&&typeof row==='object'&&row.data?row.data:row;
    if(!data||data.sourceType!=='omiePayable'||data.externalSource!=='omie') continue;
    const externalId=cleanText(data.externalId,100);
    if(!ids.has(externalId)) continue;
    if(!codes.has(cleanText(data.omieProjectCode,60))) continue;
    const externalItemId=cleanText(data.externalItemId,180);
    if(!externalItemId) continue;
    entries.push({
      externalItemId,externalId,
      projectId:cleanText(data.projectId,180),
      category:cleanText(data.category,180),
      value:Math.abs(Number(data.value)||0),
      active:false,
      externalSource:'omie',
      omieProjectCode:cleanText(data.omieProjectCode,60),
      supplier:cleanText(data.supplier,180)
    });
  }
  return entries;
}

export function summarize(entries){
  const byProject={};
  for(const entry of entries){
    const key=entry.omieProjectCode||'?';
    const current=byProject[key]||{titles:new Set(),records:0,value:0};
    current.titles.add(entry.externalId);current.records++;
    current.value=Math.round((current.value+entry.value)*100)/100;
    byProject[key]=current;
  }
  const out={};
  for(const [key,item] of Object.entries(byProject)) out[key]={titles:item.titles.size,records:item.records,value:item.value};
  return out;
}
