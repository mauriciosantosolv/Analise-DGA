// CliqueObras v4.5.10 — Edge Function NOVA: omie-remessa-limpeza.
// Ver logic.mjs para a causa e a regra. A omie-integration NÃO foi alterada.
//
// Chamada pelo pg_cron (job clique-obras-omie-remessa-limpeza) com o MESMO
// segredo do agendador da sincronização (header x-omie-cron).
//   {"dryRun":true}  → só calcula e registra o que sairia, não apaga nada.
import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { cleanText, isConcurrentMethodError, isEmptyListError, isoToDdMmYyyy, needsFullScan, nonCardTitleIds, retireEntries, summarize } from "./logic.mjs";

const PAYABLES="https://app.omie.com.br/api/v1/financas/contapagar/";
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let lastCallAt=0;

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}

async function omieCall(param:Record<string,unknown>,creds:{app_key:string;app_secret:string}){
  for(let attempt=0;attempt<4;attempt++){
    const wait=Math.max(0,800-(Date.now()-lastCallAt));
    if(wait) await sleep(wait);
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),25000);
    try{
      const response=await fetch(PAYABLES,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({call:"ListarContasPagar",app_key:creds.app_key,app_secret:creds.app_secret,param:[param]}),signal:controller.signal});
      const raw=await response.text();
      let data:Record<string,unknown>={};
      try{data=raw?JSON.parse(raw):{};}catch{throw new Error("O Omie retornou uma resposta inválida.");}
      const fault=cleanText(data.faultstring??data.message,360);
      if(fault&&isEmptyListError(fault)) return {conta_pagar_cadastro:[],total_de_paginas:1};
      if(!response.ok||fault) throw new Error(fault||`Omie indisponível (${response.status}).`);
      return data;
    }catch(error){
      if(attempt<3&&isConcurrentMethodError(error)){await sleep([1500,3000,6000][attempt]);continue;}
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

  const {data:enabledRows,error:listError}=await admin.from("omie_remessa_projects").select("organization_id").eq("enabled",true);
  if(listError) return json({error:"Não foi possível ler os projetos em modo remessa."},500);
  const orgs=[...new Set((enabledRows||[]).map((row:any)=>String(row.organization_id)))];
  const results:Record<string,unknown>[]=[];

  for(const orgId of orgs){
    const details:Record<string,unknown>={dryRun,fullScan:[],incremental:false,omieTitles:0,nonCardTitles:0,retired:{},cancelled:0,unchanged:0};
    let status="success";
    try{
      const [{data:projects,error:projectError},{data:cardRows,error:cardError},{data:connection,error:connectionError}]=await Promise.all([
        admin.from("omie_remessa_projects").select("omie_project_code,clique_project_id,enabled,enabled_at,payables_cleared_at").eq("organization_id",orgId).eq("enabled",true),
        admin.from("omie_card_accounts").select("omie_account_code").eq("organization_id",orgId),
        admin.from("omie_connections").select("initial_sync_date,created_by").eq("organization_id",orgId).eq("active",true).maybeSingle()
      ]);
      if(projectError||cardError||connectionError) throw new Error("Configuração de remessa indisponível.");
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
      // Cada projeto em remessa é lido pelo filtro oficial por projeto, desde a
      // data inicial. Medido em 03/10/2026: 5 projetos = 122 títulos em 5
      // consultas. A consulta da empresa inteira por período devolvia 3.712
      // títulos (8 páginas) mesmo com filtrar_apenas_alteracao — por isso não é
      // usada. Assim também se pega o título que trocou de conta depois.
      for(const code of codes){
        payables.push(...await listPayables({filtrar_por_projeto:Number(code),filtrar_por_data_de:isoToDdMmYyyy(initial),filtrar_por_data_ate:isoToDdMmYyyy(today)},creds));
      }
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
      const entries=retireEntries(purchases,ids,codes);
      details.retired=summarize(entries);
      details.items=entries.slice(0,200).map(entry=>({externalId:entry.externalId,project:entry.omieProjectCode,category:entry.category,value:entry.value,supplier:entry.supplier}));
      if(!dryRun){
        const runId=crypto.randomUUID();
        for(let offset=0;offset<entries.length;offset+=400){
          const batch=entries.slice(offset,offset+400).map(({omieProjectCode,supplier,...entry})=>entry);
          const {data,error}=await admin.rpc("clique_obras_apply_omie_entries",{target_organization_id:orgId,target_actor_id:String(connection.created_by||""),entries:batch,target_sync_run_id:runId});
          if(error) throw new Error(error.message||"Falha ao retirar contas a pagar.");
          details.cancelled=Number(details.cancelled)+(Number((data as any)?.cancelled)||0);
          details.unchanged=Number(details.unchanged)+(Number((data as any)?.unchanged)||0);
        }
        if(full.length){
          const {error}=await admin.from("omie_remessa_projects").update({payables_cleared_at:new Date().toISOString()}).eq("organization_id",orgId).in("omie_project_code",full);
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
