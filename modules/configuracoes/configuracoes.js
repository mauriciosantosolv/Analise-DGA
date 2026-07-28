/**
 * Módulo Configurações (configuracoes.js)
 *
 * Responsabilidades:
 * - tela de configurações (tema, moeda, marca)
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
      const fr = new FileReader();
      fr.onload = async e => {
        try{
          const data = JSON.parse(e.target.result);
          if(data.app !== 'ccf_obras') throw new Error('Arquivo não é um backup válido deste sistema.');
          UI.confirm('Restaurar backup irá <b>mesclar</b> os dados do arquivo com o banco atual (registros com mesmo ID são atualizados; nada é apagado). Continuar?', async () => {
            UI.loading(true, 'Restaurando backup…');
            for(const s of DB.STORES) if(Array.isArray(data[s]) && data[s].length) await DB.bulkPut(s, data[s]);
            await State.reload();
            UI.loading(false); UI.toast('Backup restaurado', 'success'); App.render();
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
    ['measurements','Medições','Medições e faturamento'],
    ['clients','Clientes','Cadastro de clientes'],
    ['categories','Categorias','Padronização das categorias'],
    ['settings','Configurações financeiras','Empresa, ticker e base de cálculo']
  ],
  defaultPermissions(role){
    const all=this.permissionModules.map(x=>x[0]);
    if(role==='editor') return {view:all,edit:all,manage_users:false};
    if(role==='viewer') return {view:all,edit:[],manage_users:false};
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
    $c().innerHTML = `
      ${cloudConnected?`<div class="card" style="max-width:900px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:13px;flex-wrap:wrap">
          <div class="account-summary" style="padding:0;flex:1;min-width:240px"><i data-lucide="circle-user-round"></i><div><b id="cfg-profile-current-name">${U.esc(currentDisplayName||currentUser.email||'Usuário')}</b><small>${U.esc(currentUser.email||'')} · <span class="organization-chip"><i data-lucide="building-2"></i>${U.esc(org?org.name:'Organização')}</span> · ${U.esc(({owner:'Proprietário',admin:'Administrador',editor:'Editor',viewer:'Leitor'}[currentRole]||currentRole))}</small></div></div>
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
      </div>`:''}
      <div class="card" style="max-width:560px">
        <h2 style="margin-bottom:14px">Empresa</h2>
        <div class="form-grid">
          <div class="full"><label>Nome da Empresa</label><input id="cfg-name" value="${U.esc(State.settings.companyName||'')}" placeholder="Controle Financeiro"></div>
          <div class="full" style="display:flex;gap:12px;align-items:center">
            <div id="cfg-logo-preview">${State.settings.companyLogo?`<img class="avatar logo-clean" style="width:48px;height:48px" src="${State.settings.companyLogo}">`:`<span class="avatar-ph" style="width:48px;height:48px"><i data-lucide="zap" style="width:18px;height:18px"></i></span>`}</div>
            <button class="btn btn-ghost btn-sm" id="cfg-logo-btn"><i data-lucide="image-plus"></i>Logo da empresa</button></div>
          <div><label>Tema</label><select id="cfg-theme"><option value="light" ${State.settings.theme!=='dark'?'selected':''}>Claro</option><option value="dark" ${State.settings.theme==='dark'?'selected':''}>Escuro</option></select></div>
          <div><label>Moeda</label><select id="cfg-currency">${['BRL','USD','EUR'].map(c=>`<option ${c===(State.settings.currency||'BRL')?'selected':''}>${c}</option>`).join('')}</select></div>
        </div>
        <div style="margin-top:16px;display:flex;justify-content:flex-end">
          <button class="btn btn-primary" id="cfg-save"><i data-lucide="check"></i>Salvar</button></div>
      </div>
      <div class="card" style="max-width:900px;margin-top:14px">
        <h2 style="margin-bottom:6px">Projetos no ticker financeiro</h2>
        <p style="font-size:.84rem;color:var(--text2);margin-bottom:12px">Escolha quais projetos terão saldo passando na faixa superior do sistema.</p>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn btn-ghost btn-sm" id="ticker-all">Selecionar todos</button>
          <button class="btn btn-ghost btn-sm" id="ticker-none">Limpar seleção</button>
        </div>
        <div class="check-list" id="ticker-projects">
          ${State.projects.map(p=>`<label class="check-item"><input type="checkbox" value="${p.id}" ${tickerSelected.has(p.id)?'checked':''}><span><b>${U.esc(p.proposal||'Projeto')}</b><small style="display:block;color:var(--text3)">${U.esc(p.name||p.client||'')}</small></span></label>`).join('')
            || '<small style="color:var(--text3)">Cadastre um projeto para configurar o ticker.</small>'}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn btn-primary" id="ticker-save"><i data-lucide="check"></i>Salvar ticker</button></div>
      </div>
      <div class="card" style="max-width:900px;margin-top:14px">
        <h2 style="margin-bottom:6px">Base de dados em nuvem</h2>
        ${cloudConnected?`<p style="font-size:.84rem;color:var(--text2)">Conectado como <b>${U.esc((Cloud.user()||{}).email||'usuário autenticado')}</b>. ${Cloud.pendingCount()?`Há ${Cloud.pendingCount()} alteração(ões) aguardando sincronização.`:'Todos os registros locais estão sincronizados.'}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-primary btn-sm" onclick="App.syncCloudNow()"><i data-lucide="cloud-upload"></i>Sincronizar agora</button><button class="btn btn-ghost btn-sm" onclick="App.logoutCloud()"><i data-lucide="log-out"></i>Sair neste aparelho</button></div>`
          :`<p style="font-size:.84rem;color:var(--text2)">A nuvem ainda não está ativa. Siga o arquivo <b>README-INSTALACAO-NUVEM.md</b> antes de publicar a versão definitiva.</p>`}
      </div>
      ${cloudConnected?`<div class="card" style="max-width:1100px;margin-top:14px" id="team-card">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          <div style="flex:1"><h2>Organização e permissões</h2><p style="font-size:.84rem;color:var(--text2)">Compartilhe a mesma base com outros usuários e defina o que cada pessoa pode visualizar ou editar.</p></div>
          ${Cloud.canManageUsers()?'<button class="btn btn-primary btn-sm" onclick="Views.configuracoes.inviteForm()"><i data-lucide="user-plus"></i>Vincular usuário</button>':''}
        </div>
        <div id="team-content"><div class="empty"><i data-lucide="loader-circle"></i><br>Carregando equipe…</div></div>
      </div>`:''}
      <div class="card" style="max-width:900px;margin-top:14px">
        <h2 style="margin-bottom:6px">Modelos das bases financeiras</h2>
        <p style="font-size:.84rem;color:var(--text2);margin-bottom:14px">Cada base mantém seu próprio modelo. A substituição salva apenas os cabeçalhos e o mapeamento; nenhum lançamento já importado é alterado ou apagado.</p>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px">
          ${Object.entries(Importer.KIND_LABELS).map(([kind,label])=>{const m=(State.settings.importMappings||{})[kind];return `<div class="card" style="padding:13px;background:var(--surface2)"><b>${label}</b><small style="display:block;color:var(--text3);margin:5px 0 10px">${m?`Modelo: ${U.esc(m.fileName)}<br>Salvo em ${U.date(m.savedAt)}`:'Reconhecimento padrão por cabeçalho'}</small><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="Importer.pickModel('${kind}')"><i data-lucide="upload"></i>${m?'Substituir':'Cadastrar'} modelo</button>${m?`<button class="btn btn-ghost btn-sm" onclick="Importer.clearModel('${kind}')">Remover</button>`:''}</div></div>`;}).join('')}
        </div>
      </div>
      <div class="card" style="max-width:560px;margin-top:14px">
        <h3 style="margin-bottom:8px">Atalhos rápidos</h3>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="App.go('categorias')"><i data-lucide="tags"></i>Categorias</button>
          <button class="btn btn-ghost btn-sm" onclick="App.go('basecalculo')"><i data-lucide="percent"></i>Base de Cálculo</button>
          <button class="btn btn-ghost btn-sm" onclick="App.go('backup')"><i data-lucide="database-backup"></i>Backup e Restauração</button>
        </div></div>`;
    let logo = State.settings.companyLogo || '';
    if(cloudConnected && Cloud.organizations().length>1)
      document.getElementById('cfg-active-org').onchange=e=>Cloud.switchOrganization(e.target.value);
    if(cloudConnected){
      document.getElementById('cfg-user-name-save').onclick=()=>this.saveOwnName();
      document.getElementById('cfg-user-name').onkeydown=e=>{
        if(e.key==='Enter'){ e.preventDefault(); this.saveOwnName(); }
      };
    }
    document.getElementById('cfg-logo-btn').onclick = () => {
      const inp = document.getElementById('img-input');
      inp.onchange = () => { const f = inp.files[0]; inp.value=''; if(!f) return;
        const fr = new FileReader();
        fr.onload = async e => { logo = await U.resizeImage(e.target.result); document.getElementById('cfg-logo-preview').innerHTML = `<img class="avatar logo-clean" style="width:48px;height:48px" src="${logo}">`; };
        fr.readAsDataURL(f); };
      inp.click();
    };
    document.getElementById('ticker-all').onclick=()=>document.querySelectorAll('#ticker-projects input[type=checkbox]').forEach(x=>x.checked=true);
    document.getElementById('ticker-none').onclick=()=>document.querySelectorAll('#ticker-projects input[type=checkbox]').forEach(x=>x.checked=false);
    document.getElementById('ticker-save').onclick=async()=>{
      const ids=[...document.querySelectorAll('#ticker-projects input[type=checkbox]:checked')].map(x=>x.value);
      await State.setSetting('tickerProjects',ids);
      UI.toast('Projetos do ticker atualizados','success'); App.renderTicker();
    };
    document.getElementById('cfg-save').onclick = async () => {
      await State.setSetting('companyName', document.getElementById('cfg-name').value.trim());
      await State.setSetting('companyLogo', logo);
      await State.setSetting('currency', document.getElementById('cfg-currency').value);
      const theme = document.getElementById('cfg-theme').value;
      await State.setSetting('theme', theme);
      App.applyTheme(theme); App.applyBranding();
      UI.toast('Configurações salvas', 'success');
    };
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
      box.innerHTML='<div class="permission-banner" style="margin-top:12px"><i data-lucide="shield"></i><span>Você está vinculado a esta organização. Somente proprietários, administradores ou usuários autorizados podem gerenciar a equipe e as permissões.</span></div>';
      U.icons(); return;
    }
    try{
      this.teamData=await Cloud.listTeam();
      this.renderTeam();
    }catch(err){
      box.innerHTML=`<div class="permission-banner"><i data-lucide="triangle-alert"></i><span>Não foi possível carregar a equipe: ${U.esc(err.message)}</span></div>`;
      U.icons();
    }
  },
  renderTeam(){
    const box=document.getElementById('team-content'); if(!box||!this.teamData) return;
    const currentId=(Cloud.user()||{}).id;
    const roleLabels={owner:'Proprietário',admin:'Administrador',editor:'Editor',viewer:'Leitor'};
    const members=this.teamData.members||[], invitations=this.teamData.invitations||[];
    const canRename=['owner','admin'].includes(Cloud.role());
    box.innerHTML=`
      <div style="display:flex;gap:9px;align-items:end;flex-wrap:wrap;margin:14px 0">
        <div style="flex:1;max-width:430px"><label>Nome da organização</label><input id="team-org-name" value="${U.esc((Cloud.organization()||{}).name||'')}" ${canRename?'':'disabled'}></div>
        ${canRename?'<button class="btn btn-ghost btn-sm" id="team-org-save"><i data-lucide="check"></i>Salvar nome</button>':''}
      </div>
      <div class="table-wrap"><div class="table-scroll"><table class="team-table">
        <thead><tr><th>Usuário</th><th>Perfil</th><th>Permissões</th><th style="width:110px"></th></tr></thead>
        <tbody>${members.map(m=>{const profile=m.profile||{};const locked=m.role==='owner';return `
          <tr><td><b>${U.esc(profile.full_name||profile.email||'Usuário')}</b><br><small>${U.esc(profile.email||m.user_id)}${m.user_id===currentId?' · você':''}</small></td>
          <td><span class="tag ${locked?'tag-blue':'tag-gray'}">${U.esc(roleLabels[m.role]||m.role)}</span></td>
          <td><small>${locked||m.role==='admin'?'Acesso completo':`${(m.permissions?.view||[]).length} módulo(s) para visualizar · ${(m.permissions?.edit||[]).length} para editar`}</small></td>
          <td>${locked?'':`<div style="display:flex;gap:5px"><button class="btn btn-ghost btn-sm" onclick="Views.configuracoes.memberPermissionForm('${U.esc(m.user_id)}')" title="Editar permissões"><i data-lucide="shield-check"></i></button>${m.user_id!==currentId?`<button class="btn btn-danger btn-sm" onclick="Views.configuracoes.removeMember('${U.esc(m.user_id)}')" title="Remover da organização"><i data-lucide="user-minus"></i></button>`:''}</div>`}</td></tr>`;}).join('')}</tbody>
      </table></div></div>
      ${invitations.length?`<h3 style="margin:18px 0 8px">Convites pendentes</h3><div class="table-wrap"><div class="table-scroll"><table>
        <thead><tr><th>E-mail</th><th>Perfil</th><th>Enviado em</th><th></th></tr></thead>
        <tbody>${invitations.map(i=>`<tr><td><b>${U.esc(i.email)}</b></td><td>${U.esc(roleLabels[i.role]||i.role)}</td><td>${U.date(i.created_at)}</td><td><button class="btn btn-ghost btn-sm" onclick="Views.configuracoes.cancelInvitation('${U.esc(i.id)}')"><i data-lucide="x"></i>Cancelar</button></td></tr>`).join('')}</tbody>
      </table></div></div>`:''}`;
    if(canRename) document.getElementById('team-org-save').onclick=()=>this.saveOrganizationName();
    U.icons();
  },
  permissionControls(permissions,roleName){
    const p=permissions||this.defaultPermissions(roleName);
    const view=new Set(p.view||[]), edit=new Set(p.edit||[]);
    return `<div class="permission-grid" id="member-permissions">${this.permissionModules.map(([store,label,help])=>`
      <div class="check-item" style="display:grid;grid-template-columns:18px 1fr 18px;gap:8px">
        <input class="perm-view" data-store="${store}" type="checkbox" ${view.has(store)?'checked':''} title="Pode visualizar">
        <span><b>${label}</b><small>${help}</small></span>
        <input class="perm-edit" data-store="${store}" type="checkbox" ${edit.has(store)?'checked':''} title="Pode editar">
      </div>`).join('')}</div>
      <div style="display:flex;gap:22px;margin-top:10px;color:var(--text2);font-size:.78rem"><span>1ª caixa: visualizar</span><span>2ª caixa: editar</span></div>
      <label class="check-item" style="margin-top:10px"><input id="perm-manage-users" type="checkbox" ${p.manage_users?'checked':''}><span><b>Gerenciar usuários</b><small>Permite convidar pessoas e editar permissões, exceto as de proprietários.</small></span></label>`;
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
      manage.disabled=full;
    };
    role.onchange=()=>{
      if(role.value==='viewer') document.querySelectorAll('.perm-edit').forEach(x=>x.checked=false);
      apply();
    };
    document.querySelectorAll('.perm-edit').forEach(input=>input.onchange=()=>{
      if(input.checked) document.querySelector(`.perm-view[data-store="${input.dataset.store}"]`).checked=true;
    });
    document.querySelectorAll('.perm-view').forEach(input=>input.onchange=()=>{
      if(!input.checked) document.querySelector(`.perm-edit[data-store="${input.dataset.store}"]`).checked=false;
    });
    apply();
  },
  readPermissionForm(){
    const view=[...document.querySelectorAll('.perm-view:checked')].map(x=>x.dataset.store);
    const edit=[...document.querySelectorAll('.perm-edit:checked')].map(x=>x.dataset.store).filter(x=>view.includes(x));
    return {view,edit,manage_users:document.getElementById('perm-manage-users').checked};
  },
  inviteForm(){
    const defaults=this.defaultPermissions('viewer');
    UI.modal({title:'Vincular usuário à organização',wide:true,body:`
      <div class="form-grid" style="margin-bottom:14px">
        <div><label>E-mail do usuário *</label><input id="member-email" type="email" placeholder="usuario@empresa.com.br"></div>
        <div><label>Perfil</label><select id="member-role"><option value="viewer">Leitor</option><option value="editor">Editor</option><option value="admin">Administrador</option></select></div>
      </div>
      <p style="font-size:.83rem;color:var(--text2);margin-bottom:10px">Se a conta já existir, o vínculo será concluído no próximo acesso. Se ainda não existir, a pessoa deverá se cadastrar com exatamente este e-mail.</p>
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
      await Cloud.inviteMember(email,role,permissions);
      UI.loading(false); UI.closeAll(); UI.toast('Vínculo criado. O usuário entrará na organização no próximo acesso.','success',6500);
      await this.loadTeam();
    }catch(err){ UI.loading(false); UI.toast('Não foi possível vincular: '+U.esc(err.message),'error',6500); }
  },
  memberPermissionForm(userId){
    const member=(this.teamData?.members||[]).find(x=>x.user_id===userId); if(!member) return;
    const profile=member.profile||{};
    UI.modal({title:`Permissões — ${U.esc(profile.full_name||profile.email||'Usuário')}`,wide:true,body:`
      <div class="form-grid" style="margin-bottom:14px"><div><label>Perfil</label><select id="member-role"><option value="viewer" ${member.role==='viewer'?'selected':''}>Leitor</option><option value="editor" ${member.role==='editor'?'selected':''}>Editor</option><option value="admin" ${member.role==='admin'?'selected':''}>Administrador</option></select></div><div><label>E-mail</label><input value="${U.esc(profile.email||'')}" disabled></div></div>
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
      Medições:State.measurements.length, Planejamento:State.planning.length, Clientes:State.clients.length, Categorias:State.categories.length };
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
    UI.confirm(`Restaurar o snapshot de <b>${U.esc(snap.exportedAt ? U.date(snap.exportedAt) : '—')}</b>? Os dados serão mesclados ao banco atual (nada é apagado).`, async () => {
      UI.loading(true, 'Restaurando snapshot…');
      for(const st of ['projects','budgets','purchases','planning','clients','categories','measurements','settings'])
        if(Array.isArray(snap[st]) && snap[st].length) await DB.bulkPut(st, snap[st]);
      await State.reload(); UI.loading(false); UI.toast('Snapshot restaurado', 'success'); App.render();
    }, false);
  },
  fullExcel(){
    const wb = XLSX.utils.book_new();
    ['projects','budgets','purchases'].forEach(s => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Exports.rows(s)), s));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(State.planning), 'planning');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(State.measurements), 'measurements');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(State.clients.map(({logo,...c})=>c)), 'clients');
    XLSX.writeFile(wb, `banco-completo-${U.isoDate(new Date())}.xlsx`);
    UI.toast('Banco exportado em Excel', 'success');
  }
};
