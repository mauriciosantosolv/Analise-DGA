/**
 * Módulo Configurações (configuracoes.js)
 *
 * Responsabilidades:
 * - tela de configurações (tema, moeda, marca)
 * - tela e rotinas de backup: exportar, restaurar, limpar banco
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
  },
  async wipe(){
    UI.confirm('<b>Atenção:</b> isto apagará TODOS os dados do sistema (projetos, compras, orçamentos, planejamento, clientes). Esta ação não pode ser desfeita. Deseja realmente continuar?', () => {
      UI.confirm('Última confirmação: apagar tudo definitivamente?', async () => {
        UI.loading(true, 'Limpando banco…');
        for(const s of DB.STORES) await DB.clear(s);
        await State.reload();
        UI.loading(false); UI.toast('Banco de dados limpo', 'warn'); App.render();
      });
    });
  }
};

/* ---------- CONFIGURAÇÕES ---------- */
Views.configuracoes = {
  title:'Configurações',
  render(){
    $c().innerHTML = `
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
      <div class="card" style="max-width:560px;margin-top:14px">
        <h3 style="margin-bottom:8px">Atalhos rápidos</h3>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="App.go('categorias')"><i data-lucide="tags"></i>Categorias</button>
          <button class="btn btn-ghost btn-sm" onclick="App.go('basecalculo')"><i data-lucide="percent"></i>Base de Cálculo</button>
          <button class="btn btn-ghost btn-sm" onclick="App.go('backup')"><i data-lucide="database-backup"></i>Backup e Restauração</button>
        </div></div>`;
    let logo = State.settings.companyLogo || '';
    document.getElementById('cfg-logo-btn').onclick = () => {
      const inp = document.getElementById('img-input');
      inp.onchange = () => { const f = inp.files[0]; inp.value=''; if(!f) return;
        const fr = new FileReader();
        fr.onload = async e => { logo = await U.resizeImage(e.target.result); document.getElementById('cfg-logo-preview').innerHTML = `<img class="avatar logo-clean" style="width:48px;height:48px" src="${logo}">`; };
        fr.readAsDataURL(f); };
      inp.click();
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
    U.icons();
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
        <div class="card" style="border-color:var(--red)"><h3 style="margin-bottom:8px;color:var(--red)"><i data-lucide="trash-2" style="width:16px;height:16px"></i> Limpar Banco</h3>
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:12px">Apaga todos os dados. Requer dupla confirmação.</p>
          <button class="btn btn-danger btn-sm" onclick="Backup.wipe()">Apagar Tudo</button></div>
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
