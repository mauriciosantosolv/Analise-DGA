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
  attachmentCache:new Map(),
  attachmentUrls:new Set(),

  formatFileSize(bytes){
    const size=Number(bytes)||0;
    if(size<1024) return `${size} B`;
    if(size<1024*1024) return `${(size/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} KB`;
    return `${(size/1024/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB`;
  },
  isImage(attachment){
    return /^image\/(?:jpeg|png|webp)$/i.test(String(attachment&&attachment.mimeType||''));
  },
  validateAttachmentFile(file){
    const allowed=new Set(['image/jpeg','image/png','image/webp','application/pdf']);
    if(!file || !allowed.has(String(file.type||'').toLowerCase()))
      throw new Error('Use fotos JPG, PNG ou WebP, ou documentos PDF.');
    if(!file.size || file.size>8*1024*1024)
      throw new Error('Cada anexo deve ter no máximo 8 MB.');
  },
  fileDataUrl(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||''));
      reader.onerror=()=>reject(reader.error||new Error('Não foi possível ler o arquivo.'));
      reader.readAsDataURL(file);
    });
  },
  async attachmentsFor(rdoId,{refresh=false}={}){
    const key=String(rdoId||'');
    if(!refresh && this.attachmentCache.has(key)) return this.attachmentCache.get(key).slice();
    let rows=[];
    if(typeof Cloud!=='undefined' && Cloud.active())
      rows=await Cloud.listRdoAttachments(key);
    else
      rows=(State.rdoAttachments||[]).filter(item=>String(item.rdoId)===key);
    this.attachmentCache.set(key,rows.slice());
    return rows;
  },
  async saveAttachment(rdo,file){
    this.validateAttachmentFile(file);
    if(typeof Cloud!=='undefined' && Cloud.active())
      return Cloud.uploadRdoAttachment(rdo.id,rdo.projectId,file);
    const id=U.id();
    const dataUrl=await this.fileDataUrl(file);
    const attachment={
      id,rdoId:String(rdo.id),projectId:String(rdo.projectId),
      fileName:String(file.name||'arquivo').slice(0,180),
      mimeType:String(file.type||'application/octet-stream'),
      sizeBytes:Number(file.size)||0,
      dataUrl,
      uploadedAt:new Date().toISOString()
    };
    await DB.attachmentPut(attachment);
    return attachment;
  },
  async removeAttachment(rdoId,attachmentId){
    const rdo=State.rdos.find(item=>String(item.id)===String(rdoId));
    if(!rdo || !this.canEdit(rdo)) return UI.toast('Este RDO está bloqueado para edição.','warn');
    const rows=await this.attachmentsFor(rdoId);
    const attachment=rows.find(item=>String(item.id)===String(attachmentId));
    if(!attachment) return;
    try{
      UI.loading(true,'Removendo anexo…');
      if(typeof Cloud!=='undefined' && Cloud.active())
        await Cloud.removeRdoAttachment(attachment);
      else
        await DB.attachmentDel(attachment.id);
      this.attachmentCache.delete(String(rdoId));
      await State.reload();
      UI.loading(false);
      UI.toast('Anexo removido','success');
      UI.closeAll();
      this.form(rdoId);
    }catch(err){
      UI.loading(false);
      UI.toast('Não foi possível remover o anexo: '+U.esc(err.message||err),'error',7000);
    }
  },
  async attachmentUrl(attachment){
    if(attachment&&attachment.dataUrl){
      const safe=U.safeImageSrc(attachment.dataUrl);
      if(!safe) throw new Error('A imagem local não pôde ser validada.');
      return safe;
    }
    const blob=await Cloud.downloadRdoAttachment(attachment.objectPath);
    const url=URL.createObjectURL(blob);
    this.attachmentUrls.add(url);
    setTimeout(()=>{
      if(this.attachmentUrls.has(url)){
        URL.revokeObjectURL(url);
        this.attachmentUrls.delete(url);
      }
    },300000);
    return url;
  },

  fullAccess(){
    return typeof Cloud==='undefined' || !Cloud.active() || ['owner','admin'].includes(Cloud.role());
  },
  canReview(){
    return this.fullAccess()
      && (typeof Cloud==='undefined' || !Cloud.active() || Cloud.canEditStore('rdos'));
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
  projectClient(projectId){
    const project=State.projects.find(p=>String(p.id)===String(projectId))||null;
    const client=project
      ? State.clients.find(item=>U.norm(item.name)===U.norm(project.client))||null
      : null;
    return {
      project,
      client,
      name:String((client&&client.name)||(project&&project.client)||'Cliente não informado'),
      logo:U.safeImageSrc((client&&client.logo)||(project&&project.clientLogo)||'')
    };
  },
  crewMembers(){
    return State.crew.filter(item=>item.recordType!=='role');
  },
  crewRoles(){
    return State.crew
      .filter(item=>item.recordType==='role')
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
  },
  activeCrew(){
    return this.crewMembers().filter(x=>x.active!==false).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  },
  linkedRdoIds(){
    return new Set(State.measurements.flatMap(m=>Array.isArray(m.rdoIds)?m.rdoIds.map(String):[]));
  },
  standardDailyHours(){
    const configured=Number((State.settings||{}).rdoDailyHours);
    return configured>0&&configured<=24?configured:8.8;
  },
  defaultShift(){
    const settings=State.settings||{};
    const start=/^\d{2}:\d{2}$/.test(String(settings.rdoShiftStart||''))?settings.rdoShiftStart:'07:30';
    const end=/^\d{2}:\d{2}$/.test(String(settings.rdoShiftEnd||''))?settings.rdoShiftEnd:'17:18';
    const configuredBreak=Number(settings.rdoShiftBreakMinutes);
    const breakMinutes=Number.isFinite(configuredBreak)&&configuredBreak>=0&&configuredBreak<=360?configuredBreak:60;
    return {start,end,breakMinutes};
  },
  workedHours(start,end,breakMinutes=0,regularLimit=this.standardDailyHours()){
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
    const limit=Math.max(0,Math.min(24,Number(regularLimit)||0));
    const regular=Math.round(Math.min(limit,total)*100)/100;
    return {total,regular,overtime50:Math.round(Math.max(0,total-regular)*100)/100,overtime100:0};
  },
  baseCostFor(employeeId,legacyRate=null){
    const base=State.laborRates.find(rate=>
      String(rate.employeeId)===String(employeeId)
      && (rate.isBaseCost===true || String(rate.projectId)==='__base__')
      && rate.active!==false
    );
    const regular=Number(base?.costRegular);
    if(base && Number.isFinite(regular) && regular>=0){
      return {
        costRegular:regular,
        cost50:Number.isFinite(Number(base.cost50))?Number(base.cost50):regular*1.5,
        cost100:Number.isFinite(Number(base.cost100))?Number(base.cost100):regular*2
      };
    }
    return {
      costRegular:Number(legacyRate?.costRegular)||0,
      cost50:Number(legacyRate?.cost50)||0,
      cost100:Number(legacyRate?.cost100)||0
    };
  },
  rateFor(projectId,employeeId){
    const rate=State.laborRates.find(item=>
      String(item.projectId)===String(projectId)
      && String(item.employeeId)===String(employeeId)
      && item.isBaseCost!==true
      && item.active!==false
    ) || null;
    if(!rate) return null;
    return {...rate,...this.baseCostFor(employeeId,rate)};
  },
  displayRoleFor(projectId,entry,snapshot=null){
    const employee=this.crewMembers().find(item=>String(item.id)===String(entry.employeeId))||{};
    const rate=State.laborRates.find(item=>
      String(item.projectId)===String(projectId)
      && String(item.employeeId)===String(entry.employeeId)
      && item.isBaseCost!==true
    )||null;
    const mode=snapshot?.roleDisplayMode||entry.roleDisplayMode||rate?.roleDisplayMode||'client';
    const internal=snapshot?.internalRole||entry.internalRole||employee.internalRole||'';
    const commercial=snapshot?.commercialRole||entry.commercialRole||rate?.commercialRole||'';
    return mode==='internal'?internal:(commercial||internal);
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
        roleDisplayMode:(rate&&rate.roleDisplayMode)==='internal'?'internal':'client',
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
    const label={Enviado:'Aguardando aprovação',Devolvido:'Reprovado'}[status]||status||'Rascunho';
    return `<span class="tag ${tone}">${U.esc(label)}</span>`;
  },
  authorName(){
    const user=typeof Cloud!=='undefined'&&Cloud.active()?Cloud.user()||{}:{};
    return String(user.user_metadata?.full_name||user.email||'Usuário');
  },
  canEdit(rdo){
    if(!rdo || !['Rascunho','Devolvido'].includes(rdo.status||'Rascunho')) return false;
    return typeof Cloud==='undefined' || !Cloud.active() || Cloud.canEditStore('rdos');
  },
  canDelete(rdo){
    if(!rdo || this.linkedRdoIds().has(String(rdo.id))) return false;
    const canEdit=typeof Cloud==='undefined' || !Cloud.active() || Cloud.canEditStore('rdos');
    const editable=['Rascunho','Devolvido'].includes(rdo.status||'Rascunho') && canEdit;
    const approvedByAdmin=rdo.status==='Aprovado' && this.fullAccess() && canEdit;
    return editable || approvedByAdmin;
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
        employeeRegistration:(State.crew.find(item=>String(item.id)===String(row.employeeId))||{}).registration||'',
        internalRole:row.internalRole,
        commercialRole:row.commercialRole,
        roleDisplayMode:row.roleDisplayMode,
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

  reject(id){
    const rdo=State.rdos.find(x=>String(x.id)===String(id));
    if(!rdo || rdo.status!=='Enviado' || !this.canReview()) return;
    UI.modal({
      title:'Reprovar diário',
      body:`<div class="form-grid">
        <div class="full"><label>Comentário da reprovação *</label><textarea id="rdo-rejection-comment" rows="5" maxlength="1200" placeholder="Explique o que precisa ser corrigido antes de um novo envio."></textarea></div>
      </div>
      <div class="import-log">O diário voltará para edição e o comentário ficará visível ao responsável pelo preenchimento.</div>`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-danger" id="rdo-reject-confirm"><i data-lucide="message-square-x"></i>Reprovar diário</button>'
    });
    document.getElementById('rdo-reject-confirm').onclick=async()=>{
      const comment=document.getElementById('rdo-rejection-comment').value.trim();
      if(!comment) return UI.toast('Informe o motivo da reprovação.','warn');
      try{
        UI.loading(true,'Reprovando diário…');
        const rejectedAt=new Date().toISOString();
        await DB.put('rdos',{
          ...rdo,
          status:'Devolvido',
          rejectionComment:comment,
          rejectedAt,
          rejectedBy:this.authorName(),
          rejectionHistory:[
            ...(Array.isArray(rdo.rejectionHistory)?rdo.rejectionHistory:[]),
            {comment,rejectedAt,rejectedBy:this.authorName()}
          ].slice(-20),
          updatedAt:rejectedAt
        });
        await State.reload();
        UI.loading(false);
        UI.closeAll();
        UI.toast('RDO reprovado com comentário.','success',6000);
        App.render();
      }catch(err){
        UI.loading(false);
        UI.toast('Não foi possível reprovar o RDO: '+U.esc(err.message||err),'error',7500);
      }
    };
  },

  remove(id){
    const rdo=State.rdos.find(x=>String(x.id)===String(id));
    if(!rdo) return;
    if(!this.canDelete(rdo))
      return UI.toast('O RDO precisa estar fora de uma medição. RDO aprovado só pode ser excluído por proprietário ou administrador.','warn',7500);
    const approved=rdo.status==='Aprovado';
    UI.confirm(`Excluir definitivamente <b>${U.esc(rdo.number||'este RDO')}</b>${approved?' e estornar o custo realizado, o snapshot financeiro':''}? Os anexos também serão removidos.`,async()=>{
      try{
        UI.loading(true,'Excluindo diário e anexos…');
        if(approved && typeof Cloud!=='undefined' && Cloud.active()){
          await Cloud.deleteRdo(rdo.id);
          await DB.syncFromCloud();
        }else{
          const attachments=await this.attachmentsFor(rdo.id,{refresh:true});
          for(const attachment of attachments){
            if(typeof Cloud!=='undefined' && Cloud.active()) await Cloud.removeRdoAttachment(attachment);
            else await DB.attachmentDel(attachment.id);
          }
          if(approved){
            const financial=State.rdoFinancial.find(item=>String(item.rdoId||item.id)===String(rdo.id));
            const purchase=State.purchases.find(item=>String(item.sourceRdoId||'')===String(rdo.id));
            if(financial) await DB.del('rdo_financial',financial.id);
            if(purchase) await DB.del('purchases',purchase.id);
          }
          await DB.del('rdos',rdo.id);
        }
        this.attachmentCache.delete(String(rdo.id));
        await State.reload();
        UI.loading(false);
        UI.toast(approved?'RDO aprovado excluído e custo estornado.':'RDO excluído.','warn',6500);
        App.render();
      }catch(err){
        UI.loading(false);
        UI.toast('Não foi possível excluir o RDO: '+U.esc(err.message||err),'error',8000);
      }
    });
  },

  form(id=''){
    const existing=id?State.rdos.find(x=>String(x.id)===String(id)):null;
    if(existing && !this.canEdit(existing)) return this.detail(id);
    const projects=this.allowedProjects();
    const crew=this.activeCrew();
    if(!projects.length) return UI.toast('Nenhum projeto foi disponibilizado para preenchimento de RDO.','warn',6500);
    if(!crew.length) return UI.toast('Cadastre a equipe antes de criar o primeiro RDO.','warn',6500);
    const initialEntries=new Map((existing?.entries||[]).map(row=>[String(row.employeeId),row]));
    const defaultShift=this.defaultShift();
    const defaultHours=this.workedHours(defaultShift.start,defaultShift.end,defaultShift.breakMinutes);
    const sharedEntry=(existing?.entries||[])[0]||{...defaultShift,...defaultHours,overtime100:0};
    const workerCard=employee=>{
      const saved=initialEntries.get(String(employee.id));
      const selected=!!saved;
      const row=saved||{...defaultShift,...defaultHours};
      const searchText=U.norm(`${employee.registration||''} ${employee.name||''} ${employee.internalRole||''}`);
      const photo=U.safeImageSrc(employee.photo||'');
      return `<article class="rdo-worker-card ${selected?'selected':''}" data-employee-id="${U.esc(employee.id)}" data-search="${U.esc(searchText)}">
        <div class="rdo-worker-head">
          <label class="rdo-worker-select"><input type="checkbox" ${selected?'checked':''}>${photo?`<img class="employee-avatar" src="${U.esc(photo)}" alt="">`:`<span class="avatar-ph">${U.initials(employee.name||'CO')}</span>`}
            <span><b>${U.esc(employee.name||'Colaborador')}</b><small>${employee.registration?`Matrícula ${U.esc(employee.registration)} · `:''}${U.esc(employee.internalRole||'Sem função')}</small></span></label>
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
      body:`<div class="rdo-composer">
        <aside class="rdo-stepper" aria-label="Etapas do diário">
          ${[
            ['1','Informações','calendar-days'],
            ['2','Equipe e horas','user'],
            ['3','Serviço e anexos','camera'],
            ['4','Revisão','badge-check']
          ].map(([step,label,icon])=>`<button type="button" data-rdo-step-target="${step}"><span><i data-lucide="${icon}"></i></span><b>${label}</b></button>`).join('')}
          <div class="rdo-draft-note"><i data-lucide="shield-check"></i><span><b>Rascunho protegido</b><small>Salve para continuar depois.</small></span></div>
        </aside>
        <div class="rdo-composer-main">
          <section class="rdo-step" data-rdo-step="1">
            ${existing?.status==='Devolvido'&&existing.rejectionComment?`<div class="rdo-rejection-banner"><i data-lucide="message-square-warning"></i><div><b>Correção solicitada</b><p>${U.esc(existing.rejectionComment)}</p></div></div>`:''}
            <div class="rdo-step-heading"><span>01</span><div><h3>Informações do diário</h3><p>Defina o projeto, a data e a frente de serviço.</p></div></div>
            <div class="form-grid">
              <div><label>Projeto *</label><select id="rdo-project" ${existing?'disabled':''}>${projects.map(project=>`<option value="${U.esc(project.id)}" ${String(project.id)===String(existing?.projectId||'')?'selected':''}>${U.esc(project.label)}</option>`).join('')}</select></div>
              <div><label>Data do serviço *</label><input id="rdo-date" type="date" value="${U.esc(existing?.date||U.isoDate(new Date()))}"></div>
              <div class="full"><label>Local / frente de serviço</label><input id="rdo-location" maxlength="180" value="${U.esc(existing?.location||'')}" placeholder="Ex.: Subestação SE-04"></div>
            </div>
            <div class="rdo-context-card"><i data-lucide="briefcase-business"></i><div><b>Projeto autorizado para este usuário</b><small>A lista respeita as permissões configuradas pelo administrador.</small></div><i data-lucide="check-circle-2"></i></div>
          </section>

          <section class="rdo-step" data-rdo-step="2" hidden>
            <div class="rdo-step-heading"><span>02</span><div><h3>Equipe e horas trabalhadas</h3><p>O horário geral preenche automaticamente todos os colaboradores selecionados.</p></div></div>
            <div class="rdo-team-template">
              <label>Entrada<input id="rdo-all-start" type="time" value="${U.esc(sharedEntry.start||defaultShift.start)}"></label>
              <label>Saída<input id="rdo-all-end" type="time" value="${U.esc(sharedEntry.end||defaultShift.end)}"></label>
              <label>Intervalo (min)<input id="rdo-all-break" type="number" min="0" max="360" step="5" value="${Number(sharedEntry.breakMinutes)||0}"></label>
              <label>Normal<input id="rdo-all-regular" type="number" min="0" max="24" step="0.25" value="${Number(sharedEntry.regular)||0}"></label>
              <label>HE 50%<input id="rdo-all-50" type="number" min="0" max="24" step="0.25" value="${Number(sharedEntry.overtime50)||0}"></label>
              <label>HE 100%<input id="rdo-all-100" type="number" min="0" max="24" step="0.25" value="${Number(sharedEntry.overtime100)||0}"></label>
            </div>
            <div class="rdo-team-summary" id="rdo-team-summary"></div>
            <div class="rdo-team-search" role="search">
              <i data-lucide="search"></i>
              <input id="rdo-team-search" type="search" autocomplete="off" spellcheck="false" placeholder="Pesquisar por matrícula, nome ou função" aria-label="Pesquisar colaborador por matrícula, nome ou função">
              <button id="rdo-team-search-clear" type="button" aria-label="Limpar pesquisa" title="Limpar pesquisa"><i data-lucide="x"></i></button>
            </div>
            <div class="rdo-team-search-empty" id="rdo-team-search-empty" hidden><i data-lucide="user-x"></i><span>Nenhum colaborador encontrado.</span></div>
            <div class="rdo-worker-list" id="rdo-worker-list">${crew.map(workerCard).join('')}</div>
          </section>

          <section class="rdo-step" data-rdo-step="3" hidden>
            <div class="rdo-step-heading"><span>03</span><div><h3>Serviço e evidências</h3><p>Descreva o trabalho e registre as fotos do campo.</p></div></div>
            <div class="form-grid">
              <div class="full"><label>Serviço realizado *</label><textarea id="rdo-description" rows="5" maxlength="1600" placeholder="Descreva claramente o que foi executado.">${U.esc(existing?.description||'')}</textarea><small class="rdo-char-count"><span id="rdo-description-count">${String(existing?.description||'').length}</span>/1.600 caracteres</small></div>
            </div>
            <div class="rdo-upload-grid">
              <button class="rdo-upload-card primary" id="rdo-camera-button" type="button"><i data-lucide="camera"></i><b>Tirar foto</b><small>Usar a câmera do celular</small></button>
              <button class="rdo-upload-card" id="rdo-file-button" type="button"><i data-lucide="paperclip"></i><b>Anexar arquivo</b><small>Foto ou documento PDF</small></button>
              <input id="rdo-camera-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden>
              <input id="rdo-file-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden>
            </div>
            <div class="rdo-attachments-head"><b id="rdo-attachment-count">0 anexos adicionados</b><small>As fotos serão incluídas no PDF do diário.</small></div>
            <div class="rdo-attachment-list" id="rdo-attachment-list"><div class="rdo-attachment-empty">Nenhuma evidência anexada.</div></div>
            <div class="form-grid">
              <div class="full"><label>Ocorrências e observações <small>Opcional</small></label><textarea id="rdo-notes" rows="3" maxlength="1200" placeholder="Registre atrasos, impedimentos ou outros eventos relevantes.">${U.esc(existing?.notes||'')}</textarea></div>
            </div>
          </section>

          <section class="rdo-step" data-rdo-step="4" hidden>
            <div class="rdo-step-heading"><span>04</span><div><h3>Revise antes de enviar</h3><p>Confira as informações que seguirão para aprovação.</p></div></div>
            <div class="rdo-review-grid" id="rdo-review"></div>
            <label class="rdo-confirmation"><input id="rdo-confirmation" type="checkbox"><span><i data-lucide="check"></i></span>Confirmo que revisei os horários, colaboradores, serviço e anexos.</label>
          </section>
        </div>
      </div>`,
      footer:`<button class="btn btn-ghost" id="rdo-back"><i data-lucide="chevron-left"></i><span>Cancelar</span></button>
        <div class="rdo-footer-spacer"></div>
        <button class="btn btn-ghost" id="rdo-save-draft"><i data-lucide="save"></i>Salvar rascunho</button>
        <button class="btn btn-primary" id="rdo-next">Continuar<i data-lucide="chevron-right"></i></button>
        <button class="btn btn-primary" id="rdo-submit" hidden><i data-lucide="send"></i>Enviar para aprovação</button>`,
      onOpen:async modal=>{
        modal.classList.add('rdo-composer-modal');
        const cards=[...document.querySelectorAll('.rdo-worker-card')];
        let currentStep=1;
        let pendingFiles=[];
        let savedAttachments=[];
        let busy=false;
        const byId=id=>document.getElementById(id);

        const refreshTotal=card=>{
          const total=['regular','overtime50','overtime100'].reduce((sum,key)=>sum+U.num(card.querySelector(`[data-field="${key}"]`).value),0);
          card.querySelector('.rdo-worker-total').textContent=`${total.toLocaleString('pt-BR',{maximumFractionDigits:2})}h`;
        };
        const sharedValues=()=>({
          start:byId('rdo-all-start').value,
          end:byId('rdo-all-end').value,
          breakMinutes:byId('rdo-all-break').value,
          regular:byId('rdo-all-regular').value,
          overtime50:byId('rdo-all-50').value,
          overtime100:byId('rdo-all-100').value
        });
        const applyToCard=card=>{
          Object.entries(sharedValues()).forEach(([field,value])=>{
            card.querySelector(`[data-field="${field}"]`).value=value;
          });
          refreshTotal(card);
        };
        const refreshTeamSummary=()=>{
          const selected=cards.filter(card=>card.querySelector('.rdo-worker-select input').checked);
          const hours=selected.reduce((sum,card)=>sum+['regular','overtime50','overtime100'].reduce(
            (total,key)=>total+U.num(card.querySelector(`[data-field="${key}"]`).value),0
          ),0);
          byId('rdo-team-summary').innerHTML=`<span><b>${selected.length}</b> colaboradores selecionados</span><span><b>${hours.toLocaleString('pt-BR',{maximumFractionDigits:2})}h</b> no total</span>`;
        };
        const filterTeam=()=>{
          const query=U.norm(byId('rdo-team-search').value);
          let visible=0;
          cards.forEach(card=>{
            const matches=!query || String(card.dataset.search||'').includes(query);
            card.hidden=!matches;
            if(matches) visible++;
          });
          byId('rdo-team-search-clear').classList.toggle('visible',!!query);
          byId('rdo-team-search-empty').hidden=visible!==0;
        };
        byId('rdo-team-search').oninput=filterTeam;
        byId('rdo-team-search-clear').onclick=()=>{
          byId('rdo-team-search').value='';
          filterTeam();
          byId('rdo-team-search').focus();
        };
        cards.forEach(card=>{
          const checkbox=card.querySelector('.rdo-worker-select input');
          checkbox.onchange=()=>{
            card.classList.toggle('selected',checkbox.checked);
            if(checkbox.checked) applyToCard(card);
            refreshTeamSummary();
          };
          card.querySelectorAll('[data-field="start"],[data-field="end"],[data-field="breakMinutes"]').forEach(input=>input.onchange=()=>{
            const hours=this.workedHours(
              card.querySelector('[data-field="start"]').value,
              card.querySelector('[data-field="end"]').value,
              card.querySelector('[data-field="breakMinutes"]').value
            );
            card.querySelector('[data-field="regular"]').value=hours.regular;
            card.querySelector('[data-field="overtime50"]').value=hours.overtime50;
            refreshTotal(card);
            refreshTeamSummary();
          });
          card.querySelectorAll('[data-field="regular"],[data-field="overtime50"],[data-field="overtime100"]').forEach(input=>input.oninput=()=>{
            refreshTotal(card);
            refreshTeamSummary();
          });
          refreshTotal(card);
        });
        const applyToAll=()=>{
          cards.filter(card=>card.querySelector('.rdo-worker-select input').checked).forEach(card=>{
            applyToCard(card);
          });
          refreshTeamSummary();
        };
        const recalcTemplate=()=>{
          const hours=this.workedHours(
            byId('rdo-all-start').value,
            byId('rdo-all-end').value,
            byId('rdo-all-break').value
          );
          byId('rdo-all-regular').value=hours.regular;
          byId('rdo-all-50').value=hours.overtime50;
          applyToAll();
        };
        ['rdo-all-start','rdo-all-end','rdo-all-break'].forEach(fieldId=>byId(fieldId).onchange=recalcTemplate);
        ['rdo-all-regular','rdo-all-50','rdo-all-100'].forEach(fieldId=>byId(fieldId).oninput=applyToAll);

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
            const rate=State.laborRates.find(item=>
              String(item.projectId)===String(document.getElementById('rdo-project').value)
              && String(item.employeeId)===String(card.dataset.employeeId)
              && item.isBaseCost!==true
            )||null;
            return {
              employeeId:String(card.dataset.employeeId),
              employeeName:employee.name||'Colaborador',
              employeeRegistration:employee.registration||'',
              internalRole:employee.internalRole||'',
              commercialRole:rate?.commercialRole||'',
              roleDisplayMode:rate?.roleDisplayMode==='internal'?'internal':'client',
              start:card.querySelector('[data-field="start"]').value,
              end:card.querySelector('[data-field="end"]').value,
              breakMinutes:U.num(card.querySelector('[data-field="breakMinutes"]').value),
              regular:U.num(card.querySelector('[data-field="regular"]').value),
              overtime50:U.num(card.querySelector('[data-field="overtime50"]').value),
              overtime100:U.num(card.querySelector('[data-field="overtime100"]').value)
            };
          }),
          attachmentCount:savedAttachments.length+pendingFiles.length
        });

        const renderAttachments=()=>{
          const rows=[
            ...savedAttachments.map(item=>({...item,saved:true})),
            ...pendingFiles.map(item=>({
              id:item.id,fileName:item.file.name,mimeType:item.file.type,sizeBytes:item.file.size,
              previewUrl:item.previewUrl,saved:false
            }))
          ];
          byId('rdo-attachment-count').textContent=`${rows.length} ${rows.length===1?'anexo adicionado':'anexos adicionados'}`;
          byId('rdo-attachment-list').innerHTML=rows.map(item=>`<article class="rdo-attachment-item">
            <span class="rdo-attachment-thumb ${this.isImage(item)?'image':'file'}">
              ${item.previewUrl?`<img src="${U.esc(item.previewUrl)}" alt="">`:`<i data-lucide="${this.isImage(item)?'image':'file-text'}"></i>`}
            </span>
            <span><b>${U.esc(item.fileName||'arquivo')}</b><small>${this.isImage(item)?'Foto':'Documento'} · ${this.formatFileSize(item.sizeBytes)}</small></span>
            <button type="button" class="icon-btn" data-remove-${item.saved?'saved':'pending'}="${U.esc(item.id)}" aria-label="Remover ${U.esc(item.fileName||'anexo')}"><i data-lucide="x"></i></button>
          </article>`).join('')||'<div class="rdo-attachment-empty"><i data-lucide="image-plus"></i><span>Nenhuma evidência anexada.</span></div>';
          byId('rdo-attachment-list').querySelectorAll('[data-remove-pending]').forEach(button=>button.onclick=()=>{
            const target=pendingFiles.find(item=>String(item.id)===String(button.dataset.removePending));
            if(target&&target.previewUrl){
              URL.revokeObjectURL(target.previewUrl);
              this.attachmentUrls.delete(target.previewUrl);
            }
            pendingFiles=pendingFiles.filter(item=>String(item.id)!==String(button.dataset.removePending));
            renderAttachments();
          });
          byId('rdo-attachment-list').querySelectorAll('[data-remove-saved]').forEach(button=>button.onclick=()=>{
            this.removeAttachment(existing.id,button.dataset.removeSaved);
          });
          U.icons();
        };

        const queueFiles=files=>{
          for(const file of files){
            if(savedAttachments.length+pendingFiles.length>=12){
              UI.toast('Cada RDO pode ter no máximo 12 anexos.','warn',6000);
              break;
            }
            try{
              this.validateAttachmentFile(file);
              const previewUrl=/^image\//.test(file.type)?URL.createObjectURL(file):'';
              if(previewUrl){
                this.attachmentUrls.add(previewUrl);
                setTimeout(()=>{
                  if(this.attachmentUrls.has(previewUrl)){
                    URL.revokeObjectURL(previewUrl);
                    this.attachmentUrls.delete(previewUrl);
                  }
                },300000);
              }
              pendingFiles.push({id:U.id(),file,previewUrl});
            }catch(err){ UI.toast(U.esc(err.message||err),'warn',6500); }
          }
          renderAttachments();
        };
        byId('rdo-camera-button').onclick=()=>byId('rdo-camera-input').click();
        byId('rdo-file-button').onclick=()=>byId('rdo-file-input').click();
        byId('rdo-camera-input').onchange=event=>{ queueFiles([...event.target.files]); event.target.value=''; };
        byId('rdo-file-input').onchange=event=>{ queueFiles([...event.target.files]); event.target.value=''; };
        byId('rdo-description').oninput=()=>{ byId('rdo-description-count').textContent=byId('rdo-description').value.length; };

        const selectedCards=()=>cards.filter(card=>card.querySelector('.rdo-worker-select input').checked);
        const validateStep=step=>{
          if(step===1 && (!byId('rdo-project').value||!byId('rdo-date').value)){
            UI.toast('Informe o projeto e a data do serviço.','warn');
            return false;
          }
          if(step===2){
            if(!selectedCards().length){
              UI.toast('Selecione ao menos um colaborador.','warn');
              return false;
            }
            if(selectedCards().some(card=>['regular','overtime50','overtime100'].reduce(
              (sum,key)=>sum+U.num(card.querySelector(`[data-field="${key}"]`).value),0
            )<=0)){
              UI.toast('Todos os colaboradores selecionados precisam ter horas informadas.','warn',6000);
              return false;
            }
          }
          if(step===3 && !byId('rdo-description').value.trim()){
            UI.toast('Descreva o serviço realizado.','warn');
            return false;
          }
          return true;
        };

        const updateReview=()=>{
          const rdo=collect();
          const project=projects.find(item=>String(item.id)===String(rdo.projectId));
          const regular=rdo.entries.reduce((sum,row)=>sum+(Number(row.regular)||0),0);
          const extra50=rdo.entries.reduce((sum,row)=>sum+(Number(row.overtime50)||0),0);
          const extra100=rdo.entries.reduce((sum,row)=>sum+(Number(row.overtime100)||0),0);
          byId('rdo-review').innerHTML=`
            <article><div><i data-lucide="calendar-days"></i><b>Informações</b><button type="button" data-review-step="1">Editar</button></div>
              <dl><span><dt>Data</dt><dd>${U.date(rdo.date)}</dd></span><span><dt>Projeto</dt><dd>${U.esc(project?.label||'Projeto')}</dd></span><span><dt>Local</dt><dd>${U.esc(rdo.location||'Não informado')}</dd></span></dl></article>
            <article><div><i data-lucide="users"></i><b>Equipe e horas</b><button type="button" data-review-step="2">Editar</button></div>
              <dl><span><dt>Equipe</dt><dd>${rdo.entries.length} pessoas</dd></span><span><dt>Normal</dt><dd>${regular.toLocaleString('pt-BR')}h</dd></span><span><dt>HE 50% / 100%</dt><dd>${extra50.toLocaleString('pt-BR')}h / ${extra100.toLocaleString('pt-BR')}h</dd></span></dl></article>
            <article class="full"><div><i data-lucide="file-check-2"></i><b>Serviço e evidências</b><button type="button" data-review-step="3">Editar</button></div>
              <p>${U.esc(rdo.description)}</p><span class="rdo-review-tag"><i data-lucide="paperclip"></i>${rdo.attachmentCount} ${rdo.attachmentCount===1?'anexo':'anexos'}</span></article>`;
          byId('rdo-review').querySelectorAll('[data-review-step]').forEach(button=>button.onclick=()=>showStep(Number(button.dataset.reviewStep),true));
          U.icons();
        };

        const showStep=(step,force=false)=>{
          const next=Math.max(1,Math.min(4,Number(step)||1));
          if(!force && next>currentStep && !validateStep(currentStep)) return;
          currentStep=next;
          document.querySelectorAll('[data-rdo-step]').forEach(section=>section.hidden=Number(section.dataset.rdoStep)!==currentStep);
          document.querySelectorAll('[data-rdo-step-target]').forEach(button=>{
            const number=Number(button.dataset.rdoStepTarget);
            button.classList.toggle('active',number===currentStep);
            button.classList.toggle('complete',number<currentStep);
          });
          byId('rdo-back').querySelector('span').textContent=currentStep===1?'Cancelar':'Voltar';
          byId('rdo-next').hidden=currentStep===4;
          byId('rdo-next').style.display=currentStep===4?'none':'';
          byId('rdo-submit').hidden=currentStep!==4;
          byId('rdo-submit').style.display=currentStep===4?'':'none';
          if(currentStep===4) updateReview();
          modal.querySelector('.modal-body').scrollTop=0;
        };
        document.querySelectorAll('[data-rdo-step-target]').forEach(button=>button.onclick=()=>{
          const step=Number(button.dataset.rdoStepTarget);
          if(step<=currentStep+1) showStep(step,step<currentStep);
        });
        byId('rdo-back').onclick=()=>currentStep===1?UI.close():showStep(currentStep-1,true);
        byId('rdo-next').onclick=()=>showStep(currentStep+1);

        const persist=async status=>{
          if(busy) return;
          try{
            if(![1,2,3].every(validateStep)) return;
            if(status==='Enviado' && !byId('rdo-confirmation').checked)
              return UI.toast('Confirme a revisão antes de enviar.','warn',5500);
            const rdo=collect();
            busy=true;
            UI.loading(true,pendingFiles.length?'Salvando diário e anexos…':'Salvando diário…');
            await this.save(rdo,'Rascunho');
            for(const pending of [...pendingFiles]){
              const attachment=await this.saveAttachment(rdo,pending.file);
              savedAttachments.push(attachment);
              pendingFiles=pendingFiles.filter(item=>item.id!==pending.id);
            }
            this.attachmentCache.set(String(rdo.id),savedAttachments.slice());
            const saved=status==='Enviado'
              ? await this.save({...rdo,attachmentCount:savedAttachments.length},'Enviado')
              : {...rdo,status:'Rascunho',attachmentCount:savedAttachments.length};
            await State.reload();
            UI.loading(false);
            busy=false;
            App.render();
            if(status==='Enviado'){
              this.submitSuccess(saved,savedAttachments.length);
            }else{
              UI.closeAll();
              UI.toast('Rascunho e anexos salvos','success');
            }
          }catch(err){
            UI.loading(false);
            busy=false;
            renderAttachments();
            UI.toast(U.esc(err.message||err),'warn',7000);
          }
        };
        byId('rdo-save-draft').onclick=()=>persist('Rascunho');
        byId('rdo-submit').onclick=()=>persist('Enviado');
        refreshTeamSummary();
        renderAttachments();
        showStep(1,true);
        if(existing){
          try{
            savedAttachments=await this.attachmentsFor(existing.id,{refresh:true});
            if(document.getElementById('rdo-attachment-list')) renderAttachments();
          }catch(err){
            UI.toast('Os anexos não puderam ser carregados agora.','warn',6000);
          }
        }
      }
    });
  },

  submitSuccess(rdo,attachmentCount=0){
    const total=(rdo.entries||[]).reduce(
      (sum,row)=>sum+(Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0),0
    );
    UI.modal({
      title:'RDO enviado',
      replace:true,
      body:`<section class="rdo-success">
        <span class="rdo-success-icon"><i data-lucide="check"></i></span>
        <small>${U.esc(rdo.number||'Diário de Obra')}</small>
        <h2>Diário enviado para aprovação</h2>
        <p>O registro ficou disponível para revisão do responsável e está bloqueado para edição enquanto aguarda aprovação.</p>
        <div><span><i data-lucide="calendar-days"></i>${U.date(rdo.date)}</span><span><i data-lucide="users"></i>${(rdo.entries||[]).length} colaboradores</span><span><i data-lucide="clock-3"></i>${total.toLocaleString('pt-BR',{maximumFractionDigits:2})}h</span><span><i data-lucide="paperclip"></i>${attachmentCount} anexos</span></div>
      </section>`,
      footer:`<button class="btn btn-ghost" onclick="RDO.print(${U.jsArg(rdo.id)})"><i data-lucide="file-down"></i>Gerar PDF</button>
        <button class="btn btn-primary" onclick="UI.closeAll()"><i data-lucide="list"></i>Voltar aos diários</button>`,
      onOpen:modal=>modal.classList.add('rdo-success-modal')
    });
  },

  async renderDetailAttachments(rdoId){
    const container=document.getElementById('rdo-detail-attachments');
    if(!container) return;
    try{
      const rows=await this.attachmentsFor(rdoId,{refresh:true});
      if(!document.getElementById('rdo-detail-attachments')) return;
      if(!rows.length){
        container.innerHTML='<div class="rdo-attachment-empty"><i data-lucide="image-off"></i><span>Nenhuma evidência anexada.</span></div>';
        return U.icons();
      }
      const display=await Promise.all(rows.map(async attachment=>{
        let url='';
        if(this.isImage(attachment)){
          try{ url=await this.attachmentUrl(attachment); }catch(err){}
        }
        return {...attachment,url};
      }));
      if(!document.getElementById('rdo-detail-attachments')) return;
      container.innerHTML=display.map(attachment=>`<button type="button" class="rdo-evidence-card" data-attachment-id="${U.esc(attachment.id)}">
        <span>${attachment.url?`<img src="${U.esc(attachment.url)}" alt="${U.esc(attachment.fileName)}">`:`<i data-lucide="${this.isImage(attachment)?'image':'file-text'}"></i>`}</span>
        <b>${U.esc(attachment.fileName)}</b><small>${this.formatFileSize(attachment.sizeBytes)}</small>
      </button>`).join('');
      container.querySelectorAll('[data-attachment-id]').forEach(button=>button.onclick=()=>{
        this.previewAttachment(rdoId,button.dataset.attachmentId);
      });
      U.icons();
    }catch(err){
      container.innerHTML='<div class="rdo-attachment-empty">Não foi possível carregar as evidências agora.</div>';
    }
  },

  async previewAttachment(rdoId,attachmentId){
    try{
      const rows=await this.attachmentsFor(rdoId);
      const attachment=rows.find(item=>String(item.id)===String(attachmentId));
      if(!attachment) throw new Error('Anexo não encontrado.');
      if(!this.isImage(attachment)) return this.downloadAttachment(rdoId,attachmentId);
      UI.loading(true,'Abrindo foto…');
      const url=await this.attachmentUrl(attachment);
      UI.loading(false);
      UI.modal({
        title:U.esc(attachment.fileName),
        wide:true,
        body:`<div class="rdo-photo-preview"><img src="${U.esc(url)}" alt="${U.esc(attachment.fileName)}"></div>`,
        footer:`<button class="btn btn-ghost" onclick="RDO.downloadAttachment(${U.jsArg(rdoId)},${U.jsArg(attachmentId)})"><i data-lucide="download"></i>Baixar</button><button class="btn btn-primary" onclick="UI.close()">Fechar</button>`
      });
    }catch(err){
      UI.loading(false);
      UI.toast('Não foi possível abrir o anexo: '+U.esc(err.message||err),'error',6500);
    }
  },

  async downloadAttachment(rdoId,attachmentId){
    try{
      const rows=await this.attachmentsFor(rdoId);
      const attachment=rows.find(item=>String(item.id)===String(attachmentId));
      if(!attachment) throw new Error('Anexo não encontrado.');
      UI.loading(true,'Preparando anexo…');
      const blob=attachment.dataUrl
        ? await fetch(attachment.dataUrl).then(response=>response.blob())
        : await Cloud.downloadRdoAttachment(attachment.objectPath);
      UI.loading(false);
      U.download(attachment.fileName,blob,attachment.mimeType);
    }catch(err){
      UI.loading(false);
      UI.toast('Não foi possível baixar o anexo: '+U.esc(err.message||err),'error',6500);
    }
  },

  async print(id){
    const rdo=State.rdos.find(item=>String(item.id)===String(id));
    if(!rdo) return UI.toast('RDO não encontrado.','warn');
    try{
      UI.loading(true,'Preparando PDF do diário…');
      const attachments=await this.attachmentsFor(rdo.id,{refresh:true});
      const images=[];
      for(const attachment of attachments.filter(item=>this.isImage(item))){
        try{ images.push({...attachment,url:await this.attachmentUrl(attachment)}); }catch(err){}
      }
      const old=document.getElementById('rdo-print-report');
      if(old) old.remove();
      const report=document.createElement('section');
      report.id='rdo-print-report';
      const logo=U.safeImageSrc(State.settings.companyLogo)||'assets/logo-clique.png';
      const companyCnpj=U.formatCnpj(State.settings.companyCnpj||'');
      const customer=this.projectClient(rdo.projectId);
      const financial=State.rdoFinancial.find(item=>String(item.rdoId||item.id)===String(rdo.id));
      const snapshotFor=employeeId=>(financial?.rows||[]).find(row=>String(row.employeeId)===String(employeeId))||null;
      const total=(rdo.entries||[]).reduce(
        (sum,row)=>sum+(Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0),0
      );
      const status={
        Enviado:'Aguardando aprovação',
        Devolvido:'Reprovado'
      }[rdo.status]||rdo.status;
      report.innerHTML=`${typeof Exports!=='undefined'?Exports.stationeryMarkup():''}<header>
        <div class="rdo-print-identities">
          <div class="rdo-print-brand"><img src="${U.esc(logo)}" alt=""><span><b>${U.esc(State.settings.companyName||'CliqueObras')}</b><small>Relatório Diário de Obra${companyCnpj?` · CNPJ ${U.esc(companyCnpj)}`:''}</small></span></div>
          <div class="rdo-print-client">
            ${customer.logo?`<img src="${U.esc(customer.logo)}" alt="">`:`<span>${U.esc(U.initials(customer.name))}</span>`}
            <div><small>Cliente</small><b>${U.esc(customer.name)}</b></div>
          </div>
        </div>
        <div class="rdo-print-number"><small>RDO</small><b>${U.esc(rdo.number||rdo.id)}</b><span>${U.esc(status||'Rascunho')}</span></div>
      </header>
      <div class="rdo-print-facts">
        <span><small>Projeto</small><b>${U.esc(this.projectLabel(rdo.projectId))}</b></span>
        <span><small>Data</small><b>${U.date(rdo.date)}</b></span>
        <span><small>Local</small><b>${U.esc(rdo.location||'Não informado')}</b></span>
        <span><small>Total apontado</small><b>${total.toLocaleString('pt-BR',{maximumFractionDigits:2})}h</b></span>
      </div>
      <section class="rdo-print-section"><h2>Serviço realizado</h2><p>${U.esc(rdo.description||'—')}</p></section>
      <section class="rdo-print-section"><h2>Equipe e horas</h2>
        <table><thead><tr><th>Matrícula</th><th>Colaborador</th><th>Função</th><th>Entrada</th><th>Intervalo</th><th>Saída</th><th>Normal</th><th>HE 50%</th><th>HE 100%</th></tr></thead>
        <tbody>${(rdo.entries||[]).map(row=>`<tr><td>${U.esc(row.employeeRegistration||'—')}</td><td>${U.esc(row.employeeName||'Colaborador')}</td><td>${U.esc(this.displayRoleFor(rdo.projectId,row,snapshotFor(row.employeeId))||'—')}</td><td>${U.esc(row.start||'—')}</td><td>${Number(row.breakMinutes)||0} min</td><td>${U.esc(row.end||'—')}</td><td>${Number(row.regular)||0}h</td><td>${Number(row.overtime50)||0}h</td><td>${Number(row.overtime100)||0}h</td></tr>`).join('')}</tbody></table>
      </section>
      ${rdo.notes?`<section class="rdo-print-section"><h2>Ocorrências e observações</h2><p>${U.esc(rdo.notes)}</p></section>`:''}
      ${rdo.status==='Devolvido'&&rdo.rejectionComment?`<section class="rdo-print-section rdo-print-rejection"><h2>Comentário da reprovação</h2><p>${U.esc(rdo.rejectionComment)}</p></section>`:''}
      <section class="rdo-print-section rdo-print-evidence-section"><h2>Evidências fotográficas</h2>
        ${images.length?`<div class="rdo-print-photos">${images.map((image,index)=>`<figure><img src="${U.esc(image.url)}" alt=""><figcaption>Foto ${String(index+1).padStart(2,'0')} · ${U.esc(image.fileName)}</figcaption></figure>`).join('')}</div>`:'<p>Nenhuma foto anexada.</p>'}
        ${attachments.some(item=>!this.isImage(item))?`<div class="rdo-print-files"><b>Documentos anexados:</b> ${attachments.filter(item=>!this.isImage(item)).map(item=>U.esc(item.fileName)).join(' · ')}</div>`:''}
      </section>
      <footer>Gerado pelo CliqueObras em ${new Date().toLocaleString('pt-BR')}.</footer>`;
      document.body.appendChild(report);
      document.body.classList.add('printing-rdo');
      await Promise.race([
        Promise.all([...report.querySelectorAll('img')].map(image=>image.complete?Promise.resolve():new Promise(resolve=>{
          image.onload=resolve; image.onerror=resolve;
        }))),
        new Promise(resolve=>setTimeout(resolve,1800))
      ]);
      UI.loading(false);
      UI.toast('Na janela de impressão, selecione “Salvar como PDF”.','info',6000);
      window.addEventListener('afterprint',()=>{
        report.remove();
        document.body.classList.remove('printing-rdo');
      },{once:true});
      setTimeout(()=>window.print(),250);
    }catch(err){
      UI.loading(false);
      document.body.classList.remove('printing-rdo');
      UI.toast('Não foi possível gerar o PDF: '+U.esc(err.message||err),'error',7000);
    }
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
        <span><b>${U.esc(row.employeeName||'Colaborador')}</b><small>${U.esc(this.displayRoleFor(rdo.projectId,row,(financial?.rows||[]).find(item=>String(item.employeeId)===String(row.employeeId)))||'')}</small></span>
        <span><small>Normal</small><b>${U.pct(row.regular||0).replace('%','h')}</b></span>
        <span><small>HE 50%</small><b>${U.pct(row.overtime50||0).replace('%','h')}</b></span>
        <span><small>HE 100%</small><b>${U.pct(row.overtime100||0).replace('%','h')}</b></span>
      </div>`).join('')}</div>
      ${showFinancial&&financial?`<div class="kpi-grid rdo-financial-summary">
        <div class="kpi"><div class="k-label">Custo realizado</div><div class="k-value">${U.money(financial.costTotal)}</div></div>
        <div class="kpi accent-blue"><div class="k-label">Venda apurada</div><div class="k-value">${U.money(financial.saleTotal)}</div></div>
      </div>`:''}
      ${rdo.notes?`<div class="import-log"><b>Observações:</b> ${U.esc(rdo.notes)}</div>`:''}
      ${rdo.status==='Devolvido'&&rdo.rejectionComment?`<div class="import-log rdo-rejection-comment"><b>Motivo da reprovação:</b> ${U.esc(rdo.rejectionComment)}
        <small>${rdo.rejectedAt?`Registrado em ${U.date(rdo.rejectedAt)}`:''}${rdo.rejectedBy?` por ${U.esc(rdo.rejectedBy)}`:''}</small></div>`:''}
      <div class="rdo-detail-evidence"><div class="rdo-section-title"><div><h3>Fotos e documentos</h3><small>Evidências registradas no diário.</small></div></div><div class="rdo-evidence-grid" id="rdo-detail-attachments"><div class="rdo-attachment-empty">Carregando evidências…</div></div></div>`,
      footer:`${this.canEdit(rdo)?`<button class="btn btn-ghost" onclick="UI.close();RDO.form(${U.jsArg(rdo.id)})"><i data-lucide="pencil"></i>Editar</button>`:''}
        ${rdo.status==='Enviado'&&!this.canReview()&&(typeof Cloud==='undefined'||!Cloud.active()||Cloud.canEditStore('rdos'))?`<button class="btn btn-ghost" onclick="UI.close();RDO.returnToDraft(${U.jsArg(rdo.id)})"><i data-lucide="undo-2"></i>Voltar para rascunho</button>`:''}
        ${rdo.status==='Enviado'&&this.canReview()?`<button class="btn btn-danger" onclick="RDO.reject(${U.jsArg(rdo.id)})"><i data-lucide="message-square-x"></i>Reprovar</button>`:''}
        ${rdo.status==='Enviado'&&this.canApprove()?`<button class="btn btn-primary" onclick="RDO.approve(${U.jsArg(rdo.id)})"><i data-lucide="badge-check"></i>Aprovar diário</button>`:''}
        ${this.canDelete(rdo)?`<button class="btn btn-danger" onclick="RDO.remove(${U.jsArg(rdo.id)})"><i data-lucide="trash-2"></i>Excluir</button>`:''}
        <button class="btn btn-ghost" onclick="RDO.print(${U.jsArg(rdo.id)})"><i data-lucide="file-down"></i>Gerar PDF</button>
        <button class="btn btn-ghost" onclick="UI.close()">Fechar</button>`,
      onOpen:()=>this.renderDetailAttachments(rdo.id)
    });
  }
};

Views.rdos={
  title:'Diários de Obra',
  query:'',
  status:'Todos',
  setStatus(status){ this.status=status; this.render(); },
  setQuery(value){ this.query=String(value||''); this.render(); },
  render(){
    const linked=RDO.linkedRdoIds();
    const projectIds=new Set(RDO.allowedProjects().map(x=>String(x.id)));
    const allRows=State.rdos
      .filter(rdo=>projectIds.has(String(rdo.projectId)))
      .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const normalized=U.norm(this.query);
    const rows=allRows.filter(rdo=>{
      const matchesStatus=this.status==='Todos'||rdo.status===this.status;
      const haystack=U.norm(`${rdo.number||''} ${RDO.projectLabel(rdo.projectId)} ${rdo.description||''} ${rdo.location||''}`);
      return matchesStatus&&(!normalized||haystack.includes(normalized));
    });
    const approved=allRows.filter(x=>x.status==='Aprovado').length;
    const pending=allRows.filter(x=>x.status==='Enviado').length;
    const drafts=allRows.filter(x=>x.status==='Rascunho').length;
    const returned=allRows.filter(x=>x.status==='Devolvido').length;
    const hours=allRows.reduce((sum,rdo)=>sum+(rdo.entries||[]).reduce((s,row)=>s+(Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0),0),0);
    $c().innerHTML=`<div class="toolbar rdo-page-toolbar">
      <div><h2>Diários de obra</h2><small>Acompanhe o preenchimento, as evidências e o fluxo de aprovação.</small></div>
      <div class="spacer"></div>
      ${typeof Cloud==='undefined'||!Cloud.active()||Cloud.canEditStore('rdos')?'<button class="btn btn-primary" onclick="RDO.form()"><i data-lucide="plus"></i>Novo RDO</button>':''}
    </div>
    <div class="kpi-grid rdo-kpis">
      <div class="kpi"><div class="k-label">Diários</div><div class="k-value">${rows.length}</div></div>
      <div class="kpi accent-amber"><div class="k-label">Aguardando aprovação</div><div class="k-value">${pending}</div></div>
      <div class="kpi accent-green"><div class="k-label">Aprovados</div><div class="k-value">${approved}</div></div>
      <div class="kpi accent-blue"><div class="k-label">Horas registradas</div><div class="k-value">${hours.toLocaleString('pt-BR',{maximumFractionDigits:2})}h</div></div>
    </div>
    <div class="rdo-filter-panel">
      <div class="rdo-search"><i data-lucide="search"></i><input id="rdo-search" value="${U.esc(this.query)}" placeholder="Buscar RDO, projeto ou serviço" aria-label="Buscar diários">${this.query?'<button id="rdo-search-clear" type="button" aria-label="Limpar pesquisa"><i data-lucide="x"></i></button>':''}</div>
      <div class="rdo-filter-chips">
        ${[
          ['Todos',allRows.length],
          ['Rascunho',drafts],
          ['Enviado',pending],
          ['Aprovado',approved],
          ['Devolvido',returned]
        ].map(([status,count])=>`<button type="button" class="${this.status===status?'active':''}" data-rdo-status="${status}">${status==='Enviado'?'Aguardando':status==='Devolvido'?'Reprovado':status}<span>${count}</span></button>`).join('')}
      </div>
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
    }).join('')||'<div class="empty card"><i data-lucide="clipboard-check"></i><br>Nenhum diário encontrado.</div>'}</div>`;
    const search=document.getElementById('rdo-search');
    if(search){
      search.oninput=U.debounce(()=>{
        this.query=search.value;
        this.render();
        const next=document.getElementById('rdo-search');
        if(next){ next.focus(); next.setSelectionRange(next.value.length,next.value.length); }
      },180);
    }
    const clear=document.getElementById('rdo-search-clear');
    if(clear) clear.onclick=()=>{ this.query=''; this.render(); };
    document.querySelectorAll('[data-rdo-status]').forEach(button=>button.onclick=()=>this.setStatus(button.dataset.rdoStatus));
    U.icons();
  }
};

Views.colaboradores={
  title:'Colaboradores',
  query:'',
  avatar(employee,size='normal'){
    const photo=U.safeImageSrc(employee&&employee.photo||'');
    return photo
      ? `<img class="employee-avatar ${size==='large'?'large':''}" src="${U.esc(photo)}" alt="">`
      : `<span class="avatar-ph ${size==='large'?'large':''}">${U.initials(employee&&employee.name||'CO')}</span>`;
  },
  render(){
    const canEdit=typeof Cloud==='undefined'||!Cloud.active()||Cloud.canEditStore('crew');
    const canViewCost=typeof Cloud==='undefined'||!Cloud.active()||Cloud.canViewStore('labor_rates');
    const normalized=U.norm(this.query);
    const all=RDO.crewMembers().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
    const employees=all.filter(employee=>!normalized||U.norm(`${employee.registration||''} ${employee.name||''} ${employee.internalRole||''}`).includes(normalized));
    $c().innerHTML=`<div class="toolbar"><div><h2>Equipe</h2><small>Colaboradores disponíveis para os diários.</small></div><div class="spacer"></div>
      ${canEdit?'<div class="toolbar-actions"><button class="btn btn-ghost" onclick="Views.colaboradores.rolesForm()"><i data-lucide="briefcase-business"></i>Funções</button><button class="btn btn-primary" onclick="Views.colaboradores.form()"><i data-lucide="user-plus"></i>Novo colaborador</button></div>':''}</div>
      <div class="crew-filter-panel"><div class="rdo-search"><i data-lucide="search"></i><input id="crew-search" type="search" value="${U.esc(this.query)}" placeholder="Buscar por matrícula, nome ou cargo" aria-label="Buscar colaboradores">${this.query?'<button id="crew-search-clear" type="button" aria-label="Limpar pesquisa"><i data-lucide="x"></i></button>':''}</div><span>${employees.length} de ${all.length} colaboradores</span></div>
      <div class="crew-directory">${employees.map(employee=>`<div class="crew-card ${employee.active===false?'inactive':''}">
        ${this.avatar(employee)}
        <span><b>${U.esc(employee.name||'Colaborador')}</b><small>${employee.registration?`Matrícula ${U.esc(employee.registration)} · `:''}${U.esc(employee.internalRole||'Sem função')}${canViewCost?` · Custo ${U.money(RDO.baseCostFor(employee.id).costRegular)}/h`:''}</small></span>
        <span class="tag ${employee.active===false?'tag-gray':'tag-green'}">${employee.active===false?'Inativo':'Ativo'}</span>
        ${canEdit?`<button class="btn btn-ghost btn-sm" onclick="Views.colaboradores.form(${U.jsArg(employee.id)})"><i data-lucide="pencil"></i></button>`:''}
      </div>`).join('')||'<div class="empty card"><i data-lucide="users"></i><br>Nenhum colaborador encontrado.</div>'}</div>`;
    const search=document.getElementById('crew-search');
    if(search) search.oninput=U.debounce(()=>{
      this.query=search.value; this.render();
      const next=document.getElementById('crew-search');
      if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length);}
    },180);
    const clear=document.getElementById('crew-search-clear');
    if(clear) clear.onclick=()=>{this.query='';this.render();};
    U.icons();
  },
  form(id=''){
    if(typeof Cloud!=='undefined'&&Cloud.active()&&!Cloud.canEditStore('crew')) return;
    const employee=id?RDO.crewMembers().find(x=>String(x.id)===String(id)):{id:U.id(),name:'',registration:'',photo:'',internalRole:'',active:true};
    if(!employee) return;
    const roleNames=RDO.crewRoles().filter(role=>role.active!==false).map(role=>String(role.name||'').trim()).filter(Boolean);
    if(employee.internalRole&&!roleNames.some(name=>U.norm(name)===U.norm(employee.internalRole))) roleNames.push(employee.internalRole);
    const canEditCost=typeof Cloud==='undefined'||!Cloud.active()||Cloud.canEditStore('labor_rates');
    const baseRecord=State.laborRates.find(rate=>
      String(rate.employeeId)===String(employee.id)
      && (rate.isBaseCost===true||String(rate.projectId)==='__base__')
    );
    const legacyRate=State.laborRates.find(rate=>
      String(rate.employeeId)===String(employee.id)
      && rate.isBaseCost!==true
      && String(rate.projectId)!=='__base__'
    );
    const hourlyCost=RDO.baseCostFor(employee.id,baseRecord||legacyRate).costRegular;
    const hasRegisteredCost=!!(baseRecord||legacyRate);
    let photo=U.safeImageSrc(employee.photo||'');
    UI.modal({title:id?'Editar colaborador':'Novo colaborador',body:`<div class="employee-form-photo">
      <div id="crew-photo-preview">${this.avatar(employee,'large')}</div><div><b>Foto do colaborador</b><small>JPG, PNG ou WebP. A imagem será reduzida antes de sincronizar.</small><div><button class="btn btn-ghost btn-sm" id="crew-photo-select" type="button"><i data-lucide="image-plus"></i>${photo?'Alterar foto':'Adicionar foto'}</button>${photo?'<button class="btn btn-ghost btn-sm" id="crew-photo-remove" type="button"><i data-lucide="trash-2"></i>Remover</button>':''}</div></div></div>
      <div class="form-grid">
      <div><label>Matrícula</label><input id="crew-registration" maxlength="60" value="${U.esc(employee.registration||'')}" autocomplete="off"></div>
      <div><label>Nome *</label><input id="crew-name" maxlength="140" value="${U.esc(employee.name||'')}" autocomplete="name"></div>
      <div><label>Função interna</label><select id="crew-role"><option value="">Sem função</option>${roleNames.sort((a,b)=>a.localeCompare(b,'pt-BR')).map(role=>`<option value="${U.esc(role)}" ${U.norm(role)===U.norm(employee.internalRole)?'selected':''}>${U.esc(role)}</option>`).join('')}</select><small>Cadastre novas funções pelo botão “Funções” no menu de colaboradores.</small></div>
      <div><label>Custo por hora *</label><input id="crew-hourly-cost" type="number" min="0" step="0.01" value="${hasRegisteredCost?hourlyCost:''}" ${canEditCost?'':'disabled'}><small>${canEditCost?'O custo é único para todas as obras. HE 50% e 100% serão calculadas automaticamente.':'Sem permissão para visualizar ou alterar custos.'}</small></div>
      <div><label>Status</label><select id="crew-active"><option value="true" ${employee.active!==false?'selected':''}>Ativo</option><option value="false" ${employee.active===false?'selected':''}>Inativo</option></select></div>
    </div>`,footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="crew-save"><i data-lucide="check"></i>Salvar</button>'});
    const clearPhoto=()=>{
      photo='';
      document.getElementById('crew-photo-preview').innerHTML=`<span class="avatar-ph large">${U.initials(document.getElementById('crew-name').value||employee.name||'CO')}</span>`;
      document.getElementById('crew-photo-select').innerHTML='<i data-lucide="image-plus"></i>Adicionar foto';
      document.getElementById('crew-photo-remove')?.remove();
      U.icons();
    };
    const ensurePhotoRemove=()=>{
      let button=document.getElementById('crew-photo-remove');
      if(!button){
        button=document.createElement('button');
        button.className='btn btn-ghost btn-sm';
        button.id='crew-photo-remove';
        button.type='button';
        button.innerHTML='<i data-lucide="trash-2"></i>Remover';
        document.getElementById('crew-photo-select').after(button);
      }
      button.onclick=clearPhoto;
    };
    if(photo) ensurePhotoRemove();
    document.getElementById('crew-photo-select').onclick=()=>{
      const input=document.getElementById('img-input');
      input.accept='image/png,image/jpeg,image/webp';
      input.onchange=()=>{
        const file=input.files[0]; input.value=''; if(!file) return;
        const reader=new FileReader();
        reader.onload=async event=>{
          try{
            photo=await U.resizeImage(event.target.result,512,'image/jpeg',.86);
            document.getElementById('crew-photo-preview').innerHTML=`<img class="employee-avatar large" src="${U.esc(photo)}" alt="">`;
            document.getElementById('crew-photo-select').innerHTML='<i data-lucide="image-plus"></i>Alterar foto';
            ensurePhotoRemove();
            U.icons();
          }catch(err){UI.toast(U.esc(err.message||err),'error',6000);}
        };
        reader.readAsDataURL(file);
      };
      input.click();
    };
    document.getElementById('crew-save').onclick=async()=>{
      const name=document.getElementById('crew-name').value.trim();
      const registration=document.getElementById('crew-registration').value.trim();
      if(!name) return UI.toast('Informe o nome do colaborador','warn');
      if(registration&&RDO.crewMembers().some(item=>String(item.id)!==String(employee.id)&&U.norm(item.registration)===U.norm(registration)))
        return UI.toast('Esta matrícula já pertence a outro colaborador.','warn');
      const rawCost=canEditCost?document.getElementById('crew-hourly-cost').value:'';
      if(canEditCost && (rawCost===''||U.num(rawCost)<0)) return UI.toast('Informe o custo por hora do colaborador.','warn');
      try{
        UI.loading(true,'Salvando colaborador…');
        await DB.put('crew',{
          ...employee,
          createdAt:employee.createdAt||new Date().toISOString(),
          name,
          registration,
          photo,
          internalRole:document.getElementById('crew-role').value.trim(),
          active:document.getElementById('crew-active').value==='true',
          updatedAt:new Date().toISOString()
        });
        if(canEditCost){
          const cost=U.num(rawCost);
          await DB.put('labor_rates',{
            ...(baseRecord||{id:`base:${employee.id}`,projectId:'__base__',employeeId:String(employee.id),createdAt:new Date().toISOString()}),
            isBaseCost:true,
            commercialRole:'',
            costRegular:cost,
            cost50:Math.round(cost*1.5*100)/100,
            cost100:Math.round(cost*2*100)/100,
            saleRegular:0,sale50:0,sale100:0,
            active:true,
            updatedAt:new Date().toISOString()
          });
        }
        await State.reload();
        UI.loading(false);
        UI.close();
        UI.toast(canEditCost?'Colaborador e custo salvos':'Colaborador salvo','success');
        App.render();
      }catch(err){
        UI.loading(false);
        UI.toast('Não foi possível salvar o colaborador: '+U.esc(err.message||err),'error',7500);
      }
    };
  },
  rolesForm(){
    if(typeof Cloud!=='undefined'&&Cloud.active()&&!Cloud.canEditStore('crew')) return;
    const roles=RDO.crewRoles();
    UI.modal({title:'Funções dos colaboradores',body:`<div class="role-directory">${roles.map(role=>`<div class="role-row"><span><b>${U.esc(role.name||'Função')}</b><small>${RDO.crewMembers().filter(employee=>U.norm(employee.internalRole)===U.norm(role.name)).length} colaborador(es)</small></span><button class="btn btn-ghost btn-sm" onclick="Views.colaboradores.roleForm(${U.jsArg(role.id)})"><i data-lucide="pencil"></i></button><button class="btn btn-ghost btn-sm" onclick="Views.colaboradores.removeRole(${U.jsArg(role.id)})"><i data-lucide="trash-2"></i></button></div>`).join('')||'<div class="empty"><i data-lucide="briefcase-business"></i><br>Nenhuma função cadastrada.</div>'}</div>`,footer:'<button class="btn btn-ghost" onclick="UI.close()">Fechar</button><button class="btn btn-primary" onclick="Views.colaboradores.roleForm()"><i data-lucide="plus"></i>Nova função</button>'});
  },
  roleForm(id=''){
    const current=id?RDO.crewRoles().find(role=>String(role.id)===String(id)):null;
    UI.modal({title:current?'Editar função':'Nova função',body:`<div><label>Nome da função *</label><input id="crew-role-name" maxlength="120" value="${U.esc(current?.name||'')}" placeholder="Ex.: Técnico em Elétrica"></div>`,footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="crew-role-save"><i data-lucide="check"></i>Salvar</button>'});
    document.getElementById('crew-role-save').onclick=async()=>{
      const name=document.getElementById('crew-role-name').value.trim().replace(/\s+/g,' ');
      if(!name) return UI.toast('Informe o nome da função.','warn');
      if(RDO.crewRoles().some(role=>String(role.id)!==String(current?.id||'')&&U.norm(role.name)===U.norm(name)))
        return UI.toast('Esta função já está cadastrada.','warn');
      await DB.put('crew',{...(current||{id:`role:${U.id()}`,recordType:'role',createdAt:new Date().toISOString()}),name,active:true,updatedAt:new Date().toISOString()});
      await State.reload(); UI.closeAll(); UI.toast('Função salva','success'); this.rolesForm();
    };
  },
  removeRole(id){
    const role=RDO.crewRoles().find(item=>String(item.id)===String(id));
    if(!role) return;
    const inUse=RDO.crewMembers().filter(employee=>U.norm(employee.internalRole)===U.norm(role.name)).length;
    if(inUse) return UI.toast(`A função está vinculada a ${inUse} colaborador(es) e não pode ser excluída.`,'warn',6500);
    UI.confirm(`Excluir a função <b>${U.esc(role.name)}</b>?`,async()=>{
      await DB.del('crew',role.id); await State.reload(); UI.closeAll(); UI.toast('Função excluída','warn'); this.rolesForm();
    },false);
  }
};

Views.valoreshh={
  title:'Valores HH',
  projectFilter:'',
  render(){
    const canEdit=typeof Cloud==='undefined'||!Cloud.active()||Cloud.canEditStore('labor_rates');
    if(!this.projectFilter&&State.filters.project) this.projectFilter=String(State.filters.project);
    const rows=State.laborRates.filter(rate=>
      rate.isBaseCost!==true&&String(rate.projectId)!=='__base__'
      &&(!this.projectFilter||String(rate.projectId)===String(this.projectFilter))
    ).sort((a,b)=>RDO.projectLabel(a.projectId).localeCompare(RDO.projectLabel(b.projectId)));
    const rateProjects=State.projects.filter(project=>State.laborRates.some(rate=>String(rate.projectId)===String(project.id))||project.type==='HH');
    $c().innerHTML=`<div class="toolbar"><div><h2>Valores de venda por projeto</h2><small>O custo vem do cadastro do colaborador; somente o valor de venda varia por obra.</small></div><div class="spacer"></div>
      ${canEdit?'<button class="btn btn-primary" onclick="Views.valoreshh.form()"><i data-lucide="plus"></i>Configurar valor</button>':''}</div>
      <div class="rate-filter-panel"><label>Filtrar por projeto<select id="rate-project-filter"><option value="">Todos os projetos</option>${rateProjects.map(project=>`<option value="${U.esc(project.id)}" ${String(project.id)===String(this.projectFilter)?'selected':''}>${U.esc(U.projLabel(project))}</option>`).join('')}</select></label><span>${rows.length} configuração(ões)</span></div>
      <div class="rate-list">${rows.map(rate=>{
        const employee=RDO.crewMembers().find(x=>String(x.id)===String(rate.employeeId))||{};
        const costs=RDO.baseCostFor(rate.employeeId,rate);
        return `<${canEdit?'button':'div'} class="rate-card ${rate.active===false?'inactive':''}"${canEdit?` onclick="Views.valoreshh.form(${U.jsArg(rate.id)})"`:''}>
          <span><b>${U.esc(employee.name||'Colaborador')}</b><small>${U.esc(RDO.projectLabel(rate.projectId))} · ${U.esc(RDO.displayRoleFor(rate.projectId,{employeeId:rate.employeeId,internalRole:employee.internalRole,commercialRole:rate.commercialRole,roleDisplayMode:rate.roleDisplayMode})||'Sem função')} · ${rate.active===false?'Inativo':'Ativo'}</small></span>
          <span><small>Custo padrão</small><b>${U.money(costs.costRegular)}/h</b></span>
          <span><small>Venda normal</small><b>${U.money(rate.saleRegular)}/h</b></span>
          <i data-lucide="chevron-right"></i>
        </${canEdit?'button':'div'}>`;
      }).join('')||'<div class="empty card"><i data-lucide="badge-dollar-sign"></i><br>Nenhum valor configurado.</div>'}</div>`;
    document.getElementById('rate-project-filter').onchange=event=>{this.projectFilter=event.target.value;this.render();};
    U.icons();
  },
  form(id=''){
    if(typeof Cloud!=='undefined'&&Cloud.active()&&!Cloud.canEditStore('labor_rates')) return;
    const employees=RDO.crewMembers();
    const rate=id?State.laborRates.find(x=>String(x.id)===String(id)):{
      projectId:this.projectFilter||State.projects[0]?.id||'',employeeId:employees[0]?.id||'',commercialRole:'',roleDisplayMode:'client',
      costRegular:0,cost50:0,cost100:0,saleRegular:0,sale50:0,sale100:0,active:true
    };
    if(!State.projects.length||!employees.length) return UI.toast('Cadastre um projeto e um colaborador antes de configurar valores.','warn',6500);
    const field=(label,key)=>`<div><label>${label}</label><input id="rate-${key}" type="number" min="0" step="0.01" value="${Number(rate[key])||''}"></div>`;
    const costs=RDO.baseCostFor(rate.employeeId,rate);
    const displayMode=rate.roleDisplayMode==='internal'?'internal':'client';
    UI.modal({title:id?'Editar valores':'Configurar valores',wide:true,body:`<div class="form-grid">
      <div><label>Projeto *</label><select id="rate-project">${State.projects.map(p=>`<option value="${U.esc(p.id)}" ${String(p.id)===String(rate.projectId)?'selected':''}>${U.esc(U.projLabel(p))}</option>`).join('')}</select></div>
      <div><label>Colaborador *</label><select id="rate-employee">${employees.filter(x=>x.active!==false||String(x.id)===String(rate.employeeId)).map(employee=>`<option value="${U.esc(employee.id)}" ${String(employee.id)===String(rate.employeeId)?'selected':''}>${U.esc(employee.name)}</option>`).join('')}</select></div>
      <div><label>Função exibida nos documentos</label><select id="rate-role-mode"><option value="client" ${displayMode==='client'?'selected':''}>Função externa do cliente</option><option value="internal" ${displayMode==='internal'?'selected':''}>Função interna do colaborador</option></select><small>Define a função do PDF do RDO e da medição.</small></div>
      <div><label>Status do valor HH</label><select id="rate-active"><option value="true" ${rate.active!==false?'selected':''}>Ativo</option><option value="false" ${rate.active===false?'selected':''}>Inativo</option></select><small>Valores inativos não entram em novos cálculos.</small></div>
      <div class="full" id="rate-role-wrap" ${displayMode==='internal'?'hidden':''}><label>Função externa apresentada ao cliente *</label><input id="rate-role" maxlength="140" value="${U.esc(rate.commercialRole||'')}" placeholder="Ex.: Técnico em Elétrica"></div>
      <div class="full import-log" id="rate-cost-summary">Custo padrão do colaborador: <b>${U.money(costs.costRegular)}/h</b> · HE 50%: <b>${U.money(costs.cost50)}/h</b> · HE 100%: <b>${U.money(costs.cost100)}/h</b>.</div>
      ${field('Venda · hora normal','saleRegular')}
      ${field('Venda · HE 50%','sale50')}
      ${field('Venda · HE 100%','sale100')}
    </div>`,footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="rate-save"><i data-lucide="check"></i>Salvar</button>'});
    document.getElementById('rate-employee').onchange=event=>{
      const selectedCosts=RDO.baseCostFor(event.target.value);
      document.getElementById('rate-cost-summary').innerHTML=`Custo padrão do colaborador: <b>${U.money(selectedCosts.costRegular)}/h</b> · HE 50%: <b>${U.money(selectedCosts.cost50)}/h</b> · HE 100%: <b>${U.money(selectedCosts.cost100)}/h</b>.`;
    };
    document.getElementById('rate-role-mode').onchange=event=>{
      document.getElementById('rate-role-wrap').hidden=event.target.value==='internal';
    };
    document.getElementById('rate-save').onclick=async()=>{
      const projectId=document.getElementById('rate-project').value;
      const employeeId=document.getElementById('rate-employee').value;
      const existing=State.laborRates.find(x=>String(x.projectId)===String(projectId)&&String(x.employeeId)===String(employeeId)&&String(x.id)!==String(id));
      if(existing) return UI.toast('Já existe uma configuração para este colaborador no projeto.','warn');
      const roleDisplayMode=document.getElementById('rate-role-mode').value;
      const commercialRole=document.getElementById('rate-role').value.trim();
      if(roleDisplayMode==='client'&&!commercialRole)
        return UI.toast('Informe a função externa que será apresentada ao cliente.','warn',6000);
      const employeeCosts=RDO.baseCostFor(employeeId,rate);
      const obj={
        ...(id?rate:{id:`${projectId}:${employeeId}`,createdAt:new Date().toISOString()}),
        projectId,employeeId,commercialRole,roleDisplayMode,
        costRegular:employeeCosts.costRegular,
        saleRegular:U.num(document.getElementById('rate-saleRegular').value),
        cost50:employeeCosts.cost50,
        sale50:U.num(document.getElementById('rate-sale50').value),
        cost100:employeeCosts.cost100,
        sale100:U.num(document.getElementById('rate-sale100').value),
        active:document.getElementById('rate-active').value==='true',updatedAt:new Date().toISOString()
      };
      await DB.put('labor_rates',obj); await State.reload(); UI.close(); UI.toast('Valores salvos','success'); App.render();
    };
  }
};
