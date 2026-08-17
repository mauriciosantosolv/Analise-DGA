/**
 * Módulo Banco de Dados (IndexedDB)
 *
 * Responsabilidades:
 * - abertura e versionamento do banco ccf_obras
 * - operações CRUD (all, put, bulkPut, del, clear)
 * - cache local e sincronização opcional com a nuvem
 * - State: cache em memória do banco + filtros globais
 */

/* ================= [3] BANCO DE DADOS (IndexedDB) =================
   Stores: projects, budgets, purchases, planning, clients, categories, settings
   Regra: uploads sempre SOMAM ao banco; nada é apagado automaticamente. */
const DB = (() => {
  const NAME = 'ccf_obras', VERSION = 6;
  const STORES = [
    'projects','budgets','purchases','planning','clients','categories','settings','measurements',
    'rdos','crew','labor_rates','rdo_financial','planning_history','workforce_status'
  ];
  const LOCAL_STORES = [...STORES,'rdo_attachments'];
  let db = null;
  function open(){
    return new Promise((res, rej) => {
      const rq = indexedDB.open(NAME, VERSION);
      rq.onupgradeneeded = e => {
        const d = e.target.result;
        LOCAL_STORES.forEach(s => { if(!d.objectStoreNames.contains(s)) d.createObjectStore(s, {keyPath:'id'}); });
      };
      rq.onsuccess = e => { db = e.target.result; res(db); };
      rq.onerror = () => rej(rq.error || new Error('Falha ao abrir o banco de dados local.'));
      rq.onblocked = () => rej(new Error('O banco de dados está bloqueado por outra aba deste sistema. Feche as demais abas/janelas e clique em "Tentar novamente".'));
    });
  }
  const tx = (store, mode='readonly') => db.transaction(store, mode).objectStore(store);
  const all = store => new Promise((res,rej)=>{ const r = tx(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  const localPut = (store,obj) => new Promise((res,rej)=>{ const r = tx(store,'readwrite').put(obj); r.onsuccess=()=>res(obj); r.onerror=()=>rej(r.error); });
  const localBulkPut = (store,objs) => new Promise((res,rej)=>{ const t = db.transaction(store,'readwrite'), s=t.objectStore(store); objs.forEach(o=>s.put(o)); t.oncomplete=()=>res(); t.onerror=()=>rej(t.error); });
  const localDel = (store,id) => new Promise((res,rej)=>{ const r = tx(store,'readwrite').delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  const localClear = store => new Promise((res,rej)=>{ const r = tx(store,'readwrite').clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  const approveRdoLocal = (financial,purchase,rdo) => new Promise((res,rej)=>{
    const transaction=db.transaction(['rdo_financial','purchases','rdos'],'readwrite');
    transaction.objectStore('rdo_financial').put(financial);
    transaction.objectStore('purchases').put(purchase);
    transaction.objectStore('rdos').put(rdo);
    transaction.oncomplete=()=>res({financial,purchase,rdo});
    transaction.onerror=()=>rej(transaction.error||new Error('Falha ao aprovar o RDO localmente.'));
    transaction.onabort=()=>rej(transaction.error||new Error('A aprovação local do RDO foi cancelada.'));
  });
  function assertCanEdit(store){
    if(typeof Cloud!=='undefined' && Cloud.active()) Cloud.assertCanEdit(store);
  }
  async function put(store,obj){
    assertCanEdit(store);
    if(typeof Cloud!=='undefined' && Cloud.active()) await Cloud.mirror({type:'put',store,object:obj});
    await localPut(store,obj);
    return obj;
  }
  async function bulkPut(store,objs){
    assertCanEdit(store);
    if(typeof Cloud!=='undefined' && Cloud.active() && objs.length) await Cloud.mirror({type:'bulkPut',store,objects:objs});
    await localBulkPut(store,objs);
  }
  async function del(store,id){
    assertCanEdit(store);
    if(typeof Cloud!=='undefined' && Cloud.active()) await Cloud.mirror({type:'delete',store,id});
    await localDel(store,id);
  }
  async function clear(store){
    assertCanEdit(store);
    if(typeof Cloud!=='undefined' && Cloud.active()) await Cloud.mirror({type:'clear',store});
    await localClear(store);
  }
  async function clearLocalCache(){
    for(const store of LOCAL_STORES) await localClear(store);
    try{
      localStorage.removeItem('ccf_snap');
      localStorage.removeItem('ccf_snap_time');
    }catch(e){}
  }
  async function uploadLocalToCloud(){
    for(const store of STORES){
      if(typeof Cloud!=='undefined' && Cloud.active() && !Cloud.canEditStore(store)) continue;
      const rows=await all(store);
      if(rows.length) await Cloud.upsertRaw(store,rows);
    }
  }
  async function syncFromCloud(){
    if(typeof Cloud==='undefined' || !Cloud.active()) return {mode:'local',records:0};
    const accountSwitch=Cloud.isAccountSwitch();
    if(accountSwitch) await clearLocalCache();
    const remoteBefore=await Cloud.readAll();
    const flushed=await Cloud.flushQueue(remoteBefore);
    const remote=flushed ? await Cloud.readAll() : remoteBefore;
    if(!remote.length){
      if(!accountSwitch && Cloud.canEditAny()) await uploadLocalToCloud();
      else if(!Cloud.canEditAny()) await clearLocalCache();
      Cloud.bindCurrentUser();
      return {mode:accountSwitch?'new-account':'uploaded-local',records:0};
    }
    // Salva uma cópia apenas quando o cache pertence à mesma conta. Isso evita
    // que um usuário de computador compartilhado veja dados de outra conta.
    if(!accountSwitch){
      try{
        const snapshot={app:'ccf_obras',version:1,exportedAt:new Date().toISOString()};
        let hasLocal=false;
        for(const store of STORES){ snapshot[store]=await all(store); if(snapshot[store].length) hasLocal=true; }
        if(hasLocal){
          const raw=JSON.stringify(snapshot);
          if(raw.length<4500000){
            localStorage.setItem('ccf_snap',raw);
            localStorage.setItem('ccf_snap_time',String(Date.now()));
          }
        }
      }catch(e){}
    }
    const grouped=Object.fromEntries(STORES.map(s=>[s,[]]));
    remote.forEach(r=>{ if(grouped[r.store] && r.data && r.data.id!=null) grouped[r.store].push(r.data); });
    for(const store of STORES){
      await localClear(store);
      if(grouped[store].length) await localBulkPut(store,grouped[store]);
    }
    Cloud.bindCurrentUser();
    return {mode:'downloaded-cloud',records:remote.length};
  }
  const attachmentAll = () => all('rdo_attachments');
  const attachmentPut = obj => localPut('rdo_attachments',obj);
  const attachmentDel = id => localDel('rdo_attachments',id);
  return {
    open, all, put, bulkPut, del, clear, clearLocalCache, syncFromCloud, uploadLocalToCloud, approveRdoLocal,
    attachmentAll, attachmentPut, attachmentDel, STORES, LOCAL_STORES
  };
})();

/* ===== Estado em memória (cache do banco, recarregado após cada mutação) ===== */
const State = {
  projects:[], budgets:[], purchases:[], planning:[], clients:[], categories:[], measurements:[], settings:{},
  rdos:[], crew:[], laborRates:[], rdoFinancial:[], planningHistory:[], workforceStatus:[], rdoAttachments:[],
  filters:{ project:'', projects:[], client:'', category:'', status:'', type:'' },
  view:'dashboard',
  async reload(){
    const [p,b,c,pl,cl,cat,st,me,rdos,crew,rates,financial,planningHistory,workforceStatus,attachments] = await Promise.all([
      ...DB.STORES.map(s=>DB.all(s)),
      DB.attachmentAll()
    ]);
    this.projects=p; this.budgets=b; this.purchases=c; this.planning=pl; this.clients=cl; this.categories=cat; this.measurements=me;
    this.rdos=rdos; this.crew=crew; this.laborRates=rates; this.rdoFinancial=financial;
    this.planningHistory=planningHistory; this.workforceStatus=workforceStatus; this.rdoAttachments=attachments;
    this.settings = Object.fromEntries(st.map(s=>[s.id, s.value]));
  },
  async setSetting(k,v){ await DB.put('settings',{id:k,value:v}); this.settings[k]=v; },
  selectedProjectIds(){
    if(this.filters.project) return [String(this.filters.project)];
    return Array.isArray(this.filters.projects)
      ? [...new Set(this.filters.projects.map(String).filter(Boolean))]
      : [];
  },
  async addPlanningHistory(event){
    const row={id:U.id(),occurredAt:new Date().toISOString(),...event};
    await DB.put('planning_history',row);
    this.planningHistory.push(row);
    return row;
  },
  async ensurePlanningHistory(){
    if(this.settings.planningHistoryV307) return false;
    if(typeof Cloud!=='undefined' && Cloud.active() && !Cloud.isOwner()) return false;
    const plans=new Map(this.planning.map(plan=>[String(plan.id),plan]));
    let changed=false;
    for(const purchase of this.purchases){
      const offset=purchase&&purchase.planningOffset;
      if(!offset||!offset.planningId||plans.has(String(offset.planningId))) continue;
      const snapshot=offset.planningSnapshot;
      if(!snapshot||!snapshot.id) continue;
      const initial=Math.max(0,Number(snapshot.originalValue)||Number(snapshot.value)||Number(offset.originalPlanValue)||0);
      const restored={...snapshot,value:0,originalValue:initial,
        realizedAmount:Math.max(initial,Number(offset.amount)||0),consumptionStatus:'consumed',
        lastOffsetAt:offset.appliedAt||new Date().toISOString()};
      await DB.put('planning',restored);
      plans.set(String(restored.id),restored); changed=true;
    }
    for(const plan of plans.values()){
      const current=Math.max(0,Number(plan.value)||0);
      const consumed=Math.max(0,Number(plan.realizedAmount)||0);
      const hasInitial=plan.originalValue!==''&&plan.originalValue!=null&&Number.isFinite(Number(plan.originalValue));
      const initial=hasInitial?Math.max(0,Number(plan.originalValue)):current+consumed;
      if(Number(plan.originalValue)!==initial || plan.consumptionStatus==null){
        const normalized={...plan,originalValue:initial,realizedAmount:consumed,
          consumptionStatus:current<=0&&consumed>0?'consumed':consumed>0?'partial':'pending'};
        await DB.put('planning',normalized); Object.assign(plan,normalized); changed=true;
      }
      if(!this.planningHistory.some(item=>String(item.planningId)===String(plan.id))){
        await this.addPlanningHistory({planningId:String(plan.id),projectId:String(plan.projectId||''),
          category:String(plan.category||''),action:'baseline',source:'migration',amount:initial,
          beforeValue:initial,afterValue:current,description:'Histórico inicial preservado na atualização v3.0.7'});
        changed=true;
      }
    }
    await this.setSetting('planningHistoryV307',true);
    if(changed) await this.reload();
    return changed;
  }
};
