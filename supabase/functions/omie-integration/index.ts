import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { enforceRateLimit, json, preflight, readJson, rejectUntrustedOrigin } from "../_shared/security.ts";
import { batchPayableEntries, buildPayableEntries, cleanText, isoToDdMmYyyy, isOmieConcurrentMethodError, omieRetryDelay, OMIE_ENDPOINTS, safeOmieError } from "./logic.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=new Set(["status","connect","catalog","save-config","sync","disconnect","scheduled"]);

type Payload={
  action?:string; organizationId?:string; appKey?:string; appSecret?:string;
  initialSyncDate?:string; autoSync?:boolean; autoIntervalMinutes?:number;
  projectMappings?:unknown[]; categoryMappings?:unknown[]; projectCodes?:string[];
};

function env(name:string){return String(Deno.env.get(name)??"");}
const omieMethodFinishedAt=new Map<string,number>();
const sleep=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));

async function waitForOmieMethod(credentials:{app_key:string},endpoint:string,call:string){
  const key=`${credentials.app_key}:${endpoint}:${call}`;
  const wait=Math.max(0,700-(Date.now()-(omieMethodFinishedAt.get(key)||0)));
  if(wait) await sleep(wait);
  return key;
}

async function omieCall(endpoint:string,call:string,param:Record<string,unknown>,credentials:{app_key:string;app_secret:string}){
  for(let attempt=0;attempt<4;attempt++){
    const methodKey=await waitForOmieMethod(credentials,endpoint,call);
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),25000);
    try{
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({call,app_key:credentials.app_key,app_secret:credentials.app_secret,param:[param]}),signal:controller.signal});
      const raw=await response.text();
      if(new TextEncoder().encode(raw).byteLength>8*1024*1024) throw new Error("Resposta do Omie excedeu o limite seguro.");
      let data:Record<string,unknown>={};
      try{data=raw?JSON.parse(raw):{};}catch{throw new Error("O Omie retornou uma resposta inválida.");}
      const fault=cleanText(data.faultstring??data.message??data.error_description,360);
      if(!response.ok||fault) throw new Error(fault||`Omie indisponível (${response.status}).`);
      return data;
    }catch(error){
      if(error instanceof DOMException&&error.name==="AbortError") throw new Error("O Omie excedeu o tempo de resposta.");
      if(attempt<3&&isOmieConcurrentMethodError(error)){
        await sleep(omieRetryDelay(attempt,error));
        continue;
      }
      throw error;
    }finally{
      clearTimeout(timeout);
      omieMethodFinishedAt.set(methodKey,Date.now());
    }
  }
  throw new Error("O Omie não liberou o método de consulta no tempo esperado.");
}

async function pagedOmie(endpoint:string,call:string,listKey:string,base:Record<string,unknown>,credentials:{app_key:string;app_secret:string},maxPages=100){
  const out:Record<string,unknown>[]=[];
  for(let page=1;page<=maxPages;page++){
    const data=await omieCall(endpoint,call,{pagina:page,registros_por_pagina:500,...base},credentials);
    const rows=Array.isArray(data[listKey])?data[listKey] as Record<string,unknown>[]:[];
    out.push(...rows);
    const total=Math.max(1,Number(data.total_de_paginas)||1);
    if(page>=total||!rows.length) break;
  }
  if(out.length>50000) throw new Error("A consulta do Omie excedeu o limite de 50 mil registros.");
  return out;
}

function mapConnection(row:any){
  if(!row) return null;
  return {appKeyHint:row.app_key_hint,autoSync:row.auto_sync,autoIntervalMinutes:row.auto_interval_minutes,
    initialSyncDate:row.initial_sync_date,lastSyncAt:row.last_sync_at,lastSyncAttemptAt:row.last_sync_attempt_at,lastSyncStatus:row.last_sync_status,
    lastSyncError:row.last_sync_error,connectedAt:row.connected_at};
}

function mapProject(row:any){return {omieProjectCode:String(row.omie_project_code),omieProjectName:row.omie_project_name,cliqueProjectId:row.clique_project_id,enabled:row.enabled};}
function mapCategory(row:any){return {omieCategoryCode:String(row.omie_category_code),omieCategoryName:row.omie_category_name,cliqueCategoryId:row.clique_category_id,cliqueCategoryName:row.clique_category_name,enabled:row.enabled};}

Deno.serve(async(request:Request)=>{
  if(request.method==="OPTIONS") return preflight(request);
  const originError=rejectUntrustedOrigin(request); if(originError) return originError;
  if(request.method!=="POST") return json(request,{error:"Método não permitido."},405);
  let payload:Payload;
  try{payload=await readJson<Payload>(request,262144);}catch(error){
    const code=error instanceof Error?error.message:"INVALID_JSON";
    return json(request,{error:"Solicitação inválida."},code==="BODY_TOO_LARGE"?413:code==="CONTENT_TYPE"?415:400);
  }
  const action=String(payload.action??"");
  if(!ACTIONS.has(action)) return json(request,{error:"Operação inválida."},400);
  const supabaseUrl=env("SUPABASE_URL"),publicKey=env("SUPABASE_ANON_KEY")||env("SUPABASE_PUBLISHABLE_KEY"),serviceKey=env("SUPABASE_SERVICE_ROLE_KEY");
  if(!supabaseUrl||!publicKey||!serviceKey) return json(request,{error:"Integração não configurada."},500);
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

  let organizationId=cleanText(payload.organizationId,60),actorId="";
  if(action==="scheduled"){
    const token=String(request.headers.get("x-omie-cron")??"");
    const {data:valid,error}=await admin.rpc("clique_obras_validate_omie_cron",{provided_token:token});
    if(error||valid!==true) return json(request,{error:"Automação não autorizada."},401);
  }else{
    const authorization=String(request.headers.get("Authorization")??"");
    if(!authorization.startsWith("Bearer ")) return json(request,{error:"Sessão obrigatória."},401);
    if(!UUID.test(organizationId)) return json(request,{error:"Organização inválida."},400);
    const caller=createClient(supabaseUrl,publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization}}});
    const {data:authData,error:authError}=await caller.auth.getUser();
    if(authError||!authData.user) return json(request,{error:"Sessão inválida."},401);
    actorId=authData.user.id;
    const {data:membership,error:membershipError}=await caller.from("organization_members").select("role").eq("organization_id",organizationId).eq("user_id",actorId).maybeSingle();
    if(membershipError||!membership||membership.role!=="owner") return json(request,{error:"Somente o proprietário pode administrar a integração Omie."},403);
    try{
      const limit=await enforceRateLimit(admin,actorId,`omie-${action}`,action==="sync"?8:30,60);
      if(!limit.allowed) return json(request,{error:"Muitas solicitações ao Omie. Aguarde e tente novamente."},429,{"Retry-After":String(limit.retryAfter)});
    }catch{return json(request,{error:"Proteção de requisições indisponível."},503);}
  }

  async function credentials(orgId:string){
    const {data,error}=await admin.rpc("clique_obras_omie_credentials",{target_organization_id:orgId});
    if(error||!data?.app_key||!data?.app_secret) throw new Error("A conexão Omie não está configurada.");
    return {app_key:String(data.app_key),app_secret:String(data.app_secret)};
  }

  async function status(orgId:string){
    const [{data:connection,error:connectionError},{data:projects},{data:categories},{data:runs}]=await Promise.all([
      admin.from("omie_connections").select("app_key_hint,auto_sync,auto_interval_minutes,initial_sync_date,last_sync_at,last_sync_attempt_at,last_sync_status,last_sync_error,connected_at").eq("organization_id",orgId).maybeSingle(),
      admin.from("omie_project_mappings").select("omie_project_code,omie_project_name,clique_project_id,enabled").eq("organization_id",orgId).order("omie_project_name"),
      admin.from("omie_category_mappings").select("omie_category_code,omie_category_name,clique_category_id,clique_category_name,enabled").eq("organization_id",orgId).order("omie_category_name"),
      admin.from("omie_sync_runs").select("imported_count,updated_count,cancelled_count,skipped_count,status,finished_at").eq("organization_id",orgId).order("started_at",{ascending:false}).limit(1)
    ]);
    if(connectionError) throw connectionError;
    const last=Array.isArray(runs)&&runs[0]?runs[0]:null;
    return {connected:!!connection,connection:mapConnection(connection),projectMappings:(projects||[]).map(mapProject),categoryMappings:(categories||[]).map(mapCategory),summary:{projects:(projects||[]).filter((x:any)=>x.enabled).length,categories:(categories||[]).filter((x:any)=>x.enabled).length,lastRun:last?{imported:last.imported_count,updated:last.updated_count,cancelled:last.cancelled_count,skipped:last.skipped_count,status:last.status}:null}};
  }

  async function supplierDirectory(orgId:string,payables:Record<string,unknown>[],creds:{app_key:string;app_secret:string}){
    const codes=[...new Set(payables.map(row=>cleanText(row.codigo_cliente_fornecedor,60)).filter(Boolean))];
    const directory=new Map<string,string>();
    if(!codes.length) return {names:directory,complete:true,lookups:0};
    const staleBefore=Date.now()-7*86400000;
    const refreshCodes=new Set(codes);
    for(let offset=0;offset<codes.length;offset+=250){
      const {data,error}=await admin.from("omie_supplier_cache")
        .select("omie_supplier_code,fantasy_name,refreshed_at")
        .eq("organization_id",orgId).in("omie_supplier_code",codes.slice(offset,offset+250));
      if(error) throw new Error("Não foi possível consultar o cadastro privado de fornecedores.");
      for(const row of data||[]){
        const name=cleanText(row.fantasy_name,180);
        if(name) directory.set(String(row.omie_supplier_code),name);
        if(row.refreshed_at&&new Date(row.refreshed_at).getTime()>=staleBefore)
          refreshCodes.delete(String(row.omie_supplier_code));
      }
    }
    if(!refreshCodes.size) return {names:directory,complete:true,lookups:0};

    // Consulta somente os fornecedores efetivamente presentes nas contas a
    // pagar. Isso evita percorrer todo o cadastro de clientes do Omie.
    const cacheRows:Record<string,unknown>[]=[];
    const lookupCodes=[...refreshCodes].slice(0,24);
    let failures=0;
    for(const code of lookupCodes){
      try{
        const identity=/^\d+$/.test(code)
          ?{codigo_cliente_omie:Number(code),codigo_cliente_integracao:""}
          :{codigo_cliente_omie:0,codigo_cliente_integracao:code};
        const client=await omieCall(OMIE_ENDPOINTS.clients,"ConsultarCliente",identity,creds);
        const fantasyName=cleanText(client.nome_fantasia,180)||cleanText(client.razao_social,180);
        if(!fantasyName) continue;
        directory.set(code,fantasyName);
        cacheRows.push({organization_id:orgId,omie_supplier_code:code,fantasy_name:fantasyName,
          legal_name:cleanText(client.razao_social,180)||null,refreshed_at:new Date().toISOString()});
      }catch(error){
        failures++;
        console.warn("Omie supplier lookup skipped",{organizationId:orgId,supplierCode:code,message:safeOmieError(error)});
      }
    }
    for(let offset=0;offset<cacheRows.length;offset+=500){
      const {error}=await admin.from("omie_supplier_cache").upsert(cacheRows.slice(offset,offset+500),{onConflict:"organization_id,omie_supplier_code"});
      if(error) throw new Error("Não foi possível atualizar o cadastro privado de fornecedores.");
    }
    return {names:directory,complete:refreshCodes.size<=lookupCodes.length&&failures===0,lookups:lookupCodes.length};
  }

  async function syncOrganization(orgId:string,requestedCodes:string[]|null,mode:"manual"|"automatic",triggeredBy:string){
    const leaseToken=crypto.randomUUID();
    let runId="";
    const {data:lease,error:leaseError}=await admin.rpc("clique_obras_acquire_omie_sync_lease",{
      target_organization_id:orgId,target_lease_token:leaseToken,lease_seconds:600
    });
    if(leaseError) throw new Error("Não foi possível reservar a sincronização desta organização.");
    if(lease!==true) throw new Error("Já existe uma sincronização desta organização em andamento. Aguarde alguns instantes.");
    try{
      const creds=await credentials(orgId);
      const [{data:connection,error:connectionError},{data:projectRows,error:projectError},{data:categoryRows,error:categoryError}]=await Promise.all([
        admin.from("omie_connections").select("initial_sync_date,last_sync_at,supplier_backfill_completed_at,created_by,auto_sync").eq("organization_id",orgId).eq("active",true).maybeSingle(),
        admin.from("omie_project_mappings").select("omie_project_code,omie_project_name,clique_project_id,enabled").eq("organization_id",orgId).eq("enabled",true),
        admin.from("omie_category_mappings").select("omie_category_code,clique_category_name,enabled").eq("organization_id",orgId).eq("enabled",true)
      ]);
      if(connectionError||projectError||categoryError||!connection) throw new Error("Configuração Omie incompleta.");
      const allowed=new Set((projectRows||[]).map((row:any)=>String(row.omie_project_code)));
      const selected=requestedCodes?.length?[...new Set(requestedCodes.map(code=>cleanText(code,60)).filter(code=>allowed.has(code)))]:[...allowed];
      if(!selected.length) throw new Error("Nenhum projeto Omie ativo foi selecionado.");
      runId=crypto.randomUUID();
      const runActor=triggeredBy||String(connection.created_by||"");
      const {error:runError}=await admin.from("omie_sync_runs").insert({id:runId,organization_id:orgId,mode,triggered_by:runActor||null,project_codes:selected,status:"running"});
      if(runError) throw new Error("Não foi possível iniciar o registro da sincronização.");
      const projectMap=new Map((projectRows||[]).map((row:any)=>[String(row.omie_project_code),{cliqueProjectId:String(row.clique_project_id),enabled:true}]));
      const categoryMap=new Map((categoryRows||[]).map((row:any)=>[String(row.omie_category_code),{cliqueCategoryName:String(row.clique_category_name),enabled:true}]));
      const initial=String(connection.initial_sync_date||new Date().toISOString().slice(0,10));
      // A primeira execução da v3.0.8 relê o período completo uma única vez
      // para substituir os fornecedores genéricos já importados.
      const needsSupplierBackfill=!connection.supplier_backfill_completed_at;
      const incremental=mode==="automatic"&&connection.last_sync_at&&!needsSupplierBackfill
        ?new Date(new Date(connection.last_sync_at).getTime()-3*86400000).toISOString().slice(0,10):initial;
      const today=new Date().toISOString().slice(0,10);
      const selectedSet=new Set(selected);
      const basePayableFilter={
        apenas_importado_api:"N",filtrar_por_data_de:isoToDdMmYyyy(incremental),filtrar_por_data_ate:isoToDdMmYyyy(today),filtrar_apenas_inclusao:"N",filtrar_apenas_alteracao:"N",exibir_obs:"S"
      };
      const payables:Record<string,unknown>[]=[];
      // A carga histórica pode ser grande demais para uma única execução da
      // Edge Function. O filtro oficial por projeto mantém cada resposta
      // limitada; as chamadas são estritamente seriais e protegidas pelo
      // lease da organização. Na rotina incremental curta, uma única consulta
      // continua sendo mais eficiente e o recorte é feito localmente.
      if(needsSupplierBackfill||mode==="manual"){
        for(const projectCode of selected){
          const rows=await pagedOmie(OMIE_ENDPOINTS.payables,"ListarContasPagar","conta_pagar_cadastro",{
            ...basePayableFilter,filtrar_por_projeto:Number(projectCode)
          },creds,100);
          payables.push(...rows);
        }
      }else{
        const rows=await pagedOmie(OMIE_ENDPOINTS.payables,"ListarContasPagar","conta_pagar_cadastro",basePayableFilter,creds,100);
        payables.push(...rows.filter(row=>selectedSet.has(cleanText(row.codigo_projeto,60))));
      }
      const suppliers=await supplierDirectory(orgId,payables,creds);
      const built=buildPayableEntries(payables,projectMap,categoryMap,suppliers.names);
      const supplierBackfillComplete=suppliers.complete&&selected.length===allowed.size;
      let imported=0,updated=0,cancelled=0,unchanged=0;
      for(const batch of batchPayableEntries(built.entries,500)){
        const {data:reconciled,error:reconcileError}=await admin.rpc("clique_obras_reconcile_omie_entries",{target_organization_id:orgId,target_actor_id:runActor,entries:batch,target_sync_run_id:runId});
        if(reconcileError) throw new Error(reconcileError.message||"Falha ao reconciliar lançamentos do Omie.");
        cancelled+=Number(reconciled?.cancelled)||0;
        const {data,error}=await admin.rpc("clique_obras_apply_omie_entries",{target_organization_id:orgId,target_actor_id:runActor,entries:batch,target_sync_run_id:runId});
        if(error) throw new Error(error.message||"Falha ao aplicar lançamentos do Omie.");
        imported+=Number(data?.imported)||0;updated+=Number(data?.updated)||0;cancelled+=Number(data?.cancelled)||0;unchanged+=Number(data?.unchanged)||0;
      }
      const finishedAt=new Date().toISOString();
      await Promise.all([
        admin.from("omie_sync_runs").update({status:"success",finished_at:finishedAt,imported_count:imported,updated_count:updated,cancelled_count:cancelled,skipped_count:built.skipped,details:{unchanged,received:payables.length,supplierLookups:suppliers.lookups,supplierBackfillComplete}}).eq("id",runId),
        admin.from("omie_connections").update({last_sync_at:finishedAt,last_sync_status:"success",last_sync_error:null,
          supplier_backfill_completed_at:connection.supplier_backfill_completed_at||(supplierBackfillComplete?finishedAt:null),updated_at:finishedAt}).eq("organization_id",orgId)
      ]);
      return {imported,updated,cancelled,skipped:built.skipped,unchanged,received:payables.length};
    }catch(error){
      const message=safeOmieError(error);
      const updates=[admin.from("omie_connections").update({last_sync_status:"error",last_sync_error:message,updated_at:new Date().toISOString()}).eq("organization_id",orgId)];
      if(runId) updates.push(admin.from("omie_sync_runs").update({status:"error",finished_at:new Date().toISOString(),error_message:message}).eq("id",runId));
      await Promise.all(updates);
      throw new Error(message);
    }finally{
      await admin.rpc("clique_obras_release_omie_sync_lease",{target_organization_id:orgId,target_lease_token:leaseToken});
    }
  }

  try{
    if(action==="status") return json(request,await status(organizationId));
    if(action==="connect"){
      const appKey=cleanText(payload.appKey,120),appSecret=String(payload.appSecret??"").trim(),initial=String(payload.initialSyncDate??"");
      if(appKey.length<4||appSecret.length<4||appSecret.length>200||!ISO_DATE.test(initial)) return json(request,{error:"Credenciais ou data inicial inválidas."},400);
      const creds={app_key:appKey,app_secret:appSecret};
      await Promise.all([
        omieCall(OMIE_ENDPOINTS.projects,"ListarProjetos",{pagina:1,registros_por_pagina:1,apenas_importado_api:"N"},creds),
        omieCall(OMIE_ENDPOINTS.categories,"ListarCategorias",{pagina:1,registros_por_pagina:1,filtrar_apenas_ativo:"S",filtrar_por_tipo:"D"},creds)
      ]);
      const hint=appKey.length<=8?"••••"+appKey.slice(-2):appKey.slice(0,3)+"••••"+appKey.slice(-4);
      const {error}=await admin.rpc("clique_obras_store_omie_connection",{target_organization_id:organizationId,target_actor_id:actorId,credentials:JSON.stringify(creds),target_app_key_hint:hint,target_initial_sync_date:initial});
      if(error) throw error;
      await Promise.all([
        admin.from("omie_supplier_cache").delete().eq("organization_id",organizationId),
        admin.from("omie_connections").update({supplier_backfill_completed_at:null}).eq("organization_id",organizationId)
      ]);
      return json(request,{connected:true});
    }
    if(action==="catalog"){
      const creds=await credentials(organizationId);
      const [projects,categories,current]=await Promise.all([
        pagedOmie(OMIE_ENDPOINTS.projects,"ListarProjetos","cadastro",{apenas_importado_api:"N"},creds),
        pagedOmie(OMIE_ENDPOINTS.categories,"ListarCategorias","categoria_cadastro",{filtrar_apenas_ativo:"S",filtrar_por_tipo:"D"},creds),
        status(organizationId)
      ]);
      return json(request,{projects:projects.filter((row:any)=>row.inativo!=="S").map((row:any)=>({code:String(row.codigo),name:cleanText(row.nome,160)})),categories:categories.filter((row:any)=>row.conta_inativa!=="S"&&row.totalizadora!=="S"&&row.nao_exibir!=="S").map((row:any)=>({code:String(row.codigo),name:cleanText(row.descricao||row.descricao_padrao,160)})),...current});
    }
    if(action==="save-config"){
      const projects=Array.isArray(payload.projectMappings)?payload.projectMappings:[],categories=Array.isArray(payload.categoryMappings)?payload.categoryMappings:[];
      if(projects.length>1000||categories.length>1000) return json(request,{error:"Quantidade de mapeamentos acima do limite."},400);
      const interval=[15,60,360,1440].includes(Number(payload.autoIntervalMinutes))?Number(payload.autoIntervalMinutes):60;
      const {error}=await admin.rpc("clique_obras_save_omie_config",{target_organization_id:organizationId,target_actor_id:actorId,project_mappings:projects,category_mappings:categories,automatic_sync:payload.autoSync===true,interval_minutes:interval});
      if(error) throw error;
      return json(request,{saved:true});
    }
    if(action==="sync"){
      const codes=Array.isArray(payload.projectCodes)?payload.projectCodes.map(String).slice(0,1000):null;
      return json(request,await syncOrganization(organizationId,codes,"manual",actorId));
    }
    if(action==="disconnect"){
      const {error}=await admin.rpc("clique_obras_disconnect_omie",{target_organization_id:organizationId,target_actor_id:actorId});
      if(error) throw error;
      await admin.from("omie_supplier_cache").delete().eq("organization_id",organizationId);
      return json(request,{disconnected:true});
    }
    if(action==="scheduled"){
      const {data:connections,error}=await admin.from("omie_connections").select("organization_id,created_by,last_sync_at,last_sync_attempt_at,auto_interval_minutes").eq("active",true).eq("auto_sync",true).limit(12);
      if(error) throw error;
      const now=Date.now(),due=(connections||[]).filter((row:any)=>{
        const last=Math.max(new Date(row.last_sync_at||0).getTime()||0,new Date(row.last_sync_attempt_at||0).getTime()||0);
        return !last||now-last>=(Number(row.auto_interval_minutes)||60)*60000;
      });
      const results=[];
      for(const row of due){
        try{results.push({organizationId:row.organization_id,ok:true,...await syncOrganization(row.organization_id,null,"automatic",String(row.created_by||""))});}
        catch(error){results.push({organizationId:row.organization_id,ok:false,error:safeOmieError(error)});}
      }
      return json(request,{processed:results.length,results});
    }
    return json(request,{error:"Operação inválida."},400);
  }catch(error){
    console.error("Omie integration failure",{action,organizationId,message:safeOmieError(error)});
    return json(request,{error:safeOmieError(error)||"Falha na integração Omie."},409);
  }
});
