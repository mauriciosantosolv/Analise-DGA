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
  async saveAttachment(rdo,file,description=''){
    this.validateAttachmentFile(file);
    if(typeof Cloud!=='undefined' && Cloud.active())
      return Cloud.uploadRdoAttachment(rdo.id,rdo.projectId,file,description);
    const id=U.id();
    const dataUrl=await this.fileDataUrl(file);
    const attachment={
      id,rdoId:String(rdo.id),projectId:String(rdo.projectId),
      fileName:String(file.name||'arquivo').slice(0,180),
      description:String(description||'').trim().slice(0,180),
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
  // v4.2.8 - "Inativo a partir de" (campo inactiveSince, AAAA-MM-DD). O
  // colaborador continua valendo para todos os dias ANTERIORES a essa data e
  // some a partir dela (inclusive). Sem a data o comportamento e exatamente o
  // de antes: inativo some de tudo.
  // v4.2.18 - ferias. Os periodos ficam em crew.vacations, uma lista de
  // {id,from,to} em AAAA-MM-DD dentro do proprio jsonb do colaborador (campo
  // novo em store existente: nao exige mudanca no banco). A disponibilidade
  // continua sendo avaliada dia a dia, pela mesma porta do "Inativo a partir
  // de": crewActiveOn(colaborador, data).
  vacationPeriods(employee){
    return (Array.isArray(employee&&employee.vacations)?employee.vacations:[])
      .map(item=>({
        id:String(item&&item.id||''),
        from:String(item&&item.from||'').slice(0,10),
        to:String(item&&item.to||'').slice(0,10)
      }))
      .filter(item=>/^\d{4}-\d{2}-\d{2}$/.test(item.from)&&/^\d{4}-\d{2}-\d{2}$/.test(item.to)&&item.from<=item.to)
      .sort((a,b)=>a.from.localeCompare(b.from));
  },
  vacationDays(period){
    const from=String(period&&period.from||'').slice(0,10),to=String(period&&period.to||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to) return 0;
    return Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1;
  },
  vacationOn(employee,date){
    const day=String(date||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    return this.vacationPeriods(employee).find(item=>day>=item.from&&day<=item.to)||null;
  },
  onVacation(employee,date){
    return !!this.vacationOn(employee,date);
  },
  crewActiveOn(employee,date){
    if(!employee) return false;
    if(typeof this.onVacation==='function'&&this.onVacation(employee,date)) return false;
    const since=String(employee.inactiveSince||'').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(since)){
      const day=String(date||'').slice(0,10);
      return /^\d{4}-\d{2}-\d{2}$/.test(day)?day<since:employee.active!==false;
    }
    return employee.active!==false;
  },
  activeCrew(date){
    return this.crewMembers().filter(x=>this.crewActiveOn(x,date)).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  },
  isAbsent(entry){
    return String(entry&&entry.attendanceStatus||'').toLowerCase()==='absent';
  },
  visibleEntries(rdo){
    return (Array.isArray(rdo&&rdo.entries)?rdo.entries:[]).filter(entry=>!this.isAbsent(entry));
  },
  dayOffs(date=''){
    const target=String(date||'').slice(0,10);
    return (Array.isArray(State.workforceStatus)?State.workforceStatus:[])
      .filter(item=>item&&item.status==='day_off'&&String(item.date||'').slice(0,10)===target);
  },
  dayOffRecordId(date,employeeId){
    return `day-off:${String(date||'').slice(0,10)}:${String(employeeId||'')}`;
  },
  occupiedEmployees(date,excludeRdoId=''){
    const targetDate=String(date||'').slice(0,10);
    const excluded=String(excludeRdoId||'');
    const occupied=new Map();
    (Array.isArray(State.rdos)?State.rdos:[]).forEach(rdo=>{
      if(!rdo || String(rdo.id||'')===excluded || String(rdo.date||'').slice(0,10)!==targetDate) return;
      (Array.isArray(rdo.entries)?rdo.entries:[]).forEach(entry=>{
        const employeeId=String(entry&&entry.employeeId||'');
        if(employeeId && !occupied.has(employeeId)) occupied.set(employeeId,{rdo,entry});
      });
    });
    this.dayOffs(targetDate).forEach(item=>{
      const employeeId=String(item.employeeId||'');
      if(employeeId&&!occupied.has(employeeId)) occupied.set(employeeId,{workforceStatus:item});
    });
    return occupied;
  },
  allocationConflicts(date,rdoId,entries=[]){
    const occupied=this.occupiedEmployees(date,rdoId);
    return (Array.isArray(entries)?entries:[]).map(entry=>{
      const employeeId=String(entry&&entry.employeeId||'');
      const conflict=occupied.get(employeeId);
      if(!conflict) return null;
      const employee=this.crewMembers().find(item=>String(item.id)===employeeId)||{};
      return {
        employeeId,
        employeeName:employee.name||entry.employeeName||'Colaborador',
        rdoId:String(conflict.rdo?.id||''),
        projectId:String(conflict.rdo?.projectId||''),
        situation:conflict.workforceStatus?'Folga':'Outro RDO'
      };
    }).filter(Boolean);
  },
  linkedRdoIds(){
    return new Set(State.measurements.flatMap(m=>Array.isArray(m.rdoIds)?m.rdoIds.map(String):[]));
  },
  standardDailyHours(){
    const configured=Number(this.shiftSettings().rdoDailyHours);
    return configured>0&&configured<=24?configured:8.8;
  },
  dayType(date,isHoliday=false){
    if(isHoliday) return 'holiday';
    const match=String(date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match) return 'weekday';
    const day=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]))).getUTCDay();
    return day===6?'saturday':day===0?'sunday':'weekday';
  },
  dayTypeLabel(date,isHoliday=false){
    return {holiday:'Feriado · horas a 100%',saturday:'Sábado · horas a 50%',sunday:'Domingo · horas a 100%',weekday:'Dia útil'}[this.dayType(date,isHoliday)];
  },
  // v4.2.18 - a jornada padrao mora no store 'settings', que a RLS esconde de
  // quem so tem permissao nos diarios (o encarregado / Apontador de RDO). Sem
  // as configuracoes, defaultShift caia no 07:30-17:18 embutido e o encarregado
  // via um horario diferente do que a empresa configurou. loadRemoteShiftDefaults
  // busca so as chaves da jornada por RPC (SECURITY DEFINER, revalidando
  // can_view_store(org,'rdos')); shiftSettings completa o que State.settings nao
  // trouxe. Sem nuvem, sem permissao ou com falha na RPC, tudo se comporta
  // exatamente como antes.
  remoteShiftDefaults:null,
  async loadRemoteShiftDefaults(){
    if(typeof Cloud==='undefined'||typeof Cloud.active!=='function'||!Cloud.active()) return null;
    if(typeof Cloud.rdoShiftDefaults!=='function') return null;
    if(typeof Cloud.canViewStore==='function'&&Cloud.canViewStore('settings')) return null;
    try{
      const data=await Cloud.rdoShiftDefaults();
      if(data&&typeof data==='object'&&!Array.isArray(data)) this.remoteShiftDefaults=data;
    }catch(err){}
    return this.remoteShiftDefaults;
  },
  shiftSettings(){
    const settings=State.settings||{};
    const remote=this.remoteShiftDefaults;
    if(!remote) return settings;
    const merged={...settings};
    Object.keys(remote).forEach(chave=>{
      const atual=merged[chave];
      if(atual===undefined||atual===null||atual==='') merged[chave]=remote[chave];
    });
    return merged;
  },
  defaultShift(date=''){
    const settings=this.shiftSettings();
    const type=this.dayType(date,false);
    const prefix=type==='saturday'?'rdoSaturday':type==='sunday'?'rdoSunday':'rdoShift';
    const fallbackStart=settings.rdoShiftStart||'07:30',fallbackEnd=settings.rdoShiftEnd||'17:18';
    const start=/^\d{2}:\d{2}$/.test(String(settings[`${prefix}Start`]||''))?settings[`${prefix}Start`]:fallbackStart;
    const end=/^\d{2}:\d{2}$/.test(String(settings[`${prefix}End`]||''))?settings[`${prefix}End`]:fallbackEnd;
    const configuredBreak=Number(settings[`${prefix}BreakMinutes`]);
    const weekdayBreak=Number(settings.rdoShiftBreakMinutes);
    const fallbackBreak=Number.isFinite(weekdayBreak)&&weekdayBreak>=0&&weekdayBreak<=360?weekdayBreak:60;
    const breakMinutes=Number.isFinite(configuredBreak)&&configuredBreak>=0&&configuredBreak<=360?configuredBreak:60;
    return {start,end,breakMinutes:Number.isFinite(configuredBreak)?breakMinutes:fallbackBreak};
  },
  timeMinutes(value){
    const match=String(value||'').match(/^(\d{1,2}):(\d{2})$/);
    return match&&Number(match[1])<24&&Number(match[2])<60?Number(match[1])*60+Number(match[2]):null;
  },
  // v4.2.7 - o intervalo passa a ser digitado no mesmo formato 00:00 de Entrada
  // e Saida. O dado continua gravado em minutos (breakMinutes), entao nenhuma
  // conta de horas, custo ou medicao muda: minutesToTime so formata a leitura e
  // breakInput normaliza a escrita (aceita "01:00" e tambem o numero puro dos
  // rascunhos gravados antes desta versao).
  minutesToTime(value){
    const total=Math.max(0,Math.min(1439,Math.round(Number(value)||0)));
    return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
  },
  breakInput(value){
    const text=String(value==null?'':value).trim();
    if(/^\d{1,2}:\d{2}$/.test(text)){
      const minutes=this.timeMinutes(text);
      return minutes==null?0:minutes;
    }
    return Math.max(0,U.num(text));
  },
  // v4.2.7 - numeracao do diario. A regra antiga era State.rdos.length+1, que so
  // enxerga o que a RLS entrega: o perfil Apontador via 17 diarios e gerava
  // RDO-2026-0018, numero que ja existia em outro projeto (18 numeros repetidos
  // no banco). localNumber mantem o comportamento offline, mas agora pula os
  // numeros ja usados; nextNumber pede o proximo livre da organizacao inteira.
  localNumber(){
    const year=new Date().getFullYear();
    const used=new Set((Array.isArray(State.rdos)?State.rdos:[]).map(item=>String(item&&item.number||'')));
    let sequence=Math.max(1,(Array.isArray(State.rdos)?State.rdos.length:0)+1);
    let candidate=`RDO-${year}-${String(sequence).padStart(4,'0')}`;
    while(used.has(candidate)&&sequence<99999){
      sequence++;
      candidate=`RDO-${year}-${String(sequence).padStart(4,'0')}`;
    }
    return candidate;
  },
  async nextNumber(){
    const year=new Date().getFullYear();
    if(typeof Cloud!=='undefined'&&Cloud.active()&&typeof Cloud.nextRdoNumber==='function'){
      try{
        const number=await Cloud.nextRdoNumber(year);
        if(/^RDO-\d{4}-\d{4,}$/.test(String(number||''))) return String(number);
      }catch(err){}
    }
    return this.localNumber();
  },
  // v4.2.7 - guarda de duplicidade no servidor. allocationConflicts() so compara
  // com State.rdos, filtrado pela RLS; a RPC enxerga a organizacao inteira e e a
  // unica capaz de ver um colaborador ja alocado num projeto que este usuario nao
  // acessa. Qualquer falha da RPC cai no comportamento anterior, sem travar.
  async remoteAllocationConflicts(rdo){
    if(typeof Cloud==='undefined'||!Cloud.active()||typeof Cloud.occupiedRdoEmployees!=='function') return [];
    let occupied=[];
    try{ occupied=await Cloud.occupiedRdoEmployees(rdo.date,rdo.id); }catch(err){ return []; }
    if(!Array.isArray(occupied)||!occupied.length) return [];
    const taken=new Set(occupied.map(String));
    const seen=new Set();
    return (Array.isArray(rdo.entries)?rdo.entries:[]).filter(entry=>{
      const employeeId=String(entry&&entry.employeeId||'');
      if(!employeeId||!taken.has(employeeId)||seen.has(employeeId)) return false;
      seen.add(employeeId);
      return true;
    }).map(entry=>String(entry.employeeName||'Colaborador'));
  },
  // v4.2.7 - hhConfigurationIssues() depende de State.projects para saber se o
  // contrato e HH; num perfil que nao enxerga o cadastro de projetos o tipo vem
  // null e a validacao era pulada em silencio, deixando enviar diario de quem nao
  // tem valor HH no projeto. A RPC responde pelo servidor.
  async remoteHhIssues(rdo){
    if(typeof Cloud==='undefined'||!Cloud.active()||typeof Cloud.rdoHhGaps!=='function') return [];
    const employeeIds=[...new Set((Array.isArray(rdo.entries)?rdo.entries:[])
      .filter(entry=>!this.isAbsent(entry))
      .map(entry=>String(entry&&entry.employeeId||''))
      .filter(Boolean))];
    if(!employeeIds.length) return [];
    try{
      const rows=await Cloud.rdoHhGaps(rdo.projectId,employeeIds);
      return (Array.isArray(rows)?rows:[]).map(row=>({
        employeeName:String(row&&row.employee_name||'Colaborador'),
        missing:String(row&&row.missing||'valor HH')
      }));
    }catch(err){ return []; }
  },
  paidHours(start,end,breakMinutes=0){
    const from=this.timeMinutes(start),to=this.timeMinutes(end);
    if(from==null||to==null) return 0;
    let minutes=to-from;
    if(minutes<0) minutes+=24*60;
    minutes=Math.max(0,minutes-(Number(breakMinutes)||0));
    return Math.round(minutes/60*100)/100;
  },
  plannedHoursForDate(date){
    const holiday=(Array.isArray(State.rdos)?State.rdos:[]).some(rdo=>String(rdo.date||'').slice(0,10)===String(date)&&rdo.isHoliday===true);
    const shift=this.defaultShift(date);
    return this.paidHours(shift.start,shift.end,shift.breakMinutes)||this.standardDailyHours(date,holiday);
  },
  nightPremiumPct(){
    const configured=Number(this.shiftSettings().rdoNightPremiumPct);
    return Number.isFinite(configured)&&configured>=0&&configured<=300?configured:20;
  },
  nightHours(start,end,breakMinutes=0){
    const from=this.timeMinutes(start),clockEnd=this.timeMinutes(end);
    const nightStart=this.timeMinutes(this.shiftSettings().rdoNightStart||'22:00');
    if(from==null||clockEnd==null||nightStart==null) return 0;
    let duration=clockEnd-from;
    if(duration<0) duration+=1440;
    if(duration<=0) return 0;
    const paid=Math.max(0,duration-(Number(breakMinutes)||0));
    const workEnd=from+duration;
    let overlap=0;
    for(let offset=-1;offset<=1;offset++){
      const windowStart=offset*1440+nightStart;
      const windowEnd=offset*1440+29*60;
      overlap+=Math.max(0,Math.min(workEnd,windowEnd)-Math.max(from,windowStart));
    }
    const adjusted=Math.min(paid,overlap*(paid/duration));
    return Math.round(adjusted/60*100)/100;
  },
  workedHours(start,end,breakMinutes=0,regularLimit=this.standardDailyHours(),date='',isHoliday=false){
    const from=this.timeMinutes(start), to=this.timeMinutes(end);
    if(from==null || to==null) return {total:0,regular:0,overtime50:0,overtime100:0};
    const total=this.paidHours(start,end,breakMinutes);
    const type=this.dayType(date,isHoliday);
    if(type==='saturday') return {total,regular:0,overtime50:total,overtime100:0};
    if(type==='sunday'||type==='holiday') return {total,regular:0,overtime50:0,overtime100:total};
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
  projectFor(projectId){
    return State.projects.find(project=>String(project.id)===String(projectId))||null;
  },
  isHhProject(projectId){
    return String(this.projectFor(projectId)?.type||'').toUpperCase()==='HH';
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
  rdoRateFor(projectId,employeeId){
    if(this.isHhProject(projectId)) return this.rateFor(projectId,employeeId);
    const employee=this.crewMembers().find(item=>String(item.id)===String(employeeId))||{};
    const costs=this.baseCostFor(employeeId);
    return {
      id:`operational:${employeeId}`,
      projectId:String(projectId),employeeId:String(employeeId),
      commercialRole:employee.internalRole||'',roleDisplayMode:'internal',
      costRegular:costs.costRegular,cost50:costs.cost50,cost100:costs.cost100,
      saleRegular:0,sale50:0,sale100:0,active:true,operationalOnly:true
    };
  },
  hhConfigurationIssues(projectId,entries=[]){
    if(!this.isHhProject(projectId)) return [];
    return entries.filter(entry=>!this.isAbsent(entry)).map(entry=>{
      const employee=this.crewMembers().find(item=>String(item.id)===String(entry.employeeId))||{};
      const rate=this.rateFor(projectId,entry.employeeId);
      const role=rate?.roleDisplayMode==='internal' ? employee.internalRole : rate?.commercialRole;
      const missing=[];
      if(!rate) missing.push('valor HH');
      if(!rate||!(Number(rate.costRegular)>0)) missing.push('custo');
      if(!String(role||'').trim()) missing.push('função');
      return missing.length?{employeeId:entry.employeeId,employeeName:employee.name||entry.employeeName||'Colaborador',missing}:null;
    }).filter(Boolean);
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
    const nightHours=Number(entry.nightHours)||0;
    const nightPremiumPct=Number.isFinite(Number(entry.nightPremiumPct))?Number(entry.nightPremiumPct):this.nightPremiumPct();
    const nightCost=nightHours*(Number(rate.costRegular)||0)*nightPremiumPct/100;
    return {
      hours:regular+overtime50+overtime100,
      cost:regular*(Number(rate.costRegular)||0)
        + overtime50*(Number(rate.cost50)||0)
        + overtime100*(Number(rate.cost100)||0)
        + nightCost,
      sale:regular*(Number(rate.saleRegular)||0)
        + overtime50*(Number(rate.sale50)||0)
        + overtime100*(Number(rate.sale100)||0),
      nightHours,nightPremiumPct,nightCost
    };
  },
  calculate(rdo){
    const rows=(rdo.entries||[]).filter(entry=>!this.isAbsent(entry)).map(entry=>{
      const employee=State.crew.find(x=>String(x.id)===String(entry.employeeId))||{};
      const rate=this.rdoRateFor(rdo.projectId,entry.employeeId);
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
      missingRates:rows.filter(row=>!row.rate||!(Number(row.rate.costRegular)>0))
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
  documentNumber(rdo){
    const project=State.projects.find(item=>String(item.id)===String(rdo?.projectId));
    const projectNumber=String(project?.proposal||rdo?.projectId||'').match(/\d+/)?.[0]||'0';
    const date=String(rdo?.date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return `${projectNumber}-${date?.[3]||'00'}-${date?.[2]||'00'}`;
  },
  auditTrail(rdo){
    if(Array.isArray(rdo?.auditTrail)&&rdo.auditTrail.length)
      return rdo.auditTrail.filter(event=>event&&event.action&&event.at);
    const fallback=[];
    if(rdo?.createdAt) fallback.push({action:'created',actorName:rdo.createdBy||'Usuário',at:rdo.createdAt});
    if(rdo?.approvedAt) fallback.push({action:'approved',actorName:rdo.approvedBy||'Usuário',at:rdo.approvedAt});
    if(rdo?.rejectedAt) fallback.push({action:'rejected',actorName:rdo.rejectedBy||'Usuário',at:rdo.rejectedAt});
    return fallback;
  },
  auditMarkup(rdo){
    const labels={created:'Criado',edited:'Editado',submitted:'Enviado',approved:'Aprovado',rejected:'Reprovado',reopened:'Reaberto'};
    const icons={created:'file-plus-2',edited:'pencil',submitted:'send',approved:'badge-check',rejected:'x-circle',reopened:'undo-2'};
    const events=this.auditTrail(rdo).slice().reverse();
    return `<section class="rdo-audit"><div class="rdo-section-title"><div><h3>Histórico interno</h3><small>Auditoria de ações no sistema. Este histórico não aparece no PDF do cliente.</small></div></div>
      <div class="rdo-audit-list">${events.map(event=>{
        const date=new Date(event.at); const when=isNaN(date)?'Data não informada':date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
        return `<article><i data-lucide="${icons[event.action]||'history'}"></i><span><b>${U.esc(labels[event.action]||'Atualizado')}</b><small>${U.esc(event.actorName||'Usuário')} · ${U.esc(when)}</small></span></article>`;
      }).join('')||'<div class="rdo-attachment-empty">Histórico indisponível para este registro antigo.</div>'}</div></section>`;
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

  dayOffForm(selectedDate=''){
    if(!this.fullAccess()) return UI.toast('Somente a equipe administrativa pode controlar folgas.','warn',6500);
    const date=/^\d{4}-\d{2}-\d{2}$/.test(String(selectedDate))?String(selectedDate):U.isoDate(new Date());
    const crew=this.activeCrew(date);
    if(!crew.length) return UI.toast('Cadastre colaboradores ativos antes de controlar folgas.','warn',6000);
    const current=new Map(this.dayOffs(date).map(item=>[String(item.employeeId),item]));
    const rdoOccupancy=new Map();
    (Array.isArray(State.rdos)?State.rdos:[]).filter(rdo=>String(rdo.date||'').slice(0,10)===date).forEach(rdo=>{
      (Array.isArray(rdo.entries)?rdo.entries:[]).forEach(entry=>{
        const employeeId=String(entry.employeeId||'');
        if(employeeId&&!rdoOccupancy.has(employeeId)) rdoOccupancy.set(employeeId,{rdo,entry});
      });
    });
    UI.modal({
      title:'Controle administrativo de folgas',
      wide:true,
      body:`<div class="form-grid"><div><label>Dia selecionado</label><input id="day-off-date" type="date" value="${U.esc(date)}"></div><div class="import-log"><b>Regra:</b> folga não gera horas nem custo e não pode coexistir com alocação ou falta no mesmo dia.</div></div>
        <div class="workforce-status-list">${crew.map(employee=>{
          const occupied=rdoOccupancy.get(String(employee.id));
          const checked=current.has(String(employee.id));
          const detail=occupied
            ?`${this.isAbsent(occupied.entry)?'Falta registrada':'Alocado'} · ${this.projectLabel(occupied.rdo.projectId)}`
            :checked?'Folga registrada':'Disponível para marcação';
          return `<label class="check-item ${occupied?'disabled':''}"><input type="checkbox" data-day-off-employee="${U.esc(employee.id)}" ${checked?'checked':''} ${occupied?'disabled':''}><span><b>${U.esc(employee.name||'Colaborador')}</b><small>${employee.registration?`Matrícula ${U.esc(employee.registration)} · `:''}${U.esc(detail)}</small></span></label>`;
        }).join('')}</div>`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="day-off-save"><i data-lucide="calendar-check"></i>Salvar folgas</button>',
      onOpen:()=>{
        document.getElementById('day-off-date').onchange=event=>{
          const next=event.target.value;
          if(!next) return;
          UI.close();
          setTimeout(()=>this.dayOffForm(next),0);
        };
        document.getElementById('day-off-save').onclick=async()=>{
          const selected=new Set([...document.querySelectorAll('[data-day-off-employee]:checked')].map(input=>String(input.dataset.dayOffEmployee)));
          try{
            UI.loading(true,'Salvando folgas…');
            for(const employee of crew){
              const employeeId=String(employee.id);
              const existing=current.get(employeeId);
              if(selected.has(employeeId)&&!existing){
                const now=new Date().toISOString();
                await DB.put('workforce_status',{
                  id:this.dayOffRecordId(date,employeeId),date,employeeId,
                  employeeName:employee.name||'Colaborador',employeeRegistration:employee.registration||'',
                  internalRole:employee.internalRole||'',status:'day_off',
                  createdAt:now,createdBy:this.authorName(),updatedAt:now,updatedBy:this.authorName()
                });
              }else if(!selected.has(employeeId)&&existing){
                await DB.del('workforce_status',existing.id);
              }
            }
            await State.reload();
            UI.loading(false); UI.closeAll();
            UI.toast('Folgas do dia atualizadas.','success',5000);
            App.render();
          }catch(err){
            UI.loading(false);
            UI.toast('Não foi possível salvar as folgas: '+U.esc(err.message||err),'error',7500);
          }
        };
      }
    });
  },

  async save(rdo,status){
    if(!rdo.projectId || !rdo.date) throw new Error('Informe o projeto e a data.');
    if(!Array.isArray(rdo.entries) || !rdo.entries.length)
      throw new Error('Selecione ao menos um colaborador ou registre uma falta.');
    if(status==='Enviado'){
      if(!String(rdo.description||'').trim()) throw new Error('Descreva o serviço realizado.');
      if(rdo.entries.some(row=>!this.isAbsent(row)&&(Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0)<=0))
        throw new Error('Todos os colaboradores selecionados precisam ter horas informadas.');
    }
    const allowed=new Set(this.allowedProjects().map(x=>String(x.id)));
    if(!allowed.has(String(rdo.projectId))) throw new Error('Projeto indisponível para este RDO.');
    const conflicts=this.allocationConflicts(rdo.date,rdo.id,rdo.entries);
    if(conflicts.length){
      const names=conflicts.map(item=>item.employeeName).join(', ');
      const hasDayOff=conflicts.some(item=>item.situation==='Folga');
      throw new Error(hasDayOff
        ?`${names} ${conflicts.length===1?'está de folga':'estão de folga'} nesta data. Remova a folga antes de incluir no RDO.`
        :`${names} já ${conflicts.length===1?'está registrado':'estão registrados'} em outro RDO nesta data. Atualize a tela antes de continuar.`);
    }
    // v4.2.7 - a checagem local acima só enxerga os RDOs entregues pela RLS.
    // A remota fecha o buraco que permitia o mesmo colaborador em dois diários
    // do mesmo dia quando o segundo RDO estava num projeto invisível ao usuário.
    const remoteConflicts=await this.remoteAllocationConflicts(rdo);
    if(remoteConflicts.length){
      const names=remoteConflicts.join(', ');
      throw new Error(`${names} já ${remoteConflicts.length===1?'está registrado':'estão registrados'} em outro diário ou de folga nesta data. Remova ${remoteConflicts.length===1?'o colaborador':'os colaboradores'} antes de salvar.`);
    }
    if(status==='Enviado'){
      const issues=this.hhConfigurationIssues(rdo.projectId,rdo.entries);
      if(issues.length){
        const summary=issues.map(item=>`${item.employeeName} (${item.missing.join(', ')})`).join('; ');
        throw new Error(`Projetos HH exigem função e custo da mão de obra antes do envio. Configure em Colaboradores/Valores HH: ${summary}.`);
      }
      // v4.2.7 - mesma validação, agora também para quem não enxerga o cadastro
      // de projetos nem os valores HH (perfil Apontador de RDO).
      if(!issues.length){
        const remoteIssues=await this.remoteHhIssues(rdo);
        if(remoteIssues.length){
          const summary=remoteIssues.map(item=>`${item.employeeName} (${item.missing})`).join('; ');
          throw new Error(`Projetos HH exigem função e custo da mão de obra antes do envio. Peça ao administrador para configurar: ${summary}.`);
        }
      }
    }
    // v4.2.7 - o número definitivo só é reservado quando o diário nasce, e vem
    // do servidor para não repetir número já usado em projeto que este usuário
    // não enxerga.
    const isNew=!(Array.isArray(State.rdos)?State.rdos:[]).some(item=>String(item&&item.id)===String(rdo.id));
    const number=isNew?await this.nextNumber():(rdo.number||await this.nextNumber());
    const updated={
      ...rdo,
      number,
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
        nightHours:Number(row.nightHours)||0,
        nightPremiumPct:Number(row.nightPremiumPct)||0,
        costRegular:Number(row.rate.costRegular)||0,
        cost50:Number(row.rate.cost50)||0,
        cost100:Number(row.rate.cost100)||0,
        saleRegular:Number(row.rate.saleRegular)||0,
        sale50:Number(row.rate.sale50)||0,
        sale100:Number(row.rate.sale100)||0,
        nightCost:Math.round((Number(row.nightCost)||0)*100)/100,
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
      sourceType:'labor',
      sourceRdoId:String(rdo.id),
      abatido:false,
      createdAt:Date.now()
    };
    try{
      UI.loading(true,'Aprovando diário…');
      if(typeof Cloud!=='undefined' && Cloud.active()){
        await Cloud.approveRdo(rdo.id,financial);
        await DB.syncFromCloud();
      }else{
        // v4.0.2 — sem nuvem, o abatimento é calculado aqui e gravado na mesma
        // transação local da aprovação.
        const offset=State.planPlanningConsumption(
          purchase.projectId,purchase.category,purchase.value,rdo.id,
          'rdo_consumed','rdo','Custo de mão de obra do RDO abatido do planejamento');
        Object.assign(purchase,{
          planningOffsets:offset.offsets,
          planningOffsetAmount:offset.applied,
          planningUnmatchedAmount:offset.unmatched,
          abatido:offset.applied>0,
          planningOffsetAt:new Date().toISOString()
        });
        await DB.approveRdoLocal(financial,purchase,{
          ...rdo,
          status:'Aprovado',
          approvedAt:financial.approvedAt,
          approvedBy:financial.approvedBy,
          updatedAt:financial.approvedAt
        },offset.planningRows,offset.historyRows);
      }
      await State.reload();
      UI.loading(false);
      UI.closeAll();
      UI.toast('RDO aprovado. O custo da mão de obra entrou no realizado e foi abatido do planejamento.','success',7000);
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
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-danger" id="rdo-reject-confirm"><i data-lucide="x-square"></i>Reprovar diário</button>'
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
            // v4.0.2 — devolve ao planejamento o que este RDO havia abatido,
            // antes de remover o custo realizado.
            if(purchase && Array.isArray(purchase.planningOffsets) && purchase.planningOffsets.length){
              const restore=State.planPlanningRestore(purchase.planningOffsets,rdo.id,
                'rdo_restored','rdo','Planejamento restaurado após exclusão do RDO');
              for(const row of restore.planningRows) await DB.put('planning',row);
              for(const row of restore.historyRows) await DB.put('planning_history',row);
            }
            if(financial) await DB.del('rdo_financial',financial.id);
            if(purchase) await DB.del('purchases',purchase.id);
          }
          await DB.del('rdos',rdo.id);
        }
        this.attachmentCache.delete(String(rdo.id));
        await State.reload();
        UI.loading(false);
        UI.toast(approved?'RDO aprovado excluído. Custo estornado e planejamento restaurado.':'RDO excluído.','warn',6500);
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
    const crew=this.activeCrew(existing?.date||U.isoDate(new Date()));
    if(!projects.length) return UI.toast('Nenhum projeto foi disponibilizado para preenchimento de RDO.','warn',6500);
    if(!crew.length) return UI.toast('Cadastre a equipe antes de criar o primeiro RDO.','warn',6500);
    const initialDate=existing?.date||U.isoDate(new Date());
    const initialHoliday=existing?.isHoliday===true;
    const initialEntries=new Map((existing?.entries||[]).map(row=>[String(row.employeeId),row]));
    const defaultShift=this.defaultShift(initialDate);
    const defaultHours=this.workedHours(defaultShift.start,defaultShift.end,defaultShift.breakMinutes,this.standardDailyHours(),initialDate,initialHoliday);
    const defaultNightHours=this.nightHours(defaultShift.start,defaultShift.end,defaultShift.breakMinutes);
    const sharedEntry=(existing?.entries||[]).find(entry=>!this.isAbsent(entry))||{...defaultShift,...defaultHours,nightHours:defaultNightHours};
    const workerCard=employee=>{
      const saved=initialEntries.get(String(employee.id));
      const absent=this.isAbsent(saved);
      const selected=!!saved&&!absent;
      const row=saved||{...defaultShift,...defaultHours,nightHours:defaultNightHours};
      const rowNightHours=Number.isFinite(Number(row.nightHours))?Number(row.nightHours):this.nightHours(row.start,row.end,row.breakMinutes);
      const searchText=U.norm(`${employee.registration||''} ${employee.name||''} ${employee.internalRole||''}`);
      const photo=U.safeImageSrc(employee.photo||'');
      return `<article class="rdo-worker-card ${selected?'selected':''} ${absent?'absent':''}" data-employee-id="${U.esc(employee.id)}" data-search="${U.esc(searchText)}" data-attendance-status="${absent?'absent':selected?'present':'none'}">
        <div class="rdo-worker-head">
          <label class="rdo-worker-select"><input type="checkbox" ${selected?'checked':''}>${photo?`<img class="employee-avatar" src="${U.esc(photo)}" alt="">`:`<span class="avatar-ph">${U.initials(employee.name||'CO')}</span>`}
            <span><b>${U.esc(employee.name||'Colaborador')}</b><small>${employee.registration?`Matrícula ${U.esc(employee.registration)} · `:''}${U.esc(employee.internalRole||'Sem função')}</small></span></label>
          <span class="rdo-worker-actions"><button type="button" class="rdo-absence-toggle" aria-pressed="${absent?'true':'false'}"><i data-lucide="user-x"></i><span>${absent?'Falta registrada':'Registrar falta'}</span></button><span class="rdo-worker-total">${absent?'Falta':U.pct((Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0)).replace('%','h')}</span></span>
        </div>
        <div class="rdo-worker-fields">
          <label>Entrada<input data-field="start" type="time" value="${U.esc(row.start||defaultShift.start)}"></label>
          <label>Saída<input data-field="end" type="time" value="${U.esc(row.end||defaultShift.end)}"></label>
          <label>Intervalo<input data-field="breakMinutes" type="time" step="300" max="06:00" value="${this.minutesToTime(row.breakMinutes)}"></label>
          <label>Normal<input data-field="regular" type="number" min="0" max="24" step="0.25" value="${Number(row.regular)||0}"></label>
          <label>HE 50%<input data-field="overtime50" type="number" min="0" max="24" step="0.25" value="${Number(row.overtime50)||0}"></label>
          <label>HE 100%<input data-field="overtime100" type="number" min="0" max="24" step="0.25" value="${Number(row.overtime100)||0}"></label>
          <label>Adic. noturno<input data-field="nightHours" type="number" min="0" max="24" step="0.01" value="${rowNightHours}" readonly></label>
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
            ${existing?.status==='Devolvido'&&existing.rejectionComment?`<div class="rdo-rejection-banner"><i data-lucide="alert-triangle"></i><div><b>Correção solicitada</b><p>${U.esc(existing.rejectionComment)}</p></div></div>`:''}
            <div class="rdo-step-heading"><span>01</span><div><h3>Informações do diário</h3><p>Defina o projeto, a data e a frente de serviço.</p></div></div>
            <div class="form-grid">
              <div><label>Projeto *</label><select id="rdo-project" ${existing?'disabled':''}>${projects.map(project=>`<option value="${U.esc(project.id)}" ${String(project.id)===String(existing?.projectId||'')?'selected':''}>${U.esc(project.label)}</option>`).join('')}</select></div>
              <div><label>Data do serviço *</label><input id="rdo-date" type="date" value="${U.esc(initialDate)}"></div>
              <div class="full"><label class="rdo-holiday-toggle"><input id="rdo-holiday" type="checkbox" ${initialHoliday?'checked':''}><span><i data-lucide="calendar-check"></i></span><b>Este dia é feriado</b><small>Feriados são calculados integralmente como hora extra de 100%.</small></label><div class="rdo-day-type" id="rdo-day-type">${U.esc(this.dayTypeLabel(initialDate,initialHoliday))}</div></div>
              <div class="full"><label>Local / frente de serviço</label><input id="rdo-location" maxlength="180" value="${U.esc(existing?.location||'')}" placeholder="Ex.: Subestação SE-04"></div>
            </div>
            <div class="rdo-context-card"><i data-lucide="briefcase"></i><div><b>Projeto autorizado para este usuário</b><small>A lista respeita as permissões configuradas pelo administrador.</small></div><i data-lucide="check-circle-2"></i></div>
          </section>

          <section class="rdo-step" data-rdo-step="2" hidden>
            <div class="rdo-step-heading"><span>02</span><div><h3>Equipe e horas trabalhadas</h3><p>O horário geral preenche automaticamente todos os colaboradores selecionados.</p></div></div>
            <div class="rdo-team-template">
              <label>Entrada<input id="rdo-all-start" type="time" value="${U.esc(sharedEntry.start||defaultShift.start)}"></label>
              <label>Saída<input id="rdo-all-end" type="time" value="${U.esc(sharedEntry.end||defaultShift.end)}"></label>
              <label>Intervalo<input id="rdo-all-break" type="time" step="300" max="06:00" value="${this.minutesToTime(sharedEntry.breakMinutes)}"></label>
              <label>Normal<input id="rdo-all-regular" type="number" min="0" max="24" step="0.25" value="${Number(sharedEntry.regular)||0}"></label>
              <label>HE 50%<input id="rdo-all-50" type="number" min="0" max="24" step="0.25" value="${Number(sharedEntry.overtime50)||0}"></label>
              <label>HE 100%<input id="rdo-all-100" type="number" min="0" max="24" step="0.25" value="${Number(sharedEntry.overtime100)||0}"></label>
              <label>Adic. noturno<input id="rdo-all-night" type="number" min="0" max="24" step="0.01" value="${Number.isFinite(Number(sharedEntry.nightHours))?Number(sharedEntry.nightHours):defaultNightHours}" readonly></label>
            </div>
            <div class="rdo-team-summary" id="rdo-team-summary"></div>
            <div class="rdo-team-availability" id="rdo-team-availability" hidden><i data-lucide="shield-check"></i><span></span></div>
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
        let availabilityRevision=0;
        const byId=id=>document.getElementById(id);
        const isAbsentCard=card=>String(card.dataset.attendanceStatus)==='absent';
        const isPresentCard=card=>card.querySelector('.rdo-worker-select input').checked&&!isAbsentCard(card);

        const refreshTotal=card=>{
          const total=['regular','overtime50','overtime100'].reduce((sum,key)=>sum+U.num(card.querySelector(`[data-field="${key}"]`).value),0);
          card.querySelector('.rdo-worker-total').textContent=isAbsentCard(card)?'Falta':`${total.toLocaleString('pt-BR',{maximumFractionDigits:2})}h`;
        };
        const setAttendance=(card,status)=>{
          const normalized=['present','absent'].includes(status)?status:'none';
          const checkbox=card.querySelector('.rdo-worker-select input');
          const absenceButton=card.querySelector('.rdo-absence-toggle');
          card.dataset.attendanceStatus=normalized;
          checkbox.checked=normalized==='present';
          card.classList.toggle('selected',normalized==='present');
          card.classList.toggle('absent',normalized==='absent');
          card.querySelectorAll('.rdo-worker-fields input').forEach(input=>input.disabled=normalized==='absent');
          absenceButton.setAttribute('aria-pressed',normalized==='absent'?'true':'false');
          absenceButton.querySelector('span').textContent=normalized==='absent'?'Falta registrada':'Registrar falta';
          refreshTotal(card);
        };
        const sharedValues=()=>({
          start:byId('rdo-all-start').value,
          end:byId('rdo-all-end').value,
          breakMinutes:byId('rdo-all-break').value,
          regular:byId('rdo-all-regular').value,
          overtime50:byId('rdo-all-50').value,
          overtime100:byId('rdo-all-100').value,
          nightHours:byId('rdo-all-night').value
        });
        const applyToCard=card=>{
          if(isAbsentCard(card)) return;
          Object.entries(sharedValues()).forEach(([field,value])=>{
            card.querySelector(`[data-field="${field}"]`).value=value;
          });
          refreshTotal(card);
        };
        const refreshTeamSummary=()=>{
          const selected=cards.filter(isPresentCard);
          const absent=cards.filter(isAbsentCard);
          const hours=selected.reduce((sum,card)=>sum+['regular','overtime50','overtime100'].reduce(
            (total,key)=>total+U.num(card.querySelector(`[data-field="${key}"]`).value),0
          ),0);
          byId('rdo-team-summary').innerHTML=`<span><b>${selected.length}</b> alocado(s)</span><span><b>${absent.length}</b> falta(s)</span><span><b>${hours.toLocaleString('pt-BR',{maximumFractionDigits:2})}h</b> no total</span>`;
        };
        const filterTeam=()=>{
          const query=U.norm(byId('rdo-team-search').value);
          let visible=0;
          cards.forEach(card=>{
            const matches=!query || String(card.dataset.search||'').includes(query);
            const available=card.dataset.unavailable!=='true';
            card.hidden=!matches||!available;
            if(matches&&available) visible++;
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
        const currentDate=()=>byId('rdo-date').value;
        const currentHoliday=()=>byId('rdo-holiday').checked;
        const refreshAvailability=async()=>{
          const revision=++availabilityRevision;
          const occupied=this.occupiedEmployees(currentDate(),existing?.id||'');
          if(typeof Cloud!=='undefined'&&Cloud.active()&&typeof Cloud.occupiedRdoEmployees==='function'){
            try{
              const remoteIds=await Cloud.occupiedRdoEmployees(currentDate(),existing?.id||'');
              if(revision!==availabilityRevision) return;
              remoteIds.forEach(employeeId=>{
                if(!occupied.has(String(employeeId))) occupied.set(String(employeeId),{remote:true});
              });
            }catch(err){
              if(revision!==availabilityRevision) return;
            }
          }
          let unavailable=0;
          cards.forEach(card=>{
            const conflict=occupied.get(String(card.dataset.employeeId));
            card.dataset.unavailable=conflict?'true':'false';
            if(conflict){
              unavailable++;
              if(isPresentCard(card)||isAbsentCard(card)) setAttendance(card,'none');
            }
          });
          const notice=byId('rdo-team-availability');
          notice.hidden=unavailable===0;
          notice.querySelector('span').textContent=unavailable===1
            ?'1 colaborador já está registrado em outro RDO nesta data e foi ocultado.'
            :`${unavailable} colaboradores já estão registrados em outros RDOs nesta data e foram ocultados.`;
          filterTeam();
          refreshTeamSummary();
        };
        const refreshDayType=()=>{
          byId('rdo-day-type').textContent=this.dayTypeLabel(currentDate(),currentHoliday());
        };
        const recalculateCard=card=>{
          const start=card.querySelector('[data-field="start"]').value;
          const end=card.querySelector('[data-field="end"]').value;
          const breakMinutes=this.breakInput(card.querySelector('[data-field="breakMinutes"]').value);
          const hours=this.workedHours(start,end,breakMinutes,this.standardDailyHours(),currentDate(),currentHoliday());
          card.querySelector('[data-field="regular"]').value=hours.regular;
          card.querySelector('[data-field="overtime50"]').value=hours.overtime50;
          card.querySelector('[data-field="overtime100"]').value=hours.overtime100;
          card.querySelector('[data-field="nightHours"]').value=this.nightHours(start,end,breakMinutes);
          refreshTotal(card);
        };
        cards.forEach(card=>{
          const checkbox=card.querySelector('.rdo-worker-select input');
          checkbox.onchange=()=>{
            setAttendance(card,checkbox.checked?'present':'none');
            if(checkbox.checked) applyToCard(card);
            refreshTeamSummary();
          };
          card.querySelector('.rdo-absence-toggle').onclick=()=>{
            setAttendance(card,isAbsentCard(card)?'none':'absent');
            refreshTeamSummary();
          };
          card.querySelectorAll('[data-field="start"],[data-field="end"],[data-field="breakMinutes"]').forEach(input=>input.onchange=()=>{
            recalculateCard(card);
            refreshTeamSummary();
          });
          card.querySelectorAll('[data-field="regular"],[data-field="overtime50"],[data-field="overtime100"]').forEach(input=>input.oninput=()=>{
            refreshTotal(card);
            refreshTeamSummary();
          });
          setAttendance(card,card.dataset.attendanceStatus);
          refreshTotal(card);
        });
        const applyToAll=()=>{
          cards.filter(isPresentCard).forEach(card=>{
            applyToCard(card);
          });
          refreshTeamSummary();
        };
        const recalcTemplate=()=>{
          const hours=this.workedHours(
            byId('rdo-all-start').value,
            byId('rdo-all-end').value,
            this.breakInput(byId('rdo-all-break').value),
            this.standardDailyHours(),currentDate(),currentHoliday()
          );
          byId('rdo-all-regular').value=hours.regular;
          byId('rdo-all-50').value=hours.overtime50;
          byId('rdo-all-100').value=hours.overtime100;
          byId('rdo-all-night').value=this.nightHours(byId('rdo-all-start').value,byId('rdo-all-end').value,this.breakInput(byId('rdo-all-break').value));
          applyToAll();
        };
        ['rdo-all-start','rdo-all-end','rdo-all-break'].forEach(fieldId=>byId(fieldId).onchange=recalcTemplate);
        ['rdo-all-regular','rdo-all-50','rdo-all-100'].forEach(fieldId=>byId(fieldId).oninput=applyToAll);
        byId('rdo-holiday').onchange=()=>{refreshDayType();recalcTemplate();};
        byId('rdo-date').onchange=async()=>{
          const shift=this.defaultShift(currentDate());
          byId('rdo-all-start').value=shift.start;
          byId('rdo-all-end').value=shift.end;
          byId('rdo-all-break').value=this.minutesToTime(shift.breakMinutes);
          refreshDayType();
          await refreshAvailability();
          recalcTemplate();
        };
        refreshDayType();

        const collect=()=>({
          ...(existing||{
            id:U.id(),
            number:this.localNumber(),
            createdAt:new Date().toISOString(),
            createdBy:this.authorName()
          }),
          projectId:document.getElementById('rdo-project').value,
          date:document.getElementById('rdo-date').value,
          isHoliday:document.getElementById('rdo-holiday').checked,
          dayType:this.dayType(document.getElementById('rdo-date').value,document.getElementById('rdo-holiday').checked),
          nightPremiumPct:this.nightPremiumPct(),
          location:document.getElementById('rdo-location').value.trim(),
          description:document.getElementById('rdo-description').value.trim(),
          notes:document.getElementById('rdo-notes').value.trim(),
          entries:cards.filter(card=>isPresentCard(card)||isAbsentCard(card)).map(card=>{
            const employee=State.crew.find(x=>String(x.id)===String(card.dataset.employeeId))||{};
            const absent=isAbsentCard(card);
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
              attendanceStatus:absent?'absent':'present',
              start:absent?'':card.querySelector('[data-field="start"]').value,
              end:absent?'':card.querySelector('[data-field="end"]').value,
              breakMinutes:absent?0:this.breakInput(card.querySelector('[data-field="breakMinutes"]').value),
              regular:absent?0:U.num(card.querySelector('[data-field="regular"]').value),
              overtime50:absent?0:U.num(card.querySelector('[data-field="overtime50"]').value),
              overtime100:absent?0:U.num(card.querySelector('[data-field="overtime100"]').value),
              nightHours:absent?0:U.num(card.querySelector('[data-field="nightHours"]').value),
              nightPremiumPct:this.nightPremiumPct()
            };
          }),
          attachmentCount:savedAttachments.length+pendingFiles.length
        });

        const renderAttachments=()=>{
          const rows=[
            ...savedAttachments.map(item=>({...item,saved:true})),
            ...pendingFiles.map(item=>({
              id:item.id,fileName:item.file.name,mimeType:item.file.type,sizeBytes:item.file.size,
              description:item.description||'',previewUrl:item.previewUrl,saved:false
            }))
          ];
          byId('rdo-attachment-count').textContent=`${rows.length} ${rows.length===1?'anexo adicionado':'anexos adicionados'}`;
          byId('rdo-attachment-list').innerHTML=rows.map(item=>`<article class="rdo-attachment-item">
            <span class="rdo-attachment-thumb ${this.isImage(item)?'image':'file'}">
              ${item.previewUrl?`<img src="${U.esc(item.previewUrl)}" alt="">`:`<i data-lucide="${this.isImage(item)?'image':'file-text'}"></i>`}
            </span>
            <span class="rdo-attachment-copy"><b>${U.esc(item.fileName||'arquivo')}</b><input class="rdo-attachment-description" maxlength="180" value="${U.esc(item.description||'')}" placeholder="${this.isImage(item)?'Descrição da foto':'Descrição do anexo'}" data-description-${item.saved?'saved':'pending'}="${U.esc(item.id)}" aria-label="${this.isImage(item)?'Descrição da foto':'Descrição do anexo'}"><small>${this.isImage(item)?'Foto':'Documento'} · ${this.formatFileSize(item.sizeBytes)}</small></span>
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
          byId('rdo-attachment-list').querySelectorAll('[data-description-pending]').forEach(input=>input.oninput=()=>{
            const item=pendingFiles.find(row=>String(row.id)===String(input.dataset.descriptionPending));
            if(item) item.description=String(input.value||'').slice(0,180);
          });
          byId('rdo-attachment-list').querySelectorAll('[data-description-saved]').forEach(input=>input.onchange=async()=>{
            const item=savedAttachments.find(row=>String(row.id)===String(input.dataset.descriptionSaved));
            if(!item) return;
            const previous=String(item.description||''),next=String(input.value||'').trim().slice(0,180);
            if(next===previous) return;
            try{
              input.disabled=true;
              const updated=typeof Cloud!=='undefined'&&Cloud.active()
                ? await Cloud.updateRdoAttachmentDescription(item,next)
                : {...item,description:next};
              if(typeof Cloud==='undefined'||!Cloud.active()) await DB.attachmentPut(updated);
              Object.assign(item,updated,{description:next});
              this.attachmentCache.set(String(existing.id),savedAttachments.slice());
              UI.toast('Descrição da evidência atualizada.','success',3000);
            }catch(err){
              input.value=previous;
              UI.toast('Não foi possível atualizar a descrição: '+U.esc(err.message||err),'error',6500);
            }finally{input.disabled=false;}
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
              pendingFiles.push({id:U.id(),file,description:'',previewUrl});
            }catch(err){ UI.toast(U.esc(err.message||err),'warn',6500); }
          }
          renderAttachments();
        };
        byId('rdo-camera-button').onclick=()=>byId('rdo-camera-input').click();
        byId('rdo-file-button').onclick=()=>byId('rdo-file-input').click();
        byId('rdo-camera-input').onchange=event=>{ queueFiles([...event.target.files]); event.target.value=''; };
        byId('rdo-file-input').onchange=event=>{ queueFiles([...event.target.files]); event.target.value=''; };
        byId('rdo-description').oninput=()=>{ byId('rdo-description-count').textContent=byId('rdo-description').value.length; };

        const selectedCards=()=>cards.filter(isPresentCard);
        const absentCards=()=>cards.filter(isAbsentCard);
        const validateStep=step=>{
          if(step===1 && (!byId('rdo-project').value||!byId('rdo-date').value)){
            UI.toast('Informe o projeto e a data do serviço.','warn');
            return false;
          }
          if(step===2){
            if(!selectedCards().length&&!absentCards().length){
              UI.toast('Selecione ao menos um colaborador ou registre uma falta.','warn');
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
          const present=rdo.entries.filter(row=>!this.isAbsent(row));
          const absent=rdo.entries.filter(row=>this.isAbsent(row));
          const regular=present.reduce((sum,row)=>sum+(Number(row.regular)||0),0);
          const extra50=present.reduce((sum,row)=>sum+(Number(row.overtime50)||0),0);
          const extra100=present.reduce((sum,row)=>sum+(Number(row.overtime100)||0),0);
          const night=present.reduce((sum,row)=>sum+(Number(row.nightHours)||0),0);
          byId('rdo-review').innerHTML=`
            <article><div><i data-lucide="calendar-days"></i><b>Informações</b><button type="button" data-review-step="1">Editar</button></div>
              <dl><span><dt>Data</dt><dd>${U.date(rdo.date)}</dd></span><span><dt>Classificação</dt><dd>${U.esc(this.dayTypeLabel(rdo.date,rdo.isHoliday))}</dd></span><span><dt>Projeto</dt><dd>${U.esc(project?.label||'Projeto')}</dd></span><span><dt>Local</dt><dd>${U.esc(rdo.location||'Não informado')}</dd></span></dl></article>
            <article class="full"><div><i data-lucide="users"></i><b>Equipe e horas</b><button type="button" data-review-step="2">Editar</button></div>
              <dl><span><dt>Alocados</dt><dd>${present.length} pessoa(s)</dd></span><span><dt>Faltas</dt><dd>${absent.length}</dd></span><span><dt>Normal</dt><dd>${regular.toLocaleString('pt-BR')}h</dd></span><span><dt>HE 50% / 100%</dt><dd>${extra50.toLocaleString('pt-BR')}h / ${extra100.toLocaleString('pt-BR')}h</dd></span><span><dt>Adic. noturno</dt><dd>${night.toLocaleString('pt-BR')}h · ${rdo.nightPremiumPct}%</dd></span></dl>
              ${present.length?`<div class="rdo-review-people"><small>Colaboradores alocados</small><ul>${present.map(row=>`<li><b>${U.esc(row.employeeName||'Colaborador')}</b><span>${U.esc(row.start||'—')} · ${U.durationMinutes(row.breakMinutes)} · ${U.esc(row.end||'—')}</span><span>${((Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0)).toLocaleString('pt-BR',{maximumFractionDigits:2})}h</span></li>`).join('')}</ul></div>`:''}
              ${absent.length?`<div class="rdo-review-people absent"><small>Faltas registradas</small><ul>${absent.map(row=>`<li><b>${U.esc(row.employeeName||'Colaborador')}</b><span>Sem horas no dia</span><span>Falta</span></li>`).join('')}</ul></div>`:''}</article>
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
            if(status==='Enviado' && ![1,2,3].every(validateStep)) return;
            if(status==='Rascunho' && ![1,2].every(validateStep)) return;
            if(status==='Enviado' && !byId('rdo-confirmation').checked)
              return UI.toast('Confirme a revisão antes de enviar.','warn',5500);
            const rdo=collect();
            busy=true;
            UI.loading(true,pendingFiles.length?'Salvando diário e anexos…':'Salvando diário…');
            await this.save(rdo,'Rascunho');
            for(const pending of [...pendingFiles]){
              const attachment=await this.saveAttachment(rdo,pending.file,pending.description);
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
        await refreshAvailability();
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
        <div><span><i data-lucide="calendar-days"></i>${U.date(rdo.date)}</span><span><i data-lucide="users"></i>${this.visibleEntries(rdo).length} colaboradores presentes</span><span><i data-lucide="clock-3"></i>${total.toLocaleString('pt-BR',{maximumFractionDigits:2})}h</span><span><i data-lucide="paperclip"></i>${attachmentCount} anexos</span></div>
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
        <span>${attachment.url?`<img src="${U.esc(attachment.url)}" alt="${U.esc(attachment.description||attachment.fileName)}">`:`<i data-lucide="${this.isImage(attachment)?'image':'file-text'}"></i>`}</span>
        <b>${U.esc(attachment.description||attachment.fileName)}</b><small>${U.esc(attachment.fileName)} · ${this.formatFileSize(attachment.sizeBytes)}</small>
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
        title:U.esc(attachment.description||attachment.fileName),
        wide:true,
        body:`<div class="rdo-photo-preview"><img src="${U.esc(url)}" alt="${U.esc(attachment.description||attachment.fileName)}"></div>`,
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

  // v4.2.4 — cabeçalho completo do documento. A RLS esconde settings,
  // projects, clients e labor_rates de quem só preenche diário, então esses
  // dados vêm da RPC clique_obras_rdo_document_header. Qualquer falha cai no
  // comportamento anterior (State), sem quebrar quem já enxerga tudo.
  async documentHeader(rdo){
    const empty={
      company:{name:'',cnpj:'',logo:'',letterhead:''},
      client:{name:'',cnpj:'',logo:''},
      project:{},roles:{},projectLabel:''
    };
    if(typeof Cloud==='undefined' || !Cloud.active() || typeof Cloud.rdoDocumentHeader!=='function')
      return empty;
    try{
      const data=await Cloud.rdoDocumentHeader(rdo.id);
      if(!data || typeof data!=='object') return empty;
      const project=data.project||{};
      const label=`${project.proposal||''} | ${project.name||''}`.replace(/^ \| /,'').replace(/ \| $/,'').trim();
      return {
        company:{...empty.company,...(data.company||{})},
        client:{...empty.client,...(data.client||{})},
        project,
        roles:(data.roles&&typeof data.roles==='object')?data.roles:{},
        projectLabel:label
      };
    }catch(err){ return empty; }
  },

  printBusy:false,
  async print(id){
    const rdo=State.rdos.find(item=>String(item.id)===String(id));
    if(!rdo) return UI.toast('RDO não encontrado.','warn');
    // v4.2.8 - o preparo do PDF faz duas idas ao servidor. Sem esta trava, um
    // segundo clique montava um relatório novo e removia o do primeiro clique
    // antes de ele chegar ao window.print().
    if(this.printBusy) return UI.toast('O PDF anterior ainda está sendo preparado.','warn',4000);
    this.printBusy=true;
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
      const header=await this.documentHeader(rdo);
      const companyName=header.company.name||State.settings.companyName||'CliqueObras';
      const logo=U.safeImageSrc(header.company.logo||State.settings.companyLogo)||'assets/logo-clique.png';
      const companyCnpj=U.formatCnpj(header.company.cnpj||State.settings.companyCnpj||'');
      const letterhead=U.safeImageSrc(header.company.letterhead||State.settings.pdfLetterhead||'');
      const stateCustomer=this.projectClient(rdo.projectId);
      const customer={
        name:header.client.name||stateCustomer.name,
        cnpj:U.formatCnpj(header.client.cnpj||(stateCustomer.client&&stateCustomer.client.cnpj)||''),
        logo:U.safeImageSrc(header.client.logo||'')||stateCustomer.logo
      };
      const projectTitle=header.projectLabel||this.projectLabel(rdo.projectId);
      const financial=State.rdoFinancial.find(item=>String(item.rdoId||item.id)===String(rdo.id));
      const snapshotFor=employeeId=>(financial?.rows||[]).find(row=>String(row.employeeId)===String(employeeId))||null;
      const visibleEntries=this.visibleEntries(rdo);
      const total=visibleEntries.reduce(
        (sum,row)=>sum+(Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0),0
      );
      const status={
        Enviado:'Aguardando aprovação',
        Devolvido:'Reprovado'
      }[rdo.status]||rdo.status;
      // v4.2.4 — serviço vendido ao cliente: tipo de contrato, proposta e as
      // funções comerciais efetivamente apontadas neste diário.
      // v4.2.7 - a função vendida ao cliente é informação comercial. Quem não tem
      // permissão de leitura em labor_rates (perfil Apontador de RDO) passa a
      // imprimir a função interna do colaborador, e o campo "Serviço contratado"
      // deixa de listar as funções vendidas. Para owner/admin nada muda.
      const canSeeCommercialRole=typeof Cloud==='undefined'||!Cloud.active()||Cloud.canViewStore('labor_rates');
      const internalRoleFor=row=>String(
        row.internalRole
        ||(this.crewMembers().find(item=>String(item.id)===String(row.employeeId))||{}).internalRole
        ||''
      );
      const roleFor=row=>canSeeCommercialRole?this.displayRoleFor(
        rdo.projectId,row,snapshotFor(row.employeeId)||header.roles[String(row.employeeId)]||null
      ):internalRoleFor(row);
      const soldRoles=canSeeCommercialRole?[...new Set(visibleEntries.map(roleFor).filter(Boolean))]:[];
      // v4.2.6 — "Serviço contratado" descreve a venda por hora-homem: tipo do
      // contrato, proposta e funções apontadas. Em projeto de Obra ou de
      // Fornecimento a venda é por escopo, não por função apontada, então a linha
      // deixa de ser impressa. O tipo vem do cabeçalho servido pela RPC, para
      // continuar funcionando em perfis que não enxergam o cadastro de projetos.
      const isHhContract=String(header.project.type||this.projectFor(rdo.projectId)?.type||'').toUpperCase()==='HH';
      const contractLabel=isHhContract?[
        header.project.type||'',
        header.project.proposal?`Proposta ${header.project.proposal}`:'',
        soldRoles.join(' · ')
      ].filter(Boolean).join(' — '):'';
      report.innerHTML=`${letterhead?`<div class="pdf-letterhead" aria-hidden="true"><img src="${U.esc(letterhead)}" alt=""></div>`:''}<header>
        <div class="rdo-print-identities">
          <div class="rdo-print-brand"><img src="${U.esc(logo)}" alt=""><span><b>${U.esc(companyName)}</b><small>Relatório Diário de Obra${companyCnpj?` · CNPJ ${U.esc(companyCnpj)}`:''}</small></span></div>
          <div class="rdo-print-client">
            ${customer.logo?`<img src="${U.esc(customer.logo)}" alt="">`:`<span>${U.esc(U.initials(customer.name))}</span>`}
            <div><small>Cliente</small><b>${U.esc(customer.name)}</b>${customer.cnpj?`<small>CNPJ ${U.esc(customer.cnpj)}</small>`:''}</div>
          </div>
        </div>
        <div class="rdo-print-number"><small>RDO</small><b>${U.esc(this.documentNumber(rdo))}</b><span>${U.esc(status||'Rascunho')}</span></div>
      </header>
      <div class="rdo-print-facts">
        <span><small>Projeto</small><b>${U.esc(projectTitle)}</b></span>
        <span><small>Data</small><b>${U.date(rdo.date)} · ${U.esc(this.dayTypeLabel(rdo.date,rdo.isHoliday))}</b></span>
        <span><small>Local</small><b>${U.esc(rdo.location||'Não informado')}</b></span>
        <span><small>Total apontado</small><b>${total.toLocaleString('pt-BR',{maximumFractionDigits:2})}h</b></span>
        ${contractLabel?`<span style="grid-column:1/-1"><small>Serviço contratado</small><b>${U.esc(contractLabel)}</b></span>`:''}
      </div>
      <section class="rdo-print-section"><h2>Serviço realizado</h2><p>${U.esc(rdo.description||'—')}</p></section>
      <section class="rdo-print-section"><h2>Equipe e horas</h2>
        <div class="rdo-print-labor-table-wrap"><table class="rdo-print-labor-table"><colgroup><col style="width:8%"><col style="width:19%"><col style="width:17%"><col style="width:8%"><col style="width:9%"><col style="width:8%"><col style="width:7%"><col style="width:7%"><col style="width:8%"><col style="width:9%"></colgroup><thead><tr><th>Matrícula</th><th>Colaborador</th><th>${canSeeCommercialRole?'Função vendida':'Função'}</th><th>Entrada</th><th>Intervalo</th><th>Saída</th><th>Normal</th><th>HE 50%</th><th>HE 100%</th><th>Adic. noturno</th></tr></thead>
        <tbody>${visibleEntries.map(row=>`<tr><td>${U.esc(row.employeeRegistration||'—')}</td><td>${U.esc(row.employeeName||'Colaborador')}</td><td>${U.esc(roleFor(row)||'—')}</td><td>${U.esc(row.start||'—')}</td><td>${U.durationMinutes(row.breakMinutes)}</td><td>${U.esc(row.end||'—')}</td><td>${Number(row.regular)||0}h</td><td>${Number(row.overtime50)||0}h</td><td>${Number(row.overtime100)||0}h</td><td>${Number(row.nightHours)||0}h · ${Number(row.nightPremiumPct??rdo.nightPremiumPct??this.nightPremiumPct())}%</td></tr>`).join('')||'<tr><td colspan="10">Nenhum colaborador presente neste diário.</td></tr>'}</tbody></table></div>
      </section>
      ${rdo.notes?`<section class="rdo-print-section"><h2>Ocorrências e observações</h2><p>${U.esc(rdo.notes)}</p></section>`:''}
      ${rdo.status==='Devolvido'&&rdo.rejectionComment?`<section class="rdo-print-section rdo-print-rejection"><h2>Comentário da reprovação</h2><p>${U.esc(rdo.rejectionComment)}</p></section>`:''}
      <section class="rdo-print-section rdo-print-evidence-section"><h2>Evidências fotográficas</h2>
        ${images.length?`<div class="rdo-print-photos">${images.map((image,index)=>`<figure><img src="${U.esc(image.url)}" alt=""><figcaption>Foto ${String(index+1).padStart(2,'0')} · ${U.esc(image.description||image.fileName)}</figcaption></figure>`).join('')}</div>`:'<p>Nenhuma foto anexada.</p>'}
        ${attachments.some(item=>!this.isImage(item))?`<div class="rdo-print-files"><b>Documentos anexados:</b> ${attachments.filter(item=>!this.isImage(item)).map(item=>U.esc(item.description||item.fileName)).join(' · ')}</div>`:''}
      </section>
      <footer>Gerado pelo CliqueObras em ${new Date().toLocaleString('pt-BR')}.</footer>`;
      document.body.appendChild(report);
      UI.loading(false);
      UI.toast('Na janela de impressão, selecione “Salvar como PDF”.','info',6000);
      await Exports.beginPrint('printing-rdo',report);
      this.printBusy=false;
    }catch(err){
      this.printBusy=false;
      UI.loading(false);
      if(typeof Exports!=='undefined'&&typeof Exports.finishPrint==='function') Exports.finishPrint();
      else document.body.classList.remove('printing-rdo');
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
        <div><small>Data</small><b>${U.date(rdo.date)}</b><small>${U.esc(this.dayTypeLabel(rdo.date,rdo.isHoliday))}</small></div>
        <div><small>Status</small>${this.statusTag(rdo.status)}</div>
        <div><small>Medição</small><b>${linked?'Incluído em medição':'Não medido'}</b></div>
      </div>
      <div class="card rdo-description-card"><h3>Serviço realizado</h3><p>${U.esc(rdo.description||'—')}</p>${rdo.location?`<small>${U.esc(rdo.location)}</small>`:''}</div>
      <div class="rdo-detail-workers">${this.visibleEntries(rdo).map(row=>`<div>
        <span class="avatar-ph">${U.initials(row.employeeName||'CO')}</span>
        <span><b>${U.esc(row.employeeName||'Colaborador')}</b><small>${U.esc(this.displayRoleFor(rdo.projectId,row,(financial?.rows||[]).find(item=>String(item.employeeId)===String(row.employeeId)))||'')}</small></span>
        <span><small>Situação</small><b>Alocado</b></span>
        <span><small>Normal</small><b>${U.pct(row.regular||0).replace('%','h')}</b></span>
        <span><small>HE 50%</small><b>${U.pct(row.overtime50||0).replace('%','h')}</b></span>
        <span><small>HE 100% / Noturno</small><b>${U.pct(row.overtime100||0).replace('%','h')} / ${U.pct(row.nightHours||0).replace('%','h')}</b></span>
      </div>`).join('')||'<div class="empty">Nenhum colaborador presente neste diário.</div>'}</div>
      ${showFinancial&&financial?`<div class="kpi-grid rdo-financial-summary">
        <div class="kpi"><div class="k-label">Custo realizado</div><div class="k-value">${U.money(financial.costTotal)}</div></div>
        <div class="kpi accent-blue"><div class="k-label">Venda apurada</div><div class="k-value">${U.money(financial.saleTotal)}</div></div>
      </div>`:''}
      ${rdo.notes?`<div class="import-log"><b>Observações:</b> ${U.esc(rdo.notes)}</div>`:''}
      ${rdo.status==='Devolvido'&&rdo.rejectionComment?`<div class="import-log rdo-rejection-comment"><b>Motivo da reprovação:</b> ${U.esc(rdo.rejectionComment)}
        <small>${rdo.rejectedAt?`Registrado em ${U.date(rdo.rejectedAt)}`:''}${rdo.rejectedBy?` por ${U.esc(rdo.rejectedBy)}`:''}</small></div>`:''}
      ${this.auditMarkup(rdo)}
      <div class="rdo-detail-evidence"><div class="rdo-section-title"><div><h3>Fotos e documentos</h3><small>Evidências registradas no diário.</small></div></div><div class="rdo-evidence-grid" id="rdo-detail-attachments"><div class="rdo-attachment-empty">Carregando evidências…</div></div></div>`,
      footer:`${this.canEdit(rdo)?`<button class="btn btn-ghost" onclick="UI.close();RDO.form(${U.jsArg(rdo.id)})"><i data-lucide="pencil"></i>Editar</button>`:''}
        ${rdo.status==='Enviado'&&!this.canReview()&&(typeof Cloud==='undefined'||!Cloud.active()||Cloud.canEditStore('rdos'))?`<button class="btn btn-ghost" onclick="UI.close();RDO.returnToDraft(${U.jsArg(rdo.id)})"><i data-lucide="undo-2"></i>Voltar para rascunho</button>`:''}
        ${rdo.status==='Enviado'&&this.canReview()?`<button class="btn btn-danger" onclick="RDO.reject(${U.jsArg(rdo.id)})"><i data-lucide="x-square"></i>Reprovar</button>`:''}
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
      ${RDO.fullAccess()?'<button class="btn btn-ghost" onclick="RDO.dayOffForm()"><i data-lucide="calendar-off"></i>Controlar folgas</button>':''}
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
        <span class="rdo-team"><b>${RDO.visibleEntries(rdo).length}</b><small>pessoas</small></span>
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
  // v4.2.18 - a etiqueta mostra as ferias em curso sem acrescentar elemento ao
  // cartao (.crew-card e um grid de colunas fixas: um filho a mais quebraria o
  // alinhamento).
  statusTag(employee){
    const hoje=typeof U.isoDate==='function'?U.isoDate(new Date()):new Date().toISOString().slice(0,10);
    const ferias=typeof RDO!=='undefined'&&typeof RDO.vacationOn==='function'?RDO.vacationOn(employee,hoje):null;
    if(ferias) return `<span class="tag tag-blue">Férias até ${U.date(ferias.to)}</span>`;
    return `<span class="tag ${employee.active===false?'tag-gray':'tag-green'}">${employee.active===false?(employee.inactiveSince?`Inativo a partir de ${U.date(employee.inactiveSince)}`:'Inativo'):'Ativo'}</span>`;
  },
  // v4.2.18 - lista de periodos de ferias dentro do cadastro do colaborador.
  vacationListMarkup(list){
    const periodos=Array.isArray(list)?list:[];
    const linhas=periodos.map((item,indice)=>`<div class="crew-vacation-row"><span><b>${U.date(item.from)} a ${U.date(item.to)}</b><small>${RDO.vacationDays(item)} dia(s)</small></span><button class="btn btn-ghost btn-sm" type="button" data-vacation-remove="${indice}" aria-label="Remover período de férias"><i data-lucide="trash-2"></i></button></div>`).join('');
    return `<div class="crew-vacation-list">${linhas||'<small class="crew-vacation-empty">Nenhum período cadastrado.</small>'}</div>
      <div class="crew-vacation-new"><label>De<input id="crew-vacation-from" type="date"></label><label>Até<input id="crew-vacation-to" type="date"></label><button class="btn btn-ghost btn-sm" type="button" id="crew-vacation-add"><i data-lucide="plus"></i>Adicionar período</button></div>`;
  },
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
      ${canEdit?'<div class="toolbar-actions"><button class="btn btn-ghost" onclick="Views.colaboradores.rolesForm()"><i data-lucide="briefcase"></i>Funções</button><button class="btn btn-primary" onclick="Views.colaboradores.form()"><i data-lucide="user-plus"></i>Novo colaborador</button></div>':''}</div>
      <div class="crew-filter-panel"><div class="rdo-search"><i data-lucide="search"></i><input id="crew-search" type="search" value="${U.esc(this.query)}" placeholder="Buscar por matrícula, nome ou cargo" aria-label="Buscar colaboradores">${this.query?'<button id="crew-search-clear" type="button" aria-label="Limpar pesquisa"><i data-lucide="x"></i></button>':''}</div><span>${employees.length} de ${all.length} colaboradores</span></div>
      <div class="crew-directory">${employees.map(employee=>`<div class="crew-card ${employee.active===false?'inactive':''}">
        ${this.avatar(employee)}
        <span><b>${U.esc(employee.name||'Colaborador')}</b><small>${employee.registration?`Matrícula ${U.esc(employee.registration)} · `:''}${U.esc(employee.internalRole||'Sem função')}${canViewCost?` · Custo ${U.money(RDO.baseCostFor(employee.id).costRegular)}/h`:''}</small></span>
        ${this.statusTag(employee)}
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
      <div><label>Custo padrão por hora <small>Opcional</small></label><input id="crew-hourly-cost" type="number" min="0" step="0.01" value="${hasRegisteredCost?hourlyCost:''}" ${canEditCost?'':'disabled'}><small>${canEditCost?'Obrigatório somente quando o colaborador for usado no RDO de um projeto HH. HE 50% e 100% serão calculadas automaticamente.':'Sem permissão para visualizar ou alterar custos.'}</small></div>
      <div><label>Status</label><select id="crew-active"><option value="true" ${employee.active!==false?'selected':''}>Ativo</option><option value="false" ${employee.active===false?'selected':''}>Inativo</option></select></div>
      <div><label>Inativo a partir de <small>Opcional</small></label><input id="crew-inactive-since" type="date" value="${U.esc(String(employee.inactiveSince||'').slice(0,10))}" ${employee.active===false?'':'disabled'}></div>
      <div class="full"><label>Férias <small>Opcional</small></label><div id="crew-vacation-box"></div></div>
    </div>`,footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="crew-save"><i data-lucide="check"></i>Salvar</button>'});
    let vacations=typeof RDO!=='undefined'&&typeof RDO.vacationPeriods==='function'?RDO.vacationPeriods(employee):[];
    const paintVacations=()=>{
      const box=document.getElementById('crew-vacation-box');
      if(!box) return;
      box.innerHTML=this.vacationListMarkup(vacations);
      box.querySelectorAll('[data-vacation-remove]').forEach(button=>button.onclick=()=>{
        vacations.splice(Number(button.dataset.vacationRemove),1);
        paintVacations();
      });
      const add=document.getElementById('crew-vacation-add');
      if(add) add.onclick=()=>{
        const from=String((document.getElementById('crew-vacation-from')||{}).value||'').slice(0,10);
        const to=String((document.getElementById('crew-vacation-to')||{}).value||'').slice(0,10);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))
          return UI.toast('Informe o início e o fim das férias.','warn');
        if(from>to) return UI.toast('O início das férias não pode ser depois do fim.','warn',5000);
        if(vacations.some(item=>from<=item.to&&to>=item.from))
          return UI.toast('Este período se sobrepõe a outro já cadastrado.','warn',5500);
        vacations.push({id:U.id(),from,to});
        vacations.sort((a,b)=>a.from.localeCompare(b.from));
        paintVacations();
      };
      U.icons();
    };
    paintVacations();
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
    const activeSelect=document.getElementById('crew-active');
    const inactiveSinceInput=document.getElementById('crew-inactive-since');
    if(activeSelect&&inactiveSinceInput) activeSelect.onchange=()=>{
      inactiveSinceInput.disabled=activeSelect.value!=='false';
      if(inactiveSinceInput.disabled) inactiveSinceInput.value='';
    };
    document.getElementById('crew-save').onclick=async()=>{
      const name=document.getElementById('crew-name').value.trim();
      const registration=document.getElementById('crew-registration').value.trim();
      if(!name) return UI.toast('Informe o nome do colaborador','warn');
      if(registration&&RDO.crewMembers().some(item=>String(item.id)!==String(employee.id)&&U.norm(item.registration)===U.norm(registration)))
        return UI.toast('Esta matrícula já pertence a outro colaborador.','warn');
      const rawCost=canEditCost?document.getElementById('crew-hourly-cost').value:'';
      if(canEditCost && rawCost!=='' && U.num(rawCost)<0) return UI.toast('O custo por hora não pode ser negativo.','warn');
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
          inactiveSince:document.getElementById('crew-active').value==='false'
            ?String((document.getElementById('crew-inactive-since')||{}).value||'').slice(0,10)
            :'',
          vacations:vacations.map(item=>({id:String(item.id||U.id()),from:item.from,to:item.to})),
          updatedAt:new Date().toISOString()
        });
        if(canEditCost&&rawCost!==''){
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
        }else if(canEditCost&&baseRecord){
          await DB.del('labor_rates',baseRecord.id);
        }
        await State.reload();
        UI.loading(false);
        UI.close();
        UI.toast(canEditCost&&rawCost!==''?'Colaborador e custo salvos':'Colaborador salvo','success');
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
    UI.modal({title:'Funções dos colaboradores',body:`<div class="role-directory">${roles.map(role=>`<div class="role-row"><span><b>${U.esc(role.name||'Função')}</b><small>${RDO.crewMembers().filter(employee=>U.norm(employee.internalRole)===U.norm(role.name)).length} colaborador(es)</small></span><button class="btn btn-ghost btn-sm" onclick="Views.colaboradores.roleForm(${U.jsArg(role.id)})"><i data-lucide="pencil"></i></button><button class="btn btn-ghost btn-sm" onclick="Views.colaboradores.removeRole(${U.jsArg(role.id)})"><i data-lucide="trash-2"></i></button></div>`).join('')||'<div class="empty"><i data-lucide="briefcase"></i><br>Nenhuma função cadastrada.</div>'}</div>`,footer:'<button class="btn btn-ghost" onclick="UI.close()">Fechar</button><button class="btn btn-primary" onclick="Views.colaboradores.roleForm()"><i data-lucide="plus"></i>Nova função</button>'});
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
    const hhProjects=State.projects.filter(project=>String(project.type||'').toUpperCase()==='HH');
    const hhProjectIds=new Set(hhProjects.map(project=>String(project.id)));
    if(this.projectFilter&&!hhProjectIds.has(String(this.projectFilter))) this.projectFilter='';
    const rows=State.laborRates.filter(rate=>
      rate.isBaseCost!==true&&String(rate.projectId)!=='__base__'
      &&hhProjectIds.has(String(rate.projectId))
      &&(!this.projectFilter||String(rate.projectId)===String(this.projectFilter))
    ).sort((a,b)=>RDO.projectLabel(a.projectId).localeCompare(RDO.projectLabel(b.projectId)));
    const rateProjects=hhProjects;
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
    const hhProjects=State.projects.filter(project=>String(project.type||'').toUpperCase()==='HH');
    const rate=id?State.laborRates.find(x=>String(x.id)===String(id)):{
      projectId:this.projectFilter||hhProjects[0]?.id||'',employeeId:employees[0]?.id||'',commercialRole:'',roleDisplayMode:'client',
      costRegular:0,cost50:0,cost100:0,saleRegular:0,sale50:0,sale100:0,active:true
    };
    if(!hhProjects.length||!employees.length) return UI.toast('Cadastre um projeto HH e um colaborador antes de configurar valores.','warn',6500);
    const field=(label,key)=>`<div><label>${label}</label><input id="rate-${key}" type="number" min="0" step="0.01" value="${Number(rate[key])||''}"></div>`;
    const costs=RDO.baseCostFor(rate.employeeId,rate);
    const displayMode=rate.roleDisplayMode==='internal'?'internal':'client';
    UI.modal({title:id?'Editar valores':'Configurar valores',wide:true,body:`<div class="form-grid">
      <div><label>Projeto HH *</label><select id="rate-project">${hhProjects.map(p=>`<option value="${U.esc(p.id)}" ${String(p.id)===String(rate.projectId)?'selected':''}>${U.esc(U.projLabel(p))}</option>`).join('')}</select></div>
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
      if(!hhProjects.some(project=>String(project.id)===String(projectId)))
        return UI.toast('Selecione um projeto classificado como HH.','warn');
      const existing=State.laborRates.find(x=>String(x.projectId)===String(projectId)&&String(x.employeeId)===String(employeeId)&&String(x.id)!==String(id));
      if(existing) return UI.toast('Já existe uma configuração para este colaborador no projeto.','warn');
      const roleDisplayMode=document.getElementById('rate-role-mode').value;
      const commercialRole=document.getElementById('rate-role').value.trim();
      if(roleDisplayMode==='client'&&!commercialRole)
        return UI.toast('Informe a função externa que será apresentada ao cliente.','warn',6000);
      const employee=RDO.crewMembers().find(item=>String(item.id)===String(employeeId))||{};
      if(roleDisplayMode==='internal'&&!String(employee.internalRole||'').trim())
        return UI.toast('Informe a função interna deste colaborador antes de usar esta opção.','warn',6000);
      const employeeCosts=RDO.baseCostFor(employeeId,rate);
      if(!(Number(employeeCosts.costRegular)>0))
        return UI.toast('Informe o custo por hora no cadastro do colaborador antes de configurar o projeto HH.','warn',6500);
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
