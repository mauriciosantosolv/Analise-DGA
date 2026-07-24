/**
 * Aplicação (app.js)
 *
 * Responsabilidades:
 * - App: navegação (go/render), busca global, drag&drop, tema, marca
 * - tratamento global de erros e recuperação
 * - bootstrap: App.init() no DOMContentLoaded
 *
 * Dependências:
 * - todos os módulos (carregar por último)
 *
 * Não modificar:
 * - ordem dos <script> no index.html
 */

/* ================= [9] APLICAÇÃO — roteador, pesquisa global, init ================= */
const App = {
  historyReady:false,
  lastCloudRefresh:0,
  goFiltered(view, projectId='', options={}){
    State.filters.project = projectId || '';
    if(view === 'planejamento'){
      Views.planejamento.projectFilter = projectId || '';
      Views.planejamento.focusUpcoming = !!options.upcoming7;
      if(options.upcoming7) Views.planejamento.mode = 'list';
    }
    this.go(view);
  },
  projectColor(projectId){
    const palette = ['#2563EB','#16A34A','#EAB308','#7C3AED','#0891B2','#EA580C','#DB2777','#4F46E5','#65A30D','#DC2626'];
    const idx = Math.max(0, State.projects.findIndex(p=>p.id===projectId));
    return palette[idx % palette.length];
  },
  closeMobileMenu(){
    const sidebar = document.getElementById('sidebar');
    const app = document.getElementById('app');
    const toggle = document.getElementById('menu-toggle');
    if(sidebar) sidebar.classList.remove('open');
    if(app) app.classList.remove('menu-open');
    if(toggle) toggle.setAttribute('aria-expanded','false');
  },
  toggleMobileMenu(){
    if(window.innerWidth > 860) return;
    const sidebar = document.getElementById('sidebar');
    const app = document.getElementById('app');
    const toggle = document.getElementById('menu-toggle');
    if(!sidebar || !app) return;
    const willOpen = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', willOpen);
    app.classList.toggle('menu-open', willOpen);
    if(toggle) toggle.setAttribute('aria-expanded', String(willOpen));
  },
  renderTicker(){
    const el = document.getElementById('finance-ticker'); if(!el) return;
    const selection=State.settings.tickerProjects;
    const selectedIds=Array.isArray(selection) ? new Set(selection) : null;
    const projects = State.projects.filter(p=>p.status !== 'Cancelado' && (!selectedIds || selectedIds.has(p.id)));
    if(!projects.length){ el.innerHTML = `<div class="ticker-empty">${State.projects.length?'Nenhum projeto selecionado para o ticker financeiro':'Desempenho financeiro: nenhum projeto cadastrado'}</div>`; return; }
    const items = projects.map(p=>{
      const st = Biz.projectStats(p), positive = st.balance >= 0;
      return `<button class="ticker-item ${positive?'positive':'negative'}" onclick="Views.projetos.detail('${p.id}')" title="Abrir ${U.esc(U.projLabel(p))}"><b>${U.esc(p.proposal||p.name||'Projeto')}</b><span>${positive?'↑':'↓'} ${U.money(st.balance)}</span></button>`;
    }).join('');
    el.innerHTML = `<div class="ticker-track"><div class="ticker-group">${items}</div></div>`;
    requestAnimationFrame(() => {
      const track = el.querySelector('.ticker-track'), first = track && track.querySelector('.ticker-group');
      if(!track || !first) return;
      const groupWidth = Math.max(1, first.scrollWidth);
      const copies = Math.max(2, Math.ceil(el.clientWidth / groupWidth) + 2);
      track.innerHTML = Array.from({length:copies}, (_,i)=>`<div class="ticker-group" ${i?'aria-hidden="true"':''}>${items}</div>`).join('');
      track.style.setProperty('--ticker-shift', `-${groupWidth}px`);
      const duration = Math.max(16, groupWidth / 45);
      track.style.setProperty('--ticker-duration', `${duration}s`);
    });
  },
  go(view, options={}){
    const changed=State.view!==view;
    if(this.historyReady && options.history!==false && changed)
      history.pushState({cliqueObras:true,view},'',`#/${view}`);
    State.view = view;
    if(typeof UI!=='undefined') UI.closeAll();
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    this.closeMobileMenu();
    this.render();
  },
  render(){
    const v = Views[State.view] || Views.dashboard;
    document.getElementById('page-title').textContent = v.title;
    Dash.destroyCharts();
    v.render();
    this.renderTicker();
    this.renderRightbar();
    document.getElementById('content').scrollTop = 0;
  },
  clearFilters(){
    State.filters = { project:'', client:'', category:'', status:'', type:'' };
    this.render();
  },
  initHistory(){
    const hash=location.hash.match(/^#\/([a-z]+)$/);
    const initial=hash && Views[hash[1]] ? hash[1] : 'dashboard';
    history.replaceState({cliqueObras:true,view:initial},'',`#/${initial}`);
    window.addEventListener('popstate',e=>{
      const view=(e.state&&e.state.view) || ((location.hash.match(/^#\/([a-z]+)$/)||[])[1]);
      if(view && Views[view]) this.go(view,{history:false});
    });
    this.historyReady=true;
    return initial;
  },

  /* Painel lateral fixo — gastos futuros */
  renderRightbar(){
    const fut = Biz.futureExpenses();
    const block = (title, items) => `
      <div class="rb-section"><div class="rb-title">${title} · ${U.money(items.reduce((s,x)=>s+x.value,0))}</div>
      ${items.length ? items.slice(0,6).map(x => { const p = State.projects.find(pr=>pr.id===x.projectId); return `
        <button type="button" class="rb-item rb-item-action" onclick="Views.planejamento.form('${U.esc(x.id)}')" title="Editar ou excluir este gasto previsto">
          <span class="rb-item-info"><b>${U.esc(x.category)}</b><small>${U.esc(p?p.proposal:'?')} · ${U.date(x.date)}</small></span>
          <span class="rb-item-value">${U.money(x.value)}</span><i data-lucide="pencil"></i></button>`; }).join('') : '<small style="color:var(--text3)">Nenhum item</small>'}</div>`;
    document.getElementById('rightbar-content').innerHTML =
      block('Hoje', fut.today) + block('Próximos 7 dias', fut.d7) +
      block('8–15 dias', fut.d15) + block('16–30 dias', fut.d30);
    U.icons();
  },
  showFutureExpenses(){
    const fut = Biz.futureExpenses();
    const sections = [['Hoje',fut.today],['Próximos 7 dias',fut.d7],['8–15 dias',fut.d15],['16–30 dias',fut.d30]];
    UI.modal({
      title:'Gastos Previstos',
      body:`<div class="future-mobile-list">${sections.map(([title,items])=>`
        <div class="rb-section"><div class="rb-title">${title} · ${U.money(items.reduce((s,x)=>s+x.value,0))}</div>
          ${items.length ? items.map(x=>{ const p=State.projects.find(pr=>pr.id===x.projectId); return `
            <button type="button" class="rb-item rb-item-action" onclick="UI.close();Views.planejamento.form('${U.esc(x.id)}')">
              <span class="rb-item-info"><b>${U.esc(x.category)}</b><small>${U.esc(p?p.proposal:'?')} · ${U.date(x.date)}</small></span>
              <span class="rb-item-value">${U.money(x.value)}</span><i data-lucide="pencil"></i></button>`;}).join('')
            : '<small style="color:var(--text3)">Nenhum item</small>'}
        </div>`).join('')}</div>`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Fechar</button><button class="btn btn-primary" onclick="UI.close();App.go('planejamento')"><i data-lucide="calendar-days"></i>Abrir planejamento</button>`
    });
  },

  /* Pesquisa global */
  initSearch(){
    const inp = document.getElementById('global-search'), box = document.getElementById('search-results');
    const run = () => {
      const q = U.norm(inp.value);
      if(q.length < 2){ box.classList.remove('open'); return; }
      const out = [];
      State.projects.forEach(p => { if(U.norm(`${p.proposal} ${p.name} ${p.client}`).includes(q))
        out.push({icon:'hard-hat', label:U.projLabel(p), tag:'Projeto', fn:`Views.projetos.detail('${p.id}')`}); });
      State.clients.forEach(c => { if(U.norm(c.name).includes(q))
        out.push({icon:'users', label:c.name, tag:'Cliente', fn:`Views.clientes.form('${c.id}')`}); });
      const sups = new Set(), catsSeen = new Set();
      State.purchases.forEach(x => {
        if(x.supplier && !sups.has(x.supplier) && U.norm(x.supplier).includes(q)){ sups.add(x.supplier);
          out.push({icon:'truck', label:x.supplier, tag:'Fornecedor', fn:`Dash.drill({supplier:${JSON.stringify(x.supplier)}})`}); }
        const categoryKey=Biz.categoryKey(x.category);
        if(categoryKey && !catsSeen.has(categoryKey) && (U.norm(x.category).includes(q) || categoryKey.includes(Biz.categoryKey(q)))){ catsSeen.add(categoryKey);
          out.push({icon:'tag', label:Biz.categoryName(x.category), tag:'Categoria', fn:`Dash.drill({category:${JSON.stringify(x.category)}})`}); }
      });
      State.purchases.slice(0,4000).forEach(x => { if(out.length<40 && x.desc && U.norm(x.desc).includes(q))
        out.push({icon:'receipt', label:`${x.desc.slice(0,50)} · ${U.money(x.value)}`, tag:'Lançamento', fn:`Dash.showPurchase('${x.id}')`}); });
      box.innerHTML = out.slice(0,20).map(r =>
        `<div class="sr-item" onclick="document.getElementById('search-results').classList.remove('open');${U.esc(r.fn)}">
         <i data-lucide="${r.icon}" style="width:15px;height:15px;color:var(--text3)"></i>${U.esc(r.label)}<span class="tag tag-gray">${r.tag}</span></div>`).join('')
        || '<div class="sr-item">Nenhum resultado</div>';
      box.classList.add('open');
      U.icons();
    };
    inp.oninput = U.debounce(run, 200);
    inp.onfocus = () => { if(inp.value.length>=2) run(); };
    document.addEventListener('click', e => { if(!e.target.closest('#global-search-wrap')) box.classList.remove('open'); });
  },

  /* Drag & drop nas zonas de importação */
  bindDropZone(id, kind){
    const dz = document.getElementById(id); if(!dz) return;
    dz.onclick = () => Importer.pick(kind);
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag'); };
    dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = e => {
      e.preventDefault(); dz.classList.remove('drag');
      const file = e.dataTransfer.files[0];
      if(file) Importer.handle(file, kind);
    };
  },

  applyTheme(t){
    document.documentElement.dataset.theme = t;
    const btn = document.querySelector('#theme-toggle i');
    document.getElementById('theme-toggle').innerHTML = `<i data-lucide="${t==='dark'?'sun':'moon'}"></i>`;
    U.icons();
    if(State.view === 'dashboard') this.render(); // re-renderiza gráficos com novas cores
  },
  toggleTheme(){
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    State.setSetting('theme', t); this.applyTheme(t);
  },
  applyBranding(){
    if(State.settings.companyName) document.getElementById('company-name').textContent = State.settings.companyName;
    if(State.settings.companyLogo){
      const box = document.getElementById('company-logo-box');
      box.style.background = 'transparent'; // remove fundo/borda quando há logo própria
      box.innerHTML = `<img src="${State.settings.companyLogo}" class="logo-clean" style="width:100%;height:100%;object-fit:contain">`;
    }
  },
  applyStorageStatus(){
    const el=document.getElementById('storage-status'); if(!el) return;
    if(typeof Cloud!=='undefined' && Cloud.active()){
      const pending=Cloud.pendingCount();
      el.textContent=`v2.0 · nuvem conectada${pending?` · ${pending} pendente(s)`:''}`;
    }else el.textContent='v2.0 · dados locais';
  },
  showCloudLogin(){
    const old=document.getElementById('cloud-login'); if(old) old.remove();
    const el=document.createElement('div'); el.id='cloud-login'; el.className='cloud-login';
    el.innerHTML=`<div class="cloud-login-card">
      <div class="cloud-login-brand"><div class="brand-logo"><i data-lucide="cloud"></i></div><div><h2>Entrar no Clique Obras</h2><p>Seus dados serão carregados da base segura na nuvem.</p></div></div>
      <form id="cloud-login-form">
        <div><label>E-mail</label><input id="cloud-email" type="email" autocomplete="username" required></div>
        <div><label>Senha</label><input id="cloud-password" type="password" autocomplete="current-password" required></div>
        <div id="cloud-login-error" class="cloud-login-error"></div>
        <button class="btn btn-primary" id="cloud-login-submit" type="submit"><i data-lucide="log-in"></i>Entrar</button>
      </form>
      <p style="margin-top:14px"><small>O acesso é criado pelo administrador da base. Nenhuma senha é salva pelo Clique Obras.</small></p>
    </div>`;
    document.body.appendChild(el); U.icons();
    document.getElementById('cloud-login-form').onsubmit=async e=>{
      e.preventDefault();
      const btn=document.getElementById('cloud-login-submit'), error=document.getElementById('cloud-login-error');
      error.classList.remove('open'); btn.disabled=true; btn.textContent='Entrando…';
      try{
        await Cloud.signIn(document.getElementById('cloud-email').value.trim(),document.getElementById('cloud-password').value);
        location.reload();
      }catch(err){
        error.textContent=err.message||'Não foi possível entrar.'; error.classList.add('open');
        btn.disabled=false; btn.innerHTML='<i data-lucide="log-in"></i>Entrar'; U.icons();
      }
    };
  },
  async syncCloudNow(showToast=true){
    if(typeof Cloud==='undefined' || !Cloud.active()) return;
    if(typeof UI!=='undefined' && UI.isModalOpen()) return;
    try{
      if(showToast) UI.loading(true,'Sincronizando com a nuvem…');
      await DB.syncFromCloud(); await State.reload();
      this.lastCloudRefresh=Date.now();
      if(showToast){ UI.loading(false); UI.toast('Base sincronizada com a nuvem','success'); }
      this.applyStorageStatus(); this.render();
    }catch(err){
      if(showToast){ UI.loading(false); UI.toast('Falha ao sincronizar: '+U.esc(err.message),'error',7000); }
    }
  },
  logoutCloud(){
    UI.confirm('Sair da conta da nuvem neste aparelho?',async()=>{
      await Cloud.signOut(); location.reload();
    },false);
  },

  _booted:false,
  // Tela de recuperação: qualquer falha de carregamento vira uma mensagem clara com ações
  fatal(err){
    try{ UI.loading(false); }catch(e){}
    const msg = (err && (err.message || err.toString())) || 'Erro desconhecido';
    let el = document.getElementById('fatal-screen');
    if(!el){ el = document.createElement('div'); el.id = 'fatal-screen'; document.body.appendChild(el); }
    el.innerHTML = `<div style="position:fixed;inset:0;z-index:900;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:20px">
      <div class="card" style="max-width:540px">
        <h2 style="color:var(--red);margin-bottom:10px">Não foi possível carregar o sistema</h2>
        <div class="import-log" style="margin-bottom:14px">${U.esc(msg)}</div>
        <p style="font-size:.85rem;color:var(--text2);margin-bottom:14px">Seus dados continuam salvos no banco local deste navegador. Tente as opções abaixo:</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="location.reload()">Tentar novamente</button>
          <button class="btn btn-ghost" onclick="App.recoverRemoveLogo()">Remover logo da empresa</button>
          <button class="btn btn-ghost" onclick="App.recoverExport()">Exportar backup de segurança</button>
          <button class="btn btn-ghost" onclick="document.getElementById('fatal-screen').remove()">Continuar mesmo assim</button>
        </div></div></div>`;
  },
  // Remove apenas a logo salva (caso esteja corrompida ou grande demais) e recarrega
  recoverRemoveLogo(){
    const rq = indexedDB.open('ccf_obras');
    rq.onsuccess = e => {
      const d = e.target.result;
      try{
        const del = d.transaction('settings','readwrite').objectStore('settings').delete('companyLogo');
        del.onsuccess = () => { d.close(); location.reload(); };
        del.onerror = () => alert('Falha ao remover a logo.');
      }catch(err){ alert('Falha: ' + err.message); }
    };
    rq.onerror = () => alert('Não foi possível abrir o banco de dados.');
  },
  // Backup de emergência direto do IndexedDB, sem depender do restante do app
  recoverExport(){
    const rq = indexedDB.open('ccf_obras');
    rq.onsuccess = e => {
      const d = e.target.result;
      const data = {app:'ccf_obras', version:1, exportedAt:new Date().toISOString()};
      const names = Array.from(d.objectStoreNames); let done = 0;
      if(!names.length) return alert('Banco vazio.');
      names.forEach(n => {
        const r = d.transaction(n).objectStore(n).getAll();
        r.onsuccess = () => { data[n] = r.result; if(++done === names.length){
          const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'backup-recuperacao.json'; a.click();
        }};
      });
    };
    rq.onerror = () => alert('Não foi possível abrir o banco de dados.');
  },

  async init(){
   try{
    UI.loading(true, 'Carregando banco de dados…');
    // Bibliotecas de CDN ausentes (sem internet/bloqueio) não podem travar o sistema
    const missing = [];
    if(typeof XLSX === 'undefined') missing.push('SheetJS (planilhas)');
    if(typeof Chart === 'undefined') missing.push('Chart.js (gráficos)');
    // Lucide (ícones) carrega com fallback próprio e é apenas cosmético
    // Se o banco não abrir em 12s (ex.: outra aba bloqueando), mostra recuperação
    await Promise.race([ DB.open(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Tempo esgotado ao abrir o banco de dados. Feche outras abas deste sistema e clique em "Tentar novamente".')), 12000)) ]);
    if(typeof Cloud!=='undefined' && Cloud.requested() && !Cloud.configured())
      throw new Error('A nuvem está marcada como ativa, mas a URL ou a Publishable key em config/cloud-config.js é inválida.');
    if(typeof Cloud!=='undefined' && Cloud.configured()){
      const signedIn=await Cloud.ensureSession();
      if(!signedIn){ UI.loading(false); this.showCloudLogin(); return; }
      UI.loading(true,'Sincronizando base na nuvem…');
      await DB.syncFromCloud();
      this.lastCloudRefresh=Date.now();
    }
    await State.reload();
    // Auto-correção (em segundo plano): logo salva sem redimensionar é reduzida
    try{
      const lg = State.settings.companyLogo || '';
      if(lg.length > 400000){
        U.resizeImage(lg).then(small => {
          if(small && small.length < lg.length)
            State.setSetting('companyLogo', small).then(() => App.applyBranding());
        });
      }
    }catch(e){}
    // Snapshot diário automático: cópia compacta dos dados no localStorage,
    // independente do IndexedDB — segunda camada de proteção contra perda
    try{
      const last = +localStorage.getItem('ccf_snap_time') || 0;
      if(Date.now() - last > 86400000 && (State.purchases.length || State.projects.length)){
        const snap = JSON.stringify({ app:'ccf_obras', exportedAt:new Date().toISOString(),
          projects:State.projects, budgets:State.budgets, purchases:State.purchases,
          planning:State.planning, clients:State.clients.map(({logo, ...c}) => c),
          categories:State.categories, measurements:State.measurements,
          settings:Object.entries(State.settings).filter(([k]) => k !== 'companyLogo').map(([id, value]) => ({id, value})) });
        if(snap.length < 4500000){
          localStorage.setItem('ccf_snap', snap);
          localStorage.setItem('ccf_snap_time', String(Date.now()));
        }
      }
    }catch(e){}
    UI.loading(false);
    if(missing.length) setTimeout(() => UI.toast('Bibliotecas não carregadas: ' + missing.join(', ') + '. Verifique sua conexão com a internet e recarregue a página.', 'warn', 10000), 600);
    document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => this.go(b.dataset.view));
    document.getElementById('theme-toggle').onclick = () => this.toggleTheme();
    document.getElementById('future-toggle').onclick = () => this.showFutureExpenses();
    // Recolher menu no desktop foi REMOVIDO por estabilidade (travava a aba
    // com gráficos abertos). No celular (<=860px) o botão abre/fecha o menu.
    document.getElementById('menu-toggle').onclick = () => {
      try{ this.toggleMobileMenu(); }
      catch(err){ UI.toast('Erro ao alternar o menu: ' + U.esc(err.message||err), 'error', 6000); }
    };
    const backdrop = document.getElementById('mobile-menu-backdrop');
    if(backdrop) backdrop.onclick = () => this.closeMobileMenu();
    window.addEventListener('resize', () => { if(window.innerWidth > 860) this.closeMobileMenu(); });
    document.addEventListener('keydown', e => { if(e.key==='Escape') this.closeMobileMenu(); });
    this.initSearch();
    this.applyTheme(State.settings.theme || 'light');
    this.applyBranding();
    this.applyStorageStatus();
    // A preferência navCollapsed salva em versões anteriores é ignorada de
    // propósito: o menu no desktop agora é sempre visível (estabilidade).
    const initialView=this.initHistory();
    this.go(initialView,{history:false});
    if(!State.projects.length)
      UI.toast('Bem-vindo! Importe suas planilhas em <b>Orçamentos</b> e <b>Financeiro</b> para começar.', 'info', 7000);
    // Se os ícones carregarem depois do boot (fallback de CDN), aplica-os na tela atual
    let iconTries = 0;
    const iconTimer = setInterval(() => {
      if(typeof lucide !== 'undefined'){ U.icons(); clearInterval(iconTimer); }
      else if(++iconTries > 20) clearInterval(iconTimer);
    }, 500);
    this._booted = true;
    window.addEventListener('online',()=>{ if(Cloud.active()) Cloud.flushQueue().then(()=>this.applyStorageStatus()); });
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden && Cloud.active() && Date.now()-this.lastCloudRefresh>120000 && !UI.isModalOpen())
        this.syncCloudNow(false);
    });
   }catch(err){ this.fatal(err); }
  }
};

/* Erros nunca ficam invisíveis: antes do boot exibem a tela de recuperação;
   depois do boot viram notificação discreta */
window.addEventListener('error', e => {
  try{ UI.toast('Erro: ' + U.esc((e.error && e.error.message) || e.message), 'error', 7000); }catch(x){}
});

window.addEventListener('unhandledrejection', e => {
  try{ UI.toast('Erro: ' + U.esc((e.reason && e.reason.message) || String(e.reason)), 'error', 7000); }catch(x){}
});

window.addEventListener('DOMContentLoaded', () => App.init());
