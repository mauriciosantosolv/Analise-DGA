import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { enforceRateLimit, json, preflight, readJson, rejectUntrustedOrigin } from "../_shared/security.ts";
import { batchPayableEntries, buildPayableEntries, buildReceivableEntries, chunk, cleanText, isoToDdMmYyyy, isOmieConcurrentMethodError, isOmieMissingEntryError, omieRetryDelay, OMIE_ENDPOINTS, safeOmieError } from "./logic.mjs";
import { accountListParams, buildRemessaEntries, entradaId, entradaListParams, entradaTouches, filterPayablesForRemessa, isEmptyListError, isMissingTableError, listRows, OMIE_REMESSA_API, parseAccount, parseEntrada, parseRemessa, parseStatus, remessaId, remessaListParams, shapeOf, statusIsStale, totalPages } from "./remessa.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=new Set(["status","connect","catalog","save-config","sync","disconnect","scheduled","remessa-config","remessa-save","remessa-preview","remessa-probe"]);

type Payload={
  action?:string; organizationId?:string; appKey?:string; appSecret?:string;
  initialSyncDate?:string; autoSync?:boolean; autoIntervalMinutes?:number;
  projectMappings?:unknown[]; categoryMappings?:unknown[]; projectCodes?:string[];
  remessaProjects?:unknown[]; cardAccounts?:unknown[]; projectCode?:string;
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
      admin.from("omie_sync_runs").select("imported_count,updated_count,cancelled_count,skipped_count,status,finished_at,details").eq("organization_id",orgId).order("started_at",{ascending:false}).limit(1)
    ]);
    if(connectionError) throw connectionError;
    const last=Array.isArray(runs)&&runs[0]?runs[0]:null;
    return {connected:!!connection,connection:mapConnection(connection),projectMappings:(projects||[]).map(mapProject),categoryMappings:(categories||[]).map(mapCategory),summary:{projects:(projects||[]).filter((x:any)=>x.enabled).length,categories:(categories||[]).filter((x:any)=>x.enabled).length,lastRun:last?{imported:last.imported_count,updated:last.updated_count,cancelled:last.cancelled_count,skipped:last.skipped_count,status:last.status,receivables:(last.details as any)?.receivables??null,orphans:(last.details as any)?.orphans??null,remessas:(last.details as any)?.remessas??null}:null}};
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

  // v4.2.0 — nomes de cliente vindos somente do cache ja existente. Nenhuma
  // consulta extra ao Omie, para nao aumentar o volume de chamadas da rotina.
  async function customerDirectory(orgId:string,titles:Record<string,unknown>[]){
    const codes=[...new Set(titles.map(row=>cleanText(row.codigo_cliente_fornecedor,60)).filter(Boolean))];
    const directory=new Map<string,string>();
    for(let offset=0;offset<codes.length;offset+=250){
      const {data}=await admin.from("omie_supplier_cache")
        .select("omie_supplier_code,fantasy_name")
        .eq("organization_id",orgId).in("omie_supplier_code",codes.slice(offset,offset+250));
      for(const row of data||[]){
        const name=cleanText(row.fantasy_name,180);
        if(name) directory.set(String(row.omie_supplier_code),name);
      }
    }
    return directory;
  }

  // ---------------------------------------------------------------------------
  // v4.5.7 — Custo por NOTA DE REMESSA (ver remessa.mjs para as regras).
  // Tudo aqui é NOVO e só roda para projetos com "custo por remessa" ativado.
  // Sem nenhum projeto ativado a sincronização segue exatamente como antes.
  // ---------------------------------------------------------------------------
  async function loadRemessaConfig(orgId:string){
    const [{data:projectRows,error:projectError},{data:cardRows,error:cardError}]=await Promise.all([
      admin.from("omie_remessa_projects").select("omie_project_code,enabled,enabled_at").eq("organization_id",orgId),
      admin.from("omie_card_accounts").select("omie_account_code,account_name").eq("organization_id",orgId)
    ]);
    // Tabelas ainda não criadas (SQL da v4.5.7 não aplicado) = nenhum projeto
    // em modo remessa. Qualquer OUTRO erro interrompe a sincronização, para
    // nunca importar contas a pagar de um projeto em modo remessa sem filtro.
    const missing=(projectError&&isMissingTableError(projectError))||(cardError&&isMissingTableError(cardError));
    if(missing) return {ready:false,projects:new Set<string>(),cards:new Set<string>(),projectRows:[],cardRows:[]};
    if(projectError||cardError) throw new Error("Não foi possível ler a configuração de custo por remessa.");
    const enabledRows=(projectRows||[]).filter((row:any)=>row.enabled===true);
    return {
      ready:true,
      projects:new Set<string>(enabledRows.map((row:any)=>String(row.omie_project_code))),
      cards:new Set<string>((cardRows||[]).map((row:any)=>String(row.omie_account_code))),
      projectRows:projectRows||[],cardRows:cardRows||[]
    };
  }

  // v4.5.8 — listagem com os nomes EXATOS da documentação do Omie
  // (ver remessa.mjs). "Não existem registros" vira lista vazia.
  async function omieListExact(api:{endpoint:string;list:string;listKey:string},params:(page:number)=>Record<string,unknown>,creds:{app_key:string;app_secret:string},maxPages=50){
    const rows:Record<string,unknown>[]=[];
    let pages=0;
    for(let page=1;page<=maxPages;page++){
      let data:Record<string,unknown>;
      try{ data=await omieCall(api.endpoint,api.list,params(page),creds); }
      catch(error){ if(isEmptyListError(error)) break; throw error; }
      pages=page;
      const list=listRows(data,api.listKey);
      rows.push(...list);
      if(page>=totalPages(data)||!list.length) return {rows,pages,truncated:false};
    }
    return {rows,pages,truncated:pages>=maxPages};
  }

  async function rowHash(row:unknown){
    const bytes=new TextEncoder().encode(JSON.stringify(row));
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  }

  // Situação da NF (StatusRemessa / StatusNotaEnt) com cache privado por
  // organização. Consulta só o que é preciso (ver statusIsStale) e no máximo
  // "budget.left" chamadas por execução; o que ficar para trás é resolvido
  // na execução seguinte (sem lançar nem estornar nada no meio do caminho).
  async function statusesFor(orgId:string,kind:"rem"|"ne",api:{endpoint:string;status:string;statusKey:string},items:{id:string;row:Record<string,unknown>}[],creds:{app_key:string;app_secret:string},budget:{left:number;consulted:number;cached:number;waiting:number}){
    const result=new Map<string,any>();
    if(!items.length) return result;
    const cache=new Map<string,{hash:string;summary:any;raw:any;refreshedAt:string}>();
    let cacheReady=true;
    const keys=items.map(item=>`${kind}:${item.id}`);
    for(let offset=0;offset<keys.length;offset+=250){
      const {data,error}=await admin.from("omie_remessa_cache").select("remessa_id,row_hash,summary,refreshed_at").eq("organization_id",orgId).in("remessa_id",keys.slice(offset,offset+250));
      if(error){ if(isMissingTableError(error)){cacheReady=false;break;} throw new Error("Não foi possível ler o cache de remessas."); }
      for(const row of data||[]) cache.set(String(row.remessa_id),{hash:String(row.row_hash),summary:(row.summary as any)?.parsed??null,raw:(row.summary as any)?.status??null,refreshedAt:String(row.refreshed_at||"")});
    }
    const work:{id:string;key:string;hash:string;stale:boolean;priority:number}[]=[];
    for(const item of items){
      const key=`${kind}:${item.id}`,hash=await rowHash(item.row),cached=cache.get(key);
      const stale=statusIsStale(cached?{hash:cached.hash,summary:cached.summary,refreshedAt:cached.refreshedAt}:null,hash);
      if(!stale&&cached?.raw){result.set(item.id,cached.raw);budget.cached++;continue;}
      work.push({id:item.id,key,hash,stale,priority:!cached?0:cached.hash!==hash?1:2});
      if(cached?.raw) result.set(item.id,cached.raw); // valor anterior como reserva
    }
    work.sort((a,b)=>a.priority-b.priority);
    const upserts:Record<string,unknown>[]=[];
    for(const item of work){
      if(budget.left<=0){budget.waiting++;continue;}
      budget.left--;
      try{
        const status=await omieCall(api.endpoint,api.status,{[api.statusKey]:Number(item.id)},creds);
        budget.consulted++;
        const {ListaNfe,...rest}=status as any;
        const slim={...rest,ListaNfe:(Array.isArray(ListaNfe)?ListaNfe:[]).map((nf:any)=>({cNumNFe:nf?.cNumNFe,cSerieNFe:nf?.cSerieNFe,cChaveNFe:nf?.cChaveNFe,dtEmissao:nf?.dtEmissao,dtFatura:nf?.dtFatura}))};
        result.set(item.id,slim);
        const parsed=parseStatus(slim);
        upserts.push({organization_id:orgId,remessa_id:item.key,row_hash:item.hash,summary:{parsed,status:slim},refreshed_at:new Date().toISOString()});
      }catch(error){
        budget.waiting++;
        console.warn("Omie status skipped",{organizationId:orgId,kind,id:item.id,message:safeOmieError(error)});
      }
    }
    if(cacheReady&&upserts.length){
      const {error}=await admin.from("omie_remessa_cache").upsert(upserts,{onConflict:"organization_id,remessa_id"});
      if(error) console.warn("Omie remessa cache not saved",{organizationId:orgId,message:safeOmieError(error)});
    }
    return result;
  }

  // Remessas dos projetos em escopo + notas de entrada que apontam para elas.
  async function collectRemessas(orgId:string,creds:{app_key:string;app_secret:string},scopeCodes:Set<string>){
    const budget={left:40,consulted:0,cached:0,waiting:0};
    const listed=await omieListExact(OMIE_REMESSA_API.remessa,remessaListParams,creds);
    const scopedRows=listed.rows.filter(row=>scopeCodes.has(parseRemessa(row).projectCode)&&remessaId(row));
    const remStatus=await statusesFor(orgId,"rem",OMIE_REMESSA_API.remessa,scopedRows.map(row=>({id:remessaId(row),row})),creds,budget);
    const remessas=scopedRows.map(row=>parseRemessa(row,remStatus.get(remessaId(row))??null));
    const entradasListed=await omieListExact(OMIE_REMESSA_API.entrada,entradaListParams,creds);
    const touching=entradasListed.rows.filter(row=>entradaId(row)&&entradaTouches(row,remessas,scopeCodes));
    const neStatus=await statusesFor(orgId,"ne",OMIE_REMESSA_API.entrada,touching.map(row=>({id:entradaId(row),row})),creds,budget);
    return {
      remessas,
      entradas:touching.map(row=>parseEntrada(row,neStatus.get(entradaId(row))??null)),
      source:{remessasRead:listed.rows.length,remessasInScope:scopedRows.length,entradasRead:entradasListed.rows.length,entradasLinked:touching.length,
        consulted:budget.consulted,cached:budget.cached,awaitingStatus:budget.waiting,truncated:listed.truncated||entradasListed.truncated}
    };
  }

  async function applyRemessaEntries(orgId:string,actor:string,runId:string,entries:Record<string,unknown>[]){
    const totals={imported:0,updated:0,cancelled:0,unchanged:0};
    for(const batch of chunk(entries,500)){
      const {data,error}=await admin.rpc("clique_obras_apply_omie_remessas_v457",{target_organization_id:orgId,target_actor_id:actor,entries:batch,target_sync_run_id:runId});
      if(error) throw new Error(error.message||"Falha ao aplicar remessas do Omie.");
      totals.imported+=Number(data?.imported)||0;totals.updated+=Number(data?.updated)||0;
      totals.cancelled+=Number(data?.cancelled)||0;totals.unchanged+=Number(data?.unchanged)||0;
    }
    return totals;
  }

  async function listCardCandidates(creds:{app_key:string;app_secret:string}){
    const listed=await omieListExact(OMIE_REMESSA_API.conta,accountListParams,creds,10);
    return listed.rows.map(row=>parseAccount(row)).filter(account=>account.code&&!account.inactive);
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
      // v4.2.6 — a releitura historica por data de inclusao (info.dInc) escrita
      // para a v4.0.1 continua PENDENTE DE DECISAO e NAO entra em producao:
      // publicar aquele trecho reescreveria a data de todos os lancamentos ja
      // importados do Omie. Os auxiliares payableDates/payableInclusionDate
      // seguem prontos em logic.mjs, porem fora do fluxo. Aqui vale exatamente
      // a regra que ja roda em producao.
      const needsHistoricalBackfill=needsSupplierBackfill;
      const incremental=mode==="automatic"&&connection.last_sync_at&&!needsHistoricalBackfill
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
      if(needsHistoricalBackfill||mode==="manual"){
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
      // v4.5.7 — nos projetos com custo por remessa, do Contas a Pagar só entra
      // o que foi lançado na conta do cartão corporativo. Sem projeto ativado,
      // payableSplit.kept é o MESMO array "payables" (nada muda).
      const remessaConfig=await loadRemessaConfig(orgId);
      const remessaCodes=new Set<string>(selected.filter(code=>remessaConfig.projects.has(code)));
      const payableSplit=filterPayablesForRemessa(payables,remessaCodes,remessaConfig.cards);
      const suppliers=await supplierDirectory(orgId,payableSplit.kept,creds);
      const built=buildPayableEntries(payableSplit.kept,projectMap,categoryMap,suppliers.names);
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
      // ---------------------------------------------------------------------
      // v4.2.0 — Contas a receber, na mesma execucao (decisao D6).
      //
      // As chamadas passam pelo mesmo omieCall, que serializa por metodo com
      // espacamento de 700ms e faz retry no bloqueio de metodo concorrente.
      // O bloco fica isolado num try/catch: contas a pagar ja foram aplicadas
      // acima e nao podem ser perdidas por uma falha aqui.
      // ---------------------------------------------------------------------
      const receivables:Record<string,unknown>={imported:0,updated:0,untouched:0,skipped:0,ignored:0,unmapped:0,titles:0,error:null};
      try{
        const baseReceivableFilter={
          apenas_importado_api:"N",
          filtrar_por_data_de:isoToDdMmYyyy(incremental),
          filtrar_por_data_ate:isoToDdMmYyyy(today)
        };
        // v4.2.6 — CAUSA RAIZ da sincronizacao automatica que nunca terminava.
        // Ate aqui esta etapa fazia UMA consulta ao Omie POR PROJETO (21 na
        // organizacao de producao). Com o espacamento obrigatorio de 700ms por
        // metodo, a latencia do Omie e os retries de "metodo concorrente", a
        // execucao completa saiu de ~23s (antes da v4.2.0) para mais de 150s:
        // estourava o timeout de 30s do pg_cron/pg_net e, sem ele, o limite de
        // 150s da propria Edge Function. Nenhuma execucao completa terminou
        // entre 21/08/2026 e 25/08/2026.
        // A correcao repete o padrao que as contas a pagar ja usam na rotina
        // incremental: UMA consulta pelo periodo e o recorte por projeto feito
        // localmente. O conjunto de titulos considerado e o mesmo — nenhuma
        // regra de negocio muda.
        const titles:Record<string,unknown>[]=[];
        {
          const rows=await pagedOmie(OMIE_ENDPOINTS.receivables,"ListarContasReceber","conta_receber_cadastro",baseReceivableFilter,creds,100);
          titles.push(...rows.filter(row=>selectedSet.has(cleanText(row.codigo_projeto,60))));
        }
        receivables.titles=titles.length;
        const customers=await customerDirectory(orgId,titles);
        const builtReceivables=buildReceivableEntries(titles,projectMap,customers);
        receivables.skipped=builtReceivables.skipped;
        receivables.ignored=builtReceivables.ignored;
        receivables.unmapped=builtReceivables.unmapped;
        for(const batch of chunk(builtReceivables.entries,500)){
          const {data,error}=await admin.rpc("clique_obras_apply_omie_receivables_v420",{target_organization_id:orgId,target_actor_id:runActor,entries:batch,target_sync_run_id:runId});
          if(error) throw new Error(error.message||"Falha ao aplicar contas a receber do Omie.");
          receivables.imported=Number(receivables.imported)+(Number(data?.imported)||0);
          receivables.updated=Number(receivables.updated)+(Number(data?.updated)||0);
          receivables.untouched=Number(receivables.untouched)+(Number(data?.untouched)||0);
          receivables.skipped=Number(receivables.skipped)+(Number(data?.skipped)||0);
        }
      }catch(error){
        receivables.error=safeOmieError(error);
        console.warn("Omie receivables step failed",{organizationId:orgId,runId,message:receivables.error});
      }

      // ---------------------------------------------------------------------
      // v4.2.6 — Lancamentos EXCLUIDOS no Omie.
      //
      // Quando uma conta a pagar e apagada no Omie ela simplesmente some de
      // ListarContasPagar. A reconciliacao existente so cancela rateios de
      // titulos que AINDA aparecem no lote, entao o registro apagado ficava
      // para sempre no CliqueObras, duplicando o Realizado e mantendo o
      // planejamento abatido. Foi o caso do projeto 798: o titulo 2420124371
      // (R$ 3.999,50) foi refeito no Omie como 2421007984 e o antigo virou
      // fantasma.
      //
      // Aqui listamos os candidatos (RPC somente leitura) e CONFIRMAMOS um a
      // um no proprio Omie, com ConsultarContaPagar, que o titulo realmente
      // nao existe mais. So entao cancelamos, chamando a MESMA rotina que ja
      // trata cancelamento (active:false) — que devolve o valor ao
      // planejamento e grava o historico 'omie_restored'. Nada e removido por
      // deducao, e o bloco inteiro fica isolado num try/catch para nunca
      // derrubar uma sincronizacao que ja aplicou os lancamentos.
      // ---------------------------------------------------------------------
      const orphans:Record<string,unknown>={checked:0,removed:0,kept:0,error:null};
      try{
        const presentIds=[...new Set(payables.map(row=>cleanText(row.codigo_lancamento_omie??row.codigo_lancamento_integracao,100)).filter(Boolean))];
        const projectIds=[...new Set(selected.map(code=>String(projectMap.get(code)?.cliqueProjectId||"")).filter(Boolean))];
        const {data:candidates,error:candidateError}=await admin.rpc("clique_obras_omie_orphan_candidates_v426",{
          target_organization_id:orgId,project_ids:projectIds,date_from:incremental,date_to:today,present_ids:presentIds,max_rows:40
        });
        if(candidateError) throw new Error(candidateError.message||"Falha ao listar lancamentos orfaos.");
        const verdicts=new Map<string,boolean>();
        for(const candidate of (Array.isArray(candidates)?candidates:[]) as Record<string,unknown>[]){
          const externalId=cleanText(candidate.externalId,100);
          if(!externalId) continue;
          if(!verdicts.has(externalId)){
            if(verdicts.size>=15) break;
            let missing=false;
            try{
              await omieCall(OMIE_ENDPOINTS.payables,"ConsultarContaPagar",
                /^[0-9]+$/.test(externalId)
                  ?{codigo_lancamento_omie:Number(externalId)}
                  :{codigo_lancamento_integracao:externalId},creds);
            }catch(error){ missing=isOmieMissingEntryError(error); }
            verdicts.set(externalId,missing);
            orphans.checked=Number(orphans.checked)+1;
          }
          if(!verdicts.get(externalId)){ orphans.kept=Number(orphans.kept)+1; continue; }
          const {error:cancelError}=await admin.rpc("clique_obras_apply_omie_entries",{
            target_organization_id:orgId,target_actor_id:runActor,
            entries:[{
              externalItemId:cleanText(candidate.externalItemId,180),
              externalId,
              projectId:cleanText(candidate.projectId,180),
              category:cleanText(candidate.category,180),
              value:Number(candidate.value)||0,
              active:false,
              externalSource:"omie"
            }],
            target_sync_run_id:runId
          });
          if(cancelError) throw new Error(cancelError.message||"Falha ao cancelar lancamento excluido no Omie.");
          orphans.removed=Number(orphans.removed)+1;
          console.log("Omie orphan removed",{organizationId:orgId,runId,externalId});
        }
      }catch(error){
        orphans.error=safeOmieError(error);
        console.warn("Omie orphan cleanup failed",{organizationId:orgId,runId,message:orphans.error});
      }

      // ---------------------------------------------------------------------
      // v4.5.7 — Custo por NOTA DE REMESSA, somente nos projetos ativados.
      // Bloco isolado: contas a pagar, contas a receber e órfãos já foram
      // aplicados acima e nunca são perdidos por uma falha aqui.
      // ---------------------------------------------------------------------
      const remessas:Record<string,unknown>={projects:remessaCodes.size,payablesSkipped:payableSplit.skipped,payablesCard:payableSplit.keptCard,imported:0,updated:0,cancelled:0,unchanged:0,pending:0,unmatchedReturns:0,error:null};
      if(remessaCodes.size){
        try{
          const collected=await collectRemessas(orgId,creds,remessaCodes);
          const builtRemessas=buildRemessaEntries(collected.remessas,collected.entradas,projectMap,categoryMap,remessaCodes);
          const applied=await applyRemessaEntries(orgId,runActor,runId,builtRemessas.entries);
          Object.assign(remessas,applied,{counts:builtRemessas.counts,pending:builtRemessas.pending.length,unmatchedReturns:builtRemessas.unmatchedReturns.length,source:collected.source});
        }catch(error){
          remessas.error=safeOmieError(error);
          console.warn("Omie remessa step failed",{organizationId:orgId,runId,message:remessas.error});
        }
      }

      const finishedAt=new Date().toISOString();
      await Promise.all([
        admin.from("omie_sync_runs").update({status:"success",finished_at:finishedAt,imported_count:imported,updated_count:updated,cancelled_count:cancelled,skipped_count:built.skipped,details:{unchanged,received:payables.length,supplierLookups:suppliers.lookups,supplierBackfillComplete,receivables,orphans,remessas}}).eq("id",runId),
        admin.from("omie_connections").update({last_sync_at:finishedAt,last_sync_status:"success",last_sync_error:null,
          supplier_backfill_completed_at:connection.supplier_backfill_completed_at||(supplierBackfillComplete?finishedAt:null),
          updated_at:finishedAt}).eq("organization_id",orgId)
      ]);
      return {imported,updated,cancelled,skipped:built.skipped,unchanged,received:payables.length,receivables,orphans,remessas};
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
    // v4.5.7 — custo por nota de remessa (somente proprietário, como o resto).
    if(action==="remessa-config"){
      const [config,{data:mappings,error:mappingError}]=await Promise.all([
        loadRemessaConfig(organizationId),
        admin.from("omie_project_mappings").select("omie_project_code,omie_project_name,clique_project_id,enabled").eq("organization_id",organizationId).eq("enabled",true).order("omie_project_name")
      ]);
      if(mappingError) throw mappingError;
      let accounts:unknown[]=[],accountsError:string|null=null;
      try{ accounts=await listCardCandidates(await credentials(organizationId)); }
      catch(error){ accountsError=safeOmieError(error); }
      const enabledAt=new Map((config.projectRows as any[]).map((row:any)=>[String(row.omie_project_code),row.enabled?row.enabled_at:null]));
      return json(request,{
        ready:config.ready,
        projects:(mappings||[]).map((row:any)=>({omieProjectCode:String(row.omie_project_code),omieProjectName:row.omie_project_name,cliqueProjectId:row.clique_project_id,remessa:config.projects.has(String(row.omie_project_code)),enabledAt:enabledAt.get(String(row.omie_project_code))||null})),
        cards:(config.cardRows as any[]).map((row:any)=>({code:String(row.omie_account_code),name:row.account_name||""})),
        accounts,accountsError
      });
    }
    if(action==="remessa-save"){
      const config=await loadRemessaConfig(organizationId);
      if(!config.ready) return json(request,{error:"Aplique primeiro o SQL da v4.5.7 (ATUALIZACAO-v4.5.7-OMIE-REMESSA.sql)."},409);
      const rawProjects=Array.isArray(payload.remessaProjects)?payload.remessaProjects:[];
      const rawCards=Array.isArray(payload.cardAccounts)?payload.cardAccounts:[];
      if(rawProjects.length>1000||rawCards.length>100) return json(request,{error:"Quantidade acima do limite."},400);
      const {data:mappings,error:mappingError}=await admin.from("omie_project_mappings").select("omie_project_code,clique_project_id").eq("organization_id",organizationId);
      if(mappingError) throw mappingError;
      const mapped=new Map((mappings||[]).map((row:any)=>[String(row.omie_project_code),String(row.clique_project_id)]));
      const wanted=new Set<string>();
      for(const item of rawProjects as any[]){
        const code=cleanText(item?.omieProjectCode,30);
        if(/^\d{1,30}$/.test(code)&&mapped.has(code)&&item?.enabled===true) wanted.add(code);
      }
      const cards=new Map<string,string>();
      for(const item of rawCards as any[]){
        const code=cleanText(item?.code,40);
        if(/^\d{1,40}$/.test(code)) cards.set(code,cleanText(item?.name,120));
      }
      const now=new Date().toISOString();
      const previous=new Map((config.projectRows as any[]).map((row:any)=>[String(row.omie_project_code),row]));
      const turnedOff=[...config.projects].filter(code=>!wanted.has(code));
      const upserts=[...new Set([...wanted,...turnedOff])].map(code=>({
        organization_id:organizationId,omie_project_code:code,clique_project_id:mapped.get(code)||String((previous.get(code) as any)?.clique_project_id||""),
        enabled:wanted.has(code),
        enabled_at:wanted.has(code)?((previous.get(code) as any)?.enabled&&(previous.get(code) as any)?.enabled_at?(previous.get(code) as any).enabled_at:now):null,
        updated_by:actorId,updated_at:now
      })).filter(row=>row.clique_project_id);
      if(upserts.length){
        const {error}=await admin.from("omie_remessa_projects").upsert(upserts,{onConflict:"organization_id,omie_project_code"});
        if(error) throw new Error("Não foi possível salvar os projetos com custo por remessa.");
      }
      const {error:deleteCardsError}=await admin.from("omie_card_accounts").delete().eq("organization_id",organizationId);
      if(deleteCardsError) throw new Error("Não foi possível salvar as contas do cartão corporativo.");
      if(cards.size){
        const {error}=await admin.from("omie_card_accounts").insert([...cards].map(([code,name])=>({organization_id:organizationId,omie_account_code:code,account_name:name||null,updated_by:actorId,updated_at:now})));
        if(error) throw new Error("Não foi possível salvar as contas do cartão corporativo.");
      }
      // Projeto que SAIU do modo remessa: as remessas lançadas nele são
      // estornadas (a mesma rotina devolve o valor ao planejamento). As contas
      // a pagar voltam a entrar pela sincronização manual daquele projeto.
      let reverted=0;
      if(turnedOff.length){
        const {data:rows,error}=await admin.from("app_records").select("data").eq("organization_id",organizationId).eq("store","purchases")
          .eq("data->>sourceType","omieRemessa").in("data->>omieProjectCode",turnedOff).limit(5000);
        if(error) throw new Error("Não foi possível localizar as remessas dos projetos desativados.");
        const entries=(rows||[]).map((row:any)=>({externalItemId:cleanText(row.data?.externalItemId,180),externalId:cleanText(row.data?.externalId,100),projectId:cleanText(row.data?.projectId,180),category:cleanText(row.data?.category,180),value:Number(row.data?.value)||0,active:false,externalSource:"omie",sourceType:"omieRemessa"})).filter((entry:any)=>entry.externalItemId);
        if(entries.length){
          const result=await applyRemessaEntries(organizationId,actorId,crypto.randomUUID(),entries);
          reverted=result.cancelled;
        }
      }
      return json(request,{saved:true,projects:wanted.size,cards:cards.size,reverted,turnedOff});
    }
    if(action==="remessa-preview"){
      const code=cleanText(payload.projectCode,30);
      if(!/^\d{1,30}$/.test(code)) return json(request,{error:"Projeto inválido."},400);
      const creds=await credentials(organizationId);
      const [{data:connection},{data:projectRows},{data:categoryRows}]=await Promise.all([
        admin.from("omie_connections").select("initial_sync_date").eq("organization_id",organizationId).maybeSingle(),
        admin.from("omie_project_mappings").select("omie_project_code,clique_project_id,enabled").eq("organization_id",organizationId).eq("enabled",true),
        admin.from("omie_category_mappings").select("omie_category_code,clique_category_name,enabled").eq("organization_id",organizationId).eq("enabled",true)
      ]);
      const projectMap=new Map((projectRows||[]).map((row:any)=>[String(row.omie_project_code),{cliqueProjectId:String(row.clique_project_id),enabled:true}]));
      if(!projectMap.has(code)) return json(request,{error:"Projeto sem vínculo ativo no mapeamento Omie."},400);
      const categoryMap=new Map((categoryRows||[]).map((row:any)=>[String(row.omie_category_code),{cliqueCategoryName:String(row.clique_category_name),enabled:true}]));
      const cards=new Set<string>((Array.isArray(payload.cardAccounts)?payload.cardAccounts:[]).map((item:any)=>cleanText(item?.code??item,40)).filter((value:string)=>/^\d{1,40}$/.test(value)));
      let remessaResult:Record<string,unknown>={error:null};
      try{
        const collected=await collectRemessas(organizationId,creds,new Set([code]));
        const built=buildRemessaEntries(collected.remessas,collected.entradas,projectMap,categoryMap,new Set([code]));
        remessaResult={error:null,source:collected.source,counts:built.counts,pending:built.pending.slice(0,50),unmatchedReturns:built.unmatchedReturns.slice(0,30),
          entries:built.entries.slice(0,300).map((entry:any)=>({id:entry.externalId,nfNumber:entry.nfNumber,date:entry.date,category:entry.category,grossValue:entry.grossValue,returnedValue:entry.returnedValue,value:entry.value,returns:entry.returns,status:entry.status,active:entry.active}))};
      }catch(error){ remessaResult={error:safeOmieError(error)}; }
      const payableResult:Record<string,unknown>={error:null};
      try{
        const today=new Date().toISOString().slice(0,10);
        const rows=await pagedOmie(OMIE_ENDPOINTS.payables,"ListarContasPagar","conta_pagar_cadastro",{
          apenas_importado_api:"N",filtrar_por_data_de:isoToDdMmYyyy(String(connection?.initial_sync_date||today)),filtrar_por_data_ate:isoToDdMmYyyy(today),
          filtrar_apenas_inclusao:"N",filtrar_apenas_alteracao:"N",filtrar_por_projeto:Number(code)
        },creds,20);
        const byAccount=new Map<string,{code:string;count:number;total:number;card:boolean}>();
        for(const row of rows){
          const account=cleanText((row as any).id_conta_corrente??"",40)||"—";
          const current=byAccount.get(account)||{code:account,count:0,total:0,card:cards.has(account)};
          current.count++;current.total=Math.round((current.total+Math.abs(Number((row as any).valor_documento)||0))*100)/100;
          byAccount.set(account,current);
        }
        payableResult.accounts=[...byAccount.values()].sort((a,b)=>b.total-a.total);
      }catch(error){ payableResult.error=safeOmieError(error); }
      return json(request,{projectCode:code,remessas:remessaResult,payables:payableResult});
    }
    if(action==="remessa-probe"){
      const creds=await credentials(organizationId);
      const probe=async(api:{endpoint:string;list:string;listKey:string},params:(page:number)=>Record<string,unknown>)=>{
        try{
          const first=params(1);
          const data=await omieCall(api.endpoint,api.list,"registros_por_pagina" in first?{...first,registros_por_pagina:5}:{...first,nRegistrosPorPagina:5},creds);
          const rows=listRows(data,api.listKey);
          return {method:api.list,listKey:api.listKey,totalPages:totalPages(data),rows:rows.length,shape:shapeOf(rows[0]??null),rowsSample:rows.slice(0,3)};
        }catch(error){ return isEmptyListError(error)?{method:api.list,rows:0}:{method:api.list,error:safeOmieError(error)}; }
      };
      const status=async(api:{endpoint:string;status:string;statusKey:string},id:string)=>{
        if(!id) return null;
        try{ const data=await omieCall(api.endpoint,api.status,{[api.statusKey]:Number(id)},creds); return {method:api.status,shape:shapeOf(data),parsed:parseStatus(data)}; }
        catch(error){ return {method:api.status,error:safeOmieError(error)}; }
      };
      const remessa=await probe(OMIE_REMESSA_API.remessa,remessaListParams) as any;
      const firstRemessa=(remessa.rowsSample||[])[0];
      const remessaStatus=await status(OMIE_REMESSA_API.remessa,firstRemessa?remessaId(firstRemessa):"");
      const entrada=await probe(OMIE_REMESSA_API.entrada,entradaListParams) as any;
      const firstEntrada=(entrada.rowsSample||[])[0];
      const entradaStatus=await status(OMIE_REMESSA_API.entrada,firstEntrada?entradaId(firstEntrada):"");
      const contas=await probe(OMIE_REMESSA_API.conta,accountListParams) as any;
      const view=(result:any,parser:(row:any)=>unknown)=>{const {rowsSample,...rest}=result||{};return {...rest,parsed:(rowsSample||[]).map(parser)};};
      return json(request,{
        remessa:view(remessa,(row:any)=>parseRemessa(row)),remessaStatus,
        notaEntrada:view(entrada,(row:any)=>parseEntrada(row)),notaEntradaStatus:entradaStatus,
        contasCorrentes:view(contas,(row:any)=>parseAccount(row)),version:"4.5.8"
      });
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
      // v4.2.6 — o pg_cron chama esta rota pelo pg_net, que corta a conexao no
      // timeout configurado; alem disso a propria Edge Function encerra a
      // requisicao ociosa em 150s. Sincronizar dentro da resposta fazia o
      // worker morrer no meio: a execucao ficava presa em 'running', o
      // last_sync_at nunca avancava e a tela mostrava a ultima sincronizacao
      // parada no tempo. Agora respondemos imediatamente e o trabalho segue
      // como tarefa de segundo plano.
      const work=(async()=>{
        for(const row of due){
          try{ await syncOrganization(row.organization_id,null,"automatic",String(row.created_by||"")); }
          catch(error){ console.error("Omie scheduled sync failed",{organizationId:row.organization_id,message:safeOmieError(error)}); }
        }
      })();
      work.catch(()=>{});
      const runtime=(globalThis as any).EdgeRuntime;
      if(due.length&&runtime&&typeof runtime.waitUntil==="function") runtime.waitUntil(work);
      else if(due.length) await work;
      return json(request,{accepted:due.length,organizations:due.map((row:any)=>row.organization_id)});
    }
    return json(request,{error:"Operação inválida."},400);
  }catch(error){
    console.error("Omie integration failure",{action,organizationId,message:safeOmieError(error)});
    return json(request,{error:safeOmieError(error)||"Falha na integração Omie."},409);
  }
});
