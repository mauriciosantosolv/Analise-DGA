/** Interface de autenticação do Clique Obras. Carregado depois de app.js. */
const AuthUI = (() => {
  const esc = value => String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  function friendlyError(err){
    const msg=String((err&&err.message)||err||'');
    if(/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
    if(/email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar.';
    if(/user already registered|already been registered/i.test(msg)) return 'Já existe uma conta com este e-mail.';
    if(/password.*(short|least)|weak password/i.test(msg)) return 'Use uma senha mais forte, com pelo menos 8 caracteres.';
    if(/rate limit|too many requests|over_email_send_rate_limit/i.test(msg)) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
    if(/failed to fetch|networkerror|load failed/i.test(msg)) return 'Não foi possível conectar à nuvem. Verifique sua internet.';
    return msg || 'Não foi possível concluir esta operação.';
  }
  function feedback(text='',type='error'){
    return text ? `<div class="cloud-auth-feedback ${type}">${esc(text)}</div>` : '<div class="cloud-auth-feedback"></div>';
  }
  function shell(content){
    return `<div class="cloud-auth-shell">
      <section class="cloud-auth-hero">
        <div class="cloud-auth-logo"><i data-lucide="hard-hat"></i></div>
        <div><span class="cloud-auth-kicker">GESTÃO FINANCEIRA DE OBRAS</span><h1>Clique Obras</h1></div>
        <p>Orçamento, realizado, planejamento e medições em uma base segura, acessível de qualquer aparelho.</p>
        <ul><li><i data-lucide="shield-check"></i>Dados separados por conta</li><li><i data-lucide="cloud"></i>Sincronização automática</li><li><i data-lucide="smartphone"></i>Acesso no computador e celular</li></ul>
      </section>
      <section class="cloud-auth-panel">
        <div class="cloud-auth-mobile-brand"><span><i data-lucide="hard-hat"></i></span><div><b>CliqueObras</b><small>Gestão segura de obras</small></div></div>
        ${content}
      </section>
    </div>`;
  }
  function login(message='',messageType='error'){
    return shell(`<div class="cloud-auth-heading"><h2>Entrar</h2><p>Acesse seu painel financeiro.</p></div>
      <form id="cloud-auth-form" class="cloud-auth-form">
        <label>E-mail<input id="cloud-email" type="email" autocomplete="username" required placeholder="voce@empresa.com.br"></label>
        <label>Senha<input id="cloud-password" type="password" autocomplete="current-password" required placeholder="Sua senha"></label>
        ${feedback(message,messageType)}
        <button class="btn btn-primary cloud-auth-submit" type="submit"><i data-lucide="log-in"></i>Entrar</button>
      </form>
      <button class="cloud-auth-link" data-mode="recover" type="button">Esqueci minha senha</button>
      <div class="cloud-auth-divider"><span>ou</span></div>
      <p class="cloud-auth-switch">Ainda não possui conta?</p>
      <button class="btn btn-ghost cloud-auth-secondary" data-mode="signup" type="button">Criar minha conta</button>`);
  }
  function signup(message='',messageType='error'){
    return shell(`<button class="cloud-auth-back" data-mode="login" type="button"><i data-lucide="arrow-left"></i>Voltar</button>
      <div class="cloud-auth-heading"><h2>Criar conta</h2><p>Seus dados ficarão isolados dos demais usuários.</p></div>
      <form id="cloud-auth-form" class="cloud-auth-form">
        <label>Seu nome ou empresa<input id="cloud-name" type="text" autocomplete="organization" required maxlength="100" placeholder="Nome da empresa"></label>
        <label>E-mail<input id="cloud-email" type="email" autocomplete="username" required placeholder="voce@empresa.com.br"></label>
        <label>Senha<input id="cloud-password" type="password" autocomplete="new-password" minlength="8" required placeholder="Mínimo de 8 caracteres"></label>
        <label>Confirmar senha<input id="cloud-password-confirm" type="password" autocomplete="new-password" minlength="8" required placeholder="Repita a senha"></label>
        ${feedback(message,messageType)}
        <button class="btn btn-primary cloud-auth-submit" type="submit"><i data-lucide="user-plus"></i>Criar conta</button>
      </form>
      <p class="cloud-auth-note"><i data-lucide="mail-check"></i>Você poderá precisar confirmar o endereço pelo e-mail recebido.</p>`);
  }
  function recover(message='',messageType='error'){
    return shell(`<button class="cloud-auth-back" data-mode="login" type="button"><i data-lucide="arrow-left"></i>Voltar</button>
      <div class="cloud-auth-heading"><h2>Recuperar senha</h2><p>Enviaremos um link seguro para criar uma nova senha.</p></div>
      <form id="cloud-auth-form" class="cloud-auth-form">
        <label>E-mail<input id="cloud-email" type="email" autocomplete="username" required placeholder="voce@empresa.com.br"></label>
        ${feedback(message,messageType)}
        <button class="btn btn-primary cloud-auth-submit" type="submit"><i data-lucide="send"></i>Enviar link</button>
      </form>`);
  }
  function reset(message='',messageType='error'){
    return shell(`<div class="cloud-auth-heading"><h2>Definir nova senha</h2><p>Crie uma senha forte para concluir a recuperação.</p></div>
      <form id="cloud-auth-form" class="cloud-auth-form">
        <label>Nova senha<input id="cloud-password" type="password" autocomplete="new-password" minlength="8" required placeholder="Mínimo de 8 caracteres"></label>
        <label>Confirmar nova senha<input id="cloud-password-confirm" type="password" autocomplete="new-password" minlength="8" required placeholder="Repita a senha"></label>
        ${feedback(message,messageType)}
        <button class="btn btn-primary cloud-auth-submit" type="submit"><i data-lucide="key-round"></i>Salvar nova senha</button>
      </form>`);
  }
  function setBusy(form,busy,label){
    const btn=form.querySelector('button[type=submit]');
    if(!btn) return;
    btn.disabled=busy;
    if(busy) btn.textContent=label;
  }
  function show(mode='login',message='',messageType='error'){
    const old=document.getElementById('cloud-login'); if(old) old.remove();
    const el=document.createElement('div'); el.id='cloud-login'; el.className='cloud-login';
    const views={login,signup,recover,reset};
    el.innerHTML=(views[mode]||login)(message,messageType);
    document.body.appendChild(el);
    el.querySelectorAll('[data-mode]').forEach(btn=>btn.onclick=()=>show(btn.dataset.mode));
    el.querySelectorAll('input[type="email"]').forEach(input=>{
      input.autocapitalize='none';
      input.spellcheck=false;
    });
    el.querySelectorAll('input[type="password"]').forEach(input=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='cloud-password-toggle';
      button.setAttribute('aria-label','Mostrar senha');
      button.innerHTML='<i data-lucide="eye"></i>';
      button.onclick=()=>{
        const showing=input.type==='text';
        input.type=showing?'password':'text';
        button.setAttribute('aria-label',showing?'Mostrar senha':'Ocultar senha');
        button.innerHTML=`<i data-lucide="${showing?'eye':'eye-off'}"></i>`;
        U.icons();
      };
      input.parentElement.classList.add('cloud-password-field');
      input.insertAdjacentElement('afterend',button);
    });
    const form=el.querySelector('#cloud-auth-form');
    if(form) form.onsubmit=async e=>{
      e.preventDefault();
      const box=form.querySelector('.cloud-auth-feedback');
      const display=(text,type='error')=>{ box.className=`cloud-auth-feedback open ${type}`; box.textContent=text; };
      try{
        if(mode==='login'){
          setBusy(form,true,'Entrando…');
          await Cloud.signIn(el.querySelector('#cloud-email').value.trim(),el.querySelector('#cloud-password').value);
          location.reload();
        }else if(mode==='signup'){
          const password=el.querySelector('#cloud-password').value;
          if(password!==el.querySelector('#cloud-password-confirm').value) throw new Error('As senhas não são iguais.');
          setBusy(form,true,'Criando conta…');
          await Cloud.signUp(el.querySelector('#cloud-email').value.trim(),password,el.querySelector('#cloud-name').value);
          if(Cloud.active()) location.reload();
          else show('login','Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre no sistema.','success');
        }else if(mode==='recover'){
          setBusy(form,true,'Enviando…');
          await Cloud.resetPassword(el.querySelector('#cloud-email').value.trim());
          display('Caso exista uma conta com este e-mail, o link de recuperação será enviado.','success');
          setBusy(form,false,'Enviar link');
        }else if(mode==='reset'){
          const password=el.querySelector('#cloud-password').value;
          if(password!==el.querySelector('#cloud-password-confirm').value) throw new Error('As senhas não são iguais.');
          setBusy(form,true,'Salvando…');
          await Cloud.updatePassword(password);
          await Cloud.signOut();
          show('login','Senha alterada. Entre novamente com a nova senha.','success');
        }
      }catch(err){
        display(friendlyError(err));
        setBusy(form,false,mode==='login'?'Entrar':mode==='signup'?'Criar conta':mode==='recover'?'Enviar link':'Salvar nova senha');
        U.icons();
      }
    };
    U.icons();
    setTimeout(()=>{ const first=el.querySelector('input'); if(first) first.focus(); },50);
  }
  return {show,friendlyError};
})();

(() => {
  const originalInit=App.init.bind(App);
  App.showCloudLogin=(message='',mode='login')=>AuthUI.show(mode,message);
  App.init=async function(){
    try{
      if(typeof Cloud!=='undefined' && Cloud.configured()){
        const callback=await Cloud.consumeAuthCallback();
        if(callback && callback.error){
          try{ UI.loading(false); }catch(e){}
          AuthUI.show('login',AuthUI.friendlyError(callback.error));
          return;
        }
        if(callback && callback.type==='recovery'){
          try{ UI.loading(false); }catch(e){}
          AuthUI.show('reset');
          return;
        }
      }
    }catch(err){
      try{ UI.loading(false); }catch(e){}
      AuthUI.show('login',AuthUI.friendlyError(err));
      return;
    }
    await originalInit();
  };
})();
