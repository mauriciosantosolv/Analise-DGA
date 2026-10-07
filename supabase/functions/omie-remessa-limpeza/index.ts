// CliqueObras v4.5.10 — Edge Function NOVA: omie-remessa-limpeza.
// Ver logic.mjs para a causa e a regra. A omie-integration NÃO foi alterada.
// v4.5.13 (05/10/2026) — leitura por projeto isolada e espera correta no Omie.
// Ver logic-v4513.mjs. A regra de quem sai (logic.mjs) não mudou.
//
// Chamada pelo pg_cron (job clique-obras-omie-remessa-limpeza) com o MESMO
// segredo do agendador da sincronização (header x-omie-cron).
//   {"dryRun":true}  → só calcula e registra o que sairia, não apaga nada.
// v4.5.14 (07/10/2026) — custo por remessa vale SÓ para "Compras de Material":
// só o rateio de material fora do cartão sai; as outras categorias fora do
// cartão voltam a entrar por aqui. Ver payables-v4514.mjs.
import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { cleanText, isEmptyListError, isoToDdMmYyyy, needsFullScan, nonCardTitleIds, retireEntries, summarize } from "./logic.mjs";
import { BUSY_WAITS_MS, EMPTY_LIST_PAUSE_MS, LIST_DEADLINE_MS, isBusyMethodError, isEmptyListing, isRedundantError, redundantWaitMs } from "./logic-v4513.mjs";
import { batchPayableEntries, nonCardPayablesV4514, onlyMaterialV4514, payableEntriesV4514, summarizeByCategoryV4514, titlesToWriteV4514 } from "./payables-v4514.mjs";

const PAYABLES="https://app.omie.com.br/api/v1/financas/contapagar/";
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let lastCallAt=0;
let nextGapMs=800;
let redundantWaitUsed=false;
let deadlineAt=0;

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}

async function omieCall(param:Record<string,unknown>,creds:{app_key:string;app_secret:string}){
  for(let attempt=0;attempt<=BUSY_WAITS_MS.length;attempt++){
    const wait=Math.max(0,nextGapMs-(Date.now()-lastCallAt));
    if(wait) await sleep(wait);
    nextGapMs=800;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),25000);
    try{
      const response=await fetch(PAYABLES,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({call:"ListarContasPagar",app_key:creds.app_key,app_secret:creds.app_secret,param:[param]}),signal:controller.signal});
      const raw=await response.text();
      let data:Record<string,unknown>={};
      try{data=raw?JSON.parse(raw):{};}catch{throw new Error("O Omie retornou uma resposta inválida.");}
      const fault=cleanText(data.faultstring??data.message,360);
      if(fault&&isEmptyListError(fault)){nextGapMs=EMPTY_LIST_PAUSE_MS;return {conta_pagar_cadastro:[],total_de_paginas:1};}
      if(!response.ok||fault) throw new Error(fault||`Omie indisponível (${response.status}).`);
      if(isEmptyListing(data)) nextGapMs=EMPTY_LIST_PAUSE_MS;
      return data;
    }catch(error){
      if(isRedundantError(error)){
        const pause=redundantWaitMs(error);
        if(redundantWaitUsed||Date.now()+pause>deadlineAt) throw error;
        redundantWaitUsed=true;
        await sleep(pause);
        attempt--;
        continue;
      }
      if(attempt<BUSY_WAITS_MS.length&&isBusyMethodError(error)){await sleep(BUSY_WAITS_MS[attempt]);continue;}
      throw error;
    }finally{clearTimeout(timeout);lastCallAt=Date.now();}
  }
  throw new Error("O Omie não liberou o método no tempo esperado.");
}

async function listPayables(base:Record<string,unknown>,creds:{app_key:string;app_secret:string}){
  const rows:Record<string,unknown>[]=[];
  for(let page=1;page<=60;page++){
    const data=await omieCall({pagina:page,registros_por_pagina:500,apenas_importado_api:"N",filtrar_apenas_inclusao:"N",filtrar_apenas_alteracao:"N",...base},creds);
    const list=Array.isArray(data.conta_pagar_cadastro)?data.conta_pagar_cadastro as Record<string,unknown>[]:[];
    rows.push(...list);
    if(page>=Math.max(1,Number(data.total_de_paginas)||1)||!list.length) break;
  }
  return rows;
}

Deno.serve(async(request:Request)=>{
  if(request.method!=="POST") return json({error:"Método não permitido."},405);
  const url=String(Deno.env.get("SUPABASE_URL")??""),key=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"");
  if(!url||!key) return json({error:"Função não configurada."},500);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=String(request.headers.get("x-omie-cron")??"");
  const {data:valid,error:tokenError}=await admin.rpc("clique_obras_validate_omie_cron",{provided_token:token});
  if(tokenError||valid!==true) return json({error:"Automação não autorizada."},401);
  let payload:{dryRun?:boolean}={};
  try{payload=await request.json();}catch{payload={};}
  const dryRun=payload?.dryRun===true;
  redundantWaitUsed=false;
  deadlineAt=Date.now()+LIST_DEADLINE_MS;

  const {data:enabledRows,error:listError}=await admin.from("omie_remessa_projects").select("organization_id").eq("enabled",true);
  if(listError) return json({error:"Não foi possível ler os projetos em modo remessa."},500);
  const orgs=[...new Set((enabledRows||[]).map((row:any)=>String(row.organization_id)))];
  const results:Record<string,unknown>[]=[];

  for(const orgId of orgs){
    const details:Record<string,unknown>={dryRun,version:"4.5.14",fullScan:[],incremental:false,omieTitles:0,nonCardTitles:0,retired:{},cancelled:0,unchanged:0,projectsRead:0,projectErrors:{},restored:{imported:0,updated:0,cancelled:0,unchanged:0,titles:0,settled:0,material:0,byCategory:{}}};
    let status="success";
    try{
      const [{data:projects,error:projectError},{data:cardRows,error:cardError},{data:connection,error:connectionError}]=await Promise.all([
        admin.from("omie_remessa_projects").select("omie_project_code,clique_project_id,enabled,enabled_at,payables_cleared_at").eq("organization_id",orgId).eq("enabled",true),
        admin.from("omie_card_accounts").select("omie_account_code").eq("organization_id",orgId),
        admin.from("omie_connections").select("initial_sync_date,created_by").eq("organization_id",orgId).eq("active",true).maybeSingle()
      ]);
      if(projectError||cardError||connectionError) throw new Error("Configuração de remessa indisponível.");
      // v4.5.14 — o mesmo DE-PARA que a sincronização usa.
      const [{data:projectMapRows,error:projectMapError},{data:categoryMapRows,error:categoryMapError}]=await Promise.all([
        admin.from("omie_project_mappings").select("omie_project_code,clique_project_id").eq("organization_id",orgId).eq("enabled",true),
        admin.from("omie_category_mappings").select("omie_category_code,clique_category_name").eq("organization_id",orgId).eq("enabled",true)
      ]);
      if(projectMapError||categoryMapError) throw new Error("DE-PARA do Omie indisponível.");
      const projectMap=new Map((projectMapRows||[]).map((row:any)=>[String(row.omie_project_code),{cliqueProjectId:String(row.clique_project_id),enabled:true}]));
      const categoryMap=new Map((categoryMapRows||[]).map((row:any)=>[String(row.omie_category_code),{cliqueCategoryName:String(row.clique_category_name),enabled:true}]));
      if(!connection) throw new Error("Conexão Omie inativa.");
      const codes=new Set<string>((projects||[]).map((row:any)=>String(row.omie_project_code)));
      const cards=new Set<string>((cardRows||[]).map((row:any)=>String(row.omie_account_code)));
      const full=(projects||[]).filter(needsFullScan).map((row:any)=>String(row.omie_project_code));
      details.fullScan=full;
      const {data:credentials,error:credentialError}=await admin.rpc("clique_obras_omie_credentials",{target_organization_id:orgId});
      if(credentialError||!credentials?.app_key||!credentials?.app_secret) throw new Error("Credenciais Omie indisponíveis.");
      const creds={app_key:String(credentials.app_key),app_secret:String(credentials.app_secret)};
      const today=new Date().toISOString().slice(0,10);
      const initial=String(connection.initial_sync_date||today);
      const payables:Record<string,unknown>[]=[];
      const readOk=new Set<string>();
      const projectErrors:Record<string,string>={};
      // Projetos ainda não limpos primeiro; cada um isolado (v4.5.13).
      const order=[...full.filter(code=>codes.has(code)),...[...codes].filter(code=>!full.includes(code))];
      for(const code of order){
        if(Date.now()>deadlineAt){projectErrors[code]="Prazo da execução esgotado; fica para a próxima.";continue;}
        try{
          payables.push(...await listPayables({filtrar_por_projeto:Number(code),filtrar_por_data_de:isoToDdMmYyyy(initial),filtrar_por_data_ate:isoToDdMmYyyy(today),exibir_obs:"S"},creds));
          readOk.add(code);
        }catch(error){
          projectErrors[code]=cleanText(error instanceof Error?error.message:error,200).replace(/app[_ -]?secret\s*[:=]\s*\S+/gi,"credencial protegida");
        }
      }
      details.projectsRead=readOk.size;
      details.projectErrors=projectErrors;
      if(!readOk.size&&codes.size) throw new Error(Object.values(projectErrors)[0]||"Nenhum projeto pôde ser lido no Omie.");
      if(Object.keys(projectErrors).length) status="partial";
      details.incremental=full.length<codes.size;
      details.omieTitles=payables.length;
      const ids=nonCardTitleIds(payables,codes,cards);
      details.nonCardTitles=ids.size;
      const purchases:Record<string,unknown>[]=[];
      const idList=[...ids];
      for(let offset=0;offset<idList.length;offset+=150){
        const {data,error}=await admin.from("app_records").select("data").eq("organization_id",orgId).eq("store","purchases")
          .eq("data->>sourceType","omiePayable").in("data->>externalId",idList.slice(offset,offset+150));
        if(error) throw new Error("Não foi possível ler as contas a pagar gravadas.");
        purchases.push(...(data||[]));
      }
      // v4.5.14 — dos títulos fora do cartão, só o rateio de material sai.
      const entries=onlyMaterialV4514(retireEntries(purchases,ids,codes));
      details.retired=summarize(entries);
      details.items=entries.slice(0,200).map(entry=>({externalId:entry.externalId,project:entry.omieProjectCode,category:entry.category,value:entry.value,supplier:entry.supplier}));
      async function restoreNonMaterial(simulate:boolean){
        const restored=details.restored as Record<string,unknown>;
        const rows=nonCardPayablesV4514(payables,codes,cards);
        const supplierCodes=[...new Set(rows.map(row=>cleanText((row as any).codigo_cliente_fornecedor,60)).filter(Boolean))];
        const suppliers=new Map<string,string>();
        for(let offset=0;offset<supplierCodes.length;offset+=250){
          const {data}=await admin.from("omie_supplier_cache").select("omie_supplier_code,fantasy_name").eq("organization_id",orgId).in("omie_supplier_code",supplierCodes.slice(offset,offset+250));
          for(const row of data||[]){const name=cleanText((row as any).fantasy_name,180);if(name) suppliers.set(String((row as any).omie_supplier_code),name);}
        }
        const built=payableEntriesV4514(rows,projectMap,categoryMap,suppliers);
        const work=titlesToWriteV4514(built.entries,purchases);
        restored.material=built.material;
        restored.settled=work.settled;
        restored.titles=new Set(work.entries.map((entry:any)=>entry.externalId)).size;
        restored.byCategory=summarizeByCategoryV4514(work.entries);
        restored.itemIds=work.entries.slice(0,300).map((entry:any)=>entry.externalItemId);
        if(simulate||!work.entries.length) return;
        const actor=String(connection.created_by||"");
        const runId=crypto.randomUUID();
        for(const batch of batchPayableEntries(work.entries,500)){
          const {data:reconciled,error:reconcileError}=await admin.rpc("clique_obras_reconcile_omie_entries",{target_organization_id:orgId,target_actor_id:actor,entries:batch,target_sync_run_id:runId});
          if(reconcileError) throw new Error(reconcileError.message||"Falha ao reconciliar contas a pagar.");
          restored.cancelled=Number(restored.cancelled)+(Number((reconciled as any)?.cancelled)||0);
          const {data,error}=await admin.rpc("clique_obras_apply_omie_entries",{target_organization_id:orgId,target_actor_id:actor,entries:batch,target_sync_run_id:runId});
          if(error) throw new Error(error.message||"Falha ao trazer contas a pagar de volta.");
          restored.imported=Number(restored.imported)+(Number((data as any)?.imported)||0);
          restored.updated=Number(restored.updated)+(Number((data as any)?.updated)||0);
          restored.cancelled=Number(restored.cancelled)+(Number((data as any)?.cancelled)||0);
          restored.unchanged=Number(restored.unchanged)+(Number((data as any)?.unchanged)||0);
        }
      }
      if(dryRun) await restoreNonMaterial(true);
      if(!dryRun){
        const runId=crypto.randomUUID();
        for(let offset=0;offset<entries.length;offset+=400){
          const batch=entries.slice(offset,offset+400).map(({omieProjectCode,supplier,...entry})=>entry);
          const {data,error}=await admin.rpc("clique_obras_apply_omie_entries",{target_organization_id:orgId,target_actor_id:String(connection.created_by||""),entries:batch,target_sync_run_id:runId});
          if(error) throw new Error(error.message||"Falha ao retirar contas a pagar.");
          details.cancelled=Number(details.cancelled)+(Number((data as any)?.cancelled)||0);
          details.unchanged=Number(details.unchanged)+(Number((data as any)?.unchanged)||0);
        }
        // v4.5.14 — categorias que não são material, fora do cartão, entram
        // pelas MESMAS RPCs da sincronização (abatem o planejamento).
        await restoreNonMaterial(false);
        // Só ganha a marca de "limpo" o projeto que foi lido de verdade.
        const cleared=full.filter(code=>readOk.has(code));
        if(cleared.length){
          const {error}=await admin.from("omie_remessa_projects").update({payables_cleared_at:new Date().toISOString()}).eq("organization_id",orgId).in("omie_project_code",cleared);
          if(error) throw new Error("Não foi possível registrar a limpeza dos projetos.");
        }
      }
    }catch(error){
      status="error";
      details.error=cleanText(error instanceof Error?error.message:error,360).replace(/app[_ -]?secret\s*[:=]\s*\S+/gi,"credencial protegida");
    }
    await admin.from("omie_remessa_cleanup_runs").insert({organization_id:orgId,dry_run:dryRun,status,details});
    results.push({organizationId:orgId,status,...details,items:undefined});
  }
  return json({dryRun,organizations:results});
});
