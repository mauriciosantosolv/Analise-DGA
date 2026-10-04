/**
 * Módulo Dashboard (dashboard.js)
 *
 * Responsabilidades:
 * - tela principal: KPIs, cards, indicadores e gráficos
 *
 * Dependências:
 * - dashboard/charts.js (Dash)
 * - custos (Biz)
 * - database
 * - utils
 *
 * Não modificar:
 * - custos
 * - compras
 */

/* ---------- DASHBOARD ---------- */
Views.dashboard = {
  title:'Dashboard',
  // Gráficos disponíveis — o usuário escolhe quais exibir (persistido em settings)
  chartDefs:[
    {id:'main',    title:'Orçado × Realizado × Projeção × Saldo Orçado', short:'Orçado × Realizado'},
    {id:'monthly', title:'Evolução Mensal',                        short:'Evolução Mensal'},
    {id:'cat',     title:'Distribuição por Categoria',             short:'Categorias', hint:' <small style="color:var(--text3)">(clique para detalhar)</small>'},
    {id:'cash',    title:'Fluxo de Caixa Futuro (planejado)',      short:'Fluxo de Caixa', sm:true},
    {id:'margin',  title:'Margem por Projeto',                     short:'Margem', sm:true},
    {id:'top',     title:'Top Gastos (fornecedores)',              short:'Top Gastos', sm:true}
  ],
  chartVisibility(){
    return Object.assign({main:true,monthly:true,cat:true,cash:true,margin:true,top:true},
                         State.settings.dashCharts || {});
  },
  toggleChart(id){
    const v = this.chartVisibility(); v[id] = !v[id];
    State.settings.dashCharts = v;                    // efeito imediato na tela
    State.setSetting('dashCharts', v).catch(()=>{});  // persiste em segundo plano
    this.render();
  },
  render(){
    Dash.destroyCharts(); Dash.chartDefaults();
    const vis = this.chartVisibility();
    const categoryFilter = State.filters.category || '';
    // v4.2.6 — projeto Concluído sai do Dashboard principal (lista, KPIs e
    // gráficos) para não poluir o acompanhamento do que está em andamento. O
    // resultado financeiro completo continua no menu Projetos. Ele volta a
    // aparecer quando o usuário pede de forma explícita: filtro de status
    // "Concluído" ou seleção manual de projetos.
    const allProjects = Biz.filteredProjects();
    const showFinished = State.filters.status==='Concluído' || State.selectedProjectIds().length>0;
    const projects = showFinished ? allProjects : allProjects.filter(p=>p.status!=='Concluído');
    const hiddenFinished = allProjects.length - projects.length;
    const visibleProjectIds = new Set(projects.map(p=>String(p.id)));
    const purchases = Biz.filteredPurchases().filter(x=>visibleProjectIds.has(String(x.projectId)));
    const active = projects.filter(p=>p.status==='Em andamento');
    const stats = projects.map(p=>({p, s:Biz.projectStats(p, categoryFilter)}));
    const sum = k => stats.reduce((s,x)=>s+(x.s[k]||0),0);
    const revenue = projects.reduce((s,p)=>s+(p.saleValue||0),0);
    const measured = sum('measured');
    const invoiced = sum('invoiced');
    const approved = sum('approved');
    const awaitingApproval = sum('awaitingApproval');
    const budgetTotal = sum('budgetTotal');
    // A fonte de verdade é projectStats(): assim, o Realizado do topo sempre
    // coincide com a soma do Semáforo e inclui compras, contas pagas, mão de
    // obra e custos da base de cálculo (imposto/adm/taxas/outros).
    const spent = sum('spent');
    const projected = sum('projected');
    const projectedInitial = sum('projectedInitial');
    const planningConsumed = sum('planningConsumed');
    const committedTotal = spent + projected;
    // Equação exibida no dashboard: Orçado - Realizado - Projetado.
    const balance = budgetTotal - committedTotal;
    const marginCurrent = revenue>0 ? (revenue-committedTotal)/revenue*100 : null;
    const profit = revenue - committedTotal;
    const critical = stats.filter(x=>x.s.light==='red' && x.p.status==='Em andamento');
    const projectIds = new Set(projects.map(p=>p.id));
    const filteredPlanning = State.planning.filter(x =>
      projectIds.has(x.projectId) &&
      (!categoryFilter || Biz.sameCategory(x.category,categoryFilter))
    );
    const fut = Biz.futureExpenses(filteredPlanning);
    const next7 = [...fut.today, ...fut.d7].reduce((s,x)=>s+x.value,0);
    const cats = Biz.categoryStats(projects)
      .filter(c=>!categoryFilter || Biz.sameCategory(c.name,categoryFilter));

    // O modo painel reutiliza exatamente os cálculos do dashboard convencional.
    // Ele altera somente a apresentação e não grava dados nem preferências.
    if(typeof DashboardPanel!=='undefined' && DashboardPanel.active){
      $c().innerHTML=DashboardPanel.render({
        projects,purchases,active,stats,revenue,measured,invoiced,approved,awaitingApproval,
        budgetTotal,spent,projected,balance,marginCurrent,profit,critical,next7,fut
      });
      DashboardPanel.mount();
      U.icons();
      return;
    }

    const selectedProjects = State.selectedProjectIds();
    const selectedProject = selectedProjects.length===1 ? selectedProjects[0] : '';
    const goAction=(view,options='')=>selectedProject
      ? `App.goFiltered('${view}',${U.jsArg(selectedProject)}${options?`,`+options:''})`
      : options&&view==='planejamento'
        ? `Views.planejamento.focusUpcoming=true;Views.planejamento.mode='list';App.go('planejamento')`
        : `App.go('${view}')`;
    const kpi = (label, value, icon, cls='', sub='', action='') =>
      `<div class="kpi ${cls} ${action?'kpi-link':''}" ${action?`role="button" tabindex="0" onclick="${action}" onkeydown="if(event.key==='Enter')this.click()"`:''}><div class="k-label"><i data-lucide="${icon}"></i>${label}</div><div class="k-value">${value}</div>${sub?`<div class="k-sub">${sub}</div>`:''}</div>`;

    $c().innerHTML = `
      ${Dash.filtersBar()}
      ${Dash.projectBanner()}
      <div class="kpi-grid">
        ${kpi('Receita Contratada', U.money(revenue), 'banknote', 'accent-blue')}
        ${kpi('Total Medido', U.money(measured), 'ruler', 'accent-green', '', goAction('medicoes'))}
        ${kpi('Saldo a Medir', U.money(revenue-measured), 'file-clock')}
        ${kpi('Orçamento Total', U.money(budgetTotal), 'calculator', '', '', goAction('orcamentos'))}
        ${kpi('Realizado', U.money(spent), 'wallet', '', '', goAction('financeiro'))}
        ${kpi('Projetado', U.money(projected), 'trending-up', '', '', goAction('planejamento'))}
        ${kpi('Saldo Orçado', U.money(balance), 'piggy-bank', balance<0?'accent-red':'accent-green')}
        ${kpi('Margem Atual', U.pct(marginCurrent), 'gauge', marginCurrent!=null&&marginCurrent<0?'accent-red':'accent-blue')}
        ${kpi('Lucro Estimado', U.money(profit), 'coins', profit<0?'accent-red':'accent-green')}
        ${kpi('Projetos Ativos', active.length, 'hard-hat')}
        ${kpi('Projetos Críticos', critical.length, 'siren', critical.length?'accent-red':'')}
        ${kpi('Gastos Próximos (7d)', U.money(next7), 'calendar-clock', '', '', goAction('planejamento','{upcoming7:true}'))}
      </div>

      <div class="toolbar" style="margin-bottom:10px">
        <small style="color:var(--text3);font-weight:700;letter-spacing:.05em">GRÁFICOS:</small>
        ${this.chartDefs.map(d=>`<button class="tab ${vis[d.id]?'active':''}" style="border:1px solid var(--border2)" onclick="Views.dashboard.toggleChart(${U.jsArg(d.id)})" title="Mostrar/ocultar ${U.esc(d.title)}">${U.esc(d.short)}</button>`).join('')}
      </div>
      <div class="two-col">
        ${this.chartDefs.filter(d=>vis[d.id]).map(d=>`<div class="card chart-card"><h3 style="margin-bottom:10px">${d.title}${d.hint||''}</h3><div class="chart-box ${d.sm?'sm':''}"><canvas id="ch-${d.id}"></canvas></div></div>`).join('')
          || '<div class="empty card">Todos os gráficos estão ocultos — use os botões acima para exibi-los.</div>'}
      </div>

      <div class="section-title"><h2>Semáforo Financeiro das Obras</h2>
        ${hiddenFinished?`<small class="dash-hidden-note">${hiddenFinished} projeto(s) concluído(s) oculto(s) — veja o resultado em <button type="button" onclick="App.go('projetos')">Projetos</button></small>`:''}
        <button class="btn btn-ghost btn-sm" onclick="Views.projetos.compare()"><i data-lucide="git-compare"></i>Comparar</button></div>
      <div class="table-wrap"><div class="table-scroll" style="max-height:400px"><table>
        <thead><tr><th></th><th>Obra</th><th>Status</th><th class="num">Orçado</th><th class="num">Realizado</th><th class="num">Projeção</th><th class="num">Saldo Orçado</th><th class="num">Margem</th><th class="num">Saúde</th><th>Consumo</th></tr></thead>
        <tbody>${stats.sort((a,b)=>a.s.health-b.s.health).map(({p,s})=>`
          <tr class="clickable" onclick="Views.projetos.detail(${U.jsArg(p.id)})">
            <td>${lightDot(s.light)}</td><td><b>${U.esc(U.projLabel(p))}</b></td><td>${statusTag(p.status)}</td>
            <td class="num">${U.money(s.budgetTotal)}</td><td class="num">${U.money(s.spent)}</td>
            <td class="num">${U.money(s.projected)}</td>
            <td class="num" style="color:${s.balance<0?'var(--red)':'inherit'}">${U.money(s.balance)}</td>
            <td class="num">${U.pct(s.marginCurrent)}</td><td class="num"><b>${s.health}</b></td>
            <td style="min-width:100px"><div class="progress ${s.consumed>100?'crit':s.consumed>85?'warn':''}"><div style="width:${Math.min(100,s.consumed)}%"></div></div></td>
          </tr>`).join('') || '<tr><td colspan="10"><div class="empty">Sem projetos para exibir</div></td></tr>'}</tbody></table></div></div>

      <div class="section-title"><h2>Dashboard das Categorias</h2></div>
      <div class="table-wrap"><div class="table-scroll" style="max-height:400px"><table>
        <thead><tr><th>Categoria</th><th class="num">Orçado</th><th class="num">Realizado</th><th class="num">Projetado</th><th class="num">Saldo Orçado</th><th class="num">% Comprom.</th><th class="num">Peso</th><th>Tendência</th><th></th></tr></thead>
        <tbody>${cats.map(c=>`
          <tr class="clickable" onclick="Dash.drill({category:${U.jsArg(c.name)}})">
            <td><b>${U.esc(c.name)}</b></td><td class="num">${U.money(c.budget)}</td><td class="num">${U.money(c.spent)}</td>
            <td class="num">${U.money(c.projected)}</td>
            <td class="num" style="color:${c.balance<0?'var(--red)':'inherit'}">${U.money(c.balance)}</td>
            <td class="num">${U.pct(c.committedPct)}</td><td class="num">${U.pct(c.weight)}</td>
            <td>${Dash.trendIcon(c.trend)} <small style="color:var(--text3)">${{up:'Acima do esperado',down:'Economia',flat:'Estável'}[c.trend]}</small></td>
            <td>${lightDot(c.status)}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">Sem dados de categorias</div></td></tr>'}</tbody></table></div></div>

      `;

    Dash.bindFilters();
    this.charts(projects, purchases, stats, cats, fut);
    U.icons();
  },

  charts(projects, purchases, stats, cats, fut){
    if(typeof Chart === 'undefined') return; // CDN indisponível: KPIs e tabelas continuam funcionando
    const money = v => U.money(v);
    const mobile=typeof matchMedia==='function' && matchMedia('(max-width: 600px)').matches;
    const itemLimit=mobile?6:12;
    const compactTicks={autoSkip:true,maxTicksLimit:mobile?5:9,font:{size:mobile?9:11}};
    const tt = { callbacks:{ label: ctx => ` ${ctx.dataset.label||ctx.label}: ${U.money2(ctx.parsed.y ?? ctx.parsed)}` } };

    // Orçado x Realizado x Projeção x Saldo Orçado por projeto
    const top = stats.filter(x=>x.s.budgetTotal>0 || x.s.spent>0).sort((a,b)=>b.s.spent-a.s.spent).slice(0,itemLimit);
    if(document.getElementById('ch-main')) Dash.charts.main = new Chart(document.getElementById('ch-main'), {
      type:'bar',
      data:{ labels: top.map(x=>x.p.proposal),
        datasets:[
          {label:'Orçado', data:top.map(x=>x.s.budgetTotal), backgroundColor:'#2563EB'},
          {label:'Realizado', data:top.map(x=>x.s.spent), backgroundColor:'#16A34A'},
          {label:'Projeção', data:top.map(x=>x.s.projected), backgroundColor:'#D97706'},
          {label:'Saldo Orçado', data:top.map(x=>x.s.balance), backgroundColor:'#94A3B8'}]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{tooltip:tt, legend:{position:'bottom'}},
        onClick:(e,els)=>{ if(els.length){ const p = top[els[0].index].p; Views.projetos.detail(p.id); } },
        scales:{ x:{ticks:compactTicks}, y:{ ticks:{...compactTicks,callback:v=>U.money(v)} } } }
    });

    // Série mensal (Curva S foi removida a pedido do usuário em 07/2026)
    const series = Biz.monthlySeries(purchases);

    // Evolução mensal (com drill por mês)
    if(document.getElementById('ch-monthly')) Dash.charts.monthly = new Chart(document.getElementById('ch-monthly'), {
      type:'bar',
      data:{ labels:series.labels, datasets:[{label:'Gastos no mês', data:series.values, backgroundColor:'#2563EB', borderRadius:6}]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{tooltip:tt, legend:{display:false}},
        onClick:(e,els)=>{ if(els.length) Dash.drill({month:series.labels[els[0].index]}); },
        scales:{ x:{ticks:compactTicks}, y:{ ticks:{...compactTicks,callback:v=>U.money(v)} } } }
    });

    // Distribuição por categoria: realizado + planejamento comprometido. Assim,
    // categorias que existem apenas no Planejamento também aparecem no gráfico.
    const catTop = cats.filter(c=>c.committed>0).slice(0,mobile?6:10);
    if(document.getElementById('ch-cat')) Dash.charts.cat = new Chart(document.getElementById('ch-cat'), {
      type:'doughnut',
      data:{ labels:catTop.map(c=>c.name), datasets:[{data:catTop.map(c=>c.committed), backgroundColor:catTop.map((c,i)=>Dash.color(i)), borderWidth:0}]},
      options:{ responsive:true, maintainAspectRatio:false, cutout:'62%',
        plugins:{ legend:{position:mobile?'bottom':'right', labels:{boxWidth:12, font:{size:mobile?9:11},padding:mobile?8:10}},
          tooltip:{ callbacks:{ label: ctx => { const c=catTop[ctx.dataIndex]; return ` ${ctx.label}: ${U.money2(ctx.parsed)} (realizado ${U.money2(c.spent)} + projetado ${U.money2(c.projected)})`; } } } },
        onClick:(e,els)=>{ if(els.length) Dash.drill({category:catTop[els[0].index].name}); } }
    });

    // Fluxo de caixa futuro
    const futAll = [...fut.today, ...fut.d7, ...fut.d15, ...fut.d30];
    const futMap = {};
    futAll.forEach(x=>{ futMap[x.date] = (futMap[x.date]||0)+x.value; });
    const futKeys = Object.keys(futMap).sort();
    if(document.getElementById('ch-cash')) Dash.charts.cash = new Chart(document.getElementById('ch-cash'), {
      type:'bar',
      data:{ labels:futKeys.map(d=>U.date(d)), datasets:[{label:'Planejado', data:futKeys.map(k=>futMap[k]), backgroundColor:'#7C3AED', borderRadius:6}]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{tooltip:tt, legend:{display:false}},
        onClick:(e,els)=>{ if(els.length) Views.planejamento.showDay(futKeys[els[0].index],futAll); },
        scales:{ x:{ticks:compactTicks}, y:{ ticks:{...compactTicks,callback:v=>U.money(v)} } } }
    });

    // Margem por projeto
    const withMargin = stats.filter(x=>x.s.marginCurrent!=null).sort((a,b)=>a.s.marginCurrent-b.s.marginCurrent).slice(0,itemLimit);
    if(document.getElementById('ch-margin')) Dash.charts.margin = new Chart(document.getElementById('ch-margin'), {
      type:'bar',
      data:{ labels:withMargin.map(x=>x.p.proposal),
        datasets:[{label:'Margem %', data:withMargin.map(x=>x.s.marginCurrent), backgroundColor:withMargin.map(x=>x.s.marginCurrent<0?'#DC2626':x.s.marginCurrent<10?'#D97706':'#16A34A'), borderRadius:6}]},
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:ctx=>` ${U.pct(ctx.parsed.x)}` } } },
        onClick:(e,els)=>{ if(els.length) Views.projetos.detail(withMargin[els[0].index].p.id); },
        scales:{x:{ticks:{...compactTicks,callback:v=>U.pct(v)}},y:{ticks:compactTicks}} }
    });

    // Top fornecedores
    const supMap = {};
    purchases.forEach(x=>{ const k = x.supplier||'(sem fornecedor)'; supMap[k]=(supMap[k]||0)+x.value; });
    const sups = Object.entries(supMap).sort((a,b)=>b[1]-a[1]).slice(0,mobile?6:10);
    if(document.getElementById('ch-top')) Dash.charts.top = new Chart(document.getElementById('ch-top'), {
      type:'bar',
      data:{ labels:sups.map(s=>s[0].length>(mobile?18:26)?s[0].slice(0,mobile?17:25)+'…':s[0]), datasets:[{label:'Total', data:sups.map(s=>s[1]), backgroundColor:'#0891B2', borderRadius:6}]},
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>` ${U.money2(ctx.parsed.x)}`}}},
        onClick:(e,els)=>{ if(els.length) Dash.drill({supplier:sups[els[0].index][0]}); },
        scales:{ x:{ ticks:{...compactTicks,callback:v=>U.money(v)} },y:{ticks:compactTicks} } }
    });

    // (Ranking de Clientes foi removido a pedido do usuário em 07/2026)
  }
};
