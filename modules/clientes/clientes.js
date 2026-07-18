/**
 * Módulo Clientes
 *
 * Responsabilidades:
 * - cadastro de clientes e logotipos
 *
 * Dependências:
 * - router (Views)
 * - custos (Biz)
 * - database
 * - utils
 *
 * Não modificar:
 * - custos
 * - compras (exceto no próprio módulo compras)
 */

/* ---------- CLIENTES ---------- */
Views.clientes = {
  title:'Clientes',
  render(){
    $c().innerHTML = `
      <div class="toolbar">${searchBox('cli-search','Pesquisar clientes…')}<div class="spacer"></div>
        <button class="btn btn-primary" onclick="Views.clientes.form()"><i data-lucide="plus"></i>Novo Cliente</button></div>
      <div id="cli-grid" class="grid" style="grid-template-columns:repeat(auto-fill,minmax(270px,1fr))"></div>`;
    this.grid('');
    bindSearch('cli-search', q => this.grid(q));
    U.icons();
  },
  grid(q){
    const n = U.norm(q);
    const list = State.clients.filter(c=>!n||U.norm(`${c.name} ${c.cnpj} ${c.contact}`).includes(n));
    document.getElementById('cli-grid').innerHTML = list.map(c => {
      const projs = State.projects.filter(p=>p.client===c.name);
      const revenue = projs.reduce((s,p)=>s+(p.saleValue||0),0);
      return `<div class="card clickable" style="cursor:pointer" onclick="Views.clientes.form('${c.id}')">
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">
          ${c.logo?`<img class="avatar" style="width:44px;height:44px" src="${c.logo}">`:`<span class="avatar-ph" style="width:44px;height:44px;font-size:1rem">${U.initials(c.name)}</span>`}
          <div><b>${U.esc(c.name)}</b><br><small style="color:var(--text3)">${U.esc(c.cnpj||'')}</small></div></div>
        <div style="font-size:.82rem;color:var(--text2);line-height:1.7">
          ${c.contact?`<i data-lucide="user" style="width:13px;height:13px"></i> ${U.esc(c.contact)}<br>`:''}
          ${c.phone?`<i data-lucide="phone" style="width:13px;height:13px"></i> ${U.esc(c.phone)}<br>`:''}
          ${c.email?`<i data-lucide="mail" style="width:13px;height:13px"></i> ${U.esc(c.email)}<br>`:''}
          <span class="tag tag-blue" style="margin-top:6px">${projs.length} projeto(s) · ${U.money(revenue)}</span></div></div>`;
    }).join('') || `<div class="empty card" style="grid-column:1/-1"><i data-lucide="users"></i><br>Nenhum cliente cadastrado.</div>`;
    U.icons();
  },
  form(id){
    const c = id ? State.clients.find(x=>x.id===id) : {name:'',cnpj:'',contact:'',phone:'',email:'',notes:'',logo:''};
    UI.modal({ title:id?'Editar Cliente':'Novo Cliente', body:`
      <div class="form-grid">
        <div class="full" style="display:flex;gap:12px;align-items:center">
          <div id="cli-logo-preview">${c.logo?`<img class="avatar" style="width:52px;height:52px" src="${c.logo}">`:`<span class="avatar-ph" style="width:52px;height:52px">?</span>`}</div>
          <button class="btn btn-ghost btn-sm" id="cli-logo-btn"><i data-lucide="image-plus"></i>Logo (.png)</button></div>
        <div><label>Nome *</label><input id="cl-name" value="${U.esc(c.name)}"></div>
        <div><label>CNPJ</label><input id="cl-cnpj" value="${U.esc(c.cnpj)}"></div>
        <div><label>Contato</label><input id="cl-contact" value="${U.esc(c.contact)}"></div>
        <div><label>Telefone</label><input id="cl-phone" value="${U.esc(c.phone)}"></div>
        <div class="full"><label>Email</label><input id="cl-email" value="${U.esc(c.email)}"></div>
        <div class="full"><label>Observações</label><textarea id="cl-notes" rows="2">${U.esc(c.notes)}</textarea></div>
      </div>`,
      footer:`${id?`<button class="btn btn-danger" style="margin-right:auto" onclick="Views.clientes.remove('${id}')"><i data-lucide="trash-2"></i>Excluir</button>`:''}
        <button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
        <button class="btn btn-primary" id="cl-save"><i data-lucide="check"></i>Salvar</button>`
    });
    let logo = c.logo;
    document.getElementById('cli-logo-btn').onclick = () => {
      const inp = document.getElementById('img-input');
      inp.onchange = () => { const f = inp.files[0]; inp.value=''; if(!f) return;
        const fr = new FileReader();
        fr.onload = async e => { logo = await U.resizeImage(e.target.result); document.getElementById('cli-logo-preview').innerHTML = `<img class="avatar" style="width:52px;height:52px" src="${logo}">`; };
        fr.readAsDataURL(f); };
      inp.click();
    };
    document.getElementById('cl-save').onclick = async () => {
      const name = document.getElementById('cl-name').value.trim();
      if(!name) return UI.toast('Informe o nome', 'warn');
      const obj = { ...(id?c:{id:U.id()}), name, logo,
        cnpj:document.getElementById('cl-cnpj').value.trim(), contact:document.getElementById('cl-contact').value.trim(),
        phone:document.getElementById('cl-phone').value.trim(), email:document.getElementById('cl-email').value.trim(),
        notes:document.getElementById('cl-notes').value };
      await DB.put('clients', obj); await State.reload();
      UI.close(); UI.toast('Cliente salvo', 'success'); App.render();
    };
  },
  remove(id){
    UI.confirm('Excluir este cliente? Os projetos vinculados não serão apagados.', async () => {
      await DB.del('clients', id); await State.reload(); UI.toast('Cliente excluído', 'warn'); App.render();
    });
  }
};
