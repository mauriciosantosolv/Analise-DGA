// ---------------------------------------------------------------------------
// CliqueObras v4.5.9 — Categorias das REMESSAS para o DE-PARA (somente leitura).
//
// Por quê: a tela "Projetos e categorias" lista só categorias de DESPESA do
// Omie (ListarCategorias filtrando o tipo "D"). A remessa de produtos sai
// numa categoria de RECEITA (ex.: 1.01.02), então nunca aparecia para vincular
// e a remessa ficava "pendente por categoria sem DE-PARA".
//
// Esta função é SEPARADA de propósito: a omie-integration (sincronização,
// catálogo, salvar DE-PARA) não foi tocada. Aqui só se LÊ o Omie:
//   geral/categorias/   ListarCategorias (sem filtro de tipo)
//   produtos/remessa/   ListarRemessas   (para contar quantas remessas usam
//                                          cada categoria — infAdic.cCodCateg)
// Não grava nada. O vínculo continua sendo salvo pelo "Salvar mapeamentos" de
// sempre (omie-integration / save-config), na mesma tabela de DE-PARA.
// Mesmas proteções da omie-integration: origem, sessão, somente o
// proprietário da organização, limite de requisições.
// ---------------------------------------------------------------------------
import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { enforceRateLimit, json, preflight, readJson, rejectUntrustedOrigin } from "../_shared/security.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES_URL="https://app.omie.com.br/api/v1/geral/categorias/";
const REMESSAS_URL="https://app.omie.com.br/api/v1/produtos/remessa/";
type Creds={app_key:string;app_secret:string};

function env(name:string){return String(Deno.env.get(name)??"");}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function cleanText(value:unknown,max=240){
  return String(value??"").replace(/[\u0000-\u001f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
}
function plain(value:unknown){
  return cleanText(value instanceof Error?value.message:value,500).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
}
function isBusy(error:unknown){
  const text=plain(error);
  return text.includes("ja existe uma requisicao desse metodo sendo executada")||text.includes("consumo redundante detectado")||text.includes("too many requests");
}
function isEmptyList(error:unknown){
  const text=plain(error);
  return text.includes("nao existem registros")||text.includes("nenhum registro");
}
function retryDelay(attempt:number,error:unknown){
  const base=[1500,3000,6000][Math.max(0,Math.min(2,attempt))];
  const seconds=Number(cleanText(error instanceof Error?error.message:error,500).match(/(?:aguarde|em)\s+(\d+)\s+segundos?/i)?.[1]||0);
  return Math.min(65000,Math.max(base,seconds?1000*(seconds+1):0));
}
function safeError(error:unknown){
  return cleanText(error instanceof Error?error.message:error,360)
    .replace(/app[_ -]?secret\s*[:=]\s*\S+/gi,"credencial protegida")
    .replace(/app[_ -]?key\s*[:=]\s*\S+/gi,"chave protegida");
}

async function omieCall(endpoint:string,call:string,param:Record<string,unknown>,creds:Creds){
  for(let attempt=0;attempt<4;attempt++){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),25000);
    try{
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({call,app_key:creds.app_key,app_secret:creds.app_secret,param:[param]}),signal:controller.signal});
      const raw=await response.text();
      if(new TextEncoder().encode(raw).byteLength>8*1024*1024) throw new Error("Resposta do Omie excedeu o limite seguro.");
      let data:Record<string,unknown>={};
      try{data=raw?JSON.parse(raw):{};}catch{throw new Error("O Omie retornou uma resposta inválida.");}
      const fault=cleanText(data.faultstring??data.message??data.error_description,360);
      if(!response.ok||fault) throw new Error(fault||`Omie indisponível (${response.status}).`);
      return data;
    }catch(error){
      if(error instanceof DOMException&&error.name==="AbortError") throw new Error("O Omie excedeu o tempo de resposta.");
      if(attempt<3&&isBusy(error)){await sleep(retryDelay(attempt,error));continue;}
      throw error;
    }finally{
      clearTimeout(timeout);
      await sleep(700);
    }
  }
  throw new Error("O Omie não liberou o método de consulta no tempo esperado.");
}

async function listCategories(creds:Creds){
  const rows:Record<string,unknown>[]=[];
  for(let page=1;page<=20;page++){
    const data=await omieCall(CATEGORIES_URL,"ListarCategorias",{pagina:page,registros_por_pagina:500,filtrar_apenas_ativo:"N"},creds);
    const list=Array.isArray(data.categoria_cadastro)?data.categoria_cadastro as Record<string,unknown>[]:[];
    rows.push(...list);
    if(page>=Math.max(1,Number(data.total_de_paginas)||1)||!list.length) break;
  }
  return rows;
}

async function countRemessaCategories(creds:Creds){
  const used=new Map<string,number>();
  let read=0,truncated=true;
  for(let page=1;page<=50;page++){
    let data:Record<string,unknown>;
    try{ data=await omieCall(REMESSAS_URL,"ListarRemessas",{nPagina:page,nRegistrosPorPagina:100,cExibirDetalhes:"S"},creds); }
    catch(error){ if(isEmptyList(error)){truncated=false;break;} throw error; }
    const list=Array.isArray(data.remessas)?data.remessas as any[]:[];
    for(const row of list){
      if(!row||typeof row!=="object") continue;
      read++;
      const code=cleanText(row?.infAdic?.cCodCateg,20);
      if(code) used.set(code,(used.get(code)||0)+1);
    }
    const total=Number(data.nTotalPaginas??data.total_de_paginas);
    if(!list.length||page>=(Number.isFinite(total)&&total>0?total:1)){truncated=false;break;}
  }
  return {used,read,truncated};
}

Deno.serve(async(request:Request)=>{
  if(request.method==="OPTIONS") return preflight(request);
  const originError=rejectUntrustedOrigin(request); if(originError) return originError;
  if(request.method!=="POST") return json(request,{error:"Método não permitido."},405);
  let payload:{organizationId?:string};
  try{payload=await readJson<{organizationId?:string}>(request,4096);}catch{return json(request,{error:"Solicitação inválida."},400);}
  const organizationId=cleanText(payload.organizationId,60);
  if(!UUID.test(organizationId)) return json(request,{error:"Organização inválida."},400);
  const supabaseUrl=env("SUPABASE_URL"),publicKey=env("SUPABASE_ANON_KEY")||env("SUPABASE_PUBLISHABLE_KEY"),serviceKey=env("SUPABASE_SERVICE_ROLE_KEY");
  if(!supabaseUrl||!publicKey||!serviceKey) return json(request,{error:"Integração não configurada."},500);
  const authorization=String(request.headers.get("Authorization")??"");
  if(!authorization.startsWith("Bearer ")) return json(request,{error:"Sessão obrigatória."},401);
  const caller=createClient(supabaseUrl,publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization}}});
  const {data:authData,error:authError}=await caller.auth.getUser();
  if(authError||!authData.user) return json(request,{error:"Sessão inválida."},401);
  const actorId=authData.user.id;
  const {data:membership,error:membershipError}=await caller.from("organization_members").select("role").eq("organization_id",organizationId).eq("user_id",actorId).maybeSingle();
  if(membershipError||!membership||membership.role!=="owner") return json(request,{error:"Somente o proprietário pode administrar a integração Omie."},403);
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const limit=await enforceRateLimit(admin,actorId,"omie-remessa-categories",10,60);
    if(!limit.allowed) return json(request,{error:"Muitas solicitações ao Omie. Aguarde e tente novamente."},429,{"Retry-After":String(limit.retryAfter)});
  }catch{return json(request,{error:"Proteção de requisições indisponível."},503);}
  try{
    const {data:secret,error:secretError}=await admin.rpc("clique_obras_omie_credentials",{target_organization_id:organizationId});
    if(secretError||!secret?.app_key||!secret?.app_secret) return json(request,{error:"A conexão Omie não está configurada."},409);
    const creds={app_key:String(secret.app_key),app_secret:String(secret.app_secret)};
    const categories=await listCategories(creds);
    let used=new Map<string,number>(),remessasRead=0,remessasError:string|null=null,truncated=false;
    try{ const counted=await countRemessaCategories(creds); used=counted.used;remessasRead=counted.read;truncated=counted.truncated; }
    catch(error){ remessasError=safeError(error); }
    const known=new Set<string>();
    const rows:{code:string;name:string;inactive:boolean;remessas:number}[]=[];
    for(const row of categories as any[]){
      if(!row||row.totalizadora==="S") continue;
      const code=cleanText(row.codigo,40); if(!code) continue;
      known.add(code);
      const item={code,name:cleanText(row.descricao||row.descricao_padrao,160),inactive:row.conta_inativa==="S",remessas:used.get(code)||0};
      if(!item.inactive||item.remessas>0) rows.push(item);
    }
    for(const [code,count] of used) if(!known.has(code)) rows.push({code,name:"",inactive:false,remessas:count});
    return json(request,{categories:rows,remessasRead,remessasTruncated:truncated,remessasError,version:"4.5.9"});
  }catch(error){
    return json(request,{error:safeError(error)},502);
  }
});
