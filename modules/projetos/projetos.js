/**
 * Módulo Projetos
 *
 * Responsabilidades:
 * - cadastro, listagem, detalhe e comparação de projetos
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

/* ---------- PROJETOS ---------- */
Views.projetos = {
  title:'Projetos',
  render(){
    $c().innerHTML = `
      <div class="toolbar">
        ${searchBox('proj-search','Pesquisar projetos…')}
        <div class="spacer"></div>
        <button class="btn btn-ghost" onclick="Views.projetos.compare()"><i data-lucide="git-compare"></i>Comparar Obras</button>
        <button class="btn btn-primary" onclick="Views.projetos.form()"><i data-lucide="plus"></i>Novo Projeto</button>
      </div>
      <div class="table-wrap"><div class="table-scroll"><table id="proj-table"></table></div></div>`;
    this.table('');
    bindSearch('proj-search', q => this.table(q));
    U.icons();
  },
  table(q){
    const n = U.norm(q);
    const rows = State.projects
      .filter(p => !n || U.norm(`${p.proposal} ${p.name} ${p.client} ${p.type} ${p.status}`).includes(n))
      .sort((a,b) => String(b.proposal).localeCompare(String(a.proposal), undefined, {numeric:true}));
    document.getElementById('proj-table').innerHTML = `
      <thead><tr><th></th><th>Proposta</th><th>Nome</th><th>Cliente</th><th>Tipo</th><th>Status</th>
      <th class="num">Venda</th><th class="num">Orçado</th><th class="num">Realizado</th><th class="num">Margem Atual</th><th>Consumo</th><th></th></tr></thead>
      <tbody>${rows.map(p => { const s = Biz.projectStats(p); return `
        <tr class="clickable" onclick="Views.projetos.detail('${p.id}')">
          <td>${lightDot(s.light)}</td>
          <td><b>${U.esc(p.proposal)}</b></td>
          <td>${U.esc(p.name||'—')}</td>
          <td style="display:flex;align-items:center;gap:8px">${clientAvatar(p.client)}${U.esc(p.client||'—')}</td>
          <td><span class="tag tag-gray">${p.type||'—'}</span></td>
          <td>${statusTag(p.status)}</td>
          <td class="num">${U.money(p.saleValue)}</td>
          <td class="num">${U.money(s.budgetTotal)}</td>
          <td class="num">${U.money(s.spent)}</td>
          <td class="num" style="color:${s.marginCurrent!=null && s.marginCurrent<0?'var(--red)':'var(--green)'}">${U.pct(s.marginCurrent)}</td>
          <td style="min-width:110px"><div class="progress ${s.consumed>100?'crit':s.consumed>85?'warn':''}"><div style="width:${Math.min(100,s.consumed)}%"></div></div><small style="color:var(--text3)">${U.pct(s.consumed)}</small></td>
          <td onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" onclick="Views.projetos.form('${p.id}')"><i data-lucide="pencil"></i></button></td>
        </tr>`;}).join('') || `<tr><td colspan="12"><div class="empty"><i data-lucide="folder-open"></i><br>Nenhum projeto. Importe uma planilha ou cadastre manualmente.</div></td></tr>`}</tbody>`;
    U.icons();
  },
  form(id){
    const p = id ? State.projects.find(x=>x.id===id) : {proposal:'',name:'',client:'',saleValue:0,type:'Obra',status:'A executar',start:'',deadline:'',expectedEnd:'',realEnd:'',notes:'',clientLogo:''};
    const clientOpts = State.clients.map(c=>`<option ${c.name===p.client?'selected':''}>${U.esc(c.name)}</option>`).join('');
    UI.modal({ title: id?'Editar Projeto':'Novo Projeto', wide:true, body:`
      <div class="form-grid">
        <div><label>Número da Proposta *</label><input id="f-proposal" value="${U.esc(p.proposal)}"></div>
        <div><label>Nome</label><input id="f-name" value="${U.esc(p.name)}"></div>
        <div><label>Cliente</label><input id="f-client" list="client-list" value="${U.esc(p.client)}"><datalist id="client-list">${clientOpts}</datalist></div>
        <div><label>Valor de Venda</label><input id="f-sale" type="number" step="0.01" value="${p.saleValue||''}"></div>
        <div><label>Tipo</label><select id="f-type">${['HH','Obra','Fornecimento','Painel'].map(t=>`<option ${t===p.type?'selected':''}>${t}</option>`).join('')}</select></div>
        <div><label>Status</label><select id="f-status">${['Em andamento','Concluído','Paralisado','A executar'].map(t=>`<option ${t===p.status?'selected':''}>${t}</option>`).join('')}</select></div>
        <div><label>Data de Início</label><input id="f-start" type="date" value="${p.start}"></div>
        <div><label>Prazo Contratual</label><input id="f-deadline" type="date" value="${p.deadline}"></div>
        <div><label>Término Previsto</label><input id="f-expected" type="date" value="${p.expectedEnd}"></div>
        <div><label>Encerramento Real</label><input id="f-real" type="date" value="${p.realEnd}"></div>
        <div class="full"><label>Observações</label><textarea id="f-notes" rows="2">${U.esc(p.notes)}</textarea></div>
      </div>`,
      footer:`${id?`<button class="btn btn-danger" style="margin-right:auto" onclick="Views.projetos.remove('${id}')"><i data-lucide="trash-2"></i>Excluir</button>`:''}
        <button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
        <button class="btn btn-primary" id="f-save"><i data-lucide="check"></i>Salvar</button>`
    });
    document.getElementById('f-save').onclick = async () => {
      const proposal = document.getElementById('f-proposal').value.trim();
      if(!proposal) return UI.toast('Informe o número da proposta', 'warn');
      const obj = { ...(id?p:{id:U.id(),createdAt:Date.now(),clientLogo:''}), proposal,
        name:document.getElementById('f-name').value.trim(), client:document.getElementById('f-client').value.trim(),
        saleValue:U.num(document.getElementById('f-sale').value), type:document.getElementById('f-type').value,
        status:document.getElementById('f-status').value, start:document.getElementById('f-start').value,
        deadline:document.getElementById('f-deadline').value, expectedEnd:document.getElementById('f-expected').value,
        realEnd:document.getElementById('f-real').value, notes:document.getElementById('f-notes').value };
      await DB.put('projects', obj); await State.reload();
      UI.close(); UI.toast('Projeto salvo', 'success'); App.render();
    };
  },
  remove(id){
    const p = State.projects.find(x=>x.id===id);
    UI.confirm(`Excluir o projeto <b>${U.esc(U.projLabel(p))}</b>? Os lançamentos e orçamentos vinculados serão mantidos no banco, mas ficarão órfãos.`, async () => {
      await DB.del('projects', id); await State.reload(); UI.toast('Projeto excluído', 'warn'); App.render();
    });
  },
  detail(id){
    const p = State.projects.find(x=>x.id===id); if(!p) return;
    const s = Biz.projectStats(p);
    const cats = Biz.categoryStats([p]);
    const ring = Dash.healthRing(s.health, s.light);
    UI.modal({ title:`${U.esc(U.projLabel(p))}`, wide:true, body:`
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        ${ring}
        <div class="kpi-grid" style="flex:1;margin:0">
          <div class="kpi"><div class="k-label">Venda</div><div class="k-value">${U.money(p.saleValue)}</div></div>
          <div class="kpi accent-green"><div class="k-label">Medido / Faturado</div><div class="k-value">${U.money(s.invoiced)}</div><div class="k-sub">Aguardando aprovação: ${U.money(s.awaitingApproval)}</div></div>
          <div class="kpi"><div class="k-label">Orçado</div><div class="k-value">${U.money(s.budgetTotal)}</div></div>
          <div class="kpi"><div class="k-label">Realizado</div><div class="k-value">${U.money(s.spent)}</div><div class="k-sub">${U.pct(s.consumed)} do orçamento</div></div>
          <div class="kpi ${s.balance<0?'accent-red':'accent-green'}"><div class="k-label">Saldo</div><div class="k-value">${U.money(s.balance)}</div></div>
          <div class="kpi"><div class="k-label">Projetado (Planejamento)</div><div class="k-value">${U.money(s.projected)}</div></div>
          <div class="kpi ${s.marginCurrent<0?'accent-red':'accent-blue'}"><div class="k-label">Margem Atual</div><div class="k-value">${U.pct(s.marginCurrent)}</div><div class="k-sub">Prevista: ${U.pct(s.marginPlanned)}</div></div>
        </div>
      </div>
      <div class="import-log" style="margin-bottom:14px">
        <b>Compromisso financeiro</b> — realizado + planejamento: <b>${U.money(s.committedTotal)}</b>
        · margem estimada <b>${U.pct(s.marginCurrent)}</b>
        ${s.burnoutDate?` · orçamento esgota em <b>${U.date(s.burnoutDate)}</b>`:''}
        ${s.deviation!=null?` · ${s.deviation>0?`estouro previsto de <b style="color:var(--red)">${U.pct(s.deviation)}</b>`:`economia prevista de <b style="color:var(--green)">${U.pct(-s.deviation)}</b>`}`:''}
        ${s.daysLeft!=null?` · ${s.daysLeft} dias restantes de contrato`:''}
      </div>
      <div class="project-dates" style="margin-bottom:14px">
        <div><small>Data de início</small><b>${p.start?U.date(p.start):'Não informado'}</b></div>
        <div><small>Prazo contratual</small><b>${p.deadline?U.date(p.deadline):'Não informado'}</b></div>
        <div><small>Término previsto</small><b>${p.expectedEnd?U.date(p.expectedEnd):'Não informado'}</b></div>
      </div>
      <h3 style="margin-bottom:8px">Categorias</h3>
      <div class="table-wrap"><div class="table-scroll" style="max-height:300px"><table>
        <thead><tr><th>Categoria</th><th class="num">Orçado</th><th class="num">Realizado</th><th class="num">Projetado</th><th class="num">Saldo</th><th class="num">% Comprom.</th><th class="num">Peso</th><th>Tend.</th><th></th></tr></thead>
        <tbody>${cats.map(c=>`<tr class="clickable" onclick="Dash.drill({category:'${U.esc(c.name)}',projectId:'${p.id}'})">
          <td>${U.esc(c.name)}</td><td class="num">${U.money(c.budget)}</td><td class="num">${U.money(c.spent)}</td><td class="num">${U.money(c.projected)}</td>
          <td class="num" style="color:${c.balance<0?'var(--red)':'inherit'}">${U.money(c.balance)}</td>
          <td class="num">${U.pct(c.committedPct)}</td><td class="num">${U.pct(c.weight)}</td>
          <td>${Dash.trendIcon(c.trend)}</td><td>${lightDot(c.status)}</td></tr>`).join('')}</tbody>
      </table></div></div>`,
      footer:`<button class="btn btn-ghost" onclick="Dash.simulator('${p.id}')"><i data-lucide="sliders-horizontal"></i>Simulador</button>
              <button class="btn btn-ghost" onclick="Exports.projectPDF('${p.id}')"><i data-lucide="printer"></i>Imprimir Dashboard em PDF</button>
              <button class="btn btn-primary" onclick="UI.close()">Fechar</button>`
    });
  },
  compare(){
    const opts = State.projects.map(p=>`<option value="${p.id}">${U.esc(U.projLabel(p))}</option>`).join('');
    UI.modal({ title:'Comparação entre Obras', wide:true, body:`
      <div class="form-grid" style="margin-bottom:14px">
        <div><label>Obra A</label><select id="cmp-a">${opts}</select></div>
        <div><label>Obra B</label><select id="cmp-b">${opts}</select></div>
      </div><div id="cmp-result"></div>`,
      footer:`<button class="btn btn-primary" onclick="UI.close()">Fechar</button>`,
      onOpen(){
        const run = () => {
          const a = State.projects.find(x=>x.id===document.getElementById('cmp-a').value);
          const b = State.projects.find(x=>x.id===document.getElementById('cmp-b').value);
          if(!a||!b) return;
          const sa = Biz.projectStats(a), sb = Biz.projectStats(b);
          const row = (label, va, vb, fmt=U.money) => `<tr><td><b>${label}</b></td><td class="num">${fmt(va)}</td><td class="num">${fmt(vb)}</td></tr>`;
          document.getElementById('cmp-result').innerHTML = `<div class="table-wrap"><table>
            <thead><tr><th>Indicador</th><th class="num">${U.esc(a.proposal)}</th><th class="num">${U.esc(b.proposal)}</th></tr></thead><tbody>
            ${row('Receita', a.saleValue, b.saleValue)}
            ${row('Orçamento', sa.budgetTotal, sb.budgetTotal)}
            ${row('Custos Realizados', sa.spent, sb.spent)}
            ${row('Saldo', sa.balance, sb.balance)}
            ${row('Projetado (Planejamento)', sa.projected, sb.projected)}
            ${row('Lucro Estimado', sa.profit, sb.profit)}
            ${row('Margem Atual', sa.marginCurrent, sb.marginCurrent, U.pct)}
            ${row('Desvio', sa.deviation, sb.deviation, U.pct)}
            ${row('Saúde Financeira', sa.health, sb.health, v=>v+'/100')}
            </tbody></table></div>`;
        };
        document.getElementById('cmp-a').onchange = run;
        document.getElementById('cmp-b').onchange = run;
        if(State.projects.length>1) document.getElementById('cmp-b').selectedIndex = 1;
        run();
      }
    });
  }
};
