/**
 * Módulo Planejamento
 *
 * Responsabilidades:
 * - calendário e lista de gastos futuros planejados
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

/* ---------- PLANEJAMENTO ---------- */
Views.planejamento = {
  title:'Planejamento',
  mode:(typeof matchMedia==='function' && matchMedia('(max-width: 600px)').matches)?'list':'month', refDate:new Date(), projectFilter:'', focusUpcoming:false,
  render(){
    $c().innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" onclick="Views.planejamento.form()"><i data-lucide="plus"></i>Novo Item</button>
        <div class="tabs">
          ${['day:Diário','week:Semanal','month:Mensal','timeline:Timeline','list:Lista'].map(t=>{const [k,l]=t.split(':');
            return `<button class="tab ${this.mode===k?'active':''}" onclick="Views.planejamento.mode='${k}';Views.planejamento.render()">${l}</button>`;}).join('')}
        </div>
        <div class="spacer"></div>
        <button class="icon-btn" onclick="Views.planejamento.nav(-1)"><i data-lucide="chevron-left"></i></button>
        <b id="plan-period" style="min-width:150px;text-align:center"></b>
        <button class="icon-btn" onclick="Views.planejamento.nav(1)"><i data-lucide="chevron-right"></i></button>
      </div>
      <div id="plan-body"></div>`;
    this.draw();
    U.icons();
  },
  nav(d){
    const r = this.refDate;
    if(this.mode==='month') r.setMonth(r.getMonth()+d);
    else if(this.mode==='week') r.setDate(r.getDate()+7*d);
    else r.setDate(r.getDate()+d);
    this.draw();
  },
  items(){
    let rows = State.planning.slice();
    const pid = this.projectFilter || State.filters.project || '';
    if(pid) rows = rows.filter(x=>x.projectId===pid);
    else {
      const ids=new Set(State.selectedProjectIds());
      if(ids.size) rows=rows.filter(x=>ids.has(String(x.projectId)));
    }
    if(this.focusUpcoming){
      const start = U.isoDate(new Date()), endDate = new Date(); endDate.setDate(endDate.getDate()+7);
      const end = U.isoDate(endDate); rows = rows.filter(x=>x.date>=start && x.date<=end);
    }
    return rows.sort((a,b)=>a.date.localeCompare(b.date));
  },
  eventStyle(projectId){ const c=App.projectColor(projectId); return `background:${c}1F;color:${c};border-left:3px solid ${c}`; },
  showDay(date, sourceRows=State.planning){
    const rows=sourceRows.filter(x=>x.date===date).sort((a,b)=>b.value-a.value);
    const total=rows.reduce((s,x)=>s+x.value,0);
    UI.modal({title:`Gastos planejados — ${U.date(date)}`,wide:true,body:`
      <div class="drill-path"><span class="crumb">${U.date(date)}</span><span style="margin-left:auto"><b>${rows.length}</b> itens · <b>${U.money2(total)}</b></span></div>
      <div class="table-wrap"><div class="table-scroll"><table>
        <thead><tr><th>Projeto</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${rows.map(x=>{const p=State.projects.find(pr=>pr.id===x.projectId);return `<tr>
          <td><b>${U.esc(p?p.proposal:'?')}</b></td><td>${U.esc(Biz.categoryName(x.category))}</td>
          <td>${U.esc(x.desc||'—')}</td><td class="num"><b>${U.money2(x.value)}</b></td>
          <td><button class="btn btn-ghost btn-sm" onclick="Views.planejamento.form(${U.jsArg(x.id)})"><i data-lucide="pencil"></i>Editar</button></td>
        </tr>`;}).join('')||'<tr><td colspan="5"><div class="empty">Nenhum gasto planejado nesta data.</div></td></tr>'}</tbody>
      </table></div></div>`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Fechar</button><button class="btn btn-primary" onclick="UI.closeAll();App.goFiltered('planejamento',${U.jsArg(State.filters.project||'')})"><i data-lucide="calendar-days"></i>Abrir planejamento</button>`
    });
  },
  draw(){
    const body = document.getElementById('plan-body'), per = document.getElementById('plan-period');
    const r = this.refDate;
    if(this.mode==='list' || this.mode==='timeline'){
      per.textContent = this.focusUpcoming ? 'Próximos 7 dias' : 'Todos os itens';
      const items = this.items();
      if(this.mode==='list'){
        body.innerHTML = `<div class="table-wrap"><div class="table-scroll"><table>
          <thead><tr><th>Data</th><th>Projeto</th><th>Categoria</th><th>Descrição</th><th class="num">Previsto inicial</th><th class="num">Consumido</th><th class="num">Saldo atual</th><th></th></tr></thead>
          <tbody>${items.map(x=>{const p=State.projects.find(pr=>pr.id===x.projectId);return `
            <tr><td>${U.date(x.date)}</td><td><b>${U.esc(p?p.proposal:'?')}</b></td><td>${U.esc(x.category)}</td>
            <td>${U.esc(x.desc)}</td><td class="num">${U.money2(x.originalValue!==''&&x.originalValue!=null&&Number.isFinite(Number(x.originalValue))?Number(x.originalValue):(Number(x.value)||0)+(Number(x.realizedAmount)||0))}</td>
            <td class="num">${U.money2(Number(x.realizedAmount)||0)}</td><td class="num"><b>${U.money2(x.value)}</b></td>
            <td><div style="display:flex;gap:4px"><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();Views.planejamento.history(${U.jsArg(x.id)})" title="Ver histórico"><i data-lucide="history"></i></button><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();Views.planejamento.form(${U.jsArg(x.id)})" title="Editar"><i data-lucide="pencil"></i></button></div></td></tr>`;}).join('')
            || `<tr><td colspan="8"><div class="empty"><i data-lucide="calendar-days"></i><br>Nenhum item planejado.</div></td></tr>`}</tbody></table></div></div>`;
      } else {
        body.innerHTML = items.length ? `<div class="card"><div class="timeline">${items.map(x=>{const p=State.projects.find(pr=>pr.id===x.projectId);return `
          <div class="tl-item"><b>${U.date(x.date)}</b> · <span class="tag" style="background:${App.projectColor(x.projectId)}1F;color:${App.projectColor(x.projectId)}">${U.esc(p?p.proposal:'?')}</span> ${U.esc(x.category)}<br>
          <span style="color:var(--text2)">${U.esc(x.desc||'')}</span> — <b>${U.money2(x.value)}</b></div>`;}).join('')}</div></div>`
          : `<div class="empty card"><i data-lucide="calendar-days"></i><br>Nenhum item planejado.</div>`;
      }
    } else if(this.mode==='month'){
      per.textContent = r.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
      const first = new Date(r.getFullYear(), r.getMonth(), 1);
      const start = new Date(first); start.setDate(1 - ((first.getDay()+7)%7));
      let html = `<div class="card"><div class="cal-grid">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>`<div class="cal-head">${d}</div>`).join('')}`;
      const today = U.isoDate(new Date());
      for(let i=0;i<42;i++){
        const d = new Date(start); d.setDate(start.getDate()+i);
        const iso = U.isoDate(d);
        const evs = this.items().filter(x=>x.date===iso);
        html += `<div class="cal-day ${d.getMonth()!==r.getMonth()?'other':''} ${iso===today?'today':''}" onclick="Views.planejamento.form('', ${U.jsArg(iso)})" title="Clique para inserir um planejamento nesta data">
          <div class="d">${d.getDate()}</div>
          ${evs.slice(0,3).map(x=>`<div class="cal-ev" style="${this.eventStyle(x.projectId)}" onclick="event.stopPropagation();Views.planejamento.form(${U.jsArg(x.id)})" title="${U.esc(x.desc)}">${U.money(x.value)} ${U.esc(x.category)}</div>`).join('')}
          ${evs.length>3?`<small>+${evs.length-3}</small>`:''}</div>`;
      }
      body.innerHTML = html + '</div></div>';
    } else { // day / week
      const days = this.mode==='day' ? 1 : 7;
      const start = new Date(r);
      if(this.mode==='week') start.setDate(r.getDate() - ((r.getDay()+7)%7));
      per.textContent = this.mode==='day' ? r.toLocaleDateString('pt-BR') : `Semana de ${start.toLocaleDateString('pt-BR')}`;
      let html = '';
      for(let i=0;i<days;i++){
        const d = new Date(start); d.setDate(start.getDate()+i);
        const iso = U.isoDate(d);
        const evs = this.items().filter(x=>x.date===iso);
        html += `<div class="card" style="margin-bottom:10px"><h3>${d.toLocaleDateString('pt-BR',{weekday:'long', day:'numeric', month:'short'})}</h3>
          ${evs.length ? evs.map(x=>{const p=State.projects.find(pr=>pr.id===x.projectId);return `
            <div class="rb-item" style="margin-top:8px;border-left:4px solid ${App.projectColor(x.projectId)}"><div><b>${U.esc(x.category)}</b> · ${U.esc(p?p.proposal:'?')}<small>${U.esc(x.desc||'')}</small></div><b>${U.money2(x.value)}</b></div>`;}).join('')
          : '<small style="color:var(--text3)">Sem itens planejados</small>'}</div>`;
      }
      body.innerHTML = html;
    }
    U.icons();
  },
  form(id, presetDate=''){
    const selected=State.selectedProjectIds();
    const x = id ? State.planning.find(i=>i.id===id) : {projectId:selected[0]||(State.projects[0]||{}).id||'',category:'',desc:'',value:0,date:presetDate||U.isoDate(new Date()),notes:''};
    UI.modal({ title:id?'Editar Item de Planejamento':'Novo Item de Planejamento', body:`
      <div class="form-grid">
        <div><label>Projeto *</label><select id="pl-proj">${State.projects.map(p=>`<option value="${U.esc(p.id)}" ${p.id===x.projectId?'selected':''}>${U.esc(U.projLabel(p))}</option>`).join('')}</select></div>
        <div><label>Categoria *</label><select id="pl-cat"><option value="">Selecione...</option>${Biz.uniqueCategories().map(c=>`<option value="${U.esc(c.name)}" ${Biz.sameCategory(c.name,x.category)?'selected':''}>${U.esc(c.name)}</option>`).join('')}</select></div>
        <div><label>Valor Previsto *</label><input id="pl-value" type="number" step="0.01" value="${U.esc(x.value||'')}"></div>
        <div><label>Data Prevista *</label><input id="pl-date" type="date" value="${U.esc(x.date)}"></div>
        <div class="full"><label>Descrição</label><input id="pl-desc" value="${U.esc(x.desc)}"></div>
        <div class="full"><label>Observações</label><textarea id="pl-notes" rows="2">${U.esc(x.notes||'')}</textarea></div>
      </div>`,
      footer:`${id?`<button class="btn btn-danger" style="margin-right:auto" onclick="Views.planejamento.remove(${U.jsArg(id)})"><i data-lucide="trash-2"></i>Excluir</button>`:''}
        <button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
        <button class="btn btn-primary" id="pl-save"><i data-lucide="check"></i>Salvar</button>`
    });
    document.getElementById('pl-save').onclick = async () => {
      const rawCategory=document.getElementById('pl-cat').value.trim();
      const obj = { ...(id?x:{id:U.id()}),
        projectId:document.getElementById('pl-proj').value, category:rawCategory ? Biz.categoryName(rawCategory) : '',
        value:Math.round(U.num(document.getElementById('pl-value').value)*100)/100, date:document.getElementById('pl-date').value,
        desc:document.getElementById('pl-desc').value.trim(), notes:document.getElementById('pl-notes').value };
      if(!obj.projectId || !obj.category || !obj.date) return UI.toast('Preencha projeto, categoria e data', 'warn');
      const before=id?Number(x.value)||0:0;
      const hasInitial=x.originalValue!==''&&x.originalValue!=null&&Number.isFinite(Number(x.originalValue));
      obj.originalValue=id?(hasInitial?Math.max(0,Number(x.originalValue)):before+(Number(x.realizedAmount)||0)):obj.value;
      obj.realizedAmount=Math.max(0,Number(x.realizedAmount)||0);
      obj.consumptionStatus=obj.value<=0&&obj.realizedAmount>0?'consumed':obj.realizedAmount>0?'partial':'pending';
      await DB.put('planning', obj);
      await State.addPlanningHistory({planningId:String(obj.id),projectId:String(obj.projectId),category:obj.category,
        action:id?'updated':'created',source:'manual',amount:Math.abs(obj.value-before),beforeValue:before,afterValue:obj.value,
        description:id?'Planejamento atualizado manualmente':'Planejamento criado'});
      await State.reload();
      UI.close(); UI.toast('Planejamento salvo', 'success'); App.render();
    };
  },
  history(id){
    const plan=State.planning.find(item=>String(item.id)===String(id)); if(!plan) return;
    const rows=State.planningHistory.filter(item=>String(item.planningId)===String(id))
      .sort((a,b)=>String(b.occurredAt||'').localeCompare(String(a.occurredAt||'')));
    const labels={baseline:'Saldo inicial',created:'Criado',updated:'Alterado',consumed:'Consumido',restored:'Restaurado',omie_consumed:'Consumido pelo Omie',omie_restored:'Restaurado pelo Omie'};
    UI.modal({title:'Histórico do valor projetado',wide:true,body:`
      <div class="planning-history-summary"><div><small>Previsto inicial</small><b>${U.money2(plan.originalValue!==''&&plan.originalValue!=null&&Number.isFinite(Number(plan.originalValue))?Number(plan.originalValue):(Number(plan.value)||0)+(Number(plan.realizedAmount)||0))}</b></div><div><small>Consumido</small><b>${U.money2(Number(plan.realizedAmount)||0)}</b></div><div><small>Saldo projetado atual</small><b>${U.money2(plan.value)}</b></div></div>
      <div class="table-wrap"><div class="table-scroll" style="max-height:48vh"><table><thead><tr><th>Data</th><th>Evento</th><th>Origem</th><th class="num">Antes</th><th class="num">Depois</th><th class="num">Valor</th></tr></thead><tbody>
      ${rows.map(row=>`<tr><td>${U.date(row.occurredAt)}</td><td><b>${U.esc(labels[row.action]||row.action||'Evento')}</b><br><small>${U.esc(row.description||'')}</small></td><td>${U.esc(row.source==='omie'?'Omie':'CliqueObras')}</td><td class="num">${U.money2(row.beforeValue)}</td><td class="num">${U.money2(row.afterValue)}</td><td class="num">${U.money2(row.amount)}</td></tr>`).join('')||'<tr><td colspan="6"><div class="empty">Nenhum evento registrado.</div></td></tr>'}
      </tbody></table></div></div>`,footer:'<button class="btn btn-primary" onclick="UI.close()">Fechar</button>'});
  },
  remove(id){
    const plan=State.planning.find(item=>String(item.id)===String(id));
    if(plan&&(Number(plan.realizedAmount)||0)>0)
      return UI.toast('Este planejamento possui consumo registrado e não pode ser excluído. Zere ou ajuste o saldo mantendo o histórico.','warn',7000);
    UI.confirm('Excluir este item de planejamento?', async () => {
      await DB.del('planning', id); await State.reload(); UI.toast('Item excluído', 'warn'); App.render();
    });
  }
};
