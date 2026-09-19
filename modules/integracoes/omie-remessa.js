/**
 * v4.5.7 — Custo por NOTA DE REMESSA (Omie).
 *
 * Módulo NOVO. Não altera nenhuma função existente: ele ENVOLVE
 * OmieIntegration.render (acrescenta o botão "Custo por remessa"),
 * Views.financeiro.sourceTag e DashboardPanel.sourceLabel (rótulo
 * "Omie · remessa"). Para qualquer outro lançamento, as funções originais
 * respondem exatamente como antes.
 *
 * Regras (definidas com o Mauricio):
 *   - Só vale para os projetos marcados aqui. Os demais continuam com o
 *     custo vindo do Contas a Pagar, sem nenhuma mudança.
 *   - Custo = Remessa de Produtos FATURADA no Omie (total da NF, categoria da
 *     remessa pelo mesmo DE-PARA de categorias).
 *   - Retorno = Nota de Entrada que referencia a NF da remessa; é estornado
 *     NA REMESSA DE ORIGEM (custo = total − retornos).
 *   - Nesses projetos, do Contas a Pagar só entra o que foi lançado na conta
 *     corrente do cartão corporativo.
 */
const OmieRemessa = {
  config:null,

  install(){
    if(typeof OmieIntegration!=='undefined'&&!OmieIntegration.__remessaV457){
      const baseRender=OmieIntegration.render;
      OmieIntegration.render=function(...args){
        const result=baseRender.apply(this,args);
        try{ OmieRemessa.decorate(); }catch(error){ console.warn('[OmieRemessa] botão não montado',error); }
        return result;
      };
      OmieIntegration.__remessaV457=true;
    }
    if(typeof Views!=='undefined'&&Views.financeiro&&typeof Views.financeiro.sourceTag==='function'&&!Views.financeiro.__remessaV457){
      const baseTag=Views.financeiro.sourceTag;
      Views.financeiro.sourceTag=function(x){
        if(x&&x.sourceType==='omieRemessa') return '<span class="tag tag-blue">Omie · remessa</span>';
        return baseTag.apply(this,arguments);
      };
      Views.financeiro.__remessaV457=true;
    }
    if(typeof DashboardPanel!=='undefined'&&typeof DashboardPanel.sourceLabel==='function'&&!DashboardPanel.__remessaV457){
      const baseLabel=DashboardPanel.sourceLabel;
      DashboardPanel.sourceLabel=function(entry){
        if(entry&&entry.sourceType==='omieRemessa') return 'Omie · remessa';
        return baseLabel.apply(this,arguments);
      };
      DashboardPanel.__remessaV457=true;
    }
  },

  decorate(){
    const state=OmieIntegration.state;
    if(!state||!state.connected) return;
    const actions=document.querySelector('#omie-integration-content .omie-actions');
    if(!actions||document.getElementById('omie-remessa-open')) return;
    const button=document.createElement('button');
    button.className='btn btn-ghost'; button.type='button'; button.id='omie-remessa-open';
    button.innerHTML='<i data-lucide="truck"></i>Custo por remessa';
    button.onclick=()=>this.open();
    const disconnect=document.getElementById('omie-disconnect');
    if(disconnect) actions.insertBefore(button,disconnect); else actions.appendChild(button);
    const summary=this.lastRunLabel(state.summary&&state.summary.lastRun&&state.summary.lastRun.remessas);
    const line=document.querySelector('#omie-integration-content .omie-last-result');
    if(line&&summary) line.insertAdjacentText('beforeend',summary);
    U.icons();
  },

  lastRunLabel(remessas){
    if(!remessas||!Number(remessas.projects)) return '';
    if(remessas.error) return ` Remessas: falha na leitura (${remessas.error}).`;
    const parts=[`${Number(remessas.imported)||0} incluída(s)`,`${Number(remessas.updated)||0} atualizada(s)`,`${Number(remessas.cancelled)||0} estornada(s)`];
    const pending=Number(remessas.pending)||0, orphan=Number(remessas.unmatchedReturns)||0;
    const waiting=Number(remessas.source&&remessas.source.awaitingStatus)||0;
    return ` Remessas: ${parts.join(', ')}${pending?`, ${pending} sem DE-PARA de categoria`:''}${orphan?`, ${orphan} retorno(s) sem remessa de origem`:''}${waiting?`, ${waiting} aguardando consulta no Omie`:''}.`;
  },

  money(value){ return U.money2(Number(value)||0); },

  async open(){
    if(!OmieIntegration.assertOwner()) return;
    try{
      UI.loading(true,'Carregando projetos e contas do Omie…');
      this.config=await OmieIntegration.request('remessa-config');
      UI.loading(false);
    }catch(error){
      UI.loading(false);
      return UI.toast('Não foi possível carregar o custo por remessa: '+U.esc(error.message||error),'error',8000);
    }
    const cfg=this.config||{};
    const projects=Array.isArray(cfg.projects)?cfg.projects:[];
    const saved=new Map((cfg.cards||[]).map(card=>[String(card.code),card]));
    const accounts=(Array.isArray(cfg.accounts)?cfg.accounts:[]).map(account=>({...account,code:String(account.code)}));
    for(const card of saved.values()) if(!accounts.some(account=>account.code===card.code)) accounts.push({code:card.code,name:card.name||'Conta salva',type:'',missing:true});
    const localLabel=id=>{const project=State.projects.find(row=>String(row.id)===String(id));return project?U.projLabel(project):'Projeto não encontrado';};
    UI.modal({title:'Custo por nota de remessa',wide:true,body:`
      ${cfg.ready===false?`<div class="permission-banner" style="margin-bottom:12px"><i data-lucide="alert-triangle"></i><span><b>Falta aplicar o SQL da v4.5.7</b> (ATUALIZACAO-v4.5.7-OMIE-REMESSA.sql). Até lá nada muda e não é possível salvar.</span></div>`:''}
      <div class="permission-banner" style="margin-bottom:14px"><i data-lucide="info"></i><span>Vale <b>somente para os projetos marcados</b>. Neles o material entra pela <b>Remessa de Produtos faturada</b> (valor da NF, categoria da remessa), o <b>retorno</b> (Nota de Entrada com a NF da remessa referenciada) é <b>estornado na remessa de origem</b>, e do Contas a Pagar só continua entrando o que foi lançado na conta do <b>cartão corporativo</b>. Projetos não marcados seguem pelo Contas a Pagar, como hoje.</span></div>
      <h3 style="font-size:.95rem;margin:4px 0 8px">Projetos</h3>
      <div class="omie-map-list">${projects.map((item,index)=>`<div class="omie-map-row">
        <input class="omie-remessa-project" data-index="${index}" type="checkbox" ${item.remessa?'checked':''} aria-label="Custo por remessa">
        <div style="min-width:0"><b>${U.esc(item.omieProjectName||'Projeto Omie')}</b><small style="display:block;white-space:normal">${U.esc(localLabel(item.cliqueProjectId))} · código Omie ${U.esc(item.omieProjectCode)}</small><small style="display:block;white-space:normal">${item.remessa?`<span class="tag tag-blue">Custo por remessa desde ${U.esc(U.date(item.enabledAt))}</span>`:'Custo pelo Contas a Pagar (regra atual)'}</small></div>
        <span></span>
        <button class="btn btn-ghost btn-sm omie-remessa-preview" type="button" data-index="${index}" style="justify-self:end;width:auto"><i data-lucide="eye"></i>Prévia</button>
      </div>`).join('')||'<div class="empty">Nenhum projeto ativo no mapeamento Omie.</div>'}</div>
      <h3 style="font-size:.95rem;margin:18px 0 8px">Cartão corporativo</h3>
      <p style="font-size:.82rem;color:var(--text2);margin-bottom:8px">Marque a(s) conta(s) corrente(s) do Omie que são o cartão corporativo. Nos projetos com remessa, só as contas a pagar lançadas nelas continuam entrando.</p>
      ${cfg.accountsError?`<div class="permission-banner" style="margin-bottom:8px"><i data-lucide="alert-triangle"></i><span>Não foi possível listar as contas correntes do Omie: ${U.esc(cfg.accountsError)}</span></div>`:''}
      <div class="check-list" id="omie-remessa-cards">${accounts.map(account=>`<label class="check-item"><input type="checkbox" class="omie-remessa-card" value="${U.esc(account.code)}" data-name="${U.esc(account.name||'')}" ${saved.has(account.code)?'checked':''}><span><b style="display:block">${U.esc(account.name||'Conta corrente')}</b><small style="display:block">Código ${U.esc(account.code)}${account.type?` · tipo ${U.esc(account.type)}`:''}${account.missing?' · não retornada pelo Omie agora':''}</small></span></label>`).join('')||'<div class="empty">Nenhuma conta corrente retornada.</div>'}</div>`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-ghost" id="omie-remessa-probe" type="button"><i data-lucide="list-checks"></i>Diagnóstico da leitura</button><button class="btn btn-primary" id="omie-remessa-save" type="button"><i data-lucide="check"></i>Salvar</button>',
      onOpen:()=>{
        document.querySelectorAll('.omie-remessa-preview').forEach(button=>{button.onclick=()=>this.preview(projects[Number(button.dataset.index)]);});
        document.getElementById('omie-remessa-probe').onclick=()=>this.probe();
        document.getElementById('omie-remessa-save').onclick=()=>this.save(projects);
      }
    });
  },

  selectedCards(){
    return [...document.querySelectorAll('.omie-remessa-card:checked')].map(input=>({code:String(input.value),name:String(input.dataset.name||'')}));
  },

  save(projects){
    const cfg=this.config||{};
    if(cfg.ready===false) return UI.toast('Aplique primeiro o SQL da v4.5.7.','warn',6500);
    const remessaProjects=[...document.querySelectorAll('.omie-remessa-project')].map(input=>({omieProjectCode:String(projects[Number(input.dataset.index)].omieProjectCode),enabled:input.checked}));
    const cardAccounts=this.selectedCards();
    const turningOn=projects.filter((item,index)=>!item.remessa&&remessaProjects[index].enabled);
    const turningOff=projects.filter((item,index)=>item.remessa&&!remessaProjects[index].enabled);
    const names=list=>list.map(item=>`<b>${U.esc(item.omieProjectName||item.omieProjectCode)}</b>`).join(', ');
    const lines=[];
    if(turningOn.length) lines.push(`Passam a usar <b>custo por remessa</b>: ${names(turningOn)}. Nesses projetos, as próximas sincronizações trazem as remessas faturadas e, do Contas a Pagar, só o cartão corporativo. Contas a pagar já importadas nesses projetos <b>permanecem</b> como estão.`);
    if(turningOn.length&&!cardAccounts.length) lines.push('<b>Atenção:</b> nenhuma conta de cartão corporativo está marcada — nesses projetos <b>nenhuma</b> conta a pagar vai entrar, só as remessas.');
    if(turningOff.length) lines.push(`Voltam para o <b>Contas a Pagar</b>: ${names(turningOff)}. As remessas lançadas neles serão <b>estornadas agora</b> (o planejamento é devolvido). Depois rode <b>Sincronizar agora</b> nesses projetos para trazer de volta as contas a pagar.`);
    const run=async()=>{
      try{
        UI.loading(true,'Salvando custo por remessa…');
        const result=await OmieIntegration.request('remessa-save',{remessaProjects,cardAccounts});
        if(Number(result.reverted)>0){ await DB.syncFromCloud(); await State.reload(); }
        UI.loading(false); UI.closeAll();
        UI.toast(`Custo por remessa salvo: ${Number(result.projects)||0} projeto(s), ${Number(result.cards)||0} conta(s) de cartão${Number(result.reverted)?`, ${Number(result.reverted)} remessa(s) estornada(s)`:''}.`,'success',8000);
        if(Number(result.reverted)>0) App.render();
        await OmieIntegration.load();
      }catch(error){ UI.loading(false); UI.toast('Não foi possível salvar: '+U.esc(error.message||error),'error',8000); }
    };
    if(!lines.length) return run();
    UI.confirm(lines.join('<br><br>'),run,false);
  },

  async preview(project){
    if(!project) return;
    const cardAccounts=this.selectedCards();
    const cardNames=new Map(cardAccounts.map(card=>[card.code,card.name]));
    const accountNames=new Map(((this.config&&this.config.accounts)||[]).map(account=>[String(account.code),account.name]));
    let data;
    try{
      UI.loading(true,'Lendo remessas, retornos e contas a pagar no Omie…');
      data=await OmieIntegration.request('remessa-preview',{projectCode:String(project.omieProjectCode),cardAccounts});
      UI.loading(false);
    }catch(error){ UI.loading(false); return UI.toast('Não foi possível montar a prévia: '+U.esc(error.message||error),'error',8000); }
    const r=data.remessas||{}, p=data.payables||{};
    const entries=Array.isArray(r.entries)?r.entries:[];
    const counted=entries.filter(item=>item.active);
    const sum=(list,key)=>list.reduce((total,item)=>total+(Number(item[key])||0),0);
    const accounts=Array.isArray(p.accounts)?p.accounts:[];
    const keep=accounts.filter(item=>item.card), leave=accounts.filter(item=>!item.card);
    const accountName=code=>cardNames.get(code)||accountNames.get(code)||(code==='—'?'Sem conta corrente':`Conta ${code}`);
    const statusTag=item=>item.active?'<span class="tag tag-green">Entra</span>':item.status==='CANCELADA'?'<span class="tag tag-gray">Cancelada</span>':item.value<=0&&item.status==='FATURADA'?'<span class="tag tag-gray">Retornada</span>':'<span class="tag tag-amber">Não faturada</span>';
    UI.modal({title:`Prévia · ${project.omieProjectName||project.omieProjectCode}`,wide:true,body:`
      <p style="font-size:.82rem;color:var(--text2);margin-bottom:12px">Nada é gravado nesta prévia. Ela mostra o que a sincronização lançaria se este projeto estivesse com custo por remessa.</p>
      <h3 style="font-size:.95rem;margin:4px 0 8px">Remessas</h3>
      ${r.error?`<div class="permission-banner"><i data-lucide="alert-triangle"></i><span>Leitura de remessas/retornos falhou: ${U.esc(r.error)}. Use "Diagnóstico da leitura" e me envie o resultado.</span></div>`:`
      <div class="omie-connection-grid" style="margin-bottom:10px">
        <div><small>Remessas deste projeto</small><b>${entries.length}</b></div>
        <div><small>Total das NFs que entram</small><b>${this.money(sum(counted,'grossValue'))}</b></div>
        <div><small>Retornos estornados</small><b>${this.money(sum(counted,'returnedValue'))}</b></div>
        <div><small>Custo líquido</small><b>${this.money(sum(counted,'value'))}</b></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>NF</th><th>Data</th><th>Categoria</th><th class="num">Valor NF</th><th class="num">Retornos</th><th class="num">Custo</th><th>Situação</th></tr></thead><tbody>
      ${entries.map(item=>`<tr><td>${U.esc(item.nfNumber||item.id)}</td><td>${U.esc(U.date(item.date))}</td><td>${U.esc(item.category)}</td><td class="num">${this.money(item.grossValue)}</td><td class="num" title="${U.esc((item.returns||[]).map(ret=>`NF ${ret.nfNumber||ret.id} · ${U.date(ret.date)} · ${this.money(ret.value)}`).join('\n'))}">${Number(item.returnedValue)?this.money(item.returnedValue):'—'}</td><td class="num">${item.active?`<b>${this.money(item.value)}</b>`:'—'}</td><td>${statusTag(item)}</td></tr>`).join('')||'<tr><td colspan="7"><div class="empty">Nenhuma remessa encontrada para este projeto.</div></td></tr>'}
      </tbody></table></div>
      ${Number(r.source&&r.source.awaitingStatus)>0?`<div class="permission-banner" style="margin-top:10px"><i data-lucide="info"></i><span>${Number(r.source.awaitingStatus)} nota(s) ainda sem a situação consultada no Omie (limite de 40 consultas por vez). Elas entram nas próximas sincronizações; abra a prévia de novo para ver o quadro completo.</span></div>`:''}
      ${(r.pending||[]).length?`<div class="permission-banner" style="margin-top:10px"><i data-lucide="alert-triangle"></i><span><b>${r.pending.length} remessa(s) ficam pendentes</b> por categoria sem DE-PARA: ${r.pending.slice(0,8).map(item=>`NF ${U.esc(item.nfNumber||item.id)} (categoria ${U.esc(item.categoryCode||'vazia')})`).join(', ')}. Vincule a categoria em "Projetos e categorias".</span></div>`:''}
      ${(r.unmatchedReturns||[]).length?`<div class="permission-banner" style="margin-top:10px"><i data-lucide="alert-triangle"></i><span><b>${r.unmatchedReturns.length} nota(s) de entrada</b> com NF referenciada que não bate com nenhuma remessa (de qualquer projeto) — ficam pendentes, sem estorno: ${r.unmatchedReturns.slice(0,8).map(item=>`NF ${U.esc(item.nfNumber||item.id)} (${this.money(item.total)})`).join(', ')}.</span></div>`:''}`}
      <h3 style="font-size:.95rem;margin:18px 0 8px">Contas a pagar deste projeto no Omie</h3>
      ${p.error?`<div class="permission-banner"><i data-lucide="alert-triangle"></i><span>${U.esc(p.error)}</span></div>`:`
      <div class="table-wrap"><table><thead><tr><th>Conta corrente</th><th class="num">Lançamentos</th><th class="num">Valor</th><th>Com custo por remessa</th></tr></thead><tbody>
      ${accounts.map(item=>`<tr><td>${U.esc(accountName(item.code))}</td><td class="num">${Number(item.count)||0}</td><td class="num">${this.money(item.total)}</td><td>${item.card?'<span class="tag tag-green">Continua entrando (cartão)</span>':'<span class="tag tag-gray">Deixa de entrar</span>'}</td></tr>`).join('')||'<tr><td colspan="4"><div class="empty">Nenhuma conta a pagar no período.</div></td></tr>'}
      </tbody></table></div>
      <small style="display:block;margin-top:6px;color:var(--text3)">Continua entrando: ${this.money(sum(keep,'total'))} · Deixa de entrar: ${this.money(sum(leave,'total'))}</small>`}`,
      footer:'<button class="btn btn-primary" onclick="UI.close()">Fechar</button>'
    });
  },

  async probe(){
    let data;
    try{
      UI.loading(true,'Consultando o formato dos dados no Omie…');
      data=await OmieIntegration.request('remessa-probe');
      UI.loading(false);
    }catch(error){ UI.loading(false); return UI.toast('Diagnóstico indisponível: '+U.esc(error.message||error),'error',8000); }
    const text=JSON.stringify(data,null,2);
    UI.modal({title:'Diagnóstico da leitura (Omie)',wide:true,body:`
      <p style="font-size:.82rem;color:var(--text2);margin-bottom:10px">Leitura real, com os nomes exatos da documentação do Omie: ListarRemessas + StatusRemessa, ListarNotaEnt + StatusNotaEnt e ListarContasCorrentes, e o que o sistema entendeu de cada uma (projeto, categoria, valor, NF, faturada, NF referenciada). Nada é gravado. Se algo vier vazio ou com erro, copie e envie.</p>
      <pre id="omie-remessa-probe-text" style="max-height:52vh;overflow:auto;font-size:.72rem;background:var(--surface2,#f5f5f5);padding:10px;border-radius:8px;white-space:pre-wrap;word-break:break-word">${U.esc(text)}</pre>`,
      footer:'<button class="btn btn-ghost" id="omie-remessa-probe-copy" type="button"><i data-lucide="copy"></i>Copiar</button><button class="btn btn-primary" onclick="UI.close()">Fechar</button>',
      onOpen:()=>{
        document.getElementById('omie-remessa-probe-copy').onclick=async()=>{
          try{ await navigator.clipboard.writeText(text); UI.toast('Diagnóstico copiado.','success',3500); }
          catch{ UI.toast('Selecione o texto e copie manualmente.','warn',5000); }
        };
      }
    });
  }
};

OmieRemessa.install();
