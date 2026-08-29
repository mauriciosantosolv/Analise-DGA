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
  stationeryMarkup(){
    const source=U.safeImageSrc(State.settings.pdfLetterhead||'');
    return source?`<div class="pdf-letterhead" aria-hidden="true"><img src="${U.esc(source)}" alt=""></div>`:'';
  },
  mountStationery(){
    const source=U.safeImageSrc(State.settings.pdfLetterhead||'');
    const old=document.getElementById('pdf-letterhead-overlay');
    if(old) old.remove();
    if(!source) return null;
    const layer=document.createElement('div');
    layer.id='pdf-letterhead-overlay';
    layer.className='pdf-letterhead';
    layer.setAttribute('aria-hidden','true');
    layer.innerHTML=`<img src="${U.esc(source)}" alt="">`;
    document.body.appendChild(layer);
    return layer;
  },
  mountCompanyMeta(){
    const host=document.getElementById('content');
    if(!host) return null;
    const old=document.getElementById('pdf-company-meta');
    if(old) old.remove();
    const cnpj=U.formatCnpj(State.settings.companyCnpj||'');
    const meta=document.createElement('div');
    meta.id='pdf-company-meta';
    meta.className='pdf-company-meta';
    meta.textContent=`${State.settings.companyName||'CliqueObras'}${cnpj?` · CNPJ ${cnpj}`:''}`;
    host.prepend(meta);
    return meta;
  },
  waitForImages(root,timeout=1800){
    const images=[...(root||document).querySelectorAll('img')];
    return Promise.race([
      Promise.all(images.map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.onload=resolve;image.onerror=resolve;}))),
      new Promise(resolve=>setTimeout(resolve,timeout))
    ]);
  },
  /* ---------- v4.2.8 - pipeline unico de impressao ----------
     Todo PDF do sistema (dashboard, projeto, RDO, medicao e provisoes) passa
     por aqui. O conteudo de cada relatorio continua sendo montado pelo modulo
     dono; o que muda e so QUANDO se imprime e QUANDO se limpa.

     Causa do bug corrigido: a limpeza era registrada em `afterprint` antes de
     `window.print()`. O `afterprint` nao e confiavel para isso -- o Chrome nao
     dispara quando a pre-visualizacao e descartada de certas formas (a classe
     printing-* e o relatorio ficam presos no documento) e dispara CEDO quando
     uma nova impressao substitui uma pre-visualizacao ainda aberta. Nesse
     segundo caso a classe printing-rdo era removida no exato instante em que o
     navegador tirava o retrato da pagina, e o PDF saia com a TELA no lugar do
     documento. Na segunda tentativa nao havia mais pre-visualizacao pendente e
     o PDF saia certo.

     O que este pipeline garante:
     1. beginPrint() encerra qualquer impressao anterior que ficou pela metade;
     2. so a classe e o relatorio desta impressao ficam no documento;
     3. a limpeza so e armada depois que o navegador entra de fato em modo de
        impressao (beforeprint / matchMedia('print')), entao um afterprint
        precoce nao apaga mais nada;
     4. dois cliques no botao cancelam o window.print() pendente do primeiro em
        vez de imprimir um relatorio que o segundo ja removeu. */
  printModes:['printing-dashboard','printing-project','printing-rdo','printing-measurement','printing-provisions','printing-provisions-month'],
  printReportIds:['project-print-report','rdo-print-report','measurement-print-report','provisions-print-report','provisions-month-print-report'],
  activePrint:null,
  clearPrintState(keepId){
    this.printModes.forEach(name=>document.body.classList.remove(name));
    this.printReportIds.forEach(id=>{
      if(id===keepId) return;
      const node=document.getElementById(id);
      if(node) node.remove();
    });
  },
  finishPrint(keepId){
    const current=this.activePrint;
    this.activePrint=null;
    if(current){
      if(current.timer) clearTimeout(current.timer);
      if(current.fallback) clearTimeout(current.fallback);
      window.removeEventListener('beforeprint',current.onBefore);
      window.removeEventListener('afterprint',current.onAfter);
      if(current.media&&current.onMedia){
        if(current.media.removeEventListener) current.media.removeEventListener('change',current.onMedia);
        else if(current.media.removeListener) current.media.removeListener(current.onMedia);
      }
    }
    this.clearPrintState(keepId);
    if(current&&typeof current.cleanup==='function'){ try{ current.cleanup(); }catch(err){} }
  },
  printToken:0,
  async beginPrint(mode,report,cleanup){
    // Token: se um segundo pedido de impressao comecar enquanto este ainda
    // espera as imagens, este aqui desiste em vez de disparar um window.print()
    // sobre um relatorio que o segundo pedido ja substituiu.
    const token=this.printToken=(this.printToken||0)+1;
    this.finishPrint(report?report.id:undefined);
    document.body.classList.add(mode);
    await this.waitForImages(report||document.body);
    // Dois quadros: o layout de impressao ja esta calculado quando o navegador
    // tira o retrato da pagina.
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(this.printToken!==token) return;
    if(!document.body.classList.contains(mode)) document.body.classList.add(mode);
    const state={mode,report,cleanup,started:false,timer:null,fallback:null,media:null};
    const done=()=>{ if(this.activePrint===state && state.started) this.finishPrint(); };
    state.onBefore=()=>{ state.started=true; };
    state.onAfter=()=>{ if(state.started) done(); else state.started=true; };
    state.media=typeof window.matchMedia==='function'?window.matchMedia('print'):null;
    state.onMedia=event=>{ if(event&&event.matches) state.started=true; else done(); };
    window.addEventListener('beforeprint',state.onBefore);
    window.addEventListener('afterprint',state.onAfter);
    if(state.media){
      if(state.media.addEventListener) state.media.addEventListener('change',state.onMedia);
      else if(state.media.addListener) state.media.addListener(state.onMedia);
    }
    // Rede de seguranca: ninguem fica 5 minutos no dialogo de impressao. Sem
    // isso, um afterprint que nunca chega deixaria a classe presa e um Ctrl+P
    // do usuario sairia com o relatorio antigo.
    state.fallback=setTimeout(()=>{state.started=true;done();},300000);
    this.activePrint=state;
    state.timer=setTimeout(()=>{state.timer=null;window.print();},120);
  },
  spreadsheetCell(value){
    if(typeof value !== 'string') return value;
    // Evita que Excel/LibreOffice interpretem dados importados como fórmulas.
    return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
  },
  spreadsheetRows(rows){
    return rows.map(row => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, this.spreadsheetCell(value)])
    ));
  },
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
    const ws = XLSX.utils.json_to_sheet(this.spreadsheetRows(this.rows(store)));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, store);
    XLSX.writeFile(wb, `${store}-${U.isoDate(new Date())}.xlsx`);
    UI.toast('Excel exportado', 'success');
  },
  toCSV(store){
    const ws = XLSX.utils.json_to_sheet(this.spreadsheetRows(this.rows(store)));
    U.download(`${store}-${U.isoDate(new Date())}.csv`, XLSX.utils.sheet_to_csv(ws), 'text/csv');
    UI.toast('CSV exportado', 'success');
  },
  toJSON(store){
    U.download(`${store}-${U.isoDate(new Date())}.json`, JSON.stringify(this.rows(store), null, 1), 'application/json');
    UI.toast('JSON exportado', 'success');
  },
  async toPDF(){
    if(State.filters.project) return this.projectPDF(State.filters.project);
    document.body.classList.remove('printing-project');
    document.body.classList.add('printing-dashboard');
    const stationery=this.mountStationery();
    const companyMeta=this.mountCompanyMeta();
    const cleanup = () => {if(stationery) stationery.remove();if(companyMeta) companyMeta.remove();};
    UI.toast('Abrindo impressão — escolha "Salvar como PDF"', 'info');
    await this.beginPrint('printing-dashboard', null, cleanup);
  },
  async projectPDF(projectId){
    const p = State.projects.find(x=>String(x.id)===String(projectId)); if(!p) return;
    const s = Biz.projectStats(p), cats = Biz.categoryStats([p]);
    const client=State.clients.find(item=>U.norm(item.name)===U.norm(p.client))||null;
    const clientLogo=U.safeImageSrc((client&&client.logo)||p.clientLogo||'');
    const existing = document.getElementById('project-print-report');
    if(existing) existing.remove();
    const report = document.createElement('section');
    report.id = 'project-print-report';
    const healthLabel = {green:'Saudável',amber:'Atenção',red:'Crítica'}[s.light];
    const companyCnpj=U.formatCnpj(State.settings.companyCnpj||'');
    const metric = (label, value, cls='') => `<div class="print-kpi ${cls}"><small>${label}</small><b>${value}</b></div>`;
    report.innerHTML = `${this.stationeryMarkup()}
      <div class="print-head">
        <div class="print-project-identity">
          ${clientLogo?`<img src="${U.esc(clientLogo)}" alt="">`:`<span>${U.esc(U.initials(p.client||p.name||p.proposal))}</span>`}
          <div><small>DASHBOARD DO PROJETO</small><h1>${U.esc(U.projLabel(p))}</h1><p>${U.esc(p.client||'Cliente não informado')} · ${U.esc(p.type||'Tipo não informado')} · ${U.esc(p.status||'Status não informado')}</p></div>
        </div>
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
      <section class="print-justification">
        <div><small>JUSTIFICATIVA DO DESVIO</small>${p.deviationJustifiedAt?`<span>Atualizada em ${U.date(p.deviationJustifiedAt)}${p.deviationJustifiedBy?` por ${U.esc(p.deviationJustifiedBy)}`:''}</span>`:''}</div>
        <p>${U.esc(p.deviationJustification||'Nenhuma justificativa de desvio foi registrada para este projeto.')}</p>
      </section>
      <h2>Custos por categoria</h2>
      <table class="print-table"><thead><tr><th>Categoria</th><th>Orçado</th><th>Realizado</th><th>Projetado</th><th>Saldo</th><th>% comprometido</th></tr></thead>
        <tbody>${cats.map(c=>`<tr><td>${U.esc(c.name)}</td><td>${U.money(c.budget)}</td><td>${U.money(c.spent)}</td><td>${U.money(c.projected)}</td><td class="${c.balance<0?'negative':''}">${U.money(c.balance)}</td><td>${U.pct(c.committedPct)}</td></tr>`).join('') || '<tr><td colspan="6">Sem dados de categorias</td></tr>'}</tbody>
      </table>
      <div class="print-foot"><b>${U.esc(State.settings.companyName||'CliqueObras')}${companyCnpj?` · CNPJ ${U.esc(companyCnpj)}`:''}</b><br>Realizado inclui compras, contas pagas, mão de obra e custos da base de cálculo. Projetado contém somente o Planejamento. Gerado em ${new Date().toLocaleString('pt-BR')}.</div>`;
    document.body.appendChild(report);
    UI.close();
    UI.toast('Abrindo impressão — escolha "Salvar como PDF"', 'info');
    await this.beginPrint('printing-project', report);
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
