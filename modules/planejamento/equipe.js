/**
 * Planejamento de Colaboradores (equipe.js) — v4.5.2
 *
 * v4.5.2 — o PDF virou GANTT PAISAGEM: mesma matriz da tela, mesmas cores,
 * dia a dia quando o período cabe. `CrewPlan.bucketState()` passou a ser a
 * porta única do retrato de uma COLUNA — tela e papel consomem o mesmo.
 *
 * v4.5.1 — correções pedidas em 10/09/2026:
 *  1. só colaborador ATIVO entra no planejamento (inativo = desligado);
 *  2. cor da alocação não depende mais da obra (azul/amarelo/vermelho fixos);
 *  3. escala de ocupação invertida (verde = cheio, vermelho = ocioso);
 *  4. a necessidade da equipe aceita VÁRIAS funções (Eletricista I/II/I A/II A);
 *  5. PDF do planejamento agrupado por obra + data de admissão do colaborador;
 *  6. o seletor Semana/Mês/Trimestre agora acompanha o período em tela.
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
  /* ---------- v4.5.1 — FAMÍLIA DE FUNÇÃO ----------
     O cadastro tem "Eletricista I", "Eletricista II", "Eletricista I A" e
     "Eletricista II A". Uma obra pede "5 eletricistas", não "5 de cada nível".
     A família sai do PRÓPRIO nome já cadastrado: nenhum campo novo no banco,
     nenhuma tela de cadastro, nada para recadastrar nas funções existentes. */
  roleFamily(name){
    return String(name||'').trim().replace(/\s+/g,' ')
      .replace(/\s+[IVX]+(\s+[A-Za-z])?\.?$/i,'')
      .replace(/\s+\d+(\s+[A-Za-z])?$/,'')
      .trim();
  },
  /* Só vira atalho a família que agrupa 2 ou mais funções cadastradas. */
  roleFamilies(){
    const map=new Map();
    this.roleNames().forEach(name=>{
      const family=this.roleFamily(name);
      if(!family||U.norm(family)===U.norm(name)) return;
      const key=U.norm(family);
      if(!map.has(key)) map.set(key,{name:family,roles:[]});
      map.get(key).roles.push(name);
    });
    return [...map.values()].filter(item=>item.roles.length>1)
      .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  },

  /* ---------- v4.5.1 — VÍNCULO DO COLABORADOR ----------
     "Inativo" passou a significar DESLIGADO: quem não trabalha mais na empresa
     sai do planejamento. O vínculo tem as duas pontas — antes da admissão e a
     partir do desligamento não existe dia planejável, e nesse caso o
     colaborador nem aparece na lista.
     ⚠ crewMembers() continua devolvendo TODO MUNDO de propósito: o RDO
     retroativo, o Histórico de Alocações e o nome numa alocação antiga
     precisam enxergar o desligado. A regra "some do planejamento" mora AQUI. */
  bondOverlaps(employee,from,to){
    if(!employee) return false;
    const admission=String(employee.admissionDate||'').slice(0,10);
    const exit=String(employee.inactiveSince||'').slice(0,10);
    if(this.isIso(admission)&&this.isIso(to)&&admission>String(to)) return false;
    if(this.isIso(exit)&&this.isIso(from)&&exit<=String(from)) return false;
    return true;
  },
  /* A lista de colaboradores DESTE módulo. Inativo sem data de desligamento
     some de tudo (comportamento de sempre); com data, some quando o período
     inteiro já está depois do desligamento. */
  planningCrew(from='',to=''){
    return this.crewMembers()
      .filter(employee=>employee.active!==false
        ||this.isIso(String(employee.inactiveSince||'').slice(0,10)))
      .filter(employee=>this.bondOverlaps(employee,from,to));
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
  /* v4.5.2 — código curto da obra, para a coluna estreita do Gantt impresso.
     `U.projLabel` é "815 | USF Vila Nova"; o número da proposta é o que ele usa
     no dia a dia e cabe em 10 mm. A legenda do PDF traz a tradução completa. */
  projectShort(projectId){
    const label=String(this.projectLabel(projectId)||'');
    if(!label) return '';
    const head=label.split('|')[0].trim();
    return (head||label).slice(0,7);
  },
  employeeName(employeeId){
    const employee=this.crewMembers().find(item=>String(item.id)===String(employeeId));
    return employee?String(employee.name||'Colaborador'):'Colaborador';
  },
  /* ---------- v4.5.4 — UMA COR POR OBRA ----------
     O Gantt inteiro azul nao deixa ver que DUAS obras diferentes estao lado a
     lado. A cor volta a falar da obra — mas não pelo helper de cor do
     `js/app.js`, que é indexado por POSIÇÃO em `State.projects` (apagar uma
     obra reembaralha todas as cores) e usa uma paleta saturada que briga com o
     desenho sóbrio. Aqui a cor sai de um hash do ID: a mesma obra fica com a
     mesma cor hoje e no mês que vem, e não depende de quantas obras existem no
     cadastro.
     ⚠ O teste `crew-planning-v451` assere que o NOME daquele helper não
     aparece neste arquivo — nem dentro de comentário. Não reescrever citando-o.
     ⚠ A paleta NAO tem vermelho nem cinza: sao de Conflito (!) e Ferias (//),
     que continuam sendo estado e precisam saltar por cima da cor da obra. */
  /* 9, e não 10: medi o ΔE (CIELab) de cada candidata contra o vermelho do
     conflito (#B91C1C) e o cinza das férias (#A1A1AA). O laranja queimado que
     eu tinha escolhido primeiro ficava a ΔE 16 do vermelho — numa célula de
     6 px é a MESMA cor, e conflito é exatamente o que não pode passar batido.
     As 9 que sobraram estão a ΔE ≥ 42 do vermelho, ≥ 36 do cinza e ≥ 21 entre
     si. O `crew-project-colors` refaz essa conta e trava o número. */
  paletteSize:9,
  /* Hash estavel (djb2/31) — numero puro, sem depender de ordem de cadastro. */
  paletteHash(value){
    const text=String(value||'');
    let hash=0;
    for(let index=0;index<text.length;index++) hash=(hash*31+text.charCodeAt(index))>>>0;
    return hash;
  },
  /* Mapa obraId -> slot da paleta (0..paletteSize-1).
     ⚠ Duas obras do MESMO planejamento na mesma cor derrubam o motivo de a cor
     existir. Quando o hash colide, anda para a frente ate achar um slot livre;
     so repete se houver mais obras que cores. A ordem da varredura e' o rotulo
     da obra, para o resultado nao depender da ordem em que os IDs chegaram. */
  projectPalette(projectIds){
    const ids=[...new Set((Array.isArray(projectIds)?projectIds:[])
      .map(id=>String(id||'')).filter(Boolean))]
      .sort((a,b)=>this.projectLabel(a).localeCompare(this.projectLabel(b),'pt-BR'));
    const total=this.paletteSize;
    const taken=new Set();
    const map=new Map();
    ids.forEach(id=>{
      let slot=this.paletteHash(id)%total;
      for(let step=0;step<total&&taken.has(slot);step++) slot=(slot+1)%total;
      taken.add(slot);
      map.set(id,slot);
    });
    return map;
  },
  /* O nome da classe CSS. Sem paleta devolve '' — e a celula fica com a cor
     de situacao da v4.5.1. E' assim que o parametro novo fica OPCIONAL. */
  paletteClass(projectId,palette,prefix){
    if(!palette||typeof palette.get!=='function'||!projectId) return '';
    const slot=palette.get(String(projectId));
    return slot===undefined||slot===null?'':`${prefix||'cp-obra'}-${slot}`;
  },
  /* ---------- v4.5.2 — RETRATO DE UMA COLUNA DO GANTT ----------
     A tela (`cellFor`) e o PDF (`printCell`) montam a MESMA célula com markup
     diferente. Sem isto, a regra de "essa coluna está alocada / parcial / em
     conflito" existiria em dois lugares e um dia divergiria. Aqui ela existe
     uma vez só; lá em cima cada tela só decide como desenhar.
     ⚠ `active` e `busyDays` contam apenas `activeStatuses` (Planejado). */
  bucketState(employee,days){
    const list=(Array.isArray(days)?days:[days]).map(day=>({
      day,
      off:!this.activeOn(employee,day),
      rows:this.allocationsOf(employee&&employee.id,{from:day,to:day,statuses:this.statuses})
        .filter(row=>day>=row.start&&day<=row.end)
    }));
    const active=list.filter(item=>!item.off)
      .flatMap(item=>item.rows.filter(row=>this.activeStatuses.includes(row.status)));
    const conflict=list.some(item=>!item.off
      && item.rows.filter(row=>this.activeStatuses.includes(row.status)).length>1);
    const offDays=list.filter(item=>item.off).length;
    const busyDays=list.filter(item=>!item.off
      && item.rows.some(row=>this.activeStatuses.includes(row.status))).length;
    const total=list.length;
    return {days:list,active,conflict,offDays,busyDays,total,
      partial:busyDays>0&&(busyDays<total-offDays||offDays>0),
      done:active.length>0&&active.every(row=>row.status==='Concluído'),
      offList:list.filter(item=>item.off).map(item=>item.day)};
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
  /* ---------- v4.5.1 — POR QUE O DIA NÃO CONTA ----------
     Com a data de admissão, "indisponível" passou a ter DOIS motivos: férias e
     fora do vínculo (antes da admissão ou depois do desligamento). Escrever
     "Férias/inativo" num dia anterior à admissão é mentira na tela — foi o que
     o render da v4.5.1 mostrou. O motivo passa a ser calculado. */
  offReason(employee,days){
    const list=Array.isArray(days)?days:[days];
    let vacation=0, bond=0;
    list.forEach(day=>{
      if(typeof RDO!=='undefined'&&RDO&&typeof RDO.onVacation==='function'&&RDO.onVacation(employee,day)) vacation++;
      else bond++;
    });
    if(vacation&&bond) return {key:'misto',short:'Indisponível',
      label:'férias e período fora do vínculo'};
    if(vacation) return {key:'ferias',short:'Férias',label:'férias'};
    return {key:'vinculo',short:'Sem vínculo',
      label:'período fora do vínculo (antes da admissão ou após o desligamento)'};
  },
  /* Os dias úteis do período em que o colaborador não conta. */
  offDaysOf(employee,from,to){
    return this.businessDayList(from,to).filter(day=>!this.activeOn(employee,day));
  },
  categoryLabel(category){
    return {disponivel:'Disponível',parcial:'Parcialmente disponível',alocado:'Alocado',
      conflito:'Conflito',indisponivel:'Indisponível'}[category]||'—';
  },
  /* Etiqueta curta para a coluna de nome do Gantt, onde "Parcialmente
     disponível" não cabe sem cortar o nome do colaborador ao lado. */
  categoryTagShort(category,reason){
    const cls={disponivel:'tag-green',parcial:'tag-amber',alocado:'tag-blue',
      conflito:'tag-red',indisponivel:'tag-gray'}[category]||'tag-gray';
    const label={disponivel:'Livre',parcial:'Parcial',alocado:'Alocado',
      conflito:'Conflito',indisponivel:reason||'Indisponível'}[category]||'—';
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
  /* v4.5.1 — `roles` (várias funções) e `pool` (lista de colaboradores) são
     acréscimos opcionais. Sem eles o comportamento é idêntico ao da v4.5.0:
     uma função só e a lista completa. O ranking continua sendo um só. */
  candidates({from,to,role='',minPct=0,onlyRole=true,roles=null,pool=null}={}){
    const wanted=(Array.isArray(roles)&&roles.length?roles:(role?[role]:[]))
      .map(name=>U.norm(name)).filter(Boolean);
    return (Array.isArray(pool)?pool:this.crewMembers())
      .filter(employee=>!wanted.length||!onlyRole||wanted.includes(U.norm(this.employeeRole(employee))))
      .map(employee=>{
        const report=this.availability(employee,from,to);
        return {...report,tier:this.tierOf(report),
          roleMatch:!wanted.length||wanted.includes(U.norm(report.role))};
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
    const people=Array.isArray(crew)?crew:this.planningCrew(from,to);
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
    return CrewPlan.planningCrew(from,to)
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
    const {from:periodFrom,to:periodTo}=this.period();
    $c().innerHTML=`
      <div class="toolbar crewplan-toolbar">
        <div><h2>Planejamento de Colaboradores</h2><small>Mapa futuro da capacidade da equipe: quem está onde, quando fica livre e quem cabe numa obra nova.</small></div>
        <div class="spacer"></div>
        ${canEdit?`<div class="toolbar-actions">
          <button class="btn btn-ghost" onclick="Views.planejamentoequipe.printPlan()"><i data-lucide="printer"></i>PDF do planejamento</button>
          <button class="btn btn-ghost" onclick="Views.planejamentoequipe.findAvailable()"><i data-lucide="search"></i>Encontrar colaboradores disponíveis</button>
          <button class="btn btn-ghost" onclick="Views.planejamentoequipe.form()"><i data-lucide="plus"></i>Nova alocação</button>
          <button class="btn btn-primary" onclick="Views.planejamentoequipe.planNewProject()"><i data-lucide="wand-2"></i>Planejar nova obra</button>
        </div>`:`<div class="toolbar-actions">
          <button class="btn btn-ghost" onclick="Views.planejamentoequipe.printPlan()"><i data-lucide="printer"></i>PDF do planejamento</button>
          <button class="btn btn-ghost" onclick="Views.planejamentoequipe.findAvailable()"><i data-lucide="search"></i>Encontrar colaboradores disponíveis</button>
        </div>`}
      </div>
      <div id="crewplan-kpis"></div>
      <div class="crewplan-filters">
        <div><label for="cp-f-employee">Colaborador</label><select id="cp-f-employee"><option value="">Todos</option>${CrewPlan.planningCrew(periodFrom,periodTo).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR')).map(employee=>`<option value="${U.esc(employee.id)}" ${String(this.filters.employee)===String(employee.id)?'selected':''}>${U.esc(employee.name||'Colaborador')}</option>`).join('')}</select></div>
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
            .map(([key,label])=>`<button class="tab ${this.span===key?'active':''}" data-cp-span="${key}" onclick="Views.planejamentoequipe.setSpan('${key}')">${label}</button>`).join('')}
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
  /* ---------- v4.5.1 — CORREÇÃO DO SELETOR DE PERÍODO ----------
     Até a v4.5.0 o clique fazia `span='week'` e chamava draw(). O draw()
     redesenha os DADOS, mas quem pinta a aba ativa é o render() — então a
     tela mostrava a semana com "Mês" ainda marcado. Corrigido aqui em vez de
     trocar draw() por render(): render() reconstrói os filtros inteiros e
     faria o usuário perder o foco e o scroll a cada troca de período. */
  setSpan(span){
    this.span=span;
    document.querySelectorAll('.crewplan-span [data-cp-span]').forEach(button=>{
      button.classList.toggle('active',button.dataset.cpSpan===span);
    });
    this.draw();
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
    /* v4.5.1 — a escala foi INVERTIDA. Semana cheia é o resultado bom (não há
       custo de ociosidade) e semana vazia é o custo. Verde = cheio, vermelho =
       ocioso. Vale aqui e nas barras da aba Capacidade — e só nelas: no Gantt
       vermelho continua querendo dizer CONFLITO. */
    const teamPct=capacity?Math.round(used/capacity*100):0;
    const fillAccent=pct=>pct>=85?'accent-green':pct>=60?'accent-amber':'accent-red';
    box.innerHTML=`<div class="kpi-grid">
      ${kpi('Colaboradores planejados',planned,`de ${reports.length} em tela`,'','users')}
      ${kpi('Alocados',count('alocado'),'ocupados o período inteiro','accent-blue','briefcase')}
      ${kpi('Ociosos',count('disponivel'),'sem obra no período — custo','accent-red','user-x')}
      ${kpi('Parcialmente ociosos',count('parcial'),'têm dias úteis livres','accent-amber','clock')}
      ${kpi('Com conflito',count('conflito'),'duas obras no mesmo dia','accent-amber','alert-triangle')}
      ${kpi('Capacidade da equipe',`${teamPct}%`,`${used} de ${capacity} dias úteis ocupados`,fillAccent(teamPct),'gauge')}
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
  cellFor(employee,bucket,palette){
    /* v4.5.2 — o retrato saiu daqui para `CrewPlan.bucketState()`, que o PDF
       também consome. O que sobrou nesta função é só o desenho. */
    const state=CrewPlan.bucketState(employee,bucket.days);
    const {active,conflict,offDays,busyDays,total}=state;
    if(conflict){
      const obras=[...new Set(active.map(row=>CrewPlan.projectLabel(row.projectId)))].join(' × ');
      return `<div class="cp-cell cp-conflict" title="Conflito: ${U.esc(obras)}"><span>Conflito</span></div>`;
    }
    if(busyDays){
      /* v4.5.1 — a cor saiu da obra e virou SITUAÇÃO. v4.5.4 — volta a ser a
         obra: um Gantt todo azul não deixa ver que dois colaboradores estão em
         obras DIFERENTES. O que não volta é a FONTE da cor — agora ela sai de
         `CrewPlan.projectPalette`, presa ao ID da obra, e não do helper por
         posição do `js/app.js` que a v4.5.1 tirou daqui.
         ⚠ Conflito e férias continuam com cor de ESTADO: são exceção e têm de
         saltar por cima da cor da obra. Sem `palette` (chamada de duas vias), a
         classe sai vazia e a célula volta ao azul da v4.5.1. */
      const first=active[0]||{};
      const label=CrewPlan.projectLabel(first.projectId);
      const obras=[...new Set(active.map(row=>CrewPlan.projectLabel(row.projectId)))].join(' · ');
      const partial=state.partial;
      const done=state.done;
      /* ⚠ Uma coluna de SEMANA pode conter duas obras sem se sobrepor (obra A na
         segunda, obra B na quinta). Não é conflito — mas a célula tem UMA cor
         só, então o "+N" avisa que a cor conta só parte da história. */
      const extra=new Set(active.map(row=>String(row.projectId))).size-1;
      const classes=['cp-cell','cp-busy',CrewPlan.paletteClass(first.projectId,palette,'cp-obra'),
        partial?'cp-partial':'',done?'cp-done':''].filter(Boolean).join(' ');
      return `<div class="${classes}"
        title="${U.esc(obras||label)} — ${busyDays} de ${total} dia(s) útil(eis)${offDays?` · ${offDays} indisponível(eis)`:''}${partial?' · parcial':''}"
        onclick="Views.planejamentoequipe.dayDetail(${U.jsArg(employee.id)},${U.jsArg(bucket.days[0])},${U.jsArg(bucket.days[bucket.days.length-1])})"><span>${U.esc(label)}${extra>0?` +${extra}`:''}</span></div>`;
    }
    if(offDays===total){
      const reason=CrewPlan.offReason(employee,state.offList);
      return `<div class="cp-cell cp-off" title="Não conta: ${U.esc(reason.label)}"><span>${U.esc(reason.short)}</span></div>`;
    }
    // Célula livre fica VAZIA de propósito: o objetivo declarado do Gantt é
    // "tornar visualmente evidente os espaços vagos da equipe" — escrever
    // "Disponível" 200 vezes esconde justamente o que é para saltar aos olhos.
    return `<div class="cp-cell cp-free" title="Disponível · ${total-offDays} dia(s) útil(eis) livre(s)"></div>`;
  },
  timelineMarkup(){
    const {from,to}=this.period();
    const buckets=this.buckets();
    const crew=this.crew();
    const palette=this.planPalette();
    if(!buckets.list.length)
      return '<div class="empty card"><i data-lucide="calendar-days"></i><br>O período selecionado não tem nenhum dia útil.</div>';
    if(!crew.length)
      return '<div class="empty card"><i data-lucide="users"></i><br>Nenhum colaborador atende aos filtros selecionados.</div>';
    const head=buckets.list.map(bucket=>`<div class="cp-col-head"><b>${U.esc(bucket.label)}</b><small>${U.esc(bucket.sub||'')}</small></div>`).join('');
    const rows=crew.map(employee=>{
      const report=CrewPlan.availability(employee,from,to);
      const reason=report.offDays
        ?CrewPlan.offReason(employee,CrewPlan.offDaysOf(employee,from,to)).short:'';
      return `<div class="cp-row">
        <div class="cp-name">
          <b>${U.esc(employee.name||'Colaborador')}</b>
          <span class="cp-name-sub"><small>${U.esc(CrewPlan.employeeRole(employee)||'Sem função')}</small>${CrewPlan.categoryTagShort(report.category,reason)}</span>
        </div>
        <div class="cp-track" style="grid-template-columns:repeat(${buckets.list.length},minmax(${buckets.kind==='day'?72:96}px,1fr))">
          ${buckets.list.map(bucket=>this.cellFor(employee,bucket,palette)).join('')}
        </div>
      </div>`;
    }).join('');
    const cards=crew.map(employee=>this.mobileCard(employee,from,to)).join('');
    return `<div class="card cp-gantt">
      <div class="cp-legend">
        <span><i class="cp-chip cp-free"></i>Livre</span>
        <span><i class="cp-chip cp-chip-partial"></i>Parcial (contorno tracejado)</span>
        <span><i class="cp-chip cp-conflict"></i>Conflito</span>
        <span><i class="cp-chip cp-off"></i>Férias / sem vínculo</span>
        <small>Somente dias úteis (seg–sex). Sábados e domingos não consomem capacidade.</small>
      </div>
      ${palette.size?`<div class="cp-legend cp-legend-keys"><b>Obras:</b> ${this.projectKeyMarkup(palette,'cp-obra')}</div>`:''}
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
    const blocks=report.allocations.map(row=>`<div class="cp-card-block">
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
      ?`<div class="cp-card-off"><i data-lucide="calendar-clock"></i>${report.offDays} dia(s) útil(eis) em ${U.esc(CrewPlan.offReason(employee,CrewPlan.offDaysOf(employee,from,to)).label)}</div>`
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

  /* ---------- v4.5.1 — PDF DO PLANEJAMENTO ----------
     Agrupado por OBRA porque é assim que a informação é repassada no grupo:
     "quem vai para qual obra, em que dia". Fecha com o resumo por colaborador,
     para conferir a carga de uma pessoa só.
     ⚠ Passa pelo pipeline único de impressão (Exports.beginPrint). NUNCA
     registrar afterprint direto aqui — foi o bug do PDF da v4.2.7. */
  planRows(){
    const {from,to}=this.period();
    const ids=new Set(this.crew().map(employee=>String(employee.id)));
    const statuses=this.filters.status
      ?[this.filters.status]
      :CrewPlan.statuses.filter(status=>status!=='Cancelado');
    return CrewPlan.all()
      .filter(row=>CrewPlan.valid(row))
      .map(row=>CrewPlan.normalize(row))
      .filter(row=>ids.has(row.employeeId))
      .filter(row=>statuses.includes(row.status))
      .filter(row=>CrewPlan.overlaps(row.start,row.end,from,to))
      .filter(row=>!this.filters.project||row.projectId===String(this.filters.project))
      .sort((a,b)=>a.start.localeCompare(b.start)
        ||CrewPlan.employeeName(a.employeeId).localeCompare(CrewPlan.employeeName(b.employeeId),'pt-BR'));
  },
  /* ---------- v4.5.4 — A PALETA DO PERIODO ----------
     Uma porta so' para a tela e para o papel. Se cada lado montasse a paleta a
     partir de uma lista propria, a mesma obra sairia de uma cor na tela e de
     outra no PDF — que e' exatamente o problema que a cor veio resolver. */
  planPalette(rows){
    return CrewPlan.projectPalette((rows||this.planRows()).map(row=>row.projectId));
  },
  /* A traducao dos codigos. Sem ela a cor e' enfeite: quem le' ve' oito cores e
     nao sabe qual e' qual. `prefix` separa a tela (`cp-obra`) do papel
     (`cpg-obra`), que tem CSS proprio dentro do `@media print`. */
  projectKeyMarkup(palette,prefix){
    return [...palette.keys()]
      .sort((a,b)=>CrewPlan.projectLabel(a).localeCompare(CrewPlan.projectLabel(b),'pt-BR'))
      .map(id=>{
        const full=String(CrewPlan.projectLabel(id)||'');
        const rest=full.includes('|')?full.split('|').slice(1).join('|').trim():full;
        return `<i class="${prefix}-key ${CrewPlan.paletteClass(id,palette,prefix)}">${U.esc(CrewPlan.projectShort(id))}</i> ${U.esc(rest||full)}`;
      }).join(' \u00b7 ');
  },
  /* ---------- v4.5.2 — COLUNAS DO GANTT IMPRESSO ----------
     O papel em PAISAGEM é mais generoso que a coluna da tela: A4 deitado com
     margem de 9 mm dá 279 mm úteis, então um mês inteiro (22 dias úteis) cabe
     DIA A DIA. Na tela o limite é 10 dias porque a coluna concorre com o menu
     lateral e com o celular. Mesma regra de agrupamento, limite diferente —
     por isso é função nova ao lado de `buckets()`, e não um parâmetro nela. */
  printBuckets(){
    const {from,to}=this.period();
    const days=CrewPlan.businessDayList(from,to);
    if(!days.length) return {kind:'none',list:[]};
    if(days.length<=31) return {kind:'day',list:days.map(day=>({key:day,days:[day],
      label:String(day).slice(8,10),
      sub:['dom','seg','ter','qua','qui','sex','sáb'][CrewPlan.weekday(day)]}))};
    const grouped=new Map();
    const monthly=days.length>140;
    days.forEach(day=>{
      const key=monthly?String(day).slice(0,7):(CrewPlan.weekStart(day)||day);
      if(!grouped.has(key)) grouped.set(key,[]);
      grouped.get(key).push(day);
    });
    return {kind:monthly?'month':'week',
      list:[...grouped.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([key,list],index)=>{
        const first=list[0], last=list[list.length-1];
        return {key,days:list,
          label:monthly
            ?new Date(`${key}-01T00:00:00Z`).toLocaleDateString('pt-BR',{month:'short',timeZone:'UTC'})
            :`SEM ${index+1}`,
          sub:monthly?String(key).slice(0,4)
            :`${String(first).slice(8,10)}–${String(last).slice(8,10)}`};
      })};
  },
  /* ---------- v4.5.4 — O PLANEJAMENTO INTEIRO EM UMA FOLHA ----------
     A altura da linha deixa de ser fixa e passa a ser CALCULADA a partir de
     quantos colaboradores o filtro deixou entrar. A4 deitado com margem de
     9 mm dá 279 × 192 mm; descontando cabeçalho, legenda, cabeçalho da tabela
     e rodapé, o que sobra é dividido pelo número de linhas.
     ⚠ Com um PISO de 3,2 mm (fonte ~4,6 px): abaixo disso o papel não se lê
     mais, e um PDF ilegível é pior que um PDF de duas folhas. Chegando ao
     piso, a tabela quebra para a folha seguinte repetindo as datas
     (`thead{display:table-header-group}`), e `fits` fica falso para quem
     quiser avisar na tela.
     ⚠ Tudo em milímetros de PAPEL, não em pixels de tela: a folha é a única
     medida que não muda com o zoom do navegador nem com o monitor. */
  printMetrics(input){
    const options=input||{};
    const rows=Math.max(1,Number(options.rows)||1);
    const cols=Math.max(1,Number(options.cols)||1);
    const projects=Math.max(0,Number(options.projects)||0);
    const pageH=192, pageW=279;
    /* A legenda quebra linha conforme o nome das obras: ~290 caracteres por
       linha a 6,6 px, e o bloco fixo de estados já come uns 110. */
    /* ⚠ Quantas linhas a legenda ocupa depende do TAMANHO DOS NOMES das obras,
       não da quantidade: "FORNECIMENTO DE MÃO DE OBRA PARA COMPOSIÇÃO PIE" vale
       por três obras curtas. Quando `printPlan` manda `legendChars` (o texto de
       verdade), usa-se ele; o palpite por obra fica só para quem chamar sem. */
    const legendChars=Number(options.legendChars)||projects*34;
    const legendLines=Math.min(4,Math.max(1,Math.ceil((120+legendChars)/270)));
    /* Medidos no Chromium, em mm de PAPEL (não estimados): cabeçalho 7,9; aviso
       de conflito 5,5 + 1,1 de margem; cada linha de legenda 3,6; cabeçalho da
       tabela 5,1; rodapé 3,5 + 2,7 de margem; respiro do gráfico 1,1.
       ⚠ Mais 3 mm de FOLGA: fonte substituta, DPI da impressora e o
       arredondamento do próprio navegador cabem aí. Sem a folga o cálculo acerta
       na trave e uma única linha vai para a folha 2 — que foi o que medi. */
    const reserved=7.9+legendLines*3.6+(options.alert?6.6:0)+5.1+6.2+1.1+3;
    const usable=pageH-reserved;
    /* ⚠ Arredondar a altura da linha para BAIXO, não para o mais próximo: em
       40 linhas, meio centésimo a mais em cada uma soma o suficiente para
       empurrar a última para a folha 2. O lado seguro do arredondamento aqui
       é sobrar milímetro, nunca faltar. `fits` usa o MESMO valor arredondado
       que vai para o CSS, senão os dois discordariam na fronteira. */
    const floor2=value=>Math.floor(value*100)/100;
    const rowMm=floor2(Math.min(6.4,Math.max(3.2,usable/rows)));
    const nameMm=cols<=12?48:cols<=18?42:cols<=24?36:30;
    const nameFont=Math.min(7.2,Math.max(5,rowMm*1.45));
    const round=value=>Math.round(value*100)/100;
    return {
      rows,cols,usable:round(usable),
      fits:rows*rowMm<=usable,
      tight:rowMm<4.3,
      rowMm,
      nameMm,
      colMm:round((pageW-nameMm)/cols),
      cellFont:round(Math.min(6.6,Math.max(4.6,rowMm*1.32))),
      nameFont:round(nameFont),
      roleFont:round(nameFont*0.78)
    };
  },
  /* A célula do Gantt impresso. Mesmo retrato da tela (`CrewPlan.bucketState`),
     markup próprio: `<td>` em vez de `<div>`, sem onclick, e o texto carrega a
     informação para o caso de sair impresso em preto e branco — o código da
     obra, "!" no conflito, "//" fora do vínculo. A borda também sobrevive:
     o Chrome só descarta o FUNDO quando "Gráficos de plano de fundo" está
     desmarcado, nunca a borda nem a cor do texto. */
  printCell(employee,bucket,palette){
    const state=CrewPlan.bucketState(employee,bucket.days);
    if(state.conflict)
      return `<td class="cpg-cell cpg-conflict" title="Conflito">!</td>`;
    if(state.busyDays){
      const first=(state.active[0]||{});
      const code=CrewPlan.projectShort(first.projectId);
      /* v4.5.4 — a cor da obra entra como CLASSE, ao lado de `cpg-alloc`. Sem
         paleta a classe sai vazia e a célula fica azul, como na v4.5.2.
         O código da obra continua no texto: e' ele que salva a leitura quando
         o Chrome imprime sem "Gráficos de plano de fundo". */
      const obras=new Set(state.active.map(row=>String(row.projectId)));
      /* ⚠ `filter(Boolean)`: sem paleta a classe da obra sai vazia, e um
         `class="cpg-cell cpg-alloc "` com espaço sobrando quebraria a
         asserção do `crew-print-gantt` sobre o caminho SEM paleta. */
      const classes=['cpg-cell',state.partial?'cpg-partial':'cpg-alloc',
        CrewPlan.paletteClass(first.projectId,palette,'cpg-obra')].filter(Boolean).join(' ');
      return `<td class="${classes}"${obras.size>1?` title="${U.esc([...new Set(state.active.map(row=>CrewPlan.projectLabel(row.projectId)))].join(' · '))}"`:''}>${U.esc(code)}${obras.size>1?'+':''}</td>`;
    }
    if(state.offDays===state.total)
      return `<td class="cpg-cell cpg-off">//</td>`;
    return `<td class="cpg-cell"></td>`;
  },
  async printPlan(){
    const {from,to}=this.period();
    const rows=this.planRows();
    if(!rows.length)
      return UI.toast('Não há alocação no período e nos filtros selecionados para gerar o PDF.','warn',5600);
    const crew=this.crew();
    /* v4.5.4 — a paleta sai da MESMA porta que a tela usa. */
    const palette=this.planPalette(rows);
    /* Um PDF que manda a mesma pessoa para duas obras no mesmo dia sem avisar é
       pior que PDF nenhum: quem lê no grupo não tem como perceber. */
    const conflicted=new Set();
    rows.forEach(row=>{
      const clash=CrewPlan.conflictsFor({employeeId:row.employeeId,start:row.start,
        end:row.end,excludeId:row.id})
        .filter(other=>CrewPlan.overlaps(other.start,other.end,from,to));
      if(clash.length) conflicted.add(row.id);
    });
    const old=document.getElementById('crewplan-print-report');
    if(old) old.remove();
    const report=document.createElement('section');
    report.id='crewplan-print-report';
    const companyLogo=U.safeImageSrc(State.settings.companyLogo)||'assets/logo-clique.png';
    const companyCnpj=U.formatCnpj(State.settings.companyCnpj||'');
    const totalDays=CrewPlan.businessDays(from,to);
    const buckets=this.printBuckets();
    /* v4.5.4 — saíram do PDF os quatro KPIs, o detalhe por obra e o resumo por
       colaborador. O pedido foi "apenas o planejamento em si, em uma folha só";
       as três seções ocupavam da folha 2 em diante e disputavam o espaço que
       agora é do gráfico. O que sobrou do cabeçalho é uma linha: sem empresa,
       período e data, o PDF que circula no grupo não diz de que semana é. */
    const legendChars=[...palette.keys()]
      .reduce((soma,id)=>soma+String(CrewPlan.projectLabel(id)||'').length+4,0);
    const metrics=this.printMetrics({rows:crew.length,cols:buckets.list.length,
      projects:palette.size,legendChars,alert:conflicted.size>0});
    if(metrics.tight) report.classList.add('cpg-tight');
    report.style.setProperty('--cpg-row',`${metrics.rowMm}mm`);
    report.style.setProperty('--cpg-name',`${metrics.nameMm}mm`);
    report.style.setProperty('--cpg-cell-font',`${metrics.cellFont}px`);
    report.style.setProperty('--cpg-name-font',`${metrics.nameFont}px`);
    report.style.setProperty('--cpg-role-font',`${metrics.roleFont}px`);
    report.innerHTML=`${typeof Exports!=='undefined'?Exports.stationeryMarkup():''}
      <header class="crewplan-print-head">
        <div class="crewplan-print-company"><img src="${U.esc(companyLogo)}" alt=""><div><b>${U.esc(State.settings.companyName||'CliqueObras')}</b><span>${companyCnpj?`CNPJ ${U.esc(companyCnpj)} · `:''}Planejamento de colaboradores</span></div></div>
        <div class="crewplan-print-period"><b>${U.date(from)} → ${U.date(to)}</b><span>${totalDays} dia(s) útil(eis) · ${crew.length} colaborador(es) · ${palette.size} obra(s) · emitido em ${new Date().toLocaleDateString('pt-BR')}</span></div>
      </header>
      ${conflicted.size?`<p class="crewplan-print-alert"><b>⚠ ${conflicted.size} alocação(ões) em conflito.</b> O mesmo colaborador aparece em duas obras no mesmo dia — as células marcadas com <b>!</b> precisam ser resolvidas antes de valer como escala.</p>`:''}
      ${(()=>{
        if(!buckets.list.length||!crew.length) return '';
        return `<section class="crewplan-print-chart">
          <div class="crewplan-print-legend">
            <span><i class="cpg-chip cpg-partial"></i>Parcial (contorno tracejado)</span>
            <span><i class="cpg-chip cpg-conflict"></i>Conflito (!)</span>
            <span><i class="cpg-chip cpg-off"></i>Férias / sem vínculo (//)</span>
            <span><i class="cpg-chip"></i>Livre</span>
            <span class="cpg-keys"><b>Obras:</b> ${this.projectKeyMarkup(palette,'cpg-obra')}</span>
          </div>
          <table class="crewplan-print-gantt">
            <thead>
              <tr><th class="cpg-name" rowspan="2">Colaborador</th>${buckets.list.map(bucket=>`<th>${U.esc(bucket.label)}</th>`).join('')}</tr>
              <tr>${buckets.list.map(bucket=>`<th class="cpg-sub">${U.esc(bucket.sub||'')}</th>`).join('')}</tr>
            </thead>
            <tbody>${crew.map(employee=>`<tr>
              <th class="cpg-name"><b>${U.esc(employee.name||'Colaborador')}</b><small>${U.esc(CrewPlan.employeeRole(employee)||'Sem função')}</small></th>
              ${buckets.list.map(bucket=>this.printCell(employee,bucket,palette)).join('')}
            </tr>`).join('')}</tbody>
          </table>
        </section>`;
      })()}
      <footer>Somente dias úteis (seg–sex). Linha sem nenhuma célula colorida = colaborador ocioso no período. Para as cores das obras saírem no papel, marque <b>“Gráficos de plano de fundo”</b> na janela de impressão — sem isso, o contorno e o código da obra continuam legíveis em preto e branco.</footer>`;
    document.body.appendChild(report);
    UI.toast('Na janela de impressão, selecione “Salvar como PDF”.','info',6000);
    await Exports.beginPrint('printing-crewplan',report);
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
      <small class="cp-muted">Percentual dos dias úteis da equipe já comprometidos com obras planejadas. <b>Verde = semana cheia</b> (sem custo de ociosidade); <b>vermelho = semana vazia</b> (dias pagos sem obra). Dias de férias, antes da admissão e após o desligamento saem da conta.</small>
      <div class="cp-capacity">
        ${buckets.map((bucket,index)=>`<div class="cp-capacity-row">
          <span class="cp-capacity-label"><b>Semana ${index+1}</b><small>${U.date(bucket.days[0])} → ${U.date(bucket.days[bucket.days.length-1])}</small></span>
          <div class="cp-bar big"><div class="cp-bar-fill ${bucket.pct>=85?'ok':bucket.pct>=60?'warn':'crit'}" style="width:${Math.max(2,bucket.pct)}%"></div></div>
          <b class="cp-capacity-pct">${bucket.pct}%</b>
          <small class="cp-capacity-sub">${bucket.used}/${bucket.capacity} dias ocupados · <b>${bucket.idle}</b> dia(s) ocioso(s)</small>
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
    const crew=CrewPlan.planningCrew(row.start,row.end).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
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
    let list=CrewPlan.candidates({from,to,role,minPct,pool:CrewPlan.planningCrew(from,to)});
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
      /* v4.5.1 — o atalho de família marca (ou desmarca) todos os níveis de uma
         vez: "Eletricista · todos" cobre I, II, I A e II A com um clique. */
      document.querySelectorAll('.cp-role-family').forEach(button=>{
        button.onclick=()=>{
          const wanted=String(button.dataset.family||'').split('|')
            .map(name=>U.norm(name)).filter(Boolean);
          const boxes=[...document.querySelectorAll('.cp-wz-role')]
            .filter(box=>wanted.includes(U.norm(box.value)));
          const target=!boxes.every(box=>box.checked);
          boxes.forEach(box=>{ box.checked=target; });
          const label=document.getElementById('cp-wz-picked');
          if(label) label.textContent=`${[...document.querySelectorAll('.cp-wz-role')].filter(box=>box.checked).length} função(ões) marcada(s)`;
        };
      });
      document.querySelectorAll('.cp-wz-role').forEach(box=>{
        box.onchange=()=>{
          const label=document.getElementById('cp-wz-picked');
          if(label) label.textContent=`${[...document.querySelectorAll('.cp-wz-role')].filter(item=>item.checked).length} função(ões) marcada(s)`;
        };
      });
      const add=document.getElementById('cp-wz-add-role');
      if(add) add.onclick=()=>{
        const roles=[...document.querySelectorAll('.cp-wz-role')]
          .filter(box=>box.checked).map(box=>box.value);
        const qty=Math.max(1,Math.floor(Number(document.getElementById('cp-wz-qty').value)||0));
        if(!roles.length) return UI.toast('Marque pelo menos uma função.','warn');
        const key=roles.map(name=>U.norm(name)).sort().join('|');
        if(this.wizard.needs.some(need=>need.key===key))
          return UI.toast('Essa combinação de funções já está na lista. Altere a quantidade.','warn',5200);
        this.wizard.needs.push({key,label:roles.join(' + '),roles,qty});
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
  /* ETAPA 2 — necessidade da equipe.
     v4.5.1 — uma necessidade aceita VÁRIAS funções. O cadastro tem Eletricista
     I, II, I A e II A e a obra pede "5 eletricistas", não "5 de cada nível".
     Marcando os quatro, os 5 saem de qualquer um deles. */
  wizardStep2(){
    const wizard=this.wizard;
    const total=wizard.needs.reduce((sum,need)=>sum+need.qty,0);
    const families=CrewPlan.roleFamilies();
    const pool=CrewPlan.planningCrew(wizard.start,wizard.end);
    const countOf=roles=>pool.filter(employee=>roles
      .some(role=>U.norm(role)===U.norm(CrewPlan.employeeRole(employee)))).length;
    const names=CrewPlan.roleNames();
    return `<p class="cp-muted">Obra <b>${U.esc(CrewPlan.projectLabel(wizard.projectId))}</b> · ${U.date(wizard.start)} → ${U.date(wizard.end)} · <b>${CrewPlan.businessDays(wizard.start,wizard.end)}</b> dia(s) útil(eis).</p>
      <div class="cp-need-form">
        <div class="cp-role-pick">
          <label>Função(ões) <small>marque quantas quiser</small></label>
          ${families.length?`<div class="cp-role-families">${families.map(family=>`<button type="button" class="cp-role-family" data-family="${U.esc(family.roles.join('|'))}"><i data-lucide="layers"></i>${U.esc(family.name)} · todos (${family.roles.length})</button>`).join('')}</div>`:''}
          <div class="cp-role-list">${names.map(name=>`<label class="cp-role-option"><input type="checkbox" class="cp-wz-role" value="${U.esc(name)}"><span>${U.esc(name)}</span><small>${countOf([name])}</small></label>`).join('')||'<div class="empty">Nenhuma função cadastrada.</div>'}</div>
          <small class="cp-muted" id="cp-wz-picked">0 função(ões) marcada(s)</small>
        </div>
        <div class="cp-need-qty">
          <label for="cp-wz-qty">Quantidade</label>
          <input id="cp-wz-qty" type="number" min="1" step="1" value="1">
          <button class="btn btn-ghost" type="button" id="cp-wz-add-role"><i data-lucide="plus"></i>Adicionar necessidade</button>
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Necessidade</th><th class="num" style="width:130px">Quantidade</th><th style="width:60px"></th></tr></thead>
        <tbody>${wizard.needs.map((need,index)=>`<tr>
          <td><b>${U.esc(need.label)}</b><br><small class="cp-muted">${countOf(need.roles)} colaborador(es) ativo(s) com ${need.roles.length>1?'alguma dessas funções':'essa função'}</small></td>
          <td class="num"><input type="number" min="1" step="1" value="${need.qty}" data-need-qty="${index}" style="max-width:90px;text-align:right"></td>
          <td><button class="btn btn-ghost btn-sm" type="button" data-need-remove="${index}" aria-label="Remover necessidade"><i data-lucide="trash-2"></i></button></td>
        </tr>`).join('')||'<tr><td colspan="3"><div class="empty">Nenhuma necessidade informada ainda.</div></td></tr>'}</tbody>
        ${total?`<tfoot><tr><th>Equipe necessária</th><th class="num">${total}</th><th></th></tr></tfoot>`:''}
      </table></div>
      <small class="cp-muted">As funções vêm do cadastro de Funções dos colaboradores — o assistente não cria estrutura paralela. A contagem considera somente colaboradores ativos com vínculo no período.</small>`;
  },
  /* ETAPAS 12 a 15 — análise, sugestão, montagem e déficit */
  wizardStep3(){
    const wizard=this.wizard;
    const {start,end}=wizard;
    const marks={1:'✓',2:'◐',4:'⚠',5:'✕'};
    const pool=CrewPlan.planningCrew(start,end);
    const blocks=wizard.needs.map(need=>{
      const picked=new Set(wizard.selection[need.key]||[]);
      const list=CrewPlan.candidates({from:start,to:end,roles:need.roles,pool});
      const found=picked.size;
      return `<div class="cp-need-block">
        <div class="cp-need-head"><b>${U.esc(need.label)}</b>
          <span class="tag ${found>=need.qty?'tag-green':'tag-amber'}">${found} de ${need.qty} selecionado(s)</span></div>
        ${list.map(report=>{
          const id=String(report.employeeId);
          const disabled=report.pct<=0&&report.tier>=5;
          return `<label class="cp-candidate ${picked.has(id)?'picked':''} ${disabled?'off':''}">
            <input type="checkbox" data-pick="${U.esc(need.key)}" data-employee="${U.esc(id)}" ${picked.has(id)?'checked':''} ${disabled?'disabled':''}>
            <span class="cp-candidate-mark">${marks[report.tier]||'◐'}</span>
            <span class="cp-candidate-main"><b>${U.esc(report.employee.name||'Colaborador')}</b>${need.roles.length>1?`<small class="cp-candidate-role">${U.esc(report.role||'Sem função')}</small>`:''}
              <small>${report.pct}% disponível · ${report.freeDays} de ${report.totalDays} dia(s) útil(eis) livre(s)${report.offDays?` · ${report.offDays} dia(s) sem disponibilidade`:''}</small>
              <small>${report.allocations.length?report.allocations.map(row=>`${U.esc(CrewPlan.projectLabel(row.projectId))} até ${U.date(row.end)}`).join(' · '):'Nenhuma obra planejada no período'}</small></span>
            ${CrewPlan.categoryTag(report.category)}
          </label>`;
        }).join('')||`<div class="empty">Nenhum colaborador ativo com ${need.roles.length>1?'alguma dessas funções':'essa função'} no período.</div>`}
      </div>`;
    }).join('');
    return `<p class="cp-muted">O sistema apenas sugere: a decisão final de alocação continua com o gestor. Colaboradores com conflito aparecem marcados com ⚠ e os sem nenhum dia livre ficam desabilitados.</p>
      ${blocks||'<div class="empty">Volte à etapa anterior e informe pelo menos uma função.</div>'}
      ${this.coverageMarkup()}`;
  },
  coverageMarkup(){
    const wizard=this.wizard;
    const needed=wizard.needs.reduce((sum,need)=>sum+need.qty,0);
    const selected=wizard.needs.reduce((sum,need)=>sum+(wizard.selection[need.key]||[]).length,0);
    const gaps=wizard.needs.filter(need=>(wizard.selection[need.key]||[]).length<need.qty);
    return `<div class="cp-coverage">
      <div><small>Equipe necessária</small><b>${needed}</b></div>
      <div><small>Equipe selecionada</small><b>${selected}</b></div>
      <div><small>Cobertura</small><b class="${needed&&selected>=needed?'ok':'warn'}">${needed?Math.round(Math.min(selected,needed)/needed*100):0}%</b></div>
    </div>
    ${gaps.length?`<div class="cp-gap"><b><i data-lucide="alert-triangle"></i> Não existem colaboradores suficientes selecionados para atender integralmente a equipe necessária nesse período.</b>
      <table class="cp-gap-table"><tbody>${wizard.needs.map(need=>{
        const found=(wizard.selection[need.key]||[]).length;
        return `<tr><td>${U.esc(need.label)}</td><td class="num">${need.qty} necessário(s)</td><td class="num">${found} encontrado(s)</td><td>${found>=need.qty?'<span class="tag tag-green">✓</span>':'<span class="tag tag-amber">⚠</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>`:''}`;
  },
  /* ETAPA 16 — prévia. Nada foi gravado até aqui. */
  wizardPreviewRows(){
    const wizard=this.wizard;
    const rows=[];
    /* v4.5.1 — com várias funções por necessidade o mesmo colaborador pode ser
       marcado em duas necessidades. Uma alocação por pessoa, sempre. A função
       gravada é a DELE, não o rótulo combinado da necessidade. */
    const seen=new Set();
    wizard.needs.forEach(need=>{
      (wizard.selection[need.key]||[]).forEach(employeeId=>{
        const id=String(employeeId);
        if(seen.has(id)) return;
        const employee=CrewPlan.crewMembers().find(item=>String(item.id)===id);
        if(!employee) return;
        seen.add(id);
        const report=CrewPlan.availability(employee,wizard.start,wizard.end);
        rows.push({employee,role:CrewPlan.employeeRole(employee)||need.label,report});
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
