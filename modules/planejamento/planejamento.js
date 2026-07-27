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
  mode:'month', refDate:new Date(),
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
  items(){ return State.planning.slice().sort((a,b)=>a.date.localeCompare(b.date)); },
  draw(){
    const body = document.getElementById('plan-body'), per = document.getElementById('plan-period');
    const r = this.refDate;
    if(this.mode==='list' || this.mode==='timeline'){
      per.textContent = 'Todos os itens';
      const items = this.items();
      if(this.mode==='list'){
        body.innerHTML = `<div class="table-wrap"><div class="table-scroll"><table>
          <thead><tr><th>Data</th><th>Projeto</th><th>Categoria</th><th>Descrição</th><th class="num">Valor Previsto</th><th></th></tr></thead>
          <tbody>${items.map(x=>{const p=State.projects.find(pr=>pr.id===x.projectId);return `
            <tr><td>${U.date(x.date)}</td><td><b>${U.esc(p?p.proposal:'?')}</b></td><td>${U.esc(x.category)}</td>
            <td>${U.esc(x.desc)}</td><td class="num">${U.money2(x.value)}</td>
            <td><button class="btn btn-ghost btn-sm" onclick="Views.planejamento.form('${x.id}')"><i data-lucide="pencil"></i></button></td></tr>`;}).join('')
            || `<tr><td colspan="6"><div class="empty"><i data-lucide="calendar-days"></i><br>Nenhum item planejado.</div></td></tr>`}</tbody></table></div></div>`;
      } else {
        body.innerHTML = items.length ? `<div class="card"><div class="timeline">${items.map(x=>{const p=State.projects.find(pr=>pr.id===x.projectId);return `
          <div class="tl-item"><b>${U.date(x.date)}</b> · <span class="tag tag-blue">${U.esc(p?p.proposal:'?')}</span> ${U.esc(x.category)}<br>
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
        html += `<div class="cal-day ${d.getMonth()!==r.getMonth()?'other':''} ${iso===today?'today':''}">
          <div class="d">${d.getDate()}</div>
          ${evs.slice(0,3).map(x=>`<div class="cal-ev" onclick="Views.planejamento.form('${x.id}')" title="${U.esc(x.desc)}">${U.money(x.value)} ${U.esc(x.category)}</div>`).join('')}
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
            <div class="rb-item" style="margin-top:8px"><div><b>${U.esc(x.category)}</b> · ${U.esc(p?p.proposal:'?')}<small>${U.esc(x.desc||'')}</small></div><b>${U.money2(x.value)}</b></div>`;}).join('')
          : '<small style="color:var(--text3)">Sem itens planejados</small>'}</div>`;
      }
      body.innerHTML = html;
    }
    U.icons();
  },
  form(id){
    const x = id ? State.planning.find(i=>i.id===id) : {projectId:'',category:'',desc:'',value:0,date:U.isoDate(new Date()),notes:''};
    UI.modal({ title:id?'Editar Item de Planejamento':'Novo Item de Planejamento', body:`
      <div class="form-grid">
        <div><label>Projeto *</label><select id="pl-proj">${State.projects.map(p=>`<option value="${p.id}" ${p.id===x.projectId?'selected':''}>${U.esc(U.projLabel(p))}</option>`).join('')}</select></div>
        <div><label>Categoria *</label><input id="pl-cat" list="cat-list" value="${U.esc(x.category)}"><datalist id="cat-list">${State.categories.map(c=>`<option>${U.esc(c.name)}</option>`).join('')}</datalist></div>
        <div><label>Valor Previsto *</label><input id="pl-value" type="number" step="0.01" value="${x.value||''}"></div>
        <div><label>Data Prevista *</label><input id="pl-date" type="date" value="${x.date}"></div>
        <div class="full"><label>Descrição</label><input id="pl-desc" value="${U.esc(x.desc)}"></div>
        <div class="full"><label>Observações</label><textarea id="pl-notes" rows="2">${U.esc(x.notes||'')}</textarea></div>
      </div>`,
      footer:`${id?`<button class="btn btn-danger" style="margin-right:auto" onclick="Views.planejamento.remove('${id}')"><i data-lucide="trash-2"></i>Excluir</button>`:''}
        <button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
        <button class="btn btn-primary" id="pl-save"><i data-lucide="check"></i>Salvar</button>`
    });
    document.getElementById('pl-save').onclick = async () => {
      const obj = { ...(id?x:{id:U.id()}),
        projectId:document.getElementById('pl-proj').value, category:document.getElementById('pl-cat').value.trim(),
        value:U.num(document.getElementById('pl-value').value), date:document.getElementById('pl-date').value,
        desc:document.getElementById('pl-desc').value.trim(), notes:document.getElementById('pl-notes').value };
      if(!obj.projectId || !obj.category || !obj.date) return UI.toast('Preencha projeto, categoria e data', 'warn');
      await DB.put('planning', obj); await State.reload();
      UI.close(); UI.toast('Planejamento salvo', 'success'); App.render();
    };
  },
  remove(id){
    UI.confirm('Excluir este item de planejamento?', async () => {
      await DB.del('planning', id); await State.reload(); UI.toast('Item excluído', 'warn'); App.render();
    });
  }
};
