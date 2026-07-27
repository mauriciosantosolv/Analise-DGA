/**
 * Módulo Dashboard — Gráficos (charts.js)
 *
 * Responsabilidades:
 * - configuração e ciclo de vida dos gráficos (Chart.js)
 * - banner de projeto, drill-down, simulador de cenários
 * - barra de filtros globais
 *
 * Dependências:
 * - router (Views)
 * - custos (Biz)
 * - database
 * - utils
 * - vendor Chart.js
 *
 * Não modificar:
 * - custos
 * - compras
 */

/* ================= [8] DASHBOARD, GRÁFICOS, DRILL-DOWN, SIMULADOR ================= */
const Dash = {
  charts:{},
  destroyCharts(){ Object.values(this.charts).forEach(c=>{try{c.destroy()}catch(e){}}); this.charts = {}; },
  color(i){ const pal = ['#2563EB','#16A34A','#D97706','#DC2626','#7C3AED','#0891B2','#DB2777','#65A30D','#EA580C','#4F46E5','#0D9488','#9333EA']; return pal[i % pal.length]; },
  chartDefaults(){
    if(typeof Chart === 'undefined') return; // CDN indisponível: segue sem gráficos
    const cs = getComputedStyle(document.body);
    Chart.defaults.font.family = 'Inter';
    Chart.defaults.color = cs.getPropertyValue('--text2').trim();
    Chart.defaults.borderColor = cs.getPropertyValue('--border2').trim();
  },
  trendIcon(t){
    return t==='up' ? '<span class="trend-up" title="Gastando acima do esperado">⬆</span>'
      : t==='down' ? '<span class="trend-down" title="Economia">⬇</span>'
      : '<span class="trend-flat" title="Estável">➡</span>';
  },
  healthRing(h, light){
    const col = {green:'var(--green)', amber:'var(--amber)', red:'var(--red)'}[light];
    const c = 2*Math.PI*30, off = c*(1-h/100);
    return `<div class="health-ring" title="Índice de Saúde Financeira">
      <svg width="74" height="74" viewBox="0 0 74 74">
        <circle cx="37" cy="37" r="30" fill="none" stroke="var(--border2)" stroke-width="7"/>
        <circle cx="37" cy="37" r="30" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 37 37)" style="transition:stroke-dashoffset 1s"/>
      </svg><span style="color:${col}">${h}</span></div>`;
  },

  /* ----- filtros globais ----- */
  filtersBar(){
    const f = State.filters;
    const catMap=new Map();
    [...State.categories.map(c=>c.name),...State.budgets.map(b=>b.category), ...State.purchases.map(x=>x.category), ...State.planning.map(x=>x.category)]
      .filter(Boolean).forEach(name=>{ const key=Biz.categoryKey(name); if(key && !catMap.has(key)) catMap.set(key,Biz.categoryName(name)); });
    Biz.categoryStats(State.projects).forEach(c=>{ if(!catMap.has(c.categoryKey)) catMap.set(c.categoryKey,c.name); });
    const cats=[...catMap.values()].sort((a,b)=>a.localeCompare(b));
    const opt = (v, sel, label) => `<option value="${U.esc(v)}" ${v===sel?'selected':''}>${U.esc(label??v)}</option>`;
    return `<div class="filters-bar">
      <select id="flt-project" title="Projeto"><option value="">Todos os projetos</option>${State.projects.map(p=>opt(p.id, f.project, U.projLabel(p))).join('')}</select>
      <select id="flt-client" title="Cliente"><option value="">Todos os clientes</option>${[...new Set(State.projects.map(p=>p.client).filter(Boolean))].sort().map(c=>opt(c, f.client)).join('')}</select>
      <select id="flt-category" title="Categoria"><option value="">Todas as categorias</option>${cats.map(c=>`<option value="${U.esc(c)}" ${Biz.sameCategory(c,f.category)?'selected':''}>${U.esc(c)}</option>`).join('')}</select>
      <select id="flt-status" title="Status"><option value="">Todos os status</option>${['Em andamento','Concluído','Paralisado','A executar'].map(s=>opt(s, f.status)).join('')}</select>
      <select id="flt-type" title="Tipo"><option value="">Todos os tipos</option>${['HH','Obra','Fornecimento','Painel'].map(t=>opt(t, f.type)).join('')}</select>
      ${Object.values(f).some(v=>v)?`<button class="btn btn-ghost btn-sm" onclick="App.clearFilters()"><i data-lucide="x"></i>Limpar</button>`:''}
    </div>`;
  },
  bindFilters(){
    [['flt-project','project'],['flt-client','client'],['flt-category','category'],['flt-status','status'],['flt-type','type']]
      .forEach(([id,k]) => { const el = document.getElementById(id); if(el) el.onchange = () => { State.filters[k] = el.value; App.render(); }; });
  }
};

/* Banner do projeto em análise — destaca a logo do cliente quando um projeto está filtrado */
Dash.projectBanner = function(){
  const f = State.filters; if(!f.project) return '';
  const p = State.projects.find(x=>x.id===f.project); if(!p) return '';
  const c = State.clients.find(x=>x.name===p.client);
  const logo = (c && c.logo) || p.clientLogo || '';
  const st = Biz.projectStats(p, State.filters.category || '');
  return `<div class="card" style="display:flex;align-items:center;gap:20px;margin-bottom:16px;flex-wrap:wrap">
    ${logo ? `<img src="${logo}" class="logo-clean" style="width:84px;height:84px;object-fit:contain">`
           : `<span class="avatar-ph" style="width:84px;height:84px;font-size:1.6rem;border-radius:14px">${U.initials(p.client||p.name||p.proposal)}</span>`}
    <div style="flex:1;min-width:220px">
      <small style="color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.07em">Projeto em análise</small>
      <h1 style="margin:2px 0 6px">${U.esc(U.projLabel(p))}</h1>
      <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
        ${statusTag(p.status)}<span class="tag tag-gray">${U.esc(p.type||'—')}</span>
        ${p.client?`<span class="tag tag-blue">${U.esc(p.client)}</span>`:''}
        <span class="tag tag-green">Faturado: ${U.money(st.invoiced)}</span>
        ${st.awaitingApproval?`<span class="tag tag-amber">Aguardando aprovação: ${U.money(st.awaitingApproval)}</span>`:''}</div>
      <div class="project-dates">
        <div><small>Data de início</small><b>${p.start?U.date(p.start):'Não informado'}</b></div>
        <div><small>Prazo contratual</small><b>${p.deadline?U.date(p.deadline):'Não informado'}</b></div>
        <div><small>Término previsto</small><b>${p.expectedEnd?U.date(p.expectedEnd):'Não informado'}</b></div>
      </div>
    </div>
    ${Dash.healthRing(st.health, st.light)}
  </div>`;
};

/* ---------- DRILL DOWN ---------- */
Dash.drill = function(filter){
  // filter: {category, supplier, month, projectId}
  filter = filter || {};
  let rows = State.purchases.slice();
  const crumbs = [];
  const projectId = filter.projectId || State.filters.project;
  if(projectId){ rows = rows.filter(x=>x.projectId===projectId); const p = State.projects.find(x=>x.id===projectId); crumbs.push('Projeto: '+U.projLabel(p)); }
  if(filter.category){ rows = rows.filter(x=>Biz.sameCategory(x.category,filter.category)); crumbs.push('Categoria: '+Biz.categoryName(filter.category)); }
  if(filter.supplier){ rows = rows.filter(x=>x.supplier===filter.supplier); crumbs.push('Fornecedor: '+filter.supplier); }
  if(filter.month){ rows = rows.filter(x=>(x.date||'').startsWith(filter.month)); crumbs.push('Mês: '+filter.month); }
  rows.sort((a,b)=>b.value-a.value);
  const total = rows.reduce((s,x)=>s+x.value,0);
  // agrupamento por fornecedor para o próximo nível do drill
  const bySup = {};
  rows.forEach(x=>{ const k=x.supplier||'(sem fornecedor)'; bySup[k]=(bySup[k]||0)+x.value; });
  UI.modal({ title:'Drill Down — Lançamentos', wide:true, body:`
    <div class="drill-path">${crumbs.map(c=>`<span class="crumb">${U.esc(c)}</span>`).join('<i data-lucide="chevron-right" style="width:13px;height:13px"></i>')}
      <span style="margin-left:auto"><b>${rows.length}</b> lançamentos · <b>${U.money2(total)}</b></span></div>
    ${!filter.supplier && Object.keys(bySup).length>1 ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${Object.entries(bySup).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([s,v])=>
        `<button class="btn btn-ghost btn-sm" onclick='Dash.drill(${U.esc(JSON.stringify({...filter, projectId, supplier:s}))})'>${U.esc(s.length>22?s.slice(0,21)+'…':s)} · ${U.money(v)}</button>`).join('')}</div>` : ''}
    <div class="table-wrap"><div class="table-scroll" style="max-height:420px"><table>
      <thead><tr><th>Data</th><th>Projeto</th><th>Fornecedor</th><th>Pedido/Nota</th><th>Descrição</th><th class="num">Valor</th></tr></thead>
      <tbody>${rows.slice(0,400).map(x=>{const p=State.projects.find(pr=>pr.id===x.projectId);return `
        <tr class="clickable" onclick="Dash.showPurchase('${x.id}')">
          <td>${U.date(x.date)}</td><td><b>${U.esc(p?p.proposal:'?')}</b></td><td>${U.esc(x.supplier||'—')}</td>
          <td>${U.esc(x.order||'—')}</td>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(x.desc||'—')}</td>
          <td class="num"><b>${U.money2(x.value)}</b></td></tr>`;}).join('')}</tbody></table></div></div>`,
    footer:`<button class="btn btn-primary" onclick="UI.close()">Fechar</button>` });
};

/* ---------- SIMULADOR ---------- */
Dash.simulator = function(projectId){
  const p = State.projects.find(x=>x.id===projectId); if(!p) return;
  const s = Biz.projectStats(p);
  const b = Biz.baseRates();
  UI.modal({ title:`Simulador Financeiro — ${U.esc(U.projLabel(p))}`, wide:true, body:`
    <div class="form-grid">
      <div><label>Valor de Venda</label><input id="sim-sale" type="number" value="${p.saleValue}"></div>
      <div><label>Custos Previstos (projeção, sem imposto/adm)</label><input id="sim-cost" type="number" value="${Math.round(s.projectedPurchases)}"></div>
      <div><label>Impostos (%)</label><input id="sim-tax" type="number" step="0.1" value="${b.tax}"></div>
      <div><label>Custo Administrativo (%)</label><input id="sim-admin" type="number" step="0.1" value="${b.admin}"></div>
      <div><label>Taxas (%)</label><input id="sim-fees" type="number" step="0.1" value="${b.fees}"></div>
      <div><label>Outros (%)</label><input id="sim-other" type="number" step="0.1" value="${b.other}"></div>
    </div>
    <div class="kpi-grid" style="margin-top:16px" id="sim-out"></div>
    <small style="color:var(--text3)">Simulação não altera dados salvos. Valores de referência atuais: lucro ${U.money(s.profit)}, margem ${U.pct(s.marginCurrent)}.</small>`,
    footer:`<button class="btn btn-primary" onclick="UI.close()">Fechar</button>`,
    onOpen(){
      const calc = () => {
        const sale = U.num(document.getElementById('sim-sale').value);
        const cost = U.num(document.getElementById('sim-cost').value);
        const rate = ['tax','admin','fees','other'].reduce((t,k)=>t+U.num(document.getElementById('sim-'+k).value),0);
        const overhead = sale*rate/100;
        const profit = sale - cost - overhead;
        const margin = sale>0 ? profit/sale*100 : null;
        const balance = s.budgetTotal - cost;
        const d = (v, ref) => { const diff = v-ref; return `<div class="k-sub" style="color:${diff>=0?'var(--green)':'var(--red)'}">${diff>=0?'▲':'▼'} ${U.money(Math.abs(diff))} vs atual</div>`; };
        document.getElementById('sim-out').innerHTML = `
          <div class="kpi ${profit<0?'accent-red':'accent-green'}"><div class="k-label">Lucro Simulado</div><div class="k-value">${U.money(profit)}</div>${d(profit, s.profit)}</div>
          <div class="kpi accent-blue"><div class="k-label">Margem Simulada</div><div class="k-value">${U.pct(margin)}</div></div>
          <div class="kpi ${balance<0?'accent-red':''}"><div class="k-label">Saldo vs Orçamento</div><div class="k-value">${U.money(balance)}</div></div>
          <div class="kpi"><div class="k-label">Encargos (${U.pct(rate,1)})</div><div class="k-value">${U.money(overhead)}</div></div>`;
      };
      ['sale','cost','tax','admin','fees','other'].forEach(k => document.getElementById('sim-'+k).oninput = calc);
      calc();
    }
  });
};
