/**
 * Módulo Orçamentos
 *
 * Responsabilidades:
 * - tela de orçamentos por projeto, importação e indicadores
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

/* ---------- ORÇAMENTOS ---------- */
Views.orcamentos = {
  title:'Orçamentos',
  render(){
    const byProj = {};
    State.budgets.filter(b=>!State.filters.project || b.projectId===State.filters.project).forEach(b => { (byProj[b.projectId] = byProj[b.projectId]||[]).push(b); });
    $c().innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" onclick="Importer.pick('budget')"><i data-lucide="upload"></i>Importar Modelo de Orçamentos</button>
        <div class="spacer"></div>
        <button class="btn btn-ghost" onclick="Exports.table('budgets')"><i data-lucide="download"></i>Exportar</button>
      </div>
      <div class="drop-zone" id="dz-budget"><i data-lucide="file-spreadsheet"></i><br><b>Arraste a planilha de orçamentos aqui</b><br><small>Formato: PROJETO · DESCRIÇÃO · VALOR ORÇADO — os dados são somados, nunca substituídos</small></div>
      <div class="section-title"><h2>Orçamentos por Projeto</h2></div>
      ${Object.keys(byProj).length ? Object.entries(byProj).map(([pid, items]) => {
        const p = State.projects.find(x=>x.id===pid);
        const total = items.reduce((s,b)=>s+b.value,0);
        return `<div class="card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
            <h3>${U.esc(U.projLabel(p))}</h3>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <b>${U.money(total)}</b>
              <button class="btn btn-ghost btn-sm" onclick="Views.orcamentos.addItem('${pid}')"><i data-lucide="plus"></i>Categoria</button>
              <button class="btn btn-danger btn-sm" onclick="Views.orcamentos.removeProject('${pid}')"><i data-lucide="trash-2"></i>Excluir orçamento</button>
            </div></div>
          <div class="table-scroll" style="max-height:280px"><table>
            <thead><tr><th>Categoria</th><th class="num">Orçado</th><th class="num">Peso</th><th style="width:96px"></th></tr></thead>
            <tbody>${items.sort((a,b)=>b.value-a.value).map(b=>`<tr>
              <td>${U.esc(b.category)}</td><td class="num">${U.money2(b.value)}</td>
              <td class="num">${U.pct(total>0?b.value/total*100:0)}</td>
              <td class="num" style="white-space:nowrap"><button class="btn btn-ghost btn-sm" title="Editar custo" onclick="Views.orcamentos.editItem('${b.id}')"><i data-lucide="pencil"></i></button><button class="btn btn-ghost btn-sm" title="Excluir linha" onclick="Views.orcamentos.removeItem('${b.id}')" style="color:var(--red)"><i data-lucide="trash-2"></i></button></td></tr>`).join('')}</tbody>
          </table></div></div>`;
      }).join('') : `<div class="empty card"><i data-lucide="calculator"></i><br>Nenhum orçamento importado ainda.</div>`}`;
    App.bindDropZone('dz-budget', 'budget');
    U.icons();
  },
  // Edição manual do custo orçado de uma categoria
  editItem(id){
    const b = State.budgets.find(x=>x.id===id); if(!b) return;
    const p = State.projects.find(x=>x.id===b.projectId);
    UI.modal({ title:'Editar Custo Orçado', body:`
      <div class="form-grid">
        <div class="full"><label>Projeto</label><input value="${U.esc(U.projLabel(p))}" disabled></div>
        <div><label>Categoria</label><input id="bg-cat" value="${U.esc(b.category)}"></div>
        <div><label>Valor Orçado</label><input id="bg-value" type="number" step="0.01" value="${b.value}"></div>
      </div>`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
              <button class="btn btn-primary" id="bg-save"><i data-lucide="check"></i>Salvar</button>` });
    document.getElementById('bg-save').onclick = async () => {
      b.category = Biz.categoryName(document.getElementById('bg-cat').value.trim() || b.category);
      b.value = U.num(document.getElementById('bg-value').value);
      await DB.put('budgets', b); await State.reload();
      UI.close(); UI.toast('Orçamento atualizado', 'success'); App.render();
    };
  },
  // Inclusão manual de nova categoria no orçamento
  addItem(pid){
    const p = State.projects.find(x=>x.id===pid);
    UI.modal({ title:`Nova Categoria no Orçamento — ${U.esc(p?p.proposal:'')}`, body:`
      <div class="form-grid">
        <div><label>Categoria *</label><input id="bg-add-cat" list="cat-list-b"><datalist id="cat-list-b">${Biz.uniqueCategories().map(c=>`<option>${U.esc(c.name)}</option>`).join('')}</datalist></div>
        <div><label>Valor Orçado *</label><input id="bg-add-value" type="number" step="0.01"></div>
      </div>`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
              <button class="btn btn-primary" id="bg-add-save"><i data-lucide="check"></i>Adicionar</button>` });
    document.getElementById('bg-add-save').onclick = async () => {
      const rawCat = document.getElementById('bg-add-cat').value.trim();
      if(!rawCat) return UI.toast('Informe a categoria', 'warn');
      const cat = Biz.categoryName(rawCat);
      await DB.put('budgets', {id:U.id(), projectId:pid, category:cat, value:U.num(document.getElementById('bg-add-value').value), importedAt:Date.now(), file:'(manual)'});
      await State.reload(); UI.close(); UI.toast('Categoria adicionada ao orçamento', 'success'); App.render();
    };
  },
  removeItem(id){
    const b = State.budgets.find(x=>x.id===id); if(!b) return;
    UI.confirm(`Excluir a linha <b>${U.esc(b.category)}</b> (${U.money2(b.value)}) do orçamento?`, async () => {
      await DB.del('budgets', id); await State.reload(); UI.toast('Linha excluída', 'warn'); App.render();
    });
  },
  removeProject(pid){
    const p = State.projects.find(x=>x.id===pid);
    const items = State.budgets.filter(b=>b.projectId===pid);
    UI.confirm(`Excluir TODO o orçamento de <b>${U.esc(U.projLabel(p))}</b> (${items.length} categoria(s))? Os lançamentos financeiros não serão afetados.`, async () => {
      for(const b of items) await DB.del('budgets', b.id);
      await State.reload(); UI.toast('Orçamento excluído', 'warn'); App.render();
    });
  }
};
