/**
 * Persistência remota do cliqueobras (Supabase Auth + Data REST API).
 *
 * - usa somente a Publishable key no navegador;
 * - compartilha dados por organização, com RLS e permissões por módulo;
 * - suporta convites, confirmação de e-mail e recuperação de senha;
 * - mantém cache e fila offline separados por usuário + organização.
 */
const Cloud = (() => {
  const SESSION_KEY = 'clique_obras_cloud_session';
  const LEGACY_QUEUE_KEY = 'clique_obras_cloud_queue';
  const QUEUE_PREFIX = 'clique_obras_cloud_queue_scope_';
  const BOUND_SCOPE_KEY = 'clique_obras_local_scope';
  const LEGACY_BOUND_USER_KEY = 'clique_obras_local_owner';
  const ACTIVE_ORG_KEY = 'clique_obras_active_organization';
  const ALL_STORES = ['projects','budgets','purchases','planning','clients','categories','settings','measurements'];
  const DEFAULT_PERMISSIONS = {
    view:ALL_STORES.slice(),
    edit:ALL_STORES.slice(),
    manage_users:false
  };
  const cfg = window.CLIQUE_OBRAS_CLOUD || {};
  let session = null;
  let orgContext = {organizations:[], active:null};
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
    if(!data){ session=null; orgContext={organizations:[],active:null}; localStorage.removeItem(SESSION_KEY); return; }
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
      body:JSON.stringify({email,password,data:{full_name:displayName.trim()}})
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
  async function ensureFresh(){
    if(!hasToken()) throw new Error('Sessão da nuvem não está conectada.');
    if((session.expires_at||0) - Date.now() < 120000){
      const ok = await refresh();
      if(!ok) throw new Error('Sua sessão expirou. Entre novamente.');
    }
    if(!user()) await fetchCurrentUser();
  }

  async function acceptPendingInvitations(){
    // A associação e a baixa do convite precisam acontecer na mesma transação.
    // O RPC valida o usuário autenticado e copia exatamente o perfil/permissões
    // definidos pelo administrador, sem permitir promoção pelo navegador.
    const accepted=await request('/rest/v1/rpc/accept_organization_invitations', {
      method:'POST',
      headers:{...authHeaders(true),Prefer:'return=representation'},
      body:'{}'
    });
    return Number(accepted)||0;
  }

  async function loadOrganizationContext(){
    await ensureFresh();
    try{ await acceptPendingInvitations(); }catch(err){
      if(err.status!==404) throw err;
    }
    const memberships=await request(`/rest/v1/organization_members?select=organization_id,role,permissions,joined_at&user_id=eq.${encodeURIComponent(user().id)}&order=joined_at.asc`, {
      headers:authHeaders(false)
    }) || [];
    if(!memberships.length)
      throw new Error('Sua conta ainda não está vinculada a uma organização do cliqueobras.');
    const ids=memberships.map(x=>x.organization_id);
    const organizations=await request(`/rest/v1/organizations?select=id,name,created_by,created_at&id=in.(${ids.map(encodeURIComponent).join(',')})`, {
      headers:authHeaders(false)
    }) || [];
    const byId=Object.fromEntries(organizations.map(x=>[x.id,x]));
    const choices=memberships.map(m=>({
      ...(byId[m.organization_id]||{id:m.organization_id,name:'Organização'}),
      membership:{role:m.role,permissions:m.permissions||{}}
    }));
    const saved=localStorage.getItem(ACTIVE_ORG_KEY);
    const selected=choices.find(x=>x.id===saved) || choices[0];
    localStorage.setItem(ACTIVE_ORG_KEY,selected.id);
    orgContext={organizations:choices,active:selected};
    return orgContext;
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
    try{ await loadOrganizationContext(); }
    catch(e){
      if(e.status===401){ saveSession(null); return false; }
      throw e;
    }
    return active();
  }
  async function signOut(){
    // Remove primeiro a sessão deste navegador. O logout continua funcionando
    // mesmo se o usuário estiver offline ou se o endpoint remoto demorar.
    const accessToken=session && session.access_token;
    saveSession(null);
    localStorage.removeItem(ACTIVE_ORG_KEY);
    const projectRef=(baseUrl().match(/^https:\/\/([a-z0-9-]+)\.supabase\.co$/i)||[])[1];
    if(projectRef) localStorage.removeItem(`sb-${projectRef}-auth-token`);
    if(accessToken){
      fetch(baseUrl()+'/auth/v1/logout',{
        method:'POST',
        keepalive:true,
        headers:{apikey:cfg.publishableKey,Authorization:`Bearer ${accessToken}`}
      }).catch(()=>{});
    }
    return true;
  }

  function organization(){ return orgContext.active; }
  function organizations(){ return orgContext.organizations.slice(); }
  function membership(){ return (organization()||{}).membership || null; }
  function role(){ return (membership()||{}).role || ''; }
  function fullAccess(){ return role()==='owner' || role()==='admin'; }
  function permissionList(kind){
    const p=(membership()||{}).permissions || {};
    return Array.isArray(p[kind]) ? p[kind] : [];
  }
  function canViewStore(store){
    if(!configured()) return true;
    return fullAccess() || permissionList('view').includes(store);
  }
  function canEditStore(store){
    if(!configured()) return true;
    return fullAccess() || permissionList('edit').includes(store);
  }
  function canManageUsers(){
    if(!configured()) return true;
    return fullAccess() || (membership()||{}).permissions?.manage_users===true;
  }
  function canEditAny(){ return fullAccess() || permissionList('edit').length>0; }
  function assertCanEdit(store){
    if(!canEditStore(store)){
      const err=new Error('Seu usuário possui acesso somente para consulta neste módulo.');
      err.status=403;
      throw err;
    }
  }
  function switchOrganization(id){
    if(!orgContext.organizations.some(x=>x.id===id)) throw new Error('Organização não disponível para esta conta.');
    localStorage.setItem(ACTIVE_ORG_KEY,id);
    location.reload();
  }

  function scopeId(){ return user() && organization() ? `${user().id}:${organization().id}` : ''; }
  function boundScopeId(){
    return localStorage.getItem(BOUND_SCOPE_KEY) || localStorage.getItem(LEGACY_BOUND_USER_KEY) || '';
  }
  function isAccountSwitch(){
    const bound=boundScopeId(), current=scopeId();
    if(!bound || !current) return false;
    return bound!==current && bound!==user().id;
  }
  function bindCurrentUser(){
    const current=scopeId();
    if(current){
      localStorage.setItem(BOUND_SCOPE_KEY,current);
      localStorage.removeItem(LEGACY_BOUND_USER_KEY);
    }
  }
  function queueStorageKey(){ return scopeId() ? QUEUE_PREFIX+scopeId() : ''; }
  function queue(){
    const key=queueStorageKey();
    if(!key) return [];
    try{
      let q=JSON.parse(localStorage.getItem(key)||'null');
      if(!Array.isArray(q)){
        q=[];
        if(!boundScopeId() || boundScopeId()===scopeId() || boundScopeId()===user().id){
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
    if(!organization()) throw new Error('Nenhuma organização ativa.');
    return {
      organization_id:organization().id,
      user_id:user().id,
      store,
      record_id:String(obj.id),
      data:obj,
      updated_at:new Date().toISOString()
    };
  }
  async function upsertRaw(store, objects){
    await ensureFresh(); assertCanEdit(store);
    const list=(objects||[]).filter(x=>x && x.id!=null);
    for(let i=0;i<list.length;i+=200){
      const body=list.slice(i,i+200).map(x=>record(store,x));
      await request('/rest/v1/app_records?on_conflict=organization_id%2Cstore%2Crecord_id', {
        method:'POST',
        headers:{...authHeaders(true),Prefer:'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify(body)
      });
    }
  }
  async function deleteRaw(store,id){
    await ensureFresh(); assertCanEdit(store);
    const q=`organization_id=eq.${encodeURIComponent(organization().id)}&store=eq.${encodeURIComponent(store)}&record_id=eq.${encodeURIComponent(String(id))}`;
    await request('/rest/v1/app_records?'+q,{method:'DELETE',headers:authHeaders(false)});
  }
  async function clearRaw(store){
    await ensureFresh(); assertCanEdit(store);
    const q=`organization_id=eq.${encodeURIComponent(organization().id)}&store=eq.${encodeURIComponent(store)}`;
    await request('/rest/v1/app_records?'+q,{method:'DELETE',headers:authHeaders(false)});
  }
  async function mirror(op){
    if(!active()) return;
    assertCanEdit(op.store);
    try{
      if(op.type==='put') await upsertRaw(op.store,[op.object]);
      else if(op.type==='bulkPut') await upsertRaw(op.store,op.objects);
      else if(op.type==='delete') await deleteRaw(op.store,op.id);
      else if(op.type==='clear') await clearRaw(op.store);
    }catch(e){
      if(e.status===401 || e.status===403) throw e;
      enqueue(op);
    }
  }
  async function flushQueue(){
    if(!active()) return 0;
    const pending=queue(); if(!pending.length) return 0;
    const remaining=[]; let done=0;
    for(let i=0;i<pending.length;i++){
      const op=pending[i];
      try{
        assertCanEdit(op.store);
        if(op.type==='put') await upsertRaw(op.store,[op.object]);
        else if(op.type==='bulkPut') await upsertRaw(op.store,op.objects);
        else if(op.type==='delete') await deleteRaw(op.store,op.id);
        else if(op.type==='clear') await clearRaw(op.store);
        done++;
      }catch(e){
        if(e.status===401 || e.status===403){ done++; continue; }
        remaining.push(...pending.slice(i)); break;
      }
    }
    saveQueue(remaining);
    if(!remaining.length) warnedOffline=false;
    return done;
  }
  async function readAll(){
    await ensureFresh();
    if(!organization()) throw new Error('Nenhuma organização ativa.');
    const out=[]; const size=1000;
    for(let start=0;;start+=size){
      const q=`select=store,record_id,data,updated_at&organization_id=eq.${encodeURIComponent(organization().id)}&order=updated_at.asc`;
      const res=await fetch(baseUrl()+'/rest/v1/app_records?'+q,{
        headers:{...authHeaders(false),Range:`${start}-${start+size-1}`}
      });
      if(!res.ok) throw await responseError(res);
      const rows=await res.json(); out.push(...rows);
      if(rows.length<size) break;
    }
    return out;
  }

  function normalizedPermissions(input={}){
    const view=[...new Set((input.view||[]).filter(x=>ALL_STORES.includes(x)))];
    const edit=[...new Set((input.edit||[]).filter(x=>view.includes(x)))];
    return {view,edit,manage_users:input.manage_users===true};
  }
  async function listTeam(){
    await ensureFresh();
    if(!organization() || !canManageUsers()) throw new Error('Você não possui permissão para gerenciar usuários.');
    const orgId=encodeURIComponent(organization().id);
    const members=await request(`/rest/v1/organization_members?select=user_id,role,permissions,joined_at&organization_id=eq.${orgId}&order=joined_at.asc`, {
      headers:authHeaders(false)
    }) || [];
    const userIds=members.map(x=>x.user_id);
    let profiles=[];
    if(userIds.length){
      profiles=await request(`/rest/v1/profiles?select=id,email,full_name&id=in.(${userIds.map(encodeURIComponent).join(',')})`, {
        headers:authHeaders(false)
      }) || [];
    }
    const byId=Object.fromEntries(profiles.map(x=>[x.id,x]));
    const invitations=await request(`/rest/v1/organization_invitations?select=id,email,role,permissions,status,created_at&organization_id=eq.${orgId}&status=eq.pending&order=created_at.desc`, {
      headers:authHeaders(false)
    }) || [];
    return {members:members.map(x=>({...x,profile:byId[x.user_id]||{id:x.user_id,email:'',full_name:''}})),invitations};
  }
  async function inviteMember(email, roleName, permissions){
    await ensureFresh();
    if(!canManageUsers()) throw new Error('Você não possui permissão para convidar usuários.');
    const body={
      organization_id:organization().id,
      email:String(email||'').trim().toLowerCase(),
      role:['admin','editor','viewer'].includes(roleName)?roleName:'viewer',
      permissions:normalizedPermissions(permissions),
      invited_by:user().id
    };
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new Error('Informe um e-mail válido.');
    await request('/rest/v1/organization_invitations', {
      method:'POST',headers:{...authHeaders(true),Prefer:'return=minimal'},body:JSON.stringify(body)
    });
  }
  async function updateMember(userId, roleName, permissions){
    await ensureFresh();
    if(!canManageUsers()) throw new Error('Você não possui permissão para editar usuários.');
    const body={
      role:['admin','editor','viewer'].includes(roleName)?roleName:'viewer',
      permissions:normalizedPermissions(permissions)
    };
    await request(`/rest/v1/organization_members?organization_id=eq.${encodeURIComponent(organization().id)}&user_id=eq.${encodeURIComponent(userId)}`, {
      method:'PATCH',headers:{...authHeaders(true),Prefer:'return=minimal'},body:JSON.stringify(body)
    });
  }
  async function removeMember(userId){
    await ensureFresh();
    if(!canManageUsers()) throw new Error('Você não possui permissão para remover usuários.');
    await request(`/rest/v1/organization_members?organization_id=eq.${encodeURIComponent(organization().id)}&user_id=eq.${encodeURIComponent(userId)}`, {
      method:'DELETE',headers:authHeaders(false)
    });
  }
  async function cancelInvitation(id){
    await ensureFresh();
    if(!canManageUsers()) throw new Error('Você não possui permissão para cancelar convites.');
    await request(`/rest/v1/organization_invitations?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(organization().id)}`, {
      method:'DELETE',headers:authHeaders(false)
    });
  }
  async function updateOrganizationName(name){
    await ensureFresh();
    const clean=String(name||'').trim();
    if(!clean) throw new Error('Informe o nome da organização.');
    await request(`/rest/v1/organizations?id=eq.${encodeURIComponent(organization().id)}`, {
      method:'PATCH',headers:{...authHeaders(true),Prefer:'return=minimal'},body:JSON.stringify({name:clean})
    });
    organization().name=clean;
  }

  loadSession();
  return {
    configured, requested:()=>cfg.enabled===true, active, ensureSession, signIn, signUp,
    signOut, resetPassword, updatePassword, consumeAuthCallback, refresh, user,
    organization, organizations, membership, role, switchOrganization,
    canViewStore, canEditStore, canEditAny, canManageUsers, assertCanEdit,
    mirror, flushQueue, readAll, upsertRaw, pendingCount:()=>queue().length,
    boundUserId:boundScopeId, isAccountSwitch, bindCurrentUser,
    listTeam, inviteMember, updateMember, removeMember, cancelInvitation,
    updateOrganizationName, DEFAULT_PERMISSIONS, ALL_STORES
  };
})();
