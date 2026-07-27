/**
 * Persistência remota do Clique Obras (Supabase Auth + Data REST API).
 *
 * - usa somente a Publishable key no navegador;
 * - cada usuário acessa somente as próprias linhas por RLS;
 * - suporta login, cadastro, confirmação de e-mail e recuperação de senha;
 * - mantém cache local e uma fila offline separada para cada conta.
 */
const Cloud = (() => {
  const SESSION_KEY = 'clique_obras_cloud_session';
  const LEGACY_QUEUE_KEY = 'clique_obras_cloud_queue';
  const QUEUE_PREFIX = 'clique_obras_cloud_queue_user_';
  const BOUND_USER_KEY = 'clique_obras_local_owner';
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
  function redirectUrl(){ return `${location.origin}${location.pathname}`; }
  function loadSession(){
    try{ session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch(e){ session = null; }
    return session;
  }
  function saveSession(data){
    if(!data){ session=null; localStorage.removeItem(SESSION_KEY); return; }
    const previousUser = session && session.user;
    const expiresAt = data.expires_at
      ? Number(data.expires_at) * (Number(data.expires_at) < 1000000000000 ? 1000 : 1)
      : Date.now() + Math.max(60, Number(data.expires_in)||3600)*1000;
    session = {
      access_token:data.access_token,
      refresh_token:data.refresh_token || (session && session.refresh_token),
      expires_at:expiresAt,
      user:data.user || previousUser || null
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  function user(){ return session && session.user; }
  function hasToken(){ return !!(session && session.access_token); }
  function active(){ return configured() && hasToken() && !!user(); }
  function authHeaders(json=true){
    const h = {'apikey':cfg.publishableKey};
    if(hasToken()) h.Authorization = `Bearer ${session.access_token}`;
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
  async function fetchCurrentUser(){
    if(!hasToken()) return null;
    const current = await request('/auth/v1/user', {headers:authHeaders(false)});
    if(current){ session.user=current; localStorage.setItem(SESSION_KEY,JSON.stringify(session)); }
    return current;
  }
  async function signIn(email, password){
    if(!configured()) throw new Error('A nuvem ainda não foi configurada neste pacote.');
    const data = await request('/auth/v1/token?grant_type=password', {
      method:'POST', headers:authHeaders(true), body:JSON.stringify({email,password})
    });
    saveSession(data);
    if(!user()) await fetchCurrentUser();
    return data;
  }
  async function signUp(email, password, displayName=''){
    if(!configured()) throw new Error('A nuvem ainda não foi configurada neste pacote.');
    const path=`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectUrl())}`;
    const data = await request(path, {
      method:'POST', headers:{'apikey':cfg.publishableKey,'Content-Type':'application/json'},
      body:JSON.stringify({
        email,
        password,
        data:{full_name:displayName.trim()}
      })
    });
    if(data && data.access_token){
      saveSession(data);
      if(!user()) await fetchCurrentUser();
    }
    return data;
  }
  async function resetPassword(email){
    const path=`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectUrl())}`;
    return request(path, {
      method:'POST', headers:{'apikey':cfg.publishableKey,'Content-Type':'application/json'},
      body:JSON.stringify({email})
    });
  }
  async function updatePassword(password){
    await ensureFresh();
    return request('/auth/v1/user', {
      method:'PUT', headers:authHeaders(true), body:JSON.stringify({password})
    });
  }
  async function consumeAuthCallback(){
    const raw=String(location.hash||'').replace(/^#/,'');
    if(!/(^|&)(access_token|error|error_description)=/.test(raw)) return null;
    const p=new URLSearchParams(raw);
    const error=p.get('error_description') || p.get('error');
    const type=p.get('type') || '';
    history.replaceState(null,'',`${location.pathname}${location.search}`);
    if(error) return {type,error};
    const token=p.get('access_token');
    if(!token) return null;
    saveSession({
      access_token:token,
      refresh_token:p.get('refresh_token'),
      expires_in:Number(p.get('expires_in'))||3600,
      user:null
    });
    await fetchCurrentUser();
    return {type,user:user()};
  }
  async function refresh(){
    if(!session || !session.refresh_token) return false;
    try{
      const data = await request('/auth/v1/token?grant_type=refresh_token', {
        method:'POST', headers:{'apikey':cfg.publishableKey,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:session.refresh_token})
      });
      saveSession(data);
      if(!user()) await fetchCurrentUser();
      return true;
    }catch(e){ saveSession(null); return false; }
  }
  async function ensureSession(){
    loadSession();
    if(!session) return false;
    if((session.expires_at||0) - Date.now() < 120000){
      const renewed=await refresh();
      if(!renewed) return false;
    }
    if(!user()){
      try{ await fetchCurrentUser(); }
      catch(e){ saveSession(null); return false; }
    }
    return active();
  }
  async function ensureFresh(){
    if(!hasToken()) throw new Error('Sessão da nuvem não está conectada.');
    if((session.expires_at||0) - Date.now() < 120000){
      const ok = await refresh();
      if(!ok) throw new Error('Sua sessão expirou. Entre novamente.');
    }
    if(!user()) await fetchCurrentUser();
  }
  async function signOut(){
    try{
      if(hasToken()) await request('/auth/v1/logout', {method:'POST',headers:authHeaders(false)});
    }catch(e){}
    saveSession(null);
  }

  function boundUserId(){ return localStorage.getItem(BOUND_USER_KEY) || ''; }
  function isAccountSwitch(){ return !!(user() && boundUserId() && boundUserId()!==user().id); }
  function bindCurrentUser(){ if(user()) localStorage.setItem(BOUND_USER_KEY,user().id); }
  function queueStorageKey(){ return user() ? QUEUE_PREFIX+user().id : ''; }
  function queue(){
    const key=queueStorageKey();
    if(!key) return [];
    try{
      let q=JSON.parse(localStorage.getItem(key)||'null');
      if(!Array.isArray(q)){
        q=[];
        const owner=boundUserId();
        if(!owner || owner===user().id){
          const legacy=JSON.parse(localStorage.getItem(LEGACY_QUEUE_KEY)||'[]');
          if(Array.isArray(legacy)) q=legacy;
          localStorage.removeItem(LEGACY_QUEUE_KEY);
        }
        localStorage.setItem(key,JSON.stringify(q));
      }
      return q;
    }catch(e){ return []; }
  }
  function saveQueue(q){
    const key=queueStorageKey();
    if(key) localStorage.setItem(key, JSON.stringify(q.slice(-5000)));
  }
  function enqueue(op){
    const q=queue(); q.push({...op,queuedAt:Date.now()}); saveQueue(q);
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
    configured, requested:()=>cfg.enabled===true, active, ensureSession, signIn, signUp,
    signOut, resetPassword, updatePassword, consumeAuthCallback, refresh, user,
    mirror, flushQueue, readAll, upsertRaw, pendingCount:()=>queue().length,
    boundUserId, isAccountSwitch, bindCurrentUser
  };
})();
