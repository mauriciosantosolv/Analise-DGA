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
      if(f.year && (!x.date || !x.date.startsWith(f.year))) return false;
      if(f.from && x.date && x.date < f.from) return false;
      if(f.to && x.date && x.date > f.to) return false;
      return true;
    });
  },
  filteredProjects(){
    const f = State.filters;
    return State.projects.filter(p => {
      if(f.project && p.id !== f.project) return false;
      if(f.client && p.client !== f.client) return false;
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

  // Estatísticas completas de um projeto
  projectStats(p){
    const budgets = State.budgets.filter(b => b.projectId === p.id);
    const purchases = State.purchases.filter(x => x.projectId === p.id);
    const budgetTotal = budgets.reduce((s,b) => s+b.value, 0);
    const spent = purchases.reduce((s,x) => s+x.value, 0);
    const planned = State.planning.filter(x => x.projectId === p.id);
    const plannedFuture = planned.filter(x => x.date >= U.isoDate(new Date())).reduce((s,x)=>s+x.value,0);
    // Medições: quanto da receita contratada já foi medido/faturado
    const measured = State.measurements.filter(m => m.projectId === p.id).reduce((s,m)=>s+m.value,0);
    const measuredPct = p.saleValue > 0 ? measured / p.saleValue * 100 : null;
    const rates = this.baseRates();
    const overhead = p.saleValue * rates.total / 100; // custos calculados sobre a venda
    // Previsão por ritmo de gastos (burn rate) — média diária desde o 1º lançamento
    const dates = purchases.map(x => x.date).filter(Boolean).sort();
    let dailyBurn = 0, projected = spent;
    if(dates.length >= 2){
      const span = Math.max(1, U.daysBetween(dates[0], dates[dates.length-1]));
      dailyBurn = spent / span;
    }
    const today = new Date();
    const endRef = p.expectedEnd || p.deadline;
    let daysLeft = endRef ? U.daysBetween(today, endRef) : null;
    if(p.status === 'Concluído') daysLeft = 0;
    if(daysLeft != null && daysLeft > 0 && dailyBurn > 0 && p.status === 'Em andamento')
      projected = spent + dailyBurn * daysLeft;
    projected = Math.max(projected, spent + plannedFuture);
    const balance = budgetTotal - spent;
    const consumed = budgetTotal > 0 ? spent / budgetTotal * 100 : (spent > 0 ? 999 : 0);
    const marginPlanned = p.saleValue > 0 ? (p.saleValue - budgetTotal - overhead) / p.saleValue * 100 : null;
    const marginCurrent = p.saleValue > 0 ? (p.saleValue - projected - overhead) / p.saleValue * 100 : null;
    const profit = p.saleValue - projected - overhead;
    const deviation = budgetTotal > 0 ? (projected - budgetTotal) / budgetTotal * 100 : null;
    // Data provável de encerramento do orçamento pelo ritmo atual
    let burnoutDate = null;
    if(dailyBurn > 0 && balance > 0) burnoutDate = new Date(today.getTime() + (balance/dailyBurn)*86400000);
    // Índice de saúde financeira 0–100
    let health = 100;
    if(budgetTotal > 0){
      if(consumed > 100) health -= Math.min(45, (consumed-100));
      else if(consumed > 85) health -= (consumed-85)*1.2;
    }
    if(marginCurrent != null){ if(marginCurrent < 0) health -= 30; else if(marginCurrent < 10) health -= 15; }
    if(daysLeft != null && daysLeft < 0 && p.status === 'Em andamento') health -= 20;
    if(deviation != null && deviation > 10) health -= 10;
    health = Math.max(0, Math.min(100, Math.round(health)));
    const light = health >= 70 ? 'green' : health >= 45 ? 'amber' : 'red';
    return { budgetTotal, spent, projected, balance, consumed, marginPlanned, marginCurrent,
             profit, deviation, daysLeft, dailyBurn, burnoutDate, health, light, overhead,
             plannedFuture, purchases, budgets, measured, measuredPct };
  },

  // Estatísticas por categoria dentro de um conjunto de projetos
  categoryStats(projects){
    const ids = new Set(projects.map(p=>p.id));
    const map = {};
    State.budgets.filter(b=>ids.has(b.projectId)).forEach(b => {
      const k = U.norm(b.category);
      map[k] = map[k] || {name:b.category, budget:0, spent:0, monthly:{}};
      map[k].budget += b.value;
    });
    State.purchases.filter(x=>ids.has(x.projectId)).forEach(x => {
      const k = U.norm(x.category);
      map[k] = map[k] || {name:x.category, budget:0, spent:0, monthly:{}};
      map[k].spent += x.value;
      if(x.date){ const mk = x.date.slice(0,7); map[k].monthly[mk] = (map[k].monthly[mk]||0) + x.value; }
    });
    const budgetTotal = Object.values(map).reduce((s,c)=>s+c.budget,0);
    return Object.values(map).map(c => {
      const consumed = c.budget>0 ? c.spent/c.budget*100 : (c.spent>0?999:0);
      // tendência: compara média dos 2 últimos meses com a média histórica
      const months = Object.keys(c.monthly).sort();
      let trend = 'flat';
      if(months.length >= 3){
        const avg = c.spent / months.length;
        const recent = (c.monthly[months[months.length-1]] + (c.monthly[months[months.length-2]]||0)) / 2;
        if(recent > avg*1.25) trend = 'up'; else if(recent < avg*0.75) trend = 'down';
      }
      const projected = c.budget>0 && consumed<100 && trend==='up' ? c.spent*1.15 : c.spent;
      return {...c, consumed, weight: budgetTotal>0 ? c.budget/budgetTotal*100 : 0,
              balance: c.budget - c.spent, projected, trend,
              status: consumed>100 ? 'red' : consumed>85 ? 'amber' : 'green'};
    }).sort((a,b)=>b.spent-a.spent);
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
      this.categoryStats([p]).filter(c=>c.consumed>100 && c.budget>0).slice(0,2).forEach(c =>
        out.push({icon:'tag', level:'red', msg:`Categoria <b>${U.esc(c.name)}</b> em <b>${U.esc(U.projLabel(p))}</b>: ${U.pct(c.consumed)} do previsto.`, view:'projetos'}));
    });
    const next7 = State.planning.filter(x => x.date >= today && x.date <= U.isoDate(new Date(Date.now()+7*86400000)));
    if(next7.length) out.push({icon:'shopping-cart', level:'blue', msg:`${next7.length} compra(s) planejada(s) para os próximos 7 dias, total ${U.money(next7.reduce((s,x)=>s+x.value,0))}.`, view:'planejamento'});
    return out.sort((a,b) => ({red:0, amber:1, blue:2}[a.level] - {red:0, amber:1, blue:2}[b.level]));
  },

  // Gastos futuros a partir do planejamento
  futureExpenses(){
    const today = U.isoDate(new Date());
    const horizon = d => U.isoDate(new Date(Date.now()+d*86400000));
    const fut = State.planning.filter(x => x.date >= today).sort((a,b)=>a.date.localeCompare(b.date));
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
