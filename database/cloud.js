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
  const RDO_BUCKET = 'rdo-evidencias';
  const PROFILE_BUCKET = 'profile-avatars';
  const ALL_STORES = [
    'projects','budgets','purchases','planning','clients','categories','settings','measurements',
    'rdos','crew','labor_rates','rdo_financial','planning_history'
  ];
  const DEFAULT_PERMISSIONS = {
    view:ALL_STORES.slice(),
    edit:ALL_STORES.slice(),
    manage_users:false,
    rdo_projects:[]
  };
  const cfg = window.CLIQUE_OBRAS_CLOUD || {};
  let session = null;
  let orgContext = {organizations:[], active:null};
  let realtimeClient = null;
  let realtimeChannel = null;
  let realtimeStatus = 'CLOSED';
  let warnedOffline = false;
  let accessDeniedMessage = '';
  let profileContext = {avatarPath:'',avatarUrl:'',avatarPromise:null};
  const recordVersions = new Map();
  const pendingWriteEchoes = new Map();
  const pendingDeleteEchoes = new Map();

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
    if(!data){
      if(profileContext.avatarUrl) URL.revokeObjectURL(profileContext.avatarUrl);
      profileContext={avatarPath:'',avatarUrl:'',avatarPromise:null};
      session=null; orgContext={organizations:[],active:null}; localStorage.removeItem(SESSION_KEY); return;
    }
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
  async function updateDisplayName(displayName){
    await ensureFresh();
    const clean=String(displayName||'').trim().replace(/\s+/g,' ');
    if(clean.length<2) throw new Error('Informe um nome com pelo menos 2 caracteres.');
    if(clean.length>100) throw new Error('O nome pode ter no máximo 100 caracteres.');
    const result=await request('/auth/v1/user', {
      method:'PUT',
      headers:authHeaders(true),
      body:JSON.stringify({data:{full_name:clean}})
    });
    const updated=result&&result.user ? result.user : result;
    if(updated&&updated.id){
      session.user=updated;
      localStorage.setItem(SESSION_KEY,JSON.stringify(session));
    }else{
      await fetchCurrentUser();
    }
    return user();
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
      if(realtimeClient && session && session.access_token)
        await realtimeClient.realtime.setAuth(session.access_token);
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
    const email=String((user()||{}).email||'').trim().toLowerCase();
    if(!email) return 0;
    try{
      const result=await request('/rest/v1/rpc/accept_organization_invitations', {
        method:'POST',headers:authHeaders(true),body:'{}'
      });
      return Number(result)||0;
    }catch(err){
      // Compatibilidade temporária com instalações anteriores à migração v2.3.
      if(err.status!==404) throw err;
    }
    const invites=await request(`/rest/v1/organization_invitations?select=id,organization_id,role,permissions&status=eq.pending&email=eq.${encodeURIComponent(email)}`, {
      headers:authHeaders(false)
    }) || [];
    let accepted=0;
    for(const invite of invites){
      await request('/rest/v1/organization_members?on_conflict=organization_id%2Cuser_id', {
        method:'POST',
        headers:{...authHeaders(true),Prefer:'resolution=ignore-duplicates,return=minimal'},
        body:JSON.stringify({
          organization_id:invite.organization_id,
          user_id:user().id,
          role:invite.role||'viewer',
          permissions:invite.permissions||{view:['projects'],edit:[],manage_users:false}
        })
      });
      await request(`/rest/v1/organization_invitations?id=eq.${encodeURIComponent(invite.id)}`, {
        method:'PATCH',
        headers:{...authHeaders(true),Prefer:'return=minimal'},
        body:JSON.stringify({status:'accepted',accepted_at:new Date().toISOString()})
      });
      accepted++;
    }
    return accepted;
  }

  async function loadOrganizationContext(){
    await ensureFresh();
    try{ await acceptPendingInvitations(); }catch(err){
      if(err.status!==404) throw err;
    }
    const memberships=await request(`/rest/v1/organization_members?select=organization_id,role,permissions,joined_at&user_id=eq.${encodeURIComponent(user().id)}&order=joined_at.asc`, {
      headers:authHeaders(false)
    }) || [];
    if(!memberships.length){
      const err=new Error('Seu acesso ao CliqueObras foi removido ou ainda não foi liberado por uma organização.');
      err.code='NO_ORGANIZATION_ACCESS';
      throw err;
    }
    const ids=memberships.map(x=>x.organization_id);
    const organizations=await request(`/rest/v1/organizations?select=id,name,created_by,created_at&id=in.(${ids.map(encodeURIComponent).join(',')})`, {
      headers:authHeaders(false)
    }) || [];
    const profiles=await request(`/rest/v1/profiles?select=active_organization_id,avatar_path&id=eq.${encodeURIComponent(user().id)}&limit=1`, {
      headers:authHeaders(false)
    }) || [];
    const byId=Object.fromEntries(organizations.map(x=>[x.id,x]));
    const choices=memberships.map(m=>({
      ...(byId[m.organization_id]||{id:m.organization_id,name:'Organização'}),
      membership:{role:m.role,permissions:m.permissions||{}},
      joinedAt:m.joined_at
    }));
    const cloudSaved=profiles[0] && profiles[0].active_organization_id;
    const nextAvatarPath=String(profiles[0]?.avatar_path||'');
    if(nextAvatarPath!==profileContext.avatarPath){
      if(profileContext.avatarUrl) URL.revokeObjectURL(profileContext.avatarUrl);
      profileContext={avatarPath:nextAvatarPath,avatarUrl:'',avatarPromise:null};
    }
    const localSaved=localStorage.getItem(ACTIVE_ORG_KEY);
    const selected=choices.find(x=>x.id===cloudSaved) ||
      choices.find(x=>x.id===localSaved) ||
      choices[0];
    localStorage.setItem(ACTIVE_ORG_KEY,selected.id);
    orgContext={organizations:choices,active:selected};
    // Migra a preferência que existia apenas neste navegador para o perfil
    // remoto. Assim, o mesmo usuário abre a mesma organização em qualquer
    // aparelho.
    if(cloudSaved!==selected.id){
      await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(user().id)}`, {
        method:'PATCH',
        headers:{...authHeaders(true),Prefer:'return=minimal'},
        body:JSON.stringify({active_organization_id:selected.id})
      });
    }
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
      if(e.code==='NO_ORGANIZATION_ACCESS'){
        accessDeniedMessage='Acesso indisponível. Solicite ao administrador da organização para liberar novamente a sua conta.';
        saveSession(null);
        localStorage.removeItem(ACTIVE_ORG_KEY);
        return false;
      }
      throw e;
    }
    return active();
  }
  async function signOut({preserveQueue=false}={}){
    const accessToken=session&&session.access_token;
    stopRealtime();
    if(!preserveQueue) clearCurrentQueue();
    saveSession(null);
    if(!accessToken) return;
    const controller=typeof AbortController!=='undefined' ? new AbortController() : null;
    const timeout=controller ? setTimeout(()=>controller.abort(),1500) : null;
    try{
      await fetch(baseUrl()+'/auth/v1/logout', {
        method:'POST',
        headers:{apikey:cfg.publishableKey,Authorization:`Bearer ${accessToken}`},
        ...(controller?{signal:controller.signal}:{})
      });
    }catch(e){}finally{ if(timeout) clearTimeout(timeout); }
  }

  function organization(){ return orgContext.active; }
  function organizations(){ return orgContext.organizations.slice(); }
  function membership(){ return (organization()||{}).membership || null; }
  function role(){ return (membership()||{}).role || ''; }
  function isOwner(){ return role()==='owner'; }
  function fullAccess(){ return role()==='owner' || role()==='admin'; }
  function permissionList(kind){
    const p=(membership()||{}).permissions || {};
    return Array.isArray(p[kind]) ? p[kind] : [];
  }
  function canViewStore(store){
    if(!configured()) return true;
    const permissionStore=store==='planning_history'?'planning':store==='workforce_status'?'rdos':store;
    return fullAccess() || permissionList('view').includes(permissionStore);
  }
  function canEditStore(store){
    if(!configured()) return true;
    const permissionStore=store==='planning_history'?'planning':store;
    return fullAccess() || permissionList('edit').includes(permissionStore);
  }
  function canManageUsers(){
    if(!configured()) return true;
    return fullAccess();
  }
  function rdoProjects(){
    if(fullAccess()) return State.projects.map(p=>({id:String(p.id),label:U.projLabel(p)}));
    const list=(membership()||{}).permissions?.rdo_projects;
    return Array.isArray(list)
      ? list.filter(x=>x && x.id!=null).map(x=>({id:String(x.id),label:String(x.label||'Projeto')}))
      : [];
  }
  function canUseRdoProject(projectId){
    return fullAccess() || rdoProjects().some(x=>x.id===String(projectId));
  }
  function canEditAny(){ return fullAccess() || permissionList('edit').length>0; }
  function assertCanEdit(store){
    if(!canEditStore(store)){
      const err=new Error('Seu usuário possui acesso somente para consulta neste módulo.');
      err.status=403;
      throw err;
    }
  }
  async function switchOrganization(id){
    if(!orgContext.organizations.some(x=>x.id===id)) throw new Error('Organização não disponível para esta conta.');
    await ensureFresh();
    await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(user().id)}`, {
      method:'PATCH',
      headers:{...authHeaders(true),Prefer:'return=minimal'},
      body:JSON.stringify({active_organization_id:id})
    });
    localStorage.setItem(ACTIVE_ORG_KEY,id);
    stopRealtime();
    location.reload();
  }

  async function refreshOrganizationContext(){
    const previousId=(organization()||{}).id || '';
    await loadOrganizationContext();
    return {
      changed:previousId!==((organization()||{}).id||''),
      organization:organization()
    };
  }

  function stopRealtime(){
    if(realtimeClient && realtimeChannel){
      try{ realtimeClient.removeChannel(realtimeChannel); }catch(e){}
    }
    realtimeChannel=null;
    realtimeClient=null;
    realtimeStatus='CLOSED';
  }

  async function startRealtime(onChange){
    stopRealtime();
    if(!active() || !organization() || !window.supabase || typeof window.supabase.createClient!=='function')
      return false;
    realtimeClient=window.supabase.createClient(baseUrl(),cfg.publishableKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      realtime:{params:{eventsPerSecond:10}}
    });
    await realtimeClient.realtime.setAuth(session.access_token);
    const orgId=organization().id;
    const emit=(kind,payload)=>{
      if(typeof onChange==='function') onChange({kind,payload,organizationId:orgId});
    };
    const isLocalRecordEcho=payload=>{
      const eventType=String(payload&&payload.eventType||'').toUpperCase();
      const row=eventType==='DELETE' ? payload&&payload.old : payload&&payload.new;
      if(!row || !row.store || row.record_id==null) return false;
      const key=recordVersionKey(row.store,row.record_id);
      const now=Date.now();
      const recentDelete=pendingDeleteEchoes.get(key);
      if(eventType==='DELETE' && recentDelete && now-recentDelete<8000){
        pendingDeleteEchoes.delete(key);
        return true;
      }
      const pending=pendingWriteEchoes.get(key);
      if(eventType!=='DELETE' && pending && now-pending.at<8000 && pending.updatedAt===row.updated_at){
        pendingWriteEchoes.delete(key);
        return true;
      }
      return false;
    };
    let subscribedOnce=false;
    realtimeChannel=realtimeClient
      .channel(`clique-obras-${orgId}-${user().id}`)
      .on('postgres_changes',{
        event:'*',schema:'public',table:'app_records',
        filter:`organization_id=eq.${orgId}`
      },payload=>{ if(!isLocalRecordEcho(payload)) emit('records',payload); })
      .on('postgres_changes',{
        event:'*',schema:'public',table:'organization_members'
      },payload=>emit('membership',payload))
      .on('postgres_changes',{
        event:'UPDATE',schema:'public',table:'organizations',
        filter:`id=eq.${orgId}`
      },payload=>emit('organization',payload))
      .subscribe((status,error)=>{
        realtimeStatus=status;
        if(status==='SUBSCRIBED'){
          if(subscribedOnce) emit('reconnected',null);
          subscribedOnce=true;
        }else if(error && typeof console!=='undefined'){
          console.warn('Falha na sincronização em tempo real.',error);
        }
      });
    return true;
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
  function recordVersionKey(store,id){ return `${store}:${String(id)}`; }
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
    if(!key) return;
    if(q.length>5000) throw new Error('A fila offline atingiu o limite de segurança. Conecte este aparelho antes de continuar alterando dados.');
    localStorage.setItem(key, JSON.stringify(q));
  }
  function clearCurrentQueue(){
    const key=queueStorageKey();
    if(key) localStorage.removeItem(key);
    warnedOffline=false;
  }
  function queueMetadata(op){
    const queuedAt=Date.now();
    const targets=op.type==='put' ? [op.object] :
      op.type==='bulkPut' ? (op.objects||[]) :
      op.type==='delete' ? [{id:op.id}] : [];
    const baseVersions={};
    targets.filter(x=>x&&x.id!=null).forEach(x=>{
      const key=recordVersionKey(op.store,x.id);
      baseVersions[String(x.id)]=recordVersions.get(key)||null;
    });
    return {...op,queuedAt,baseVersions};
  }
  function enqueue(op){
    if(op.type==='clear')
      throw new Error('Por segurança, uma limpeza completa não pode ser enfileirada offline. Reconecte-se e tente novamente.');
    const q=queue(); q.push(queueMetadata(op)); saveQueue(q);
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
      body.forEach(item=>{
        const key=recordVersionKey(store,item.record_id);
        pendingWriteEchoes.set(key,{updatedAt:item.updated_at,at:Date.now()});
        setTimeout(()=>{
          const pending=pendingWriteEchoes.get(key);
          if(pending&&pending.updatedAt===item.updated_at) pendingWriteEchoes.delete(key);
        },10000);
      });
      try{
        await request('/rest/v1/app_records?on_conflict=organization_id%2Cstore%2Crecord_id', {
          method:'POST',
          headers:{...authHeaders(true),Prefer:'resolution=merge-duplicates,return=minimal'},
          body:JSON.stringify(body)
        });
        body.forEach(item=>recordVersions.set(recordVersionKey(store,item.record_id),item.updated_at));
      }catch(err){
        body.forEach(item=>pendingWriteEchoes.delete(recordVersionKey(store,item.record_id)));
        throw err;
      }
    }
  }
  async function deleteRaw(store,id){
    await ensureFresh(); assertCanEdit(store);
    const key=recordVersionKey(store,id);
    pendingDeleteEchoes.set(key,Date.now());
    setTimeout(()=>pendingDeleteEchoes.delete(key),10000);
    const q=`organization_id=eq.${encodeURIComponent(organization().id)}&store=eq.${encodeURIComponent(store)}&record_id=eq.${encodeURIComponent(String(id))}`;
    try{
      await request('/rest/v1/app_records?'+q,{method:'DELETE',headers:authHeaders(false)});
      recordVersions.delete(key);
    }catch(err){
      pendingDeleteEchoes.delete(key);
      throw err;
    }
  }
  async function clearRaw(store){
    await ensureFresh(); assertCanEdit(store);
    const q=`organization_id=eq.${encodeURIComponent(organization().id)}&store=eq.${encodeURIComponent(store)}`;
    await request('/rest/v1/app_records?'+q,{method:'DELETE',headers:authHeaders(false)});
    for(const key of [...recordVersions.keys()]) if(key.startsWith(`${store}:`)) recordVersions.delete(key);
  }
  function retryable(err){
    const status=Number(err&&err.status)||0;
    return !status || [408,425,429].includes(status) || status>=500;
  }
  async function applyOperation(op){
    if(op.type==='put') await upsertRaw(op.store,[op.object]);
    else if(op.type==='bulkPut') await upsertRaw(op.store,op.objects);
    else if(op.type==='delete') await deleteRaw(op.store,op.id);
    else if(op.type==='clear') await clearRaw(op.store);
  }
  async function mirror(op){
    if(!active()) return;
    assertCanEdit(op.store);
    try{
      await applyOperation(op);
    }catch(e){
      if(!retryable(e)) throw e;
      enqueue(op);
    }
  }
  function conflictFor(op,remoteVersions){
    if(op.type==='clear') return true;
    const targets=op.type==='put' ? [op.object] :
      op.type==='bulkPut' ? (op.objects||[]) :
      op.type==='delete' ? [{id:op.id}] : [];
    return targets.some(item=>{
      if(!item || item.id==null) return false;
      const id=String(item.id);
      const current=remoteVersions.get(recordVersionKey(op.store,id))||null;
      const base=Object.prototype.hasOwnProperty.call(op.baseVersions||{},id)
        ? op.baseVersions[id] : null;
      return current!==base;
    });
  }
  async function flushQueue(remoteRows=[]){
    if(!active()) return 0;
    const pending=queue(); if(!pending.length) return 0;
    const remoteVersions=new Map();
    (remoteRows||[]).forEach(row=>{
      if(row&&row.store&&row.record_id!=null)
        remoteVersions.set(recordVersionKey(row.store,row.record_id),row.updated_at||null);
    });
    let done=0;
    for(let i=0;i<pending.length;i++){
      const op=pending[i];
      try{
        assertCanEdit(op.store);
        if(conflictFor(op,remoteVersions)){
          const err=new Error('Conflito de sincronização detectado. A versão da nuvem mudou enquanto este aparelho estava offline; nenhuma alteração foi sobrescrita.');
          err.code='SYNC_CONFLICT';
          throw err;
        }
        await applyOperation(op);
        if(op.type==='put' && op.object)
          remoteVersions.set(recordVersionKey(op.store,op.object.id),recordVersions.get(recordVersionKey(op.store,op.object.id)));
        if(op.type==='bulkPut') (op.objects||[]).forEach(item=>{
          if(item&&item.id!=null) remoteVersions.set(recordVersionKey(op.store,item.id),recordVersions.get(recordVersionKey(op.store,item.id)));
        });
        if(op.type==='delete') remoteVersions.delete(recordVersionKey(op.store,op.id));
        done++;
      }catch(e){
        saveQueue(pending.slice(i));
        throw e;
      }
    }
    saveQueue([]);
    warnedOffline=false;
    return done;
  }
  async function readAll(){
    await ensureFresh();
    if(!organization()) throw new Error('Nenhuma organização ativa.');
    const out=[]; const size=1000;
    for(let start=0;;start+=size){
      const q=`select=store,record_id,data,updated_at&organization_id=eq.${encodeURIComponent(organization().id)}&order=updated_at.asc,store.asc,record_id.asc`;
      const res=await fetch(baseUrl()+'/rest/v1/app_records?'+q,{
        headers:{...authHeaders(false),Range:`${start}-${start+size-1}`}
      });
      if(!res.ok) throw await responseError(res);
      const rows=await res.json(); out.push(...rows);
      if(rows.length<size) break;
    }
    recordVersions.clear();
    out.forEach(row=>{
      if(row&&row.store&&row.record_id!=null)
        recordVersions.set(recordVersionKey(row.store,row.record_id),row.updated_at||null);
    });
    return out;
  }

  async function occupiedRdoEmployees(date,excludeRdoId=''){
    await ensureFresh();
    if(!organization() || !canViewStore('rdos')) return [];
    const rows=await request('/rest/v1/rpc/clique_obras_rdo_occupied_employees',{
      method:'POST',
      headers:authHeaders(true),
      body:JSON.stringify({
        p_organization_id:organization().id,
        p_date:String(date||'').slice(0,10),
        p_exclude_rdo_id:String(excludeRdoId||'')||null
      })
    }) || [];
    return [...new Set(rows.map(row=>String(row&&row.employee_id||'')).filter(Boolean))];
  }

  async function measurementLinks(projectId=''){
    await ensureFresh();
    if(!organization() || !canViewStore('measurements')) return [];
    const parts=[
      `select=rdo_id,measurement_id,project_id,linked_at`,
      `organization_id=eq.${encodeURIComponent(organization().id)}`
    ];
    if(projectId) parts.push(`project_id=eq.${encodeURIComponent(String(projectId))}`);
    return request('/rest/v1/rdo_measurement_links?'+parts.join('&'),{headers:authHeaders(false)}) || [];
  }

  async function claimRdoMeasurement(rdoIds,measurementId,projectId){
    await ensureFresh();
    if(!organization() || !canEditStore('measurements')) throw new Error('Medição indisponível.');
    const unique=[...new Set((rdoIds||[]).map(String).filter(Boolean))];
    if(!unique.length) throw new Error('Selecione ao menos um RDO aprovado.');
    const rows=unique.map(rdoId=>({
      organization_id:organization().id,
      rdo_id:rdoId,
      measurement_id:String(measurementId),
      project_id:String(projectId),
      linked_by:user().id
    }));
    try{
      await request('/rest/v1/rdo_measurement_links',{
        method:'POST',
        headers:{...authHeaders(true),Prefer:'return=minimal'},
        body:JSON.stringify(rows)
      });
    }catch(err){
      if(err.status===409) throw new Error('Um dos RDOs selecionados já pertence a outra medição. Atualize a tela e tente novamente.');
      throw err;
    }
    return rows;
  }

  async function releaseRdoMeasurement(measurementId){
    await ensureFresh();
    if(!organization() || !canEditStore('measurements')) return false;
    const query=[
      `organization_id=eq.${encodeURIComponent(organization().id)}`,
      `measurement_id=eq.${encodeURIComponent(String(measurementId))}`
    ].join('&');
    await request('/rest/v1/rdo_measurement_links?'+query,{
      method:'DELETE',
      headers:authHeaders(false)
    });
    return true;
  }

  async function deleteRdoMeasurement(measurementId){
    await ensureFresh();
    if(!organization() || !fullAccess() || !canEditStore('measurements'))
      throw new Error('Exclusão de medição HH indisponível.');
    return request('/rest/v1/rpc/clique_obras_delete_rdo_measurement',{
      method:'POST',
      headers:authHeaders(true),
      body:JSON.stringify({
        target_organization_id:organization().id,
        target_measurement_id:String(measurementId)
      })
    });
  }

  async function deleteRdo(rdoId){
    await ensureFresh();
    if(!organization() || !fullAccess() || !canEditStore('rdos'))
      throw new Error('Exclusão administrativa de RDO indisponível.');
    return request('/functions/v1/delete-rdo',{
      method:'POST',
      headers:authHeaders(true),
      body:JSON.stringify({
        organizationId:organization().id,
        rdoId:String(rdoId)
      })
    });
  }

  async function omieRequest(action,payload={}){
    await ensureFresh();
    if(!organization() || !isOwner())
      throw new Error('Somente o proprietário pode administrar a integração Omie.');
    return request('/functions/v1/omie-integration',{
      method:'POST',
      headers:authHeaders(true),
      body:JSON.stringify({action,organizationId:organization().id,...payload})
    });
  }

  async function ensureRdoCostPosting(rdoId,projectId,purchaseRecordId,amount){
    await ensureFresh();
    if(!organization() || !fullAccess()) throw new Error('Aprovação de RDO indisponível.');
    const body={
      organization_id:organization().id,
      rdo_id:String(rdoId),
      project_id:String(projectId),
      purchase_record_id:String(purchaseRecordId),
      amount:Number(amount)||0,
      posted_by:user().id
    };
    await request('/rest/v1/rdo_cost_postings?on_conflict=organization_id%2Crdo_id',{
      method:'POST',
      headers:{...authHeaders(true),Prefer:'resolution=ignore-duplicates,return=minimal'},
      body:JSON.stringify(body)
    });
    return body;
  }

  async function approveRdo(rdoId,financial){
    await ensureFresh();
    if(!organization() || !fullAccess()) throw new Error('Aprovação de RDO indisponível.');
    return request('/rest/v1/rpc/clique_obras_approve_rdo_v402',{
      method:'POST',
      headers:authHeaders(true),
      body:JSON.stringify({
        target_organization_id:organization().id,
        target_rdo_id:String(rdoId),
        target_financial:financial
      })
    });
  }

  async function repairRdoCosts(){
    await ensureFresh();
    if(!organization() || !fullAccess()) throw new Error('Reparação de custos de RDO indisponível.');
    return request('/rest/v1/rpc/clique_obras_repair_rdo_costs_v401',{
      method:'POST',
      headers:authHeaders(true),
      body:JSON.stringify({target_organization_id:organization().id})
    });
  }

  // v4.0.2 — abatimento automatico do planejamento para mao de obra.
  async function repairRdoPlanning(){
    await ensureFresh();
    if(!organization() || !fullAccess())
      throw new Error('Reparacao do abatimento de mao de obra indisponivel.');
    return request('/rest/v1/rpc/clique_obras_repair_rdo_planning_v402',{
      method:'POST',
      headers:authHeaders(true),
      body:JSON.stringify({target_organization_id:organization().id})
    });
  }

  async function offsetLaborPlanning(recordIds){
    await ensureFresh();
    const ids=[...new Set((recordIds||[]).map(String).filter(Boolean))];
    if(!organization() || !ids.length) return {offsetCount:0,applied:0,unmatched:0};
    if(!canEditStore('planning') || !canEditStore('purchases'))
      throw new Error('Seu usuario nao possui permissao para abater o planejamento.');
    return request('/rest/v1/rpc/clique_obras_offset_labor_planning_v402',{
      method:'POST',
      headers:authHeaders(true),
      body:JSON.stringify({
        target_organization_id:organization().id,
        target_record_ids:ids.slice(0,2000)
      })
    });
  }

  async function restoreLaborPlanning(recordId){
    await ensureFresh();
    if(!organization() || !recordId) return 0;
    if(!canEditStore('planning'))
      throw new Error('Seu usuario nao possui permissao para restaurar o planejamento.');
    return request('/rest/v1/rpc/clique_obras_restore_labor_planning_v402',{
      method:'POST',
      headers:authHeaders(true),
      body:JSON.stringify({
        target_organization_id:organization().id,
        target_record_id:String(recordId)
      })
    });
  }

  function attachmentRow(row={}){
    return {
      id:String(row.id||''),
      rdoId:String(row.rdo_id||''),
      projectId:String(row.project_id||''),
      objectPath:String(row.object_path||''),
      fileName:String(row.file_name||'arquivo'),
      description:String(row.description||''),
      mimeType:String(row.mime_type||'application/octet-stream'),
      sizeBytes:Number(row.size_bytes)||0,
      uploadedBy:String(row.uploaded_by||''),
      uploadedAt:row.uploaded_at||null
    };
  }

  function storageId(){
    if(globalThis.crypto && typeof globalThis.crypto.randomUUID==='function')
      return globalThis.crypto.randomUUID();
    const bytes=new Uint8Array(16);
    if(globalThis.crypto && typeof globalThis.crypto.getRandomValues==='function')
      globalThis.crypto.getRandomValues(bytes);
    else
      for(let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256);
    bytes[6]=(bytes[6]&15)|64;
    bytes[8]=(bytes[8]&63)|128;
    const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function safeStorageName(name){
    const clean=String(name||'arquivo')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9._-]+/gi,'-')
      .replace(/^-+|-+$/g,'')
      .slice(-120);
    return clean || 'arquivo';
  }

  async function authenticatedStorage(bucketId=RDO_BUCKET){
    await ensureFresh();
    if(!window.supabase || typeof window.supabase.createClient!=='function')
      throw new Error('O serviço de arquivos não foi carregado.');
    const client=window.supabase.createClient(baseUrl(),cfg.publishableKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{headers:{Authorization:`Bearer ${session.access_token}`}}
    });
    return client.storage.from(bucketId);
  }

  function profileAvatarPath(){ return profileContext.avatarPath; }
  function profileAvatarUrl(){ return profileContext.avatarUrl; }
  async function loadProfileAvatar(){
    if(!profileContext.avatarPath) return '';
    if(profileContext.avatarUrl) return profileContext.avatarUrl;
    if(profileContext.avatarPromise) return profileContext.avatarPromise;
    profileContext.avatarPromise=(async()=>{
      const bucket=await authenticatedStorage(PROFILE_BUCKET);
      const result=await bucket.download(profileContext.avatarPath);
      if(result.error) throw result.error;
      const url=URL.createObjectURL(result.data);
      profileContext.avatarUrl=url;
      return url;
    })().finally(()=>{profileContext.avatarPromise=null;});
    return profileContext.avatarPromise;
  }
  function avatarBlob(dataUrl){
    const match=String(dataUrl||'').match(/^data:image\/jpeg;base64,([a-z0-9+/=]+)$/i);
    if(!match) throw new Error('A foto de perfil precisa ser uma imagem JPG válida.');
    const binary=atob(match[1]);
    const bytes=new Uint8Array(binary.length);
    for(let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
    if(!bytes.length||bytes.length>2*1024*1024) throw new Error('A foto de perfil deve ter no máximo 2 MB.');
    return new Blob([bytes],{type:'image/jpeg'});
  }
  async function updateProfileAvatar(dataUrl){
    await ensureFresh();
    const blob=avatarBlob(dataUrl);
    const path=`${user().id}/avatar.jpg`;
    const bucket=await authenticatedStorage(PROFILE_BUCKET);
    const upload=await bucket.upload(path,blob,{cacheControl:'3600',contentType:'image/jpeg',upsert:true});
    if(upload.error) throw upload.error;
    await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(user().id)}`,{
      method:'PATCH',headers:{...authHeaders(true),Prefer:'return=minimal'},
      body:JSON.stringify({avatar_path:path})
    });
    if(profileContext.avatarUrl) URL.revokeObjectURL(profileContext.avatarUrl);
    profileContext={avatarPath:path,avatarUrl:'',avatarPromise:null};
    return loadProfileAvatar();
  }
  async function removeProfileAvatar(){
    await ensureFresh();
    const path=profileContext.avatarPath;
    await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(user().id)}`,{
      method:'PATCH',headers:{...authHeaders(true),Prefer:'return=minimal'},
      body:JSON.stringify({avatar_path:null})
    });
    if(path){
      try{
        const bucket=await authenticatedStorage(PROFILE_BUCKET);
        await bucket.remove([path]);
      }catch(error){}
    }
    if(profileContext.avatarUrl) URL.revokeObjectURL(profileContext.avatarUrl);
    profileContext={avatarPath:'',avatarUrl:'',avatarPromise:null};
    return true;
  }

  async function listRdoAttachments(rdoId){
    await ensureFresh();
    if(!organization() || !canViewStore('rdos')) return [];
    const query=[
      'select=id,rdo_id,project_id,object_path,file_name,description,mime_type,size_bytes,uploaded_by,uploaded_at',
      `organization_id=eq.${encodeURIComponent(organization().id)}`,
      `rdo_id=eq.${encodeURIComponent(String(rdoId))}`,
      'order=uploaded_at.asc'
    ].join('&');
    const rows=await request('/rest/v1/rdo_attachments?'+query,{headers:authHeaders(false)}) || [];
    return rows.map(attachmentRow);
  }

  async function uploadRdoAttachment(rdoId,projectId,file,description=''){
    await ensureFresh();
    if(!organization() || !canEditStore('rdos') || !canUseRdoProject(projectId))
      throw new Error('Não foi possível anexar arquivos a este RDO.');
    const allowed=new Set(['image/jpeg','image/png','image/webp','application/pdf']);
    const mime=String(file&&file.type||'').toLowerCase();
    const size=Number(file&&file.size)||0;
    if(!allowed.has(mime)) throw new Error('Use fotos JPG, PNG ou WebP, ou documentos PDF.');
    if(!size || size>8*1024*1024) throw new Error('Cada anexo deve ter no máximo 8 MB.');
    const id=storageId();
    const path=[
      organization().id,
      String(projectId),
      String(rdoId),
      `${id}-${safeStorageName(file.name)}`
    ].join('/');
    const bucket=await authenticatedStorage();
    const upload=await bucket.upload(path,file,{
      cacheControl:'3600',
      contentType:mime,
      upsert:false
    });
    if(upload.error) throw upload.error;
    const body={
      id,
      organization_id:organization().id,
      rdo_id:String(rdoId),
      project_id:String(projectId),
      object_path:path,
      file_name:String(file.name||'arquivo').slice(0,180),
      description:String(description||'').trim().slice(0,180)||null,
      mime_type:mime,
      size_bytes:size,
      uploaded_by:user().id
    };
    try{
      const rows=await request('/rest/v1/rdo_attachments',{
        method:'POST',
        headers:{...authHeaders(true),Prefer:'return=representation'},
        body:JSON.stringify(body)
      }) || [];
      return attachmentRow(rows[0]||body);
    }catch(err){
      try{ await bucket.remove([path]); }catch(cleanupError){}
      throw err;
    }
  }

  async function updateRdoAttachmentDescription(attachment,description){
    await ensureFresh();
    if(!organization() || !canEditStore('rdos')) throw new Error('Alteração do anexo indisponível.');
    const clean=String(description||'').trim().slice(0,180);
    const rows=await request(`/rest/v1/rdo_attachments?id=eq.${encodeURIComponent(String(attachment?.id||''))}&organization_id=eq.${encodeURIComponent(organization().id)}`,{
      method:'PATCH',
      headers:{...authHeaders(true),Prefer:'return=representation'},
      body:JSON.stringify({description:clean||null})
    })||[];
    return rows[0]?attachmentRow(rows[0]):{...attachment,description:clean};
  }

  async function removeRdoAttachment(attachment){
    await ensureFresh();
    if(!organization() || !canEditStore('rdos')) throw new Error('Exclusão de anexo indisponível.');
    const row=attachment||{};
    const bucket=await authenticatedStorage();
    const removed=await bucket.remove([String(row.objectPath||'')]);
    if(removed.error) throw removed.error;
    await request(`/rest/v1/rdo_attachments?id=eq.${encodeURIComponent(String(row.id||''))}&organization_id=eq.${encodeURIComponent(organization().id)}`,{
      method:'DELETE',
      headers:authHeaders(false)
    });
    return true;
  }

  async function downloadRdoAttachment(objectPath){
    const bucket=await authenticatedStorage();
    const result=await bucket.download(String(objectPath||''));
    if(result.error) throw result.error;
    return result.data;
  }

  function normalizedPermissions(input={}){
    const view=[...new Set((input.view||[]).filter(x=>ALL_STORES.includes(x)))];
    const edit=[...new Set((input.edit||[]).filter(x=>view.includes(x)))];
    const rdoProjects=Array.isArray(input.rdo_projects)
      ? input.rdo_projects
        .filter(x=>x && x.id!=null)
        .slice(0,500)
        .map(x=>({id:String(x.id),label:String(x.label||'Projeto').slice(0,180)}))
      : [];
    return {view,edit,manage_users:input.manage_users===true,rdo_projects:rdoProjects};
  }
  function assertAssignable(roleName,permissions){
    const actorRole=role();
    if(roleName==='admin' && actorRole!=='owner')
      throw new Error('Somente o proprietário pode conceder perfil de administrador.');
    if(permissions.manage_users && actorRole!=='owner')
      throw new Error('Somente o proprietário pode delegar a gestão de usuários.');
    if(!['owner','admin'].includes(actorRole) && !['editor','viewer'].includes(roleName))
      throw new Error('Este perfil não pode conceder o nível de acesso solicitado.');
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
    const normalized=normalizedPermissions(permissions);
    const requestedRole=['admin','editor','viewer'].includes(roleName)?roleName:'viewer';
    assertAssignable(requestedRole,normalized);
    const body={
      organization_id:organization().id,
      email:String(email||'').trim().toLowerCase(),
      role:requestedRole,
      permissions:normalized,
      invited_by:user().id
    };
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new Error('Informe um e-mail válido.');
    const existing=await request(`/rest/v1/organization_invitations?select=id&organization_id=eq.${encodeURIComponent(body.organization_id)}&email=eq.${encodeURIComponent(body.email)}&status=eq.pending&limit=1`,{
      headers:authHeaders(false)
    }) || [];
    if(existing.length){
      await request(`/rest/v1/organization_invitations?id=eq.${encodeURIComponent(existing[0].id)}`,{
        method:'PATCH',headers:{...authHeaders(true),Prefer:'return=minimal'},
        body:JSON.stringify({role:body.role,permissions:body.permissions,invited_by:body.invited_by})
      });
    }else{
      await request('/rest/v1/organization_invitations', {
        method:'POST',headers:{...authHeaders(true),Prefer:'return=minimal'},body:JSON.stringify(body)
      });
    }
    return request('/functions/v1/send-organization-invite',{
      method:'POST',headers:authHeaders(true),
      body:JSON.stringify({organizationId:body.organization_id,email:body.email,redirectTo:redirectUrl()})
    });
  }
  async function updateMember(userId, roleName, permissions){
    await ensureFresh();
    if(!canManageUsers()) throw new Error('Você não possui permissão para editar usuários.');
    const requestedRole=['admin','editor','viewer'].includes(roleName)?roleName:'viewer';
    const normalized=normalizedPermissions(permissions);
    assertAssignable(requestedRole,normalized);
    const body={role:requestedRole,permissions:normalized};
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
    signOut, resetPassword, updatePassword, updateDisplayName, consumeAuthCallback, refresh, user,
    accessDeniedMessage:()=>accessDeniedMessage,
    organization, organizations, membership, role, switchOrganization,
    refreshOrganizationContext,
    canViewStore, canEditStore, canEditAny, canManageUsers, assertCanEdit, isOwner,
    rdoProjects, canUseRdoProject,
    mirror, flushQueue, readAll, upsertRaw, pendingCount:()=>queue().length,
    clearCurrentQueue,
    boundUserId:boundScopeId, isAccountSwitch, bindCurrentUser,
    startRealtime, stopRealtime, realtimeStatus:()=>realtimeStatus,
    listTeam, inviteMember, updateMember, removeMember, cancelInvitation,
    measurementLinks, claimRdoMeasurement, releaseRdoMeasurement, deleteRdoMeasurement, deleteRdo, ensureRdoCostPosting, approveRdo, repairRdoCosts,
    repairRdoPlanning, offsetLaborPlanning, restoreLaborPlanning,
    occupiedRdoEmployees,
    omieRequest,
    listRdoAttachments, uploadRdoAttachment, updateRdoAttachmentDescription, removeRdoAttachment, downloadRdoAttachment,
    profileAvatarPath, profileAvatarUrl, loadProfileAvatar, updateProfileAvatar, removeProfileAvatar,
    updateOrganizationName, DEFAULT_PERMISSIONS, ALL_STORES
  };
})();
