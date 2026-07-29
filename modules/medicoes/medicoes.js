/**
 * Medições
 *
 * - HH: valor derivado exclusivamente dos snapshots de RDOs aprovados;
 * - demais contratos: lançamento manual preservado;
 * - RDOs vinculados ficam indisponíveis para qualquer nova medição.
 */
Views.medicoes = {
  title:'Medições',

  canEdit(){
    return typeof Cloud==='undefined' || !Cloud.active() || Cloud.canEditStore('measurements');
  },
  filtered(){
    return State.measurements.filter(m=>!State.filters.project || String(m.projectId)===String(State.filters.project));
  },
  render(){
    const rows=this.filtered();
    const byProj={};
    rows.forEach(m=>(byProj[m.projectId]=byProj[m.projectId]||[]).push(m));
    const totalMeasured=rows.reduce((sum,m)=>sum+(Number(m.value)||0),0);
    const totalInvoiced=rows.filter(m=>U.norm(m.status).startsWith('faturad')).reduce((sum,m)=>sum+(Number(m.value)||0),0);
    const totalApproved=rows.filter(m=>U.norm(m.status).startsWith('aprova')).reduce((sum,m)=>sum+(Number(m.value)||0),0);
    const totalAwaiting=rows.filter(m=>U.norm(m.status)==='aguardando aprovacao').reduce((sum,m)=>sum+(Number(m.value)||0),0);
    const totalRevenue=State.projects.filter(p=>!State.filters.project||String(p.id)===String(State.filters.project)).reduce((sum,p)=>sum+(Number(p.saleValue)||0),0);
    $c().innerHTML=`<div class="toolbar">
      <div><h2>Medições e faturamento</h2><small>HH é consolidado pelos RDOs; obra e fornecimento permanecem manuais.</small></div>
      <div class="spacer"></div>
      ${this.canEdit()?'<button class="btn btn-primary" onclick="Views.medicoes.form()"><i data-lucide="plus"></i>Nova Medição</button>':''}
    </div>
    <div class="kpi-grid">
      <div class="kpi accent-blue"><div class="k-label"><i data-lucide="banknote"></i>Receita Contratada</div><div class="k-value">${U.money(totalRevenue)}</div></div>
      <div class="kpi accent-green"><div class="k-label"><i data-lucide="ruler"></i>Total Medido</div><div class="k-value">${U.money(totalMeasured)}</div><div class="k-sub">Faturado: ${U.money(totalInvoiced)}</div></div>
      <div class="kpi accent-blue"><div class="k-label"><i data-lucide="badge-check"></i>Aprovado</div><div class="k-value">${U.money(totalApproved)}</div></div>
      <div class="kpi accent-amber"><div class="k-label"><i data-lucide="clock-3"></i>Aguardando aprovação</div><div class="k-value">${U.money(totalAwaiting)}</div></div>
      <div class="kpi"><div class="k-label"><i data-lucide="file-clock"></i>Saldo a Medir</div><div class="k-value">${U.money(totalRevenue-totalMeasured)}</div></div>
    </div>
    ${Object.keys(byProj).length?Object.entries(byProj).map(([projectId,items])=>{
      const project=State.projects.find(x=>String(x.id)===String(projectId));
      const measured=items.reduce((sum,m)=>sum+(Number(m.value)||0),0);
      const invoiced=items.filter(m=>U.norm(m.status).startsWith('faturad')).reduce((sum,m)=>sum+(Number(m.value)||0),0);
      const approved=items.filter(m=>U.norm(m.status).startsWith('aprova')).reduce((sum,m)=>sum+(Number(m.value)||0),0);
      const awaiting=items.filter(m=>U.norm(m.status)==='aguardando aprovacao').reduce((sum,m)=>sum+(Number(m.value)||0),0);
      const pct=project&&project.saleValue>0?measured/project.saleValue*100:null;
      return `<div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          <h3>${U.esc(U.projLabel(project))}</h3>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="color:var(--green)">${U.money(invoiced)} faturado</b><span class="tag tag-blue">${U.money(approved)} aprovado</span><span class="tag tag-amber">${U.money(awaiting)} aguardando</span><span class="tag ${pct!=null&&pct>=100?'tag-green':'tag-blue'}">${U.pct(pct)} medido</span></div>
        </div>
        <div class="progress" style="margin-bottom:10px"><div style="width:${Math.min(100,pct||0)}%;background:var(--green)"></div></div>
        <div class="table-scroll" style="max-height:260px"><table>
          <thead><tr><th>Data</th><th>Referência</th><th>Origem</th><th>Status</th><th class="num">Valor Medido</th><th></th></tr></thead>
          <tbody>${items.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).map(m=>`<tr>
            <td>${U.date(m.date)}</td><td>${U.esc(m.ref||'—')}</td>
            <td><span class="tag tag-gray">${m.source==='rdo-hh'?`${(m.rdoIds||[]).length} RDO(s)`:'Manual'}</span></td>
            <td><span class="tag ${{Faturada:'tag-green',Aprovada:'tag-blue','Aguardando aprovação':'tag-amber'}[m.status]||'tag-gray'}">${U.esc(m.status||'—')}</span></td>
            <td class="num"><b>${U.money2(m.value)}</b></td>
            <td>${this.canEdit()?`<button class="btn btn-ghost btn-sm" onclick="Views.medicoes.form(${U.jsArg(m.id)})"><i data-lucide="pencil"></i></button>`:''}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
    }).join(''):'<div class="empty card"><i data-lucide="ruler"></i><br>Nenhuma medição registrada.</div>'}`;
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

  hhStatusForm(measurement){
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
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="hh-status-save"><i data-lucide="check"></i>Salvar</button>'
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
    if(!measurement||measurement.source==='rdo-hh') return;
    UI.confirm('Excluir esta medição?',async()=>{
      await DB.del('measurements',id); await State.reload(); UI.toast('Medição excluída','warn'); App.render();
    });
  }
};
