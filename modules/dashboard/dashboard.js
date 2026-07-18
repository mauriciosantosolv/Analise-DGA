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
  render(){
    Dash.destroyCharts(); Dash.chartDefaults();
    const projects = Biz.filteredProjects();
    const purchases = Biz.filteredPurchases();
    const active = projects.filter(p=>p.status==='Em andamento');
    const stats = projects.map(p=>({p, s:Biz.projectStats(p)}));
    const sum = k => stats.reduce((s,x)=>s+(x.s[k]||0),0);
    const revenue = projects.reduce((s,p)=>s+(p.saleValue||0),0);
    const measured = sum('measured'); // total medido/faturado
    const overhead = sum('overhead'); // imposto/adm/taxas sobre a venda (base de cálculo)
    const budgetTotal = sum('budgetTotal');
    const spent = purchases.reduce((s,x)=>s+x.value,0) + overhead; // realizado inclui overhead
    // Projetado do dashboard: planilha por categoria (máx. entre gasto e orçado
    // por categoria) + overhead — regra centralizada em Biz.projectedByCategory
    const projected = Biz.projectedByCategory(projects);
    const balance = budgetTotal - spent;
    const marginPlanned = revenue>0 ? (revenue-budgetTotal-overhead)/revenue*100 : null;
    const marginCurrent = revenue>0 ? (revenue-projected)/revenue*100 : null; // projected já contém overhead
    const profit = revenue - projected;
    const deviation = budgetTotal>0 ? (projected-budgetTotal)/budgetTotal*100 : null;
    const critical = stats.filter(x=>x.s.light==='red' && x.p.status==='Em andamento');
    const fut = Biz.futureExpenses();
    const next7 = [...fut.today, ...fut.d7].reduce((s,x)=>s+x.value,0);
    const deadlines = active.map(p=>p.deadline).filter(Boolean).sort();
    const nextDeadline = deadlines.find(d=>d>=U.isoDate(new Date()));
    const alerts = Biz.alerts();
    const cats = Biz.categoryStats(projects);

    const kpi = (label, value, icon, cls='', sub='') =>
      `<div class="kpi ${cls}"><div class="k-label"><i data-lucide="${icon}"></i>${label}</div><div class="k-value">${value}</div>${sub?`<div class="k-sub">${sub}</div>`:''}</div>`;

    $c().innerHTML = `
      ${Dash.filtersBar()}
      ${Dash.projectBanner()}
      <div class="kpi-grid">
        ${kpi('Receita Contratada', U.money(revenue), 'banknote', 'accent-blue')}
        ${kpi('Medido / Faturado', U.money(measured), 'ruler', 'accent-green', U.pct(revenue>0?measured/revenue*100:null)+' da receita')}
        ${kpi('Saldo a Medir', U.money(revenue-measured), 'file-clock')}
        ${kpi('Orçamento Total', U.money(budgetTotal), 'calculator')}
        ${kpi('Realizado', U.money(spent), 'wallet', '', U.pct(budgetTotal>0?spent/budgetTotal*100:null)+' consumido · inclui imposto/adm')}
        ${kpi('Projetado', U.money(projected), 'trending-up', '', 'por categoria + imposto/adm')}
        ${kpi('Saldo', U.money(balance), 'piggy-bank', balance<0?'accent-red':'accent-green')}
        ${kpi('Margem Prevista', U.pct(marginPlanned), 'target')}
        ${kpi('Margem Atual', U.pct(marginCurrent), 'gauge', marginCurrent!=null&&marginCurrent<0?'accent-red':'accent-blue')}
        ${kpi('Lucro Estimado', U.money(profit), 'coins', profit<0?'accent-red':'accent-green')}
        ${kpi('Desvio Financeiro', U.pct(deviation), 'activity', deviation>0?'accent-red':'accent-green')}
        ${kpi('Projetos Ativos', active.length, 'hard-hat')}
        ${kpi('Projetos Críticos', critical.length, 'siren', critical.length?'accent-red':'')}
        ${kpi('Gastos Próximos (7d)', U.money(next7), 'calendar-clock', '', fut.today.length+fut.d7.length+' itens planejados')}
        ${kpi('Próximo Vencimento', nextDeadline?U.date(nextDeadline):'—', 'hourglass', '', nextDeadline?U.daysBetween(U.isoDate(new Date()), nextDeadline)+' dias restantes':'')}
      </div>

      <div class="two-col">
        <div class="card chart-card"><h3 style="margin-bottom:10px">Orçado × Realizado × Projeção × Saldo</h3><div class="chart-box"><canvas id="ch-main"></canvas></div></div>
        <div class="card chart-card"><h3 style="margin-bottom:10px">Curva S — Acumulado</h3><div class="chart-box"><canvas id="ch-curve"></canvas></div></div>
        <div class="card chart-card"><h3 style="margin-bottom:10px">Evolução Mensal</h3><div class="chart-box"><canvas id="ch-monthly"></canvas></div></div>
        <div class="card chart-card"><h3 style="margin-bottom:10px">Distribuição por Categoria <small style="color:var(--text3)">(clique para detalhar)</small></h3><div class="chart-box"><canvas id="ch-cat"></canvas></div></div>
        <div class="card chart-card"><h3 style="margin-bottom:10px">Fluxo de Caixa Futuro (planejado)</h3><div class="chart-box sm"><canvas id="ch-cash"></canvas></div></div>
        <div class="card chart-card"><h3 style="margin-bottom:10px">Margem por Projeto</h3><div class="chart-box sm"><canvas id="ch-margin"></canvas></div></div>
        <div class="card chart-card"><h3 style="margin-bottom:10px">Top Gastos (fornecedores)</h3><div class="chart-box sm"><canvas id="ch-top"></canvas></div></div>
        <div class="card chart-card"><h3 style="margin-bottom:10px">Ranking de Clientes (receita)</h3><div class="chart-box sm"><canvas id="ch-clients"></canvas></div></div>
      </div>

      <div class="section-title"><h2>Semáforo Financeiro das Obras</h2>
        <button class="btn btn-ghost btn-sm" onclick="Views.projetos.compare()"><i data-lucide="git-compare"></i>Comparar</button></div>
      <div class="table-wrap"><div class="table-scroll" style="max-height:400px"><table>
        <thead><tr><th></th><th>Obra</th><th>Status</th><th class="num">Orçado</th><th class="num">Realizado</th><th class="num">Projeção</th><th class="num">Saldo</th><th class="num">Margem</th><th class="num">Saúde</th><th>Consumo</th></tr></thead>
        <tbody>${stats.sort((a,b)=>a.s.health-b.s.health).map(({p,s})=>`
          <tr class="clickable" onclick="Views.projetos.detail('${p.id}')">
            <td>${lightDot(s.light)}</td><td><b>${U.esc(U.projLabel(p))}</b></td><td>${statusTag(p.status)}</td>
            <td class="num">${U.money(s.budgetTotal)}</td><td class="num">${U.money(s.spent)}</td>
            <td class="num">${U.money(s.projected)}</td>
            <td class="num" style="color:${s.balance<0?'var(--red)':'inherit'}">${U.money(s.balance)}</td>
            <td class="num">${U.pct(s.marginCurrent)}</td><td class="num"><b>${s.health}</b></td>
            <td style="min-width:100px"><div class="progress ${s.consumed>100?'crit':s.consumed>85?'warn':''}"><div style="width:${Math.min(100,s.consumed)}%"></div></div></td>
          </tr>`).join('') || '<tr><td colspan="10"><div class="empty">Sem projetos para exibir</div></td></tr>'}</tbody></table></div></div>

      <div class="section-title"><h2>Dashboard das Categorias</h2></div>
      <div class="table-wrap"><div class="table-scroll" style="max-height:400px"><table>
        <thead><tr><th>Categoria</th><th class="num">Orçado</th><th class="num">Realizado</th><th class="num">Projetado</th><th class="num">Saldo</th><th class="num">%</th><th class="num">Peso</th><th>Tendência</th><th></th></tr></thead>
        <tbody>${cats.map(c=>`
          <tr class="clickable" onclick="Dash.drill({category:'${U.esc(c.name)}'})">
            <td><b>${U.esc(c.name)}</b></td><td class="num">${U.money(c.budget)}</td><td class="num">${U.money(c.spent)}</td>
            <td class="num">${U.money(c.projected)}</td>
            <td class="num" style="color:${c.balance<0?'var(--red)':'inherit'}">${U.money(c.balance)}</td>
            <td class="num">${U.pct(c.consumed)}</td><td class="num">${U.pct(c.weight)}</td>
            <td>${Dash.trendIcon(c.trend)} <small style="color:var(--text3)">${{up:'Acima do esperado',down:'Economia',flat:'Estável'}[c.trend]}</small></td>
            <td>${lightDot(c.status)}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">Sem dados de categorias</div></td></tr>'}</tbody></table></div></div>

      <div class="section-title"><h2>Central de Alertas</h2><span class="tag ${alerts.some(a=>a.level==='red')?'tag-red':'tag-green'}">${alerts.length} alerta(s)</span></div>
      <div class="card">${alerts.length ? alerts.slice(0,25).map(a=>`
        <div class="alert-item clickable" style="cursor:pointer" onclick="App.go('${a.view}')">
          <i data-lucide="${a.icon}" style="color:var(--${a.level==='blue'?'blue':a.level})"></i><div>${a.msg}</div></div>`).join('')
        : '<div class="empty"><i data-lucide="shield-check"></i><br>Nenhum alerta. Tudo sob controle.</div>'}</div>`;

    Dash.bindFilters();
    this.charts(projects, purchases, stats, cats, fut);
    U.icons();
  },

  charts(projects, purchases, stats, cats, fut){
    if(typeof Chart === 'undefined') return; // CDN indisponível: KPIs e tabelas continuam funcionando
    const money = v => U.money(v);
    const tt = { callbacks:{ label: ctx => ` ${ctx.dataset.label||ctx.label}: ${U.money2(ctx.parsed.y ?? ctx.parsed)}` } };

    // Orçado x Realizado x Projeção x Saldo por projeto
    const top = stats.filter(x=>x.s.budgetTotal>0 || x.s.spent>0).sort((a,b)=>b.s.spent-a.s.spent).slice(0,12);
    Dash.charts.main = new Chart(document.getElementById('ch-main'), {
      type:'bar',
      data:{ labels: top.map(x=>x.p.proposal),
        datasets:[
          {label:'Orçado', data:top.map(x=>x.s.budgetTotal), backgroundColor:'#2563EB'},
          {label:'Realizado', data:top.map(x=>x.s.spent), backgroundColor:'#16A34A'},
          {label:'Projeção', data:top.map(x=>x.s.projected), backgroundColor:'#D97706'},
          {label:'Saldo', data:top.map(x=>x.s.balance), backgroundColor:'#94A3B8'}]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{tooltip:tt, legend:{position:'bottom'}},
        onClick:(e,els)=>{ if(els.length){ const p = top[els[0].index].p; Views.projetos.detail(p.id); } },
        scales:{ y:{ ticks:{ callback:v=>U.money(v) } } } }
    });

    // Curva S
    const series = Biz.monthlySeries(purchases);
    const budgetTotal = stats.reduce((s,x)=>s+x.s.budgetTotal,0);
    Dash.charts.curve = new Chart(document.getElementById('ch-curve'), {
      type:'line',
      data:{ labels:series.labels, datasets:[
        {label:'Realizado acumulado', data:series.cumulative, borderColor:'#2563EB', backgroundColor:'#2563EB22', fill:true, tension:.35},
        {label:'Orçamento total', data:series.labels.map(()=>budgetTotal), borderColor:'#DC2626', borderDash:[6,4], pointRadius:0}]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{tooltip:tt, legend:{position:'bottom'}},
        scales:{ y:{ ticks:{ callback:v=>U.money(v) } } } }
    });

    // Evolução mensal (com drill por mês)
    Dash.charts.monthly = new Chart(document.getElementById('ch-monthly'), {
      type:'bar',
      data:{ labels:series.labels, datasets:[{label:'Gastos no mês', data:series.values, backgroundColor:'#2563EB', borderRadius:6}]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{tooltip:tt, legend:{display:false}},
        onClick:(e,els)=>{ if(els.length) Dash.drill({month:series.labels[els[0].index]}); },
        scales:{ y:{ ticks:{ callback:v=>U.money(v) } } } }
    });

    // Distribuição por categoria (doughnut, drill)
    const catTop = cats.filter(c=>c.spent>0).slice(0,10);
    Dash.charts.cat = new Chart(document.getElementById('ch-cat'), {
      type:'doughnut',
      data:{ labels:catTop.map(c=>c.name), datasets:[{data:catTop.map(c=>c.spent), backgroundColor:catTop.map((c,i)=>Dash.color(i)), borderWidth:0}]},
      options:{ responsive:true, maintainAspectRatio:false, cutout:'62%',
        plugins:{ legend:{position:'right', labels:{boxWidth:12, font:{size:11}}},
          tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: ${U.money2(ctx.parsed)}` } } },
        onClick:(e,els)=>{ if(els.length) Dash.drill({category:catTop[els[0].index].name}); } }
    });

    // Fluxo de caixa futuro
    const futAll = [...fut.today, ...fut.d7, ...fut.d15, ...fut.d30];
    const futMap = {};
    futAll.forEach(x=>{ futMap[x.date] = (futMap[x.date]||0)+x.value; });
    const futKeys = Object.keys(futMap).sort();
    Dash.charts.cash = new Chart(document.getElementById('ch-cash'), {
      type:'bar',
      data:{ labels:futKeys.map(d=>U.date(d)), datasets:[{label:'Planejado', data:futKeys.map(k=>futMap[k]), backgroundColor:'#7C3AED', borderRadius:6}]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{tooltip:tt, legend:{display:false}},
        scales:{ y:{ ticks:{ callback:v=>U.money(v) } } } }
    });

    // Margem por projeto
    const withMargin = stats.filter(x=>x.s.marginCurrent!=null).sort((a,b)=>a.s.marginCurrent-b.s.marginCurrent).slice(0,12);
    Dash.charts.margin = new Chart(document.getElementById('ch-margin'), {
      type:'bar',
      data:{ labels:withMargin.map(x=>x.p.proposal),
        datasets:[{label:'Margem %', data:withMargin.map(x=>x.s.marginCurrent), backgroundColor:withMargin.map(x=>x.s.marginCurrent<0?'#DC2626':x.s.marginCurrent<10?'#D97706':'#16A34A'), borderRadius:6}]},
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:ctx=>` ${U.pct(ctx.parsed.x)}` } } },
        onClick:(e,els)=>{ if(els.length) Views.projetos.detail(withMargin[els[0].index].p.id); } }
    });

    // Top fornecedores
    const supMap = {};
    purchases.forEach(x=>{ const k = x.supplier||'(sem fornecedor)'; supMap[k]=(supMap[k]||0)+x.value; });
    const sups = Object.entries(supMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
    Dash.charts.top = new Chart(document.getElementById('ch-top'), {
      type:'bar',
      data:{ labels:sups.map(s=>s[0].length>26?s[0].slice(0,25)+'…':s[0]), datasets:[{label:'Total', data:sups.map(s=>s[1]), backgroundColor:'#0891B2', borderRadius:6}]},
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>` ${U.money2(ctx.parsed.x)}`}}},
        onClick:(e,els)=>{ if(els.length) Dash.drill({supplier:sups[els[0].index][0]}); },
        scales:{ x:{ ticks:{ callback:v=>U.money(v) } } } }
    });

    // Ranking clientes
    const cliMap = {};
    projects.forEach(p=>{ if(p.client) cliMap[p.client]=(cliMap[p.client]||0)+(p.saleValue||0); });
    const clis = Object.entries(cliMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
    Dash.charts.clients = new Chart(document.getElementById('ch-clients'), {
      type:'bar',
      data:{ labels:clis.map(c=>c[0]), datasets:[{label:'Receita', data:clis.map(c=>c[1]), backgroundColor:'#4F46E5', borderRadius:6}]},
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>` ${U.money2(ctx.parsed.x)}`}}},
        scales:{ x:{ ticks:{ callback:v=>U.money(v) } } } }
    });
  }
};
