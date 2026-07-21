/**
 * Módulo Banco de Dados (IndexedDB)
 *
 * Responsabilidades:
 * - abertura e versionamento do banco ccf_obras (8 stores)
 * - operações CRUD (all, put, bulkPut, del, clear)
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
  const put = (store,obj) => new Promise((res,rej)=>{ const r = tx(store,'readwrite').put(obj); r.onsuccess=()=>res(obj); r.onerror=()=>rej(r.error); });
  const bulkPut = (store,objs) => new Promise((res,rej)=>{ const t = db.transaction(store,'readwrite'), s=t.objectStore(store); objs.forEach(o=>s.put(o)); t.oncomplete=()=>res(); t.onerror=()=>rej(t.error); });
  const del = (store,id) => new Promise((res,rej)=>{ const r = tx(store,'readwrite').delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  const clear = store => new Promise((res,rej)=>{ const r = tx(store,'readwrite').clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  return { open, all, put, bulkPut, del, clear, STORES };
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
