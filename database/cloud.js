/**
 * Persistência remota do Clique Obras (Supabase Auth + Data REST API).
 *
 * A nuvem é opcional até config/cloud-config.js ser preenchido. Quando ativa:
 * - exige login por e-mail e senha;
 * - usa apenas a Publishable key no navegador;
 * - cada usuário acessa somente as próprias linhas por RLS;
 * - gravações mantêm cache local e entram em fila se a rede cair.
 */
const Cloud = (() => {
  const SESSION_KEY = 'clique_obras_cloud_session';
  const QUEUE_KEY = 'clique_obras_cloud_queue';
  const cfg = window.CLIQUE_OBRAS_CLOUD || {};
  let session = null;
  let warnedOffline = false;

  function configured(){
    return cfg.enabled === true && cfg.provider === 'supabase' &&
      /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(String(cfg.url||'')) &&
      /^(sb_publishable_|eyJ)/.test(String(cfg.publishableKey||'')) &&
      !/SUBSTITUA|SEU-PROJETO/i.test(`${cfg.url} ${cfg.publishableKey}`);
  }
  function baseUrl(){ return String(cfg.url||'').replace(/\/+$/,''); }
  function loadSession(){
    try{ session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch(e){ session = null; }
    return session;
  }
  function saveSession(data){
    if(!data){ session=null; localStorage.removeItem(SESSION_KEY); return; }
    session = {
      access_token:data.access_token,
      refresh_token:data.refresh_token,
      expires_at:Date.now() + Math.max(60, Number(data.expires_in)||3600)*1000,
      user:data.user
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  function user(){ return session && session.user; }
  function active(){ return configured() && !!(session && session.access_token && user()); }
  function authHeaders(json=true){
    const h = {'apikey':cfg.publishableKey};
    if(active()) h.Authorization = `Bearer ${session.access_token}`;
    if(json) h['Content-Type'] = 'application/json';
    return h;
  }
  async function responseError(res){
    let detail = '';
    try{
      const body = await res.json();
      detail = body.msg || body.message || body.error_description || body.error || body.details || '';
    }catch(e){ try{ detail = await res.text(); }catch(x){} }
    const err = new Error(detail || `Falha na nuvem (${res.status})`);
    err.status = res.status;
    return err;
  }
  async function request(path, options={}){
    const res = await fetch(baseUrl()+path, options);
    if(!res.ok) throw await responseError(res);
    if(res.status===204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  async function signIn(email, password){
    if(!configured()) throw new Error('A nuvem ainda não foi configurada neste pacote.');
    const data = await request('/auth/v1/token?grant_type=password', {
      method:'POST', headers:authHeaders(true), body:JSON.stringify({email,password})
    });
    saveSession(data);
    return data;
  }
  async function refresh(){
    if(!session || !session.refresh_token) return false;
    try{
      const data = await request('/auth/v1/token?grant_type=refresh_token', {
        method:'POST', headers:{'apikey':cfg.publishableKey,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:session.refresh_token})
      });
      saveSession(data); return true;
    }catch(e){ saveSession(null); return false; }
  }
  async function ensureSession(){
    loadSession();
    if(!session) return false;
    if((session.expires_at||0) - Date.now() < 120000) return refresh();
    return active();
  }
  async function ensureFresh(){
    if(!active()) throw new Error('Sessão da nuvem não está conectada.');
    if((session.expires_at||0) - Date.now() < 120000){
      const ok = await refresh();
      if(!ok) throw new Error('Sua sessão expirou. Entre novamente.');
    }
  }
  async function signOut(){
    try{
      if(active()) await request('/auth/v1/logout', {method:'POST',headers:authHeaders(false)});
    }catch(e){}
    saveSession(null);
  }

  function queue(){
    try{ const q=JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]'); return Array.isArray(q)?q:[]; }
    catch(e){ return []; }
  }
  function saveQueue(q){ localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-5000))); }
  function enqueue(op){
    const q=queue(); q.push({...op, queuedAt:Date.now()}); saveQueue(q);
    if(!warnedOffline && typeof UI!=='undefined'){
      warnedOffline=true;
      UI.toast('Sem conexão com a nuvem. A alteração ficou salva neste aparelho e será sincronizada automaticamente.', 'warn', 7000);
    }
  }
  function record(store, obj){
    return {user_id:user().id, store, record_id:String(obj.id), data:obj, updated_at:new Date().toISOString()};
  }
  async function upsertRaw(store, objects){
    await ensureFresh();
    const list = (objects||[]).filter(x=>x && x.id!=null);
    for(let i=0;i<list.length;i+=200){
      const body=list.slice(i,i+200).map(x=>record(store,x));
      await request('/rest/v1/app_records?on_conflict=user_id%2Cstore%2Crecord_id', {
        method:'POST',
        headers:{...authHeaders(true),Prefer:'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify(body)
      });
    }
  }
  async function deleteRaw(store,id){
    await ensureFresh();
    const q=`user_id=eq.${encodeURIComponent(user().id)}&store=eq.${encodeURIComponent(store)}&record_id=eq.${encodeURIComponent(String(id))}`;
    await request('/rest/v1/app_records?'+q,{method:'DELETE',headers:authHeaders(false)});
  }
  async function clearRaw(store){
    await ensureFresh();
    const q=`user_id=eq.${encodeURIComponent(user().id)}&store=eq.${encodeURIComponent(store)}`;
    await request('/rest/v1/app_records?'+q,{method:'DELETE',headers:authHeaders(false)});
  }
  async function mirror(op){
    if(!active()) return;
    try{
      if(op.type==='put') await upsertRaw(op.store,[op.object]);
      else if(op.type==='bulkPut') await upsertRaw(op.store,op.objects);
      else if(op.type==='delete') await deleteRaw(op.store,op.id);
      else if(op.type==='clear') await clearRaw(op.store);
    }catch(e){ enqueue(op); }
  }
  async function flushQueue(){
    if(!active()) return 0;
    const pending=queue(); if(!pending.length) return 0;
    const remaining=[]; let done=0;
    for(let i=0;i<pending.length;i++){
      const op=pending[i];
      try{
        if(op.type==='put') await upsertRaw(op.store,[op.object]);
        else if(op.type==='bulkPut') await upsertRaw(op.store,op.objects);
        else if(op.type==='delete') await deleteRaw(op.store,op.id);
        else if(op.type==='clear') await clearRaw(op.store);
        done++;
      }catch(e){ remaining.push(...pending.slice(i)); break; }
    }
    saveQueue(remaining);
    if(!remaining.length) warnedOffline=false;
    return done;
  }
  async function readAll(){
    await ensureFresh();
    const out=[]; const size=1000;
    for(let start=0;;start+=size){
      const q=`select=store,record_id,data,updated_at&user_id=eq.${encodeURIComponent(user().id)}&order=updated_at.asc`;
      const res=await fetch(baseUrl()+'/rest/v1/app_records?'+q,{
        headers:{...authHeaders(false),Range:`${start}-${start+size-1}`}
      });
      if(!res.ok) throw await responseError(res);
      const rows=await res.json(); out.push(...rows);
      if(rows.length<size) break;
    }
    return out;
  }

  loadSession();
  return {
    configured, requested:()=>cfg.enabled===true, active, ensureSession, signIn, signOut, refresh, user,
    mirror, flushQueue, readAll, upsertRaw, pendingCount:()=>queue().length
  };
})();
