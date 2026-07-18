/**
 * Módulo Configurações — Categorias
 *
 * Responsabilidades:
 * - cadastro de categorias de custo (cores e ícones)
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

/* ---------- CATEGORIAS ---------- */
Views.categorias = {
  title:'Categorias',
  render(){
    $c().innerHTML = `
      <div class="toolbar"><div class="spacer"></div>
        <button class="btn btn-primary" onclick="Views.categorias.form()"><i data-lucide="plus"></i>Nova Categoria</button></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
        ${State.categories.sort((a,b)=>a.name.localeCompare(b.name)).map(c => {
          const spent = State.purchases.filter(x=>U.norm(x.category)===U.norm(c.name)).reduce((s,x)=>s+x.value,0);
          return `<div class="card clickable" style="cursor:pointer" onclick="Views.categorias.form('${c.id}')">
            <div style="display:flex;gap:10px;align-items:center">
              <span style="width:34px;height:34px;border-radius:9px;background:${c.color}22;color:${c.color};display:flex;align-items:center;justify-content:center"><i data-lucide="${c.icon||'tag'}" style="width:16px;height:16px"></i></span>
              <div style="flex:1;min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(c.name)}</b>
              <small style="color:var(--text3)">${U.money(spent)} realizado</small></div></div></div>`;
        }).join('') || `<div class="empty card" style="grid-column:1/-1"><i data-lucide="tags"></i><br>Categorias são criadas automaticamente na importação, ou cadastre aqui.</div>`}</div>`;
    U.icons();
  },
  form(id){
    const c = id ? State.categories.find(x=>x.id===id) : {name:'',color:'#2563EB',icon:'tag'};
    const icons = ['tag','wrench','truck','home','utensils','shirt','fuel','hard-hat','cable','zap','package','shield','plane','car','coffee','briefcase'];
    UI.modal({ title:id?'Editar Categoria':'Nova Categoria', body:`
      <div class="form-grid">
        <div class="full"><label>Nome *</label><input id="ct-name" value="${U.esc(c.name)}"></div>
        <div><label>Cor</label><input id="ct-color" type="color" value="${c.color}" style="height:40px;padding:4px"></div>
        <div><label>Ícone</label><select id="ct-icon">${icons.map(i=>`<option ${i===c.icon?'selected':''}>${i}</option>`).join('')}</select></div>
      </div>`,
      footer:`${id?`<button class="btn btn-danger" style="margin-right:auto" onclick="Views.categorias.remove('${id}')"><i data-lucide="trash-2"></i>Excluir</button>`:''}
        <button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
        <button class="btn btn-primary" id="ct-save"><i data-lucide="check"></i>Salvar</button>`
    });
    document.getElementById('ct-save').onclick = async () => {
      const name = document.getElementById('ct-name').value.trim();
      if(!name) return UI.toast('Informe o nome', 'warn');
      await DB.put('categories', { ...(id?c:{id:U.id()}), name,
        color:document.getElementById('ct-color').value, icon:document.getElementById('ct-icon').value });
      await State.reload(); UI.close(); UI.toast('Categoria salva', 'success'); App.render();
    };
  },
  remove(id){
    UI.confirm('Excluir esta categoria? Os lançamentos existentes não serão alterados.', async () => {
      await DB.del('categories', id); await State.reload(); UI.toast('Categoria excluída', 'warn'); App.render();
    });
  }
};
