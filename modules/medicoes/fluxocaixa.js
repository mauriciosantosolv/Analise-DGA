/**
 * Módulo Fluxo de Caixa por Medições — v4.1.0
 *
 * Responsabilidades:
 * - previsões de faturamento e recebimento por projeto (store `forecasts`)
 * - extrato de recebimentos das medições (store `measurement_receipts`)
 * - situação de recebimento calculada, sem gravar nada no registro da medição
 *
 * Dependências:
 * - router (Views), custos (Biz), database (DB/State), utils (U/UI)
 *
 * Não modificar:
 * - o registro da medição. Este módulo nunca grava em `measurements`.
 *   É isso que mantém intactas a trava de integridade da medição HH e a
 *   exigência de administrador para alterá-la.
 */

const CashFlow = {

  /* ---------- condição de pagamento ---------- */

  TERMS:[30,60,90],

  termLabel(days){
    const value=Number(days)||0;
    return value>0?`${value} DDL`:'Não informada';
  },

  clientOf(projectId){
    const project=State.projects.find(item=>String(item.id)===String(projectId));
    if(!project) return null;
    // O vínculo projeto → cliente é por nome, como no restante do sistema.
    return State.clients.find(client=>U.norm(client.name)===U.norm(project.client||''))||null;
  },

  paymentTermDays(projectId){
    const client=this.clientOf(projectId);
    const days=Number(client&&client.paymentTerm)||0;
    return this.TERMS.includes(days)?days:0;
  },

  // Dias corridos a partir da data prevista de faturamento. O horário fixo em
  // 12h evita que o horário de verão desloque a data em um dia.
  addCalendarDays(isoDate,days){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate||''))) return '';
    const base=new Date(`${isoDate}T12:00:00`);
    if(Number.isNaN(base.getTime())) return '';
    base.setDate(base.getDate()+(Number(days)||0));
    return U.isoDate(base);
  },

  /* ---------- previsões ---------- */

  forecasts(projectId=''){
    const rows=Array.isArray(State.forecasts)?State.forecasts:[];
    return (projectId?rows.filter(item=>String(item.projectId)===String(projectId)):rows)
      .slice().sort((a,b)=>String(a.receiptDate||'').localeCompare(String(b.receiptDate||'')));
  },

  measuredTotal(projectId){
    return State.measurements
      .filter(item=>String(item.projectId)===String(projectId))
      .reduce((sum,item)=>sum+(Number(item.value)||0),0);
  },

  // Teto = receita contratada − medições já lançadas − demais previsões.
  // Decisão D3: uma obra 60% medida não pode receber 100% em previsões.
  forecastCeiling(projectId,exceptId=''){
    const project=State.projects.find(item=>String(item.id)===String(projectId));
    const revenue=Math.max(0,Number(project&&project.saleValue)||0);
    const measured=this.measuredTotal(projectId);
    const others=this.forecasts(projectId)
      .filter(item=>String(item.id)!==String(exceptId))
      .reduce((sum,item)=>sum+(Number(item.value)||0),0);
    return {
      revenue,
      measured,
      others,
      available:Math.round(Math.max(0,revenue-measured-others)*100)/100
    };
  },

  forecastForm(id=''){
    if(!Views.medicoes.canEdit())
      return UI.toast('Seu usuário não pode alterar medições e previsões.','warn',6000);
    if(!State.projects.length)
      return UI.toast('Cadastre um projeto antes de lançar previsões.','warn');
    const existing=id?this.forecasts().find(item=>String(item.id)===String(id)):null;
    if(id&&!existing) return;
    const forecast=existing||{
      projectId:State.filters.project||String(State.projects[0].id),
      value:0,
      measurementDate:'',
      billingDate:U.isoDate(new Date()),
      notes:''
    };
    UI.modal({
      title:id?'Editar Previsão':'Nova Previsão',
      body:`<div class="form-grid">
        <div class="full"><label>Projeto *</label><select id="fc-project">${State.projects.map(project=>`<option value="${U.esc(project.id)}" ${String(project.id)===String(forecast.projectId)?'selected':''}>${U.esc(U.projLabel(project))}</option>`).join('')}</select></div>
        <div><label>Valor Previsto *</label><input id="fc-value" type="number" min="0" step="0.01" value="${U.esc(forecast.value||'')}"></div>
        <div><label>Data Prevista de Execução (Medição)</label><input id="fc-measurement" type="date" value="${U.esc(forecast.measurementDate||'')}"></div>
        <div><label>Data Prevista de Faturamento *</label><input id="fc-billing" type="date" value="${U.esc(forecast.billingDate||'')}"></div>
        <div><label>Condição de Pagamento</label><input id="fc-term" value="" readonly></div>
        <div><label>Data Prevista de Recebimento</label><input id="fc-receipt" value="" readonly></div>
        <div class="full"><label>Observações</label><textarea id="fc-notes" rows="2">${U.esc(forecast.notes||'')}</textarea></div>
      </div>
      <div class="import-log" id="fc-ceiling" style="margin-top:12px"></div>`,
      footer:`${id?`<button class="btn btn-danger" style="margin-right:auto" onclick="CashFlow.removeForecast(${U.jsArg(id)})"><i data-lucide="trash-2"></i>Excluir</button>`:''}
        <button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
        <button class="btn btn-primary" id="fc-save"><i data-lucide="check"></i>Salvar</button>`,
      onOpen:()=>{
        const refresh=()=>{
          const projectId=document.getElementById('fc-project').value;
          const billing=document.getElementById('fc-billing').value;
          const days=this.paymentTermDays(projectId);
          const client=this.clientOf(projectId);
          document.getElementById('fc-term').value=days
            ? this.termLabel(days)
            : (client?`${client.name} sem condição cadastrada`:'Cliente do projeto não encontrado');
          document.getElementById('fc-receipt').value=days&&billing
            ? U.date(this.addCalendarDays(billing,days))
            : '—';
          const ceiling=this.forecastCeiling(projectId,id);
          document.getElementById('fc-ceiling').innerHTML=
            `Receita contratada ${U.money2(ceiling.revenue)} · já medido ${U.money2(ceiling.measured)} · outras previsões ${U.money2(ceiling.others)}<br><b>Disponível para previsão: ${U.money2(ceiling.available)}</b>`;
        };
        document.getElementById('fc-project').onchange=refresh;
        document.getElementById('fc-billing').onchange=refresh;
        document.getElementById('fc-value').oninput=refresh;
        refresh();
        document.getElementById('fc-save').onclick=()=>this.saveForecast(id);
      }
    });
  },

  async saveForecast(id=''){
    const projectId=document.getElementById('fc-project').value;
    const billingDate=document.getElementById('fc-billing').value;
    const value=Math.round(U.num(document.getElementById('fc-value').value)*100)/100;
    const days=this.paymentTermDays(projectId);
    if(!projectId||!billingDate||!(value>0))
      return UI.toast('Preencha projeto, valor e data prevista de faturamento.','warn');
    if(!days){
      const client=this.clientOf(projectId);
      return UI.toast(client
        ? `Cadastre a condição de pagamento de ${U.esc(client.name)} em Clientes antes de lançar a previsão.`
        : 'O cliente deste projeto não está cadastrado. Cadastre-o em Clientes antes de lançar a previsão.','warn',8000);
    }
    const ceiling=this.forecastCeiling(projectId,id);
    if(value>ceiling.available+0.01)
      return UI.toast(`A previsão de ${U.money2(value)} ultrapassa o disponível de ${U.money2(ceiling.available)} para este projeto.`,'warn',8000);
    const client=this.clientOf(projectId);
    const object={
      ...(id?this.forecasts().find(item=>String(item.id)===String(id)):{id:U.id(),createdAt:new Date().toISOString()}),
      projectId:String(projectId),
      value,
      measurementDate:document.getElementById('fc-measurement').value||'',
      billingDate,
      receiptDate:this.addCalendarDays(billingDate,days),
      paymentTermDays:days,
      clientName:String(client&&client.name||''),
      notes:document.getElementById('fc-notes').value.trim(),
      updatedAt:new Date().toISOString()
    };
    try{
      await DB.put('forecasts',object);
      await State.reload();
      UI.close(); UI.toast('Previsão salva','success'); App.render();
    }catch(err){
      UI.toast('Não foi possível salvar a previsão: '+U.esc(err.message||err),'error',8000);
    }
  },

  removeForecast(id){
    UI.confirm('Excluir esta previsão?',async()=>{
      try{
        await DB.del('forecasts',id);
        await State.reload();
        UI.closeAll(); UI.toast('Previsão excluída','warn'); App.render();
      }catch(err){
        UI.toast('Não foi possível excluir: '+U.esc(err.message||err),'error',7500);
      }
    });
  },

  /* ---------- recebimentos ---------- */

  receipts(measurementId=''){
    const rows=Array.isArray(State.measurementReceipts)?State.measurementReceipts:[];
    return (measurementId
      ? rows.filter(item=>String(item.measurementId||'')===String(measurementId))
      : rows).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  },

  receivedTotal(measurementId){
    return Math.round(this.receipts(measurementId)
      .reduce((sum,item)=>sum+(Number(item.value)||0),0)*100)/100;
  },

  settled(measurementId){
    return this.receipts(measurementId).some(item=>item.settles===true);
  },

  // Situação calculada. A medição não guarda nada disso.
  situation(measurement){
    if(!measurement) return {key:'pending',label:'Não recebida',received:0,open:0};
    const value=Math.round((Number(measurement.value)||0)*100)/100;
    const received=this.receivedTotal(measurement.id);
    const settled=this.settled(measurement.id);
    const open=Math.round(Math.max(0,value-received)*100)/100;
    if(settled||received>=value-0.01)
      return {key:'received',label:'Recebida',received,open:settled?0:open,settled};
    if(received>0)
      return {key:'partial',label:'Recebida parcialmente',received,open,settled};
    return {key:'pending',label:'Não recebida',received:0,open:value,settled};
  },

  situationTag(measurement){
    const situation=this.situation(measurement);
    const style={received:'tag-green',partial:'tag-amber',pending:'tag-gray'}[situation.key];
    return `<span class="tag ${style}">${U.esc(situation.label)}</span>`;
  },

  receiptForm(measurementId){
    if(!Views.medicoes.canEdit())
      return UI.toast('Seu usuário não pode registrar recebimentos.','warn',6000);
    const measurement=State.measurements.find(item=>String(item.id)===String(measurementId));
    if(!measurement) return;
    const situation=this.situation(measurement);
    const rows=this.receipts(measurementId);
    const project=State.projects.find(item=>String(item.id)===String(measurement.projectId));
    UI.modal({
      title:'Medição Recebida',
      wide:true,
      body:`<div class="rdo-detail-head">
        <div><small>Projeto</small><b>${U.esc(U.projLabel(project))}</b></div>
        <div><small>Medição</small><b>${U.esc(measurement.ref||measurement.id)} · ${U.date(measurement.date)}</b></div>
        <div><small>Valor medido</small><b>${U.money2(measurement.value)}</b></div>
        <div><small>Já recebido</small><b>${U.money2(situation.received)}</b></div>
        <div><small>Em aberto</small><b>${U.money2(situation.open)}</b></div>
      </div>
      ${rows.length?`<div class="table-wrap" style="margin-bottom:14px"><div class="table-scroll" style="max-height:30vh"><table>
        <thead><tr><th>Data</th><th>Origem</th><th>Observações</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${rows.map(row=>`<tr>
          <td>${U.date(row.date)}</td>
          <td><span class="tag ${row.origin==='omie'?'tag-blue':'tag-gray'}">${row.origin==='omie'?'Omie':'Manual'}</span>${row.settles?' <span class="tag tag-green">Quitou</span>':''}</td>
          <td>${U.esc(row.notes||'—')}</td>
          <td class="num"><b>${U.money2(row.value)}</b></td>
          <td><button class="btn btn-ghost btn-sm" onclick="CashFlow.removeReceipt(${U.jsArg(row.id)},${U.jsArg(measurementId)})" title="Excluir lançamento"><i data-lucide="trash-2"></i></button></td>
        </tr>`).join('')}</tbody>
      </table></div></div>`:''}
      ${situation.key==='received'
        ? '<div class="import-log">Esta medição já está quitada. Para reabrir, exclua um dos lançamentos acima.</div>'
        : `<div class="form-grid">
        <div><label>Valor Recebido *</label><input id="rc-value" type="number" min="0" step="0.01" value="${U.esc(situation.open||'')}"></div>
        <div><label>Data do Recebimento *</label><input id="rc-date" type="date" value="${U.esc(U.isoDate(new Date()))}"></div>
        <div class="full"><label class="check-item" style="border:none;padding:0"><input id="rc-settles" type="checkbox"><span><b>Encerrar a medição com este lançamento</b><small>Marque quando o saldo restante não será recebido — retenção contratual, desconto ou diferença de arredondamento.</small></span></label></div>
        <div class="full"><label>Observações</label><textarea id="rc-notes" rows="2" placeholder="Nº do documento, banco, observação da baixa…"></textarea></div>
      </div>
      <div class="import-log" id="rc-warning" style="margin-top:12px" hidden></div>`}`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Fechar</button>${situation.key==='received'?'':'<button class="btn btn-primary" id="rc-save"><i data-lucide="check"></i>Registrar recebimento</button>'}`,
      onOpen:()=>{
        if(situation.key==='received') return;
        const input=document.getElementById('rc-value');
        const warning=document.getElementById('rc-warning');
        const check=()=>{
          const value=Math.round(U.num(input.value)*100)/100;
          const diff=Math.round((value-situation.open)*100)/100;
          // Divergência é sinalizada, nunca bloqueia (regra do item 5).
          if(Math.abs(diff)>0.01){
            warning.hidden=false;
            warning.innerHTML=diff>0
              ? `⚠ O valor informado é ${U.money2(diff)} <b>maior</b> que o saldo em aberto de ${U.money2(situation.open)}. Você pode confirmar assim mesmo.`
              : `⚠ O valor informado é ${U.money2(Math.abs(diff))} <b>menor</b> que o saldo em aberto de ${U.money2(situation.open)}. O restante continuará em aberto, a menos que você marque o encerramento.`;
          }else warning.hidden=true;
        };
        input.oninput=check; check();
        document.getElementById('rc-save').onclick=()=>this.saveReceipt(measurementId);
      }
    });
  },

  async saveReceipt(measurementId){
    const measurement=State.measurements.find(item=>String(item.id)===String(measurementId));
    if(!measurement) return;
    const value=Math.round(U.num(document.getElementById('rc-value').value)*100)/100;
    const date=document.getElementById('rc-date').value;
    if(!(value>0)||!date) return UI.toast('Informe valor e data do recebimento.','warn');
    const object={
      id:U.id(),
      projectId:String(measurement.projectId),
      measurementId:String(measurementId),
      value,
      date,
      settles:document.getElementById('rc-settles').checked===true,
      origin:'manual',
      notes:document.getElementById('rc-notes').value.trim(),
      createdAt:new Date().toISOString()
    };
    try{
      await DB.put('measurement_receipts',object);
      await State.reload();
      UI.close(); UI.toast('Recebimento registrado','success'); App.render();
    }catch(err){
      UI.toast('Não foi possível registrar: '+U.esc(err.message||err),'error',8000);
    }
  },

  removeReceipt(id,measurementId=''){
    UI.confirm('Excluir este lançamento de recebimento? O valor volta a ficar em aberto.',async()=>{
      try{
        await DB.del('measurement_receipts',id);
        await State.reload();
        UI.closeAll();
        UI.toast('Lançamento excluído','warn');
        App.render();
        if(measurementId) setTimeout(()=>this.receiptForm(measurementId),0);
      }catch(err){
        UI.toast('Não foi possível excluir: '+U.esc(err.message||err),'error',7500);
      }
    });
  },

  /* ---------- indicadores do período ---------- */

  inPeriod(date,from,to){
    const value=String(date||'');
    if(!value) return false;
    if(from&&value<from) return false;
    if(to&&value>to) return false;
    return true;
  },

  // Os quatro indicadores do item 3, calculados sobre o período e o conjunto de
  // projetos já filtrados pela tela.
  summary(measurements,projectIds,from,to){
    const ids=new Set((projectIds||[]).map(String));
    const scoped=list=>list.filter(item=>!ids.size||ids.has(String(item.projectId)));

    const forecasts=scoped(this.forecasts());
    const billingForecast=forecasts.filter(item=>this.inPeriod(item.billingDate,from,to));
    const receiptForecast=forecasts.filter(item=>this.inPeriod(item.receiptDate,from,to));

    const invoiced=measurements
      .filter(item=>U.norm(item.status).startsWith('faturad')&&this.inPeriod(item.date,from,to))
      .reduce((sum,item)=>sum+(Number(item.value)||0),0);
    const received=scoped(this.receipts())
      .filter(item=>this.inPeriod(item.date,from,to))
      .reduce((sum,item)=>sum+(Number(item.value)||0),0);

    const round=value=>Math.round(value*100)/100;
    const forecastBilling=round(billingForecast.reduce((sum,item)=>sum+(Number(item.value)||0),0));
    const forecastReceipt=round(receiptForecast.reduce((sum,item)=>sum+(Number(item.value)||0),0));

    return {
      forecastBilling,
      forecastBillingNext:billingForecast.map(item=>item.billingDate).sort()[0]||'',
      forecastBillingCount:billingForecast.length,
      forecastReceipt,
      forecastReceiptNext:receiptForecast.map(item=>item.receiptDate).sort()[0]||'',
      forecastReceiptCount:receiptForecast.length,
      invoiced:round(invoiced),
      received:round(received),
      billingGap:round(invoiced-forecastBilling),
      receiptGap:round(received-forecastReceipt)
    };
  },

  gapMarkup(gap){
    if(Math.abs(gap)<0.01) return '<span class="tag tag-green">no previsto</span>';
    return gap>0
      ? `<span class="tag tag-green">${U.money(gap)} acima</span>`
      : `<span class="tag tag-amber">${U.money(Math.abs(gap))} abaixo</span>`;
  },

  /* ---------- conciliação dos recebimentos vindos do Omie (v4.2.0) ---------- */

  omieReceipts(){
    return this.receipts().filter(item=>String(item.origin||'')==='omie');
  },

  // Fila de conciliação: recebimento importado que ainda não foi vinculado a
  // uma medição nem descartado pelo usuário.
  pendingOmieReceipts(projectId=''){
    return this.omieReceipts().filter(item=>
      !String(item.measurementId||'')
      && item.dismissed!==true
      && (!projectId||String(item.projectId)===String(projectId))
    );
  },

  // O sistema nunca escolhe a medição sozinho. Só oferece as candidatas do
  // mesmo projeto que ainda têm saldo a receber, em ordem de data.
  candidateMeasurements(receipt){
    if(!receipt) return [];
    return State.measurements
      .filter(item=>String(item.projectId)===String(receipt.projectId))
      .filter(item=>this.situation(item).key!=='received')
      .sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  },

  reconcileQueue(){
    const rows=this.pendingOmieReceipts(State.filters.project||'');
    if(!rows.length) return UI.modal({
      title:'Recebimentos do Omie',
      body:'<div class="empty"><i data-lucide="check-check"></i><br>Nenhum recebimento aguardando conciliação.</div>',
      footer:'<button class="btn btn-primary" onclick="UI.close()">Fechar</button>'
    });
    const total=rows.reduce((sum,item)=>sum+(Number(item.value)||0),0);
    UI.modal({title:'Recebimentos do Omie aguardando conciliação',wide:true,body:`
      <p style="color:var(--text2);font-size:.85rem;margin-bottom:12px">Cada recebimento precisa ser vinculado manualmente à medição correspondente. O sistema não escolhe por você.</p>
      <div class="drill-path"><span class="crumb">${rows.length} recebimento(s)</span><span style="margin-left:auto"><b>${U.money2(total)}</b></span></div>
      <div class="table-wrap"><div class="table-scroll" style="max-height:52vh"><table>
        <thead><tr><th>Vencimento</th><th>Projeto</th><th>Cliente / Documento</th><th>Situação no Omie</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${rows.map(row=>{
          const project=State.projects.find(item=>String(item.id)===String(row.projectId));
          return `<tr>
            <td>${U.date(row.date)}</td>
            <td><b>${U.esc(U.projLabel(project))}</b></td>
            <td>${U.esc(row.customerName||'—')}<br><small style="color:var(--text3)">${U.esc(row.documentNumber||row.externalId||'')}</small></td>
            <td><span class="tag ${row.pendingAmount?'tag-amber':'tag-blue'}">${U.esc(row.omieStatus||'—')}</span></td>
            <td class="num">${row.pendingAmount?'<span class="tag tag-amber">a conferir</span>':`<b>${U.money2(row.value)}</b>`}</td>
            <td><div class="table-actions">
              <button class="btn btn-primary btn-sm" onclick="CashFlow.reconcileForm(${U.jsArg(row.id)})"><i data-lucide="link"></i>Conciliar</button>
              <button class="btn btn-ghost btn-sm" onclick="CashFlow.dismissReceipt(${U.jsArg(row.id)})" title="Não usar este recebimento"><i data-lucide="eye-off"></i></button>
            </div></td>
          </tr>`;}).join('')}</tbody>
      </table></div></div>`,
      footer:'<button class="btn btn-ghost" onclick="UI.close()">Fechar</button>'
    });
  },

  reconcileForm(receiptId){
    if(!Views.medicoes.canEdit())
      return UI.toast('Seu usuário não pode conciliar recebimentos.','warn',6000);
    const receipt=this.receipts().find(item=>String(item.id)===String(receiptId));
    if(!receipt) return;
    const project=State.projects.find(item=>String(item.id)===String(receipt.projectId));
    const candidates=this.candidateMeasurements(receipt);
    if(!candidates.length) return UI.toast(`Nenhuma medição em aberto no projeto ${U.esc(U.projLabel(project))} para receber este valor.`,'warn',7500);
    UI.modal({
      title:'Conciliar recebimento do Omie',
      wide:true,
      body:`<div class="rdo-detail-head">
        <div><small>Projeto</small><b>${U.esc(U.projLabel(project))}</b></div>
        <div><small>Cliente</small><b>${U.esc(receipt.customerName||'—')}</b></div>
        <div><small>Documento</small><b>${U.esc(receipt.documentNumber||receipt.externalId||'—')}</b></div>
        <div><small>Situação no Omie</small><b>${U.esc(receipt.omieStatus||'—')}</b></div>
      </div>
      ${receipt.pendingAmount?`<div class="permission-banner" style="margin-bottom:12px"><i data-lucide="alert-triangle"></i><span>O Omie marcou este título como <b>recebimento parcial</b> e não informa quanto foi baixado. Confira no Omie e digite abaixo o valor efetivamente recebido.</span></div>`:''}
      <div class="form-grid">
        <div class="full"><label>Medição correspondente *</label><select id="rc-measurement"><option value="">Selecione...</option>${candidates.map(item=>{
          const situation=this.situation(item);
          return `<option value="${U.esc(item.id)}">${U.date(item.date)} · ${U.esc(item.ref||item.id)} · medido ${U.money2(item.value)} · em aberto ${U.money2(situation.open)}</option>`;
        }).join('')}</select></div>
        <div><label>Valor Recebido *</label><input id="rc-amount" type="number" min="0" step="0.01" value="${U.esc(receipt.pendingAmount?'':receipt.value)}"></div>
        <div><label>Data do Recebimento *</label><input id="rc-when" type="date" value="${U.esc(receipt.date||U.isoDate(new Date()))}"></div>
        <div class="full"><label class="check-item" style="border:none;padding:0"><input id="rc-close" type="checkbox"><span><b>Encerrar a medição com este lançamento</b><small>Marque quando o saldo restante não será recebido.</small></span></label></div>
        <div class="full"><label>Observações</label><textarea id="rc-obs" rows="2">${U.esc(receipt.notes||'')}</textarea></div>
      </div>
      <div class="import-log" id="rc-diff" style="margin-top:12px" hidden></div>`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button><button class="btn btn-primary" id="rc-confirm"><i data-lucide="check"></i>Medição Recebida</button>`,
      onOpen:()=>{
        const select=document.getElementById('rc-measurement');
        const amount=document.getElementById('rc-amount');
        const diff=document.getElementById('rc-diff');
        const check=()=>{
          const measurement=State.measurements.find(item=>String(item.id)===String(select.value));
          const value=Math.round(U.num(amount.value)*100)/100;
          if(!measurement||!(value>0)){ diff.hidden=true; return; }
          const open=this.situation(measurement).open;
          const gap=Math.round((value-open)*100)/100;
          // Divergência é sinalizada e nunca bloqueia (item 5 da especificação).
          if(Math.abs(gap)>0.01){
            diff.hidden=false;
            diff.innerHTML=gap>0
              ? `⚠ O valor recebido é ${U.money2(gap)} <b>maior</b> que o saldo em aberto da medição (${U.money2(open)}). Você pode confirmar assim mesmo.`
              : `⚠ O valor recebido é ${U.money2(Math.abs(gap))} <b>menor</b> que o saldo em aberto da medição (${U.money2(open)}). O restante continuará em aberto, a menos que você marque o encerramento.`;
          }else diff.hidden=true;
        };
        select.onchange=check; amount.oninput=check; check();
        document.getElementById('rc-confirm').onclick=()=>this.confirmReconcile(receiptId);
      }
    });
  },

  async confirmReconcile(receiptId){
    const receipt=this.receipts().find(item=>String(item.id)===String(receiptId));
    if(!receipt) return;
    const measurementId=document.getElementById('rc-measurement').value;
    const value=Math.round(U.num(document.getElementById('rc-amount').value)*100)/100;
    const date=document.getElementById('rc-when').value;
    if(!measurementId) return UI.toast('Selecione a medição correspondente.','warn');
    if(!(value>0)) return UI.toast('Informe o valor efetivamente recebido.','warn');
    if(!date) return UI.toast('Informe a data do recebimento.','warn');
    const measurement=State.measurements.find(item=>String(item.id)===String(measurementId));
    if(!measurement||String(measurement.projectId)!==String(receipt.projectId))
      return UI.toast('A medição precisa pertencer ao mesmo projeto do recebimento.','warn',6500);
    try{
      UI.loading(true,'Conciliando recebimento…');
      await DB.put('measurement_receipts',{
        ...receipt,
        measurementId:String(measurementId),
        value,
        date,
        settles:document.getElementById('rc-close').checked===true,
        pendingAmount:false,
        reviewedByUser:true,
        notes:document.getElementById('rc-obs').value.trim(),
        reconciledAt:new Date().toISOString()
      });
      await State.reload();
      UI.loading(false); UI.closeAll();
      UI.toast('Recebimento conciliado com a medição.','success',6000);
      App.render();
    }catch(err){
      UI.loading(false);
      UI.toast('Não foi possível conciliar: '+U.esc(err.message||err),'error',8000);
    }
  },

  dismissReceipt(receiptId){
    const receipt=this.receipts().find(item=>String(item.id)===String(receiptId));
    if(!receipt) return;
    UI.confirm('Não usar este recebimento do Omie?<br><br>Ele sai da fila de conciliação e não volta nas próximas sincronizações. Nenhuma medição é alterada.',async()=>{
      try{
        await DB.put('measurement_receipts',{...receipt,dismissed:true,reviewedByUser:true,dismissedAt:new Date().toISOString()});
        await State.reload();
        UI.closeAll(); UI.toast('Recebimento retirado da fila.','warn',5500); App.render();
        setTimeout(()=>this.reconcileQueue(),0);
      }catch(err){
        UI.toast('Não foi possível retirar da fila: '+U.esc(err.message||err),'error',7500);
      }
    });
  },

  /* ---------- tabela de previsões por projeto (aba Provisões, v4.4.0) ---------- */

  // Data de execução prevista: usa measurementDate quando informado; cai para
  // billingDate em previsões antigas (anteriores à v4.4.0), que não tinham
  // esse campo, para não sumirem do planejamento mensal.
  plannedExecutionDate(row){
    return row.measurementDate||row.billingDate||'';
  },

  projectForecastTable(projectId){
    const rows=this.forecasts(projectId);
    if(!rows.length) return '';
    const project=State.projects.find(item=>String(item.id)===String(projectId));
    const total=rows.reduce((sum,item)=>sum+(Number(item.value)||0),0);
    return `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <h3>${U.esc(U.projLabel(project))}</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="tag tag-blue">${rows.length} previsão(ões)</span><b>${U.money2(total)} previsto</b></div>
      </div>
      <div class="table-scroll" style="max-height:260px"><table>
        <thead><tr><th>Execução prevista</th><th>Faturamento previsto</th><th>Condição</th><th>Recebimento previsto</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${rows.map(row=>`<tr>
          <td>${row.measurementDate?U.date(row.measurementDate):'—'}</td>
          <td>${U.date(row.billingDate)}</td>
          <td>${U.esc(this.termLabel(row.paymentTermDays))}</td>
          <td>${row.receiptDate?U.date(row.receiptDate):'—'}</td>
          <td class="num"><b>${U.money2(row.value)}</b></td>
          <td>${Views.medicoes.canEdit()?`<button class="btn btn-ghost btn-sm" onclick="CashFlow.forecastForm(${U.jsArg(row.id)})" title="Editar previsão"><i data-lucide="pencil"></i></button>`:''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  },

  /* ---------- aba Provisões: planejamento futuro mês a mês (v4.4.0) ---------- */

  provisionsFrom:'',
  provisionsTo:'',
  ensureProvisionsPeriod(){
    if(this.provisionsFrom&&this.provisionsTo) return;
    const today=new Date();
    this.provisionsFrom=U.isoDate(new Date(today.getFullYear(),today.getMonth(),1));
    this.provisionsTo=U.isoDate(new Date(today.getFullYear(),today.getMonth()+5,0));
  },
  applyProvisionsFilters(){
    this.provisionsFrom=document.getElementById('cf-period-from').value;
    this.provisionsTo=document.getElementById('cf-period-to').value;
    Views.medicoes.render();
  },
  clearProvisionsFilters(){
    this.provisionsFrom=''; this.provisionsTo='';
    this.ensureProvisionsPeriod(); Views.medicoes.render();
  },

  monthKey(date){
    return /^\d{4}-\d{2}/.test(String(date||''))?String(date).slice(0,7):'';
  },
  monthLabel(key){
    const parts=String(key||'').split('-').map(Number);
    if(parts.length!==2||Number.isNaN(parts[0])||Number.isNaN(parts[1])) return key;
    return `${String(parts[1]).padStart(2,'0')}/${parts[0]}`;
  },
  // Lista de meses (chave 'AAAA-MM') entre from/to, limitada a 36 meses como
  // proteção contra período informado incorretamente.
  monthsInRange(from,to){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(from||''))||!/^\d{4}-\d{2}-\d{2}$/.test(String(to||''))) return [];
    const start=new Date(`${from}T12:00:00`);
    const end=new Date(`${to}T12:00:00`);
    if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||start>end) return [];
    const months=[];
    let cursor=new Date(start.getFullYear(),start.getMonth(),1);
    const last=new Date(end.getFullYear(),end.getMonth(),1);
    let guard=0;
    while(cursor<=last&&guard<36){
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`);
      cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);
      guard++;
    }
    return months;
  },

  // Previsto x realizado, mês a mês, nos três estágios do planejamento
  // (execução, faturamento, recebimento). Não altera nenhum registro.
  provisionsMonthly(projectIds){
    const ids=new Set((projectIds||[]).map(String));
    const scoped=list=>list.filter(item=>!ids.size||ids.has(String(item.projectId)));
    const forecasts=scoped(this.forecasts());
    const measurements=scoped(State.measurements);
    const receipts=scoped(this.receipts());
    const months=this.monthsInRange(this.provisionsFrom,this.provisionsTo);
    const sumBy=(list,keyFn)=>month=>list.filter(item=>keyFn(item)===month).reduce((sum,item)=>sum+(Number(item.value)||0),0);
    const plannedExecution=sumBy(forecasts,item=>this.monthKey(this.plannedExecutionDate(item)));
    const plannedBilling=sumBy(forecasts,item=>this.monthKey(item.billingDate));
    const plannedReceipt=sumBy(forecasts,item=>this.monthKey(item.receiptDate));
    const actualExecution=sumBy(measurements,item=>this.monthKey(item.date));
    const actualBilling=sumBy(measurements.filter(item=>U.norm(item.status).startsWith('faturad')),item=>this.monthKey(item.date));
    const actualReceipt=sumBy(receipts,item=>this.monthKey(item.date));
    return months.map(month=>({
      month,
      label:this.monthLabel(month),
      plannedExecution:plannedExecution(month),
      actualExecution:actualExecution(month),
      plannedBilling:plannedBilling(month),
      actualBilling:actualBilling(month),
      plannedReceipt:plannedReceipt(month),
      actualReceipt:actualReceipt(month)
    }));
  },

  monthlyTableMarkup(rows){
    if(!rows.length) return '<div class="empty card"><i data-lucide="calendar-x"></i><br>Informe um período válido para ver o previsto x realizado mês a mês.</div>';
    return `<div class="card" style="margin-bottom:16px">
      <h3 style="margin-bottom:2px">Previsto x realizado por mês</h3>
      <small style="display:block;margin-bottom:10px;color:var(--text3)">Clique em um mês para abrir o detalhamento por projeto.</small>
      <div class="table-scroll"><table>
        <thead><tr><th>Mês</th><th class="num">Execução prevista</th><th class="num">Execução realizada</th><th class="num">Faturamento previsto</th><th class="num">Faturamento realizado</th><th class="num">Recebimento previsto</th><th class="num">Recebimento realizado</th></tr></thead>
        <tbody>${rows.map(row=>`<tr class="clickable" onclick="CashFlow.openMonthBreakdown(${U.jsArg(row.month)})" title="Ver o detalhamento por projeto de ${U.esc(row.label)}">
          <td><b>${U.esc(row.label)}</b></td>
          <td class="num">${U.money2(row.plannedExecution)}</td>
          <td class="num">${U.money2(row.actualExecution)}${row.plannedExecution||row.actualExecution?`<br>${this.gapMarkup(row.actualExecution-row.plannedExecution)}`:''}</td>
          <td class="num">${U.money2(row.plannedBilling)}</td>
          <td class="num">${U.money2(row.actualBilling)}${row.plannedBilling||row.actualBilling?`<br>${this.gapMarkup(row.actualBilling-row.plannedBilling)}`:''}</td>
          <td class="num">${U.money2(row.plannedReceipt)}</td>
          <td class="num">${U.money2(row.actualReceipt)}${row.plannedReceipt||row.actualReceipt?`<br>${this.gapMarkup(row.actualReceipt-row.plannedReceipt)}`:''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  },

  /* ---------- detalhamento do mês por projeto (v4.2.2) ---------- */

  monthScopeIds(){
    return State.filters.project?[String(State.filters.project)]:State.projects.map(item=>String(item.id));
  },

  // Usa exatamente as mesmas datas e o mesmo filtro de status de
  // provisionsMonthly(), para que a soma das linhas por projeto feche com o
  // total do mês exibido na tabela. Somente leitura.
  provisionsByProjectForMonth(month,projectIds){
    const ids=new Set((projectIds||[]).map(String));
    const inScope=item=>!ids.size||ids.has(String(item.projectId));
    const bucket={};
    const add=(projectId,field,value)=>{
      const key=String(projectId);
      bucket[key]=bucket[key]||{projectId:key,plannedExecution:0,actualExecution:0,plannedBilling:0,actualBilling:0,plannedReceipt:0,actualReceipt:0};
      bucket[key][field]+=Number(value)||0;
    };
    this.forecasts().filter(inScope).forEach(item=>{
      if(this.monthKey(this.plannedExecutionDate(item))===month) add(item.projectId,'plannedExecution',item.value);
      if(this.monthKey(item.billingDate)===month) add(item.projectId,'plannedBilling',item.value);
      if(this.monthKey(item.receiptDate)===month) add(item.projectId,'plannedReceipt',item.value);
    });
    State.measurements.filter(inScope).forEach(item=>{
      if(this.monthKey(item.date)!==month) return;
      add(item.projectId,'actualExecution',item.value);
      if(U.norm(item.status).startsWith('faturad')) add(item.projectId,'actualBilling',item.value);
    });
    this.receipts().filter(inScope).forEach(item=>{
      if(this.monthKey(item.date)===month) add(item.projectId,'actualReceipt',item.value);
    });
    return Object.values(bucket).map(row=>{
      const project=State.projects.find(item=>String(item.id)===row.projectId);
      return {
        ...row,
        proposal:String((project&&project.proposal)||''),
        projectName:String((project&&project.name)||''),
        label:project?U.projLabel(project):'Projeto não encontrado'
      };
    }).sort((a,b)=>String(a.proposal).localeCompare(String(b.proposal),undefined,{numeric:true}));
  },

  sumBreakdown(rows){
    return rows.reduce((sum,row)=>({
      plannedExecution:sum.plannedExecution+row.plannedExecution,
      actualExecution:sum.actualExecution+row.actualExecution,
      plannedBilling:sum.plannedBilling+row.plannedBilling,
      actualBilling:sum.actualBilling+row.actualBilling,
      plannedReceipt:sum.plannedReceipt+row.plannedReceipt,
      actualReceipt:sum.actualReceipt+row.actualReceipt
    }),{plannedExecution:0,actualExecution:0,plannedBilling:0,actualBilling:0,plannedReceipt:0,actualReceipt:0});
  },

  openMonthBreakdown(month){
    const rows=this.provisionsByProjectForMonth(month,this.monthScopeIds());
    const label=this.monthLabel(month);
    if(!rows.length) return UI.toast(`Nenhum lançamento previsto ou realizado em ${label}.`,'info',5000);
    const totals=this.sumBreakdown(rows);
    UI.modal({
      title:`Previsto x realizado · ${label}`,
      wide:true,
      body:`<div class="table-wrap"><div class="table-scroll" style="max-height:56vh"><table>
        <thead><tr><th>Projeto</th><th class="num">Execução prevista</th><th class="num">Execução realizada</th><th class="num">Faturamento previsto</th><th class="num">Faturamento realizado</th><th class="num">Recebimento previsto</th><th class="num">Recebimento realizado</th></tr></thead>
        <tbody>${rows.map(row=>`<tr>
          <td><b>${U.esc(row.proposal||'—')}</b>${row.projectName?`<br><small style="color:var(--text3)">${U.esc(row.projectName)}</small>`:''}</td>
          <td class="num">${U.money2(row.plannedExecution)}</td>
          <td class="num">${U.money2(row.actualExecution)}</td>
          <td class="num">${U.money2(row.plannedBilling)}</td>
          <td class="num">${U.money2(row.actualBilling)}</td>
          <td class="num">${U.money2(row.plannedReceipt)}</td>
          <td class="num">${U.money2(row.actualReceipt)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr>
          <td><b>TOTAL DE ${U.esc(label)}</b></td>
          <td class="num"><b>${U.money2(totals.plannedExecution)}</b></td>
          <td class="num"><b>${U.money2(totals.actualExecution)}</b></td>
          <td class="num"><b>${U.money2(totals.plannedBilling)}</b></td>
          <td class="num"><b>${U.money2(totals.actualBilling)}</b></td>
          <td class="num"><b>${U.money2(totals.plannedReceipt)}</b></td>
          <td class="num"><b>${U.money2(totals.actualReceipt)}</b></td>
        </tr></tfoot>
      </table></div></div>`,
      footer:`<button class="btn btn-ghost" onclick="CashFlow.printMonthBreakdown(${U.jsArg(month)})"><i data-lucide="file-down"></i>Gerar PDF</button><button class="btn btn-primary" onclick="UI.close()">Fechar</button>`
    });
  },

  // PDF do detalhamento do mês. A4 deitado, porque são sete colunas.
  async printMonthBreakdown(month){
    const rows=this.provisionsByProjectForMonth(month,this.monthScopeIds());
    const label=this.monthLabel(month);
    if(!rows.length) return UI.toast(`Nenhum lançamento previsto ou realizado em ${label}.`,'info',5000);
    const totals=this.sumBreakdown(rows);
    const projectId=State.filters.project||'';
    const project=projectId?State.projects.find(item=>String(item.id)===String(projectId)):null;
    const client=projectId?this.clientOf(projectId):null;
    const old=document.getElementById('provisions-month-print-report');
    if(old) old.remove();
    const report=document.createElement('section');
    report.id='provisions-month-print-report';
    const companyLogo=U.safeImageSrc(State.settings.companyLogo)||'assets/logo-clique.png';
    const companyCnpj=U.formatCnpj(State.settings.companyCnpj||'');
    report.innerHTML=`${typeof Exports!=='undefined'?Exports.stationeryMarkup():''}
      <header class="provisions-print-head">
        <div class="provisions-print-company"><img src="${U.esc(companyLogo)}" alt=""><div><small>CONTRATADA</small><b>${U.esc(State.settings.companyName||'CliqueObras')}</b><span>${companyCnpj?`CNPJ ${U.esc(companyCnpj)} · `:''}Detalhamento por projeto</span></div></div>
        <div class="provisions-print-client">${client&&U.safeImageSrc(client.logo)?`<img src="${U.esc(U.safeImageSrc(client.logo))}" alt="">`:`<span>${U.esc(U.initials(project?U.projLabel(project):'Todos'))}</span>`}<div><small>${project?'PROJETO':'ESCOPO'}</small><b>${U.esc(project?U.projLabel(project):'Todos os projetos')}</b><span>${U.esc(client?client.name:`${rows.length} projeto(s) no mês`)}</span></div></div>
        <div class="provisions-print-period"><small>COMPETÊNCIA</small><b>${U.esc(label)}</b></div>
      </header>
      <div class="provisions-print-facts">
        <div><small>Execução prevista</small><b>${U.money(totals.plannedExecution)}</b></div>
        <div><small>Execução realizada</small><b>${U.money(totals.actualExecution)}</b></div>
        <div><small>Faturamento previsto</small><b>${U.money(totals.plannedBilling)}</b></div>
        <div><small>Faturamento realizado</small><b>${U.money(totals.actualBilling)}</b></div>
        <div><small>Recebimento previsto</small><b>${U.money(totals.plannedReceipt)}</b></div>
        <div><small>Recebimento realizado</small><b>${U.money(totals.actualReceipt)}</b></div>
      </div>
      <table class="provisions-print-table"><thead><tr><th>Projeto</th><th>Execução prevista</th><th>Execução realizada</th><th>Faturamento previsto</th><th>Faturamento realizado</th><th>Recebimento previsto</th><th>Recebimento realizado</th></tr></thead><tbody>
        ${rows.map(row=>`<tr><td>${U.esc(row.proposal||'—')}${row.projectName?` · ${U.esc(row.projectName)}`:''}</td><td>${U.money(row.plannedExecution)}</td><td>${U.money(row.actualExecution)}</td><td>${U.money(row.plannedBilling)}</td><td>${U.money(row.actualBilling)}</td><td>${U.money(row.plannedReceipt)}</td><td>${U.money(row.actualReceipt)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>TOTAL DE ${U.esc(label)}</td><td>${U.money(totals.plannedExecution)}</td><td>${U.money(totals.actualExecution)}</td><td>${U.money(totals.plannedBilling)}</td><td>${U.money(totals.actualBilling)}</td><td>${U.money(totals.plannedReceipt)}</td><td>${U.money(totals.actualReceipt)}</td></tr></tfoot></table>
      <footer>Documento gerado pelo CliqueObras em ${new Date().toLocaleString('pt-BR')}.</footer>`;
    document.body.appendChild(report);
    document.body.classList.add('printing-provisions-month');
    UI.closeAll();
    UI.loading(true,'Preparando detalhamento do mês…');
    if(typeof Exports!=='undefined') await Exports.waitForImages(report);
    UI.loading(false);
    UI.toast('Na janela de impressão, selecione “Salvar como PDF”.','info',6000);
    window.addEventListener('afterprint',()=>{report.remove();document.body.classList.remove('printing-provisions-month');},{once:true});
    setTimeout(()=>window.print(),250);
  },

  /* ---------- relatório impresso: previsto x realizado (aba Provisões, v4.2.1) ---------- */

  // Filtrável pelo projeto selecionado no filtro global e pela competência
  // (período De/Até) já aplicada na aba Provisões. Somente leitura — reaproveita
  // provisionsMonthly() e não grava nada em forecasts/measurements/receipts.
  async printProvisionsReport(){
    this.ensureProvisionsPeriod();
    const projectId=State.filters.project||'';
    const scopedProjectIds=projectId?[String(projectId)]:State.projects.map(p=>String(p.id));
    const rows=this.provisionsMonthly(scopedProjectIds);
    if(!rows.length) return UI.toast('Informe um período válido para gerar o relatório.','warn');
    const totals=rows.reduce((sum,row)=>({
      plannedExecution:sum.plannedExecution+row.plannedExecution,
      actualExecution:sum.actualExecution+row.actualExecution,
      plannedBilling:sum.plannedBilling+row.plannedBilling,
      actualBilling:sum.actualBilling+row.actualBilling,
      plannedReceipt:sum.plannedReceipt+row.plannedReceipt,
      actualReceipt:sum.actualReceipt+row.actualReceipt
    }),{plannedExecution:0,actualExecution:0,plannedBilling:0,actualBilling:0,plannedReceipt:0,actualReceipt:0});
    const project=projectId?State.projects.find(item=>String(item.id)===String(projectId)):null;
    const client=projectId?this.clientOf(projectId):null;
    const old=document.getElementById('provisions-print-report');
    if(old) old.remove();
    const report=document.createElement('section');
    report.id='provisions-print-report';
    const companyLogo=U.safeImageSrc(State.settings.companyLogo)||'assets/logo-clique.png';
    const companyCnpj=U.formatCnpj(State.settings.companyCnpj||'');
    const periodLabel=`${this.monthLabel(this.monthKey(this.provisionsFrom))} a ${this.monthLabel(this.monthKey(this.provisionsTo))}`;
    report.innerHTML=`${typeof Exports!=='undefined'?Exports.stationeryMarkup():''}
      <header class="provisions-print-head">
        <div class="provisions-print-company"><img src="${U.esc(companyLogo)}" alt=""><div><small>CONTRATADA</small><b>${U.esc(State.settings.companyName||'CliqueObras')}</b><span>${companyCnpj?`CNPJ ${U.esc(companyCnpj)} · `:''}Relatório previsto x realizado</span></div></div>
        <div class="provisions-print-client">${client&&U.safeImageSrc(client.logo)?`<img src="${U.esc(U.safeImageSrc(client.logo))}" alt="">`:`<span>${U.esc(U.initials(project?U.projLabel(project):'Todos'))}</span>`}<div><small>${project?'PROJETO':'ESCOPO'}</small><b>${U.esc(project?U.projLabel(project):'Todos os projetos')}</b><span>${U.esc(client?client.name:`${scopedProjectIds.length} projeto(s) com previsão`)}</span></div></div>
        <div class="provisions-print-period"><small>COMPETÊNCIA</small><b>${U.esc(periodLabel)}</b></div>
      </header>
      <div class="provisions-print-facts">
        <div><small>Execução prevista</small><b>${U.money(totals.plannedExecution)}</b></div>
        <div><small>Execução realizada</small><b>${U.money(totals.actualExecution)}</b></div>
        <div><small>Faturamento previsto</small><b>${U.money(totals.plannedBilling)}</b></div>
        <div><small>Faturamento realizado</small><b>${U.money(totals.actualBilling)}</b></div>
        <div><small>Recebimento previsto</small><b>${U.money(totals.plannedReceipt)}</b></div>
        <div><small>Recebimento realizado</small><b>${U.money(totals.actualReceipt)}</b></div>
      </div>
      <table class="provisions-print-table"><thead><tr><th>Mês</th><th>Execução prevista</th><th>Execução realizada</th><th>Faturamento previsto</th><th>Faturamento realizado</th><th>Recebimento previsto</th><th>Recebimento realizado</th></tr></thead><tbody>
        ${rows.map(row=>`<tr><td>${U.esc(row.label)}</td><td>${U.money(row.plannedExecution)}</td><td>${U.money(row.actualExecution)}</td><td>${U.money(row.plannedBilling)}</td><td>${U.money(row.actualBilling)}</td><td>${U.money(row.plannedReceipt)}</td><td>${U.money(row.actualReceipt)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>TOTAL</td><td>${U.money(totals.plannedExecution)}</td><td>${U.money(totals.actualExecution)}</td><td>${U.money(totals.plannedBilling)}</td><td>${U.money(totals.actualBilling)}</td><td>${U.money(totals.plannedReceipt)}</td><td>${U.money(totals.actualReceipt)}</td></tr></tfoot></table>
      <footer>Documento gerado pelo CliqueObras em ${new Date().toLocaleString('pt-BR')}.</footer>`;
    document.body.appendChild(report);
    document.body.classList.add('printing-provisions');
    UI.loading(true,'Preparando relatório de provisões…');
    if(typeof Exports!=='undefined') await Exports.waitForImages(report);
    UI.loading(false);
    UI.toast('Na janela de impressão, selecione “Salvar como PDF”.','info',6000);
    window.addEventListener('afterprint',()=>{report.remove();document.body.classList.remove('printing-provisions');},{once:true});
    setTimeout(()=>window.print(),250);
  },

  renderProvisions(){
    this.ensureProvisionsPeriod();
    const scopedProjectIds=State.filters.project?[String(State.filters.project)]:State.projects.map(p=>String(p.id));
    const measurementsInPeriod=State.measurements.filter(m=>
      (!State.filters.project||String(m.projectId)===String(State.filters.project))
      && this.inPeriod(m.date,this.provisionsFrom,this.provisionsTo));
    const cash=this.summary(measurementsInPeriod,scopedProjectIds,this.provisionsFrom,this.provisionsTo);
    const projectsWithForecasts=State.projects
      .filter(p=>!State.filters.project||String(p.id)===String(State.filters.project))
      .filter(p=>this.forecasts(p.id).length);
    $c().innerHTML=`<div class="toolbar">
      <div><h2>Provisões</h2><small>Planeje, por projeto, as execuções, faturamentos e recebimentos futuros — o recebimento segue a condição de pagamento cadastrada no cliente.</small></div>
      <div class="spacer"></div>
      ${Views.medicoes.canEdit()?'<button class="btn btn-primary" onclick="CashFlow.forecastForm()"><i data-lucide="calendar-plus"></i>Nova Previsão</button>':''}
      <button class="btn btn-ghost" onclick="CashFlow.printProvisionsReport()"><i data-lucide="file-down"></i>Relatório Previsto x Realizado</button>
    </div>
    ${Views.medicoes.tabsMarkup()}
    <div class="toolbar" style="gap:10px;flex-wrap:wrap">
      <div><label style="font-size:.72rem">De</label><input id="cf-period-from" type="date" value="${U.esc(this.provisionsFrom)}"></div>
      <div><label style="font-size:.72rem">Até</label><input id="cf-period-to" type="date" value="${U.esc(this.provisionsTo)}"></div>
      <div class="spacer"></div>
      <button class="btn btn-ghost btn-sm" onclick="CashFlow.applyProvisionsFilters()"><i data-lucide="filter"></i>Aplicar</button>
      <button class="btn btn-ghost btn-sm" onclick="CashFlow.clearProvisionsFilters()"><i data-lucide="rotate-ccw"></i>Limpar</button>
    </div>
    <div class="kpi-grid">
      <div class="kpi accent-blue"><div class="k-label"><i data-lucide="calendar-clock"></i>Previsão de Medição</div><div class="k-value">${U.money(cash.forecastBilling)}</div><div class="k-sub">${cash.forecastBillingCount?`${cash.forecastBillingCount} previsão(ões) · a partir de ${U.date(cash.forecastBillingNext)}`:'Sem previsão no período'}</div></div>
      <div class="kpi accent-blue"><div class="k-label"><i data-lucide="calendar-check"></i>Previsão de Recebimento</div><div class="k-value">${U.money(cash.forecastReceipt)}</div><div class="k-sub">${cash.forecastReceiptCount?`${cash.forecastReceiptCount} previsão(ões) · a partir de ${U.date(cash.forecastReceiptNext)}`:'Sem previsão no período'}</div></div>
      <div class="kpi accent-green"><div class="k-label"><i data-lucide="file-check-2"></i>Previsto x Faturado</div><div class="k-value">${U.money(cash.invoiced)}</div><div class="k-sub">previsto ${U.money(cash.forecastBilling)} · ${this.gapMarkup(cash.billingGap)}</div></div>
      <div class="kpi accent-green"><div class="k-label"><i data-lucide="coins"></i>Previsto x Recebido</div><div class="k-value">${U.money(cash.received)}</div><div class="k-sub">previsto ${U.money(cash.forecastReceipt)} · ${this.gapMarkup(cash.receiptGap)}</div></div>
    </div>
    ${this.monthlyTableMarkup(this.provisionsMonthly(scopedProjectIds))}
    <h3 style="margin:4px 0 10px">Previsões lançadas por projeto</h3>
    ${projectsWithForecasts.length?projectsWithForecasts.map(p=>this.projectForecastTable(p.id)).join(''):'<div class="empty card"><i data-lucide="calendar-plus"></i><br>Nenhuma previsão lançada para os projetos e filtro selecionados.</div>'}`;
    U.icons();
  }
};
