/**
 * Módulo Custos — Tela Base de Cálculo (basecalculo.js)
 *
 * Responsabilidades:
 * - tela de edição dos percentuais (impostos, adm, taxas, outros)
 *
 * Dependências:
 * - custos (Biz.baseRates)
 * - database
 * - utils
 *
 * Não modificar:
 * - chave settings.baseCalc
 */

/* ---------- BASE DE CÁLCULO ---------- */
Views.basecalculo = {
  title:'Base de Cálculo',
  render(){
    const b = Biz.baseRates();
    const target = State.settings.marginTarget ?? 10;
    const currentMonth=U.isoDate(new Date()).slice(0,7);
    const history=Biz.baseHistory().slice().reverse();
    $c().innerHTML = `
      <div class="card" style="max-width:560px">
        <h2 style="margin-bottom:6px">Percentuais por competência</h2>
        <p style="color:var(--text2);font-size:.86rem;margin-bottom:16px">Cadastre a base válida em cada mês. Obras concluídas guardam a média do período em que estiveram em andamento e não recebem alterações futuras.</p>
        <div class="form-grid">
          <div class="full"><label>Competência *</label><input id="bc-effective" type="month" value="${currentMonth}"><small>Selecione um mês anterior para cadastrar ou corrigir o histórico.</small></div>
          <div><label>Impostos (%)</label><input id="bc-tax" type="number" step="0.01" value="${U.esc(b.tax||'')}"></div>
          <div><label>Custo Administrativo (%)</label><input id="bc-admin" type="number" step="0.01" value="${U.esc(b.admin||'')}"></div>
          <div><label>Taxas (%)</label><input id="bc-fees" type="number" step="0.01" value="${U.esc(b.fees||'')}"></div>
          <div><label>Outros Custos (%)</label><input id="bc-other" type="number" step="0.01" value="${U.esc(b.other||'')}"></div>
          <div class="full"><label>Meta de Margem Mínima (%)</label><input id="bc-target" type="number" step="0.5" value="${target}"></div>
        </div>
        <div style="margin-top:16px;display:flex;justify-content:flex-end">
          <button class="btn btn-primary" id="bc-save"><i data-lucide="check"></i>Salvar competência</button></div>
      </div>
      <div class="card" style="max-width:560px;margin-top:14px">
        <h3>Total de encargos: <b id="bc-total" style="color:var(--blue)"></b></h3>
        <small style="color:var(--text3)">Exemplo: em um projeto de venda ${U.money(1000000)}, os encargos representam <b id="bc-example"></b>.</small>
      </div>
      <div class="card" style="max-width:760px;margin-top:14px">
        <h3 style="margin-bottom:8px">Histórico mensal</h3>
        <p style="color:var(--text2);font-size:.84rem;margin-bottom:12px">Clique em uma competência para revisar os percentuais. O sistema mantém no máximo 240 versões.</p>
        <div class="table-wrap"><div class="table-scroll"><table>
          <thead><tr><th>Competência</th><th class="num">Impostos</th><th class="num">Administrativo</th><th class="num">Taxas</th><th class="num">Outros</th><th class="num">Total</th></tr></thead>
          <tbody>${history.map(item=>`<tr class="clickable" onclick="Views.basecalculo.loadCompetence('${item.effectiveFrom.slice(0,7)}')">
            <td><b>${item.effectiveFrom.slice(5,7)}/${item.effectiveFrom.slice(0,4)}</b></td>
            <td class="num">${U.pct(item.rates.tax,2)}</td><td class="num">${U.pct(item.rates.admin,2)}</td><td class="num">${U.pct(item.rates.fees,2)}</td><td class="num">${U.pct(item.rates.other,2)}</td><td class="num"><b>${U.pct(item.rates.total,2)}</b></td>
          </tr>`).join('')||'<tr><td colspan="6"><div class="empty">O histórico começa quando a primeira competência for salva.</div></td></tr>'}</tbody>
        </table></div></div>
      </div>`;
    const update = () => {
      const t = ['tax','admin','fees','other'].reduce((s,k)=>s+U.num(document.getElementById('bc-'+k).value),0);
      document.getElementById('bc-total').textContent = U.pct(t,2);
      document.getElementById('bc-example').textContent = U.money(1000000*t/100);
    };
    ['tax','admin','fees','other'].forEach(k => document.getElementById('bc-'+k).oninput = update);
    document.getElementById('bc-effective').onchange=event=>this.loadCompetence(event.target.value);
    update();
    document.getElementById('bc-save').onclick = async () => {
      const month=document.getElementById('bc-effective').value;
      if(!/^\d{4}-\d{2}$/.test(month)) return UI.toast('Informe a competência da base de cálculo.','warn');
      const rates={ tax:U.num(document.getElementById('bc-tax').value), admin:U.num(document.getElementById('bc-admin').value),
        fees:U.num(document.getElementById('bc-fees').value), other:U.num(document.getElementById('bc-other').value) };
      if(Object.values(rates).some(value=>value<0)) return UI.toast('Os percentuais não podem ser negativos.','warn');
      const effectiveFrom=`${month}-01`;
      const versions=(Array.isArray(State.settings.baseCalcHistory)?State.settings.baseCalcHistory:[])
        .filter(item=>item&&item.effectiveFrom!==effectiveFrom);
      versions.push({effectiveFrom,rates,savedAt:new Date().toISOString()});
      versions.sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));
      const limited=versions.slice(-240);
      await State.setSetting('baseCalcHistory',limited);
      const currentVersion=limited.filter(item=>item.effectiveFrom<=`${currentMonth}-01`).pop();
      if(currentVersion) await State.setSetting('baseCalc',currentVersion.rates);
      await State.setSetting('marginTarget', U.num(document.getElementById('bc-target').value));
      UI.toast(`Base de cálculo de ${month.slice(5,7)}/${month.slice(0,4)} salva sem alterar obras já concluídas.`, 'success',6500);
      App.render();
    };
    U.icons();
  },
  loadCompetence(month){
    if(!/^\d{4}-\d{2}$/.test(String(month||''))) return;
    const rates=Biz.baseRatesAt(`${month}-01`);
    const monthInput=document.getElementById('bc-effective');
    if(monthInput) monthInput.value=month;
    ['tax','admin','fees','other'].forEach(key=>{
      const input=document.getElementById('bc-'+key);
      if(input) input.value=Number(rates[key])||'';
    });
    const first=document.getElementById('bc-tax');
    if(first) first.dispatchEvent(new Event('input'));
  }
};
