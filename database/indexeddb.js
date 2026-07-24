/**
 * Módulo Banco de Dados (IndexedDB)
 *
 * Responsabilidades:
 * - abertura e versionamento do banco ccf_obras (8 stores)
 * - operações CRUD (all, put, bulkPut, del, clear)
 * - cache local e sincronização opcional com a nuvem
 * - State: cache em memória do banco + filtros globais
 *
 * Dependências:
 * - nenhuma (carregar antes de todos os demais módulos)
 *
 * Não modificar:
 * - NAME, VERSION e STORES sem plano de migração de dados
 * - acesso direto ao IndexedDB fora deste arquivo é proibido
 */

/* ================= [3] BANCO DE DADOS (IndexedDB) =================
   Stores: projects, budgets, purchases, planning, clients, categories, settings
   Regra: uploads sempre SOMAM ao banco; nada é apagado automaticamente. */
const DB = (() => {
  const NAME = 'ccf_obras', VERSION = 2; // v2: + store de medições
  const STORES = ['projects','budgets','purchases','planning','clients','categories','settings','measurements'];
  let db = null;
  function open(){
    return new Promise((res, rej) => {
      const rq = indexedDB.open(NAME, VERSION);
      rq.onupgradeneeded = e => {
        const d = e.target.result;
        STORES.forEach(s => { if(!d.objectStoreNames.contains(s)) d.createObjectStore(s, {keyPath:'id'}); });
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
  async function put(store,obj){
    await localPut(store,obj);
    if(typeof Cloud!=='undefined') await Cloud.mirror({type:'put',store,object:obj});
    return obj;
  }
  async function bulkPut(store,objs){
    await localBulkPut(store,objs);
    if(typeof Cloud!=='undefined' && objs.length) await Cloud.mirror({type:'bulkPut',store,objects:objs});
  }
  async function del(store,id){
    await localDel(store,id);
    if(typeof Cloud!=='undefined') await Cloud.mirror({type:'delete',store,id});
  }
  async function clear(store){
    await localClear(store);
    if(typeof Cloud!=='undefined') await Cloud.mirror({type:'clear',store});
  }
  async function uploadLocalToCloud(){
    for(const store of STORES){
      const rows=await all(store);
      if(rows.length) await Cloud.upsertRaw(store,rows);
    }
  }
  async function syncFromCloud(){
    if(typeof Cloud==='undefined' || !Cloud.active()) return {mode:'local',records:0};
    await Cloud.flushQueue();
    const remote=await Cloud.readAll();
    if(!remote.length){
      await uploadLocalToCloud();
      return {mode:'uploaded-local',records:0};
    }
    // Antes de substituir o cache por uma base remota já existente, mantém
    // uma cópia recuperável do conteúdo atual deste navegador.
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
    const grouped=Object.fromEntries(STORES.map(s=>[s,[]]));
    remote.forEach(r=>{ if(grouped[r.store] && r.data && r.data.id!=null) grouped[r.store].push(r.data); });
    for(const store of STORES){
      await localClear(store);
      if(grouped[store].length) await localBulkPut(store,grouped[store]);
    }
    return {mode:'downloaded-cloud',records:remote.length};
  }
  return { open, all, put, bulkPut, del, clear, syncFromCloud, uploadLocalToCloud, STORES };
})();

/* ===== Estado em memória (cache do banco, recarregado após cada mutação) ===== */
const State = {
  projects:[], budgets:[], purchases:[], planning:[], clients:[], categories:[], measurements:[], settings:{},
  filters:{ project:'', client:'', category:'', status:'', type:'' },
  view:'dashboard',
  async reload(){
    const [p,b,c,pl,cl,cat,st,me] = await Promise.all(DB.STORES.map(s=>DB.all(s)));
    this.projects=p; this.budgets=b; this.purchases=c; this.planning=pl; this.clients=cl; this.categories=cat; this.measurements=me;
    this.settings = Object.fromEntries(st.map(s=>[s.id, s.value]));
  },
  async setSetting(k,v){ await DB.put('settings',{id:k,value:v}); this.settings[k]=v; }
};
