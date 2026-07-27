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
        <button class="btn btn-ghost" onclick="Importer.pick('paidAccount')"><i data-lucide="receipt"></i>Importar Contas Pagas</button>
        <button class="btn btn-ghost" onclick="Importer.pick('labor')"><i data-lucide="users"></i>Importar Mão de Obra</button>
        <button class="btn btn-ghost" onclick="Dash.purchaseForm()"><i data-lucide="plus"></i>Novo Lançamento</button>
        <div class="tabs">
          <button class="tab ${this.mode==='table'?'active':''}" onclick="Views.financeiro.mode='table';Views.financeiro.render()">Lançamentos</button>
          <button class="tab ${this.mode==='blocks'?'active':''}" onclick="Views.financeiro.mode='blocks';Views.financeiro.render()">Importações</button>
        </div>
        ${this.mode==='table'?searchBox('fin-search','Pesquisar lançamentos…'):''}
        <div class="spacer"></div>
        <button class="btn btn-ghost" onclick="Exports.table('purchases')"><i data-lucide="download"></i>Exportar</button>
      </div>
      <div class="drop-zone" id="dz-purchase" style="margin-bottom:16px"><i data-lucide="file-spreadsheet"></i><br><b>Arraste a planilha de compras aqui</b><br><small>Para contas pagas e mão de obra, use os botões acima. Novos uploads somam ao banco e reimportações idênticas são ignoradas.</small></div>
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
      <div class="batch-filter-title"><i data-lucide="list-filter"></i><div><b>Filtros da importação</b><small>Use um ou mais campos para localizar informações específicas dentro deste arquivo.</small></div></div>
      <div class="batch-filters">
        <div><label>Pesquisar</label><input id="batch-search" placeholder="Projeto, categoria, fornecedor, descrição…"></div>
        <div><label>Projeto</label><select id="batch-project"><option value="">Todos</option>${[...new Set(b.items.map(x=>x.projectId))].map(id=>{const p=State.projects.find(x=>x.id===id);return `<option value="${U.esc(id)}">${U.esc(p?U.projLabel(p):'?')}</option>`;}).join('')}</select></div>
        <div><label>Origem</label><select id="batch-source"><option value="">Todas</option><option value="purchase">Compra</option><option value="paidAccount">Conta paga</option><option value="labor">Mão de obra</option></select></div>
        <div><label>Categoria</label><select id="batch-category"><option value="">Todas</option>${[...new Map(b.items.map(x=>[Biz.categoryKey(x.category),Biz.categoryName(x.category)])).values()].sort().map(x=>`<option value="${U.esc(x)}">${U.esc(x)}</option>`).join('')}</select></div>
        <div><label>Período</label><div style="display:flex;gap:6px"><input id="batch-date-from" type="date" title="Data inicial"><input id="batch-date-to" type="date" title="Data final"></div></div>
        <div><label>Valor mínimo</label><input id="batch-value-min" type="number" step="0.01" placeholder="0,00"></div>
        <div><label>Valor máximo</label><input id="batch-value-max" type="number" step="0.01" placeholder="Sem limite"></div>
      </div>
      <div class="batch-filter-summary"><span id="batch-summary"></span><button class="btn btn-ghost btn-sm" id="batch-clear"><i data-lucide="filter-x"></i>Limpar filtros</button></div>
      <div class="table-wrap"><div class="table-scroll" style="max-height:58vh"><table>
        <thead><tr><th>Data</th><th>Projeto</th><th>Origem</th><th>Categoria</th><th>Conta / Fornecedor</th><th>Descrição</th><th class="num">Valor</th><th style="width:50px"></th></tr></thead>
        <tbody id="batch-rows"></tbody>
      </table></div></div>`,
      footer:`<button class="btn btn-primary" onclick="UI.close()">Fechar</button>`,
      onOpen:()=>{
        const apply=()=>this.renderBatchRows(b.items);
        ['batch-search','batch-project','batch-source','batch-category','batch-date-from','batch-date-to','batch-value-min','batch-value-max']
          .forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener(['batch-search','batch-value-min','batch-value-max'].includes(id)?'input':'change',apply); });
        document.getElementById('batch-clear').onclick=()=>{
          ['batch-search','batch-project','batch-source','batch-category','batch-date-from','batch-date-to','batch-value-min','batch-value-max'].forEach(id=>document.getElementById(id).value='');
          apply();
        };
        apply();
      } });
  },
  renderBatchRows(items){
    const get=id=>(document.getElementById(id)||{}).value||'';
    const q=U.norm(get('batch-search')), project=get('batch-project'), source=get('batch-source');
    const category=get('batch-category'), from=get('batch-date-from'), to=get('batch-date-to');
    const minRaw=get('batch-value-min'), maxRaw=get('batch-value-max');
    const min=minRaw===''?null:U.num(minRaw), max=maxRaw===''?null:U.num(maxRaw);
    const rows=items.filter(x=>{
      const p=State.projects.find(pr=>pr.id===x.projectId);
      const text=U.norm(`${p?U.projLabel(p):''} ${x.supplier||''} ${x.category||''} ${x.desc||''} ${x.order||''} ${x.value}`);
      return (!q||text.includes(q)) && (!project||x.projectId===project) &&
        (!source||(x.sourceType||'purchase')===source) &&
        (!category||Biz.sameCategory(x.category,category)) &&
        (!from||x.date>=from) && (!to||x.date<=to) &&
        (min===null||Number(x.value)>=min) && (max===null||Number(x.value)<=max);
    }).sort((a,c)=>(c.date||'').localeCompare(a.date||''));
    const total=rows.reduce((s,x)=>s+x.value,0);
    document.getElementById('batch-summary').innerHTML=`Exibindo <b>${rows.length}</b> de ${items.length} lançamento(s) · total filtrado <b>${U.money2(total)}</b>`;
    document.getElementById('batch-rows').innerHTML=rows.map(x=>{const p=State.projects.find(pr=>pr.id===x.projectId);return `
      <tr><td>${U.date(x.date)}</td><td><b>${U.esc(p?p.proposal:'?')}</b></td>
      <td>${Views.financeiro.sourceTag(x)}</td><td><span class="tag tag-gray">${U.esc(x.category)}</span></td><td>${U.esc(x.supplier||'—')}</td>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${U.esc(x.desc)}">${U.esc(x.desc||'—')}</td>
      <td class="num"><b>${U.money2(x.value)}</b></td>
      <td><button class="btn btn-ghost btn-sm" onclick="Dash.purchaseForm('${x.id}')"><i data-lucide="pencil"></i></button></td></tr>`;}).join('')
      || '<tr><td colspan="8"><div class="empty">Nenhum lançamento corresponde aos filtros.</div></td></tr>';
    U.icons();
  },
  sourceTag(x){
    const cfg = {
      labor:['Mão de obra','tag-blue'],
      paidAccount:['Conta paga','tag-amber'],
      purchase:['Compra','tag-green']
    }[x.sourceType] || ['Compra','tag-green'];
    return `<span class="tag ${cfg[1]}">${cfg[0]}</span>`;
  },
  removeBatch(key){
    key = decodeURIComponent(key);
    const b = this.batches().find(x=>x.key===key); if(!b) return;
    UI.confirm(`Excluir o bloco <b>${U.esc(b.file)}</b> com <b>${b.items.length}</b> lançamento(s) (${U.money2(b.total)})? Esta ação não pode ser desfeita.`, async () => {
      UI.loading(true, 'Excluindo bloco…');
      for(const x of b.items){
        await this.reversePlanningOffset(x);
        await DB.del('purchases', x.id);
      }
      await State.reload();
      UI.loading(false); UI.toast('Bloco de importação excluído', 'warn'); App.render();
    });
  },
  planningMatches(purchase){
    return State.planning.filter(plan=>
      plan.projectId===purchase.projectId &&
      Biz.sameCategory(plan.category,purchase.category) &&
      Number(plan.value)>0
    ).sort((a,b)=>{
      const expenseDate=new Date(`${purchase.date||U.isoDate(new Date())}T12:00:00`).getTime();
      const da=Math.abs(new Date(`${a.date||purchase.date}T12:00:00`).getTime()-expenseDate);
      const db=Math.abs(new Date(`${b.date||purchase.date}T12:00:00`).getTime()-expenseDate);
      return da-db || Number(b.value)-Number(a.value);
    });
  },
  async offsetPlanning(purchase, planId){
    if(!purchase || purchase.planningOffset) return false;
    if(!(Number(purchase.value)>0)) throw new Error('Somente gastos positivos podem abater o planejamento.');
    if(typeof Cloud!=='undefined' && Cloud.active() && !Cloud.canEditStore('planning'))
      throw new Error('Seu usuário não possui permissão para alterar o planejamento.');
    const plan=State.planning.find(x=>x.id===planId);
    if(!plan) throw new Error('O item planejado selecionado não está mais disponível.');
    if(plan.projectId!==purchase.projectId || !Biz.sameCategory(plan.category,purchase.category))
      throw new Error('O planejamento precisa ter o mesmo projeto e a mesma categoria do gasto.');
    const snapshot=JSON.parse(JSON.stringify(plan));
    const amount=Math.round(Math.min(Number(purchase.value),Number(plan.value))*100)/100;
    const remaining=Math.round((Number(plan.value)-amount)*100)/100;
    purchase.planningOffset={
      planningId:plan.id,
      amount,
      appliedAt:new Date().toISOString(),
      originalPlanValue:Number(plan.value),
      planningSnapshot:snapshot
    };
    try{
      if(remaining>0){
        const updated={...plan,value:remaining,
          originalValue:Number(plan.originalValue)||Number(plan.value),
          realizedAmount:Math.round(((Number(plan.realizedAmount)||0)+amount)*100)/100,
          lastOffsetAt:new Date().toISOString()};
        await DB.put('planning',updated);
        Object.assign(plan,updated);
      }else{
        await DB.del('planning',plan.id);
        State.planning=State.planning.filter(x=>x.id!==plan.id);
      }
      await DB.put('purchases',purchase);
      return true;
    }catch(err){
      delete purchase.planningOffset;
      try{
        await DB.put('planning',snapshot);
        const existing=State.planning.find(x=>x.id===snapshot.id);
        if(existing) Object.assign(existing,snapshot); else State.planning.push(snapshot);
      }catch(e){}
      throw err;
    }
  },
  async reversePlanningOffset(purchase){
    const offset=purchase && purchase.planningOffset;
    if(!offset || !offset.planningId || !(Number(offset.amount)>0)) return false;
    if(typeof Cloud!=='undefined' && Cloud.active() && !Cloud.canEditStore('planning'))
      throw new Error('Este gasto abateu um planejamento, mas seu usuário não pode restaurá-lo.');
    const current=State.planning.find(x=>x.id===offset.planningId);
    const base=current || offset.planningSnapshot || {
      id:offset.planningId,projectId:purchase.projectId,category:purchase.category,
      date:purchase.date,desc:'Planejamento restaurado',notes:''
    };
    const restored={...base,
      value:Math.round(((current?Number(current.value):0)+Number(offset.amount))*100)/100,
      realizedAmount:Math.max(0,Math.round(((Number(base.realizedAmount)||0)-Number(offset.amount))*100)/100),
      lastOffsetAt:new Date().toISOString()
    };
    await DB.put('planning',restored);
    if(current) Object.assign(current,restored); else State.planning.push(restored);
    return true;
  },
  showImportReconciliation(ids){
    if(typeof Cloud!=='undefined' && Cloud.active() && !Cloud.canEditStore('planning'))
      return UI.toast('Seu usuário não possui permissão para alterar o planejamento.','warn',5500);
    const purchases=(ids||[]).map(id=>State.purchases.find(x=>x.id===id))
      .filter(x=>x && !x.planningOffset && Number(x.value)>0);
    const rows=purchases.map(x=>({purchase:x,matches:this.planningMatches(x)})).filter(x=>x.matches.length);
    if(!rows.length) return UI.modal({
      title:'Abater do planejamento',
      body:'<div class="empty"><i data-lucide="calendar-x"></i><br>Nenhum item planejado com o mesmo projeto e categoria foi encontrado para estes gastos.</div>',
      footer:'<button class="btn btn-primary" onclick="UI.close()">Fechar</button>'
    });
    UI.modal({title:'Abater gastos do planejamento',wide:true,body:`
      <p style="color:var(--text2);font-size:.85rem;margin-bottom:12px">Revise os vínculos sugeridos. O valor realizado reduzirá o item planejado; quando consumir todo o saldo, o item sairá dos gastos futuros.</p>
      <div class="table-wrap"><div class="table-scroll" style="max-height:56vh"><table>
        <thead><tr><th style="width:42px">Abater</th><th>Gasto realizado</th><th>Projeto / Categoria</th><th>Planejamento selecionado</th></tr></thead>
        <tbody>${rows.map(({purchase,matches})=>{const p=State.projects.find(x=>x.id===purchase.projectId);return `
          <tr class="reconcile-row" data-purchase-id="${U.esc(purchase.id)}">
            <td><input class="reconcile-check" type="checkbox" checked aria-label="Abater este gasto"></td>
            <td><b>${U.money2(purchase.value)}</b><br><small>${U.date(purchase.date)} · ${U.esc(purchase.desc||purchase.supplier||'Gasto')}</small></td>
            <td><b>${U.esc(p?p.proposal:'?')}</b><br><small>${U.esc(Biz.categoryName(purchase.category))}</small></td>
            <td><select class="reconcile-plan">${matches.map(plan=>`<option value="${U.esc(plan.id)}">${U.date(plan.date)} · ${U.esc(plan.desc||plan.category)} · saldo ${U.money2(plan.value)}</option>`).join('')}</select></td>
          </tr>`;}).join('')}</tbody>
      </table></div></div>`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Agora não</button><button class="btn btn-primary" id="reconcile-apply"><i data-lucide="calendar-check"></i>Aplicar abatimentos</button>`,
      onOpen:()=>{ document.getElementById('reconcile-apply').onclick=()=>this.applyImportReconciliation(); }
    });
  },
  async applyImportReconciliation(){
    const selections=[...document.querySelectorAll('.reconcile-row')].map(row=>({
      purchaseId:row.dataset.purchaseId,
      planId:row.querySelector('.reconcile-plan').value,
      enabled:row.querySelector('.reconcile-check').checked
    })).filter(x=>x.enabled&&x.planId);
    if(!selections.length) return UI.toast('Selecione ao menos um abatimento.','warn');
    UI.loading(true,'Abatendo gastos do planejamento…');
    let applied=0, skipped=0, firstError='';
    for(const item of selections){
      try{
        const purchase=State.purchases.find(x=>x.id===item.purchaseId);
        if(purchase && await this.offsetPlanning(purchase,item.planId)) applied++;
      }catch(err){ skipped++; if(!firstError) firstError=err.message||String(err); }
    }
    await State.reload();
    UI.loading(false); UI.closeAll(); App.render();
    UI.toast(`${applied} gasto(s) abatido(s) do planejamento${skipped?` · ${skipped} não aplicado(s): ${U.esc(firstError)}`:''}`,skipped?'warn':'success',7500);
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
      <thead><tr><th>Data</th><th>Projeto</th><th>Origem</th><th>Categoria</th><th>Conta / Fornecedor</th><th>Descrição</th><th>Pedido</th><th class="num">Valor</th><th style="width:50px"></th></tr></thead>
      <tbody>${slice.map(x => { const p = State.projects.find(pr=>pr.id===x.projectId); return `
        <tr class="clickable" onclick="Dash.showPurchase('${x.id}')">
          <td>${U.date(x.date)}</td><td><b>${U.esc(p?p.proposal:'?')}</b></td>
          <td>${this.sourceTag(x)}</td><td><span class="tag tag-gray">${U.esc(x.category)}</span></td>
          <td>${U.esc(x.supplier||'—')}</td><td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${U.esc(x.desc)}">${U.esc(x.desc||'—')}</td>
          <td>${U.esc(x.order||'—')}</td><td class="num"><b>${U.money2(x.value)}</b></td>
          <td onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" onclick="Dash.purchaseForm('${x.id}')"><i data-lucide="pencil"></i></button></td></tr>`;}).join('')
        || `<tr><td colspan="9"><div class="empty"><i data-lucide="wallet"></i><br>Nenhum lançamento encontrado.</div></td></tr>`}
      ${rows.length?`<tr><td colspan="8" style="text-align:right"><b>Total (${rows.length} lançamentos)</b></td><td class="num"><b>${U.money2(total)}</b></td></tr>`:''}</tbody>`;
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
      <b>Origem:</b> ${Views.financeiro.sourceTag(x)}<br>
      <b>Categoria:</b> ${U.esc(x.category)}<br>
      <b>Fornecedor:</b> ${U.esc(x.supplier||'—')}<br>
      <b>Pedido/Nota:</b> ${U.esc(x.order||'—')}<br>
      <b>Descrição:</b> ${U.esc(x.desc||'—')}<br>
      <b>Observações:</b> ${U.esc(x.notes||'—')}<br>
      <b>Data:</b> ${U.date(x.date)}<br>
      <b>Valor:</b> <span style="font-size:1.1rem;font-weight:800;color:var(--blue)">${U.money2(x.value)}</span><br>
      ${x.planningOffset?`<b>Planejamento abatido:</b> <span class="tag tag-green">${U.money2(x.planningOffset.amount)}</span><br>`:''}
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
        value:0, date:U.isoDate(new Date()), desc:'', notes:'', sourceType:'purchase' }
    : State.purchases.find(i=>i.id===id);
  if(!x) return;
  UI.modal({ title:isNew?'Novo Lançamento Manual':'Editar Lançamento', wide:true, body:`
    <div class="form-grid">
      <div><label>Projeto</label><select id="pf-proj">${State.projects.map(p=>`<option value="${p.id}" ${p.id===x.projectId?'selected':''}>${U.esc(U.projLabel(p))}</option>`).join('')}</select></div>
      <div><label>Categoria</label><input id="pf-cat" list="cat-list-p" value="${U.esc(x.category)}"><datalist id="cat-list-p">${Biz.uniqueCategories().map(c=>`<option>${U.esc(c.name)}</option>`).join('')}</datalist></div>
      <div><label>Origem do gasto</label><select id="pf-source"><option value="purchase" ${(x.sourceType||'purchase')==='purchase'?'selected':''}>Compra</option><option value="paidAccount" ${x.sourceType==='paidAccount'?'selected':''}>Conta paga</option><option value="labor" ${x.sourceType==='labor'?'selected':''}>Mão de obra</option></select></div>
      <div><label>Fornecedor</label><input id="pf-sup" value="${U.esc(x.supplier)}"></div>
      <div><label>Pedido/Nota</label><input id="pf-order" value="${U.esc(x.order)}"></div>
      <div><label>Valor</label><input id="pf-value" type="number" step="0.01" value="${x.value}"></div>
      <div><label>Data</label><input id="pf-date" type="date" value="${x.date}"></div>
      <div class="full"><label>Descrição</label><input id="pf-desc" value="${U.esc(x.desc)}"></div>
      <div class="full"><label>Observações</label><textarea id="pf-notes" rows="2">${U.esc(x.notes)}</textarea></div>
      ${isNew?`<div class="full planning-offset-box">
        <label class="check-item"><input id="pf-offset" type="checkbox"><span><b>Abater automaticamente este gasto do valor planejado</b><small>Quando houver planejamento do mesmo projeto e categoria, o saldo será reduzido ao salvar.</small></span></label>
        <div id="pf-plan-wrap" style="display:none;margin-top:10px"><label>Item planejado a reduzir</label><select id="pf-plan"></select></div>
        <small class="planning-offset-help" id="pf-plan-help">Selecione projeto e categoria para localizar planejamentos compatíveis.</small>
      </div>`:x.planningOffset?`<div class="full planning-offset-box"><b>Este lançamento já abateu ${U.money2(x.planningOffset.amount)} do planejamento.</b><small class="planning-offset-help">Se o lançamento for excluído, o saldo planejado será restaurado automaticamente.</small></div>`:''}
    </div>`,
    footer:`${isNew?'':`<button class="btn btn-danger" style="margin-right:auto" onclick="Dash.removePurchase('${x.id}')"><i data-lucide="trash-2"></i>Excluir</button>`}
            <button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
            <button class="btn btn-primary" id="pf-save"><i data-lucide="check"></i>${isNew?'Adicionar':'Salvar'}</button>` });
  if(isNew){
    const offset=document.getElementById('pf-offset'), planSelect=document.getElementById('pf-plan');
    const planWrap=document.getElementById('pf-plan-wrap'), help=document.getElementById('pf-plan-help');
    const mayEditPlanning=typeof Cloud==='undefined' || !Cloud.active() || Cloud.canEditStore('planning');
    const refreshPlans=()=>{
      const virtual={
        projectId:document.getElementById('pf-proj').value,
        category:document.getElementById('pf-cat').value.trim(),
        date:document.getElementById('pf-date').value
      };
      const matches=Views.financeiro.planningMatches(virtual);
      planSelect.innerHTML=matches.map(plan=>`<option value="${U.esc(plan.id)}">${U.date(plan.date)} · ${U.esc(plan.desc||plan.category)} · saldo ${U.money2(plan.value)}</option>`).join('');
      offset.disabled=!mayEditPlanning || !matches.length;
      if(offset.disabled){ offset.checked=false; planWrap.style.display='none'; }
      else if(offset.dataset.touched!=='true'){
        offset.checked=true;
        planWrap.style.display='block';
      }
      help.textContent=!mayEditPlanning
        ? 'Seu usuário não possui permissão para alterar o planejamento.'
        : matches.length
          ? `${matches.length} item(ns) planejado(s) compatível(is) encontrado(s).`
          : 'Nenhum planejamento com o mesmo projeto e categoria foi encontrado.';
    };
    offset.onchange=()=>{ offset.dataset.touched='true'; planWrap.style.display=offset.checked?'block':'none'; };
    ['pf-proj','pf-cat','pf-date'].forEach(id=>document.getElementById(id).addEventListener(id==='pf-cat'?'input':'change',refreshPlans));
    document.getElementById('pf-source').onchange=e=>{
      if(e.target.value==='labor' && !document.getElementById('pf-cat').value.trim())
        document.getElementById('pf-cat').value='Mão de Obra';
      refreshPlans();
    };
    refreshPlans();
  }
  document.getElementById('pf-save').onclick = async () => {
    const rawCategory=document.getElementById('pf-cat').value.trim();
    const vals = {
      projectId:document.getElementById('pf-proj').value, category:rawCategory ? Biz.categoryName(rawCategory) : '',
      supplier:document.getElementById('pf-sup').value.trim(), order:document.getElementById('pf-order').value.trim(),
      value:U.num(document.getElementById('pf-value').value), date:document.getElementById('pf-date').value,
      desc:document.getElementById('pf-desc').value.trim(), notes:document.getElementById('pf-notes').value,
      sourceType:document.getElementById('pf-source').value };
    if(!vals.projectId || !vals.category) return UI.toast('Preencha projeto e categoria', 'warn');
    let offsetError=null;
    if(isNew){
      const created={ id:U.id(), ...vals, costCenter:vals.category,
        importedAt:Date.now(), file:`(manual - ${{purchase:'Compra',paidAccount:'Conta paga',labor:'Mão de obra'}[vals.sourceType]})` };
      await DB.put('purchases',created);
      const useOffset=document.getElementById('pf-offset').checked;
      const planId=document.getElementById('pf-plan').value;
      if(useOffset&&planId){
        try{ await Views.financeiro.offsetPlanning(created,planId); }
        catch(err){ offsetError=err; }
      }
    } else {
      Object.assign(x, vals);
      await DB.put('purchases', x);
    }
    await State.reload();
    UI.close(); App.render();
    if(offsetError) UI.toast(`Lançamento salvo, mas o planejamento não foi abatido: ${U.esc(offsetError.message)}`,'warn',7000);
    else UI.toast(isNew?'Lançamento adicionado':'Lançamento atualizado', 'success');
  };
};

Dash.removePurchase = function(id){
  UI.confirm('Excluir este lançamento definitivamente?', async () => {
    const purchase=State.purchases.find(x=>x.id===id);
    if(purchase) await Views.financeiro.reversePlanningOffset(purchase);
    await DB.del('purchases', id); await State.reload(); UI.toast('Lançamento excluído e planejamento restaurado quando aplicável', 'warn'); App.render();
  });
};
