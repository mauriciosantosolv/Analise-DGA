/**
 * Integração Omie — interface exclusiva do proprietário.
 *
 * O navegador nunca persiste nem relê App Key/App Secret. As credenciais são
 * enviadas uma única vez à Edge Function e armazenadas no Supabase Vault.
 */
const OmieIntegration = {
  state:null,
  busy:false,

  card(){
    return `<section class="card settings-card settings-card-wide omie-card">
      <div class="omie-heading"><span class="omie-mark"><i data-lucide="refresh-cw"></i></span><div><h2>Integração Omie</h2><p>Contas a pagar por projeto, com categorias mapeadas e abatimento automático do planejamento.</p></div><span class="tag tag-gray" id="omie-status-tag">Verificando…</span></div>
      <div id="omie-integration-content"><div class="empty"><i data-lucide="loader-2"></i><br>Consultando conexão segura…</div></div>
      <div class="permission-banner omie-security-note"><i data-lucide="shield-check"></i><span><b>Área exclusiva do proprietário.</b> O App Secret não é devolvido ao navegador, não entra em backups e permanece isolado na organização ativa.</span></div>
    </section>`;
  },

  assertOwner(){
    if(typeof Cloud==='undefined'||!Cloud.active()||!Cloud.isOwner()){
      UI.toast('Somente o proprietário pode administrar a integração Omie.','warn',6000);
      return false;
    }
    return true;
  },

  async request(action,payload={}){
    if(!this.assertOwner()) throw new Error('Acesso restrito ao proprietário.');
    return Cloud.omieRequest(action,payload);
  },

  async load(){
    const box=document.getElementById('omie-integration-content'); if(!box||!this.assertOwner()) return;
    try{
      this.state=await this.request('status');
      this.render();
    }catch(error){
      box.innerHTML=`<div class="permission-banner"><i data-lucide="alert-triangle"></i><span>Não foi possível consultar a integração: ${U.esc(error.message||error)}</span></div>`;
      const tag=document.getElementById('omie-status-tag'); if(tag){tag.textContent='Indisponível';tag.className='tag tag-red';}
      U.icons();
    }
  },

  render(){
    const box=document.getElementById('omie-integration-content'); if(!box) return;
    const tag=document.getElementById('omie-status-tag');
    if(!this.state||!this.state.connected){
      if(tag){tag.textContent='Desconectado';tag.className='tag tag-gray';}
      box.innerHTML=`<div class="omie-disconnected"><div><b>Nenhuma conta Omie vinculada</b><small>As importações manuais continuam funcionando normalmente. Conecte o Omie para sincronizar contas a pagar por projeto.</small></div><button class="btn btn-primary" type="button" id="omie-connect"><i data-lucide="link"></i>Conectar Omie</button></div>`;
      document.getElementById('omie-connect').onclick=()=>this.connectForm();
      U.icons(); return;
    }
    const c=this.state.connection||{}, summary=this.state.summary||{};
    if(tag){tag.textContent=c.lastSyncStatus==='error'?'Atenção':'Conectado';tag.className=`tag ${c.lastSyncStatus==='error'?'tag-red':'tag-green'}`;}
    box.innerHTML=`
      <div class="omie-connection-grid">
        <div><small>Aplicativo Omie</small><b>${U.esc(c.appKeyHint||'Chave protegida')}</b></div>
        <div><small>Sincronização automática</small><b>${c.autoSync?`A cada ${this.intervalLabel(c.autoIntervalMinutes)}`:'Desativada'}</b></div>
        <div><small>Última sincronização</small><b>${c.lastSyncAt?`${U.date(c.lastSyncAt)} · ${new Date(c.lastSyncAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`:'Ainda não executada'}</b></div>
        <div><small>Mapeamentos ativos</small><b>${Number(summary.projects)||0} projeto(s) · ${Number(summary.categories)||0} categoria(s)</b></div>
      </div>
      ${c.lastSyncError?`<div class="permission-banner" style="margin-top:12px"><i data-lucide="alert-triangle"></i><span>${U.esc(c.lastSyncError)}</span></div>`:''}
      <div class="omie-actions"><button class="btn btn-primary" id="omie-sync-now" type="button"><i data-lucide="refresh-cw"></i>Sincronizar agora</button><button class="btn btn-ghost" id="omie-configure" type="button"><i data-lucide="sliders-horizontal"></i>Projetos e categorias</button><button class="btn btn-danger" id="omie-disconnect" type="button"><i data-lucide="unlink"></i>Desvincular</button></div>
      <small class="omie-last-result">${summary.lastRun?`Último resultado: ${Number(summary.lastRun.imported)||0} incluído(s), ${Number(summary.lastRun.updated)||0} atualizado(s), ${Number(summary.lastRun.cancelled)||0} cancelado(s) e ${Number(summary.lastRun.skipped)||0} pendente(s).${this.orphanLabel(summary.lastRun.orphans)}`:''}</small>`;
    document.getElementById('omie-sync-now').onclick=()=>this.syncForm();
    document.getElementById('omie-configure').onclick=()=>this.configure();
    document.getElementById('omie-disconnect').onclick=()=>this.disconnect();
    U.icons();
  },

  // v4.2.6 — quantos lançamentos foram removidos por terem sido excluídos no
  // Omie. Só aparece quando houve remoção, para não poluir a linha no dia a dia.
  orphanLabel(orphans){
    const removed=Number(orphans&&orphans.removed)||0;
    if(!removed) return '';
    return ` ${removed} lançamento(s) removido(s) por exclusão no Omie.`;
  },

  intervalLabel(minutes){
    const value=Number(minutes)||60;
    return value<60?`${value} minutos`:value===60?'1 hora':value<1440?`${value/60} horas`:'1 dia';
  },

  connectForm(){
    if(!this.assertOwner()) return;
    const today=new Date(), start=`${today.getFullYear()}-01-01`;
    UI.modal({title:'Conectar conta Omie',body:`
      <p style="font-size:.84rem;color:var(--text2);margin-bottom:14px">Informe as credenciais do aplicativo criado no Omie. Elas serão testadas e enviadas diretamente ao cofre seguro da organização.</p>
      <div class="form-grid"><div class="full"><label>App Key *</label><input id="omie-app-key" type="password" maxlength="120" autocomplete="off" spellcheck="false" placeholder="Chave do aplicativo Omie"></div><div class="full"><label>App Secret *</label><input id="omie-app-secret" type="password" maxlength="200" autocomplete="new-password" spellcheck="false" placeholder="Segredo do aplicativo Omie"></div><div class="full"><label>Importar contas alteradas a partir de</label><input id="omie-initial-date" type="date" value="${start}" max="${U.isoDate(today)}"><small>Contas anteriores a esta data não serão importadas na primeira sincronização.</small></div></div>`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="omie-connect-save"><i data-lucide="shield-check"></i>Testar e conectar</button>',
      onOpen:()=>{document.getElementById('omie-connect-save').onclick=()=>this.connect();}
    });
  },

  async connect(){
    const appKey=document.getElementById('omie-app-key').value.trim();
    const appSecret=document.getElementById('omie-app-secret').value.trim();
    const initialSyncDate=document.getElementById('omie-initial-date').value;
    if(appKey.length<4||appSecret.length<4||!initialSyncDate)
      return UI.toast('Informe App Key, App Secret e data inicial válidos.','warn',5500);
    try{
      UI.loading(true,'Testando conexão segura com o Omie…');
      await this.request('connect',{appKey,appSecret,initialSyncDate});
      document.getElementById('omie-app-key').value='';
      document.getElementById('omie-app-secret').value='';
      UI.loading(false); UI.closeAll();
      UI.toast('Omie conectado. Agora relacione projetos e categorias.','success',6500);
      await this.load(); await this.configure();
    }catch(error){
      UI.loading(false);
      UI.toast('Não foi possível conectar ao Omie: '+U.esc(error.message||error),'error',8000);
    }
  },

  localProjectSuggestion(omie){
    const key=U.projectCodeKey(omie.name||omie.code);
    return State.projects.find(project=>[project.proposal,project.name].some(value=>U.projectCodeKey(value)===key));
  },

  async configure(){
    if(!this.assertOwner()) return;
    try{
      UI.loading(true,'Carregando projetos e categorias do Omie…');
      const data=await this.request('catalog');
      UI.loading(false);
      const projectMappings=new Map((data.projectMappings||[]).map(item=>[String(item.omieProjectCode),item]));
      const categoryMappings=new Map((data.categoryMappings||[]).map(item=>[String(item.omieCategoryCode),item]));
      const projects=(data.projects||[]).map((item,index)=>{
        const saved=projectMappings.get(String(item.code));
        const suggestion=this.localProjectSuggestion(item);
        return {...item,index,selected:saved?.cliqueProjectId||suggestion?.id||'',enabled:saved?saved.enabled!==false:!!suggestion};
      });
      const categories=(data.categories||[]).map((item,index)=>{
        const saved=categoryMappings.get(String(item.code));
        const suggestion=State.categories.find(category=>Biz.sameCategory(category.name,item.name));
        return {...item,index,selected:saved?.cliqueCategoryId||suggestion?.id||'',enabled:saved?saved.enabled!==false:!!suggestion};
      });
      this.catalog={projects,categories};
      UI.modal({title:'Mapeamento Omie → CliqueObras',wide:true,body:`
        <div class="omie-auto-config"><label class="check-item"><input id="omie-auto-sync" type="checkbox" ${data.connection?.autoSync?'checked':''}><span><b>Sincronização automática</b><small>Consulta somente os projetos ativos abaixo.</small></span></label><div><label>Frequência</label><select id="omie-auto-interval"><option value="15" ${Number(data.connection?.autoIntervalMinutes)===15?'selected':''}>A cada 15 minutos</option><option value="60" ${![15,360,1440].includes(Number(data.connection?.autoIntervalMinutes))?'selected':''}>A cada hora</option><option value="360" ${Number(data.connection?.autoIntervalMinutes)===360?'selected':''}>A cada 6 horas</option><option value="1440" ${Number(data.connection?.autoIntervalMinutes)===1440?'selected':''}>Diariamente</option></select></div></div>
        <div class="tabs omie-tabs"><button class="tab active" id="omie-tab-projects">Projetos (${projects.length})</button><button class="tab" id="omie-tab-categories">Categorias (${categories.length})</button></div>
        <div id="omie-map-projects">${this.projectRows(projects)}</div><div id="omie-map-categories" hidden>${this.categoryRows(categories)}</div>
        <div class="permission-banner" style="margin-top:12px"><i data-lucide="info"></i><span>Lançamentos sem projeto ou categoria mapeada ficam pendentes e não são incluídos no realizado.</span></div>`,
        footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="omie-mapping-save"><i data-lucide="check"></i>Salvar mapeamentos</button>',
        onOpen:()=>{
          document.getElementById('omie-tab-projects').onclick=()=>this.showMappingTab('projects');
          document.getElementById('omie-tab-categories').onclick=()=>this.showMappingTab('categories');
          document.getElementById('omie-mapping-save').onclick=()=>this.saveMappings();
        }
      });
    }catch(error){UI.loading(false);UI.toast('Não foi possível carregar o catálogo Omie: '+U.esc(error.message||error),'error',8000);}
  },

  projectRows(projects){
    return `<div class="omie-map-list">${projects.map(item=>`<div class="omie-map-row"><input class="omie-project-enabled" data-index="${item.index}" type="checkbox" ${item.enabled?'checked':''} aria-label="Sincronizar projeto"><div><b>${U.esc(item.name||'Projeto Omie')}</b><small>Código Omie: ${U.esc(item.code)}</small></div><i data-lucide="arrow-right"></i><select class="omie-project-target" data-index="${item.index}"><option value="">Não vincular</option>${State.projects.map(project=>`<option value="${U.esc(project.id)}" ${String(project.id)===String(item.selected)?'selected':''}>${U.esc(U.projLabel(project))}</option>`).join('')}</select></div>`).join('')||'<div class="empty">Nenhum projeto ativo retornado pelo Omie.</div>'}</div>`;
  },

  categoryRows(categories){
    return `<div class="omie-map-list">${categories.map(item=>`<div class="omie-map-row"><input class="omie-category-enabled" data-index="${item.index}" type="checkbox" ${item.enabled?'checked':''} aria-label="Sincronizar categoria"><div><b>${U.esc(item.name||'Categoria Omie')}</b><small>Código Omie: ${U.esc(item.code)}</small></div><i data-lucide="arrow-right"></i><select class="omie-category-target" data-index="${item.index}"><option value="">Não importar</option>${Biz.uniqueCategories().map(category=>`<option value="${U.esc(category.id)}" ${String(category.id)===String(item.selected)?'selected':''}>${U.esc(category.name)}</option>`).join('')}</select></div>`).join('')||'<div class="empty">Nenhuma categoria de despesa retornada pelo Omie.</div>'}</div>`;
  },

  showMappingTab(tab){
    const projects=tab==='projects';
    document.getElementById('omie-map-projects').hidden=!projects;
    document.getElementById('omie-map-categories').hidden=projects;
    document.getElementById('omie-tab-projects').classList.toggle('active',projects);
    document.getElementById('omie-tab-categories').classList.toggle('active',!projects);
  },

  async saveMappings(){
    const projectMappings=[...document.querySelectorAll('.omie-project-target')].map(select=>{
      const item=this.catalog.projects[Number(select.dataset.index)], project=State.projects.find(row=>String(row.id)===String(select.value));
      return {omieProjectCode:String(item.code),omieProjectName:String(item.name||''),cliqueProjectId:String(select.value||''),enabled:document.querySelector(`.omie-project-enabled[data-index="${select.dataset.index}"]`).checked&&!!project};
    }).filter(item=>item.cliqueProjectId);
    const categoryMappings=[...document.querySelectorAll('.omie-category-target')].map(select=>{
      const item=this.catalog.categories[Number(select.dataset.index)], category=State.categories.find(row=>String(row.id)===String(select.value));
      return {omieCategoryCode:String(item.code),omieCategoryName:String(item.name||''),cliqueCategoryId:String(select.value||''),cliqueCategoryName:String(category?.name||''),enabled:document.querySelector(`.omie-category-enabled[data-index="${select.dataset.index}"]`).checked&&!!category};
    }).filter(item=>item.cliqueCategoryId);
    if(!projectMappings.some(item=>item.enabled)||!categoryMappings.some(item=>item.enabled))
      return UI.toast('Ative pelo menos um projeto e uma categoria para sincronizar.','warn',6500);
    try{
      UI.loading(true,'Salvando mapeamentos seguros…');
      await this.request('save-config',{projectMappings,categoryMappings,autoSync:document.getElementById('omie-auto-sync').checked,autoIntervalMinutes:Number(document.getElementById('omie-auto-interval').value)});
      UI.loading(false);UI.closeAll();UI.toast('Projetos e categorias do Omie foram vinculados.','success',6500);await this.load();
    }catch(error){UI.loading(false);UI.toast('Não foi possível salvar os mapeamentos: '+U.esc(error.message||error),'error',7500);}
  },

  async syncForm(){
    try{
      UI.loading(true,'Carregando projetos vinculados…');
      const data=await this.request('status'); UI.loading(false);
      const projects=(data.projectMappings||[]).filter(item=>item.enabled);
      if(!projects.length) return UI.toast('Configure ao menos um projeto antes de sincronizar.','warn',6000);
      UI.modal({title:'Sincronização manual do Omie',body:`<p style="font-size:.84rem;color:var(--text2);margin-bottom:12px">Escolha os projetos que deseja consultar agora.</p><div class="check-list" id="omie-sync-projects">${projects.map(item=>`<label class="check-item"><input type="checkbox" value="${U.esc(item.omieProjectCode)}" checked><span><b>${U.esc(item.omieProjectName)}</b><small>${U.esc(U.projLabel(State.projects.find(project=>String(project.id)===String(item.cliqueProjectId))))}</small></span></label>`).join('')}</div>`,footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="omie-sync-confirm"><i data-lucide="refresh-cw"></i>Sincronizar selecionados</button>',onOpen:()=>{document.getElementById('omie-sync-confirm').onclick=()=>this.sync();}});
    }catch(error){UI.loading(false);UI.toast(U.esc(error.message||error),'error',7000);}
  },

  async sync(){
    const projectCodes=[...document.querySelectorAll('#omie-sync-projects input:checked')].map(input=>input.value);
    if(!projectCodes.length) return UI.toast('Selecione pelo menos um projeto.','warn');
    try{
      UI.loading(true,'Sincronizando contas a pagar do Omie…');
      const result=await this.request('sync',{projectCodes});
      await DB.syncFromCloud(); await State.reload();
      UI.loading(false);UI.closeAll();App.render();
      UI.toast(`Omie sincronizado: ${Number(result.imported)||0} incluído(s), ${Number(result.updated)||0} atualizado(s), ${Number(result.cancelled)||0} cancelado(s) e ${Number(result.skipped)||0} pendente(s).`,'success',9000);
      await this.load();
    }catch(error){UI.loading(false);UI.toast('Falha na sincronização Omie: '+U.esc(error.message||error),'error',9000);}
  },

  disconnect(){
    if(!this.assertOwner()) return;
    UI.confirm('Desvincular o Omie desta organização? A sincronização automática será interrompida e as credenciais serão removidas do cofre. Os lançamentos já importados e seus históricos serão preservados.',async()=>{
      try{UI.loading(true,'Removendo vínculo seguro…');await this.request('disconnect');UI.loading(false);UI.closeAll();UI.toast('Omie desvinculado. As importações manuais permanecem disponíveis.','success',7500);await this.load();}
      catch(error){UI.loading(false);UI.toast('Não foi possível desvincular: '+U.esc(error.message||error),'error',7500);}
    },false);
  }
};
