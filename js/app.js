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
  go(view){
    State.view = view;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.getElementById('sidebar').classList.remove('open');
    this.render();
  },
  render(){
    const v = Views[State.view] || Views.dashboard;
    document.getElementById('page-title').textContent = v.title;
    Dash.destroyCharts();
    v.render();
    this.renderRightbar();
    document.getElementById('content').scrollTop = 0;
  },
  clearFilters(){
    State.filters = { project:'', client:'', year:'', from:'', to:'', category:'', status:'', type:'' };
    this.render();
  },

  /* Painel lateral fixo — gastos futuros */
  renderRightbar(){
    const fut = Biz.futureExpenses();
    const block = (title, items) => `
      <div class="rb-section"><div class="rb-title">${title} · ${U.money(items.reduce((s,x)=>s+x.value,0))}</div>
      ${items.length ? items.slice(0,6).map(x => { const p = State.projects.find(pr=>pr.id===x.projectId); return `
        <div class="rb-item"><div><b>${U.esc(x.category)}</b><small>${U.esc(p?p.proposal:'?')} · ${U.date(x.date)}</small></div>
        <b>${U.money(x.value)}</b></div>`; }).join('') : '<small style="color:var(--text3)">Nenhum item</small>'}</div>`;
    document.getElementById('rightbar-content').innerHTML =
      block('Hoje', fut.today) + block('Próximos 7 dias', fut.d7) +
      block('8–15 dias', fut.d15) + block('16–30 dias', fut.d30);
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
        if(x.category && !catsSeen.has(x.category) && U.norm(x.category).includes(q)){ catsSeen.add(x.category);
          out.push({icon:'tag', label:x.category, tag:'Categoria', fn:`Dash.drill({category:${JSON.stringify(x.category)}})`}); }
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
    // Recolher menu no desktop foi REMOVIDO por estabilidade (travava a aba
    // com gráficos abertos). No celular (<=860px) o botão abre/fecha o menu.
    document.getElementById('menu-toggle').onclick = () => {
      try{
        if(window.innerWidth <= 860) document.getElementById('sidebar').classList.toggle('open');
      }catch(err){ UI.toast('Erro ao alternar o menu: ' + U.esc(err.message||err), 'error', 6000); }
    };
    this.initSearch();
    this.applyTheme(State.settings.theme || 'light');
    this.applyBranding();
    // A preferência navCollapsed salva em versões anteriores é ignorada de
    // propósito: o menu no desktop agora é sempre visível (estabilidade).
    this.go('dashboard');
    if(!State.projects.length)
      UI.toast('Bem-vindo! Importe suas planilhas em <b>Orçamentos</b> e <b>Financeiro</b> para começar.', 'info', 7000);
    // Se os ícones carregarem depois do boot (fallback de CDN), aplica-os na tela atual
    let iconTries = 0;
    const iconTimer = setInterval(() => {
      if(typeof lucide !== 'undefined'){ U.icons(); clearInterval(iconTimer); }
      else if(++iconTries > 20) clearInterval(iconTimer);
    }, 500);
    this._booted = true;
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
