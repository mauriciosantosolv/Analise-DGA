// =============================================================================
// CliqueObras v4.5.12 — Transferir propriedade e Excluir minha conta.
// Módulo NOVO. Não altera nenhuma função existente de Configurações: envolve
// Views.configuracoes.render() e renderTeam() e só ACRESCENTA markup depois que
// a versão original terminou.
//
// Servidor: supabase/ATUALIZACAO-v4.5.12-CONTA-PROPRIEDADE.sql
//   - clique_obras_transfer_ownership_v4512  (novo dono + ex-dono vira Administrador)
//   - clique_obras_account_deletion_check_v4512 (pré-checagem)
//   - gatilho em auth.users: nenhuma exclusão de conta apaga dado
// Edge Function: supabase/functions/delete-own-account
// =============================================================================
const AccountV4512 = {
  roleLabels:{owner:'Proprietário',admin:'Administrador',editor:'Editor',viewer:'Leitor'},

  cloudReady(){
    return typeof Cloud!=='undefined' && typeof Cloud.active==='function' && Cloud.active()
      && typeof Cloud.transferOwnership==='function';
  },

  // ---------------------------------------------------------------------------
  // Transferir propriedade (só o proprietário vê o botão)
  // ---------------------------------------------------------------------------
  transferCandidates(members,currentId){
    return (Array.isArray(members)?members:[])
      .filter(m=>m && m.user_id && m.user_id!==currentId && m.role!=='owner');
  },
  memberLabel(member){
    const profile=(member&&member.profile)||{};
    const name=profile.full_name||profile.email||'Usuário';
    const view=typeof Views!=='undefined'&&Views.configuracoes;
    const role=view&&typeof view.profileLabel==='function'
      ? view.profileLabel(member.role,member.permissions,this.roleLabels)
      : (this.roleLabels[member.role]||member.role);
    return `${name}${profile.email&&profile.email!==name?` · ${profile.email}`:''} — ${role}`;
  },
  mountTransfer(){
    if(!this.cloudReady() || Cloud.role()!=='owner') return;
    const box=document.getElementById('team-content');
    const view=Views.configuracoes;
    if(!box || !view || !view.teamData || document.getElementById('account-transfer-bar')) return;
    const currentId=(Cloud.user()||{}).id;
    const candidates=this.transferCandidates(view.teamData.members,currentId);
    box.insertAdjacentHTML('afterbegin',`<div class="permission-banner" id="account-transfer-bar" style="margin:0 0 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <i data-lucide="key-round"></i><span style="flex:1;min-width:200px">Você é o <b>proprietário</b> desta organização. Para passar a propriedade a outro membro, use a transferência — nenhum dado é alterado.</span>
      <button class="btn btn-ghost btn-sm" type="button" id="account-transfer-open" ${candidates.length?'':'disabled title="Convide outro usuário antes de transferir"'}><i data-lucide="key-round"></i>Transferir propriedade</button>
    </div>`);
    const button=document.getElementById('account-transfer-open');
    if(button) button.onclick=()=>this.transferForm();
    U.icons();
  },
  transferForm(){
    const view=Views.configuracoes;
    const currentId=(Cloud.user()||{}).id;
    const candidates=this.transferCandidates(view&&view.teamData&&view.teamData.members,currentId);
    if(!candidates.length) return UI.toast('Convide outro usuário para a organização antes de transferir a propriedade.','warn',6500);
    const org=Cloud.organization()||{};
    UI.modal({title:'Transferir propriedade da organização',body:`
      <p style="font-size:.88rem;line-height:1.55;margin-bottom:12px">A organização <b>${U.esc(org.name||'')}</b> passa a ter um novo proprietário.</p>
      <ul style="font-size:.84rem;line-height:1.6;color:var(--text2);margin:0 0 14px 18px">
        <li>O membro escolhido vira <b>Proprietário</b> (acesso completo, integração Omie, promover administradores).</li>
        <li>Você continua na organização como <b>Administrador</b>, com acesso completo aos dados.</li>
        <li><b>Nenhum dado muda</b>: projetos, orçamentos, RDOs, medições e lançamentos pertencem à organização, não ao proprietário.</li>
        <li>A sincronização do Omie continua rodando normalmente.</li>
      </ul>
      <label for="account-transfer-target">Novo proprietário *</label>
      <select id="account-transfer-target"><option value="">Selecione um membro…</option>${candidates.map(m=>`<option value="${U.esc(m.user_id)}">${U.esc(this.memberLabel(m))}</option>`).join('')}</select>
      <label class="check-item" style="margin-top:12px"><input type="checkbox" id="account-transfer-ack"><span>Entendo que só o novo proprietário poderá me devolver a propriedade.</span></label>`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="account-transfer-save" disabled><i data-lucide="key-round"></i>Transferir propriedade</button>',
      onOpen:()=>{
        const target=document.getElementById('account-transfer-target');
        const ack=document.getElementById('account-transfer-ack');
        const save=document.getElementById('account-transfer-save');
        const sync=()=>{ save.disabled=!(target.value&&ack.checked); };
        target.onchange=sync; ack.onchange=sync;
        save.onclick=()=>this.transfer(target.value);
      }
    });
  },
  async transfer(userId){
    if(!userId) return;
    const view=Views.configuracoes;
    const member=((view&&view.teamData&&view.teamData.members)||[]).find(m=>m.user_id===userId);
    const name=(member&&member.profile&&(member.profile.full_name||member.profile.email))||'o membro escolhido';
    try{
      UI.loading(true,'Transferindo a propriedade…');
      await Cloud.transferOwnership(userId);
      UI.loading(false);
      UI.closeAll();
      UI.modal({title:'Propriedade transferida',body:`<p style="font-size:.92rem;line-height:1.6"><b>${U.esc(name)}</b> agora é o proprietário da organização. Você continua com acesso completo como <b>Administrador</b>.</p><p style="font-size:.84rem;color:var(--text2);margin-top:8px">O sistema vai recarregar para aplicar o novo perfil.</p>`,
        footer:'<button class="btn btn-primary" id="account-transfer-reload"><i data-lucide="refresh-cw"></i>Recarregar</button>',
        onOpen:()=>{ document.getElementById('account-transfer-reload').onclick=()=>location.reload(); }});
    }catch(err){
      UI.loading(false);
      UI.toast('Não foi possível transferir: '+U.esc(err.message||err),'error',8000);
    }
  },

  // ---------------------------------------------------------------------------
  // Excluir minha conta (qualquer usuário, no cartão "Minha conta")
  // ---------------------------------------------------------------------------
  mountAccountZone(){
    if(!this.cloudReady() || typeof Cloud.deleteOwnAccount!=='function') return;
    const card=document.querySelector('.settings-account');
    if(!card || document.getElementById('account-delete-zone')) return;
    card.insertAdjacentHTML('beforeend',`<div class="profile-name-editor" id="account-delete-zone" style="border-top:1px dashed var(--border);padding-top:14px;margin-top:14px">
      <label>Excluir minha conta</label>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <small style="flex:1;min-width:220px">Apaga o seu login e o seu vínculo com as organizações. <b>Nada do que você lançou é apagado</b> — projetos, RDOs, medições e lançamentos continuam com a empresa.</small>
        <button class="btn btn-danger btn-sm" type="button" id="account-delete-open"><i data-lucide="user-x"></i>Excluir minha conta</button>
      </div>
    </div>`);
    document.getElementById('account-delete-open').onclick=()=>this.deleteStart();
    U.icons();
  },
  // Texto do bloqueio / do aviso — separado para teste.
  deletionSummary(check){
    const blocked=!!(check&&check.blocked);
    const orgs=Array.isArray(check&&check.organizations)?check.organizations:[];
    const solo=(Array.isArray(check&&check.solo_organizations)?check.solo_organizations:[]).filter(o=>Number(o&&o.records)>0);
    return {
      blocked,
      blockers:orgs.map(o=>`${o.name||'Organização'} (${Number(o.members)||0} membros)`),
      solo:solo.map(o=>`${o.name||'Organização'} (${Number(o.records).toLocaleString('pt-BR')} registros)`),
      records:Number(check&&check.records)||0
    };
  },
  async deleteStart(){
    try{
      UI.loading(true,'Conferindo alterações pendentes…');
      if(Cloud.pendingCount()){
        if(typeof DB!=='undefined'&&typeof DB.syncFromCloud==='function') await DB.syncFromCloud();
        if(Cloud.pendingCount()) throw new Error('Ainda existem alterações aguardando sincronização. Sincronize antes de excluir a conta.');
      }
      UI.loading(true,'Verificando sua conta…');
      const check=await Cloud.accountDeletionCheck();
      UI.loading(false);
      const summary=this.deletionSummary(check);
      if(summary.blocked) return this.deleteBlocked(summary);
      this.deleteForm(summary);
    }catch(err){
      UI.loading(false);
      UI.toast('Exclusão interrompida para proteger seus dados: '+U.esc(err.message||err),'error',8000);
    }
  },
  deleteBlocked(summary){
    UI.modal({title:'Transfira a propriedade antes',body:`
      <p style="font-size:.9rem;line-height:1.6">Você é o <b>único proprietário</b> de:</p>
      <ul style="font-size:.88rem;line-height:1.6;margin:6px 0 12px 18px">${summary.blockers.map(item=>`<li>${U.esc(item)}</li>`).join('')}</ul>
      <p style="font-size:.86rem;line-height:1.55;color:var(--text2)">Uma organização com outros membros não pode ficar sem proprietário. Em <b>Configurações › Funcionários e acessos</b>, use <b>Transferir propriedade</b> e depois volte aqui.</p>`,
      footer:'<button class="btn btn-primary" onclick="UI.close()">Entendi</button>'});
  },
  deleteForm(summary){
    const email=(Cloud.user()||{}).email||'';
    UI.modal({title:'Excluir minha conta',body:`
      <div class="permission-banner" style="margin-bottom:12px"><i data-lucide="shield-check"></i><span><b>Nenhum dado é apagado.</b>${summary.records?` Os ${summary.records.toLocaleString('pt-BR')} registros que você gravou continuam`:' Tudo o que você lançou continua'} na organização, com os mesmos valores.</span></div>
      <ul style="font-size:.84rem;line-height:1.6;color:var(--text2);margin:0 0 12px 18px">
        <li>O login <b>${U.esc(email)}</b> deixa de existir e você sai de todas as organizações.</li>
        <li>Para voltar, será preciso um novo convite.</li>
        <li>Esta ação não pode ser desfeita.</li>
      </ul>
      ${summary.solo.length?`<p style="font-size:.84rem;line-height:1.55;margin-bottom:12px;padding:9px 11px;border-left:3px solid var(--amber,#d97706);background:var(--surface2)">Você é o único membro de <b>${summary.solo.map(U.esc).join(', ')}</b>. Esses dados ficam guardados, mas ninguém terá acesso a eles até um novo usuário ser vinculado pelo suporte.</p>`:''}
      <label for="account-delete-password">Sua senha *</label>
      <input id="account-delete-password" type="password" autocomplete="current-password" maxlength="200">
      <label for="account-delete-confirm" style="margin-top:10px">Digite <b>EXCLUIR</b> para confirmar *</label>
      <input id="account-delete-confirm" type="text" autocomplete="off" maxlength="20" placeholder="EXCLUIR">`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-danger" id="account-delete-save" disabled><i data-lucide="user-x"></i>Excluir definitivamente</button>',
      onOpen:()=>{
        const password=document.getElementById('account-delete-password');
        const confirm=document.getElementById('account-delete-confirm');
        const save=document.getElementById('account-delete-save');
        const sync=()=>{ save.disabled=!(password.value&&confirm.value.trim().toUpperCase()==='EXCLUIR'); };
        password.oninput=sync; confirm.oninput=sync;
        save.onclick=()=>this.deleteAccount(password.value,confirm.value);
        password.focus();
      }
    });
  },
  async deleteAccount(password,confirm){
    try{
      UI.loading(true,'Excluindo sua conta…');
      await Cloud.deleteOwnAccount(password,confirm);
      UI.loading(true,'Limpando este aparelho…');
      try{ if(typeof DB!=='undefined'&&typeof DB.clearLocalCache==='function') await DB.clearLocalCache(); }catch(err){ console.warn(err); }
      try{ await Cloud.signOut(); }catch(err){ console.warn(err); }
      UI.loading(false);
      UI.closeAll();
      UI.modal({title:'Conta excluída',body:'<p style="font-size:.92rem;line-height:1.6">Sua conta foi excluída. Os dados que você lançou continuam com a organização.</p>',
        footer:'<button class="btn btn-primary" id="account-delete-done">OK</button>',
        onOpen:()=>{ document.getElementById('account-delete-done').onclick=()=>location.reload(); }});
    }catch(err){
      UI.loading(false);
      UI.toast(U.esc(err.message||err),'error',8000);
    }
  }
};

// Envolve as telas originais (sem alterar o que elas fazem).
(function(){
  if(typeof Views==='undefined' || !Views.configuracoes || Views.configuracoes.__accountV4512) return;
  const view=Views.configuracoes;
  const originalRender=view.render;
  const originalRenderTeam=view.renderTeam;
  view.__accountV4512=true;
  view.render=function(...args){
    const result=originalRender.apply(this,args);
    try{ AccountV4512.mountAccountZone(); }catch(err){ console.warn('v4.5.12 conta',err); }
    return result;
  };
  view.renderTeam=function(...args){
    const result=originalRenderTeam.apply(this,args);
    try{ AccountV4512.mountTransfer(); }catch(err){ console.warn('v4.5.12 transferência',err); }
    return result;
  };
})();
