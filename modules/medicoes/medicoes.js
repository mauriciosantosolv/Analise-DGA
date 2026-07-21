/**
 * Módulo Medições
 *
 * Responsabilidades:
 * - medições/faturamento por projeto
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

/* ---------- MEDIÇÕES ----------
   Controle do faturamento da receita contratada conforme avanço do
   cronograma e aprovação do cliente (medições de obra). */
Views.medicoes = {
  title:'Medições',
  render(){
    const byProj = {};
    State.measurements.filter(m=>!State.filters.project || m.projectId===State.filters.project).forEach(m => { (byProj[m.projectId] = byProj[m.projectId]||[]).push(m); });
    const totalInvoiced = State.measurements.filter(m=>U.norm(m.status).startsWith('faturad')).reduce((s,m)=>s+m.value,0);
    const totalAwaiting = State.measurements.filter(m=>U.norm(m.status)==='aguardando aprovacao').reduce((s,m)=>s+m.value,0);
    const totalRevenue = State.projects.filter(p=>!State.filters.project || p.id===State.filters.project).reduce((s,p)=>s+(p.saleValue||0),0);
    $c().innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" onclick="Views.medicoes.form()"><i data-lucide="plus"></i>Nova Medição</button>
        <div class="spacer"></div>
      </div>
      <div class="kpi-grid">
        <div class="kpi accent-blue"><div class="k-label"><i data-lucide="banknote"></i>Receita Contratada</div><div class="k-value">${U.money(totalRevenue)}</div></div>
        <div class="kpi accent-green"><div class="k-label"><i data-lucide="ruler"></i>Total Medido / Faturado</div><div class="k-value">${U.money(totalInvoiced)}</div><div class="k-sub">Aguardando aprovação: ${U.money(totalAwaiting)}</div></div>
        <div class="kpi"><div class="k-label"><i data-lucide="file-clock"></i>Saldo a Medir</div><div class="k-value">${U.money(totalRevenue-totalInvoiced)}</div></div>
      </div>
      ${Object.keys(byProj).length ? Object.entries(byProj).map(([pid, items]) => {
        const p = State.projects.find(x=>x.id===pid);
        const invoiced = items.filter(m=>U.norm(m.status).startsWith('faturad')).reduce((s,m)=>s+m.value,0);
        const awaiting = items.filter(m=>U.norm(m.status)==='aguardando aprovacao').reduce((s,m)=>s+m.value,0);
        const pctM = p && p.saleValue>0 ? invoiced/p.saleValue*100 : null;
        return `<div class="card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
            <h3>${U.esc(U.projLabel(p))}</h3>
            <div style="display:flex;gap:10px;align-items:center"><b style="color:var(--green)">${U.money(invoiced)} faturado</b><span class="tag tag-amber">${U.money(awaiting)} aguardando aprovação</span><span class="tag ${pctM!=null&&pctM>=100?'tag-green':'tag-blue'}">${U.pct(pctM)} da receita</span></div></div>
          <div class="progress" style="margin-bottom:10px"><div style="width:${Math.min(100,pctM||0)}%;background:var(--green)"></div></div>
          <div class="table-scroll" style="max-height:240px"><table>
            <thead><tr><th>Data</th><th>Referência</th><th>Status</th><th class="num">Valor Medido</th><th style="width:50px"></th></tr></thead>
            <tbody>${items.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(m=>`<tr>
              <td>${U.date(m.date)}</td><td>${U.esc(m.ref||'—')}</td>
              <td><span class="tag ${{'Faturada':'tag-green','Aprovada':'tag-blue','Aguardando aprovação':'tag-amber'}[m.status]||'tag-gray'}">${U.esc(m.status||'—')}</span></td>
              <td class="num"><b>${U.money2(m.value)}</b></td>
              <td><button class="btn btn-ghost btn-sm" onclick="Views.medicoes.form('${m.id}')"><i data-lucide="pencil"></i></button></td></tr>`).join('')}</tbody>
          </table></div></div>`;
      }).join('') : `<div class="empty card"><i data-lucide="ruler"></i><br>Nenhuma medição registrada.<br><small>As medições registram quanto da receita contratada já foi faturada conforme o avanço do cronograma e a aprovação do cliente.</small></div>`}`;
    U.icons();
  },
  form(id){
    const m = id ? State.measurements.find(x=>x.id===id) : {projectId:State.filters.project||'', date:U.isoDate(new Date()), value:0, ref:'', status:'Aguardando aprovação', notes:''};
    if(!State.projects.length) return UI.toast('Cadastre um projeto antes de lançar medições', 'warn');
    UI.modal({ title:id?'Editar Medição':'Nova Medição', body:`
      <div class="form-grid">
        <div class="full"><label>Projeto *</label><select id="md-proj">${State.projects.map(p=>`<option value="${p.id}" ${p.id===m.projectId?'selected':''}>${U.esc(U.projLabel(p))}</option>`).join('')}</select></div>
        <div><label>Data *</label><input id="md-date" type="date" value="${m.date}"></div>
        <div><label>Valor Medido *</label><input id="md-value" type="number" step="0.01" value="${m.value||''}"></div>
        <div><label>Referência (nº da medição)</label><input id="md-ref" value="${U.esc(m.ref)}"></div>
        <div><label>Status</label><select id="md-status">${['Aguardando aprovação','Aprovada','Faturada'].map(s=>`<option ${s===m.status?'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="full"><label>Observações</label><textarea id="md-notes" rows="2">${U.esc(m.notes||'')}</textarea></div>
      </div>`,
      footer:`${id?`<button class="btn btn-danger" style="margin-right:auto" onclick="Views.medicoes.remove('${id}')"><i data-lucide="trash-2"></i>Excluir</button>`:''}
        <button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
        <button class="btn btn-primary" id="md-save"><i data-lucide="check"></i>Salvar</button>` });
    document.getElementById('md-save').onclick = async () => {
      const obj = { ...(id?m:{id:U.id()}),
        projectId:document.getElementById('md-proj').value, date:document.getElementById('md-date').value,
        value:U.num(document.getElementById('md-value').value), ref:document.getElementById('md-ref').value.trim(),
        status:document.getElementById('md-status').value, notes:document.getElementById('md-notes').value };
      if(!obj.projectId || !obj.date) return UI.toast('Preencha projeto e data', 'warn');
      await DB.put('measurements', obj); await State.reload();
      UI.close(); UI.toast('Medição salva', 'success'); App.render();
    };
  },
  remove(id){
    UI.confirm('Excluir esta medição?', async () => {
      await DB.del('measurements', id); await State.reload(); UI.toast('Medição excluída', 'warn'); App.render();
    });
  }
};
