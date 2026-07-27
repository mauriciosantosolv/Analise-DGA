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
      return {Projeto:p?U.projLabel(p):'', Origem:({labor:'Mão de obra',paidAccount:'Conta paga',purchase:'Compra'}[x.sourceType]||'Compra'), Pedido:x.order, Fornecedor:x.supplier, Categoria:x.category, Descricao:x.desc, Observacoes:x.notes, Valor:x.value, Data:x.date}; });
    if(store==='budgets') return State.budgets.map(b=>{ const p=State.projects.find(pr=>pr.id===b.projectId);
      return {Projeto:p?U.projLabel(p):'', Categoria:b.category, ValorOrcado:b.value}; });
    if(store==='projects') return State.projects.map(p=>{ const s=Biz.projectStats(p);
      return {Proposta:p.proposal, Nome:p.name, Cliente:p.client, Tipo:p.type, Status:p.status, ValorVenda:p.saleValue,
        Faturado:s.invoiced, AguardandoAprovacao:s.awaitingApproval, PercentFaturado:s.invoicedPct!=null?+s.invoicedPct.toFixed(1):null,
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
  projectPDF(projectId){
    const p = State.projects.find(x=>x.id===projectId); if(!p) return;
    const s = Biz.projectStats(p), cats = Biz.categoryStats([p]);
    const existing = document.getElementById('project-print-report');
    if(existing) existing.remove();
    const report = document.createElement('section');
    report.id = 'project-print-report';
    const healthLabel = {green:'Saudável',amber:'Atenção',red:'Crítica'}[s.light];
    const metric = (label, value, cls='') => `<div class="print-kpi ${cls}"><small>${label}</small><b>${value}</b></div>`;
    report.innerHTML = `
      <div class="print-head">
        <div><small>DASHBOARD DO PROJETO</small><h1>${U.esc(U.projLabel(p))}</h1><p>${U.esc(p.client||'Cliente não informado')} · ${U.esc(p.type||'Tipo não informado')} · ${U.esc(p.status||'Status não informado')}</p></div>
        <div class="print-health ${s.light}"><span>Saúde</span><b>${healthLabel}</b><small>Saldo ${U.money(s.balance)}</small></div>
      </div>
      <div class="print-dates">
        <div><small>Data de início</small><b>${p.start?U.date(p.start):'Não informado'}</b></div>
        <div><small>Prazo contratual</small><b>${p.deadline?U.date(p.deadline):'Não informado'}</b></div>
        <div><small>Término previsto</small><b>${p.expectedEnd?U.date(p.expectedEnd):'Não informado'}</b></div>
      </div>
      <div class="print-kpis">
        ${metric('Receita contratada',U.money(p.saleValue))}
        ${metric('Faturado',U.money(s.invoiced),'green')}
        ${metric('Aguardando aprovação',U.money(s.awaitingApproval),'amber')}
        ${metric('Orçado',U.money(s.budgetTotal))}
        ${metric('Realizado',U.money(s.spent))}
        ${metric('Projetado',U.money(s.projected))}
        ${metric('Saldo',U.money(s.balance),s.balance<0?'red':'green')}
        ${metric('Margem atual',U.pct(s.marginCurrent))}
      </div>
      <h2>Custos por categoria</h2>
      <table class="print-table"><thead><tr><th>Categoria</th><th>Orçado</th><th>Realizado</th><th>Projetado</th><th>Saldo</th><th>% comprometido</th></tr></thead>
        <tbody>${cats.map(c=>`<tr><td>${U.esc(c.name)}</td><td>${U.money(c.budget)}</td><td>${U.money(c.spent)}</td><td>${U.money(c.projected)}</td><td class="${c.balance<0?'negative':''}">${U.money(c.balance)}</td><td>${U.pct(c.committedPct)}</td></tr>`).join('') || '<tr><td colspan="6">Sem dados de categorias</td></tr>'}</tbody>
      </table>
      <div class="print-foot">Realizado inclui compras, contas pagas, mão de obra e custos da base de cálculo. Projetado contém somente o Planejamento. Gerado em ${new Date().toLocaleString('pt-BR')}.</div>`;
    document.body.appendChild(report);
    UI.close();
    UI.toast('Abrindo impressão — escolha "Salvar como PDF"', 'info');
    window.addEventListener('afterprint', () => report.remove(), {once:true});
    setTimeout(()=>window.print(), 250);
  },
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
