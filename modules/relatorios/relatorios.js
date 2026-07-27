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
          <span style="width:38px;height:38px;border-radius:10px;background:var(--green-soft);color:var(--green);display:flex;align-items:center;justify-content:center"><i data-lucide="printer"></i></span>
          <h3>Dashboard em PDF</h3></div>
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:13px">Imprime a visão atual do dashboard (use os filtros antes de exportar).</p>
          <button class="btn btn-primary btn-sm" onclick="App.go('dashboard');setTimeout(()=>Exports.toPDF(),600)"><i data-lucide="file-down"></i>Gerar PDF</button></div>
      </div>`;
    U.icons();
  }
};
