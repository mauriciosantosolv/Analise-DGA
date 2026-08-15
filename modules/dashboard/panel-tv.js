/**
 * Modo Painel/TV do dashboard.
 *
 * Usa os mesmos números calculados em dashboard.js. Os filtros disponíveis no
 * painel são os filtros globais já existentes; nenhum dado financeiro é gravado.
 */
const DashboardPanel = {
  active:false,
  slide:0,
  paused:false,
  initialized:false,
  previousTheme:'',
  timers:{clock:null,slide:null,omie:null,data:null},
  wakeLock:null,
  omieState:null,
  omieCheckedAt:0,
  omieLoading:false,
  currentData:null,
  slideNames:['Orçado e realizado','Saúde e medições','Alertas e planejamento'],

  init(){
    if(this.initialized) return;
    this.initialized=true;
    document.addEventListener('visibilitychange',()=>{
      if(!this.active || document.hidden) return;
      this.requestWakeLock();
      this.refreshOmieStatus(true);
    });
  },

  enter(){
    if(this.active) return;
    if(State.view!=='dashboard') App.go('dashboard');
    this.active=true;
    this.slide=0;
    this.paused=false;
    this.previousTheme=document.documentElement.dataset.theme||'light';
    document.documentElement.dataset.theme='dark';
    document.body.classList.add('tv-mode');
    App.render({resetScroll:true});
    this.requestFullscreen();
    this.requestWakeLock();
  },

  exit(options={}){
    if(!this.active) return;
    this.active=false;
    this.clearTimers();
    this.releaseWakeLock();
    document.body.classList.remove('tv-mode');
    document.documentElement.dataset.theme=this.previousTheme||State.settings.theme||'light';
    if(document.fullscreenElement && document.exitFullscreen)
      document.exitFullscreen().catch(()=>{});
    if(options.render!==false) App.render({resetScroll:true});
  },

  requestFullscreen(){
    const root=document.documentElement;
    if(!document.fullscreenElement && root.requestFullscreen)
      root.requestFullscreen({navigationUI:'hide'}).catch(()=>{});
  },

  async requestWakeLock(){
    if(!this.active || !navigator.wakeLock || document.hidden) return;
    try{
      if(!this.wakeLock){
        const lock=await navigator.wakeLock.request('screen');
        this.wakeLock=lock;
        lock.addEventListener('release',()=>{if(this.wakeLock===lock)this.wakeLock=null;},{once:true});
      }
    }catch(e){}
  },

  releaseWakeLock(){
    if(!this.wakeLock) return;
    try{ this.wakeLock.release(); }catch(e){}
    this.wakeLock=null;
  },

  clearTimers(){
    Object.keys(this.timers).forEach(key=>{
      clearInterval(this.timers[key]);
      clearTimeout(this.timers[key]);
      this.timers[key]=null;
    });
  },

  moneyTone(value,warning=false){
    return value<0?'danger':warning?'warning':'positive';
  },

  healthLabel(light){
    return light==='red'?'Crítico':light==='amber'?'Atenção':'Saudável';
  },

  renderMetric(label,value,icon,tone='neutral',sub=''){
    return `<article class="tv-kpi tv-tone-${tone}"><div class="tv-kpi-label"><i data-lucide="${icon}"></i><span>${U.esc(label)}</span></div><b>${value}</b>${sub?`<small>${sub}</small>`:''}</article>`;
  },

  option(value,selected,label=value){
    return `<option value="${U.esc(value)}" ${String(value)===String(selected)?'selected':''}>${U.esc(label)}</option>`;
  },

  filterMarkup(){
    const filters=State.filters||{};
    const selected=State.selectedProjectIds();
    const projectValue=selected.length===1?selected[0]:'';
    const projects=State.projects.slice().sort((a,b)=>U.projLabel(a).localeCompare(U.projLabel(b),'pt-BR'));
    const clients=[...new Set(State.projects.map(project=>project.client).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const statuses=[...new Set(State.projects.map(project=>project.status).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const types=[...new Set(State.projects.map(project=>project.type).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const hasFilters=selected.length>0||[filters.client,filters.category,filters.status,filters.type].some(Boolean);
    return `<div class="tv-filter-bar" aria-label="Filtros do painel">
      <span class="tv-filter-title"><i data-lucide="sliders-horizontal"></i>Filtros</span>
      <label><span>Projeto</span><select id="tv-filter-project"><option value="">Todos os projetos</option>${selected.length>1?`<option value="" selected>${selected.length} projetos selecionados</option>`:''}${projects.map(project=>this.option(project.id,projectValue,U.projLabel(project))).join('')}</select></label>
      <label><span>Cliente</span><select id="tv-filter-client"><option value="">Todos os clientes</option>${clients.map(client=>this.option(client,filters.client)).join('')}</select></label>
      <label><span>Status</span><select id="tv-filter-status"><option value="">Todos os status</option>${statuses.map(status=>this.option(status,filters.status)).join('')}</select></label>
      <label><span>Tipo</span><select id="tv-filter-type"><option value="">Todos os tipos</option>${types.map(type=>this.option(type,filters.type)).join('')}</select></label>
      ${hasFilters?'<button type="button" class="tv-filter-clear" onclick="App.clearFilters()"><i data-lucide="filter-x"></i>Limpar</button>':''}
    </div>`;
  },

  bindFilters(){
    const project=document.getElementById('tv-filter-project');
    if(project) project.onchange=()=>{
      State.filters.project=project.value||'';
      State.filters.projects=[];
      if(Views.planejamento) Views.planejamento.projectFilter='';
      App.render({resetScroll:false});
    };
    [['tv-filter-client','client'],['tv-filter-status','status'],['tv-filter-type','type']].forEach(([id,key])=>{
      const element=document.getElementById(id);
      if(element) element.onchange=()=>{State.filters[key]=element.value;App.render({resetScroll:false});};
    });
  },

  topSuppliers(purchases){
    const totals=new Map();
    (Array.isArray(purchases)?purchases:[]).filter(item=>item&&item.active!==false).forEach(item=>{
      const name=String(item.supplier||'Sem fornecedor').trim()||'Sem fornecedor';
      totals.set(name,(totals.get(name)||0)+(Number(item.value)||0));
    });
    return [...totals].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value).slice(0,7);
  },

  entryTimestamp(entry){
    const numeric=Number(entry&&entry.importedAt);
    if(Number.isFinite(numeric)&&numeric>0) return numeric;
    for(const value of [entry&&entry.createdAt,entry&&entry.syncedAt,entry&&entry.date]){
      const stamp=new Date(value||0).getTime();
      if(Number.isFinite(stamp)&&stamp>0) return stamp;
    }
    return 0;
  },

  latestEntries(purchases){
    return (Array.isArray(purchases)?purchases:[]).filter(item=>item&&item.active!==false)
      .slice().sort((a,b)=>this.entryTimestamp(b)-this.entryTimestamp(a)).slice(0,6);
  },

  sourceLabel(entry){
    return {omiePayable:'Omie · conta a pagar',paidAccount:'Conta paga',labor:'Mão de obra',purchase:'Compra'}[entry&&entry.sourceType]||'Compra';
  },

  latestRow(entry){
    const project=State.projects.find(item=>String(item.id)===String(entry.projectId));
    const projectName=project?U.projLabel(project):'Projeto não localizado';
    return `<tr><td>${U.date(entry.date)||'—'}</td><td><b>${U.esc(projectName)}</b><small>${U.esc(this.sourceLabel(entry))}</small></td><td><b>${U.esc(entry.supplier||'Sem fornecedor')}</b><small>${U.esc(entry.category||entry.desc||'Sem categoria')}</small></td><td class="num"><b>${U.money2(entry.value)}</b></td></tr>`;
  },

  render(data){
    this.currentData=data;
    const organization=typeof Cloud!=='undefined'&&Cloud.active()?(Cloud.organization()||{}).name:'';
    const company=organization||State.settings.companyName||'CliqueObras';
    const logo=U.safeImageSrc(State.settings.companyLogo)||'assets/logo-clique.png';
    const selected=State.selectedProjectIds();
    const scope=selected.length===1?'1 obra selecionada':selected.length>1?`${selected.length} obras selecionadas`:'Todas as obras';
    const activeStats=data.stats.filter(item=>item.p.status==='Em andamento');
    const featured=(activeStats.length?activeStats:data.stats).slice().sort((a,b)=>a.s.health-b.s.health).slice(0,6);
    const allRows=data.stats.slice().sort((a,b)=>a.s.health-b.s.health);
    const alerts=this.alerts(data,activeStats);
    const suppliers=this.topSuppliers(data.purchases);
    const latest=this.latestEntries(data.purchases);

    return `<section id="tv-dashboard" class="tv-dashboard" aria-label="Painel de monitoramento das obras">
      <header class="tv-header">
        <div class="tv-brand"><span class="tv-logo"><img src="${U.esc(logo)}" alt=""></span><div><b>${U.esc(company)}</b><small><span id="tv-slide-title">${this.slideNames[this.slide]}</span> · ${U.esc(scope)}</small></div></div>
        <div class="tv-statuses">
          ${this.cloudStatusMarkup()}
          <span class="tv-status tv-status-neutral" id="tv-omie-status"><i data-lucide="refresh-cw"></i><span>Omie: verificando</span></span>
          <span class="tv-status tv-status-neutral"><i data-lucide="cloud"></i><span id="tv-data-time">Base carregada agora</span></span>
        </div>
        <div class="tv-clock"><b id="tv-clock-time">--:--</b><small id="tv-clock-date">--</small></div>
        <button type="button" class="tv-exit" onclick="DashboardPanel.exit()" title="Sair do modo painel"><i data-lucide="minimize-2"></i><span>Sair do painel</span></button>
      </header>

      <div class="tv-slides">
        <section class="tv-slide ${this.slide===0?'active':''}" data-tv-slide="0" aria-label="Orçado, realizado, fornecedores e lançamentos">
          <div class="tv-kpi-grid">
            ${this.renderMetric('Receita contratada',U.money(data.revenue),'banknote','accent',`${data.projects.length} projeto(s) no filtro`)}
            ${this.renderMetric('Realizado',U.money(data.spent),'wallet',this.moneyTone(data.spent,false),`${U.pct(data.budgetTotal>0?data.spent/data.budgetTotal*100:null)} do orçamento`)}
            ${this.renderMetric('Saldo orçado',U.money(data.balance),'piggy-bank',this.moneyTone(data.balance),`Orçado − realizado − projetado`)}
            ${this.renderMetric('Margem atual',U.pct(data.marginCurrent),'gauge',data.marginCurrent!=null&&data.marginCurrent<0?'danger':data.marginCurrent!=null&&data.marginCurrent<10?'warning':'accent',`Lucro estimado ${U.money(data.profit)}`)}
            ${this.renderMetric('Projetos críticos',String(data.critical.length),'siren',data.critical.length?'danger':'positive',`${data.active.length} projeto(s) em andamento`)}
            ${this.renderMetric('Gastos próximos · 7 dias',U.money(data.next7),'calendar-clock',data.next7>0?'warning':'neutral',`${data.fut.today.length+data.fut.d7.length} item(ns) planejado(s)`)}
          </div>
          ${this.filterMarkup()}
          <div class="tv-monitor-grid">
            <article class="tv-panel-card tv-project-table-card"><div class="tv-section-head"><div><small>VISÃO POR PROJETO</small><h2>Orçado × realizado por obra</h2></div><span class="tv-count">Prioridade: menor saúde financeira</span></div>
              <div class="tv-table-wrap"><table class="tv-project-table"><thead><tr><th>Projeto</th><th>Situação</th><th class="num">Orçado</th><th class="num">Realizado</th><th class="num">Projetado</th><th class="num">Saldo orçado</th><th class="num">Margem</th><th>Consumo</th></tr></thead><tbody>
                ${allRows.slice(0,10).map(({p,s})=>this.projectRow(p,s)).join('')||`<tr><td colspan="8">${this.empty('Nenhuma obra no filtro atual.')}</td></tr>`}
              </tbody></table></div>
              ${allRows.length>10?`<small class="tv-more">Exibindo as 10 obras que mais exigem atenção · ${allRows.length-10} outra(s) permanecem monitoradas.</small>`:''}
            </article>
            <div class="tv-monitor-side">
              <article class="tv-panel-card tv-supplier-card"><div class="tv-section-head"><div><small>FORNECEDORES</small><h2>Top gastos</h2></div><span class="tv-count">${suppliers.length} fornecedor(es)</span></div>
                ${suppliers.length?`<div class="tv-supplier-chart" id="tv-supplier-chart-wrap"><canvas id="tv-suppliers-chart" aria-label="Top gastos por fornecedores"></canvas></div><div class="tv-supplier-fallback" id="tv-supplier-fallback" hidden>${suppliers.map(item=>`<div><span>${U.esc(item.name)}</span><b>${U.money2(item.value)}</b></div>`).join('')}</div>`:this.empty('Nenhum gasto no filtro atual.')}
              </article>
              <article class="tv-panel-card tv-latest-card"><div class="tv-section-head"><div><small>ATUALIZAÇÃO EM TEMPO REAL</small><h2>Últimos lançamentos</h2></div><span class="tv-live"><i></i>Ao vivo</span></div>
                <div class="tv-latest-wrap">${latest.length?`<table class="tv-latest-table"><thead><tr><th>Data</th><th>Projeto / origem</th><th>Conta / fornecedor</th><th class="num">Valor</th></tr></thead><tbody>${latest.map(entry=>this.latestRow(entry)).join('')}</tbody></table>`:this.empty('Nenhum lançamento no filtro atual.')}</div>
              </article>
            </div>
          </div>
        </section>

        <section class="tv-slide ${this.slide===1?'active':''}" data-tv-slide="1" aria-label="Saúde das obras e medições">
          <div class="tv-overview-grid">
            <article class="tv-panel-card tv-project-health"><div class="tv-section-head"><div><small>ACOMPANHAMENTO OPERACIONAL</small><h2>Saúde financeira das obras</h2></div><span class="tv-count">${activeStats.length} em andamento</span></div>
              <div class="tv-health-list">${featured.map(({p,s})=>this.healthRow(p,s)).join('')||this.empty('Nenhuma obra no filtro atual.')}</div>
            </article>
            <article class="tv-panel-card tv-measurement-summary"><div class="tv-section-head"><div><small>MEDIÇÕES</small><h2>Andamento da receita</h2></div></div>
              <div class="tv-measurement-total"><small>Total medido</small><b>${U.money(data.measured)}</b><div class="tv-bar"><span style="width:${Math.min(100,Math.max(0,data.revenue>0?data.measured/data.revenue*100:0))}%"></span></div><small>${U.pct(data.revenue>0?data.measured/data.revenue*100:null)} da receita contratada</small></div>
              <dl class="tv-breakdown"><div><dt>Faturado</dt><dd>${U.money(data.invoiced)}</dd></div><div><dt>Aprovado</dt><dd>${U.money(data.approved)}</dd></div><div class="${data.awaitingApproval>0?'warning':''}"><dt>Aguardando aprovação</dt><dd>${U.money(data.awaitingApproval)}</dd></div><div><dt>Saldo a medir</dt><dd>${U.money(data.revenue-data.measured)}</dd></div></dl>
            </article>
          </div>
        </section>

        <section class="tv-slide ${this.slide===2?'active':''}" data-tv-slide="2" aria-label="Medições e alertas">
          <div class="tv-alert-grid">
            <article class="tv-panel-card tv-alert-card"><div class="tv-section-head"><div><small>ATENÇÃO NECESSÁRIA</small><h2>Alertas do monitoramento</h2></div><span class="tv-count ${alerts.some(item=>item.tone==='danger')?'danger':''}">${alerts.length} alerta(s)</span></div>
              <div class="tv-alert-list">${alerts.slice(0,7).map(item=>`<div class="tv-alert tv-alert-${item.tone}"><span><i data-lucide="${item.icon}"></i></span><div><b>${U.esc(item.title)}</b><small>${U.esc(item.text)}</small></div></div>`).join('')||this.empty('Nenhum alerta financeiro no momento.')}</div>
            </article>
            <div class="tv-side-stack">
              <article class="tv-panel-card"><div class="tv-section-head"><div><small>PLANEJAMENTO</small><h2>Gastos futuros</h2></div></div>${this.futureRows(data.fut)}</article>
              <article class="tv-panel-card"><div class="tv-section-head"><div><small>MEDIÇÕES</small><h2>Fila de aprovação</h2></div></div>
                <dl class="tv-breakdown tv-breakdown-compact"><div><dt>Aguardando aprovação</dt><dd class="${data.awaitingApproval>0?'warning':''}">${U.money(data.awaitingApproval)}</dd></div><div><dt>Aprovado</dt><dd>${U.money(data.approved)}</dd></div><div><dt>Faturado</dt><dd>${U.money(data.invoiced)}</dd></div></dl>
              </article>
            </div>
          </div>
        </section>
      </div>

      <footer class="tv-footer"><div class="tv-progress"><span class="tv-progress-value" id="tv-progress-value"></span></div><div class="tv-pagination" aria-label="Telas do painel">${this.slideNames.map((name,index)=>`<button type="button" class="${this.slide===index?'active':''}" data-tv-dot="${index}" onclick="DashboardPanel.show(${index})" aria-label="Mostrar ${U.esc(name)}"></button>`).join('')}</div><button type="button" class="tv-pause" id="tv-pause" onclick="DashboardPanel.togglePause()"><i data-lucide="${this.paused?'play':'pause'}"></i><span>${this.paused?'Retomar rotação':'Pausar rotação'}</span></button><small>Troca automática a cada 25 segundos</small></footer>
    </section>`;
  },

  healthRow(project,stats){
    const tone=stats.light==='red'?'danger':stats.light==='amber'?'warning':'positive';
    return `<div class="tv-health-row"><span class="tv-health-dot tv-tone-${tone}"></span><div class="tv-health-name"><b>${U.esc(U.projLabel(project))}</b><small>${U.esc(project.client||project.status||'')}</small></div><div class="tv-health-balance"><small>Saldo orçado</small><b class="${stats.balance<0?'danger':''}">${U.money(stats.balance)}</b></div><div class="tv-health-progress"><div><span>${U.pct(stats.consumed)}</span><b>${this.healthLabel(stats.light)}</b></div><div class="tv-bar tv-bar-${tone}"><span style="width:${Math.min(100,Math.max(0,stats.consumed||0))}%"></span></div></div></div>`;
  },

  projectRow(project,stats){
    const tone=stats.light==='red'?'danger':stats.light==='amber'?'warning':'positive';
    return `<tr><td><b>${U.esc(U.projLabel(project))}</b><small>${U.esc(project.client||project.status||'')}</small></td><td><span class="tv-project-state tv-state-${tone}"><i></i>${this.healthLabel(stats.light)}</span></td><td class="num">${U.money(stats.budgetTotal)}</td><td class="num">${U.money(stats.spent)}</td><td class="num">${U.money(stats.projected)}</td><td class="num ${stats.balance<0?'danger':''}">${U.money(stats.balance)}</td><td class="num ${stats.marginCurrent!=null&&stats.marginCurrent<0?'danger':''}">${U.pct(stats.marginCurrent)}</td><td><div class="tv-consumption"><span>${U.pct(stats.consumed)}</span><div class="tv-bar tv-bar-${tone}"><span style="width:${Math.min(100,Math.max(0,stats.consumed||0))}%"></span></div></div></td></tr>`;
  },

  alerts(data,activeStats){
    const out=[];
    activeStats.slice().sort((a,b)=>a.s.health-b.s.health).forEach(({p,s})=>{
      if(s.light==='red') out.push({tone:'danger',icon:'siren',title:`${U.projLabel(p)} em situação crítica`,text:`Saldo ${U.money(s.balance)} · margem ${U.pct(s.marginCurrent)} · consumo ${U.pct(s.consumed)}.`});
      else if(s.light==='amber') out.push({tone:'warning',icon:'alert-triangle',title:`${U.projLabel(p)} exige atenção`,text:`Consumo de ${U.pct(s.consumed)} e saldo orçado de ${U.money(s.balance)}.`});
    });
    if(data.awaitingApproval>0) out.push({tone:'warning',icon:'clock-3',title:'Medições aguardando aprovação',text:`Há ${U.money(data.awaitingApproval)} aguardando aprovação.`});
    if(data.fut.today.length) out.push({tone:'warning',icon:'calendar-clock',title:'Gastos previstos para hoje',text:`${data.fut.today.length} item(ns), totalizando ${U.money(data.fut.today.reduce((sum,item)=>sum+item.value,0))}.`});
    if(this.omieState&&this.omieState.error) out.unshift({tone:'danger',icon:'refresh-cw-off',title:'Sincronização Omie requer atenção',text:this.omieState.error});
    return out;
  },

  futureRows(future){
    const groups=[['Hoje',future.today],['Próximos 7 dias',future.d7],['8 a 15 dias',future.d15],['16 a 30 dias',future.d30]];
    return `<dl class="tv-future-list">${groups.map(([label,items])=>`<div><dt><b>${label}</b><small>${items.length} item(ns)</small></dt><dd>${U.money(items.reduce((sum,item)=>sum+item.value,0))}</dd></div>`).join('')}</dl>`;
  },

  empty(message){
    return `<div class="tv-empty"><i data-lucide="check-circle-2"></i><span>${U.esc(message)}</span></div>`;
  },

  cloudStatusMarkup(){
    const active=typeof Cloud!=='undefined'&&Cloud.active();
    const connected=active&&typeof Cloud.realtimeStatus==='function'&&Cloud.realtimeStatus()==='SUBSCRIBED';
    const tone=connected?'positive':active?'warning':'neutral';
    const label=connected?'Nuvem em tempo real':active?'Nuvem reconectando':'Dados locais';
    return `<span class="tv-status tv-status-${tone}"><i data-lucide="${connected?'wifi':'wifi-off'}"></i><span>${label}</span></span>`;
  },

  renderSupplierChart(){
    const canvas=document.getElementById('tv-suppliers-chart');
    if(!canvas) return;
    const suppliers=this.topSuppliers(this.currentData&&this.currentData.purchases);
    if(typeof Chart==='undefined'){
      canvas.hidden=true;
      const fallback=document.getElementById('tv-supplier-fallback');
      if(fallback) fallback.hidden=false;
      return;
    }
    const money=value=>U.money2(Number(value)||0);
    const chart=new Chart(canvas.getContext('2d'),{
      type:'bar',
      data:{
        labels:suppliers.map(item=>item.name),
        datasets:[{data:suppliers.map(item=>item.value),backgroundColor:'#1aa7c8',borderRadius:7,borderSkipped:false,barThickness:14}]
      },
      options:{
        indexAxis:'y',responsive:true,maintainAspectRatio:false,animation:{duration:550},
        plugins:{legend:{display:false},tooltip:{callbacks:{label:context=>` ${money(context.raw)}`}}},
        scales:{
          x:{beginAtZero:true,grid:{color:'rgba(141,152,168,.13)'},ticks:{color:'#8d98a8',font:{size:10},callback:value=>money(value)}},
          y:{grid:{display:false},ticks:{color:'#cbd3df',font:{size:11,weight:'600'},callback:function(value){const label=this.getLabelForValue(value);return label.length>24?`${label.slice(0,23)}…`:label;}}}
        }
      }
    });
    if(typeof Dash!=='undefined') Dash.charts.tvSuppliers=chart;
  },

  mount(){
    if(!this.active) return;
    this.clearTimers();
    this.bindFilters();
    this.renderSupplierChart();
    this.applySlide(false);
    this.updateClock();
    this.updateDataTime();
    this.updateOmieStatus();
    this.timers.clock=setInterval(()=>{this.updateClock();this.updateDataTime();},1000);
    this.startRotation();
    this.timers.omie=setInterval(()=>this.refreshOmieStatus(true),60000);
    this.timers.data=setInterval(()=>{
      if(this.active&&typeof Cloud!=='undefined'&&Cloud.active()&&!UI.isModalOpen()) App.syncCloudNow(false);
    },120000);
    this.refreshOmieStatus(false);
  },

  startRotation(){
    clearInterval(this.timers.slide);
    this.timers.slide=null;
    const panel=document.getElementById('tv-dashboard');
    if(panel) panel.classList.toggle('tv-paused',this.paused);
    if(this.paused) return;
    this.restartProgress();
    this.timers.slide=setInterval(()=>this.next(),25000);
  },

  show(index){
    this.slide=(Number(index)+this.slideNames.length)%this.slideNames.length;
    this.applySlide(true);
    this.startRotation();
  },

  next(){ this.show(this.slide+1); },
  previous(){ this.show(this.slide-1); },

  togglePause(){
    this.paused=!this.paused;
    const button=document.getElementById('tv-pause');
    if(button){button.innerHTML=`<i data-lucide="${this.paused?'play':'pause'}"></i><span>${this.paused?'Retomar rotação':'Pausar rotação'}</span>`;U.icons();}
    this.startRotation();
  },

  applySlide(announce=true){
    document.querySelectorAll('[data-tv-slide]').forEach(element=>element.classList.toggle('active',Number(element.dataset.tvSlide)===this.slide));
    document.querySelectorAll('[data-tv-dot]').forEach(element=>element.classList.toggle('active',Number(element.dataset.tvDot)===this.slide));
    const title=document.getElementById('tv-slide-title');
    if(title) title.textContent=this.slideNames[this.slide];
    if(announce){
      const dashboard=document.getElementById('tv-dashboard');
      if(dashboard){dashboard.classList.remove('tv-slide-change');void dashboard.offsetWidth;dashboard.classList.add('tv-slide-change');}
    }
  },

  restartProgress(){
    const progress=document.getElementById('tv-progress-value'); if(!progress) return;
    progress.classList.remove('running');
    void progress.offsetWidth;
    progress.classList.add('running');
  },

  updateClock(){
    const now=new Date();
    const time=document.getElementById('tv-clock-time');
    const date=document.getElementById('tv-clock-date');
    if(time) time.textContent=now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    if(date) date.textContent=now.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'}).replace(/\./g,'');
  },

  updateDataTime(){
    const element=document.getElementById('tv-data-time'); if(!element) return;
    const stamp=App.lastCloudRefresh||Date.now();
    const seconds=Math.max(0,Math.round((Date.now()-stamp)/1000));
    element.textContent=seconds<10?'Base atualizada agora':seconds<60?`Base atualizada há ${seconds}s`:`Base atualizada às ${new Date(stamp).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
  },

  async refreshOmieStatus(force=false){
    if(!this.active || this.omieLoading) return;
    const cloudActive=typeof Cloud!=='undefined'&&Cloud.active();
    const owner=cloudActive&&typeof Cloud.isOwner==='function'&&Cloud.isOwner();
    if(!owner){
      this.omieState={restricted:cloudActive};
      this.updateOmieStatus();
      return;
    }
    if(!force&&this.omieCheckedAt&&Date.now()-this.omieCheckedAt<60000){this.updateOmieStatus();return;}
    this.omieLoading=true;
    try{
      const result=await Cloud.omieRequest('status');
      const connection=result&&result.connection;
      this.omieState=!result||!result.connected?{connected:false}:{connected:true,lastSyncAt:connection&&connection.lastSyncAt,status:connection&&connection.lastSyncStatus,error:connection&&connection.lastSyncError};
      this.omieCheckedAt=Date.now();
    }catch(error){
      this.omieState={error:String(error&&error.message||'Não foi possível consultar a integração.')};
    }finally{
      this.omieLoading=false;
      this.updateOmieStatus();
    }
  },

  updateOmieStatus(){
    const element=document.getElementById('tv-omie-status'); if(!element) return;
    const state=this.omieState;
    let tone='neutral',icon='refresh-cw',label='Omie: verificando';
    if(state&&state.error){tone='danger';icon='refresh-cw-off';label='Omie: atenção';}
    else if(state&&state.restricted){tone='neutral';icon='shield-check';label='Omie: status protegido';}
    else if(state&&state.connected===false){tone='neutral';icon='unlink';label='Omie não conectado';}
    else if(state&&state.connected){
      tone=state.status==='error'?'danger':'positive';
      icon=state.status==='error'?'refresh-cw-off':'refresh-cw';
      label=state.lastSyncAt?`Omie atualizado ${new Date(state.lastSyncAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`:'Omie conectado';
    }
    element.className=`tv-status tv-status-${tone}`;
    element.innerHTML=`<i data-lucide="${icon}"></i><span>${U.esc(label)}</span>`;
    U.icons();
  }
};
