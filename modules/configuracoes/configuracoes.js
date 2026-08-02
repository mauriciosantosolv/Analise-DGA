/**
 * Módulo Configurações (configuracoes.js)
 *
 * Responsabilidades:
 * - tela de configurações da empresa, marca, jornada e documentos
 * - tela e rotinas de backup: exportar e restaurar
 *
 * Dependências:
 * - database
 * - utils
 *
 * Não modificar:
 * - formato do arquivo de backup (app: ccf_obras)
 */

/* ===== Backup / Restauração / Exportar banco ===== */
const Backup = {
  MAX_FILE_BYTES:20*1024*1024,
  MAX_ROWS_PER_STORE:100000,
  cleanValue(value,depth=0){
    if(depth>8) throw new Error('O backup possui dados aninhados além do limite permitido.');
    if(value==null || typeof value==='boolean' || typeof value==='number') return value;
    if(typeof value==='string') return value.slice(0,20000);
    if(Array.isArray(value)){
      if(value.length>this.MAX_ROWS_PER_STORE) throw new Error('O backup possui uma lista acima do limite permitido.');
      return value.map(item=>this.cleanValue(item,depth+1));
    }
    if(typeof value==='object'){
      const out={};
      const entries=Object.entries(value);
      if(entries.length>500) throw new Error('Um registro do backup possui campos em excesso.');
      for(const [key,item] of entries){
        if(['__proto__','prototype','constructor'].includes(key)) continue;
        out[String(key).slice(0,120)]=this.cleanValue(item,depth+1);
      }
      return out;
    }
    return null;
  },
  validate(data){
    if(!data || data.app!=='ccf_obras' || ![1,2].includes(Number(data.version??1)))
      throw new Error('Arquivo não é um backup válido deste sistema.');
    const clean={};
    for(const store of DB.STORES){
      const rows=data[store]??[];
      if(!Array.isArray(rows)) throw new Error(`A seção ${store} do backup é inválida.`);
      if(rows.length>this.MAX_ROWS_PER_STORE) throw new Error(`A seção ${store} excede o limite de registros.`);
      clean[store]=rows.map(row=>{
        const item=this.cleanValue(row);
        if(!item || item.id==null || String(item.id).length>200)
          throw new Error(`A seção ${store} contém um registro sem identificador válido.`);
        if(store==='settings' && ['companyLogo','pdfLetterhead'].includes(item.id))
          item.value=U.safeImageSrc(item.value);
        if(store==='clients' && item.logo)
          item.logo=U.safeImageSrc(item.logo);
        if(store==='crew' && item.photo)
          item.photo=U.safeImageSrc(item.photo);
        return item;
      });
    }
    return clean;
  },
  async export(){
    const data = {app:'ccf_obras', version:1, exportedAt:new Date().toISOString()};
    for(const s of DB.STORES) data[s] = await DB.all(s);
    U.download(`backup-financeiro-${U.isoDate(new Date())}.json`, JSON.stringify(data, null, 1), 'application/json');
    UI.toast('Backup exportado com sucesso', 'success');
  },
  restore(){
    const inp = document.getElementById('json-input');
    inp.onchange = () => {
      const f = inp.files[0]; inp.value = '';
      if(!f) return;
      if(f.size>this.MAX_FILE_BYTES)
        return UI.toast('O backup excede o limite de 20 MB. Divida a restauração ou solicite suporte.','error',7000);
      const fr = new FileReader();
      fr.onload = async e => {
        try{
          const data = JSON.parse(e.target.result);
          const clean=this.validate(data);
          const total=DB.STORES.reduce((sum,store)=>sum+clean[store].length,0);
          UI.confirm(`O arquivo contém <b>${total.toLocaleString('pt-BR')} registro(s)</b>. Antes da mesclagem, o sistema exportará automaticamente uma cópia do estado atual. Continuar?`, async () => {
            UI.loading(true, 'Restaurando backup…');
            try{
              await this.export();
              for(const s of DB.STORES) if(clean[s].length) await DB.bulkPut(s, clean[s]);
              await State.reload();
              UI.loading(false); UI.toast('Backup validado e restaurado', 'success'); App.render();
            }catch(err){
              UI.loading(false);
              UI.toast('A restauração foi interrompida: '+U.esc(err.message),'error',8000);
            }
          }, false);
        }catch(err){ UI.toast('Erro: '+U.esc(err.message), 'error', 6000); }
      };
      fr.readAsText(f);
    };
    inp.click();
  }
};

/* ---------- CONFIGURAÇÕES ---------- */
Views.configuracoes = {
  title:'Configurações',
  permissionModules:[
    ['projects','Projetos','Cadastro e acompanhamento das obras'],
    ['budgets','Orçamentos','Custos orçados e valores de venda'],
    ['purchases','Financeiro','Compras, contas pagas e mão de obra'],
    ['planning','Planejamento','Gastos futuros e calendário'],
    ['rdos','Diários de Obra','Preenchimento e consulta dos RDOs autorizados'],
    ['measurements','Medições','Medições e faturamento'],
    ['crew','Colaboradores','Equipe disponível para os diários'],
    ['labor_rates','Valores HH','Custos e valores comerciais por projeto'],
    ['rdo_financial','Apuração HH','Snapshots de custo e venda dos RDOs aprovados'],
    ['clients','Clientes','Cadastro de clientes'],
    ['categories','Categorias','Padronização das categorias'],
    ['settings','Configurações financeiras','Empresa, ticker e base de cálculo']
  ],
  defaultPermissions(role){
    const all=this.permissionModules.map(x=>x[0]);
    if(role==='editor') return {view:all,edit:all,manage_users:false};
    if(role==='viewer') return {
      view:all.filter(x=>!['labor_rates','rdo_financial'].includes(x)),
      edit:[],
      manage_users:false,
      rdo_projects:[]
    };
    return {view:all,edit:all,manage_users:true};
  },
  render(){
    const tickerSetting=State.settings.tickerProjects;
    const tickerSelected=new Set(Array.isArray(tickerSetting)?tickerSetting:State.projects.map(p=>p.id));
    const cloudConnected=typeof Cloud!=='undefined' && Cloud.active();
    const org=cloudConnected?Cloud.organization():null;
    const currentRole=cloudConnected?Cloud.role():'';
    const currentUser=cloudConnected?(Cloud.user()||{}):{};
    const currentDisplayName=String((currentUser.user_metadata&&currentUser.user_metadata.full_name)||'').trim();
    const canManageCompany=!cloudConnected||['owner','admin'].includes(currentRole);
    $c().innerHTML = `
      <div class="settings-page">
      ${cloudConnected?`<section class="card settings-card settings-card-wide settings-account">
        <div style="display:flex;align-items:center;gap:13px;flex-wrap:wrap">
          <div class="account-summary" style="padding:0;flex:1;min-width:0"><i data-lucide="user-circle"></i><div><b id="cfg-profile-current-name">${U.esc(currentDisplayName||currentUser.email||'Usuário')}</b><small><span>${U.esc(currentUser.email||'')}</span><span class="organization-chip"><i data-lucide="building-2"></i>${U.esc(org?org.name:'Organização')}</span><span>${U.esc(({owner:'Proprietário',admin:'Administrador',editor:'Editor',viewer:'Leitor'}[currentRole]||currentRole))}</span></small></div></div>
          <button class="btn btn-primary btn-sm" onclick="App.syncCloudNow()"><i data-lucide="refresh-cw"></i>Sincronizar</button>
        </div>
        ${Cloud.organizations().length>1?`<div style="margin-top:12px;max-width:420px"><label>Organização ativa</label><select id="cfg-active-org">${Cloud.organizations().map(x=>`<option value="${U.esc(x.id)}" ${x.id===org.id?'selected':''}>${U.esc(x.name)}</option>`).join('')}</select></div>`:''}
        <div class="profile-name-editor">
          <label for="cfg-user-name">Seu nome no sistema</label>
          <div class="profile-name-row">
            <input id="cfg-user-name" type="text" maxlength="100" autocomplete="name" value="${U.esc(currentDisplayName)}" placeholder="Digite seu nome">
            <button class="btn btn-primary" id="cfg-user-name-save" type="button"><i data-lucide="check"></i>Salvar meu nome</button>
          </div>
          <small>Este nome aparece no perfil e para os demais usuários da organização.</small>
        </div>
      </section>`:''}
      <section class="card settings-card settings-card-wide settings-company" id="company-settings-card">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <div style="flex:1"><h2>Configurações da empresa</h2><p style="font-size:.84rem;color:var(--text2)">Identidade da organização, logotipo, funcionários e permissões em um único lugar.</p></div>
          ${cloudConnected&&canManageCompany?'<button class="btn btn-primary btn-sm" onclick="Views.configuracoes.inviteForm()"><i data-lucide="user-plus"></i>Convidar usuário</button>':''}
        </div>
        <div class="form-grid">
          <div><label>Nome da empresa</label><input id="cfg-name" maxlength="120" value="${U.esc(cloudConnected?(org?.name||''):(State.settings.companyName||''))}" placeholder="Nome da organização" ${canManageCompany?'':'disabled'}></div>
          <div><label>CNPJ da empresa</label><input id="cfg-cnpj" inputmode="numeric" maxlength="18" value="${U.esc(U.formatCnpj(State.settings.companyCnpj||''))}" placeholder="00.000.000/0000-00" ${canManageCompany?'':'disabled'}><small>Será exibido nos documentos PDF.</small></div>
          <div class="full" style="display:flex;gap:12px;align-items:center">
            <div id="cfg-logo-preview">${U.safeImageSrc(State.settings.companyLogo)?`<img class="avatar logo-clean" style="width:48px;height:48px" src="${U.esc(U.safeImageSrc(State.settings.companyLogo))}">`:`<span class="avatar-ph" style="width:48px;height:48px"><i data-lucide="zap" style="width:18px;height:18px"></i></span>`}</div>
            ${canManageCompany?'<button class="btn btn-ghost btn-sm" id="cfg-logo-btn"><i data-lucide="image-plus"></i>Alterar logo</button>':'<small style="color:var(--text3)">Somente proprietário ou administrador pode alterar a identidade da empresa.</small>'}</div>
          <div class="full company-settings-section">
            <div class="company-settings-heading"><span><i data-lucide="clock-3"></i></span><div><h3>Jornada padrão dos RDOs</h3><small>Estes valores preenchem todos os colaboradores. O que exceder o limite diário será lançado como hora extra.</small></div></div>
            <div class="company-shift-grid">
              <div><label>Entrada padrão</label><input id="cfg-rdo-start" type="time" value="${U.esc(State.settings.rdoShiftStart||'07:30')}" ${canManageCompany?'':'disabled'}></div>
              <div><label>Saída padrão</label><input id="cfg-rdo-end" type="time" value="${U.esc(State.settings.rdoShiftEnd||'17:18')}" ${canManageCompany?'':'disabled'}></div>
              <div><label>Intervalo (min)</label><input id="cfg-rdo-break" type="number" min="0" max="360" step="5" value="${Number.isFinite(Number(State.settings.rdoShiftBreakMinutes))?Number(State.settings.rdoShiftBreakMinutes):60}" ${canManageCompany?'':'disabled'}></div>
              <div><label>Horas normais/dia</label><input id="cfg-rdo-daily-hours" type="number" min="0.25" max="24" step="0.01" value="${Number(State.settings.rdoDailyHours)||8.8}" ${canManageCompany?'':'disabled'}><small>Ex.: 8,8 horas</small></div>
            </div>
          </div>
          <div class="full company-settings-section">
            <div class="company-settings-heading"><span><i data-lucide="file-image"></i></span><div><h3>Papel timbrado dos PDFs</h3><small>Envie uma imagem JPG ou PNG em proporção A4. A escala será preservada no RDO, na medição e nos relatórios do dashboard.</small></div></div>
            <div class="letterhead-control">
              <div id="cfg-letterhead-preview">${U.safeImageSrc(State.settings.pdfLetterhead)?`<img src="${U.esc(U.safeImageSrc(State.settings.pdfLetterhead))}" alt="Prévia do papel timbrado">`:'<span><i data-lucide="image"></i>Sem papel timbrado</span>'}</div>
              ${canManageCompany?`<div><button class="btn btn-ghost btn-sm" id="cfg-letterhead-btn" type="button"><i data-lucide="upload"></i>${State.settings.pdfLetterhead?'Substituir imagem':'Adicionar JPG/PNG'}</button>${State.settings.pdfLetterhead?'<button class="btn btn-ghost btn-sm" id="cfg-letterhead-remove" type="button"><i data-lucide="trash-2"></i>Remover</button>':''}</div>`:''}
            </div>
          </div>
        </div>
        ${canManageCompany?`<div style="margin-top:16px;display:flex;justify-content:flex-end">
          <button class="btn btn-primary" id="cfg-company-save"><i data-lucide="check"></i>Salvar empresa</button></div>`:''}
        ${cloudConnected?`<div class="settings-company-team">
          <div style="margin:20px 0 8px"><h3>Funcionários e acessos</h3><p style="font-size:.84rem;color:var(--text2)">${canManageCompany?'Gerencie os usuários e o acesso aos módulos da empresa.':'Esta área é administrada somente pelo proprietário e pelos administradores.'}</p></div>
          <div id="team-content"><div class="empty"><i data-lucide="loader-2"></i><br>Carregando equipe…</div></div>
        </div>`:''}
      </section>
      <section class="card settings-card settings-card-wide settings-ticker">
        <h2 style="margin-bottom:6px">Projetos no ticker financeiro</h2>
        <p style="font-size:.84rem;color:var(--text2);margin-bottom:12px">Escolha quais projetos terão saldo passando na faixa superior do sistema.</p>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn btn-ghost btn-sm" id="ticker-all">Selecionar todos</button>
          <button class="btn btn-ghost btn-sm" id="ticker-none">Limpar seleção</button>
        </div>
        <div class="check-list" id="ticker-projects">
          ${State.projects.map(p=>`<label class="check-item"><input type="checkbox" value="${U.esc(p.id)}" ${tickerSelected.has(p.id)?'checked':''}><span><b>${U.esc(p.proposal||'Projeto')}</b><small style="display:block;color:var(--text3)">${U.esc(p.name||p.client||'')}</small></span></label>`).join('')
            || '<small style="color:var(--text3)">Cadastre um projeto para configurar o ticker.</small>'}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn btn-primary" id="ticker-save"><i data-lucide="check"></i>Salvar ticker</button></div>
      </section>
      <section class="card settings-card settings-card-wide">
        <h2 style="margin-bottom:6px">Base de dados em nuvem</h2>
        ${cloudConnected?`<p style="font-size:.84rem;color:var(--text2)">Conectado como <b>${U.esc((Cloud.user()||{}).email||'usuário autenticado')}</b>. ${Cloud.pendingCount()?`Há ${Cloud.pendingCount()} alteração(ões) aguardando sincronização.`:'Todos os registros locais estão sincronizados.'}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-primary btn-sm" onclick="App.syncCloudNow()"><i data-lucide="upload-cloud"></i>Sincronizar agora</button><button class="btn btn-ghost btn-sm" onclick="App.logoutCloud()"><i data-lucide="log-out"></i>Sair neste aparelho</button></div>`
          :`<p style="font-size:.84rem;color:var(--text2)">A nuvem ainda não está ativa. Siga o arquivo <b>README-INSTALACAO-NUVEM.md</b> antes de publicar a versão definitiva.</p>`}
      </section>
      <section class="card settings-card settings-card-wide">
        <h2 style="margin-bottom:6px">Modelos das bases financeiras</h2>
        <p style="font-size:.84rem;color:var(--text2);margin-bottom:14px">Cada base mantém seu próprio modelo. A substituição salva apenas os cabeçalhos e o mapeamento; nenhum lançamento já importado é alterado ou apagado.</p>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px">
          ${Object.entries(Importer.KIND_LABELS).map(([kind,label])=>{const m=(State.settings.importMappings||{})[kind];const learned=m&&m.fields?Object.values(m.fields).filter(Boolean):[];return `<div class="card" style="padding:13px;background:var(--surface2)"><b>${label}</b><small style="display:block;color:var(--text3);margin:5px 0 10px">${m?`Modelo: ${U.esc(m.fileName)}<br>${learned.length} coluna(s) reconhecida(s) · salvo em ${U.date(m.savedAt)}`:'Reconhecimento padrão por cabeçalho'}</small><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="Importer.pickModel('${kind}')"><i data-lucide="upload"></i>${m?'Substituir':'Cadastrar'} modelo</button>${m?`<button class="btn btn-ghost btn-sm" onclick="Importer.clearModel('${kind}')">Remover</button>`:''}</div></div>`;}).join('')}
        </div>
      </section>
      <section class="card settings-card settings-card-wide">
        <h3 style="margin-bottom:8px">Atalhos rápidos</h3>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="App.go('categorias')"><i data-lucide="tags"></i>Categorias</button>
          <button class="btn btn-ghost btn-sm" onclick="App.go('basecalculo')"><i data-lucide="percent"></i>Base de Cálculo</button>
          <button class="btn btn-ghost btn-sm" onclick="App.go('backup')"><i data-lucide="database-backup"></i>Backup e Restauração</button>
        </div>
      </section>
      </div>`;
    let logo = U.safeImageSrc(State.settings.companyLogo);
    let letterhead = U.safeImageSrc(State.settings.pdfLetterhead);
    if(cloudConnected && Cloud.organizations().length>1)
      document.getElementById('cfg-active-org').onchange=async e=>{
        try{
          UI.loading(true,'Trocando organização…');
          await Cloud.switchOrganization(e.target.value);
        }catch(err){
          UI.loading(false);
          UI.toast('Não foi possível trocar a organização: '+U.esc(err.message||err),'error',6500);
        }
      };
    if(cloudConnected){
      document.getElementById('cfg-user-name-save').onclick=()=>this.saveOwnName();
      document.getElementById('cfg-user-name').onkeydown=e=>{
        if(e.key==='Enter'){ e.preventDefault(); this.saveOwnName(); }
      };
    }
    const logoButton=document.getElementById('cfg-logo-btn');
    if(logoButton) logoButton.onclick = () => {
      const inp = document.getElementById('img-input');
      inp.accept='image/png,image/jpeg,image/webp';
      inp.onchange = () => { const f = inp.files[0]; inp.value=''; if(!f) return;
        const fr = new FileReader();
        fr.onload = async e => {
          try{
            logo = await U.resizeImage(e.target.result);
            document.getElementById('cfg-logo-preview').innerHTML = `<img class="avatar logo-clean" style="width:48px;height:48px" src="${U.esc(logo)}">`;
          }catch(err){ UI.toast(U.esc(err.message),'error',6000); }
        };
        fr.readAsDataURL(f); };
      inp.click();
    };
    const letterheadButton=document.getElementById('cfg-letterhead-btn');
    const clearLetterhead=()=>{
      letterhead='';
      document.getElementById('cfg-letterhead-preview').innerHTML='<span><i data-lucide="image"></i>Sem papel timbrado</span>';
      document.getElementById('cfg-letterhead-remove')?.remove();
      letterheadButton.innerHTML='<i data-lucide="upload"></i>Adicionar JPG/PNG';
      U.icons();
    };
    const ensureLetterheadRemove=()=>{
      let button=document.getElementById('cfg-letterhead-remove');
      if(!button){
        button=document.createElement('button');
        button.className='btn btn-ghost btn-sm';
        button.id='cfg-letterhead-remove';
        button.type='button';
        button.innerHTML='<i data-lucide="trash-2"></i>Remover';
        letterheadButton.after(button);
      }
      button.onclick=clearLetterhead;
    };
    if(letterheadButton&&letterhead) ensureLetterheadRemove();
    if(letterheadButton) letterheadButton.onclick=()=>{
      const input=document.getElementById('img-input');
      input.accept='.jpg,.jpeg,.png,image/jpeg,image/png';
      input.onchange=()=>{
        const file=input.files[0]; input.value=''; if(!file) return;
        const type=String(file.type||'').toLowerCase();
        const outputType=type==='image/png'||/\.png$/i.test(file.name||'')?'image/png':
          (type==='image/jpeg'||/\.jpe?g$/i.test(file.name||'')?'image/jpeg':'');
        if(!outputType)
          return UI.toast('O papel timbrado deve estar em formato JPG ou PNG.','warn',5500);
        const reader=new FileReader();
        reader.onload=async event=>{
          try{
            letterhead=await U.resizeImage(event.target.result,1800,outputType,outputType==='image/png'?1:.88);
            document.getElementById('cfg-letterhead-preview').innerHTML=`<img src="${U.esc(letterhead)}" alt="Prévia do papel timbrado">`;
            letterheadButton.innerHTML='<i data-lucide="upload"></i>Substituir imagem';
            ensureLetterheadRemove();
            U.icons();
          }catch(err){UI.toast(U.esc(err.message||err),'error',6500);}
        };
        reader.readAsDataURL(file);
      };
      input.click();
    };
    document.getElementById('ticker-all').onclick=()=>document.querySelectorAll('#ticker-projects input[type=checkbox]').forEach(x=>x.checked=true);
    document.getElementById('ticker-none').onclick=()=>document.querySelectorAll('#ticker-projects input[type=checkbox]').forEach(x=>x.checked=false);
    document.getElementById('ticker-save').onclick=async()=>{
      const ids=[...document.querySelectorAll('#ticker-projects input[type=checkbox]:checked')].map(x=>x.value);
      await State.setSetting('tickerProjects',ids);
      UI.toast('Projetos do ticker atualizados','success'); App.renderTicker();
    };
    const companySave=document.getElementById('cfg-company-save');
    if(companySave) companySave.onclick=async()=>{
      const name=document.getElementById('cfg-name').value.trim();
      if(!name) return UI.toast('Informe o nome da empresa.','warn');
      const cnpj=U.formatCnpj(document.getElementById('cfg-cnpj').value);
      if(cnpj&&!U.validCnpj(cnpj)) return UI.toast('Informe um CNPJ válido.','warn',5500);
      const shiftStart=document.getElementById('cfg-rdo-start').value;
      const shiftEnd=document.getElementById('cfg-rdo-end').value;
      const shiftBreak=U.num(document.getElementById('cfg-rdo-break').value);
      const dailyHours=U.num(document.getElementById('cfg-rdo-daily-hours').value);
      if(!shiftStart||!shiftEnd||shiftBreak<0||shiftBreak>360||dailyHours<=0||dailyHours>24)
        return UI.toast('Revise a jornada padrão do RDO.','warn',5500);
      try{
        UI.loading(true,'Salvando configurações da empresa…');
        if(cloudConnected) await Cloud.updateOrganizationName(name);
        await State.setSetting('companyName',name);
        await State.setSetting('companyCnpj',cnpj);
        await State.setSetting('companyLogo',logo);
        await State.setSetting('rdoShiftStart',shiftStart);
        await State.setSetting('rdoShiftEnd',shiftEnd);
        await State.setSetting('rdoShiftBreakMinutes',shiftBreak);
        await State.setSetting('rdoDailyHours',dailyHours);
        await State.setSetting('pdfLetterhead',letterhead);
        UI.loading(false);
        App.applyBranding(); App.applyStorageStatus();
        UI.toast('Configurações da empresa salvas','success');
      }catch(err){
        UI.loading(false);
        UI.toast('Não foi possível salvar a empresa: '+U.esc(err.message||err),'error',7000);
      }
    };
    const cnpjInput=document.getElementById('cfg-cnpj');
    if(cnpjInput&&!cnpjInput.disabled) cnpjInput.oninput=()=>{cnpjInput.value=U.formatCnpj(cnpjInput.value);};
    if(cloudConnected) this.loadTeam();
    U.icons();
  },
  async saveOwnName(){
    const input=document.getElementById('cfg-user-name');
    const clean=String(input&&input.value||'').trim().replace(/\s+/g,' ');
    try{
      UI.loading(true,'Atualizando seu nome…');
      await Cloud.updateDisplayName(clean);
      UI.loading(false);
      if(input) input.value=clean;
      const summary=document.getElementById('cfg-profile-current-name');
      if(summary) summary.textContent=clean;
      App.applyBranding();
      UI.toast('Seu nome foi atualizado','success');
      await this.loadTeam();
    }catch(err){
      UI.loading(false);
      UI.toast('Não foi possível atualizar seu nome: '+U.esc(err.message),'error',6500);
      if(input) input.focus();
    }
  },
  async loadTeam(){
    const box=document.getElementById('team-content'); if(!box) return;
    if(!Cloud.canManageUsers()){
      box.innerHTML='<div class="permission-banner" style="margin-top:12px"><i data-lucide="shield"></i><span>Somente o proprietário e os administradores podem gerenciar funcionários e permissões.</span></div>';
      U.icons(); return;
    }
    try{
      this.teamData=await Cloud.listTeam();
      this.renderTeam();
    }catch(err){
      box.innerHTML=`<div class="permission-banner"><i data-lucide="alert-triangle"></i><span>Não foi possível carregar a equipe: ${U.esc(err.message)}</span></div>`;
      U.icons();
    }
  },
  renderTeam(){
    const box=document.getElementById('team-content'); if(!box||!this.teamData) return;
    const currentId=(Cloud.user()||{}).id;
    const roleLabels={owner:'Proprietário',admin:'Administrador',editor:'Editor',viewer:'Leitor'};
    const members=this.teamData.members||[], invitations=this.teamData.invitations||[];
    const currentRole=Cloud.role();
    box.innerHTML=`
      <div class="table-wrap"><div class="table-scroll"><table class="team-table">
        <thead><tr><th>Usuário</th><th>Perfil</th><th>Permissões</th><th style="width:110px"></th></tr></thead>
        <tbody>${members.map(m=>{const profile=m.profile||{};const locked=m.role==='owner'||(m.role==='admin'&&currentRole!=='owner');return `
          <tr><td><b>${U.esc(profile.full_name||profile.email||'Usuário')}</b><br><small>${U.esc(profile.email||m.user_id)}${m.user_id===currentId?' · você':''}</small></td>
          <td><span class="tag ${locked?'tag-blue':'tag-gray'}">${U.esc(roleLabels[m.role]||m.role)}</span></td>
          <td><small>${locked||m.role==='admin'?'Acesso completo':`${(m.permissions?.view||[]).length} módulo(s) para visualizar · ${(m.permissions?.edit||[]).length} para editar · ${(m.permissions?.rdo_projects||[]).length} projeto(s) no RDO`}</small></td>
          <td>${locked?'':`<div style="display:flex;gap:5px"><button class="btn btn-ghost btn-sm" onclick="Views.configuracoes.memberPermissionForm(${U.jsArg(m.user_id)})" title="Editar permissões"><i data-lucide="shield-check"></i></button>${m.user_id!==currentId?`<button class="btn btn-danger btn-sm" onclick="Views.configuracoes.removeMember(${U.jsArg(m.user_id)})" title="Remover da organização"><i data-lucide="user-minus"></i></button>`:''}</div>`}</td></tr>`;}).join('')}</tbody>
      </table></div></div>
      ${invitations.length?`<h3 style="margin:18px 0 8px">Convites pendentes</h3><div class="table-wrap"><div class="table-scroll"><table>
        <thead><tr><th>E-mail</th><th>Perfil</th><th>Enviado em</th><th></th></tr></thead>
        <tbody>${invitations.map(i=>`<tr><td><b>${U.esc(i.email)}</b></td><td>${U.esc(roleLabels[i.role]||i.role)}</td><td>${U.date(i.created_at)}</td><td><button class="btn btn-ghost btn-sm" onclick="Views.configuracoes.cancelInvitation(${U.jsArg(i.id)})"><i data-lucide="x"></i>Cancelar</button></td></tr>`).join('')}</tbody>
      </table></div></div>`:''}`;
    U.icons();
  },
  permissionControls(permissions,roleName){
    const p=permissions||this.defaultPermissions(roleName);
    const view=new Set(p.view||[]), edit=new Set(p.edit||[]);
    const canDelegate=Cloud.role()==='owner';
    return `<div class="permission-grid" id="member-permissions">${this.permissionModules.map(([store,label,help])=>`
      <div class="check-item" style="display:grid;grid-template-columns:18px 1fr 18px;gap:8px">
        <input class="perm-view" data-store="${store}" type="checkbox" ${view.has(store)?'checked':''} title="Pode visualizar">
        <span><b>${label}</b><small>${help}</small></span>
        <input class="perm-edit" data-store="${store}" type="checkbox" ${edit.has(store)?'checked':''} title="Pode editar">
      </div>`).join('')}</div>
      <div style="display:flex;gap:22px;margin-top:10px;color:var(--text2);font-size:.78rem"><span>1ª caixa: visualizar</span><span>2ª caixa: editar</span></div>
      <div class="permission-projects">
        <div class="permission-projects-head"><span><b>Projetos disponíveis no RDO</b><small>Somente estes projetos aparecem no preenchimento do diário.</small></span>
          <div><button class="btn btn-ghost btn-sm" type="button" id="perm-projects-all">Todos</button><button class="btn btn-ghost btn-sm" type="button" id="perm-projects-none">Nenhum</button></div>
        </div>
        <div class="check-list permission-project-list" id="member-rdo-projects">
          ${State.projects.map(project=>{
            const selected=(p.rdo_projects||[]).some(item=>String(item.id)===String(project.id));
            return `<label class="check-item"><input class="perm-rdo-project" type="checkbox" value="${U.esc(project.id)}" ${selected?'checked':''}><span><b>${U.esc(project.proposal||'Projeto')}</b><small>${U.esc(project.name||project.client||'')}</small></span></label>`;
          }).join('')||'<small style="color:var(--text3)">Nenhum projeto cadastrado.</small>'}
        </div>
      </div>
      <label class="check-item" style="margin-top:10px"><input id="perm-manage-users" type="checkbox" ${p.manage_users?'checked':''} ${canDelegate?'':'disabled'}><span><b>Gerenciar usuários</b><small>${canDelegate?'Permite convidar leitores e editores; somente o proprietário pode conceder esta delegação.':'Somente o proprietário pode conceder esta permissão.'}</small></span></label>`;
  },
  bindPermissionRole(){
    const role=document.getElementById('member-role');
    const apply=()=>{
      const full=role.value==='admin';
      document.querySelectorAll('#member-permissions input').forEach(input=>{
        if(full) input.checked=true;
        input.disabled=full;
      });
      const manage=document.getElementById('perm-manage-users');
      if(full) manage.checked=true;
      manage.disabled=full || Cloud.role()!=='owner';
    };
    role.onchange=()=>{
      if(role.value==='viewer') document.querySelectorAll('.perm-edit').forEach(x=>x.checked=false);
      apply();
    };
    document.querySelectorAll('.perm-edit').forEach(input=>input.onchange=()=>{
      if(input.checked){
        document.querySelector(`.perm-view[data-store="${input.dataset.store}"]`).checked=true;
        if(input.dataset.store==='rdos'){
          const crew=document.querySelector('.perm-view[data-store="crew"]');
          if(crew) crew.checked=true;
        }
      }
    });
    document.querySelectorAll('.perm-view').forEach(input=>input.onchange=()=>{
      if(!input.checked) document.querySelector(`.perm-edit[data-store="${input.dataset.store}"]`).checked=false;
      if(input.dataset.store==='rdos' && input.checked){
        const crew=document.querySelector('.perm-view[data-store="crew"]');
        if(crew) crew.checked=true;
      }
    });
    const allProjects=document.getElementById('perm-projects-all');
    const noProjects=document.getElementById('perm-projects-none');
    if(allProjects) allProjects.onclick=()=>document.querySelectorAll('.perm-rdo-project').forEach(x=>x.checked=true);
    if(noProjects) noProjects.onclick=()=>document.querySelectorAll('.perm-rdo-project').forEach(x=>x.checked=false);
    apply();
  },
  readPermissionForm(){
    const view=[...document.querySelectorAll('.perm-view:checked')].map(x=>x.dataset.store);
    const edit=[...document.querySelectorAll('.perm-edit:checked')].map(x=>x.dataset.store).filter(x=>view.includes(x));
    const rdo_projects=[...document.querySelectorAll('.perm-rdo-project:checked')].map(input=>{
      const project=State.projects.find(x=>String(x.id)===String(input.value));
      return {id:String(input.value),label:project?U.projLabel(project):'Projeto'};
    });
    return {view,edit,manage_users:document.getElementById('perm-manage-users').checked,rdo_projects};
  },
  inviteForm(){
    const defaults=this.defaultPermissions('viewer');
    const adminOption=Cloud.role()==='owner'?'<option value="admin">Administrador</option>':'';
    UI.modal({title:'Vincular usuário à organização',wide:true,body:`
      <div class="form-grid" style="margin-bottom:14px">
        <div><label>E-mail do usuário *</label><input id="member-email" type="email" placeholder="usuario@empresa.com.br"></div>
        <div><label>Perfil</label><select id="member-role"><option value="viewer">Leitor</option><option value="editor">Editor</option>${adminOption}</select></div>
      </div>
      <p style="font-size:.83rem;color:var(--text2);margin-bottom:10px">Para uma conta nova, o CliqueObras enviará o link de convite por e-mail. Se a pessoa já tiver conta, o acesso será liberado no próximo login.</p>
      ${this.permissionControls(defaults,'viewer')}`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="member-invite-save"><i data-lucide="send"></i>Criar vínculo</button>',
      onOpen:()=>{
        this.bindPermissionRole();
        document.getElementById('member-invite-save').onclick=()=>this.saveInvitation();
      }
    });
  },
  async saveInvitation(){
    const email=document.getElementById('member-email').value.trim();
    const role=document.getElementById('member-role').value;
    const permissions=this.readPermissionForm();
    try{
      UI.loading(true,'Criando vínculo…');
      const result=await Cloud.inviteMember(email,role,permissions);
      UI.loading(false); UI.closeAll();
      UI.toast(result&&result.delivery==='sent'
        ? 'Convite enviado por e-mail. O usuário entrará nesta empresa pelo link recebido.'
        : 'O usuário já possui conta. O acesso será concluído no próximo login.','success',7500);
      await this.loadTeam();
    }catch(err){ UI.loading(false); UI.toast('Não foi possível vincular: '+U.esc(err.message),'error',6500); }
  },
  memberPermissionForm(userId){
    const member=(this.teamData?.members||[]).find(x=>x.user_id===userId); if(!member) return;
    if(member.role==='owner' || (member.role==='admin' && Cloud.role()!=='owner'))
      return UI.toast('Somente o proprietário pode alterar este perfil.','warn',5500);
    const profile=member.profile||{};
    const adminOption=Cloud.role()==='owner'?`<option value="admin" ${member.role==='admin'?'selected':''}>Administrador</option>`:'';
    UI.modal({title:`Permissões — ${U.esc(profile.full_name||profile.email||'Usuário')}`,wide:true,body:`
      <div class="form-grid" style="margin-bottom:14px"><div><label>Perfil</label><select id="member-role"><option value="viewer" ${member.role==='viewer'?'selected':''}>Leitor</option><option value="editor" ${member.role==='editor'?'selected':''}>Editor</option>${adminOption}</select></div><div><label>E-mail</label><input value="${U.esc(profile.email||'')}" disabled></div></div>
      ${this.permissionControls(member.permissions,member.role)}`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="member-permission-save"><i data-lucide="check"></i>Salvar permissões</button>',
      onOpen:()=>{
        this.bindPermissionRole();
        document.getElementById('member-permission-save').onclick=()=>this.saveMemberPermissions(userId);
      }
    });
  },
  async saveMemberPermissions(userId){
    const role=document.getElementById('member-role').value;
    try{
      UI.loading(true,'Salvando permissões…');
      await Cloud.updateMember(userId,role,this.readPermissionForm());
      UI.loading(false); UI.closeAll(); UI.toast('Permissões atualizadas','success');
      await this.loadTeam();
    }catch(err){ UI.loading(false); UI.toast('Não foi possível atualizar: '+U.esc(err.message),'error',6500); }
  },
  removeMember(userId){
    const member=(this.teamData?.members||[]).find(x=>x.user_id===userId);
    const name=member?.profile?.full_name||member?.profile?.email||'este usuário';
    UI.confirm(`Remover <b>${U.esc(name)}</b> desta organização? A conta continuará existindo, mas perderá acesso aos dados compartilhados.`,async()=>{
      try{ await Cloud.removeMember(userId); UI.toast('Usuário removido da organização','warn'); await this.loadTeam(); }
      catch(err){ UI.toast('Não foi possível remover: '+U.esc(err.message),'error',6500); }
    });
  },
  cancelInvitation(id){
    UI.confirm('Cancelar este vínculo pendente?',async()=>{
      try{ await Cloud.cancelInvitation(id); UI.toast('Vínculo pendente cancelado','warn'); await this.loadTeam(); }
      catch(err){ UI.toast('Não foi possível cancelar: '+U.esc(err.message),'error',6500); }
    },false);
  },
  async saveOrganizationName(){
    try{
      await Cloud.updateOrganizationName(document.getElementById('team-org-name').value);
      UI.toast('Nome da organização atualizado','success');
      App.applyStorageStatus();
      App.applyBranding();
    }catch(err){ UI.toast('Não foi possível atualizar: '+U.esc(err.message),'error',6500); }
  }
};

/* ---------- BACKUP ---------- */
Views.backup = {
  title:'Backup',
  render(){
    const counts = { Projetos:State.projects.length, Orçamentos:State.budgets.length, Lançamentos:State.purchases.length,
      Medições:State.measurements.length, RDOs:State.rdos.length, Colaboradores:RDO.crewMembers().length,
      Planejamento:State.planning.length, Clientes:State.clients.length, Categorias:State.categories.length };
    $c().innerHTML = `
      <div class="kpi-grid">${Object.entries(counts).map(([k,v])=>`<div class="kpi"><div class="k-label">${k}</div><div class="k-value">${v}</div></div>`).join('')}</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
        <div class="card"><h3 style="margin-bottom:8px"><i data-lucide="download" style="width:16px;height:16px"></i> Backup em JSON</h3>
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:12px">Exporta todo o banco de dados para um arquivo JSON. Guarde em local seguro.</p>
          <button class="btn btn-primary btn-sm" onclick="Backup.export()">Exportar Backup</button></div>
        <div class="card"><h3 style="margin-bottom:8px"><i data-lucide="upload" style="width:16px;height:16px"></i> Restaurar Backup</h3>
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:12px">Mescla um backup JSON com o banco atual. Nada é apagado.</p>
          <button class="btn btn-ghost btn-sm" onclick="Backup.restore()">Restaurar</button></div>
        <div class="card"><h3 style="margin-bottom:8px"><i data-lucide="file-spreadsheet" style="width:16px;height:16px"></i> Exportar Banco (Excel)</h3>
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:12px">Gera um Excel com todas as tabelas em abas separadas.</p>
          <button class="btn btn-ghost btn-sm" onclick="Views.backup.fullExcel()">Exportar Excel</button></div>
        <div class="card"><h3 style="margin-bottom:8px"><i data-lucide="history" style="width:16px;height:16px"></i> Snapshot Automático</h3>
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:12px">Cópia diária dos dados guardada neste navegador. ${(()=>{ try{ const t = +localStorage.getItem('ccf_snap_time'); return t ? 'Último: ' + U.date(t) : 'Ainda não criado.'; }catch(e){ return '—'; } })()}</p>
          <button class="btn btn-ghost btn-sm" onclick="Views.backup.restoreSnapshot()">Restaurar Snapshot</button></div>
      </div>`;
    U.icons();
  },
  restoreSnapshot(){
    let snap = null;
    try{ snap = JSON.parse(localStorage.getItem('ccf_snap') || 'null'); }catch(e){}
    if(!snap) return UI.toast('Nenhum snapshot disponível ainda.', 'warn');
    let clean;
    try{ clean=Backup.validate(snap); }
    catch(err){ return UI.toast('Snapshot inválido: '+U.esc(err.message),'error',7000); }
    UI.confirm(`Restaurar o snapshot de <b>${U.esc(snap.exportedAt ? U.date(snap.exportedAt) : '—')}</b>? Os dados serão mesclados ao banco atual (nada é apagado).`, async () => {
      UI.loading(true, 'Restaurando snapshot…');
      for(const st of DB.STORES)
        if(clean[st].length) await DB.bulkPut(st, clean[st]);
      await State.reload(); UI.loading(false); UI.toast('Snapshot restaurado', 'success'); App.render();
    }, false);
  },
  fullExcel(){
    const wb = XLSX.utils.book_new();
    ['projects','budgets','purchases'].forEach(s => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Exports.spreadsheetRows(Exports.rows(s))), s));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Exports.spreadsheetRows(State.planning)), 'planning');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Exports.spreadsheetRows(State.measurements)), 'measurements');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Exports.spreadsheetRows(State.rdos)), 'rdos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Exports.spreadsheetRows(RDO.crewMembers())), 'crew');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Exports.spreadsheetRows(RDO.crewRoles())), 'crew_roles');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Exports.spreadsheetRows(State.clients.map(({logo,...c})=>c))), 'clients');
    XLSX.writeFile(wb, `banco-completo-${U.isoDate(new Date())}.xlsx`);
    UI.toast('Banco exportado em Excel', 'success');
  }
};
