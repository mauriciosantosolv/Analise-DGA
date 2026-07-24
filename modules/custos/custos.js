/**
 * Módulo Custos — Regras Financeiras (custos.js)
 *
 * Responsabilidades:
 * - TODA regra financeira do sistema (única fonte de verdade)
 * - filtros globais, base de cálculo, estatísticas de projeto/categoria
 * - previsões (burn rate), semáforo, alertas, séries mensais
 *
 * Dependências:
 * - database
 * - utils
 *
 * Não modificar:
 * - fórmulas sem validação do responsável pelo orçamento
 * - nunca duplicar estes cálculos em outros módulos
 */

/* ================= [6] REGRAS DE NEGÓCIO =================
   Indicadores, previsões, semáforo, tendências e alertas. */
const Biz = {

  // Lançamentos filtrados pelos filtros globais ativos
  filteredPurchases(){
    const f = State.filters;
    return State.purchases.filter(x => {
      const p = State.projects.find(pr => pr.id === x.projectId);
      if(f.project && x.projectId !== f.project) return false;
      if(f.client && (!p || p.client !== f.client)) return false;
      if(f.category && U.norm(x.category) !== U.norm(f.category)) return false;
      if(f.status && (!p || p.status !== f.status)) return false;
      if(f.type && (!p || p.type !== f.type)) return false;
      return true;
    });
  },
  filteredProjects(){
    const f = State.filters;
    return State.projects.filter(p => {
      if(f.project && p.id !== f.project) return false;
      if(f.client && p.client !== f.client) return false;
      if(f.category){
        const matches = row => row.projectId === p.id && U.norm(row.category) === U.norm(f.category);
        if(!State.budgets.some(matches) && !State.purchases.some(matches) && !State.planning.some(matches)) return false;
      }
      if(f.status && p.status !== f.status) return false;
      if(f.type && p.type !== f.type) return false;
      return true;
    });
  },

  // Percentuais da base de cálculo (impostos, adm, taxas, outros)
  baseRates(){
    const b = State.settings.baseCalc || {};
    return { tax:+b.tax||0, admin:+b.admin||0, fees:+b.fees||0, other:+b.other||0,
             total: (+b.tax||0)+(+b.admin||0)+(+b.fees||0)+(+b.other||0) };
  },

  // Identifica a parcela da base de cálculo correspondente a uma categoria.
  // Quando o Dashboard está filtrado, isso impede que todos os encargos sejam
  // lançados dentro de uma única categoria.
  baseRateForCategory(category){
    const n = U.norm(category), rates = this.baseRates();
    if(!n) return rates.total;
    if(n==='imposto' || n==='impostos' || n.includes('imposto')) return rates.tax;
    if(['administrativo','administracao','adm'].includes(n) || n.includes('custo administrativo')) return rates.admin;
    if(['taxa','taxas','comissao','comissoes'].includes(n)) return rates.fees;
    if(['outros','outros encargos','outras despesas'].includes(n)) return rates.other;
    return 0;
  },

  // Estatísticas completas de um projeto
  // REGRA (definida pelo usuário em 07/2026):
  // • REALIZADO = compras importadas + custos da base de cálculo;
  // • PROJETADO = somente os lançamentos do menu Planejamento;
  // • SALDO = orçado - realizado - projetado.
  // Os encargos entram uma única vez, no realizado. Como o projetado representa
  // apenas gastos futuros, ele nunca recebe imposto/adm/taxas novamente.
  projectStats(p, category=''){
    const categoryNorm = U.norm(category);
    const inCategory = row => !categoryNorm || U.norm(row.category) === categoryNorm;
    const budgets = State.budgets.filter(b => b.projectId === p.id && inCategory(b));
    const purchases = State.purchases.filter(x => x.projectId === p.id && inCategory(x));
    const budgetTotal = budgets.reduce((s,b) => s+b.value, 0);
    const spentPurchases = purchases.reduce((s,x) => s+x.value, 0); // somente compras
    const planned = State.planning.filter(x => x.projectId === p.id && inCategory(x));
    const projected = planned.reduce((s,x) => s+x.value, 0); // somente Planejamento
    // Medições: faturado e aguardando aprovação são separados. Somente registros
    // com status Faturada/Faturado alimentam o card verde de faturamento.
    const measurements = State.measurements.filter(m => m.projectId === p.id);
    const measured = measurements.reduce((s,m)=>s+m.value,0);
    const invoiced = measurements.filter(m=>U.norm(m.status).startsWith('faturad')).reduce((s,m)=>s+m.value,0);
    const awaitingApproval = measurements.filter(m=>U.norm(m.status)==='aguardando aprovacao').reduce((s,m)=>s+m.value,0);
    const measuredPct = p.saleValue > 0 ? measured / p.saleValue * 100 : null;
    const invoicedPct = p.saleValue > 0 ? invoiced / p.saleValue * 100 : null;
    const rates = this.baseRates();
    const overheadRate = categoryNorm ? this.baseRateForCategory(category) : rates.total;
    const overhead = p.saleValue * overheadRate / 100; // custos calculados sobre a venda
    const spent = spentPurchases + overhead;          // REALIZADO = compras + imposto/adm
    // Previsão por ritmo de gastos (burn rate) — média diária desde o 1º lançamento
    // (calculada apenas sobre as compras; o overhead é fixo e entra ao final)
    const dates = purchases.map(x => x.date).filter(Boolean).sort();
    let dailyBurn = 0;
    if(dates.length >= 2){
      const span = Math.max(1, U.daysBetween(dates[0], dates[dates.length-1]));
      dailyBurn = spentPurchases / span;
    }
    const today = new Date();
    const endRef = p.expectedEnd || p.deadline;
    let daysLeft = endRef ? U.daysBetween(today, endRef) : null;
    if(p.status === 'Concluído') daysLeft = 0;
    // Total de custos sem encargos usado pelo simulador. O valor projetado em si
    // permanece separado do realizado para não duplicar os custos da base.
    const projectedPurchases = spentPurchases + projected;
    const committedTotal = spent + projected;
    const balance = budgetTotal - committedTotal;
    const consumed = budgetTotal > 0 ? spent / budgetTotal * 100 : (spent > 0 ? 999 : 0);
    // O orçamento já contém sua composição por categoria; não se acrescenta a
    // base de cálculo novamente ao calcular a margem prevista.
    const marginPlanned = p.saleValue > 0 ? (p.saleValue - budgetTotal) / p.saleValue * 100 : null;
    const marginCurrent = p.saleValue > 0 ? (p.saleValue - committedTotal) / p.saleValue * 100 : null;
    const profit = p.saleValue - committedTotal;
    const deviation = budgetTotal > 0 ? (committedTotal - budgetTotal) / budgetTotal * 100 : null;
    // Data provável de encerramento do orçamento pelo ritmo atual
    let burnoutDate = null;
    if(dailyBurn > 0 && balance > 0) burnoutDate = new Date(today.getTime() + (balance/dailyBurn)*86400000);
    // Saúde vinculada exclusivamente ao saldo (Orçado - Realizado - Projetado).
    // Como a regra define verde somente acima de R$ 500, a faixa intermediária
    // de R$ 0 a R$ 500 permanece amarela; saldo negativo fica vermelho.
    const light = balance < 0 ? 'red' : balance > 500 ? 'green' : 'amber';
    const health = light === 'green' ? 100 : light === 'amber' ? 50 : 0;
    return { budgetTotal, spent, spentPurchases, projected, projectedPurchases, committedTotal, balance,
             consumed, marginPlanned, marginCurrent, profit, deviation, daysLeft, dailyBurn,
             burnoutDate, health, light, overhead, plannedFuture:projected, purchases, budgets,
             measured, measuredPct, invoiced, invoicedPct, awaitingApproval };
  },

  // Projetado do dashboard = soma exclusiva dos itens do Planejamento.
  projectedByCategory(projects){
    return this.categoryStats(projects).reduce((s,c) => s + c.projected, 0);
  },

  // Estatísticas por categoria dentro de um conjunto de projetos
  // REGRA (07/2026):
  // • REALIZADO por categoria inclui os encargos da base de cálculo aplicados
  //   sobre a receita (valor de venda) dos projetos, alocados na categoria de
  //   nome correspondente (Imposto, Custo Administrativo, Taxas/Comissão,
  //   Outros). Se a categoria não existir, uma linha é criada.
  // • PROJETADO por categoria = soma exclusiva do menu Planejamento;
  // • SALDO = orçado - realizado - projetado.
  categoryStats(projects){
    const ids = new Set(projects.map(p=>p.id));
    const map = {};
    const ensure = (category, fallback='Sem categoria') => {
      const name = String(category||'').trim() || fallback;
      const k = U.norm(name);
      return map[k] = map[k] || {name, budget:0, spent:0, projected:0, monthly:{}};
    };
    State.budgets.filter(b=>ids.has(b.projectId)).forEach(b => {
      ensure(b.category).budget += b.value;
    });
    State.purchases.filter(x=>ids.has(x.projectId)).forEach(x => {
      const cat = ensure(x.category);
      cat.spent += x.value;
      if(x.date){ const mk = x.date.slice(0,7); cat.monthly[mk] = (cat.monthly[mk]||0) + x.value; }
    });
    // O planejamento também cria a categoria no agrupamento. Isso garante que
    // categorias sem orçamento/compra realizada não desapareçam do dashboard.
    State.planning.filter(x => ids.has(x.projectId)).forEach(x => {
      ensure(x.category).projected += x.value;
    });
    // Encargos da base de cálculo → realizado da categoria correspondente
    const rates = this.baseRates();
    const revenue = projects.reduce((s,p)=>s+(p.saleValue||0),0);
    const OVERHEAD_MATCH = {
      tax:   {label:'Imposto',             names:['imposto','impostos']},
      admin: {label:'Custo Administrativo', names:['custo administrativo','administrativo','administracao','adm']},
      fees:  {label:'Taxas',               names:['taxa','taxas','comissao','comissoes']},
      other: {label:'Outros (encargos)',   names:['outros','outros encargos','outras despesas']}
    };
    for(const [k, cfg] of Object.entries(OVERHEAD_MATCH)){
      const val = revenue * rates[k] / 100;
      if(val <= 0) continue;
      // procura por nome exato primeiro, depois por conteúdo
      let cat = Object.values(map).find(c => cfg.names.includes(U.norm(c.name)))
             || Object.values(map).find(c => cfg.names.some(n => U.norm(c.name).includes(n)));
      if(!cat){ const key='__ov_'+k; map[key] = cat = {name:cfg.label, budget:0, spent:0, projected:0, monthly:{}}; }
      cat.spent += val;
      cat.overheadSpent = (cat.overheadSpent||0) + val; // parcela vinda da base de cálculo
    }
    const budgetTotal = Object.values(map).reduce((s,c)=>s+c.budget,0);
    return Object.values(map).map(c => {
      const consumed = c.budget>0 ? c.spent/c.budget*100 : (c.spent>0?999:0);
      const committed = c.spent + c.projected;
      const committedPct = c.budget>0 ? committed/c.budget*100 : (committed>0?999:0);
      // tendência: compara média dos 2 últimos meses com a média histórica (só compras)
      const months = Object.keys(c.monthly).sort();
      let trend = 'flat';
      if(months.length >= 3){
        const purchSpent = Object.values(c.monthly).reduce((s,v)=>s+v,0);
        const avg = purchSpent / months.length;
        const recent = (c.monthly[months[months.length-1]] + (c.monthly[months[months.length-2]]||0)) / 2;
        if(recent > avg*1.25) trend = 'up'; else if(recent < avg*0.75) trend = 'down';
      }
      return {...c, consumed, weight: budgetTotal>0 ? c.budget/budgetTotal*100 : 0,
              balance: c.budget - committed, plannedFuture:c.projected, committed, committedPct, trend,
              status: committedPct>100 ? 'red' : committedPct>85 ? 'amber' : 'green'};
    }).sort((a,b)=>b.committed-a.committed);
  },

  // Central de alertas inteligente
  alerts(){
    const out = [];
    const today = U.isoDate(new Date());
    const rates = this.baseRates();
    if(rates.total === 0) out.push({icon:'percent', level:'amber', msg:'Base de cálculo não configurada — impostos e custos administrativos não estão sendo aplicados.', view:'basecalculo'});
    State.projects.filter(p=>p.status==='Em andamento').forEach(p => {
      const s = this.projectStats(p);
      if(s.consumed > 100) out.push({icon:'flame', level:'red', msg:`<b>${U.esc(U.projLabel(p))}</b> ultrapassou o orçamento (${U.pct(s.consumed)} consumido).`, view:'projetos'});
      else if(s.consumed > 85) out.push({icon:'alert-triangle', level:'amber', msg:`<b>${U.esc(U.projLabel(p))}</b> consumiu ${U.pct(s.consumed)} do orçamento.`, view:'projetos'});
      if(s.marginCurrent != null && s.marginCurrent < (+State.settings.marginTarget || 10)) out.push({icon:'trending-down', level:'red', msg:`Margem de <b>${U.esc(U.projLabel(p))}</b> (${U.pct(s.marginCurrent)}) abaixo da meta.`, view:'projetos'});
      if(p.deadline && U.daysBetween(today, p.deadline) <= 15 && U.daysBetween(today, p.deadline) >= 0) out.push({icon:'calendar-clock', level:'amber', msg:`Contrato de <b>${U.esc(U.projLabel(p))}</b> vence em ${U.daysBetween(today, p.deadline)} dia(s).`, view:'projetos'});
      if(p.deadline && p.deadline < today && !p.realEnd) out.push({icon:'calendar-x', level:'red', msg:`Prazo contratual de <b>${U.esc(U.projLabel(p))}</b> vencido.`, view:'projetos'});
      if(!State.planning.some(x=>x.projectId===p.id)) out.push({icon:'calendar-minus', level:'amber', msg:`<b>${U.esc(U.projLabel(p))}</b> não possui planejamento cadastrado.`, view:'planejamento'});
      const last = s.purchases.map(x=>x.date).filter(Boolean).sort().pop();
      if(last && U.daysBetween(last, today) > 45) out.push({icon:'alarm-clock', level:'amber', msg:`<b>${U.esc(U.projLabel(p))}</b> sem lançamentos há ${U.daysBetween(last, today)} dias.`, view:'financeiro'});
      this.categoryStats([p]).filter(c=>c.committedPct>100 && c.budget>0).slice(0,2).forEach(c =>
        out.push({icon:'tag', level:'red', msg:`Categoria <b>${U.esc(c.name)}</b> em <b>${U.esc(U.projLabel(p))}</b>: ${U.pct(c.committedPct)} comprometido (realizado + planejamento).`, view:'projetos'}));
    });
    const next7 = State.planning.filter(x => x.date >= today && x.date <= U.isoDate(new Date(Date.now()+7*86400000)));
    if(next7.length) out.push({icon:'shopping-cart', level:'blue', msg:`${next7.length} compra(s) planejada(s) para os próximos 7 dias, total ${U.money(next7.reduce((s,x)=>s+x.value,0))}.`, view:'planejamento'});
    return out.sort((a,b) => ({red:0, amber:1, blue:2}[a.level] - {red:0, amber:1, blue:2}[b.level]));
  },

  // Gastos futuros a partir do planejamento
  futureExpenses(rows=State.planning){
    const today = U.isoDate(new Date());
    const horizon = d => U.isoDate(new Date(Date.now()+d*86400000));
    const fut = rows.filter(x => x.date >= today).slice().sort((a,b)=>a.date.localeCompare(b.date));
    return {
      today: fut.filter(x=>x.date===today),
      d7: fut.filter(x=>x.date>today && x.date<=horizon(7)),
      d15: fut.filter(x=>x.date>horizon(7) && x.date<=horizon(15)),
      d30: fut.filter(x=>x.date>horizon(15) && x.date<=horizon(30))
    };
  },

  // Série mensal orçado/realizado para gráficos (Curva S, evolução)
  monthlySeries(purchases){
    const map = {};
    purchases.forEach(x => { if(x.date){ const k = x.date.slice(0,7); map[k] = (map[k]||0)+x.value; } });
    const keys = Object.keys(map).sort();
    let acc = 0;
    return { labels:keys, values:keys.map(k=>map[k]), cumulative:keys.map(k=>acc+=map[k]) };
  }
};
