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
    const b = State.settings.baseCalc || {tax:0, admin:0, fees:0, other:0};
    const target = State.settings.marginTarget ?? 10;
    $c().innerHTML = `
      <div class="card" style="max-width:560px">
        <h2 style="margin-bottom:6px">Percentuais Globais</h2>
        <p style="color:var(--text2);font-size:.86rem;margin-bottom:16px">Aplicados automaticamente sobre o valor de venda de todos os projetos no cálculo de margem e lucro.</p>
        <div class="form-grid">
          <div><label>Impostos (%)</label><input id="bc-tax" type="number" step="0.01" value="${b.tax||''}"></div>
          <div><label>Custo Administrativo (%)</label><input id="bc-admin" type="number" step="0.01" value="${b.admin||''}"></div>
          <div><label>Taxas (%)</label><input id="bc-fees" type="number" step="0.01" value="${b.fees||''}"></div>
          <div><label>Outros Custos (%)</label><input id="bc-other" type="number" step="0.01" value="${b.other||''}"></div>
          <div class="full"><label>Meta de Margem Mínima (%)</label><input id="bc-target" type="number" step="0.5" value="${target}"></div>
        </div>
        <div style="margin-top:16px;display:flex;justify-content:flex-end">
          <button class="btn btn-primary" id="bc-save"><i data-lucide="check"></i>Salvar e Aplicar</button></div>
      </div>
      <div class="card" style="max-width:560px;margin-top:14px">
        <h3>Total de encargos: <b id="bc-total" style="color:var(--blue)"></b></h3>
        <small style="color:var(--text3)">Exemplo: em um projeto de venda ${U.money(1000000)}, os encargos representam <b id="bc-example"></b>.</small>
      </div>`;
    const update = () => {
      const t = ['tax','admin','fees','other'].reduce((s,k)=>s+U.num(document.getElementById('bc-'+k).value),0);
      document.getElementById('bc-total').textContent = U.pct(t,2);
      document.getElementById('bc-example').textContent = U.money(1000000*t/100);
    };
    ['tax','admin','fees','other'].forEach(k => document.getElementById('bc-'+k).oninput = update);
    update();
    document.getElementById('bc-save').onclick = async () => {
      await State.setSetting('baseCalc', { tax:U.num(document.getElementById('bc-tax').value), admin:U.num(document.getElementById('bc-admin').value),
        fees:U.num(document.getElementById('bc-fees').value), other:U.num(document.getElementById('bc-other').value) });
      await State.setSetting('marginTarget', U.num(document.getElementById('bc-target').value));
      UI.toast('Base de cálculo aplicada a todos os projetos', 'success');
      App.render();
    };
    U.icons();
  }
};
