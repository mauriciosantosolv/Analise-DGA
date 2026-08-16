/**
 * Módulo Relatórios (relatorios.js)
 *
 * Responsabilidades:
 * - tela de relatórios e geração de arquivos (via utils/export.js)
 *
 * Dependências:
 * - utils/export.js (Exports)
 * - custos (Biz)
 * - database
 * - utils
 *
 * Não modificar:
 * - custos
 * - compras
 */

Views.relatorios = {
  title:'Relatórios',
  render(){
    $c().innerHTML = `
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
        ${[['projects','Relatório de Projetos','Indicadores completos por obra: orçado, realizado, projeção, margem e saúde.','hard-hat'],
           ['purchases','Relatório Financeiro','Todos os lançamentos de compras com fornecedor, categoria e datas.','wallet'],
           ['budgets','Relatório de Orçamentos','Orçado por projeto e categoria com pesos percentuais.','calculator']]
          .map(([store,title,desc,icon])=>`
          <div class="card"><div style="display:flex;gap:11px;align-items:center;margin-bottom:9px">
            <span style="width:38px;height:38px;border-radius:10px;background:var(--blue-soft);color:var(--blue);display:flex;align-items:center;justify-content:center"><i data-lucide="${icon}"></i></span>
            <h3>${title}</h3></div>
            <p style="font-size:.84rem;color:var(--text2);margin-bottom:13px">${desc}</p>
            <button class="btn btn-primary btn-sm" onclick="Exports.table('${store}')"><i data-lucide="download"></i>Exportar</button></div>`).join('')}

        <div class="card"><div style="display:flex;gap:11px;align-items:center;margin-bottom:9px">
          <span style="width:38px;height:38px;border-radius:10px;background:var(--red-soft);color:var(--red);display:flex;align-items:center;justify-content:center"><i data-lucide="alert-triangle"></i></span>
          <h3>Desvios Negativos</h3></div>
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:13px">Gera uma análise somente das categorias cujo saldo está negativo nos projetos selecionados.</p>
          <button class="btn btn-primary btn-sm" onclick="Views.relatorios.negativeDeviationForm()"><i data-lucide="filter"></i>Selecionar projetos</button></div>
        <div class="card"><div style="display:flex;gap:11px;align-items:center;margin-bottom:9px">
          <span style="width:38px;height:38px;border-radius:10px;background:var(--green-soft);color:var(--green);display:flex;align-items:center;justify-content:center"><i data-lucide="printer"></i></span>
          <h3>Dashboard em PDF</h3></div>
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:13px">Imprime a visão atual do dashboard (use os filtros antes de exportar).</p>
          <button class="btn btn-primary btn-sm" onclick="App.go('dashboard');setTimeout(()=>Exports.toPDF(),600)"><i data-lucide="file-down"></i>Gerar PDF</button></div>
        <div class="card"><div style="display:flex;gap:11px;align-items:center;margin-bottom:9px">
          <span style="width:38px;height:38px;border-radius:10px;background:var(--blue-soft);color:var(--blue);display:flex;align-items:center;justify-content:center"><i data-lucide="calendar-range"></i></span>
          <h3>Histórico de Alocações</h3></div>
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:13px">Relatório por projeto, dia e colaborador, com entrada, saída, intervalo e classificação das horas.</p>
          <button class="btn btn-primary btn-sm" onclick="Views.relatorios.allocationHistoryForm()"><i data-lucide="download"></i>Gerar relatório</button></div>
      </div>`;
    U.icons();
  },
  negativeDeviationForm(){
    const projects = State.projects.filter(p=>p.status!=='Cancelado');
    UI.modal({title:'Relatório de Desvios Negativos', wide:true, body:`
      <p style="color:var(--text2);margin-bottom:12px">Selecione os projetos que serão analisados. O arquivo mostrará apenas categorias com saldo inferior a zero.</p>
      <div style="display:flex;gap:8px;margin-bottom:10px"><button class="btn btn-ghost btn-sm" onclick="document.querySelectorAll('.neg-proj').forEach(x=>x.checked=true)">Marcar todos</button><button class="btn btn-ghost btn-sm" onclick="document.querySelectorAll('.neg-proj').forEach(x=>x.checked=false)">Limpar</button></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;max-height:420px;overflow:auto">${projects.map(p=>`<label class="card" style="padding:10px;display:flex;align-items:center;gap:9px;cursor:pointer"><input class="neg-proj" type="checkbox" value="${U.esc(p.id)}" ${State.filters.project===p.id?'checked':''}><span><b>${U.esc(p.proposal||'Projeto')}</b><small style="display:block;color:var(--text3)">${U.esc(p.name||'')}</small></span></label>`).join('')}</div>`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" onclick="Views.relatorios.exportNegativeDeviations()"><i data-lucide="download"></i>Exportar análise</button>`});
  },
  exportNegativeDeviations(){
    const ids = [...document.querySelectorAll('.neg-proj:checked')].map(x=>x.value);
    if(!ids.length) return UI.toast('Selecione pelo menos um projeto', 'warn');
    const rows=[];
    ids.forEach(id=>{
      const p=State.projects.find(x=>x.id===id); if(!p) return;
      Biz.categoryStats([p]).filter(c=>c.balance<0).forEach(c=>rows.push({
        Projeto:p.proposal||'', Nome:p.name||'', Categoria:c.name,
        'Orçado':c.budget, 'Realizado':c.spent, 'Projetado':c.projected,
        'Comprometido':c.committed, 'Desvio Negativo':c.balance,
        '% Comprometido':c.committedPct
      }));
    });
    if(!rows.length) return UI.toast('Os projetos selecionados não possuem desvios negativos', 'success', 5000);
    const ws=XLSX.utils.json_to_sheet(Exports.spreadsheetRows(rows));
    ws['!cols']=[{wch:12},{wch:30},{wch:28},{wch:16},{wch:16},{wch:16},{wch:16},{wch:18},{wch:18}];
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Desvios Negativos');
    XLSX.writeFile(wb,`desvios-negativos-${U.isoDate(new Date())}.xlsx`);
    UI.close(); UI.toast(`${rows.length} desvio(s) negativo(s) exportado(s)`, 'success');
  },
  allocationHistoryForm(){
    const projects=State.projects.slice().sort((a,b)=>U.projLabel(a).localeCompare(U.projLabel(b),'pt-BR'));
    UI.modal({title:'Histórico de Alocações',body:`
      <p style="color:var(--text2);margin-bottom:14px">O arquivo será organizado por projeto, data e colaborador.</p>
      <div class="form-grid">
        <div class="full"><label>Projeto</label><select id="allocation-project"><option value="">Todos os projetos</option>${projects.map(project=>`<option value="${U.esc(project.id)}">${U.esc(U.projLabel(project))}</option>`).join('')}</select></div>
        <div><label>Data inicial</label><input id="allocation-date-from" type="date"></div>
        <div><label>Data final</label><input id="allocation-date-to" type="date"></div>
        <div class="full"><label>Status do RDO</label><select id="allocation-status"><option value="">Todos os status</option><option>Rascunho</option><option>Enviado</option><option>Aprovado</option><option>Devolvido</option></select></div>
      </div>`,footer:`<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" onclick="Views.relatorios.exportAllocationHistory()"><i data-lucide="download"></i>Exportar Excel</button>`});
  },
  allocationHistoryRows(filters={}){
    const rows=[];
    (Array.isArray(State.rdos)?State.rdos:[]).forEach(rdo=>{
      const project=State.projects.find(item=>String(item.id)===String(rdo.projectId));
      if(filters.projectId&&String(rdo.projectId)!==String(filters.projectId)) return;
      if(filters.dateFrom&&String(rdo.date||'')<filters.dateFrom) return;
      if(filters.dateTo&&String(rdo.date||'')>filters.dateTo) return;
      if(filters.status&&String(rdo.status||'Rascunho')!==filters.status) return;
      (Array.isArray(rdo.entries)?rdo.entries:[]).forEach(entry=>{
        const employee=State.crew.find(item=>String(item.id)===String(entry.employeeId))||{};
        const role=typeof RDO!=='undefined'&&typeof RDO.displayRoleFor==='function'
          ?RDO.displayRoleFor(rdo.projectId,entry)
          :entry.commercialRole||entry.internalRole||employee.internalRole||'';
        const absent=typeof RDO!=='undefined'&&typeof RDO.isAbsent==='function'
          ?RDO.isAbsent(entry)
          :String(entry.attendanceStatus||'').toLowerCase()==='absent';
        rows.push({
          projectId:String(rdo.projectId||''),projectLabel:project?U.projLabel(project):'Projeto não localizado',
          date:String(rdo.date||''),employeeName:entry.employeeName||employee.name||'Colaborador',
          registration:entry.employeeRegistration||employee.registration||'',role,situation:absent?'Falta':'Alocado',
          start:entry.start||'',end:entry.end||'',breakMinutes:Number(entry.breakMinutes)||0,
          regular:Number(entry.regular)||0,overtime50:Number(entry.overtime50)||0,
          overtime100:Number(entry.overtime100)||0,nightHours:Number(entry.nightHours)||0,
          holiday:rdo.isHoliday===true,status:rdo.status||'Rascunho',rdoNumber:rdo.number||rdo.id||''
        });
      });
    });
    return rows.sort((a,b)=>a.projectLabel.localeCompare(b.projectLabel,'pt-BR')||a.date.localeCompare(b.date)||a.employeeName.localeCompare(b.employeeName,'pt-BR'));
  },
  exportAllocationHistory(){
    const filters={
      projectId:document.getElementById('allocation-project')?.value||'',
      dateFrom:document.getElementById('allocation-date-from')?.value||'',
      dateTo:document.getElementById('allocation-date-to')?.value||'',
      status:document.getElementById('allocation-status')?.value||''
    };
    if(filters.dateFrom&&filters.dateTo&&filters.dateFrom>filters.dateTo)
      return UI.toast('A data inicial não pode ser posterior à data final.','warn',5500);
    const source=this.allocationHistoryRows(filters);
    if(!source.length) return UI.toast('Nenhuma alocação encontrada para os filtros informados.','warn',5500);
    const rows=source.map(row=>({
      Projeto:row.projectLabel,Dia:U.date(row.date),Colaborador:row.employeeName,'Matrícula':row.registration,
      'Função':row.role,'Situação':row.situation,Entrada:row.situation==='Falta'?'':row.start,'Saída':row.situation==='Falta'?'':row.end,'Intervalo':row.situation==='Falta'?'':U.durationMinutes(row.breakMinutes),
      'Horas normais':row.regular,'HE 50%':row.overtime50,'HE 100%':row.overtime100,
      'Adicional noturno (h)':row.nightHours,Feriado:row.holiday?'Sim':'Não','Status do RDO':row.status,'Número do RDO':row.rdoNumber
    }));
    const ws=XLSX.utils.json_to_sheet(Exports.spreadsheetRows(rows));
    ws['!cols']=[{wch:34},{wch:12},{wch:28},{wch:14},{wch:24},{wch:12},{wch:10},{wch:10},{wch:12},{wch:15},{wch:11},{wch:12},{wch:21},{wch:10},{wch:18},{wch:18}];
    if(ws['!ref']) ws['!autofilter']={ref:ws['!ref']};
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Histórico de Alocações');
    XLSX.writeFile(wb,`historico-alocacoes-${U.isoDate(new Date())}.xlsx`);
    UI.close(); UI.toast(`${rows.length} alocação(ões) exportada(s).`,'success',5000);
  }
};
