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
    const selectedProjects=State.selectedProjectIds();
    const catMap=new Map();
    [...State.categories.map(c=>c.name),...State.budgets.map(b=>b.category), ...State.purchases.map(x=>x.category), ...State.planning.map(x=>x.category)]
      .filter(Boolean).forEach(name=>{ const key=Biz.categoryKey(name); if(key && !catMap.has(key)) catMap.set(key,Biz.categoryName(name)); });
    Biz.categoryStats(State.projects).forEach(c=>{ if(!catMap.has(c.categoryKey)) catMap.set(c.categoryKey,c.name); });
    const cats=[...catMap.values()].sort((a,b)=>a.localeCompare(b));
    const opt = (v, sel, label) => `<option value="${U.esc(v)}" ${v===sel?'selected':''}>${U.esc(label??v)}</option>`;
    const projectLabel=!selectedProjects.length?'Todos os projetos':selectedProjects.length===1
      ? U.projLabel(State.projects.find(p=>String(p.id)===selectedProjects[0]))
      : `${selectedProjects.length} projetos selecionados`;
    const hasFilters=selectedProjects.length>0||[f.client,f.category,f.status,f.type].some(Boolean);
    return `<div class="filters-bar">
      <button class="filter-project-button" id="flt-projects-open" type="button" title="Selecionar um ou mais projetos"><i data-lucide="hard-hat"></i><span>${U.esc(projectLabel)}</span><i data-lucide="chevron-down"></i></button>
      <select id="flt-client" title="Cliente"><option value="">Todos os clientes</option>${[...new Set(State.projects.map(p=>p.client).filter(Boolean))].sort().map(c=>opt(c, f.client)).join('')}</select>
      <select id="flt-category" title="Categoria"><option value="">Todas as categorias</option>${cats.map(c=>`<option value="${U.esc(c)}" ${Biz.sameCategory(c,f.category)?'selected':''}>${U.esc(c)}</option>`).join('')}</select>
      <select id="flt-status" title="Status"><option value="">Todos os status</option>${['Em andamento','Concluído','Paralisado','A executar'].map(s=>opt(s, f.status)).join('')}</select>
      <select id="flt-type" title="Tipo"><option value="">Todos os tipos</option>${['HH','Obra','Fornecimento','Painel'].map(t=>opt(t, f.type)).join('')}</select>
      ${hasFilters?`<button class="btn btn-ghost btn-sm" onclick="App.clearFilters()"><i data-lucide="x"></i>Limpar</button>`:''}
    </div>`;
  },
  bindFilters(){
    const projectButton=document.getElementById('flt-projects-open');
    if(projectButton) projectButton.onclick=()=>this.projectFilterForm();
    [['flt-client','client'],['flt-category','category'],['flt-status','status'],['flt-type','type']]
      .forEach(([id,k]) => { const el = document.getElementById(id); if(el) el.onchange = () => { State.filters[k] = el.value; App.render(); }; });
  },
  projectFilterForm(){
    const selected=new Set(State.selectedProjectIds());
    UI.modal({title:'Filtrar projetos',wide:true,body:`
      <p style="font-size:.84rem;color:var(--text2);margin-bottom:12px">Selecione somente os projetos que deseja comparar no dashboard, gráficos, categorias e gastos futuros.</p>
      <div class="rdo-search project-filter-search"><i data-lucide="search"></i><input id="filter-project-search" type="search" autocomplete="off" spellcheck="false" placeholder="Buscar por número, nome ou cliente" aria-label="Buscar projeto"><button type="button" id="filter-project-search-clear" aria-label="Limpar busca" title="Limpar busca"><i data-lucide="x"></i></button></div>
      <div class="project-filter-actions"><button class="btn btn-ghost btn-sm" id="filter-project-all" type="button" title="Marca os projetos visíveis na lista">Selecionar todos</button><button class="btn btn-ghost btn-sm" id="filter-project-none" type="button" title="Desmarca os projetos visíveis na lista">Limpar seleção</button><span class="project-filter-count" id="filter-project-count"></span></div>
      <div class="check-list project-filter-list" id="filter-project-list">${State.projects.map(project=>`
        <label class="check-item" data-search="${U.esc(U.norm(`${project.proposal||''} ${project.name||''} ${project.client||''}`))}"><input type="checkbox" value="${U.esc(project.id)}" ${selected.has(String(project.id))?'checked':''}><span><b>${U.esc(project.proposal||project.name||'Projeto')}</b><small>${U.esc(project.name||project.client||'')}</small></span></label>`).join('')||'<small>Nenhum projeto cadastrado.</small>'}</div>
      <div class="project-filter-empty" id="filter-project-empty" hidden>Nenhum projeto encontrado.</div>`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="filter-project-apply"><i data-lucide="check"></i>Aplicar filtro</button>',
      onOpen:()=>{
        // v4.2.7 - busca dentro do filtro de projetos. Os botoes de marcar/limpar
        // passam a agir sobre o que esta visivel; sem busca ativa o resultado e
        // exatamente o de antes (todos os projetos ficam visiveis).
        // v4.2.8 - a busca passa a funcionar como a do RDO: o proprio item e o
        // alvo do clique (com estado visivel), o contador mostra o total
        // marcado inclusive o que a busca escondeu, Enter marca o unico
        // resultado e limpar a busca devolve a lista inteira sem perder nada do
        // que ja estava marcado. Nenhuma marcacao e feita automaticamente e o
        // filtro so vale depois de "Aplicar filtro", como antes.
        const searchInput=document.getElementById('filter-project-search');
        const emptyNote=document.getElementById('filter-project-empty');
        const counter=document.getElementById('filter-project-count');
        const list=document.getElementById('filter-project-list');
        const items=[...document.querySelectorAll('#filter-project-list .check-item')];
        const visibleInputs=()=>items.filter(item=>!item.hidden).map(item=>item.querySelector('input')).filter(Boolean);
        const paint=()=>{
          let marked=0,outside=0;
          items.forEach(item=>{
            const input=item.querySelector('input');
            const checked=!!(input&&input.checked);
            item.classList.toggle('selected',checked);
            if(checked){ marked++; if(item.hidden) outside++; }
          });
          if(counter) counter.textContent=marked
            ?`${marked} projeto(s) selecionado(s)${outside?` · ${outside} fora da busca`:''}`
            :'Nenhum projeto selecionado — o dashboard mostra todos.';
        };
        const applySearch=()=>{
          const query=U.norm(searchInput?searchInput.value:'');
          let visible=0;
          items.forEach(item=>{
            const matches=!query||String(item.dataset.search||'').includes(query);
            item.hidden=!matches;
            if(matches) visible++;
          });
          if(emptyNote) emptyNote.hidden=visible!==0||!items.length;
          const clear=document.getElementById('filter-project-search-clear');
          if(clear) clear.classList.toggle('visible',!!query);
          paint();
        };
        if(list) list.addEventListener('change',paint);
        if(searchInput){
          searchInput.oninput=applySearch;
          searchInput.onkeydown=event=>{
            if(event.key!=='Enter') return;
            event.preventDefault();
            const visible=items.filter(item=>!item.hidden);
            if(visible.length!==1) return;
            const input=visible[0].querySelector('input');
            if(input){ input.checked=!input.checked; paint(); }
          };
          const clear=document.getElementById('filter-project-search-clear');
          if(clear) clear.onclick=()=>{searchInput.value='';applySearch();searchInput.focus();};
          setTimeout(()=>searchInput.focus(),60);
        }
        document.getElementById('filter-project-all').onclick=()=>{visibleInputs().forEach(input=>input.checked=true);paint();};
        document.getElementById('filter-project-none').onclick=()=>{visibleInputs().forEach(input=>input.checked=false);paint();};
        paint();
        document.getElementById('filter-project-apply').onclick=()=>{
          const ids=[...document.querySelectorAll('#filter-project-list input:checked')].map(input=>String(input.value));
          State.filters.project=ids.length===1?ids[0]:'';
          State.filters.projects=ids.length>1?ids:[];
          if(Views.planejamento) Views.planejamento.projectFilter='';
          UI.close(); App.render({resetScroll:false});
        };
      }
    });
  }
};

/* Banner do projeto em análise — destaca a logo do cliente quando um projeto está filtrado */
Dash.projectBanner = function(){
  const ids=State.selectedProjectIds(); if(ids.length!==1) return '';
  const p = State.projects.find(x=>String(x.id)===ids[0]); if(!p) return '';
  const c = State.clients.find(x=>x.name===p.client);
  const logo = U.safeImageSrc((c && c.logo) || p.clientLogo || '');
  const st = Biz.projectStats(p, State.filters.category || '');
  return `<div class="card" style="display:flex;align-items:center;gap:20px;margin-bottom:16px;flex-wrap:wrap">
    ${logo ? `<img src="${U.esc(logo)}" class="logo-clean" style="width:84px;height:84px;object-fit:contain">`
           : `<span class="avatar-ph" style="width:84px;height:84px;font-size:1.6rem;border-radius:14px">${U.esc(U.initials(p.client||p.name||p.proposal))}</span>`}
    <div style="flex:1;min-width:220px">
      <small style="color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.07em">Projeto em análise</small>
      <h1 style="margin:2px 0 6px">${U.esc(U.projLabel(p))}</h1>
      <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
        ${statusTag(p.status)}<span class="tag tag-gray">${U.esc(p.type||'—')}</span>
        ${p.client?`<span class="tag tag-blue">${U.esc(p.client)}</span>`:''}
        <span class="tag tag-green">Faturado: ${U.money(st.invoiced)}</span>
        ${st.approved?`<span class="tag tag-blue">Aprovado: ${U.money(st.approved)}</span>`:''}
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
  else {
    const selected=State.selectedProjectIds();
    if(selected.length){
      const ids=new Set(selected);
      rows=rows.filter(x=>ids.has(String(x.projectId)));
      crumbs.push(`${selected.length} projetos selecionados`);
    }
  }
  if(filter.category){ rows = rows.filter(x=>Biz.sameCategory(x.category,filter.category)); crumbs.push('Categoria: '+Biz.categoryName(filter.category)); }
  if(filter.supplier){ rows = rows.filter(x=>x.supplier===filter.supplier); crumbs.push('Fornecedor: '+filter.supplier); }
  if(filter.month){ rows = rows.filter(x=>(x.date||'').startsWith(filter.month)); crumbs.push('Mês: '+filter.month); }
  // v4.2.6 — lançamentos sempre em ordem de data decrescente. O maior valor
  // continua desempatando quando a data é a mesma.
  rows.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||b.value-a.value);
  const purchaseTotal = rows.reduce((s,x)=>s+x.value,0);
  const overheadKeys=new Set(['impostos','custo administrativo','taxas','outros encargos']);
  const categoryKey=Biz.categoryKey(filter.category||'');
  let overheadRows=[];
  if(overheadKeys.has(categoryKey)&&!filter.supplier&&!filter.month){
    let projects=Biz.filteredProjects();
    if(projectId) projects=projects.filter(project=>String(project.id)===String(projectId));
    overheadRows=projects.map(project=>{
      const rate=Biz.baseRateForCategory(filter.category,project);
      const base=Number(project.saleValue)||0;
      return {project,rate,base,value:base*rate/100};
    }).filter(item=>item.rate>0&&item.base>0);
  }
  const overheadTotal=overheadRows.reduce((sum,item)=>sum+item.value,0);
  const total = purchaseTotal+overheadTotal;
  // agrupamento por fornecedor para o próximo nível do drill
  const bySup = {};
  rows.forEach(x=>{ const k=x.supplier||'(sem fornecedor)'; bySup[k]=(bySup[k]||0)+x.value; });
  UI.modal({ title:'Drill Down — Lançamentos', wide:true, body:`
    <div class="drill-path">${crumbs.map(c=>`<span class="crumb">${U.esc(c)}</span>`).join('<i data-lucide="chevron-right" style="width:13px;height:13px"></i>')}
      <span style="margin-left:auto"><b>${rows.length}</b> lançamentos${overheadRows.length?` + <b>${overheadRows.length}</b> cálculo(s)`:''} · <b>${U.money2(total)}</b></span></div>
    ${overheadRows.length?`<section class="card" style="margin-bottom:14px;padding:14px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px"><div><b>Composição calculada pela base de incidência</b><small style="display:block;margin-top:3px;color:var(--text3)">Percentual aplicado sobre a receita contratada de cada projeto.</small></div><b>${U.money2(overheadTotal)}</b></div>
      <div class="table-wrap"><table><thead><tr><th>Projeto</th><th class="num">Base de incidência</th><th class="num">Percentual</th><th class="num">Valor calculado</th></tr></thead><tbody>
        ${overheadRows.map(item=>`<tr><td><b>${U.esc(U.projLabel(item.project))}</b></td><td class="num">${U.money2(item.base)}</td><td class="num"><b>${U.pct(item.rate,2)}</b></td><td class="num"><b>${U.money2(item.value)}</b></td></tr>`).join('')}
      </tbody></table></div>
    </section>`:''}
    ${!filter.supplier && Object.keys(bySup).length>1 ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${Object.entries(bySup).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([s,v])=>
        `<button class="btn btn-ghost btn-sm" onclick='Dash.drill(${U.esc(JSON.stringify({...filter, projectId, supplier:s}))})'>${U.esc(s.length>22?s.slice(0,21)+'…':s)} · ${U.money(v)}</button>`).join('')}</div>` : ''}
    <div class="table-wrap"><div class="table-scroll" style="max-height:420px"><table>
      <thead><tr><th>Data</th><th>Projeto</th><th>Fornecedor</th><th>Pedido/Nota</th><th>Descrição</th><th class="num">Valor</th></tr></thead>
      <tbody>${rows.slice(0,400).map(x=>{const p=State.projects.find(pr=>pr.id===x.projectId);return `
        <tr class="clickable" onclick="Dash.showPurchase(${U.jsArg(x.id)})">
          <td>${U.date(x.date)}</td><td><b>${U.esc(p?p.proposal:'?')}</b></td><td>${U.esc(x.supplier||'—')}</td>
          <td>${U.esc(x.order||'—')}</td>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(x.desc||'—')}</td>
          <td class="num"><b>${U.money2(x.value)}</b></td></tr>`;}).join('')||'<tr><td colspan="6" class="empty-state">Nenhum lançamento manual nesta categoria. O valor acima é calculado pela base de incidência.</td></tr>'}</tbody></table></div></div>`,
    footer:`<button class="btn btn-primary" onclick="UI.close()">Fechar</button>` });
};

/* ---------- SIMULADOR ---------- */
Dash.simulator = function(projectId){
  const p = State.projects.find(x=>x.id===projectId); if(!p) return;
  const s = Biz.projectStats(p);
  const b = Biz.baseRates();
  UI.modal({ title:`Simulador Financeiro — ${U.esc(U.projLabel(p))}`, wide:true, body:`
    <div class="form-grid">
      <div><label>Valor de Venda</label><input id="sim-sale" type="number" value="${U.esc(p.saleValue)}"></div>
      <div><label>Custos Previstos (projeção, sem imposto/adm)</label><input id="sim-cost" type="number" value="${Math.round(s.projectedPurchases)}"></div>
      <div><label>Impostos (%)</label><input id="sim-tax" type="number" step="0.1" value="${U.esc(b.tax)}"></div>
      <div><label>Custo Administrativo (%)</label><input id="sim-admin" type="number" step="0.1" value="${U.esc(b.admin)}"></div>
      <div><label>Taxas (%)</label><input id="sim-fees" type="number" step="0.1" value="${U.esc(b.fees)}"></div>
      <div><label>Outros (%)</label><input id="sim-other" type="number" step="0.1" value="${U.esc(b.other)}"></div>
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
          <div class="kpi ${balance<0?'accent-red':''}"><div class="k-label">Saldo Orçado</div><div class="k-value">${U.money(balance)}</div></div>
          <div class="kpi"><div class="k-label">Encargos (${U.pct(rate,1)})</div><div class="k-value">${U.money(overhead)}</div></div>`;
      };
      ['sale','cost','tax','admin','fees','other'].forEach(k => document.getElementById('sim-'+k).oninput = calc);
      calc();
    }
  });
};
