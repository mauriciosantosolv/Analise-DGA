/**
 * Utilitários de Exportação (export.js)
 *
 * Responsabilidades:
 * - exportações XLSX, CSV, JSON, PDF (impressão) e imagem
 * - extração de dados de tabelas renderizadas
 *
 * Dependências:
 * - utils/format.js
 * - utils/helpers.js
 * - vendor XLSX
 *
 * Não modificar:
 * - classes CSS .num/.table-scroll usadas na extração
 */

/* ---------- RELATÓRIOS / EXPORTAÇÕES ---------- */
const Exports = {
  rows(store){
    if(store==='purchases') return State.purchases.map(x=>{ const p=State.projects.find(pr=>pr.id===x.projectId);
      return {Projeto:p?U.projLabel(p):'', Pedido:x.order, Fornecedor:x.supplier, Categoria:x.category, Descricao:x.desc, Observacoes:x.notes, Valor:x.value, Data:x.date}; });
    if(store==='budgets') return State.budgets.map(b=>{ const p=State.projects.find(pr=>pr.id===b.projectId);
      return {Projeto:p?U.projLabel(p):'', Categoria:b.category, ValorOrcado:b.value}; });
    if(store==='projects') return State.projects.map(p=>{ const s=Biz.projectStats(p);
      return {Proposta:p.proposal, Nome:p.name, Cliente:p.client, Tipo:p.type, Status:p.status, ValorVenda:p.saleValue,
        Medido:s.measured, PercentMedido:s.measuredPct!=null?+s.measuredPct.toFixed(1):null,
        Orcado:s.budgetTotal, Realizado:s.spent, Projecao:Math.round(s.projected), Saldo:s.balance,
        MargemAtual:s.marginCurrent!=null?+s.marginCurrent.toFixed(1):null, Saude:s.health}; });
    return [];
  },
  toXLSX(store){
    const ws = XLSX.utils.json_to_sheet(this.rows(store));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, store);
    XLSX.writeFile(wb, `${store}-${U.isoDate(new Date())}.xlsx`);
    UI.toast('Excel exportado', 'success');
  },
  toCSV(store){
    const ws = XLSX.utils.json_to_sheet(this.rows(store));
    U.download(`${store}-${U.isoDate(new Date())}.csv`, XLSX.utils.sheet_to_csv(ws), 'text/csv');
    UI.toast('CSV exportado', 'success');
  },
  toJSON(store){
    U.download(`${store}-${U.isoDate(new Date())}.json`, JSON.stringify(this.rows(store), null, 1), 'application/json');
    UI.toast('JSON exportado', 'success');
  },
  toPDF(){ UI.toast('Abrindo impressão — escolha "Salvar como PDF"', 'info'); setTimeout(()=>window.print(), 400); },
  toImage(){
    const canvases = document.querySelectorAll('#content canvas');
    if(!canvases.length) return UI.toast('Abra o Dashboard para exportar gráficos', 'warn');
    canvases.forEach((cv,i)=>{ const a = document.createElement('a'); a.download = `grafico-${i+1}.png`; a.href = cv.toDataURL('image/png'); a.click(); });
    UI.toast(`${canvases.length} gráfico(s) exportado(s) como imagem`, 'success');
  },
  table(store){
    UI.modal({ title:'Exportar Dados', body:`
      <p style="margin-bottom:14px;color:var(--text2)">Escolha o formato de exportação:</p>
      <div style="display:flex;gap:9px;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="Exports.toXLSX('${store}');UI.close()"><i data-lucide="file-spreadsheet"></i>Excel</button>
        <button class="btn btn-ghost" onclick="Exports.toCSV('${store}');UI.close()"><i data-lucide="file-text"></i>CSV</button>
        <button class="btn btn-ghost" onclick="Exports.toJSON('${store}');UI.close()"><i data-lucide="file-json"></i>JSON</button>
        <button class="btn btn-ghost" onclick="Exports.toPDF();UI.close()"><i data-lucide="file-down"></i>PDF</button>
        <button class="btn btn-ghost" onclick="Exports.toImage();UI.close()"><i data-lucide="image"></i>Imagem</button>
      </div>`, footer:`<button class="btn btn-primary" onclick="UI.close()">Fechar</button>` });
  }
};
