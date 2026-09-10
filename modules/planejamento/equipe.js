/**
 * Planejamento de Colaboradores (equipe.js) — v4.5.0
 *
 * Responsabilidades:
 * - CrewPlan: motor ÚNICO de dias úteis, conflitos e disponibilidade
 * - Views.planejamentoequipe: linha do tempo (Gantt), Disponibilidade e Capacidade
 * - assistente "Planejar nova obra" e consulta "Encontrar colaboradores disponíveis"
 *
 * Dependências:
 * - router (Views), rdo (RDO), database (State/DB), utils (U/UI), app (App)
 *
 * Não modificar:
 * - RDO.crewActiveOn / RDO.dayType / RDO.crewMembers — este módulo apenas CONSOME.
 *   Toda regra de "o colaborador vale neste dia?" continua morando no RDO
 *   (inativo a partir de, férias). Aqui não existe cópia dessa regra.
 *
 * Store: 'crew_allocations' (app_records). Registro:
 *   {id, employeeId, projectId, role, start, end, status, notes,
 *    planGroupId, createdAt, updatedAt}
 *   start/end em AAAA-MM-DD, as duas pontas inclusive.
 */

/* ================= [10] PLANEJAMENTO DE COLABORADORES ================= */
const CrewPlan = {
  statuses:['Planejado','Concluído','Cancelado'],
  // Somente estes status consomem capacidade e disputam conflito. 'Concluído'
  // é histórico (aparece na linha do tempo, esmaecido) e 'Cancelado' é nulo.
  activeStatuses:['Planejado'],

  /* ---------- 1. REGRA DE DIAS ÚTEIS (função centralizada) ----------
     Segunda a sexta. Sábado e domingo NÃO consomem capacidade.
     A classificação do dia não é reimplementada aqui: quem responde é
     RDO.dayType(), o mesmo que já decide sábado 50% / domingo 100% no diário.
     O cálculo UTC de reserva só entra quando o RDO não está no contexto
     (testes isolados em vm). Feriados: ver holidays() logo abaixo. */
  isIso(date){
    return /^\d{4}-\d{2}-\d{2}$/.test(String(date||''));
  },
  weekday(date){
    if(!this.isIso(date)) return -1;
    const m=String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))).getUTCDay();
  },
  isWeekend(date){
    if(typeof RDO!=='undefined' && RDO && typeof RDO.dayType==='function'){
      const type=RDO.dayType(date,false);
      return type==='saturday' || type==='sunday';
    }
    const day=this.weekday(date);
    return day===0 || day===6;
  },
  /* Feriados: extensão futura já prevista. A lista sai de
     State.settings.crewPlanHolidays (array de AAAA-MM-DD). Enquanto ninguém
     cadastrar nada, a lista é vazia e a regra é exatamente "seg a sex" —
     igual ao restante do sistema, onde feriado no meio da semana continua
     sendo apurado normalmente. */
  holidays(){
    const raw=(typeof State!=='undefined' && State && State.settings)
      ? State.settings.crewPlanHolidays : null;
    return new Set((Array.isArray(raw)?raw:[])
      .map(item=>String(item||'').slice(0,10))
      .filter(item=>this.isIso(item)));
  },
  isBusinessDay(date, holidays){
    if(!this.isIso(date)) return false;
    if(this.isWeekend(date)) return false;
    const list=holidays instanceof Set ? holidays : this.holidays();
    return !list.has(String(date).slice(0,10));
  },
  addDays(date, amount){
    if(!this.isIso(date)) return '';
    const base=Date.parse(`${date}T00:00:00Z`)+(Number(amount)||0)*86400000;
    return new Date(base).toISOString().slice(0,10);
  },
  /* Lista os dias úteis do intervalo, as duas pontas inclusive. */
  businessDayList(startDate, endDate){
    const from=String(startDate||'').slice(0,10), to=String(endDate||'').slice(0,10);
    if(!this.isIso(from)||!this.isIso(to)||from>to) return [];
    const holidays=this.holidays(), out=[];
    let cursor=from, guard=0;
    while(cursor<=to && guard++<4000){
      if(this.isBusinessDay(cursor,holidays)) out.push(cursor);
      cursor=this.addDays(cursor,1);
    }
    return out;
  },
  /* getBusinessDays(startDate, endDate) do documento de especificação. */
  businessDays(startDate, endDate){
    return this.businessDayList(startDate,endDate).length;
  },
  /* Data final de uma obra a partir do início e da duração em dias úteis. */
  endAfterBusinessDays(startDate, totalDays){
    const from=String(startDate||'').slice(0,10);
    const total=Math.max(1,Math.floor(Number(totalDays)||0));
    if(!this.isIso(from)||!total) return '';
    const holidays=this.holidays();
    let cursor=from, counted=0, last=from, guard=0;
    while(counted<total && guard++<4000){
      if(this.isBusinessDay(cursor,holidays)){ counted++; last=cursor; }
      if(counted<total) cursor=this.addDays(cursor,1);
    }
    return counted===total?last:'';
  },

  /* ---------- 2. ALOCAÇÕES ---------- */
  all(){
    return (typeof State!=='undefined' && Array.isArray(State.crewAllocations))
      ? State.crewAllocations : [];
  },
  normalize(row){
    return {
      id:String(row&&row.id||''),
      employeeId:String(row&&row.employeeId||''),
      projectId:String(row&&row.projectId||''),
      role:String(row&&row.role||''),
      start:String(row&&row.start||'').slice(0,10),
      end:String(row&&row.end||'').slice(0,10),
      status:String(row&&row.status||'Planejado'),
      notes:String(row&&row.notes||''),
      planGroupId:String(row&&row.planGroupId||'')
    };
  },
  valid(row){
    const item=this.normalize(row);
    return !!item.id && !!item.employeeId && !!item.projectId
      && this.isIso(item.start) && this.isIso(item.end) && item.start<=item.end;
  },
  /* Alocações que realmente ocupam a agenda. */
  activeAllocations(){
    return this.all().filter(row=>this.valid(row)
      && this.activeStatuses.includes(String(row.status||'Planejado')));
  },
  /* Sobreposição de intervalos: new_start <= existing_end AND new_end >= existing_start */
  overlaps(aStart,aEnd,bStart,bEnd){
    return String(aStart)<=String(bEnd) && String(aEnd)>=String(bStart);
  },
  allocationsOf(employeeId,{from='',to='',statuses=null}={}){
    const id=String(employeeId||'');
    const list=Array.isArray(statuses)?statuses:this.activeStatuses;
    return this.all()
      .filter(row=>this.valid(row)
        && String(row.employeeId)===id
        && list.includes(String(row.status||'Planejado'))
        && (!from||!to||this.overlaps(row.start,row.end,from,to)))
      .sort((a,b)=>String(a.start).localeCompare(String(b.start)));
  },
  /* ---------- 3. DETECÇÃO DE CONFLITOS ----------
     Devolve as alocações ativas que disputam o mesmo colaborador no período.
     excludeId permite editar uma alocação sem ela conflitar consigo mesma. */
  conflictsFor({employeeId,start,end,excludeId=''}={}){
    const from=String(start||'').slice(0,10), to=String(end||'').slice(0,10);
    if(!this.isIso(from)||!this.isIso(to)||from>to) return [];
    return this.allocationsOf(employeeId,{})
      .filter(row=>String(row.id)!==String(excludeId||'')
        && this.overlaps(from,to,row.start,row.end));
  },
  conflictMessage(employee,conflict,start,end){
    const nome=U.esc((employee&&employee.name)||'O colaborador');
    const obra=U.esc(this.projectLabel(conflict.projectId));
    const nova=U.esc(this.projectLabel(conflict.__newProjectId||''));
    return `<div class="crewplan-conflict">
      <b><i data-lucide="alert-triangle"></i> Conflito de planejamento</b>
      <p><b>${nome}</b> já está planejado para <b>${obra}</b> entre
        <b>${U.date(conflict.start)}</b> e <b>${U.date(conflict.end)}</b>.</p>
      <p>Não é possível criar uma nova alocação${nova?` em <b>${nova}</b>`:''} entre
        <b>${U.date(start)}</b> e <b>${U.date(end)}</b> — os períodos se sobrepõem.</p>
      <small>Ajuste as datas, conclua ou cancele a alocação existente antes de continuar.</small>
    </div>`;
  },

  /* ---------- 4. MOTOR ÚNICO DE DISPONIBILIDADE ----------
     Usado pela linha do tempo, pela visão Disponibilidade, pela visão
     Capacidade, pelo "Planejar nova obra" e pelo "Encontrar colaboradores
     disponíveis". Nenhuma dessas telas recalcula nada por conta própria. */
  crewMembers(){
    if(typeof RDO!=='undefined' && RDO && typeof RDO.crewMembers==='function')
      return RDO.crewMembers();
    return (typeof State!=='undefined'?State.crew:[]).filter(item=>item.recordType!=='role');
  },
  crewRoles(){
    if(typeof RDO!=='undefined' && RDO && typeof RDO.crewRoles==='function')
      return RDO.crewRoles();
    return [];
  },
  /* Nomes de função em uso: os cadastrados (crew.recordType==='role') mais os
     que já estão gravados nos colaboradores. Não cria estrutura paralela. */
  roleNames(){
    const names=new Map();
    this.crewRoles().forEach(role=>{
      const name=String(role.name||'').trim();
      if(name) names.set(U.norm(name),name);
    });
    this.crewMembers().forEach(employee=>{
      const name=String(employee.internalRole||'').trim();
      if(name && !names.has(U.norm(name))) names.set(U.norm(name),name);
    });
    return [...names.values()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  },
  employeeRole(employee){
    return String((employee&&employee.internalRole)||'').trim();
  },
  activeOn(employee,date){
    if(typeof RDO!=='undefined' && RDO && typeof RDO.crewActiveOn==='function')
      return RDO.crewActiveOn(employee,date);
    return !!employee && employee.active!==false;
  },
  projectLabel(projectId){
    if(!projectId) return '';
    if(typeof RDO!=='undefined' && RDO && typeof RDO.projectLabel==='function')
      return RDO.projectLabel(projectId);
    const project=(typeof State!=='undefined'?State.projects:[])
      .find(item=>String(item.id)===String(projectId));
    return project?U.projLabel(project):'Projeto';
  },
  employeeName(employeeId){
    const employee=this.crewMembers().find(item=>String(item.id)===String(employeeId));
    return employee?String(employee.name||'Colaborador'):'Colaborador';
  },
  /* Mapa dia útil -> alocações ativas daquele colaborador naquele dia. */
  occupancyMap(employee,from,to){
    const days=this.businessDayList(from,to);
    const rows=this.allocationsOf(employee&&employee.id,{from,to});
    const map=new Map();
    days.forEach(day=>{
      map.set(day,rows.filter(row=>day>=row.start && day<=row.end));
    });
    return map;
  },
  /* Retrato completo de um colaborador em um período. */
  availability(employee,from,to){
    const days=this.businessDayList(from,to);
    const total=days.length;
    const rows=this.allocationsOf(employee&&employee.id,{from,to});
    let busy=0, off=0, free=0, conflictDays=0;
    const conflictSet=new Set();
    let firstFree='', lastBusyEnd='';
    days.forEach(day=>{
      if(!this.activeOn(employee,day)){ off++; return; }
      const onDay=rows.filter(row=>day>=row.start && day<=row.end);
      if(onDay.length>1){
        conflictDays++;
        onDay.forEach(row=>conflictSet.add(row.id));
      }
      if(onDay.length){
        busy++;
        onDay.forEach(row=>{ if(row.end>lastBusyEnd) lastBusyEnd=row.end; });
      }else{
        free++;
        if(!firstFree) firstFree=day;
      }
    });
    const pct=total?Math.round(free/total*100):0;
    let category='disponivel';
    if(conflictDays>0) category='conflito';
    else if(free===0 && busy===0 && off>0) category='indisponivel';
    else if(free===0) category='alocado';
    else if(busy===0 && off===0) category='disponivel';
    else category='parcial';
    return {
      employee, employeeId:String(employee&&employee.id||''),
      role:this.employeeRole(employee),
      totalDays:total, busyDays:busy, freeDays:free, offDays:off,
      conflictDays, pct, category,
      allocations:rows,
      conflicts:rows.filter(row=>conflictSet.has(row.id)),
      projects:[...new Set(rows.map(row=>String(row.projectId)))],
      freeFrom:firstFree,
      freeAfter:lastBusyEnd?this.addDays(lastBusyEnd,1):''
    };
  },
  /* "Quando esse colaborador fica livre?" — uma resposta só, usada pela visão
     Disponibilidade, pela consulta rápida e pelo card do celular.
     Ordem: o dia seguinte ao fim da última alocação (se cai dentro do período)
     e, na falta dela, o primeiro dia útil livre — que é a resposta certa para
     quem não tem obra planejada e mesmo assim não está 100% (férias). */
  freeFrom(report,from,to){
    if(!report) return '';
    if(report.freeAfter && report.freeAfter<=String(to||'')) return report.freeAfter;
    if(report.freeDays>0 && report.freeFrom) return report.freeFrom;
    if(report.category==='disponivel') return String(from||'');
    return '';
  },
  categoryLabel(category){
    return {disponivel:'Disponível',parcial:'Parcialmente disponível',alocado:'Alocado',
      conflito:'Conflito',indisponivel:'Indisponível'}[category]||'—';
  },
  /* Etiqueta curta para a coluna de nome do Gantt, onde "Parcialmente
     disponível" não cabe sem cortar o nome do colaborador ao lado. */
  categoryTagShort(category){
    const cls={disponivel:'tag-green',parcial:'tag-amber',alocado:'tag-blue',
      conflito:'tag-red',indisponivel:'tag-gray'}[category]||'tag-gray';
    const label={disponivel:'Livre',parcial:'Parcial',alocado:'Alocado',
      conflito:'Conflito',indisponivel:'Férias'}[category]||'—';
    return `<span class="tag ${cls}">${U.esc(label)}</span>`;
  },
  categoryTag(category){
    const cls={disponivel:'tag-green',parcial:'tag-amber',alocado:'tag-blue',
      conflito:'tag-red',indisponivel:'tag-gray'}[category]||'tag-gray';
    return `<span class="tag ${cls}">${U.esc(this.categoryLabel(category))}</span>`;
  },
  categoryOrder(category){
    return {disponivel:0,parcial:1,alocado:2,conflito:3,indisponivel:4}[category]??5;
  },

  /* ---------- 5. RANKING DE CANDIDATOS ----------
     Prioridade 1: função compatível e 100% disponível
     Prioridade 2: função compatível e disponibilidade parcial
     Prioridade 3: dentro da 2, quem fica livre mais cedo
     Prioridade 4: com conflito, mas ajustável
     O sistema apenas SUGERE. A decisão continua com o gestor. */
  tierOf(report){
    if(report.category==='indisponivel') return 5;
    if(report.conflictDays>0) return 4;
    if(report.pct>=100) return 1;
    if(report.pct>0) return 2;
    return 5;
  },
  candidates({from,to,role='',minPct=0,onlyRole=true}={}){
    const wanted=U.norm(role||'');
    return this.crewMembers()
      .filter(employee=>!wanted||!onlyRole||U.norm(this.employeeRole(employee))===wanted)
      .map(employee=>{
        const report=this.availability(employee,from,to);
        return {...report,tier:this.tierOf(report),
          roleMatch:!wanted||U.norm(report.role)===wanted};
      })
      .filter(report=>report.pct>=Math.max(0,Number(minPct)||0))
      .sort((a,b)=>a.tier-b.tier
        || b.pct-a.pct
        || String(a.freeFrom||'9999-12-31').localeCompare(String(b.freeFrom||'9999-12-31'))
        || String(a.employee&&a.employee.name||'').localeCompare(String(b.employee&&b.employee.name||''),'pt-BR'));
  },

  /* ---------- 6. CAPACIDADE DA EQUIPE ----------
     Percentual de dias úteis já comprometidos, semana a semana. */
  weekStart(date){
    const day=this.weekday(date);
    return day<0?'':this.addDays(date,-((day+6)%7)); // segunda-feira
  },
  capacityBuckets(from,to,crew){
    const days=this.businessDayList(from,to);
    if(!days.length) return [];
    const people=Array.isArray(crew)?crew:this.crewMembers();
    const buckets=new Map();
    days.forEach(day=>{
      const key=this.weekStart(day)||day;
      if(!buckets.has(key)) buckets.set(key,{key,days:[],capacity:0,used:0});
      buckets.get(key).days.push(day);
    });
    const rowsByEmployee=new Map();
    people.forEach(employee=>{
      rowsByEmployee.set(String(employee.id),this.allocationsOf(employee.id,{from,to}));
    });
    buckets.forEach(bucket=>{
      bucket.days.forEach(day=>{
        people.forEach(employee=>{
          if(!this.activeOn(employee,day)) return;
          bucket.capacity++;
          const rows=rowsByEmployee.get(String(employee.id))||[];
          if(rows.some(row=>day>=row.start && day<=row.end)) bucket.used++;
        });
      });
    });
    return [...buckets.values()]
      .sort((a,b)=>a.key.localeCompare(b.key))
      .map(bucket=>({...bucket,
        pct:bucket.capacity?Math.round(bucket.used/bucket.capacity*100):0,
        idle:Math.max(0,bucket.capacity-bucket.used)}));
  },

  /* ---------- 7. PROJETOS DO SELETOR ----------
     Ao contrário do RDO (que só aceita obra "Em andamento"), o planejamento é
     sobre o FUTURO: "A executar" precisa aparecer, senão não dá para planejar
     equipe de obra que ainda não começou. A obra da alocação em edição
     permanece na lista mesmo encerrada, para não trocar o projeto sozinho. */
  planProjects(currentProjectId=''){
    const current=String(currentProjectId||'');
    const allowed=new Set(['Em andamento','A executar','Paralisado']);
    return (typeof State!=='undefined'?State.projects:[])
      .map(project=>({id:String(project.id),label:U.projLabel(project),
        status:String(project.status||'').trim()}))
      .filter(project=>(current&&project.id===current)||!project.status||allowed.has(project.status))
      .map(project=>project.status&&project.status!=='Em andamento'
        ?{...project,label:`${project.label} · ${project.status}`}
        :project)
      .sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'));
  },
  canEdit(){
    return typeof Cloud==='undefined' || !Cloud.active() || Cloud.canEditStore('crew_allocations');
  }
};

/* ================= TELA ================= */
Views.planejamentoequipe = {
  title:'Planejamento de Colaboradores',
  mode:'alocacoes',
  zoom:'auto',
  refDate:new Date(),
  span:'month',
  filters:{employee:'',project:'',role:'',status:'',from:'',to:''},
  wizard:null,

  /* ---------- período em análise ---------- */
  period(){
    if(CrewPlan.isIso(this.filters.from) && CrewPlan.isIso(this.filters.to)
      && this.filters.from<=this.filters.to)
      return {from:this.filters.from,to:this.filters.to,custom:true};
    const ref=this.refDate;
    if(this.span==='quarter'){
      const start=new Date(Date.UTC(ref.getFullYear(),ref.getMonth(),1));
      const end=new Date(Date.UTC(ref.getFullYear(),ref.getMonth()+3,0));
      return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10),custom:false};
    }
    if(this.span==='week'){
      const iso=U.isoDate(ref);
      const from=CrewPlan.weekStart(iso)||iso;
      return {from,to:CrewPlan.addDays(from,6),custom:false};
    }
    const start=new Date(Date.UTC(ref.getFullYear(),ref.getMonth(),1));
    const end=new Date(Date.UTC(ref.getFullYear(),ref.getMonth()+1,0));
    return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10),custom:false};
  },
  periodLabel(){
    const {from,to,custom}=this.period();
    if(custom) return `${U.date(from)} → ${U.date(to)}`;
    if(this.span==='week') return `Semana de ${U.date(from)}`;
    if(this.span==='quarter') return `${U.date(from)} → ${U.date(to)}`;
    return this.refDate.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  },
  nav(direction){
    if(this.period().custom) return UI.toast('Limpe o período personalizado para navegar.','info');
    const ref=this.refDate;
    if(this.span==='week') ref.setDate(ref.getDate()+7*direction);
    else if(this.span==='quarter') ref.setMonth(ref.getMonth()+3*direction);
    else ref.setMonth(ref.getMonth()+direction);
    this.draw();
  },

  /* ---------- colaboradores em tela (filtros combinados) ---------- */
  crew(){
    const {from,to}=this.period();
    const role=U.norm(this.filters.role);
    const employeeId=String(this.filters.employee||'');
    const projectId=String(this.filters.project||'');
    const status=String(this.filters.status||'');
    return CrewPlan.crewMembers()
      .filter(employee=>!employeeId||String(employee.id)===employeeId)
      .filter(employee=>!role||U.norm(CrewPlan.employeeRole(employee))===role)
      .filter(employee=>{
        if(!projectId && !status) return true;
        const statuses=status?[status]:CrewPlan.statuses;
        const rows=CrewPlan.allocationsOf(employee.id,{from,to,statuses});
        return rows.some(row=>!projectId||String(row.projectId)===projectId);
      })
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
  },
  reports(){
    const {from,to}=this.period();
    return this.crew().map(employee=>CrewPlan.availability(employee,from,to));
  },

  /* ---------- render ---------- */
  render(){
    const canEdit=CrewPlan.canEdit();
    const roles=CrewPlan.roleNames();
    const projects=CrewPlan.planProjects();
    $c().innerHTML=`
      <div class="toolbar crewplan-toolbar">
        <div><h2>Planejamento de Colaboradores</h2><small>Mapa futuro da capacidade da equipe: quem está onde, quando fica livre e quem cabe numa obra nova.</small></div>
        <div class="spacer"></div>
        ${canEdit?`<div class="toolbar-actions">
          <button class="btn btn-ghost" onclick="Views.planejamentoequipe.findAvailable()"><i data-lucide="search"></i>Encontrar colaboradores disponíveis</button>
          <button class="btn btn-ghost" onclick="Views.planejamentoequipe.form()"><i data-lucide="plus"></i>Nova alocação</button>
          <button class="btn btn-primary" onclick="Views.planejamentoequipe.planNewProject()"><i data-lucide="wand-2"></i>Planejar nova obra</button>
        </div>`:`<div class="toolbar-actions">
          <button class="btn btn-ghost" onclick="Views.planejamentoequipe.findAvailable()"><i data-lucide="search"></i>Encontrar colaboradores disponíveis</button>
        </div>`}
      </div>
      <div id="crewplan-kpis"></div>
      <div class="crewplan-filters">
        <div><label for="cp-f-employee">Colaborador</label><select id="cp-f-employee"><option value="">Todos</option>${CrewPlan.crewMembers().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR')).map(employee=>`<option value="${U.esc(employee.id)}" ${String(this.filters.employee)===String(employee.id)?'selected':''}>${U.esc(employee.name||'Colaborador')}</option>`).join('')}</select></div>
        <div><label for="cp-f-project">Obra</label><select id="cp-f-project"><option value="">Todas</option>${projects.map(project=>`<option value="${U.esc(project.id)}" ${String(this.filters.project)===String(project.id)?'selected':''}>${U.esc(project.label)}</option>`).join('')}</select></div>
        <div><label for="cp-f-role">Função</label><select id="cp-f-role"><option value="">Todas</option>${roles.map(role=>`<option value="${U.esc(role)}" ${U.norm(this.filters.role)===U.norm(role)?'selected':''}>${U.esc(role)}</option>`).join('')}</select></div>
        <div><label for="cp-f-status">Status</label><select id="cp-f-status"><option value="">Todos</option>${CrewPlan.statuses.map(status=>`<option value="${U.esc(status)}" ${this.filters.status===status?'selected':''}>${U.esc(status)}</option>`).join('')}</select></div>
        <div><label for="cp-f-from">De</label><input id="cp-f-from" type="date" value="${U.esc(this.filters.from)}"></div>
        <div><label for="cp-f-to">Até</label><input id="cp-f-to" type="date" value="${U.esc(this.filters.to)}"></div>
        <div class="crewplan-filter-actions"><button class="btn btn-ghost btn-sm" onclick="Views.planejamentoequipe.clearFilters()"><i data-lucide="filter"></i>Limpar filtros</button></div>
      </div>
      <div class="toolbar crewplan-subbar">
        <div class="tabs">
          ${[['alocacoes','Alocações'],['disponibilidade','Disponibilidade'],['capacidade','Capacidade']]
            .map(([key,label])=>`<button class="tab ${this.mode===key?'active':''}" onclick="Views.planejamentoequipe.mode='${key}';Views.planejamentoequipe.render()">${label}</button>`).join('')}
        </div>
        <div class="spacer"></div>
        <div class="tabs crewplan-span">
          ${[['week','Semana'],['month','Mês'],['quarter','Trimestre']]
            .map(([key,label])=>`<button class="tab ${this.span===key?'active':''}" onclick="Views.planejamentoequipe.span='${key}';Views.planejamentoequipe.draw()">${label}</button>`).join('')}
        </div>
        <button class="icon-btn" aria-label="Período anterior" onclick="Views.planejamentoequipe.nav(-1)"><i data-lucide="chevron-left"></i></button>
        <b id="crewplan-period" class="crewplan-period"></b>
        <button class="icon-btn" aria-label="Próximo período" onclick="Views.planejamentoequipe.nav(1)"><i data-lucide="chevron-right"></i></button>
      </div>
      <div id="crewplan-body"></div>`;
    this.bindFilters();
    this.draw();
    U.icons();
  },
  bindFilters(){
    const bind=(id,key)=>{
      const el=document.getElementById(id);
      if(el) el.onchange=()=>{ this.filters[key]=el.value; this.render(); };
    };
    bind('cp-f-employee','employee'); bind('cp-f-project','project');
    bind('cp-f-role','role'); bind('cp-f-status','status');
    bind('cp-f-from','from'); bind('cp-f-to','to');
  },
  clearFilters(){
    this.filters={employee:'',project:'',role:'',status:'',from:'',to:''};
    this.render();
  },
  draw(){
    const period=document.getElementById('crewplan-period');
    if(period) period.textContent=this.periodLabel();
    this.drawKpis();
    const body=document.getElementById('crewplan-body');
    if(!body) return;
    if(this.mode==='disponibilidade') body.innerHTML=this.availabilityMarkup();
    else if(this.mode==='capacidade') body.innerHTML=this.capacityMarkup();
    else body.innerHTML=this.timelineMarkup();
    U.icons();
  },

  /* ---------- 19. INDICADORES DO MÓDULO ---------- */
  drawKpis(){
    const box=document.getElementById('crewplan-kpis');
    if(!box) return;
    const reports=this.reports();
    const count=category=>reports.filter(report=>report.category===category).length;
    const capacity=reports.reduce((sum,report)=>sum+report.totalDays-report.offDays,0);
    const used=reports.reduce((sum,report)=>sum+report.busyDays,0);
    const planned=new Set(CrewPlan.activeAllocations()
      .filter(row=>CrewPlan.overlaps(row.start,row.end,this.period().from,this.period().to))
      .map(row=>String(row.employeeId))).size;
    const kpi=(label,value,sub,accent,icon)=>`<div class="kpi ${accent||''}">
      <div class="k-label"><i data-lucide="${icon}"></i>${U.esc(label)}</div>
      <div class="k-value">${value}</div><div class="k-sub">${U.esc(sub)}</div></div>`;
    box.innerHTML=`<div class="kpi-grid">
      ${kpi('Colaboradores planejados',planned,`de ${reports.length} em tela`,'','users')}
      ${kpi('Alocados',count('alocado'),'ocupados o período inteiro','accent-blue','briefcase')}
      ${kpi('Disponíveis',count('disponivel'),'sem nenhuma alocação','accent-green','user-check')}
      ${kpi('Parcialmente disponíveis',count('parcial'),'têm dias úteis livres','accent-amber','clock')}
      ${kpi('Com conflito',count('conflito'),'duas obras no mesmo dia','accent-red','alert-triangle')}
      ${kpi('Capacidade da equipe',`${capacity?Math.round(used/capacity*100):0}%`,`${used} de ${capacity} dias úteis`,'','gauge')}
    </div>`;
  },

  /* ---------- 5. LINHA DO TEMPO (Gantt/matriz) ---------- */
  /* A coluna acompanha o tamanho do período: dia a dia só quando cabe
     (visão Semana), senão semana a semana — o "SEM 1 / SEM 2 / SEM 3" do
     documento — e mês a mês em períodos longos. Coluna estreita demais vira
     rótulo cortado, que é justamente o que o Gantt não pode ter. */
  buckets(){
    const {from,to}=this.period();
    const days=CrewPlan.businessDayList(from,to);
    if(!days.length) return {kind:'none',list:[]};
    if(days.length<=10) return {kind:'day',list:days.map(day=>({key:day,days:[day],
      label:String(day).slice(8,10),sub:['dom','seg','ter','qua','qui','sex','sáb'][CrewPlan.weekday(day)]}))};
    const grouped=new Map();
    const monthly=days.length>70;
    days.forEach(day=>{
      const key=monthly?String(day).slice(0,7):(CrewPlan.weekStart(day)||day);
      if(!grouped.has(key)) grouped.set(key,[]);
      grouped.get(key).push(day);
    });
    return {kind:monthly?'month':'week',
      list:[...grouped.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([key,list],index)=>{
        const first=list[0], last=list[list.length-1];
        return {
          key, days:list,
          label:monthly
            ?new Date(`${key}-01T00:00:00Z`).toLocaleDateString('pt-BR',{month:'short',timeZone:'UTC'})
            :`SEM ${index+1}`,
          sub:monthly
            ?String(key).slice(0,4)
            :`${String(first).slice(8,10)}–${String(last).slice(8,10)}/${String(last).slice(5,7)}`
        };
      })};
  },
  cellFor(employee,bucket){
    const rowsByDay=bucket.days.map(day=>({
      day,
      off:!CrewPlan.activeOn(employee,day),
      rows:CrewPlan.allocationsOf(employee.id,{from:day,to:day,statuses:CrewPlan.statuses})
        .filter(row=>day>=row.start&&day<=row.end)
    }));
    const active=rowsByDay.filter(item=>!item.off)
      .flatMap(item=>item.rows.filter(row=>CrewPlan.activeStatuses.includes(row.status)));
    const conflict=rowsByDay.some(item=>!item.off
      && item.rows.filter(row=>CrewPlan.activeStatuses.includes(row.status)).length>1);
    const offDays=rowsByDay.filter(item=>item.off).length;
    const busyDays=rowsByDay.filter(item=>!item.off
      && item.rows.some(row=>CrewPlan.activeStatuses.includes(row.status))).length;
    const total=rowsByDay.length;
    if(conflict){
      const obras=[...new Set(active.map(row=>CrewPlan.projectLabel(row.projectId)))].join(' × ');
      return `<div class="cp-cell cp-conflict" title="Conflito: ${U.esc(obras)}"><span>Conflito</span></div>`;
    }
    if(busyDays){
      const first=active[0]||{};
      const color=U.safeColor(App.projectColor(first.projectId));
      const label=CrewPlan.projectLabel(first.projectId);
      const partial=busyDays<total-offDays||offDays>0;
      const done=active.every(row=>row.status==='Concluído');
      return `<div class="cp-cell cp-busy ${partial?'cp-partial':''} ${done?'cp-done':''}"
        style="--cp-color:${color}" title="${U.esc(label)} — ${busyDays} de ${total} dia(s) útil(eis)${offDays?` · ${offDays} indisponível(eis)`:''}"
        onclick="Views.planejamentoequipe.dayDetail(${U.jsArg(employee.id)},${U.jsArg(bucket.days[0])},${U.jsArg(bucket.days[bucket.days.length-1])})"><span>${U.esc(label)}</span></div>`;
    }
    if(offDays===total)
      return `<div class="cp-cell cp-off" title="Férias ou colaborador inativo"><span>Férias/inativo</span></div>`;
    // Célula livre fica VAZIA de propósito: o objetivo declarado do Gantt é
    // "tornar visualmente evidente os espaços vagos da equipe" — escrever
    // "Disponível" 200 vezes esconde justamente o que é para saltar aos olhos.
    return `<div class="cp-cell cp-free" title="Disponível · ${total-offDays} dia(s) útil(eis) livre(s)"></div>`;
  },
  timelineMarkup(){
    const {from,to}=this.period();
    const buckets=this.buckets();
    const crew=this.crew();
    if(!buckets.list.length)
      return '<div class="empty card"><i data-lucide="calendar-days"></i><br>O período selecionado não tem nenhum dia útil.</div>';
    if(!crew.length)
      return '<div class="empty card"><i data-lucide="users"></i><br>Nenhum colaborador atende aos filtros selecionados.</div>';
    const head=buckets.list.map(bucket=>`<div class="cp-col-head"><b>${U.esc(bucket.label)}</b><small>${U.esc(bucket.sub||'')}</small></div>`).join('');
    const rows=crew.map(employee=>{
      const report=CrewPlan.availability(employee,from,to);
      return `<div class="cp-row">
        <div class="cp-name">
          <b>${U.esc(employee.name||'Colaborador')}</b>
          <span class="cp-name-sub"><small>${U.esc(CrewPlan.employeeRole(employee)||'Sem função')}</small>${CrewPlan.categoryTagShort(report.category)}</span>
        </div>
        <div class="cp-track" style="grid-template-columns:repeat(${buckets.list.length},minmax(${buckets.kind==='day'?72:96}px,1fr))">
          ${buckets.list.map(bucket=>this.cellFor(employee,bucket)).join('')}
        </div>
      </div>`;
    }).join('');
    const cards=crew.map(employee=>this.mobileCard(employee,from,to)).join('');
    return `<div class="card cp-gantt">
      <div class="cp-legend">
        <span><i class="cp-chip cp-free"></i>Disponível</span>
        <span><i class="cp-chip cp-busy"></i>Alocado</span>
        <span><i class="cp-chip cp-partial"></i>Parcial</span>
        <span><i class="cp-chip cp-conflict"></i>Conflito</span>
        <span><i class="cp-chip cp-off"></i>Férias/inativo</span>
        <small>Somente dias úteis (seg–sex). Sábados e domingos não consomem capacidade.</small>
      </div>
      <div class="cp-grid-scroll"><div class="cp-grid">
        <div class="cp-row cp-head">
          <div class="cp-name"><b>Colaborador</b><span class="cp-name-sub"><small>${crew.length} em tela</small></span></div>
          <div class="cp-track" style="grid-template-columns:repeat(${buckets.list.length},minmax(${buckets.kind==='day'?72:96}px,1fr))">${head}</div>
        </div>
        ${rows}
      </div></div>
      <div class="cp-cards">${cards}</div>
    </div>`;
  },
  /* ---------- 21. RESPONSIVIDADE — no celular, cards em vez de Gantt ---------- */
  mobileCard(employee,from,to){
    const report=CrewPlan.availability(employee,from,to);
    const blocks=report.allocations.map(row=>`<div class="cp-card-block" style="--cp-color:${U.safeColor(App.projectColor(row.projectId))}">
      <b>${U.date(row.start)} → ${U.date(row.end)}</b>
      <span><i data-lucide="hard-hat"></i>${U.esc(CrewPlan.projectLabel(row.projectId))}</span>
      <small>${U.esc(row.status)} · ${CrewPlan.businessDays(row.start,row.end)} dia(s) útil(eis)</small>
    </div>`).join('');
    const dia=CrewPlan.freeFrom(report,from,to);
    const livre=report.category==='disponivel'
      ?'<div class="cp-card-free"><i data-lucide="user-check"></i>Disponível em todo o período</div>'
      :(dia?`<div class="cp-card-free"><i data-lucide="user-check"></i>${U.date(dia)} → disponível</div>`:'');
    /* Sem esta linha, um colaborador de férias aparece como "Parcialmente
       disponível" com "Nenhuma alocação no período" logo abaixo — verdadeiro,
       mas parece contradição. O motivo tem que estar na tela. */
    const indisponivel=report.offDays
      ?`<div class="cp-card-off"><i data-lucide="calendar-clock"></i>${report.offDays} dia(s) útil(eis) em férias ou com o colaborador inativo</div>`
      :'';
    return `<div class="cp-card">
      <div class="cp-card-head"><span><b>${U.esc(employee.name||'Colaborador')}</b><small>${U.esc(CrewPlan.employeeRole(employee)||'Sem função')}</small></span>${CrewPlan.categoryTag(report.category)}</div>
      ${blocks||'<div class="cp-card-empty">Nenhuma alocação no período.</div>'}
      ${indisponivel}
      ${livre}
    </div>`;
  },
  dayDetail(employeeId,from,to){
    const employee=CrewPlan.crewMembers().find(item=>String(item.id)===String(employeeId));
    if(!employee) return;
    const rows=CrewPlan.allocationsOf(employeeId,{from,to,statuses:CrewPlan.statuses});
    const canEdit=CrewPlan.canEdit();
    UI.modal({title:`${employee.name||'Colaborador'} — ${U.date(from)} a ${U.date(to)}`,wide:true,body:`
      <div class="table-wrap"><div class="table-scroll"><table>
        <thead><tr><th>Obra</th><th>Função</th><th>Início</th><th>Término</th><th class="num">Dias úteis</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map(row=>`<tr>
          <td><b>${U.esc(CrewPlan.projectLabel(row.projectId))}</b></td>
          <td>${U.esc(row.role||'—')}</td>
          <td>${U.date(row.start)}</td><td>${U.date(row.end)}</td>
          <td class="num">${CrewPlan.businessDays(row.start,row.end)}</td>
          <td>${U.esc(row.status)}</td>
          <td>${canEdit?`<button class="btn btn-ghost btn-sm" onclick="UI.close();Views.planejamentoequipe.form(${U.jsArg(row.id)})"><i data-lucide="pencil"></i>Editar</button>`:''}</td>
        </tr>`).join('')||'<tr><td colspan="7"><div class="empty">Nenhuma alocação neste intervalo.</div></td></tr>'}</tbody>
      </table></div></div>`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Fechar</button>'});
  },

  /* ---------- 7. VISÃO DISPONIBILIDADE ---------- */
  availabilityMarkup(){
    const {from,to}=this.period();
    const reports=this.reports()
      .sort((a,b)=>CrewPlan.categoryOrder(a.category)-CrewPlan.categoryOrder(b.category)
        || b.pct-a.pct
        || String(a.employee.name||'').localeCompare(String(b.employee.name||''),'pt-BR'));
    if(!reports.length)
      return '<div class="empty card"><i data-lucide="users"></i><br>Nenhum colaborador atende aos filtros selecionados.</div>';
    return `<div class="table-wrap"><div class="table-scroll"><table>
      <thead><tr><th>Colaborador</th><th>Função</th><th>Situação</th><th class="num">Dias úteis</th><th class="num">Ocupados</th><th class="num">Livres</th><th class="num">Disponibilidade</th><th>Obras no período</th><th>Livre a partir de</th></tr></thead>
      <tbody>${reports.map(report=>`<tr>
        <td><b>${U.esc(report.employee.name||'Colaborador')}</b></td>
        <td>${U.esc(report.role||'—')}</td>
        <td>${CrewPlan.categoryTag(report.category)}</td>
        <td class="num">${report.totalDays}</td>
        <td class="num">${report.busyDays}${report.offDays?` <small class="cp-muted">+${report.offDays} ind.</small>`:''}</td>
        <td class="num">${report.freeDays}</td>
        <td class="num"><div class="cp-bar"><div class="cp-bar-fill ${report.pct>=100?'ok':report.pct>0?'warn':'crit'}" style="width:${Math.max(2,report.pct)}%"></div></div><b>${report.pct}%</b></td>
        <td>${report.projects.map(id=>`<span class="tag tag-gray">${U.esc(CrewPlan.projectLabel(id))}</span>`).join(' ')||'<span class="cp-muted">—</span>'}</td>
        <td>${(dia=>dia?U.date(dia):'<span class="cp-muted">—</span>')(CrewPlan.freeFrom(report,from,to))}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
  },

  /* ---------- 20. VISÃO CAPACIDADE ---------- */
  capacityMarkup(){
    const {from,to}=this.period();
    const buckets=CrewPlan.capacityBuckets(from,to,this.crew());
    if(!buckets.length)
      return '<div class="empty card"><i data-lucide="gauge"></i><br>Sem dias úteis ou sem colaboradores no período selecionado.</div>';
    return `<div class="card">
      <h3>Capacidade da equipe — ${U.esc(this.periodLabel())}</h3>
      <small class="cp-muted">Percentual dos dias úteis da equipe já comprometidos com obras planejadas. Dias de férias e de colaborador inativo saem da conta.</small>
      <div class="cp-capacity">
        ${buckets.map((bucket,index)=>`<div class="cp-capacity-row">
          <span class="cp-capacity-label"><b>Semana ${index+1}</b><small>${U.date(bucket.days[0])} → ${U.date(bucket.days[bucket.days.length-1])}</small></span>
          <div class="cp-bar big"><div class="cp-bar-fill ${bucket.pct>=90?'crit':bucket.pct>=70?'warn':'ok'}" style="width:${Math.max(2,bucket.pct)}%"></div></div>
          <b class="cp-capacity-pct">${bucket.pct}%</b>
          <small class="cp-capacity-sub">${bucket.used}/${bucket.capacity} dias · ${bucket.idle} ocioso(s)</small>
        </div>`).join('')}
      </div>
    </div>`;
  },

  /* ---------- 3. ALOCAÇÃO MANUAL ---------- */
  form(id=''){
    if(!CrewPlan.canEdit()) return UI.toast('Seu acesso a este módulo é somente para consulta.','warn');
    const existing=id?CrewPlan.all().find(row=>String(row.id)===String(id)):null;
    const today=U.isoDate(new Date());
    const row=existing||{id:'',employeeId:'',projectId:'',role:'',start:today,
      end:CrewPlan.endAfterBusinessDays(today,10)||today,status:'Planejado',notes:''};
    const crew=CrewPlan.crewMembers().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
    const projects=CrewPlan.planProjects(row.projectId);
    UI.modal({title:existing?'Editar alocação':'Nova alocação',body:`
      <div class="form-grid">
        <div><label for="cp-employee">Colaborador *</label><select id="cp-employee"><option value="">Selecione…</option>${crew.map(employee=>`<option value="${U.esc(employee.id)}" ${String(row.employeeId)===String(employee.id)?'selected':''}>${U.esc(employee.name||'Colaborador')}${employee.internalRole?` · ${U.esc(employee.internalRole)}`:''}</option>`).join('')}</select></div>
        <div><label for="cp-project">Obra *</label><select id="cp-project"><option value="">Selecione…</option>${projects.map(project=>`<option value="${U.esc(project.id)}" ${String(row.projectId)===String(project.id)?'selected':''}>${U.esc(project.label)}</option>`).join('')}</select></div>
        <div><label for="cp-start">Data inicial *</label><input id="cp-start" type="date" value="${U.esc(row.start)}"></div>
        <div><label for="cp-end">Data final *</label><input id="cp-end" type="date" value="${U.esc(row.end)}"></div>
        <div><label for="cp-role">Função/cargo</label><select id="cp-role"><option value="">Usar a função do cadastro</option>${CrewPlan.roleNames().map(name=>`<option value="${U.esc(name)}" ${U.norm(row.role)===U.norm(name)?'selected':''}>${U.esc(name)}</option>`).join('')}</select></div>
        <div><label for="cp-status">Status</label><select id="cp-status">${CrewPlan.statuses.map(status=>`<option value="${U.esc(status)}" ${row.status===status?'selected':''}>${U.esc(status)}</option>`).join('')}</select></div>
        <div class="full"><label for="cp-notes">Observação</label><textarea id="cp-notes" rows="2">${U.esc(row.notes||'')}</textarea></div>
        <div class="full"><div class="cp-hint" id="cp-hint"><i data-lucide="info"></i><span>Somente dias úteis (segunda a sexta) consomem capacidade.</span></div></div>
      </div>`,
      footer:`${existing?`<button class="btn btn-danger" style="margin-right:auto" onclick="Views.planejamentoequipe.remove(${U.jsArg(existing.id)})"><i data-lucide="trash-2"></i>Excluir</button>`:''}
        <button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
        <button class="btn btn-primary" id="cp-save"><i data-lucide="check"></i>Salvar</button>`,
      onOpen:()=>{
        const refresh=()=>{
          const start=document.getElementById('cp-start').value;
          const end=document.getElementById('cp-end').value;
          const hint=document.getElementById('cp-hint');
          const days=CrewPlan.businessDays(start,end);
          if(hint) hint.innerHTML=`<i data-lucide="info"></i><span>${days?`<b>${days}</b> dia(s) útil(eis) no período — sábados e domingos não consomem capacidade.`:'Informe um período válido (a data final não pode ser anterior à inicial).'}</span>`;
          U.icons();
        };
        ['cp-start','cp-end'].forEach(elId=>{
          const el=document.getElementById(elId);
          if(el) el.onchange=refresh;
        });
        refresh();
      }});
    document.getElementById('cp-save').onclick=()=>this.save(existing);
  },
  async save(existing){
    const employeeId=document.getElementById('cp-employee').value;
    const projectId=document.getElementById('cp-project').value;
    const start=document.getElementById('cp-start').value;
    const end=document.getElementById('cp-end').value;
    const status=document.getElementById('cp-status').value||'Planejado';
    const roleChoice=document.getElementById('cp-role').value.trim();
    const notes=document.getElementById('cp-notes').value.trim();
    if(!employeeId||!projectId||!start||!end)
      return UI.toast('Preencha colaborador, obra e o período.','warn');
    if(start>end)
      return UI.toast('A data final não pode ser anterior à data inicial.','warn');
    if(!CrewPlan.businessDays(start,end))
      return UI.toast('O período informado não tem nenhum dia útil.','warn');
    const employee=CrewPlan.crewMembers().find(item=>String(item.id)===String(employeeId));
    /* ---------- 8. DETECÇÃO DE CONFLITOS ----------
       Bloqueia, mas explica: colaborador, obra já planejada, período em
       conflito, obra nova e período solicitado. Nunca bloqueia em silêncio. */
    if(CrewPlan.activeStatuses.includes(status)){
      const conflicts=CrewPlan.conflictsFor({employeeId,start,end,
        excludeId:existing?existing.id:''});
      if(conflicts.length){
        const conflict={...conflicts[0],__newProjectId:projectId};
        return UI.modal({title:'Conflito de planejamento',
          body:CrewPlan.conflictMessage(employee,conflict,start,end)
            +(conflicts.length>1?`<small class="cp-muted">Há mais ${conflicts.length-1} alocação(ões) sobreposta(s) no mesmo período.</small>`:''),
          footer:'<button class="btn btn-primary" onclick="UI.close()">Entendi</button>',replace:true});
      }
    }
    const now=new Date().toISOString();
    const obj={
      ...(existing||{id:U.id(),createdAt:now,planGroupId:''}),
      employeeId:String(employeeId), projectId:String(projectId),
      role:roleChoice||CrewPlan.employeeRole(employee),
      start, end, status, notes, updatedAt:now
    };
    try{
      await DB.put('crew_allocations',obj);
      await State.reload();
      UI.close();
      UI.toast(existing?'Alocação atualizada.':'Alocação criada.','success');
      App.render();
    }catch(error){
      UI.toast(String(error&&error.message||'Não foi possível salvar a alocação.'),'error',6000);
    }
  },
  remove(id){
    if(!CrewPlan.canEdit()) return UI.toast('Seu acesso a este módulo é somente para consulta.','warn');
    UI.confirm('Excluir esta alocação do planejamento?',async()=>{
      try{
        await DB.del('crew_allocations',id);
        await State.reload();
        UI.toast('Alocação excluída.','warn');
        App.render();
      }catch(error){
        UI.toast(String(error&&error.message||'Não foi possível excluir a alocação.'),'error',6000);
      }
    });
  },

  /* ---------- 18. ENCONTRAR COLABORADORES DISPONÍVEIS ----------
     Mesmo motor do "Planejar nova obra". Nenhuma regra duplicada. */
  findAvailable(){
    const today=U.isoDate(new Date());
    const period=this.period();
    UI.modal({title:'Encontrar colaboradores disponíveis',wide:true,body:`
      <div class="form-grid">
        <div><label for="cp-fa-from">De *</label><input id="cp-fa-from" type="date" value="${U.esc(period.from||today)}"></div>
        <div><label for="cp-fa-to">Até *</label><input id="cp-fa-to" type="date" value="${U.esc(period.to||today)}"></div>
        <div><label for="cp-fa-role">Função</label><select id="cp-fa-role"><option value="">Todas</option>${CrewPlan.roleNames().map(name=>`<option value="${U.esc(name)}">${U.esc(name)}</option>`).join('')}</select></div>
        <div><label for="cp-fa-project">Obra atual</label><select id="cp-fa-project"><option value="">Qualquer</option>${CrewPlan.planProjects().map(project=>`<option value="${U.esc(project.id)}">${U.esc(project.label)}</option>`).join('')}</select></div>
        <div><label for="cp-fa-min">Disponibilidade mínima</label><select id="cp-fa-min">${[0,25,50,75,100].map(value=>`<option value="${value}" ${value===50?'selected':''}>${value}%</option>`).join('')}</select></div>
      </div>
      <div id="cp-fa-result" class="cp-result"></div>`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Fechar</button><button class="btn btn-primary" id="cp-fa-run"><i data-lucide="search"></i>Consultar</button>',
      onOpen:()=>{ document.getElementById('cp-fa-run').onclick=()=>this.runFindAvailable(); }});
    this.runFindAvailable();
  },
  runFindAvailable(){
    const from=document.getElementById('cp-fa-from').value;
    const to=document.getElementById('cp-fa-to').value;
    const role=document.getElementById('cp-fa-role').value;
    const projectId=document.getElementById('cp-fa-project').value;
    const minPct=Number(document.getElementById('cp-fa-min').value)||0;
    const box=document.getElementById('cp-fa-result');
    if(!box) return;
    if(!CrewPlan.isIso(from)||!CrewPlan.isIso(to)||from>to){
      box.innerHTML='<div class="empty">Informe um período válido.</div>';
      return;
    }
    let list=CrewPlan.candidates({from,to,role,minPct});
    if(projectId) list=list.filter(report=>report.projects.includes(String(projectId)));
    const total=CrewPlan.businessDays(from,to);
    box.innerHTML=`<div class="cp-result-head"><b>${list.length}</b> colaborador(es) · período com <b>${total}</b> dia(s) útil(eis)</div>
      <div class="table-wrap"><div class="table-scroll" style="max-height:44vh"><table>
      <thead><tr><th>Colaborador</th><th>Função</th><th class="num">Disponibilidade</th><th>Situação</th><th>Obras no período</th><th>Livre a partir de</th></tr></thead>
      <tbody>${list.map(report=>`<tr>
        <td><b>${U.esc(report.employee.name||'Colaborador')}</b></td>
        <td>${U.esc(report.role||'—')}</td>
        <td class="num"><b>${report.pct}%</b><br><small class="cp-muted">${report.freeDays}/${report.totalDays} dias</small></td>
        <td>${CrewPlan.categoryTag(report.category)}</td>
        <td>${report.projects.map(id=>`<span class="tag tag-gray">${U.esc(CrewPlan.projectLabel(id))}</span>`).join(' ')||'<span class="cp-muted">—</span>'}</td>
        <td>${(dia=>dia?U.date(dia):'<span class="cp-muted">—</span>')(CrewPlan.freeFrom(report,from,to))}</td>
      </tr>`).join('')||'<tr><td colspan="6"><div class="empty">Nenhum colaborador atende aos critérios informados.</div></td></tr>'}</tbody>
    </table></div></div>`;
    U.icons();
  },

  /* ---------- 9 a 17. ASSISTENTE "PLANEJAR NOVA OBRA" ----------
     Quatro etapas: dados da obra → necessidade da equipe → sugestão e
     montagem → prévia. NADA é gravado antes da confirmação final. */
  planNewProject(){
    if(!CrewPlan.canEdit()) return UI.toast('Seu acesso a este módulo é somente para consulta.','warn');
    const today=U.isoDate(new Date());
    this.wizard={step:1,projectId:'',start:today,end:'',useDuration:false,duration:20,
      notes:'',needs:[],selection:{}};
    this.wizardRender();
  },
  wizardRender(){
    const step=this.wizard.step;
    const body={1:this.wizardStep1(),2:this.wizardStep2(),3:this.wizardStep3(),4:this.wizardStep4()}[step];
    const steps=['Dados da obra','Necessidade da equipe','Sugestão da equipe','Prévia do planejamento'];
    UI.modal({title:'Planejar nova obra',wide:true,replace:true,body:`
      <div class="cp-steps">${steps.map((label,index)=>`<span class="cp-step ${index+1===step?'active':''} ${index+1<step?'done':''}"><b>${index+1}</b>${U.esc(label)}</span>`).join('')}</div>
      <div id="cp-wizard-body">${body}</div>`,
      footer:this.wizardFooter(),
      onOpen:()=>this.wizardBind()});
  },
  wizardFooter(){
    const step=this.wizard.step;
    const back=step>1
      ?'<button class="btn btn-ghost" id="cp-wz-back"><i data-lucide="arrow-left"></i>Voltar</button>'
      :'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>';
    const next=step<4
      ?'<button class="btn btn-primary" id="cp-wz-next">Avançar<i data-lucide="arrow-right"></i></button>'
      :'<button class="btn btn-primary" id="cp-wz-confirm"><i data-lucide="check"></i>Confirmar planejamento</button>';
    return `${back}<div class="spacer"></div>${next}`;
  },
  wizardBind(){
    const back=document.getElementById('cp-wz-back');
    if(back) back.onclick=()=>{ this.wizard.step=Math.max(1,this.wizard.step-1); this.wizardRender(); };
    const next=document.getElementById('cp-wz-next');
    if(next) next.onclick=()=>this.wizardNext();
    const confirm=document.getElementById('cp-wz-confirm');
    if(confirm) confirm.onclick=()=>this.wizardConfirm();
    if(this.wizard.step===1){
      const sync=()=>{
        const useDuration=document.getElementById('cp-wz-mode').value==='duration';
        document.getElementById('cp-wz-end-wrap').hidden=useDuration;
        document.getElementById('cp-wz-duration-wrap').hidden=!useDuration;
        const start=document.getElementById('cp-wz-start').value;
        const hint=document.getElementById('cp-wz-hint');
        let end=document.getElementById('cp-wz-end').value;
        if(useDuration) end=CrewPlan.endAfterBusinessDays(start,document.getElementById('cp-wz-duration').value);
        const days=CrewPlan.businessDays(start,end);
        hint.innerHTML=days
          ?`<i data-lucide="info"></i><span>Período: <b>${U.date(start)}</b> → <b>${U.date(end)}</b> · <b>${days}</b> dia(s) útil(eis).</span>`
          :'<i data-lucide="info"></i><span>Informe um período válido.</span>';
        U.icons();
      };
      ['cp-wz-mode','cp-wz-start','cp-wz-end','cp-wz-duration'].forEach(id=>{
        const el=document.getElementById(id);
        if(el){ el.onchange=sync; el.oninput=sync; }
      });
      sync();
    }
    if(this.wizard.step===2){
      const add=document.getElementById('cp-wz-add-role');
      if(add) add.onclick=()=>{
        const role=document.getElementById('cp-wz-role').value;
        const qty=Math.max(1,Math.floor(Number(document.getElementById('cp-wz-qty').value)||0));
        if(!role) return UI.toast('Selecione a função.','warn');
        if(this.wizard.needs.some(need=>U.norm(need.role)===U.norm(role)))
          return UI.toast('Essa função já está na lista. Altere a quantidade.','warn');
        this.wizard.needs.push({role,qty});
        document.getElementById('cp-wizard-body').innerHTML=this.wizardStep2();
        this.wizardBind(); U.icons();
      };
      document.querySelectorAll('[data-need-remove]').forEach(button=>{
        button.onclick=()=>{
          this.wizard.needs.splice(Number(button.dataset.needRemove),1);
          document.getElementById('cp-wizard-body').innerHTML=this.wizardStep2();
          this.wizardBind(); U.icons();
        };
      });
      document.querySelectorAll('[data-need-qty]').forEach(input=>{
        input.onchange=()=>{
          const index=Number(input.dataset.needQty);
          this.wizard.needs[index].qty=Math.max(1,Math.floor(Number(input.value)||1));
          document.getElementById('cp-wizard-body').innerHTML=this.wizardStep2();
          this.wizardBind(); U.icons();
        };
      });
    }
    if(this.wizard.step===3){
      document.querySelectorAll('[data-pick]').forEach(box=>{
        box.onchange=()=>{
          const role=box.dataset.pick, id=box.dataset.employee;
          const picked=new Set(this.wizard.selection[role]||[]);
          if(box.checked) picked.add(id); else picked.delete(id);
          this.wizard.selection[role]=[...picked];
          document.getElementById('cp-wizard-body').innerHTML=this.wizardStep3();
          this.wizardBind(); U.icons();
        };
      });
    }
    U.icons();
  },
  /* ETAPA 1 — dados da obra */
  wizardStep1(){
    const wizard=this.wizard;
    return `<div class="form-grid">
      <div class="full"><label for="cp-wz-project">Obra *</label><select id="cp-wz-project"><option value="">Selecione uma obra cadastrada…</option>${CrewPlan.planProjects().map(project=>`<option value="${U.esc(project.id)}" ${wizard.projectId===project.id?'selected':''}>${U.esc(project.label)}</option>`).join('')}</select><small class="cp-muted">A obra vem do cadastro de Projetos — o assistente não cria obra nova.</small></div>
      <div><label for="cp-wz-start">Data prevista de início *</label><input id="cp-wz-start" type="date" value="${U.esc(wizard.start)}"></div>
      <div><label for="cp-wz-mode">Definir o término por</label><select id="cp-wz-mode"><option value="date" ${wizard.useDuration?'':'selected'}>Data de término</option><option value="duration" ${wizard.useDuration?'selected':''}>Duração em dias úteis</option></select></div>
      <div id="cp-wz-end-wrap" ${wizard.useDuration?'hidden':''}><label for="cp-wz-end">Data prevista de término *</label><input id="cp-wz-end" type="date" value="${U.esc(wizard.end||CrewPlan.endAfterBusinessDays(wizard.start,20))}"></div>
      <div id="cp-wz-duration-wrap" ${wizard.useDuration?'':'hidden'}><label for="cp-wz-duration">Duração (dias úteis) *</label><input id="cp-wz-duration" type="number" min="1" step="1" value="${U.esc(wizard.duration)}"></div>
      <div class="full"><label for="cp-wz-notes">Observação</label><textarea id="cp-wz-notes" rows="2">${U.esc(wizard.notes)}</textarea></div>
      <div class="full"><div class="cp-hint" id="cp-wz-hint"><i data-lucide="info"></i><span>Informe o período da obra.</span></div></div>
    </div>`;
  },
  /* ETAPA 2 — necessidade da equipe */
  wizardStep2(){
    const wizard=this.wizard;
    const total=wizard.needs.reduce((sum,need)=>sum+need.qty,0);
    return `<p class="cp-muted">Obra <b>${U.esc(CrewPlan.projectLabel(wizard.projectId))}</b> · ${U.date(wizard.start)} → ${U.date(wizard.end)} · <b>${CrewPlan.businessDays(wizard.start,wizard.end)}</b> dia(s) útil(eis).</p>
      <div class="cp-need-form">
        <div><label for="cp-wz-role">Função</label><select id="cp-wz-role"><option value="">Selecione…</option>${CrewPlan.roleNames().map(name=>`<option value="${U.esc(name)}">${U.esc(name)}</option>`).join('')}</select></div>
        <div><label for="cp-wz-qty">Quantidade</label><input id="cp-wz-qty" type="number" min="1" step="1" value="1"></div>
        <button class="btn btn-ghost" type="button" id="cp-wz-add-role"><i data-lucide="plus"></i>Adicionar função</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Função</th><th class="num" style="width:130px">Quantidade</th><th style="width:60px"></th></tr></thead>
        <tbody>${wizard.needs.map((need,index)=>`<tr>
          <td><b>${U.esc(need.role)}</b><br><small class="cp-muted">${CrewPlan.crewMembers().filter(employee=>U.norm(CrewPlan.employeeRole(employee))===U.norm(need.role)).length} colaborador(es) com essa função no cadastro</small></td>
          <td class="num"><input type="number" min="1" step="1" value="${need.qty}" data-need-qty="${index}" style="max-width:90px;text-align:right"></td>
          <td><button class="btn btn-ghost btn-sm" type="button" data-need-remove="${index}" aria-label="Remover função"><i data-lucide="trash-2"></i></button></td>
        </tr>`).join('')||'<tr><td colspan="3"><div class="empty">Nenhuma função informada ainda.</div></td></tr>'}</tbody>
        ${total?`<tfoot><tr><th>Equipe necessária</th><th class="num">${total}</th><th></th></tr></tfoot>`:''}
      </table></div>
      <small class="cp-muted">As funções vêm do cadastro de Funções dos colaboradores — o assistente não cria estrutura paralela.</small>`;
  },
  /* ETAPAS 12 a 15 — análise, sugestão, montagem e déficit */
  wizardStep3(){
    const wizard=this.wizard;
    const {start,end}=wizard;
    const marks={1:'✓',2:'◐',4:'⚠',5:'✕'};
    const blocks=wizard.needs.map(need=>{
      const picked=new Set(wizard.selection[need.role]||[]);
      const list=CrewPlan.candidates({from:start,to:end,role:need.role});
      const found=picked.size;
      return `<div class="cp-need-block">
        <div class="cp-need-head"><b>${U.esc(need.role)}</b>
          <span class="tag ${found>=need.qty?'tag-green':'tag-amber'}">${found} de ${need.qty} selecionado(s)</span></div>
        ${list.map(report=>{
          const id=String(report.employeeId);
          const disabled=report.pct<=0&&report.tier>=5;
          return `<label class="cp-candidate ${picked.has(id)?'picked':''} ${disabled?'off':''}">
            <input type="checkbox" data-pick="${U.esc(need.role)}" data-employee="${U.esc(id)}" ${picked.has(id)?'checked':''} ${disabled?'disabled':''}>
            <span class="cp-candidate-mark">${marks[report.tier]||'◐'}</span>
            <span class="cp-candidate-main"><b>${U.esc(report.employee.name||'Colaborador')}</b>
              <small>${report.pct}% disponível · ${report.freeDays} de ${report.totalDays} dia(s) útil(eis) livre(s)${report.offDays?` · ${report.offDays} em férias/inativo`:''}</small>
              <small>${report.allocations.length?report.allocations.map(row=>`${U.esc(CrewPlan.projectLabel(row.projectId))} até ${U.date(row.end)}`).join(' · '):'Nenhuma obra planejada no período'}</small></span>
            ${CrewPlan.categoryTag(report.category)}
          </label>`;
        }).join('')||'<div class="empty">Nenhum colaborador cadastrado com essa função.</div>'}
      </div>`;
    }).join('');
    return `<p class="cp-muted">O sistema apenas sugere: a decisão final de alocação continua com o gestor. Colaboradores com conflito aparecem marcados com ⚠ e os sem nenhum dia livre ficam desabilitados.</p>
      ${blocks||'<div class="empty">Volte à etapa anterior e informe pelo menos uma função.</div>'}
      ${this.coverageMarkup()}`;
  },
  coverageMarkup(){
    const wizard=this.wizard;
    const needed=wizard.needs.reduce((sum,need)=>sum+need.qty,0);
    const selected=wizard.needs.reduce((sum,need)=>sum+(wizard.selection[need.role]||[]).length,0);
    const gaps=wizard.needs.filter(need=>(wizard.selection[need.role]||[]).length<need.qty);
    return `<div class="cp-coverage">
      <div><small>Equipe necessária</small><b>${needed}</b></div>
      <div><small>Equipe selecionada</small><b>${selected}</b></div>
      <div><small>Cobertura</small><b class="${needed&&selected>=needed?'ok':'warn'}">${needed?Math.round(Math.min(selected,needed)/needed*100):0}%</b></div>
    </div>
    ${gaps.length?`<div class="cp-gap"><b><i data-lucide="alert-triangle"></i> Não existem colaboradores suficientes selecionados para atender integralmente a equipe necessária nesse período.</b>
      <table class="cp-gap-table"><tbody>${wizard.needs.map(need=>{
        const found=(wizard.selection[need.role]||[]).length;
        return `<tr><td>${U.esc(need.role)}</td><td class="num">${need.qty} necessário(s)</td><td class="num">${found} encontrado(s)</td><td>${found>=need.qty?'<span class="tag tag-green">✓</span>':'<span class="tag tag-amber">⚠</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>`:''}`;
  },
  /* ETAPA 16 — prévia. Nada foi gravado até aqui. */
  wizardPreviewRows(){
    const wizard=this.wizard;
    const rows=[];
    wizard.needs.forEach(need=>{
      (wizard.selection[need.role]||[]).forEach(employeeId=>{
        const employee=CrewPlan.crewMembers().find(item=>String(item.id)===String(employeeId));
        if(!employee) return;
        const report=CrewPlan.availability(employee,wizard.start,wizard.end);
        rows.push({employee,role:need.role,report});
      });
    });
    return rows;
  },
  wizardStep4(){
    const wizard=this.wizard;
    const rows=this.wizardPreviewRows();
    return `<div class="cp-preview-head">
        <div><small>Obra</small><b>${U.esc(CrewPlan.projectLabel(wizard.projectId))}</b></div>
        <div><small>Período</small><b>${U.date(wizard.start)} → ${U.date(wizard.end)}</b></div>
        <div><small>Dias úteis</small><b>${CrewPlan.businessDays(wizard.start,wizard.end)}</b></div>
        <div><small>Colaboradores</small><b>${rows.length}</b></div>
      </div>
      <div class="table-wrap"><div class="table-scroll" style="max-height:42vh"><table>
        <thead><tr><th>Colaborador</th><th>Função</th><th class="num">Disponibilidade</th><th>Situação</th></tr></thead>
        <tbody>${rows.map(row=>`<tr>
          <td><b>${U.esc(row.employee.name||'Colaborador')}</b></td>
          <td>${U.esc(row.role)}</td>
          <td class="num"><b>${row.report.pct}%</b></td>
          <td>${CrewPlan.categoryTag(row.report.category)}</td>
        </tr>`).join('')||'<tr><td colspan="4"><div class="empty">Nenhum colaborador selecionado.</div></td></tr>'}</tbody>
      </table></div></div>
      ${wizard.notes?`<p class="cp-muted"><b>Observação:</b> ${U.esc(wizard.notes)}</p>`:''}
      <div class="cp-hint"><i data-lucide="info"></i><span>Nada foi gravado ainda. As alocações só serão criadas ao confirmar o planejamento.</span></div>`;
  },
  wizardNext(){
    const wizard=this.wizard;
    if(wizard.step===1){
      wizard.projectId=document.getElementById('cp-wz-project').value;
      wizard.start=document.getElementById('cp-wz-start').value;
      wizard.useDuration=document.getElementById('cp-wz-mode').value==='duration';
      wizard.duration=Math.max(1,Math.floor(Number(document.getElementById('cp-wz-duration').value)||1));
      wizard.end=wizard.useDuration
        ?CrewPlan.endAfterBusinessDays(wizard.start,wizard.duration)
        :document.getElementById('cp-wz-end').value;
      wizard.notes=document.getElementById('cp-wz-notes').value.trim();
      if(!wizard.projectId) return UI.toast('Selecione a obra.','warn');
      if(!CrewPlan.isIso(wizard.start)||!CrewPlan.isIso(wizard.end)||wizard.start>wizard.end)
        return UI.toast('Informe um período válido.','warn');
      if(!CrewPlan.businessDays(wizard.start,wizard.end))
        return UI.toast('O período informado não tem nenhum dia útil.','warn');
    }
    if(wizard.step===2 && !wizard.needs.length)
      return UI.toast('Informe pelo menos uma função e a quantidade necessária.','warn');
    if(wizard.step===3 && !this.wizardPreviewRows().length)
      return UI.toast('Selecione pelo menos um colaborador para a equipe.','warn');
    wizard.step=Math.min(4,wizard.step+1);
    this.wizardRender();
  },
  /* ETAPA 17 — só agora as alocações são criadas. */
  async wizardConfirm(){
    const wizard=this.wizard;
    const rows=this.wizardPreviewRows();
    if(!rows.length) return UI.toast('Selecione pelo menos um colaborador.','warn');
    /* Revalida o conflito no momento da gravação: entre a sugestão e a
       confirmação outra pessoa pode ter planejado o mesmo colaborador. */
    const blocked=[];
    rows.forEach(row=>{
      const conflicts=CrewPlan.conflictsFor({employeeId:row.employee.id,
        start:wizard.start,end:wizard.end});
      if(conflicts.length) blocked.push({row,conflict:conflicts[0]});
    });
    if(blocked.length){
      return UI.modal({title:'Conflito de planejamento',replace:true,
        body:`<p class="cp-muted">Estes colaboradores já estão planejados em outra obra no mesmo período e não podem ser alocados integralmente:</p>
          ${blocked.map(item=>CrewPlan.conflictMessage(item.row.employee,
            {...item.conflict,__newProjectId:wizard.projectId},wizard.start,wizard.end)).join('')}
          <small class="cp-muted">Volte à etapa de sugestão e desmarque esses colaboradores, ou ajuste as alocações existentes.</small>`,
        footer:'<button class="btn btn-primary" id="cp-wz-back-conflict">Voltar à sugestão</button>',
        onOpen:()=>{ document.getElementById('cp-wz-back-conflict').onclick=()=>{
          this.wizard.step=3; this.wizardRender();
        }; }});
    }
    const now=new Date().toISOString();
    const planGroupId=U.id();
    const objects=rows.map(row=>({
      id:U.id(), employeeId:String(row.employee.id), projectId:String(wizard.projectId),
      role:row.role, start:wizard.start, end:wizard.end, status:'Planejado',
      notes:wizard.notes, planGroupId, createdAt:now, updatedAt:now
    }));
    try{
      UI.loading(true,'Criando as alocações…');
      await DB.bulkPut('crew_allocations',objects);
      await State.reload();
      UI.loading(false);
      UI.closeAll();
      UI.toast(`${objects.length} alocação(ões) criada(s) para ${CrewPlan.projectLabel(wizard.projectId)}.`,'success',5200);
      this.wizard=null;
      this.filters.project=String(wizard.projectId);
      App.render();
    }catch(error){
      UI.loading(false);
      UI.toast(String(error&&error.message||'Não foi possível criar as alocações.'),'error',6000);
    }
  }
};
