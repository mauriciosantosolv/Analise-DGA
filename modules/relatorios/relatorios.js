/**
 * Módulo Relatórios (relatorios.js)
 *
 * Responsabilidades:
 * - tela de relatórios e geração de arquivos (via utils/export.js)
 *
 * Dependências:
 * - utils/export.js (Exports)
 * - custos (Biz)
 * - database
 * - utils
 *
 * Não modificar:
 * - custos
 * - compras
 */

Views.relatorios = {
  title:'Relatórios',
  render(){
    $c().innerHTML = `
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
        ${[['projects','Relatório de Projetos','Indicadores completos por obra: orçado, realizado, projeção, margem e saúde.','hard-hat'],
           ['purchases','Relatório Financeiro','Todos os lançamentos de compras com fornecedor, categoria e datas.','wallet'],
           ['budgets','Relatório de Orçamentos','Orçado por projeto e categoria com pesos percentuais.','calculator']]
          .map(([store,title,desc,icon])=>`
          <div class="card"><div style="display:flex;gap:11px;align-items:center;margin-bottom:9px">
            <span style="width:38px;height:38px;border-radius:10px;background:var(--blue-soft);color:var(--blue);display:flex;align-items:center;justify-content:center"><i data-lucide="${icon}"></i></span>
            <h3>${title}</h3></div>
            <p style="font-size:.84rem;color:var(--text2);margin-bottom:13px">${desc}</p>
            <button class="btn btn-primary btn-sm" onclick="Exports.table('${store}')"><i data-lucide="download"></i>Exportar</button></div>`).join('')}

        <div class="card"><div style="display:flex;gap:11px;align-items:center;margin-bottom:9px">
          <span style="width:38px;height:38px;border-radius:10px;background:var(--red-soft);color:var(--red);display:flex;align-items:center;justify-content:center"><i data-lucide="triangle-alert"></i></span>
          <h3>Desvios Negativos</h3></div>
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:13px">Gera uma análise somente das categorias cujo saldo está negativo nos projetos selecionados.</p>
          <button class="btn btn-primary btn-sm" onclick="Views.relatorios.negativeDeviationForm()"><i data-lucide="filter"></i>Selecionar projetos</button></div>
        <div class="card"><div style="display:flex;gap:11px;align-items:center;margin-bottom:9px">
          <span style="width:38px;height:38px;border-radius:10px;background:var(--green-soft);color:var(--green);display:flex;align-items:center;justify-content:center"><i data-lucide="printer"></i></span>
          <h3>Dashboard em PDF</h3></div>
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:13px">Imprime a visão atual do dashboard (use os filtros antes de exportar).</p>
          <button class="btn btn-primary btn-sm" onclick="App.go('dashboard');setTimeout(()=>Exports.toPDF(),600)"><i data-lucide="file-down"></i>Gerar PDF</button></div>
      </div>`;
    U.icons();
  },
  negativeDeviationForm(){
    const projects = State.projects.filter(p=>p.status!=='Cancelado');
    UI.modal({title:'Relatório de Desvios Negativos', wide:true, body:`
      <p style="color:var(--text2);margin-bottom:12px">Selecione os projetos que serão analisados. O arquivo mostrará apenas categorias com saldo inferior a zero.</p>
      <div style="display:flex;gap:8px;margin-bottom:10px"><button class="btn btn-ghost btn-sm" onclick="document.querySelectorAll('.neg-proj').forEach(x=>x.checked=true)">Marcar todos</button><button class="btn btn-ghost btn-sm" onclick="document.querySelectorAll('.neg-proj').forEach(x=>x.checked=false)">Limpar</button></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;max-height:420px;overflow:auto">${projects.map(p=>`<label class="card" style="padding:10px;display:flex;align-items:center;gap:9px;cursor:pointer"><input class="neg-proj" type="checkbox" value="${p.id}" ${State.filters.project===p.id?'checked':''}><span><b>${U.esc(p.proposal||'Projeto')}</b><small style="display:block;color:var(--text3)">${U.esc(p.name||'')}</small></span></label>`).join('')}</div>`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" onclick="Views.relatorios.exportNegativeDeviations()"><i data-lucide="download"></i>Exportar análise</button>`});
  },
  exportNegativeDeviations(){
    const ids = [...document.querySelectorAll('.neg-proj:checked')].map(x=>x.value);
    if(!ids.length) return UI.toast('Selecione pelo menos um projeto', 'warn');
    const rows=[];
    ids.forEach(id=>{
      const p=State.projects.find(x=>x.id===id); if(!p) return;
      Biz.categoryStats([p]).filter(c=>c.balance<0).forEach(c=>rows.push({
        Projeto:p.proposal||'', Nome:p.name||'', Categoria:c.name,
        'Orçado':c.budget, 'Realizado':c.spent, 'Projetado':c.projected,
        'Comprometido':c.committed, 'Desvio Negativo':c.balance,
        '% Comprometido':c.committedPct
      }));
    });
    if(!rows.length) return UI.toast('Os projetos selecionados não possuem desvios negativos', 'success', 5000);
    const ws=XLSX.utils.json_to_sheet(rows);
    ws['!cols']=[{wch:12},{wch:30},{wch:28},{wch:16},{wch:16},{wch:16},{wch:16},{wch:18},{wch:18}];
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Desvios Negativos');
    XLSX.writeFile(wb,`desvios-negativos-${U.isoDate(new Date())}.xlsx`);
    UI.close(); UI.toast(`${rows.length} desvio(s) negativo(s) exportado(s)`, 'success');
  }
};
