/**
 * v4.5.18 - RH do colaborador: integrações em clientes, ASO, EPIs e ocorrências.
 *
 * Onde ficam os dados: dentro do próprio registro do colaborador (store 'crew'),
 * como já acontece com as férias (crew.vacations). Campo novo em store existente
 * não exige mudança no banco, nem nas permissões, nem na sincronização:
 *   crew.clientIntegrations = [{id,clientId,clientName,unit,onboardingDate,renewalDate}]
 *   crew.asos               = [{id,type,examDate,expiryDate,result}]
 *   crew.ppe                = [{id,item,ca,quantity,receivedDate,renewalDate}]
 *   crew.occurrences        = [{id,date,type,description}]
 * Datas sempre em AAAA-MM-DD.
 *
 * Vencimentos: vale só o registro MAIS RECENTE de cada coisa (o último ASO, a
 * última integração de cada cliente/unidade, a última entrega de cada EPI). Os
 * anteriores ficam como histórico ("Substituído") e não geram alerta. Só gera
 * alerta colaborador que ainda está na empresa.
 */
const CrewHR = {
  ALERT_DAYS:30,
  ASO_TYPES:['Admissional','Periódico','Retorno ao trabalho','Mudança de risco','Demissional'],
  ASO_RESULTS:['Apto','Apto com restrição','Inapto'],
  // v4.5.20 - atestado tem controle proprio (aba RH, por periodo).
  OCCURRENCE_TYPES:['Advertência','Suspensão','Falta','Acidente / incidente','Treinamento','Elogio','Outro'],
  PPE_SUGGESTIONS:['Capacete de segurança','Óculos de proteção','Protetor auricular','Luva de vaqueta','Luva isolante','Botina de segurança','Cinto de segurança tipo paraquedista','Talabarte','Vestimenta antichama','Uniforme','Máscara PFF2','Protetor facial','Perneira','Creme de proteção solar'],

  // v4.5.19 - CPF do colaborador (crew.cpf, gravado como 000.000.000-00).
  cpfDigits(value){ return String(value??'').replace(/\D/g,'').slice(0,11); },
  formatCpf(value){
    const d=this.cpfDigits(value);
    if(d.length<=3) return d;
    if(d.length<=6) return `${d.slice(0,3)}.${d.slice(3)}`;
    if(d.length<=9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  },
  validCpf(value){
    const d=this.cpfDigits(value);
    if(d.length!==11||/^(\d)\1{10}$/.test(d)) return false;
    const digit=length=>{
      let sum=0;
      for(let i=0;i<length;i++) sum+=Number(d[i])*(length+1-i);
      const rest=(sum*10)%11;
      return rest===10?0:rest;
    };
    return digit(9)===Number(d[9])&&digit(10)===Number(d[10]);
  },

  validDate(value){
    const day=String(value||'').slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day)?day:'';
  },
  today(){
    return typeof U!=='undefined'&&typeof U.isoDate==='function'?U.isoDate(new Date()):new Date().toISOString().slice(0,10);
  },
  daysBetween(from,to){
    const a=this.validDate(from),b=this.validDate(to);
    if(!a||!b) return null;
    return Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000);
  },
  norm(value){
    return String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  },
  text(value,max){ return String(value??'').replace(/\s+/g,' ').trim().slice(0,max); },
  newId(){ return typeof U!=='undefined'&&typeof U.id==='function'?U.id():`hr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; },

  // Lê o que estiver gravado e devolve listas limpas (lixo e datas inválidas saem).
  normalize(employee){
    const list=key=>Array.isArray(employee&&employee[key])?employee[key].filter(item=>item&&typeof item==='object'):[];
    return {
      clientIntegrations:list('clientIntegrations').map(item=>({
        id:String(item.id||this.newId()),
        clientId:this.text(item.clientId,120),
        clientName:this.text(item.clientName,160),
        unit:this.text(item.unit,120),
        onboardingDate:this.validDate(item.onboardingDate),
        renewalDate:this.validDate(item.renewalDate)
      })).filter(item=>(item.clientId||item.clientName)&&item.onboardingDate),
      asos:list('asos').map(item=>({
        id:String(item.id||this.newId()),
        type:this.text(item.type,60)||'Periódico',
        examDate:this.validDate(item.examDate),
        expiryDate:this.validDate(item.expiryDate),
        result:this.text(item.result,40)||'Apto'
      })).filter(item=>item.examDate),
      ppe:list('ppe').map(item=>({
        id:String(item.id||this.newId()),
        item:this.text(item.item,120),
        ca:this.text(item.ca,30),
        quantity:Math.max(1,Math.min(9999,Math.round(Number(item.quantity)||1))),
        receivedDate:this.validDate(item.receivedDate),
        renewalDate:this.validDate(item.renewalDate)
      })).filter(item=>item.item&&item.receivedDate),
      medicalLeaves:list('medicalLeaves').map(item=>({
        id:String(item.id||this.newId()),
        from:this.validDate(item.from),
        to:this.validDate(item.to),
        notes:this.text(item.notes,300)
      })).filter(item=>item.from&&item.to&&item.from<=item.to),
      occurrences:list('occurrences').map(item=>({
        id:String(item.id||this.newId()),
        date:this.validDate(item.date),
        type:this.text(item.type,60)||'Outro',
        description:String(item.description??'').trim().slice(0,1000)
      })).filter(item=>item.date)
    };
  },
  // O que vai para o banco (mesmo formato do normalize, sem campos de tela).
  serialize(hr){
    const clean=this.normalize(hr||{});
    return {
      clientIntegrations:clean.clientIntegrations,
      asos:clean.asos,
      ppe:clean.ppe,
      medicalLeaves:clean.medicalLeaves,
      occurrences:clean.occurrences
    };
  },

  // Clientes vêm do cadastro de Clientes. Se o usuário não enxerga Clientes,
  // usa os clientes dos projetos que ele enxerga.
  clientOptions(){
    const options=new Map();
    const add=(id,name)=>{
      const label=this.text(name,160);
      if(!label) return;
      const key=this.norm(label);
      if(!options.has(key)) options.set(key,{id:String(id||`nome:${key}`),name:label});
    };
    const state=typeof State!=='undefined'?State:{};
    (Array.isArray(state.clients)?state.clients:[]).forEach(client=>add(client.id,client.name));
    (Array.isArray(state.projects)?state.projects:[]).forEach(project=>add('',project.client));
    return [...options.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  },
  clientName(item){
    const state=typeof State!=='undefined'?State:{};
    const client=(Array.isArray(state.clients)?state.clients:[]).find(row=>String(row.id)===String(item&&item.clientId));
    return client&&client.name||item&&item.clientName||'Cliente';
  },
  clientKey(item){
    const state=typeof State!=='undefined'?State:{};
    const client=(Array.isArray(state.clients)?state.clients:[]).find(row=>String(row.id)===String(item&&item.clientId));
    return this.norm(client&&client.name||item&&item.clientName||item&&item.clientId);
  },

  // Último registro de cada grupo.
  latestIds(list,groupOf,dateOf){
    const latest=new Map();
    list.forEach(item=>{
      const group=groupOf(item);
      const current=latest.get(group);
      const date=dateOf(item);
      if(!current||date>current.date||(date===current.date&&String(item.id)>String(current.id)))
        latest.set(group,{id:String(item.id),date});
    });
    return new Set([...latest.values()].map(item=>item.id));
  },
  currentIds(hr){
    return {
      integrations:this.latestIds(hr.clientIntegrations,item=>`${this.clientKey(item)}|${this.norm(item.unit)}`,item=>item.onboardingDate),
      asos:this.latestIds(hr.asos,()=>'aso',item=>item.examDate),
      ppe:this.latestIds(hr.ppe,item=>this.norm(item.item),item=>item.receivedDate)
    };
  },

  status(date,{current=true,today=this.today()}={}){
    if(!current) return {level:'old',label:'Substituído'};
    const day=this.validDate(date);
    if(!day) return {level:'none',label:'Sem vencimento'};
    const days=this.daysBetween(today,day);
    if(days<0) return {level:'expired',label:`Vencido há ${-days} dia${-days===1?'':'s'}`,days};
    if(days===0) return {level:'soon',label:'Vence hoje',days};
    if(days<=this.ALERT_DAYS) return {level:'soon',label:`Vence em ${days} dia${days===1?'':'s'}`,days};
    return {level:'ok',label:'Em dia',days};
  },
  tag(status){
    const tone={expired:'tag-red',soon:'tag-amber',ok:'tag-green',old:'tag-gray',none:'tag-gray'}[status.level]||'tag-gray';
    return `<span class="tag ${tone}">${U.esc(status.label)}</span>`;
  },

  // Colaborador que já saiu da empresa não gera alerta.
  inCompany(employee,today=this.today()){
    if(!employee) return false;
    const since=this.validDate(employee.inactiveSince);
    if(since) return today<since;
    return employee.active!==false;
  },
  alerts(employee,today=this.today()){
    if(!this.inCompany(employee,today)) return [];
    const hr=this.normalize(employee);
    const current=this.currentIds(hr);
    const out=[];
    const push=(kind,label,date)=>{
      const status=this.status(date,{today});
      if(status.level==='expired'||status.level==='soon')
        out.push({kind,label,date,level:status.level,days:status.days,status:status.label});
    };
    hr.asos.filter(item=>current.asos.has(String(item.id))&&item.type!=='Demissional')
      .forEach(item=>push('aso',`ASO ${item.type.toLowerCase()}`,item.expiryDate));
    hr.clientIntegrations.filter(item=>current.integrations.has(String(item.id)))
      .forEach(item=>push('integration',`Integração ${this.clientName(item)}${item.unit?` · ${item.unit}`:''}`,item.renewalDate));
    hr.ppe.filter(item=>current.ppe.has(String(item.id)))
      .forEach(item=>push('ppe',`EPI ${item.item}`,item.renewalDate));
    return out.sort((a,b)=>a.days-b.days);
  },
  alertsFor(employees,today=this.today()){
    return (employees||[]).flatMap(employee=>this.alerts(employee,today).map(alert=>({...alert,employee})))
      .sort((a,b)=>a.days-b.days||String(a.employee.name||'').localeCompare(String(b.employee.name||''),'pt-BR'));
  },
  // Texto curto para o cartão da lista de colaboradores.
  cardFlag(employee,today=this.today()){
    const list=this.alerts(employee,today);
    if(!list.length) return '';
    const expired=list.some(item=>item.level==='expired');
    const text=list.length===1?`${list[0].label}: ${list[0].status.toLowerCase()}`:`${list.length} vencimentos de RH`;
    return `<em class="crew-hr-flag ${expired?'danger':'warn'}"><i data-lucide="${expired?'alert-triangle':'calendar-clock'}"></i>${U.esc(text)}</em>`;
  },

  /* ------------------------------ tela ------------------------------ */

  field(def,value=''){
    const id=`crew-hr-${def.name}`;
    if(def.type==='select'){
      return `<label class="${def.wide?'wide':''}">${U.esc(def.label)}<select id="${id}">${def.placeholder?`<option value="">${U.esc(def.placeholder)}</option>`:''}${def.options.map(option=>{
        const opt=typeof option==='object'?option:{id:option,name:option};
        return `<option value="${U.esc(opt.id)}" ${String(opt.id)===String(value)?'selected':''}>${U.esc(opt.name)}</option>`;
      }).join('')}</select></label>`;
    }
    const list=def.datalist?` list="${id}-list"`:'';
    const extra=def.type==='number'?' min="1" max="9999" step="1" inputmode="numeric"':` maxlength="${def.max||160}"`;
    return `<label class="${def.wide?'wide':''}">${U.esc(def.label)}<input id="${id}" type="${def.type||'text'}"${def.type==='date'?'':extra}${list} value="${U.esc(value)}" autocomplete="off">${def.datalist?`<datalist id="${id}-list">${def.datalist.map(item=>`<option value="${U.esc(item)}"></option>`).join('')}</datalist>`:''}</label>`;
  },

  /**
   * Lista editável (mesmo padrão das férias: linhas + formulário de inclusão).
   * cfg: {key,title,icon,empty,fields,row(item,ctx),build(values,editing),validate(item,list),sort}
   */
  listEditor(box,hr,cfg,onChange){
    let editing=null;
    const paint=()=>{
      const list=hr[cfg.key];
      const current=this.currentIds(hr);
      const sorted=list.slice().sort(cfg.sort);
      const values=editing?cfg.fields.reduce((acc,def)=>({...acc,[def.name]:def.read?def.read(editing):editing[def.name]}),{}):{};
      box.innerHTML=`<div class="crew-hr-section-title"><i data-lucide="${cfg.icon}"></i><b>${U.esc(cfg.title)}</b><small>${list.length}</small>${cfg.extraAction||''}</div>
        <div class="crew-hr-list">${sorted.map(item=>`<div class="crew-hr-row ${editing&&String(editing.id)===String(item.id)?'editing':''}">
          ${cfg.row(item,{current,hr})}
          <span class="crew-hr-row-actions"><button class="btn btn-ghost btn-sm" type="button" data-hr-edit="${U.esc(item.id)}" aria-label="Alterar"><i data-lucide="pencil"></i></button><button class="btn btn-ghost btn-sm" type="button" data-hr-remove="${U.esc(item.id)}" aria-label="Remover"><i data-lucide="trash-2"></i></button></span>
        </div>`).join('')||`<small class="crew-vacation-empty">${U.esc(cfg.empty)}</small>`}</div>
        <div class="crew-hr-new">${cfg.fields.map(def=>this.field(typeof def.options==='function'?{...def,options:def.options()}:def,values[def.name]??(def.default||''))).join('')}
          <span class="crew-hr-new-actions">${editing?'<button class="btn btn-ghost btn-sm" type="button" data-hr-cancel>Cancelar</button>':''}<button class="btn ${editing?'btn-primary':'btn-ghost'} btn-sm" type="button" data-hr-add><i data-lucide="${editing?'check':'plus'}"></i>${editing?'Salvar alteração':'Adicionar'}</button></span>
        </div>`;
      box.querySelectorAll('[data-hr-remove]').forEach(button=>button.onclick=()=>{
        hr[cfg.key]=hr[cfg.key].filter(item=>String(item.id)!==String(button.dataset.hrRemove));
        if(editing&&String(editing.id)===String(button.dataset.hrRemove)) editing=null;
        paint(); onChange&&onChange();
      });
      box.querySelectorAll('[data-hr-edit]').forEach(button=>button.onclick=()=>{
        editing=hr[cfg.key].find(item=>String(item.id)===String(button.dataset.hrEdit))||null;
        paint();
        const first=box.querySelector('.crew-hr-new input,.crew-hr-new select');
        if(first) first.focus();
      });
      const cancel=box.querySelector('[data-hr-cancel]');
      if(cancel) cancel.onclick=()=>{ editing=null; paint(); };
      box.querySelector('[data-hr-add]').onclick=()=>{
        const raw=cfg.fields.reduce((acc,def)=>{
          const input=box.querySelector(`#crew-hr-${def.name}`);
          acc[def.name]=input?String(input.value||'').trim():'';
          return acc;
        },{});
        const item=cfg.build(raw,editing);
        const others=hr[cfg.key].filter(row=>!editing||String(row.id)!==String(editing.id));
        const problem=cfg.validate(item,others);
        if(problem) return UI.toast(problem,'warn',5500);
        hr[cfg.key]=editing?hr[cfg.key].map(row=>String(row.id)===String(editing.id)?item:row):[...hr[cfg.key],item];
        editing=null;
        paint(); onChange&&onChange();
      };
      if(cfg.afterPaint) cfg.afterPaint(box);
      U.icons();
    };
    paint();
    return {paint};
  },

  bindIntegrations(box,hr,onChange){
    const clients=this.clientOptions();
    const options=()=>{
      const list=clients.slice();
      hr.clientIntegrations.forEach(item=>{
        if(!list.some(option=>String(option.id)===String(item.clientId)))
          list.push({id:item.clientId||`nome:${this.norm(item.clientName)}`,name:this.clientName(item)});
      });
      return list;
    };
    return this.listEditor(box,hr,{
      key:'clientIntegrations',title:'Integrações em clientes',icon:'building-2',
      empty:clients.length?'Nenhuma integração cadastrada.':'Nenhum cliente cadastrado. Cadastre o cliente em Clientes.',
      fields:[
        {name:'int-client',label:'Cliente',type:'select',placeholder:'Selecione',options,wide:true,read:item=>item.clientId},
        {name:'int-unit',label:'Unidade / local',max:120,read:item=>item.unit},
        {name:'int-onboarding',label:'Data da integração',type:'date',read:item=>item.onboardingDate},
        {name:'int-renewal',label:'Vencimento',type:'date',read:item=>item.renewalDate}
      ],
      sort:(a,b)=>this.clientName(a).localeCompare(this.clientName(b),'pt-BR')||b.onboardingDate.localeCompare(a.onboardingDate),
      row:(item,{current})=>{
        const status=this.status(item.renewalDate,{current:current.integrations.has(String(item.id))});
        return `<span><b>${U.esc(this.clientName(item))}${item.unit?` · ${U.esc(item.unit)}`:''}</b><small>Integração ${U.date(item.onboardingDate)}${item.renewalDate?` · vence ${U.date(item.renewalDate)}`:''}</small></span>${this.tag(status)}`;
      },
      build:(raw,editing)=>{
        const option=options().find(item=>String(item.id)===String(raw['int-client']));
        return {
          id:editing?editing.id:this.newId(),
          clientId:option?String(option.id):'',
          clientName:option?option.name:'',
          unit:this.text(raw['int-unit'],120),
          onboardingDate:this.validDate(raw['int-onboarding']),
          renewalDate:this.validDate(raw['int-renewal'])
        };
      },
      validate:(item,others)=>{
        if(!item.clientId) return 'Selecione o cliente.';
        if(!item.onboardingDate) return 'Informe a data da integração.';
        if(item.renewalDate&&item.renewalDate<item.onboardingDate) return 'O vencimento não pode ser antes da integração.';
        if(others.some(row=>this.clientKey(row)===this.clientKey(item)&&this.norm(row.unit)===this.norm(item.unit)&&row.onboardingDate===item.onboardingDate))
          return 'Esta integração já está cadastrada.';
        return '';
      }
    },onChange);
  },

  bindAsos(box,hr,onChange){
    return this.listEditor(box,hr,{
      key:'asos',title:'ASO',icon:'stethoscope',empty:'Nenhum ASO cadastrado.',
      fields:[
        {name:'aso-type',label:'Tipo',type:'select',options:this.ASO_TYPES,default:'Periódico',read:item=>item.type},
        {name:'aso-exam',label:'Data do exame',type:'date',read:item=>item.examDate},
        {name:'aso-expiry',label:'Vencimento',type:'date',read:item=>item.expiryDate},
        {name:'aso-result',label:'Resultado',type:'select',options:this.ASO_RESULTS,default:'Apto',read:item=>item.result}
      ],
      sort:(a,b)=>b.examDate.localeCompare(a.examDate),
      row:(item,{current})=>{
        const isCurrent=current.asos.has(String(item.id));
        const status=item.type==='Demissional'&&isCurrent?{level:'none',label:'Demissional'}:this.status(item.expiryDate,{current:isCurrent});
        return `<span><b>${U.esc(item.type)} · ${U.esc(item.result)}</b><small>Exame ${U.date(item.examDate)}${item.expiryDate?` · vence ${U.date(item.expiryDate)}`:''}</small></span>${this.tag(status)}`;
      },
      build:(raw,editing)=>({
        id:editing?editing.id:this.newId(),
        type:this.ASO_TYPES.includes(raw['aso-type'])?raw['aso-type']:'Periódico',
        examDate:this.validDate(raw['aso-exam']),
        expiryDate:this.validDate(raw['aso-expiry']),
        result:this.ASO_RESULTS.includes(raw['aso-result'])?raw['aso-result']:'Apto'
      }),
      validate:(item,others)=>{
        if(!item.examDate) return 'Informe a data do exame.';
        if(item.type!=='Demissional'&&!item.expiryDate) return 'Informe o vencimento do ASO.';
        if(item.expiryDate&&item.expiryDate<item.examDate) return 'O vencimento não pode ser antes do exame.';
        if(others.some(row=>row.examDate===item.examDate&&row.type===item.type)) return 'Este ASO já está cadastrado.';
        return '';
      }
    },onChange);
  },

  bindPpe(box,hr,onChange,{onPdf}={}){
    return this.listEditor(box,hr,{
      key:'ppe',title:'EPIs entregues',icon:'hard-hat',empty:'Nenhum EPI cadastrado.',
      extraAction:'<button class="btn btn-ghost btn-sm" type="button" id="crew-ppe-pdf"><i data-lucide="file-down"></i>Gerar PDF</button>',
      fields:[
        {name:'ppe-item',label:'EPI',max:120,datalist:this.PPE_SUGGESTIONS,wide:true,read:item=>item.item},
        {name:'ppe-ca',label:'Nº do CA',max:30,read:item=>item.ca},
        {name:'ppe-qty',label:'Qtd.',type:'number',default:'1',read:item=>String(item.quantity)},
        {name:'ppe-received',label:'Recebido em',type:'date',read:item=>item.receivedDate},
        {name:'ppe-renewal',label:'Renovação',type:'date',read:item=>item.renewalDate}
      ],
      sort:(a,b)=>b.receivedDate.localeCompare(a.receivedDate)||a.item.localeCompare(b.item,'pt-BR'),
      row:(item,{current})=>{
        const status=this.status(item.renewalDate,{current:current.ppe.has(String(item.id))});
        return `<span><b>${U.esc(item.item)}${item.quantity>1?` · ${item.quantity} un.`:''}</b><small>${item.ca?`CA ${U.esc(item.ca)} · `:''}Recebido ${U.date(item.receivedDate)}${item.renewalDate?` · renovar ${U.date(item.renewalDate)}`:''}</small></span>${this.tag(status)}`;
      },
      build:(raw,editing)=>({
        id:editing?editing.id:this.newId(),
        item:this.text(raw['ppe-item'],120),
        ca:this.text(raw['ppe-ca'],30).replace(/[^0-9A-Za-z./-]/g,''),
        quantity:Math.max(1,Math.min(9999,Math.round(Number(raw['ppe-qty'])||1))),
        receivedDate:this.validDate(raw['ppe-received']),
        renewalDate:this.validDate(raw['ppe-renewal'])
      }),
      validate:item=>{
        if(!item.item) return 'Informe o EPI.';
        if(!item.receivedDate) return 'Informe a data de recebimento.';
        if(item.renewalDate&&item.renewalDate<item.receivedDate) return 'A renovação não pode ser antes do recebimento.';
        return '';
      },
      afterPaint:target=>{
        const button=target.querySelector('#crew-ppe-pdf');
        if(button) button.onclick=()=>onPdf&&onPdf();
      }
    },onChange);
  },

  /* v4.5.20 - atestados: periodo (de/ate) em crew.medicalLeaves. Entram no
     Historico de Alocacoes como "Atestado" (dias uteis), e a falta lancada no
     RDO num dia coberto por atestado tambem sai como "Atestado". Nao muda a
     disponibilidade do colaborador no RDO nem no planejamento. */
  leaveDays(item){
    const days=this.daysBetween(item&&item.from,item&&item.to);
    return days===null||days<0?0:days+1;
  },
  leaveOn(employee,date){
    const day=this.validDate(date);
    if(!day) return null;
    return this.normalize(employee).medicalLeaves.find(item=>day>=item.from&&day<=item.to)||null;
  },
  bindMedicalLeaves(box,hr,onChange){
    return this.listEditor(box,hr,{
      key:'medicalLeaves',title:'Atestados',icon:'file-text',empty:'Nenhum atestado cadastrado.',
      fields:[
        {name:'leave-from',label:'De',type:'date',read:item=>item.from},
        {name:'leave-to',label:'Até',type:'date',read:item=>item.to},
        {name:'leave-notes',label:'Observação',max:300,wide:true,read:item=>item.notes}
      ],
      sort:(a,b)=>b.from.localeCompare(a.from),
      row:item=>{
        const days=this.leaveDays(item);
        return `<span><b>${U.date(item.from)}${item.to!==item.from?` a ${U.date(item.to)}`:''}</b><small>${days} dia${days===1?'':'s'}${item.notes?` · ${U.esc(item.notes)}`:''}</small></span>`;
      },
      build:(raw,editing)=>{
        const from=this.validDate(raw['leave-from']);
        const to=this.validDate(raw['leave-to'])||from;
        return {id:editing?editing.id:this.newId(),from,to,notes:this.text(raw['leave-notes'],300)};
      },
      validate:(item,others)=>{
        if(!item.from) return 'Informe o primeiro dia do atestado.';
        if(item.to<item.from) return 'O fim do atestado não pode ser antes do início.';
        if(this.leaveDays(item)>365) return 'O atestado não pode passar de 365 dias.';
        if(others.some(row=>item.from<=row.to&&item.to>=row.from)) return 'Este período se sobrepõe a outro atestado já cadastrado.';
        return '';
      }
    },onChange);
  },

  bindOccurrences(box,hr,onChange){
    return this.listEditor(box,hr,{
      key:'occurrences',title:'Ocorrências',icon:'clipboard-list',empty:'Nenhuma ocorrência registrada.',
      fields:[
        {name:'occ-date',label:'Data',type:'date',read:item=>item.date},
        {name:'occ-type',label:'Tipo',type:'select',options:this.OCCURRENCE_TYPES,default:'Outro',read:item=>item.type},
        {name:'occ-description',label:'Descrição',max:1000,wide:true,read:item=>item.description}
      ],
      sort:(a,b)=>b.date.localeCompare(a.date),
      row:item=>`<span><b>${U.esc(item.type)} · ${U.date(item.date)}</b>${item.description?`<small>${U.esc(item.description)}</small>`:''}</span>`,
      build:(raw,editing)=>({
        id:editing?editing.id:this.newId(),
        date:this.validDate(raw['occ-date']),
        type:this.OCCURRENCE_TYPES.includes(raw['occ-type'])?raw['occ-type']:'Outro',
        description:String(raw['occ-description']||'').trim().slice(0,1000)
      }),
      validate:item=>item.date?'':'Informe a data da ocorrência.'
    },onChange);
  },

  // Bolinha de alerta nas abas RH e EPIs.
  tabLevel(hr,kind,employee){
    const list=this.alerts({...employee,...hr},this.today())
      .filter(item=>kind==='rh'?item.kind!=='ppe':item.kind==='ppe');
    if(list.some(item=>item.level==='expired')) return 'danger';
    return list.length?'warn':'';
  },

  /* ------------------------------ PDF de EPIs ------------------------------ */

  async ppePdf(employee,hr){
    const header=typeof State!=='undefined'?State.settings||{}:{};
    const companyName=String(header.companyName||'CliqueObras');
    const companyCnpj=typeof U.formatCnpj==='function'?U.formatCnpj(header.companyCnpj||''):String(header.companyCnpj||'');
    const letterheadSrc=U.safeImageSrc(header.pdfLetterhead||'');
    const logoSrc=U.safeImageSrc(header.companyLogo||'')||'assets/logo-clique.png';
    const doc=await Pdf.create('portrait');
    const T=value=>Pdf.text(value);
    const page={w:210,h:297,m:14};
    const left=page.m,right=page.w-page.m,width=right-left;
    const ink=[11,31,58],muted=[102,112,133],line=[223,228,234];
    const letterhead=letterheadSrc?await Pdf.imageData(letterheadSrc,{maxSide:1800,quality:.85}):null;
    const logo=await Pdf.imageData(logoSrc,{maxSide:300,quality:.9});
    const painted=new Set();
    const paint=()=>{
      const number=doc.getCurrentPageInfo().pageNumber;
      if(painted.has(number)) return;
      painted.add(number);
      if(letterhead) Pdf.drawContain(doc,letterhead,0,0,page.w,page.h,'top');
    };
    paint();
    const font=(size,style='normal',color=ink)=>{ doc.setFont('helvetica',style); doc.setFontSize(size); doc.setTextColor(...color); };
    let y=page.m;
    if(logo) Pdf.drawContain(doc,logo,left,y,12,12);
    font(12.5,'bold'); doc.text(doc.splitTextToSize(T(companyName),110).slice(0,1),left+15,y+5);
    font(7,'normal',muted); doc.text(T(`FICHA DE CONTROLE DE EPI${companyCnpj?` · CNPJ ${companyCnpj}`:''}`),left+15,y+9.5);
    font(7,'normal',muted); doc.text(T(`Emitida em ${U.date(this.today())}`),right,y+5,{align:'right'});
    y+=15;
    doc.setDrawColor(...ink); doc.setLineWidth(.6); doc.line(left,y,right,y);
    y+=6;
    const facts=[
      ['Colaborador',employee.name||'—'],
      ['Matrícula',employee.registration||'—'],
      ['CPF',employee.cpf?this.formatCpf(employee.cpf):'—'],
      ['Função',employee.internalRole||'—'],
      ['Admissão',employee.admissionDate?U.date(employee.admissionDate):'—']
    ];
    const boxW=(width-2*(facts.length-1))/facts.length;
    facts.forEach(([label,value],index)=>{
      const x=left+index*(boxW+2);
      doc.setDrawColor(...line); doc.setLineWidth(.25); doc.roundedRect(x,y,boxW,13,2,2,'S');
      font(6,'normal',muted); doc.text(T(label.toUpperCase()),x+2.5,y+4.5);
      font(8,'bold'); doc.text(doc.splitTextToSize(T(value),boxW-5).slice(0,2),x+2.5,y+8.6);
    });
    y+=19;
    const current=this.currentIds(hr);
    const rows=hr.ppe.slice().sort((a,b)=>b.receivedDate.localeCompare(a.receivedDate)||a.item.localeCompare(b.item,'pt-BR')).map(item=>{
      const status=this.status(item.renewalDate,{current:current.ppe.has(String(item.id))});
      return [T(item.item),T(item.ca||'—'),String(item.quantity),U.date(item.receivedDate),item.renewalDate?U.date(item.renewalDate):'—',T(status.label),''];
    });
    Pdf.table(doc,{
      startY:y,
      margin:{left,right:page.m,top:page.m+4,bottom:page.m+8},
      head:[['EPI','CA','Qtd.','Recebido em','Renovação','Situação','Assinatura']],
      body:rows.length?rows:[['Nenhum EPI cadastrado.','','','','','','']],
      theme:'grid',
      styles:{font:'helvetica',fontSize:7.6,cellPadding:2,textColor:ink,lineColor:line,lineWidth:.2,valign:'middle'},
      headStyles:{fillColor:[245,247,250],textColor:ink,fontStyle:'bold',fontSize:7},
      columnStyles:{0:{cellWidth:'auto'},1:{cellWidth:18},2:{cellWidth:10,halign:'center'},3:{cellWidth:20},4:{cellWidth:20},5:{cellWidth:26},6:{cellWidth:30,minCellHeight:9}},
      willDrawPage:paint
    });
    y=(doc.lastAutoTable&&doc.lastAutoTable.finalY||y)+8;
    const declaration='Declaro ter recebido os Equipamentos de Proteção Individual acima, em perfeito estado, e ter sido orientado sobre o uso correto, a guarda e a conservação. Comprometo-me a usá-los apenas para a finalidade a que se destinam e a comunicar qualquer dano ou extravio, conforme a NR-6.';
    font(8,'normal',[52,64,84]);
    const declLines=doc.splitTextToSize(T(declaration),width);
    if(y+declLines.length*4+30>page.h-page.m){ doc.addPage(); paint(); y=page.m+4; }
    doc.text(declLines,left,y);
    y+=declLines.length*4+20;
    doc.setDrawColor(...muted); doc.setLineWidth(.3);
    doc.line(left,y,left+80,y); doc.line(right-80,y,right,y);
    font(7.5,'normal',muted);
    doc.text(T(employee.name||'Colaborador'),left+40,y+4.5,{align:'center'});
    doc.text(T(companyName),right-40,y+4.5,{align:'center'});
    const total=doc.getNumberOfPages();
    for(let index=1;index<=total;index++){
      doc.setPage(index);
      font(6.5,'normal',muted);
      doc.text(T(`Ficha de EPI · ${employee.name||''}`),left,page.h-8);
      doc.text(`Página ${index} de ${total}`,right,page.h-8,{align:'right'});
    }
    return doc.output('blob');
  },
  async downloadPpePdf(employee,hr){
    try{
      UI.loading(true,'Gerando PDF dos EPIs…');
      const blob=await this.ppePdf(employee,hr);
      UI.loading(false);
      const name=`${Pdf.fileName(`EPIs ${employee.registration?`${employee.registration} `:''}${employee.name||'colaborador'}`,'EPIs')}.pdf`;
      Pdf.deliver(blob,name,{title:'PDF dos EPIs'});
    }catch(err){
      UI.loading(false);
      UI.toast('Não foi possível gerar o PDF: '+U.esc(err.message||err),'error',7000);
    }
  }
};
