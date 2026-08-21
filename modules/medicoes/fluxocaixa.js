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
      billingDate:U.isoDate(new Date()),
      notes:''
    };
    UI.modal({
      title:id?'Editar Previsão':'Nova Previsão',
      body:`<div class="form-grid">
        <div class="full"><label>Projeto *</label><select id="fc-project">${State.projects.map(project=>`<option value="${U.esc(project.id)}" ${String(project.id)===String(forecast.projectId)?'selected':''}>${U.esc(U.projLabel(project))}</option>`).join('')}</select></div>
        <div><label>Valor Previsto *</label><input id="fc-value" type="number" min="0" step="0.01" value="${U.esc(forecast.value||'')}"></div>
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

  /* ---------- bloco de previsões dentro do card do projeto ---------- */

  projectForecastMarkup(projectId){
    const rows=this.forecasts(projectId);
    if(!rows.length) return '';
    const total=rows.reduce((sum,item)=>sum+(Number(item.value)||0),0);
    return `<details class="cashflow-forecasts" style="margin-top:10px">
      <summary><b>${rows.length}</b> previsão(ões) · <b>${U.money2(total)}</b></summary>
      <div class="table-scroll" style="max-height:200px;margin-top:8px"><table>
        <thead><tr><th>Faturamento previsto</th><th>Recebimento previsto</th><th>Condição</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${rows.map(row=>`<tr>
          <td>${U.date(row.billingDate)}</td>
          <td>${U.date(row.receiptDate)}</td>
          <td>${U.esc(this.termLabel(row.paymentTermDays))}</td>
          <td class="num"><b>${U.money2(row.value)}</b></td>
          <td>${Views.medicoes.canEdit()?`<button class="btn btn-ghost btn-sm" onclick="CashFlow.forecastForm(${U.jsArg(row.id)})" title="Editar previsão"><i data-lucide="pencil"></i></button>`:''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </details>`;
  }
};
