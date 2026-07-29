/**
 * RDO e Mão de Obra
 *
 * Dados operacionais, custos e valores comerciais ficam em stores separados:
 * - rdos: cabeçalho, atividade e horas, sem valores financeiros;
 * - crew: identificação operacional dos colaboradores;
 * - labor_rates: custo e venda por colaborador/projeto;
 * - rdo_financial: snapshot imutável criado na aprovação.
 */
const RDO = {
  statuses:['Rascunho','Enviado','Aprovado','Devolvido'],

  fullAccess(){
    return typeof Cloud==='undefined' || !Cloud.active() || ['owner','admin'].includes(Cloud.role());
  },
  canApprove(){
    return this.fullAccess()
      && (typeof Cloud==='undefined' || !Cloud.active() || (
        Cloud.canEditStore('rdos') &&
        Cloud.canEditStore('purchases') &&
        Cloud.canEditStore('labor_rates') &&
        Cloud.canEditStore('rdo_financial')
      ));
  },
  allowedProjects(){
    if(typeof Cloud==='undefined' || !Cloud.active() || this.fullAccess())
      return State.projects.map(p=>({id:String(p.id),label:U.projLabel(p),type:p.type||'Obra'}));
    return Cloud.rdoProjects().map(p=>({id:String(p.id),label:p.label,type:''}));
  },
  projectLabel(projectId){
    const project=State.projects.find(p=>String(p.id)===String(projectId));
    if(project) return U.projLabel(project);
    return this.allowedProjects().find(p=>p.id===String(projectId))?.label || 'Projeto';
  },
  activeCrew(){
    return State.crew.filter(x=>x.active!==false).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  },
  linkedRdoIds(){
    return new Set(State.measurements.flatMap(m=>Array.isArray(m.rdoIds)?m.rdoIds.map(String):[]));
  },
  workedHours(start,end,breakMinutes=0){
    const toMinutes=value=>{
      const match=String(value||'').match(/^(\d{1,2}):(\d{2})$/);
      return match ? Number(match[1])*60+Number(match[2]) : null;
    };
    const from=toMinutes(start), to=toMinutes(end);
    if(from==null || to==null) return {total:0,regular:0,overtime50:0,overtime100:0};
    let minutes=to-from;
    if(minutes<0) minutes+=24*60;
    minutes=Math.max(0,minutes-(Number(breakMinutes)||0));
    const total=Math.round(minutes/60*100)/100;
    const regular=Math.min(8,total);
    return {total,regular,overtime50:Math.max(0,total-regular),overtime100:0};
  },
  rateFor(projectId,employeeId){
    return State.laborRates.find(rate=>
      String(rate.projectId)===String(projectId)
      && String(rate.employeeId)===String(employeeId)
      && rate.active!==false
    ) || null;
  },
  entryTotals(entry,rate){
    const regular=Number(entry.regular)||0;
    const overtime50=Number(entry.overtime50)||0;
    const overtime100=Number(entry.overtime100)||0;
    return {
      hours:regular+overtime50+overtime100,
      cost:regular*(Number(rate.costRegular)||0)
        + overtime50*(Number(rate.cost50)||0)
        + overtime100*(Number(rate.cost100)||0),
      sale:regular*(Number(rate.saleRegular)||0)
        + overtime50*(Number(rate.sale50)||0)
        + overtime100*(Number(rate.sale100)||0)
    };
  },
  calculate(rdo){
    const rows=(rdo.entries||[]).map(entry=>{
      const employee=State.crew.find(x=>String(x.id)===String(entry.employeeId))||{};
      const rate=this.rateFor(rdo.projectId,entry.employeeId);
      const totals=rate?this.entryTotals(entry,rate):{hours:0,cost:0,sale:0};
      return {
        ...entry,
        employeeName:employee.name||entry.employeeName||'Colaborador',
        internalRole:employee.internalRole||entry.internalRole||'',
        commercialRole:(rate&&rate.commercialRole)||entry.commercialRole||employee.internalRole||'',
        rate,
        ...totals
      };
    });
    return {
      rows,
      hours:rows.reduce((sum,row)=>sum+row.hours,0),
      costTotal:rows.reduce((sum,row)=>sum+row.cost,0),
      saleTotal:rows.reduce((sum,row)=>sum+row.sale,0),
      missingRates:rows.filter(row=>!row.rate)
    };
  },
  statusTag(status){
    const tone={Aprovado:'tag-green',Enviado:'tag-amber',Devolvido:'tag-red',Rascunho:'tag-gray'}[status]||'tag-gray';
    return `<span class="tag ${tone}">${U.esc(status||'Rascunho')}</span>`;
  },
  authorName(){
    const user=typeof Cloud!=='undefined'&&Cloud.active()?Cloud.user()||{}:{};
    return String(user.user_metadata?.full_name||user.email||'Usuário');
  },
  canEdit(rdo){
    if(!rdo || !['Rascunho','Devolvido'].includes(rdo.status||'Rascunho')) return false;
    return typeof Cloud==='undefined' || !Cloud.active() || Cloud.canEditStore('rdos');
  },

  async save(rdo,status){
    if(!rdo.projectId || !rdo.date) throw new Error('Informe o projeto e a data.');
    if(!String(rdo.description||'').trim()) throw new Error('Descreva o serviço realizado.');
    if(!Array.isArray(rdo.entries) || !rdo.entries.length) throw new Error('Selecione ao menos um colaborador.');
    if(rdo.entries.some(row=>(Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0)<=0))
      throw new Error('Todos os colaboradores selecionados precisam ter horas informadas.');
    const allowed=new Set(this.allowedProjects().map(x=>String(x.id)));
    if(!allowed.has(String(rdo.projectId))) throw new Error('Projeto indisponível para este RDO.');
    const updated={
      ...rdo,
      status,
      updatedAt:new Date().toISOString(),
      submittedAt:status==='Enviado'?new Date().toISOString():(rdo.submittedAt||null)
    };
    await DB.put('rdos',updated);
    await State.reload();
    return updated;
  },

  async approve(id){
    const rdo=State.rdos.find(x=>String(x.id)===String(id));
    if(!rdo || rdo.status!=='Enviado' || !this.canApprove()) return;
    const calculation=this.calculate(rdo);
    if(calculation.missingRates.length){
      const names=calculation.missingRates.map(x=>x.employeeName).join(', ');
      return UI.toast(`Configure os valores do projeto para: ${U.esc(names)}.`, 'warn', 8000);
    }
    const financial={
      id:String(rdo.id),
      rdoId:String(rdo.id),
      projectId:String(rdo.projectId),
      rdoDate:rdo.date,
      costTotal:Math.round(calculation.costTotal*100)/100,
      saleTotal:Math.round(calculation.saleTotal*100)/100,
      hours:Math.round(calculation.hours*100)/100,
      rows:calculation.rows.map(row=>({
        employeeId:String(row.employeeId),
        employeeName:row.employeeName,
        internalRole:row.internalRole,
        commercialRole:row.commercialRole,
        regular:Number(row.regular)||0,
        overtime50:Number(row.overtime50)||0,
        overtime100:Number(row.overtime100)||0,
        costRegular:Number(row.rate.costRegular)||0,
        cost50:Number(row.rate.cost50)||0,
        cost100:Number(row.rate.cost100)||0,
        saleRegular:Number(row.rate.saleRegular)||0,
        sale50:Number(row.rate.sale50)||0,
        sale100:Number(row.rate.sale100)||0,
        cost:Math.round(row.cost*100)/100,
        sale:Math.round(row.sale*100)/100
      })),
      approvedAt:new Date().toISOString(),
      approvedBy:this.authorName()
    };
    const purchaseId=`rdo-cost-${rdo.id}`;
    const purchase={
      id:purchaseId,
      projectId:String(rdo.projectId),
      date:rdo.date,
      category:'Mão de Obra',
      desc:`Custo da mão de obra · ${rdo.number||rdo.id}`,
      supplier:'Equipe própria',
      value:financial.costTotal,
      source:'rdo-cost',
      sourceRdoId:String(rdo.id),
      abatido:false,
      createdAt:Date.now()
    };
    try{
      UI.loading(true,'Aprovando diário…');
      await DB.put('rdo_financial',financial);
      if(typeof Cloud!=='undefined' && Cloud.active())
        await Cloud.ensureRdoCostPosting(rdo.id,rdo.projectId,purchaseId,financial.costTotal);
      await DB.put('purchases',purchase);
      await DB.put('rdos',{
        ...rdo,
        status:'Aprovado',
        approvedAt:financial.approvedAt,
        approvedBy:financial.approvedBy,
        updatedAt:financial.approvedAt
      });
      await State.reload();
      UI.loading(false);
      UI.closeAll();
      UI.toast('RDO aprovado. O custo da mão de obra entrou no realizado do projeto.','success',7000);
      App.render();
    }catch(err){
      UI.loading(false);
      UI.toast('Não foi possível aprovar o RDO: '+U.esc(err.message||err),'error',8000);
    }
  },

  async returnToDraft(id){
    const rdo=State.rdos.find(x=>String(x.id)===String(id));
    if(!rdo || rdo.status!=='Enviado') return;
    await DB.put('rdos',{...rdo,status:'Rascunho',submittedAt:null,updatedAt:new Date().toISOString()});
    await State.reload();
    UI.toast('RDO devolvido ao rascunho','success');
    App.render();
  },

  form(id=''){
    const existing=id?State.rdos.find(x=>String(x.id)===String(id)):null;
    if(existing && !this.canEdit(existing)) return this.detail(id);
    const projects=this.allowedProjects();
    const crew=this.activeCrew();
    if(!projects.length) return UI.toast('Nenhum projeto foi disponibilizado para preenchimento de RDO.','warn',6500);
    if(!crew.length) return UI.toast('Cadastre a equipe antes de criar o primeiro RDO.','warn',6500);
    const initialEntries=new Map((existing?.entries||[]).map(row=>[String(row.employeeId),row]));
    const defaultShift={start:'07:30',end:'17:30',breakMinutes:60};
    const defaultHours=this.workedHours(defaultShift.start,defaultShift.end,defaultShift.breakMinutes);
    const workerCard=employee=>{
      const saved=initialEntries.get(String(employee.id));
      const selected=existing?!!saved:true;
      const row=saved||{...defaultShift,...defaultHours};
      return `<article class="rdo-worker-card ${selected?'selected':''}" data-employee-id="${U.esc(employee.id)}">
        <div class="rdo-worker-head">
          <label class="rdo-worker-select"><input type="checkbox" ${selected?'checked':''}><span class="avatar-ph">${U.initials(employee.name||'CO')}</span>
            <span><b>${U.esc(employee.name||'Colaborador')}</b><small>${U.esc(employee.internalRole||'Sem função')}</small></span></label>
          <span class="rdo-worker-total">${U.pct((Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0)).replace('%','h')}</span>
        </div>
        <div class="rdo-worker-fields">
          <label>Entrada<input data-field="start" type="time" value="${U.esc(row.start||defaultShift.start)}"></label>
          <label>Saída<input data-field="end" type="time" value="${U.esc(row.end||defaultShift.end)}"></label>
          <label>Intervalo<input data-field="breakMinutes" type="number" min="0" max="360" step="5" value="${Number(row.breakMinutes)||0}"></label>
          <label>Normal<input data-field="regular" type="number" min="0" max="24" step="0.25" value="${Number(row.regular)||0}"></label>
          <label>HE 50%<input data-field="overtime50" type="number" min="0" max="24" step="0.25" value="${Number(row.overtime50)||0}"></label>
          <label>HE 100%<input data-field="overtime100" type="number" min="0" max="24" step="0.25" value="${Number(row.overtime100)||0}"></label>
        </div>
      </article>`;
    };
    UI.modal({
      title:existing?`Editar ${U.esc(existing.number||'RDO')}`:'Novo Diário de Obra',
      wide:true,
      body:`<div class="rdo-form">
        <div class="form-grid">
          <div><label>Projeto *</label><select id="rdo-project">${projects.map(project=>`<option value="${U.esc(project.id)}" ${String(project.id)===String(existing?.projectId||'')?'selected':''}>${U.esc(project.label)}</option>`).join('')}</select></div>
          <div><label>Data *</label><input id="rdo-date" type="date" value="${U.esc(existing?.date||U.isoDate(new Date()))}"></div>
          <div class="full"><label>Local / frente de serviço</label><input id="rdo-location" maxlength="180" value="${U.esc(existing?.location||'')}" placeholder="Ex.: Subestação SE-04"></div>
          <div class="full"><label>Serviço realizado *</label><textarea id="rdo-description" rows="3" maxlength="1600" placeholder="Descreva claramente o que foi executado.">${U.esc(existing?.description||'')}</textarea></div>
        </div>
        <section class="rdo-team-section">
          <div class="rdo-section-title"><div><h3>Equipe e horas trabalhadas</h3><small>O horário informado abaixo é aplicado automaticamente a todos os colaboradores selecionados.</small></div></div>
          <div class="rdo-team-template">
            <label>Entrada<input id="rdo-all-start" type="time" value="${defaultShift.start}"></label>
            <label>Saída<input id="rdo-all-end" type="time" value="${defaultShift.end}"></label>
            <label>Intervalo (min)<input id="rdo-all-break" type="number" min="0" max="360" step="5" value="${defaultShift.breakMinutes}"></label>
            <label>Normal<input id="rdo-all-regular" type="number" min="0" max="24" step="0.25" value="${defaultHours.regular}"></label>
            <label>HE 50%<input id="rdo-all-50" type="number" min="0" max="24" step="0.25" value="${defaultHours.overtime50}"></label>
            <label>HE 100%<input id="rdo-all-100" type="number" min="0" max="24" step="0.25" value="0"></label>
          </div>
          <div class="rdo-worker-list">${crew.map(workerCard).join('')}</div>
        </section>
        <div class="form-grid">
          <div class="full"><label>Ocorrências e observações</label><textarea id="rdo-notes" rows="2" maxlength="1200">${U.esc(existing?.notes||'')}</textarea></div>
        </div>
      </div>`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
        <button class="btn btn-ghost" id="rdo-save-draft"><i data-lucide="save"></i>Salvar rascunho</button>
        <button class="btn btn-primary" id="rdo-submit"><i data-lucide="send"></i>Enviar para aprovação</button>`,
      onOpen:()=>{
        const cards=[...document.querySelectorAll('.rdo-worker-card')];
        const refreshTotal=card=>{
          const total=['regular','overtime50','overtime100'].reduce((sum,key)=>sum+U.num(card.querySelector(`[data-field="${key}"]`).value),0);
          card.querySelector('.rdo-worker-total').textContent=`${total.toLocaleString('pt-BR',{maximumFractionDigits:2})}h`;
        };
        cards.forEach(card=>{
          const checkbox=card.querySelector('.rdo-worker-select input');
          checkbox.onchange=()=>card.classList.toggle('selected',checkbox.checked);
          card.querySelectorAll('[data-field="start"],[data-field="end"],[data-field="breakMinutes"]').forEach(input=>input.onchange=()=>{
            const hours=this.workedHours(
              card.querySelector('[data-field="start"]').value,
              card.querySelector('[data-field="end"]').value,
              card.querySelector('[data-field="breakMinutes"]').value
            );
            card.querySelector('[data-field="regular"]').value=hours.regular;
            card.querySelector('[data-field="overtime50"]').value=hours.overtime50;
            refreshTotal(card);
          });
          card.querySelectorAll('[data-field="regular"],[data-field="overtime50"],[data-field="overtime100"]').forEach(input=>input.oninput=()=>refreshTotal(card));
          refreshTotal(card);
        });
        const applyToAll=()=>{
          const values={
            start:document.getElementById('rdo-all-start').value,
            end:document.getElementById('rdo-all-end').value,
            breakMinutes:document.getElementById('rdo-all-break').value,
            regular:document.getElementById('rdo-all-regular').value,
            overtime50:document.getElementById('rdo-all-50').value,
            overtime100:document.getElementById('rdo-all-100').value
          };
          cards.filter(card=>card.querySelector('.rdo-worker-select input').checked).forEach(card=>{
            Object.entries(values).forEach(([field,value])=>card.querySelector(`[data-field="${field}"]`).value=value);
            refreshTotal(card);
          });
        };
        const recalcTemplate=()=>{
          const hours=this.workedHours(
            document.getElementById('rdo-all-start').value,
            document.getElementById('rdo-all-end').value,
            document.getElementById('rdo-all-break').value
          );
          document.getElementById('rdo-all-regular').value=hours.regular;
          document.getElementById('rdo-all-50').value=hours.overtime50;
          applyToAll();
        };
        ['rdo-all-start','rdo-all-end','rdo-all-break'].forEach(id=>document.getElementById(id).onchange=recalcTemplate);
        ['rdo-all-regular','rdo-all-50','rdo-all-100'].forEach(id=>document.getElementById(id).oninput=applyToAll);
        const collect=()=>({
          ...(existing||{
            id:U.id(),
            number:`RDO-${new Date().getFullYear()}-${String(State.rdos.length+1).padStart(4,'0')}`,
            createdAt:new Date().toISOString(),
            createdBy:this.authorName()
          }),
          projectId:document.getElementById('rdo-project').value,
          date:document.getElementById('rdo-date').value,
          location:document.getElementById('rdo-location').value.trim(),
          description:document.getElementById('rdo-description').value.trim(),
          notes:document.getElementById('rdo-notes').value.trim(),
          entries:cards.filter(card=>card.querySelector('.rdo-worker-select input').checked).map(card=>{
            const employee=State.crew.find(x=>String(x.id)===String(card.dataset.employeeId))||{};
            return {
              employeeId:String(card.dataset.employeeId),
              employeeName:employee.name||'Colaborador',
              internalRole:employee.internalRole||'',
              start:card.querySelector('[data-field="start"]').value,
              end:card.querySelector('[data-field="end"]').value,
              breakMinutes:U.num(card.querySelector('[data-field="breakMinutes"]').value),
              regular:U.num(card.querySelector('[data-field="regular"]').value),
              overtime50:U.num(card.querySelector('[data-field="overtime50"]').value),
              overtime100:U.num(card.querySelector('[data-field="overtime100"]').value)
            };
          })
        });
        const persist=async status=>{
          try{
            await this.save(collect(),status);
            UI.close();
            UI.toast(status==='Enviado'?'RDO enviado para aprovação':'Rascunho salvo','success');
            App.render();
          }catch(err){ UI.toast(U.esc(err.message||err),'warn',6500); }
        };
        document.getElementById('rdo-save-draft').onclick=()=>persist('Rascunho');
        document.getElementById('rdo-submit').onclick=()=>persist('Enviado');
      }
    });
  },

  detail(id){
    const rdo=State.rdos.find(x=>String(x.id)===String(id));
    if(!rdo) return;
    const linked=this.linkedRdoIds().has(String(rdo.id));
    const showFinancial=(typeof Cloud==='undefined'||!Cloud.active()||Cloud.canViewStore('rdo_financial'));
    const financial=State.rdoFinancial.find(x=>String(x.rdoId)===String(rdo.id));
    UI.modal({
      title:U.esc(rdo.number||'Diário de Obra'),
      wide:true,
      body:`<div class="rdo-detail-head">
        <div><small>Projeto</small><b>${U.esc(this.projectLabel(rdo.projectId))}</b></div>
        <div><small>Data</small><b>${U.date(rdo.date)}</b></div>
        <div><small>Status</small>${this.statusTag(rdo.status)}</div>
        <div><small>Medição</small><b>${linked?'Incluído em medição':'Não medido'}</b></div>
      </div>
      <div class="card rdo-description-card"><h3>Serviço realizado</h3><p>${U.esc(rdo.description||'—')}</p>${rdo.location?`<small>${U.esc(rdo.location)}</small>`:''}</div>
      <div class="rdo-detail-workers">${(rdo.entries||[]).map(row=>`<div>
        <span class="avatar-ph">${U.initials(row.employeeName||'CO')}</span>
        <span><b>${U.esc(row.employeeName||'Colaborador')}</b><small>${U.esc(row.internalRole||'')}</small></span>
        <span><small>Normal</small><b>${U.pct(row.regular||0).replace('%','h')}</b></span>
        <span><small>HE 50%</small><b>${U.pct(row.overtime50||0).replace('%','h')}</b></span>
        <span><small>HE 100%</small><b>${U.pct(row.overtime100||0).replace('%','h')}</b></span>
      </div>`).join('')}</div>
      ${showFinancial&&financial?`<div class="kpi-grid rdo-financial-summary">
        <div class="kpi"><div class="k-label">Custo realizado</div><div class="k-value">${U.money(financial.costTotal)}</div></div>
        <div class="kpi accent-blue"><div class="k-label">Venda apurada</div><div class="k-value">${U.money(financial.saleTotal)}</div></div>
      </div>`:''}
      ${rdo.notes?`<div class="import-log"><b>Observações:</b> ${U.esc(rdo.notes)}</div>`:''}`,
      footer:`${this.canEdit(rdo)?`<button class="btn btn-ghost" onclick="UI.close();RDO.form(${U.jsArg(rdo.id)})"><i data-lucide="pencil"></i>Editar</button>`:''}
        ${rdo.status==='Enviado'&&typeof Cloud!=='undefined'&&Cloud.canEditStore('rdos')?`<button class="btn btn-ghost" onclick="UI.close();RDO.returnToDraft(${U.jsArg(rdo.id)})"><i data-lucide="undo-2"></i>Voltar para rascunho</button>`:''}
        ${rdo.status==='Enviado'&&this.canApprove()?`<button class="btn btn-primary" onclick="RDO.approve(${U.jsArg(rdo.id)})"><i data-lucide="badge-check"></i>Aprovar diário</button>`:''}
        <button class="btn btn-ghost" onclick="UI.close()">Fechar</button>`
    });
  }
};

Views.rdos={
  title:'Diários de Obra',
  render(){
    const linked=RDO.linkedRdoIds();
    const projectIds=new Set(RDO.allowedProjects().map(x=>String(x.id)));
    const rows=State.rdos
      .filter(rdo=>projectIds.has(String(rdo.projectId)))
      .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const approved=rows.filter(x=>x.status==='Aprovado').length;
    const pending=rows.filter(x=>x.status==='Enviado').length;
    const hours=rows.reduce((sum,rdo)=>sum+(rdo.entries||[]).reduce((s,row)=>s+(Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0),0),0);
    $c().innerHTML=`<div class="toolbar">
      <div><h2>RDO e apontamento de equipe</h2><small>Registro operacional por projeto, data e colaborador.</small></div>
      <div class="spacer"></div>
      ${typeof Cloud==='undefined'||!Cloud.active()||Cloud.canEditStore('rdos')?'<button class="btn btn-primary" onclick="RDO.form()"><i data-lucide="plus"></i>Novo RDO</button>':''}
    </div>
    <div class="kpi-grid rdo-kpis">
      <div class="kpi"><div class="k-label">Diários</div><div class="k-value">${rows.length}</div></div>
      <div class="kpi accent-amber"><div class="k-label">Aguardando aprovação</div><div class="k-value">${pending}</div></div>
      <div class="kpi accent-green"><div class="k-label">Aprovados</div><div class="k-value">${approved}</div></div>
      <div class="kpi accent-blue"><div class="k-label">Horas registradas</div><div class="k-value">${hours.toLocaleString('pt-BR',{maximumFractionDigits:2})}h</div></div>
    </div>
    <div class="rdo-list">${rows.map(rdo=>{
      const total=(rdo.entries||[]).reduce((sum,row)=>sum+(Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0),0);
      return `<button class="rdo-list-card" onclick="RDO.detail(${U.jsArg(rdo.id)})">
        <span class="rdo-date"><b>${String(rdo.date||'').slice(8,10)||'—'}</b><small>${U.date(rdo.date)}</small></span>
        <span class="rdo-main"><b>${U.esc(rdo.number||'RDO')}</b><small>${U.esc(RDO.projectLabel(rdo.projectId))}</small><em>${U.esc(rdo.description||'')}</em></span>
        <span class="rdo-team"><b>${(rdo.entries||[]).length}</b><small>pessoas</small></span>
        <span class="rdo-hours"><b>${total.toLocaleString('pt-BR',{maximumFractionDigits:2})}h</b><small>apontadas</small></span>
        <span class="rdo-status">${RDO.statusTag(rdo.status)}${linked.has(String(rdo.id))?'<small>Medido</small>':''}</span>
        <i data-lucide="chevron-right"></i>
      </button>`;
    }).join('')||'<div class="empty card"><i data-lucide="clipboard-check"></i><br>Nenhum diário registrado.</div>'}</div>`;
    U.icons();
  }
};

Views.colaboradores={
  title:'Colaboradores',
  render(){
    const canEdit=typeof Cloud==='undefined'||!Cloud.active()||Cloud.canEditStore('crew');
    $c().innerHTML=`<div class="toolbar"><div><h2>Equipe</h2><small>Colaboradores disponíveis para os diários.</small></div><div class="spacer"></div>
      ${canEdit?'<button class="btn btn-primary" onclick="Views.colaboradores.form()"><i data-lucide="user-plus"></i>Novo colaborador</button>':''}</div>
      <div class="crew-directory">${State.crew.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))).map(employee=>`<div class="crew-card ${employee.active===false?'inactive':''}">
        <span class="avatar-ph">${U.initials(employee.name||'CO')}</span>
        <span><b>${U.esc(employee.name||'Colaborador')}</b><small>${U.esc(employee.internalRole||'Sem função')}</small></span>
        <span class="tag ${employee.active===false?'tag-gray':'tag-green'}">${employee.active===false?'Inativo':'Ativo'}</span>
        ${canEdit?`<button class="btn btn-ghost btn-sm" onclick="Views.colaboradores.form(${U.jsArg(employee.id)})"><i data-lucide="pencil"></i></button>`:''}
      </div>`).join('')||'<div class="empty card"><i data-lucide="users-round"></i><br>Nenhum colaborador cadastrado.</div>'}</div>`;
    U.icons();
  },
  form(id=''){
    if(typeof Cloud!=='undefined'&&Cloud.active()&&!Cloud.canEditStore('crew')) return;
    const employee=id?State.crew.find(x=>String(x.id)===String(id)):{name:'',internalRole:'',active:true};
    UI.modal({title:id?'Editar colaborador':'Novo colaborador',body:`<div class="form-grid">
      <div class="full"><label>Nome *</label><input id="crew-name" maxlength="140" value="${U.esc(employee.name||'')}"></div>
      <div><label>Função interna</label><input id="crew-role" maxlength="120" value="${U.esc(employee.internalRole||'')}"></div>
      <div><label>Status</label><select id="crew-active"><option value="true" ${employee.active!==false?'selected':''}>Ativo</option><option value="false" ${employee.active===false?'selected':''}>Inativo</option></select></div>
    </div>`,footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="crew-save"><i data-lucide="check"></i>Salvar</button>'});
    document.getElementById('crew-save').onclick=async()=>{
      const name=document.getElementById('crew-name').value.trim();
      if(!name) return UI.toast('Informe o nome do colaborador','warn');
      await DB.put('crew',{...(id?employee:{id:U.id(),createdAt:new Date().toISOString()}),name,internalRole:document.getElementById('crew-role').value.trim(),active:document.getElementById('crew-active').value==='true',updatedAt:new Date().toISOString()});
      await State.reload(); UI.close(); UI.toast('Colaborador salvo','success'); App.render();
    };
  }
};

Views.valoreshh={
  title:'Valores HH',
  render(){
    const canEdit=typeof Cloud==='undefined'||!Cloud.active()||Cloud.canEditStore('labor_rates');
    const rows=State.laborRates.slice().sort((a,b)=>RDO.projectLabel(a.projectId).localeCompare(RDO.projectLabel(b.projectId)));
    $c().innerHTML=`<div class="toolbar"><div><h2>Custos e valores por projeto</h2><small>As tarifas são congeladas no momento da aprovação do RDO.</small></div><div class="spacer"></div>
      ${canEdit?'<button class="btn btn-primary" onclick="Views.valoreshh.form()"><i data-lucide="plus"></i>Configurar valor</button>':''}</div>
      <div class="rate-list">${rows.map(rate=>{
        const employee=State.crew.find(x=>String(x.id)===String(rate.employeeId))||{};
        return `<${canEdit?'button':'div'} class="rate-card"${canEdit?` onclick="Views.valoreshh.form(${U.jsArg(rate.id)})"`:''}>
          <span><b>${U.esc(employee.name||'Colaborador')}</b><small>${U.esc(RDO.projectLabel(rate.projectId))} · ${U.esc(rate.commercialRole||employee.internalRole||'')}</small></span>
          <span><small>Custo normal</small><b>${U.money(rate.costRegular)}/h</b></span>
          <span><small>Venda normal</small><b>${U.money(rate.saleRegular)}/h</b></span>
          <i data-lucide="chevron-right"></i>
        </${canEdit?'button':'div'}>`;
      }).join('')||'<div class="empty card"><i data-lucide="badge-dollar-sign"></i><br>Nenhum valor configurado.</div>'}</div>`;
    U.icons();
  },
  form(id=''){
    if(typeof Cloud!=='undefined'&&Cloud.active()&&!Cloud.canEditStore('labor_rates')) return;
    const rate=id?State.laborRates.find(x=>String(x.id)===String(id)):{
      projectId:State.projects[0]?.id||'',employeeId:State.crew[0]?.id||'',commercialRole:'',
      costRegular:0,cost50:0,cost100:0,saleRegular:0,sale50:0,sale100:0,active:true
    };
    if(!State.projects.length||!State.crew.length) return UI.toast('Cadastre um projeto e um colaborador antes de configurar valores.','warn',6500);
    const field=(label,key)=>`<div><label>${label}</label><input id="rate-${key}" type="number" min="0" step="0.01" value="${Number(rate[key])||''}"></div>`;
    UI.modal({title:id?'Editar valores':'Configurar valores',wide:true,body:`<div class="form-grid">
      <div><label>Projeto *</label><select id="rate-project">${State.projects.map(p=>`<option value="${U.esc(p.id)}" ${String(p.id)===String(rate.projectId)?'selected':''}>${U.esc(U.projLabel(p))}</option>`).join('')}</select></div>
      <div><label>Colaborador *</label><select id="rate-employee">${State.crew.filter(x=>x.active!==false||String(x.id)===String(rate.employeeId)).map(employee=>`<option value="${U.esc(employee.id)}" ${String(employee.id)===String(rate.employeeId)?'selected':''}>${U.esc(employee.name)}</option>`).join('')}</select></div>
      <div class="full"><label>Função apresentada ao cliente</label><input id="rate-role" maxlength="140" value="${U.esc(rate.commercialRole||'')}"></div>
      ${field('Custo · hora normal','costRegular')}${field('Venda · hora normal','saleRegular')}
      ${field('Custo · HE 50%','cost50')}${field('Venda · HE 50%','sale50')}
      ${field('Custo · HE 100%','cost100')}${field('Venda · HE 100%','sale100')}
    </div>`,footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="rate-save"><i data-lucide="check"></i>Salvar</button>'});
    document.getElementById('rate-save').onclick=async()=>{
      const projectId=document.getElementById('rate-project').value;
      const employeeId=document.getElementById('rate-employee').value;
      const existing=State.laborRates.find(x=>String(x.projectId)===String(projectId)&&String(x.employeeId)===String(employeeId)&&String(x.id)!==String(id));
      if(existing) return UI.toast('Já existe uma configuração para este colaborador no projeto.','warn');
      const obj={
        ...(id?rate:{id:`${projectId}:${employeeId}`,createdAt:new Date().toISOString()}),
        projectId,employeeId,commercialRole:document.getElementById('rate-role').value.trim(),
        costRegular:U.num(document.getElementById('rate-costRegular').value),
        saleRegular:U.num(document.getElementById('rate-saleRegular').value),
        cost50:U.num(document.getElementById('rate-cost50').value),
        sale50:U.num(document.getElementById('rate-sale50').value),
        cost100:U.num(document.getElementById('rate-cost100').value),
        sale100:U.num(document.getElementById('rate-sale100').value),
        active:true,updatedAt:new Date().toISOString()
      };
      await DB.put('labor_rates',obj); await State.reload(); UI.close(); UI.toast('Valores salvos','success'); App.render();
    };
  }
};
