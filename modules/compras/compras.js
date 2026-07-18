/**
 * Módulo Compras / Financeiro
 *
 * Responsabilidades:
 * - tela financeiro: lançamentos, filtros, tabela, lotes
 * - CRUD de lançamentos (Dash.showPurchase/purchaseForm/removePurchase)
 *
 * Dependências:
 * - router (Views)
 * - custos (Biz)
 * - database
 * - utils
 *
 * Não modificar:
 * - custos
 * - compras (exceto no próprio módulo compras)
 */

/* ---------- FINANCEIRO ---------- */
Views.financeiro = {
  title:'Financeiro',
  page:0, mode:'table',
  render(){
    $c().innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" onclick="Importer.pick('purchase')"><i data-lucide="upload"></i>Importar Modelo Compras</button>
        <button class="btn btn-ghost" onclick="Dash.purchaseForm()"><i data-lucide="plus"></i>Novo Lançamento</button>
        <div class="tabs">
          <button class="tab ${this.mode==='table'?'active':''}" onclick="Views.financeiro.mode='table';Views.financeiro.render()">Lançamentos</button>
          <button class="tab ${this.mode==='blocks'?'active':''}" onclick="Views.financeiro.mode='blocks';Views.financeiro.render()">Importações</button>
        </div>
        ${this.mode==='table'?searchBox('fin-search','Pesquisar lançamentos…'):''}
        <div class="spacer"></div>
        <button class="btn btn-ghost" onclick="Exports.table('purchases')"><i data-lucide="download"></i>Exportar</button>
      </div>
      <div class="drop-zone" id="dz-purchase" style="margin-bottom:16px"><i data-lucide="file-spreadsheet"></i><br><b>Arraste a planilha de compras aqui</b><br><small>Novos uploads somam ao banco — duplicatas exatas são ignoradas automaticamente</small></div>
      <div id="fin-body"></div>`;
    if(this.mode==='table'){
      document.getElementById('fin-body').innerHTML = `<div class="table-wrap"><div class="table-scroll"><table id="fin-table"></table></div></div>
        <div class="toolbar" style="margin-top:10px"><div class="spacer"></div><div id="fin-pager"></div></div>`;
      this.table('');
      bindSearch('fin-search', q => { this.page = 0; this.table(q); });
    } else this.blocks();
    App.bindDropZone('dz-purchase', 'purchase');
    U.icons();
  },
  // Agrupa lançamentos por bloco de importação (arquivo + dia da importação)
  batches(){
    const map = {};
    State.purchases.forEach(x => {
      const key = (x.file||'(manual)') + '|' + (x.importedAt ? U.isoDate(new Date(x.importedAt)) : 's/d');
      (map[key] = map[key] || {file:x.file||'(manual)', date:x.importedAt, items:[]}).items.push(x);
    });
    return Object.entries(map).map(([key,b]) => ({key, ...b, total:b.items.reduce((s,x)=>s+x.value,0)}))
      .sort((a,b)=>(b.date||0)-(a.date||0));
  },
  blocks(){
    const bs = this.batches();
    document.getElementById('fin-body').innerHTML = bs.length ? bs.map(b=>`
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="width:38px;height:38px;border-radius:10px;background:var(--blue-soft);color:var(--blue);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i data-lucide="file-spreadsheet"></i></span>
          <div style="flex:1;min-width:180px"><b>${U.esc(b.file)}</b><br><small style="color:var(--text3)">Importado em ${U.date(b.date)} · ${b.items.length} lançamento(s)</small></div>
          <b>${U.money2(b.total)}</b>
          <button class="btn btn-ghost btn-sm" onclick="Views.financeiro.viewBatch('${encodeURIComponent(b.key)}')"><i data-lucide="eye"></i>Ver / Editar</button>
          <button class="btn btn-danger btn-sm" onclick="Views.financeiro.removeBatch('${encodeURIComponent(b.key)}')"><i data-lucide="trash-2"></i>Excluir bloco</button>
        </div></div>`).join('')
      : `<div class="empty card"><i data-lucide="layers"></i><br>Nenhuma importação registrada ainda.</div>`;
    U.icons();
  },
  viewBatch(key){
    key = decodeURIComponent(key);
    const b = this.batches().find(x=>x.key===key); if(!b) return;
    UI.modal({ title:`Importação — ${U.esc(b.file)}`, wide:true, body:`
      <p style="color:var(--text2);font-size:.85rem;margin-bottom:12px">${b.items.length} lançamento(s) · total ${U.money2(b.total)} · clique no lápis para editar qualquer lançamento deste bloco.</p>
      <div class="table-wrap"><div class="table-scroll" style="max-height:58vh"><table>
        <thead><tr><th>Data</th><th>Projeto</th><th>Categoria</th><th>Fornecedor</th><th>Descrição</th><th class="num">Valor</th><th style="width:50px"></th></tr></thead>
        <tbody>${b.items.sort((a,c)=>(c.date||'').localeCompare(a.date||'')).map(x=>{const p=State.projects.find(pr=>pr.id===x.projectId);return `
          <tr><td>${U.date(x.date)}</td><td><b>${U.esc(p?p.proposal:'?')}</b></td>
          <td><span class="tag tag-gray">${U.esc(x.category)}</span></td><td>${U.esc(x.supplier||'—')}</td>
          <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${U.esc(x.desc)}">${U.esc(x.desc||'—')}</td>
          <td class="num"><b>${U.money2(x.value)}</b></td>
          <td><button class="btn btn-ghost btn-sm" onclick="Dash.purchaseForm('${x.id}')"><i data-lucide="pencil"></i></button></td></tr>`;}).join('')}</tbody>
      </table></div></div>`,
      footer:`<button class="btn btn-primary" onclick="UI.close()">Fechar</button>` });
  },
  removeBatch(key){
    key = decodeURIComponent(key);
    const b = this.batches().find(x=>x.key===key); if(!b) return;
    UI.confirm(`Excluir o bloco <b>${U.esc(b.file)}</b> com <b>${b.items.length}</b> lançamento(s) (${U.money2(b.total)})? Esta ação não pode ser desfeita.`, async () => {
      UI.loading(true, 'Excluindo bloco…');
      for(const x of b.items) await DB.del('purchases', x.id);
      await State.reload();
      UI.loading(false); UI.toast('Bloco de importação excluído', 'warn'); App.render();
    });
  },
  table(q){
    this.q = q ?? this.q ?? '';
    const n = U.norm(this.q);
    const rows = Biz.filteredPurchases()
      .filter(x => { const p = State.projects.find(pr=>pr.id===x.projectId);
        return !n || U.norm(`${p?p.proposal+' '+p.name:''} ${x.supplier} ${x.category} ${x.desc} ${x.order}`).includes(n); })
      .sort((a,b) => (b.date||'').localeCompare(a.date||''));
    const PS = 100, pages = Math.max(1, Math.ceil(rows.length/PS));
    this.page = Math.min(this.page, pages-1);
    const slice = rows.slice(this.page*PS, this.page*PS+PS);
    const total = rows.reduce((s,x)=>s+x.value,0);
    document.getElementById('fin-table').innerHTML = `
      <thead><tr><th>Data</th><th>Projeto</th><th>Categoria</th><th>Fornecedor</th><th>Descrição</th><th>Pedido</th><th class="num">Valor</th><th style="width:50px"></th></tr></thead>
      <tbody>${slice.map(x => { const p = State.projects.find(pr=>pr.id===x.projectId); return `
        <tr class="clickable" onclick="Dash.showPurchase('${x.id}')">
          <td>${U.date(x.date)}</td><td><b>${U.esc(p?p.proposal:'?')}</b></td>
          <td><span class="tag tag-gray">${U.esc(x.category)}</span></td>
          <td>${U.esc(x.supplier||'—')}</td><td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${U.esc(x.desc)}">${U.esc(x.desc||'—')}</td>
          <td>${U.esc(x.order||'—')}</td><td class="num"><b>${U.money2(x.value)}</b></td>
          <td onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" onclick="Dash.purchaseForm('${x.id}')"><i data-lucide="pencil"></i></button></td></tr>`;}).join('')
        || `<tr><td colspan="8"><div class="empty"><i data-lucide="wallet"></i><br>Nenhum lançamento encontrado.</div></td></tr>`}
      ${rows.length?`<tr><td colspan="7" style="text-align:right"><b>Total (${rows.length} lançamentos)</b></td><td class="num"><b>${U.money2(total)}</b></td></tr>`:''}</tbody>`;
    document.getElementById('fin-pager').innerHTML = pages>1 ? `
      <button class="btn btn-ghost btn-sm" ${this.page===0?'disabled':''} onclick="Views.financeiro.page--;Views.financeiro.table()">‹ Anterior</button>
      <span style="font-size:.82rem;color:var(--text2);margin:0 8px">Página ${this.page+1} de ${pages}</span>
      <button class="btn btn-ghost btn-sm" ${this.page>=pages-1?'disabled':''} onclick="Views.financeiro.page++;Views.financeiro.table()">Próxima ›</button>` : '';
    U.icons();
  }
};

Dash.showPurchase = function(id){
  const x = State.purchases.find(i=>i.id===id); if(!x) return;
  const p = State.projects.find(pr=>pr.id===x.projectId);
  UI.modal({ title:'Detalhe do Lançamento', body:`
    <div class="import-log" style="line-height:2.1">
      <b>Projeto:</b> ${U.esc(U.projLabel(p))}<br>
      <b>Categoria:</b> ${U.esc(x.category)}<br>
      <b>Fornecedor:</b> ${U.esc(x.supplier||'—')}<br>
      <b>Pedido/Nota:</b> ${U.esc(x.order||'—')}<br>
      <b>Descrição:</b> ${U.esc(x.desc||'—')}<br>
      <b>Observações:</b> ${U.esc(x.notes||'—')}<br>
      <b>Data:</b> ${U.date(x.date)}<br>
      <b>Valor:</b> <span style="font-size:1.1rem;font-weight:800;color:var(--blue)">${U.money2(x.value)}</span><br>
      <small style="color:var(--text3)">Importado de ${U.esc(x.file||'—')} em ${U.date(x.importedAt)}</small></div>`,
    footer:`<button class="btn btn-danger" style="margin-right:auto" onclick="Dash.removePurchase('${x.id}')"><i data-lucide="trash-2"></i>Excluir</button>
            <button class="btn btn-ghost" onclick="Dash.purchaseForm('${x.id}')"><i data-lucide="pencil"></i>Editar</button>
            <button class="btn btn-primary" onclick="UI.close()">Fechar</button>` });
};

/* Formulário de edição de lançamento financeiro */
// Sem id → cria um novo lançamento manual; com id → edita o existente
Dash.purchaseForm = function(id){
  const isNew = !id;
  const x = isNew
    ? { projectId:(State.projects[0]||{}).id||'', category:'', supplier:'', order:'',
        value:0, date:U.isoDate(new Date()), desc:'', notes:'' }
    : State.purchases.find(i=>i.id===id);
  if(!x) return;
  UI.modal({ title:isNew?'Novo Lançamento Manual':'Editar Lançamento', wide:true, body:`
    <div class="form-grid">
      <div><label>Projeto</label><select id="pf-proj">${State.projects.map(p=>`<option value="${p.id}" ${p.id===x.projectId?'selected':''}>${U.esc(U.projLabel(p))}</option>`).join('')}</select></div>
      <div><label>Categoria</label><input id="pf-cat" list="cat-list-p" value="${U.esc(x.category)}"><datalist id="cat-list-p">${State.categories.map(c=>`<option>${U.esc(c.name)}</option>`).join('')}</datalist></div>
      <div><label>Fornecedor</label><input id="pf-sup" value="${U.esc(x.supplier)}"></div>
      <div><label>Pedido/Nota</label><input id="pf-order" value="${U.esc(x.order)}"></div>
      <div><label>Valor</label><input id="pf-value" type="number" step="0.01" value="${x.value}"></div>
      <div><label>Data</label><input id="pf-date" type="date" value="${x.date}"></div>
      <div class="full"><label>Descrição</label><input id="pf-desc" value="${U.esc(x.desc)}"></div>
      <div class="full"><label>Observações</label><textarea id="pf-notes" rows="2">${U.esc(x.notes)}</textarea></div>
    </div>`,
    footer:`${isNew?'':`<button class="btn btn-danger" style="margin-right:auto" onclick="Dash.removePurchase('${x.id}')"><i data-lucide="trash-2"></i>Excluir</button>`}
            <button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
            <button class="btn btn-primary" id="pf-save"><i data-lucide="check"></i>${isNew?'Adicionar':'Salvar'}</button>` });
  document.getElementById('pf-save').onclick = async () => {
    const vals = {
      projectId:document.getElementById('pf-proj').value, category:document.getElementById('pf-cat').value.trim(),
      supplier:document.getElementById('pf-sup').value.trim(), order:document.getElementById('pf-order').value.trim(),
      value:U.num(document.getElementById('pf-value').value), date:document.getElementById('pf-date').value,
      desc:document.getElementById('pf-desc').value.trim(), notes:document.getElementById('pf-notes').value };
    if(!vals.projectId || !vals.category) return UI.toast('Preencha projeto e categoria', 'warn');
    if(isNew){
      await DB.put('purchases', { id:U.id(), ...vals, costCenter:vals.category,
        importedAt:Date.now(), file:'(manual)' });
    } else {
      Object.assign(x, vals);
      await DB.put('purchases', x);
    }
    await State.reload();
    UI.close(); UI.toast(isNew?'Lançamento adicionado':'Lançamento atualizado', 'success'); App.render();
  };
};

Dash.removePurchase = function(id){
  UI.confirm('Excluir este lançamento definitivamente?', async () => {
    await DB.del('purchases', id); await State.reload(); UI.toast('Lançamento excluído', 'warn'); App.render();
  });
};
