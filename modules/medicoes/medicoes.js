/**
 * Medições
 *
 * - HH: valor derivado exclusivamente dos snapshots de RDOs aprovados;
 * - demais contratos: lançamento manual preservado;
 * - RDOs vinculados ficam indisponíveis para qualquer nova medição.
 */
Views.medicoes = {
  title:'Medições',

  // v4.4.0 — aba ativa do menu de Medições. 'medicoes' = lançamento e
  // acompanhamento das medições; 'provisoes' = planejamento futuro (CashFlow).
  mode:'medicoes',
  tabsMarkup(){
    return `<div class="tabs">
      <button class="tab ${this.mode==='medicoes'?'active':''}" onclick="Views.medicoes.mode='medicoes';Views.medicoes.render()">Medições</button>
      <button class="tab ${this.mode==='provisoes'?'active':''}" onclick="Views.medicoes.mode='provisoes';Views.medicoes.render()">Provisões</button>
    </div>`;
  },

  // v4.1.0 — filtros da tela. Período inicia no mês corrente.
  periodFrom:'',
  periodTo:'',
  situationFilter:'',
  statusFilter:'',
  // v4.2.4 — quando o usuário limpa os filtros, o período fica em branco de
  // propósito e a tela passa a mostrar TODOS os períodos.
  allPeriods:false,
  ensurePeriod(){
    if(this.allPeriods) return;
    if(this.periodFrom&&this.periodTo) return;
    const today=new Date();
    this.periodFrom=U.isoDate(new Date(today.getFullYear(),today.getMonth(),1));
    this.periodTo=U.isoDate(new Date(today.getFullYear(),today.getMonth()+1,0));
  },
  applyFilters(){
    this.periodFrom=document.getElementById('md-period-from').value;
    this.periodTo=document.getElementById('md-period-to').value;
    this.statusFilter=document.getElementById('md-status-filter').value;
    this.situationFilter=document.getElementById('md-situation-filter').value;
    // v4.2.4 — apagar as duas datas na mão também vale como "todos os períodos".
    this.allPeriods=!this.periodFrom&&!this.periodTo;
    this.render();
  },
  clearFilters(){
    this.periodFrom=''; this.periodTo=''; this.statusFilter=''; this.situationFilter='';
    // v4.2.4 — "Limpar" passa a exibir todo o histórico, sem recorte de datas.
    this.allPeriods=true; this.render();
  },

  canEdit(){
    return typeof Cloud==='undefined' || !Cloud.active() || Cloud.canEditStore('measurements');
  },
  // v4.2.4 — total medido acumulado: todas as medições já lançadas, sem
  // filtro de período, status ou recebimento. É o valor que precisa ser
  // abatido da receita contratada para chegar ao saldo a medir correto.
  measuredAllTime(projectId=''){
    const scope=projectId||State.filters.project||'';
    return State.measurements
      .filter(m=>!scope||String(m.projectId)===String(scope))
      .reduce((sum,m)=>sum+(Number(m.value)||0),0);
  },
  filtered(){
    this.ensurePeriod();
    return State.measurements.filter(m=>{
      if(State.filters.project && String(m.projectId)!==String(State.filters.project)) return false;
      if(!CashFlow.inPeriod(m.date,this.periodFrom,this.periodTo)) return false;
      if(this.statusFilter && String(m.status||'')!==this.statusFilter) return false;
      if(this.situationFilter && CashFlow.situation(m).key!==this.situationFilter) return false;
      return true;
    });
  },
  render(){
    if(this.mode==='provisoes') return CashFlow.renderProvisions();
    const rows=this.filtered();
    const byProj={};
    rows.forEach(m=>(byProj[m.projectId]=byProj[m.projectId]||[]).push(m));
    const totalMeasured=rows.reduce((sum,m)=>sum+(Number(m.value)||0),0);
    const totalInvoiced=rows.filter(m=>U.norm(m.status).startsWith('faturad')).reduce((sum,m)=>sum+(Number(m.value)||0),0);
    const totalApproved=rows.filter(m=>U.norm(m.status).startsWith('aprova')).reduce((sum,m)=>sum+(Number(m.value)||0),0);
    const totalAwaiting=rows.filter(m=>U.norm(m.status)==='aguardando aprovacao').reduce((sum,m)=>sum+(Number(m.value)||0),0);
    const totalRevenue=State.projects.filter(p=>!State.filters.project||String(p.id)===String(State.filters.project)).reduce((sum,p)=>sum+(Number(p.saleValue)||0),0);
    const pendingOmie=CashFlow.pendingOmieReceipts(State.filters.project||'').length;
    // v4.2.4 — o saldo a medir considera SEMPRE o acumulado; medições feitas em
    // outros meses continuam abatendo o saldo mesmo com o período filtrado.
    const measuredEver=this.measuredAllTime();
    const periodLabel=this.allPeriods
      ?'Todos os períodos'
      :`${U.date(this.periodFrom)} a ${U.date(this.periodTo)}`;
    $c().innerHTML=`<div class="toolbar">
      <div><h2>Medições e faturamento</h2><small>HH é consolidado pelos RDOs; obra e fornecimento permanecem manuais.</small></div>
      <div class="spacer"></div>
      ${this.canEdit()?'<button class="btn btn-primary" onclick="Views.medicoes.form()"><i data-lucide="plus"></i>Nova Medição</button>':''}
      ${this.canEdit()&&pendingOmie?`<button class="btn btn-ghost" onclick="CashFlow.reconcileQueue()"><i data-lucide="link"></i>Conciliar Omie <span class="tag tag-amber">${pendingOmie}</span></button>`:''}
    </div>
    ${this.tabsMarkup()}
    <div class="toolbar" style="gap:10px;flex-wrap:wrap">
      <div><label style="font-size:.72rem">De</label><input id="md-period-from" type="date" value="${U.esc(this.periodFrom)}"></div>
      <div><label style="font-size:.72rem">Até</label><input id="md-period-to" type="date" value="${U.esc(this.periodTo)}"></div>
      <div><label style="font-size:.72rem">Status</label><select id="md-status-filter"><option value="">Todos</option>${['Aguardando aprovação','Aprovada','Faturada'].map(status=>`<option ${status===this.statusFilter?'selected':''}>${status}</option>`).join('')}</select></div>
      <div><label style="font-size:.72rem">Recebimento</label><select id="md-situation-filter"><option value="">Todos</option>${[['pending','Não recebida'],['partial','Recebida parcialmente'],['received','Recebida']].map(([key,label])=>`<option value="${key}" ${key===this.situationFilter?'selected':''}>${label}</option>`).join('')}</select></div>
      <div class="spacer"></div>
      <button class="btn btn-ghost btn-sm" onclick="Views.medicoes.applyFilters()"><i data-lucide="filter"></i>Aplicar</button>
      <button class="btn btn-ghost btn-sm" onclick="Views.medicoes.clearFilters()"><i data-lucide="rotate-ccw"></i>Limpar</button>
    </div>
    <div class="kpi-grid">
      <div class="kpi accent-blue"><div class="k-label"><i data-lucide="banknote"></i>Receita Contratada</div><div class="k-value">${U.money(totalRevenue)}</div></div>
      <div class="kpi accent-green"><div class="k-label"><i data-lucide="ruler"></i>Total Medido</div><div class="k-value">${U.money(totalMeasured)}</div><div class="k-sub">Faturado: ${U.money(totalInvoiced)}</div></div>
      <div class="kpi accent-blue"><div class="k-label"><i data-lucide="badge-check"></i>Aprovado</div><div class="k-value">${U.money(totalApproved)}</div></div>
      <div class="kpi accent-amber"><div class="k-label"><i data-lucide="clock-3"></i>Aguardando aprovação</div><div class="k-value">${U.money(totalAwaiting)}</div></div>
      <div class="kpi"><div class="k-label"><i data-lucide="file-clock"></i>Saldo a Medir</div><div class="k-value">${U.money(totalRevenue-measuredEver)}</div><div class="k-sub">Medido acumulado: ${U.money(measuredEver)}</div></div>
    </div>
    <div style="font-size:.78rem;color:var(--text2);margin:-2px 0 12px">Período exibido: <b>${U.esc(periodLabel)}</b> · Saldo a Medir e percentual medido consideram todas as medições já lançadas.</div>
    ${Object.keys(byProj).length?Object.entries(byProj).map(([projectId,items])=>{
      const project=State.projects.find(x=>String(x.id)===String(projectId));
      const measured=items.reduce((sum,m)=>sum+(Number(m.value)||0),0);
      const invoiced=items.filter(m=>U.norm(m.status).startsWith('faturad')).reduce((sum,m)=>sum+(Number(m.value)||0),0);
      const approved=items.filter(m=>U.norm(m.status).startsWith('aprova')).reduce((sum,m)=>sum+(Number(m.value)||0),0);
      const awaiting=items.filter(m=>U.norm(m.status)==='aguardando aprovacao').reduce((sum,m)=>sum+(Number(m.value)||0),0);
      const receivedProject=items.reduce((sum,m)=>sum+CashFlow.situation(m).received,0);
      // v4.2.4 — o percentual medido do projeto usa o acumulado, não o período.
      const measuredEverProject=this.measuredAllTime(projectId);
      const pct=project&&project.saleValue>0?measuredEverProject/project.saleValue*100:null;
      return `<div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          <h3>${U.esc(U.projLabel(project))}</h3>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="color:var(--green)">${U.money(invoiced)} faturado</b><span class="tag tag-blue">${U.money(approved)} aprovado</span><span class="tag tag-amber">${U.money(awaiting)} aguardando</span><span class="tag tag-green">${U.money(receivedProject)} recebido</span><span class="tag ${pct!=null&&pct>=100?'tag-green':'tag-blue'}" title="Percentual calculado sobre todas as medições já lançadas deste projeto">${U.pct(pct)} medido (acumulado)</span></div>
        </div>
        <div class="progress" style="margin-bottom:10px"><div style="width:${Math.min(100,pct||0)}%;background:var(--green)"></div></div>
        <div class="table-scroll" style="max-height:260px"><table>
          <thead><tr><th>Data</th><th>Referência</th><th>Origem</th><th>Status</th><th>Recebimento</th><th class="num">Valor Medido</th><th class="num">Recebido</th><th></th></tr></thead>
          <tbody>${items.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).map(m=>`<tr>
            <td>${U.date(m.date)}</td><td>${U.esc(m.ref||'—')}</td>
            <td><span class="tag tag-gray">${m.source==='rdo-hh'?`${(m.rdoIds||[]).length} RDO(s)`:'Manual'}</span></td>
            <td><span class="tag ${{Faturada:'tag-green',Aprovada:'tag-blue','Aguardando aprovação':'tag-amber'}[m.status]||'tag-gray'}">${U.esc(m.status||'—')}</span></td>
            <td>${CashFlow.situationTag(m)}</td>
            <td class="num"><b>${U.money2(m.value)}</b></td>
            <td class="num">${U.money2(CashFlow.situation(m).received)}</td>
            <td><div class="table-actions">${this.canEdit()?`<button class="btn btn-ghost btn-sm" onclick="CashFlow.receiptForm(${U.jsArg(m.id)})" title="Medição Recebida"><i data-lucide="coins"></i></button>`:''}${m.source==='rdo-hh'?`<button class="btn btn-ghost btn-sm" onclick="Views.medicoes.print(${U.jsArg(m.id)})" title="Gerar PDF da medição"><i data-lucide="file-down"></i></button><button class="btn btn-ghost btn-sm" onclick="Views.medicoes.exportXlsx(${U.jsArg(m.id)})" title="Exportar medição em XLSX"><i data-lucide="file-spreadsheet"></i></button>`:''}${this.canEdit()?`<button class="btn btn-ghost btn-sm" onclick="Views.medicoes.form(${U.jsArg(m.id)})" title="Editar medição"><i data-lucide="pencil"></i></button>`:''}</div></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
    }).join(''):`<div class="empty card"><i data-lucide="ruler"></i><br>Nenhuma medição ${this.allPeriods?'lançada com os filtros selecionados':'no período e filtros selecionados'}.</div>`}`;
    U.icons();
  },

  form(id=''){
    if(id){
      const measurement=State.measurements.find(x=>String(x.id)===String(id));
      if(!measurement) return;
      return measurement.source==='rdo-hh'?this.hhStatusForm(measurement):this.manualForm(id,measurement.projectId);
    }
    if(!State.projects.length) return UI.toast('Cadastre um projeto antes de lançar medições','warn');
    UI.modal({
      title:'Nova Medição',
      body:`<div><label>Projeto *</label><select id="measurement-project">${State.projects.map(project=>`<option value="${U.esc(project.id)}" ${String(project.id)===String(State.filters.project||'')?'selected':''}>${U.esc(U.projLabel(project))} · ${U.esc(project.type||'Obra')}</option>`).join('')}</select></div>
        <div class="import-log" style="margin-top:12px">Projetos HH usarão os RDOs aprovados do período. Nos demais tipos, o valor continua sendo informado manualmente.</div>`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="measurement-continue">Continuar</button>'
    });
    document.getElementById('measurement-continue').onclick=()=>{
      const projectId=document.getElementById('measurement-project').value;
      const project=State.projects.find(x=>String(x.id)===String(projectId));
      UI.close();
      if(project?.type==='HH') this.hhForm(projectId);
      else this.manualForm('',projectId);
    };
  },

  manualForm(id='',projectId=''){
    const measurement=id?State.measurements.find(x=>String(x.id)===String(id)):{
      projectId:projectId||State.filters.project||'',
      date:U.isoDate(new Date()),
      value:0,
      ref:'',
      status:'Aguardando aprovação',
      notes:'',
      source:'manual'
    };
    const manualProjects=State.projects.filter(project=>project.type!=='HH'||String(project.id)===String(measurement.projectId)&&!!id);
    if(!manualProjects.length) return UI.toast('Projetos HH devem ser medidos pelos RDOs aprovados.','warn');
    UI.modal({title:id?'Editar Medição':'Nova Medição Manual',body:`<div class="form-grid">
      <div class="full"><label>Projeto *</label><select id="md-proj">${manualProjects.map(project=>`<option value="${U.esc(project.id)}" ${String(project.id)===String(measurement.projectId)?'selected':''}>${U.esc(U.projLabel(project))}</option>`).join('')}</select></div>
      <div><label>Data *</label><input id="md-date" type="date" value="${U.esc(measurement.date)}"></div>
      <div><label>Valor Medido *</label><input id="md-value" type="number" min="0" step="0.01" value="${U.esc(measurement.value||'')}"></div>
      <div><label>Referência</label><input id="md-ref" value="${U.esc(measurement.ref||'')}"></div>
      <div><label>Status</label><select id="md-status">${['Aguardando aprovação','Aprovada','Faturada'].map(status=>`<option ${status===measurement.status?'selected':''}>${status}</option>`).join('')}</select></div>
      <div class="full"><label>Observações</label><textarea id="md-notes" rows="2">${U.esc(measurement.notes||'')}</textarea></div>
    </div>`,footer:`${id?`<button class="btn btn-danger" style="margin-right:auto" onclick="Views.medicoes.remove(${U.jsArg(id)})"><i data-lucide="trash-2"></i>Excluir</button>`:''}
      <button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="md-save"><i data-lucide="check"></i>Salvar</button>`});
    document.getElementById('md-save').onclick=async()=>{
      const object={
        ...(id?measurement:{id:U.id(),createdAt:new Date().toISOString()}),
        projectId:document.getElementById('md-proj').value,
        date:document.getElementById('md-date').value,
        value:U.num(document.getElementById('md-value').value),
        ref:document.getElementById('md-ref').value.trim(),
        status:document.getElementById('md-status').value,
        notes:document.getElementById('md-notes').value.trim(),
        source:'manual',
        updatedAt:new Date().toISOString()
      };
      if(!object.projectId||!object.date||object.value<=0) return UI.toast('Preencha projeto, data e valor.','warn');
      const project=State.projects.find(x=>String(x.id)===String(object.projectId));
      if(project?.type==='HH') return UI.toast('Projetos HH devem ser medidos pelos RDOs aprovados.','warn');
      await DB.put('measurements',object); await State.reload(); UI.close(); UI.toast('Medição salva','success'); App.render();
    };
  },

  async hhForm(projectId){
    const project=State.projects.find(x=>String(x.id)===String(projectId));
    if(!project||project.type!=='HH') return;
    let remoteLinks=[];
    try{
      UI.loading(true,'Carregando RDOs disponíveis…');
      if(typeof Cloud!=='undefined'&&Cloud.active()) remoteLinks=await Cloud.measurementLinks(projectId);
      UI.loading(false);
    }catch(err){
      UI.loading(false);
      return UI.toast('Não foi possível conferir os RDOs já medidos: '+U.esc(err.message||err),'error',7000);
    }
    const linked=new Set([
      ...State.measurements.flatMap(m=>Array.isArray(m.rdoIds)?m.rdoIds.map(String):[]),
      ...remoteLinks.map(link=>String(link.rdo_id))
    ]);
    const today=new Date();
    const initialFrom=U.isoDate(new Date(today.getFullYear(),today.getMonth(),1));
    const initialTo=U.isoDate(today);
    UI.modal({
      title:`Medição HH · ${U.esc(U.projLabel(project))}`,
      wide:true,
      body:`<div class="form-grid" style="margin-bottom:12px">
        <div><label>Início do período</label><input id="hh-from" type="date" value="${initialFrom}"></div>
        <div><label>Fim do período</label><input id="hh-to" type="date" value="${initialTo}"></div>
        <div><label>Data da medição</label><input id="hh-date" type="date" value="${initialTo}"></div>
        <div><label>Referência</label><input id="hh-ref" placeholder="Ex.: Medição 07/2026"></div>
      </div>
      <div id="hh-rdo-list"></div>
      <div class="kpi-grid" style="margin-top:12px">
        <div class="kpi"><div class="k-label">RDOs selecionados</div><div class="k-value" id="hh-count">0</div></div>
        <div class="kpi"><div class="k-label">Horas</div><div class="k-value" id="hh-hours">0h</div></div>
        <div class="kpi accent-blue"><div class="k-label">Valor da medição</div><div class="k-value" id="hh-value">${U.money(0)}</div></div>
      </div>`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="hh-save"><i data-lucide="check"></i>Criar medição</button>',
      onOpen:()=>{
        const renderAvailable=()=>{
          const from=document.getElementById('hh-from').value;
          const to=document.getElementById('hh-to').value;
          const available=State.rdos.filter(rdo=>
            String(rdo.projectId)===String(projectId)
            && rdo.status==='Aprovado'
            && rdo.date>=from && rdo.date<=to
            && !linked.has(String(rdo.id))
          );
          const box=document.getElementById('hh-rdo-list');
          box.innerHTML=available.length?`<div class="check-list">${available.map(rdo=>{
            const financial=State.rdoFinancial.find(x=>String(x.rdoId)===String(rdo.id));
            const disabled=!financial;
            return `<label class="check-item ${disabled?'disabled':''}"><input class="hh-rdo-check" type="checkbox" value="${U.esc(rdo.id)}" ${disabled?'disabled':'checked'}>
              <span><b>${U.esc(rdo.number||'RDO')} · ${U.date(rdo.date)}</b><small>${U.esc(rdo.description||'')} · ${financial?`${financial.hours||0}h · ${U.money(financial.saleTotal)}`:'Aprovação financeira pendente'}</small></span></label>`;
          }).join('')}</div>`:'<div class="empty card"><i data-lucide="clipboard-x"></i><br>Nenhum RDO aprovado e disponível neste período.</div>';
          const updateTotals=()=>{
            const ids=[...document.querySelectorAll('.hh-rdo-check:checked')].map(input=>String(input.value));
            const financial=ids.map(rdoId=>State.rdoFinancial.find(x=>String(x.rdoId)===rdoId)).filter(Boolean);
            const hours=financial.reduce((sum,row)=>sum+(Number(row.hours)||0),0);
            const value=financial.reduce((sum,row)=>sum+(Number(row.saleTotal)||0),0);
            document.getElementById('hh-count').textContent=ids.length;
            document.getElementById('hh-hours').textContent=`${hours.toLocaleString('pt-BR',{maximumFractionDigits:2})}h`;
            document.getElementById('hh-value').textContent=U.money(value);
          };
          document.querySelectorAll('.hh-rdo-check').forEach(input=>input.onchange=updateTotals);
          updateTotals(); U.icons();
        };
        document.getElementById('hh-from').onchange=renderAvailable;
        document.getElementById('hh-to').onchange=renderAvailable;
        document.getElementById('hh-save').onclick=async()=>{
          const rdoIds=[...document.querySelectorAll('.hh-rdo-check:checked')].map(input=>String(input.value));
          if(!rdoIds.length) return UI.toast('Selecione ao menos um RDO aprovado.','warn');
          const financial=rdoIds.map(rdoId=>State.rdoFinancial.find(x=>String(x.rdoId)===rdoId)).filter(Boolean);
          const value=Math.round(financial.reduce((sum,row)=>sum+(Number(row.saleTotal)||0),0)*100)/100;
          const hours=Math.round(financial.reduce((sum,row)=>sum+(Number(row.hours)||0),0)*100)/100;
          const completion=Biz.measurementCompletion(project);
          if(value>completion.remaining+0.01)
            return UI.toast(`O valor de ${U.money(value)} ultrapassa o saldo contratual de ${U.money(completion.remaining)}.`, 'warn', 8000);
          const measurement={
            id:U.id(),
            projectId:String(projectId),
            date:document.getElementById('hh-date').value,
            periodFrom:document.getElementById('hh-from').value,
            periodTo:document.getElementById('hh-to').value,
            value,
            hours,
            rdoIds,
            ref:document.getElementById('hh-ref').value.trim(),
            status:'Aguardando aprovação',
            notes:'',
            source:'rdo-hh',
            createdAt:new Date().toISOString(),
            createdBy:RDO.authorName()
          };
          try{
            UI.loading(true,'Criando medição HH…');
            if(typeof Cloud!=='undefined'&&Cloud.active())
              await Cloud.claimRdoMeasurement(rdoIds,measurement.id,projectId);
            await DB.put('measurements',measurement);
            await State.reload();
            UI.loading(false); UI.closeAll(); UI.toast('Medição HH criada com os RDOs do período.','success',6500); App.render();
          }catch(err){
            if(typeof Cloud!=='undefined'&&Cloud.active())
              await Cloud.releaseRdoMeasurement(measurement.id).catch(()=>false);
            UI.loading(false);
            UI.toast('Não foi possível criar a medição: '+U.esc(err.message||err),'error',8000);
          }
        };
        renderAvailable();
      }
    });
  },

  // v4.2.21 - VALOR/H da coluna nova do relatorio de medicao.
  // E o campo "Venda . hora normal" (saleRegular) do cadastro de valor HH do
  // colaborador naquele projeto. Preferimos o valor CONGELADO no snapshot
  // financeiro do RDO (foi o que realmente entrou na medicao) e so caimos no
  // cadastro atual quando o RDO e anterior ao snapshot com as taxas.
  // A guarda typeof existe porque os testes rodam este arquivo num vm com um
  // RDO falso que so implementa crewMembers().
  employeeHourRate(projectId,employeeId,snapshot){
    const frozen=Number(snapshot&&snapshot.saleRegular);
    if(Number.isFinite(frozen)&&frozen>0) return frozen;
    const rate=(typeof RDO!=='undefined'&&typeof RDO.rateFor==='function')
      ?RDO.rateFor(projectId,employeeId):null;
    const current=Number(rate&&rate.saleRegular);
    return Number.isFinite(current)&&current>0?current:0;
  },
  measurementRows(measurement){
    return (measurement.rdoIds||[]).flatMap(rdoId=>{
      const rdo=State.rdos.find(item=>String(item.id)===String(rdoId));
      const financial=State.rdoFinancial.find(item=>String(item.rdoId||item.id)===String(rdoId));
      if(!rdo) return [];
      return (rdo.entries||[]).filter(entry=>!(typeof RDO.isAbsent==='function'
        ?RDO.isAbsent(entry):String(entry.attendanceStatus||'').toLowerCase()==='absent')).map(entry=>{
        const snapshot=(financial?.rows||[]).find(row=>String(row.employeeId)===String(entry.employeeId));
        const employee=RDO.crewMembers().find(item=>String(item.id)===String(entry.employeeId))||{};
        const roleDisplayMode=snapshot?.roleDisplayMode||entry.roleDisplayMode||'client';
        const internalRole=snapshot?.internalRole||entry.internalRole||employee.internalRole||'';
        const commercialRole=snapshot?.commercialRole||entry.commercialRole||'';
        const regular=Number(entry.regular)||0;
        const overtime50=Number(entry.overtime50)||0;
        const overtime100=Number(entry.overtime100)||0;
        return {
          date:rdo.date,
          rdoNumber:rdo.number||String(rdo.id),
          registration:entry.employeeRegistration||snapshot?.employeeRegistration||employee.registration||'',
          employeeName:entry.employeeName||snapshot?.employeeName||employee.name||'Colaborador',
          role:roleDisplayMode==='internal'?internalRole:(commercialRole||internalRole),
          start:entry.start||'',end:entry.end||'',breakMinutes:Number(entry.breakMinutes)||0,
          regular,overtime50,overtime100,
          hours:regular+overtime50+overtime100,
          employeeId:String(entry.employeeId||''),
          hourRate:this.employeeHourRate(measurement.projectId,entry.employeeId,snapshot),
          value:Number(snapshot?.sale)||0
        };
      });
    }).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.employeeName).localeCompare(String(b.employeeName),'pt-BR'));
  },

  // v4.2.21 - exportacao XLSX da medicao.
  // Planilha simples: uma linha por colaborador/dia, com as MESMAS colunas do
  // PDF e sem cabecalho, timbrado ou linha de total - dado puro para o Excel
  // filtrar, ordenar e somar. Numeros saem como numero, nao como texto.
  measurementSheetRows(measurement){
    const round=value=>Math.round((Number(value)||0)*100)/100;
    return this.measurementRows(measurement).map(row=>({
      'Data':U.date(row.date),
      'RDO':String(row.rdoNumber||''),
      'Matrícula':String(row.registration||''),
      'Colaborador':String(row.employeeName||''),
      'Função':String(row.role||''),
      'Valor/h':round(row.hourRate),
      'Entrada':String(row.start||''),
      'Intervalo':U.durationMinutes(row.breakMinutes),
      'Saída':String(row.end||''),
      'Normal':round(row.regular),
      'HE 50%':round(row.overtime50),
      'HE 100%':round(row.overtime100),
      'Total':round(row.hours),
      'Valor medido':round(row.value)
    }));
  },
  exportXlsx(id){
    const measurement=State.measurements.find(item=>String(item.id)===String(id));
    if(!measurement) return UI.toast('Medição não encontrada.','warn');
    if(measurement.source!=='rdo-hh') return UI.toast('A planilha detalhada de horas está disponível para medições HH.','info',5500);
    if(typeof XLSX==='undefined') return UI.toast('Biblioteca de planilhas indisponível. Recarregue a página e tente de novo.','error',6500);
    const rows=this.measurementSheetRows(measurement);
    if(!rows.length) return UI.toast('Os RDOs desta medição não estão disponíveis para montar a planilha.','warn',6500);
    const sheet=XLSX.utils.json_to_sheet(rows);
    sheet['!cols']=[{wch:11},{wch:12},{wch:12},{wch:28},{wch:22},{wch:10},{wch:9},{wch:10},{wch:9},{wch:9},{wch:9},{wch:10},{wch:9},{wch:14}];
    const book=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,sheet,'Medicao');
    const label=String(measurement.ref||measurement.id||'medicao').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'');
    XLSX.writeFile(book,`medicao-${label||'hh'}-${U.isoDate(new Date())}.xlsx`);
    UI.toast('Planilha da medição exportada.','success',5000);
  },
  async print(id){
    const measurement=State.measurements.find(item=>String(item.id)===String(id));
    if(!measurement) return UI.toast('Medição não encontrada.','warn');
    if(measurement.source!=='rdo-hh') return UI.toast('O relatório detalhado de horas está disponível para medições HH.','info',5500);
    const project=State.projects.find(item=>String(item.id)===String(measurement.projectId));
    const customer=RDO.projectClient(measurement.projectId);
    const rows=this.measurementRows(measurement);
    if(!rows.length) return UI.toast('Os RDOs desta medição não estão disponíveis para montar o relatório.','warn',6500);
    const old=document.getElementById('measurement-print-report');
    if(old) old.remove();
    const report=document.createElement('section');
    report.id='measurement-print-report';
    const companyLogo=U.safeImageSrc(State.settings.companyLogo)||'assets/logo-clique.png';
    const companyCnpj=U.formatCnpj(State.settings.companyCnpj||'');
    const hours=value=>`${Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2})}h`;
    report.innerHTML=`${typeof Exports!=='undefined'?Exports.stationeryMarkup():''}
      <header class="measurement-print-head">
        <div class="measurement-print-company"><img src="${U.esc(companyLogo)}" alt=""><div><small>CONTRATADA</small><b>${U.esc(State.settings.companyName||'CliqueObras')}</b><span>${companyCnpj?`CNPJ ${U.esc(companyCnpj)} · `:''}Relatório de medição de mão de obra</span></div></div>
        <div class="measurement-print-client">${customer.logo?`<img src="${U.esc(customer.logo)}" alt="">`:`<span>${U.esc(U.initials(customer.name))}</span>`}<div><small>CLIENTE</small><b>${U.esc(customer.name)}</b><span>${U.esc(RDO.projectLabel(measurement.projectId))}</span></div></div>
        <div class="measurement-print-number"><small>MEDIÇÃO</small><b>${U.esc(measurement.ref||measurement.id)}</b><span>${U.esc(measurement.status||'Aguardando aprovação')}</span></div>
      </header>
      <div class="measurement-print-facts"><div><small>Período</small><b>${U.date(measurement.periodFrom)} a ${U.date(measurement.periodTo)}</b></div><div><small>RDOs consolidados</small><b>${(measurement.rdoIds||[]).length}</b></div><div><small>Total de horas</small><b>${hours(measurement.hours||rows.reduce((sum,row)=>sum+row.hours,0))}</b></div><div><small>Valor total da medição</small><b>${U.money(measurement.value)}</b></div></div>
      <table class="measurement-print-table"><thead><tr><th>Data</th><th>RDO</th><th>Matrícula</th><th>Colaborador</th><th>Função</th><th>Valor/h</th><th>Entrada</th><th>Intervalo</th><th>Saída</th><th>Normal</th><th>HE 50%</th><th>HE 100%</th><th>Total</th><th>Valor medido</th></tr></thead><tbody>
        ${rows.map(row=>`<tr><td>${U.date(row.date)}</td><td>${U.esc(row.rdoNumber)}</td><td>${U.esc(row.registration||'—')}</td><td>${U.esc(row.employeeName)}</td><td>${U.esc(row.role||'—')}</td><td>${U.money(row.hourRate)}</td><td>${U.esc(row.start||'—')}</td><td>${U.durationMinutes(row.breakMinutes)}</td><td>${U.esc(row.end||'—')}</td><td>${hours(row.regular)}</td><td>${hours(row.overtime50)}</td><td>${hours(row.overtime100)}</td><td><b>${hours(row.hours)}</b></td><td><b>${U.money(row.value)}</b></td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="12">TOTAL DA MEDIÇÃO</td><td>${hours(rows.reduce((sum,row)=>sum+row.hours,0))}</td><td>${U.money(measurement.value)}</td></tr></tfoot></table>
      ${measurement.notes?`<section class="measurement-print-notes"><b>Observações</b><p>${U.esc(measurement.notes)}</p></section>`:''}
      <footer>Documento gerado pelo CliqueObras em ${new Date().toLocaleString('pt-BR')}.</footer>`;
    document.body.appendChild(report);
    UI.closeAll();
    UI.loading(false);
    UI.toast('Na janela de impressão, selecione “Salvar como PDF”.','info',6000);
    await Exports.beginPrint('printing-measurement',report);
  },

  hhStatusForm(measurement){
    const canDelete=(typeof Cloud==='undefined'||!Cloud.active()||RDO.fullAccess())
      && measurement.status!=='Faturada';
    UI.modal({
      title:'Medição HH',
      body:`<div class="rdo-detail-head">
        <div><small>Projeto</small><b>${U.esc(RDO.projectLabel(measurement.projectId))}</b></div>
        <div><small>Período</small><b>${U.date(measurement.periodFrom)} a ${U.date(measurement.periodTo)}</b></div>
        <div><small>RDOs</small><b>${(measurement.rdoIds||[]).length}</b></div>
        <div><small>Valor</small><b>${U.money(measurement.value)}</b></div>
      </div>
      <div class="form-grid">
        <div><label>Status</label><select id="hh-status">${['Aguardando aprovação','Aprovada','Faturada'].map(status=>`<option ${status===measurement.status?'selected':''}>${status}</option>`).join('')}</select></div>
        <div><label>Referência</label><input id="hh-status-ref" value="${U.esc(measurement.ref||'')}"></div>
        <div class="full"><label>Observações</label><textarea id="hh-status-notes" rows="2">${U.esc(measurement.notes||'')}</textarea></div>
      </div>`,
      footer:`${canDelete?`<button class="btn btn-danger" style="margin-right:auto" onclick="Views.medicoes.remove(${U.jsArg(measurement.id)})"><i data-lucide="trash-2"></i>Excluir medição</button>`:''}
        <button class="btn btn-ghost" onclick="Views.medicoes.print(${U.jsArg(measurement.id)})"><i data-lucide="file-down"></i>Gerar PDF</button><button class="btn btn-ghost" onclick="Views.medicoes.exportXlsx(${U.jsArg(measurement.id)})"><i data-lucide="file-spreadsheet"></i>Exportar XLSX</button><button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="hh-status-save"><i data-lucide="check"></i>Salvar</button>`
    });
    document.getElementById('hh-status-save').onclick=async()=>{
      await DB.put('measurements',{
        ...measurement,
        status:document.getElementById('hh-status').value,
        ref:document.getElementById('hh-status-ref').value.trim(),
        notes:document.getElementById('hh-status-notes').value.trim(),
        updatedAt:new Date().toISOString()
      });
      await State.reload(); UI.close(); UI.toast('Medição atualizada','success'); App.render();
    };
  },

  remove(id){
    const measurement=State.measurements.find(x=>String(x.id)===String(id));
    if(!measurement) return;
    if(measurement.source==='rdo-hh' && measurement.status==='Faturada')
      return UI.toast('Uma medição HH faturada não pode ser excluída.','warn',6500);
    if(measurement.source==='rdo-hh' && typeof Cloud!=='undefined' && Cloud.active() && !RDO.fullAccess())
      return UI.toast('Somente proprietário ou administrador pode excluir uma medição HH.','warn',6500);
    const message=measurement.source==='rdo-hh'
      ? `Excluir esta medição e liberar seus <b>${(measurement.rdoIds||[]).length} RDO(s)</b> para uma nova medição?`
      : 'Excluir esta medição?';
    UI.confirm(message,async()=>{
      try{
        UI.loading(true,'Excluindo medição…');
        if(measurement.source==='rdo-hh' && typeof Cloud!=='undefined' && Cloud.active()){
          await Cloud.deleteRdoMeasurement(id);
          await DB.syncFromCloud();
        }else{
          await DB.del('measurements',id);
        }
        await State.reload();
        UI.loading(false);
        UI.toast(measurement.source==='rdo-hh'?'Medição excluída e RDOs liberados.':'Medição excluída.','warn',6000);
        App.render();
      }catch(err){
        UI.loading(false);
        UI.toast('Não foi possível excluir a medição: '+U.esc(err.message||err),'error',8000);
      }
    });
  }
};
