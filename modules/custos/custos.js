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
  // REGRA (definida pelo usuário em 07/2026): o REALIZADO inclui, além das
  // compras importadas do financeiro, os custos da base de cálculo
  // (impostos + adm + taxas + outros) aplicados sobre o VALOR DE VENDA
  // INTEGRAL — pois são custos reais mensurados que não vêm da importação.
  // Realizado, projetado, saldo, % consumido e desvio são consistentes entre
  // si; margens e lucro NÃO descontam o overhead de novo (já está no custo).
  projectStats(p){
    const budgets = State.budgets.filter(b => b.projectId === p.id);
    const purchases = State.purchases.filter(x => x.projectId === p.id);
    const budgetTotal = budgets.reduce((s,b) => s+b.value, 0);
    const spentPurchases = purchases.reduce((s,x) => s+x.value, 0); // só compras (base do burn rate)
    // Planejamento LÍQUIDO (regra 07/2026): o gasto previsto de cada categoria
    // é abatido pelos registros financeiros da mesma categoria — se havia
    // R$ 30 mil previstos e R$ 15 mil registrados, restam R$ 15 mil planejados.
    // O que resta compromete o saldo do projeto mesmo sem registro financeiro.
    const planned = State.planning.filter(x => x.projectId === p.id);
    const _planCat = {}, _spentCat = {};
    planned.forEach(x => { const k = U.norm(x.category||''); _planCat[k] = (_planCat[k]||0) + x.value; });
    purchases.forEach(x => { const k = U.norm(x.category||''); _spentCat[k] = (_spentCat[k]||0) + x.value; });
    const plannedFuture = Object.entries(_planCat)
      .reduce((s,[k,v]) => s + Math.max(0, v - (_spentCat[k]||0)), 0); // planejado ainda não realizado
    // Medições: quanto da receita contratada já foi medido/faturado
    const measured = State.measurements.filter(m => m.projectId === p.id).reduce((s,m)=>s+m.value,0);
    const measuredPct = p.saleValue > 0 ? measured / p.saleValue * 100 : null;
    const rates = this.baseRates();
    const overhead = p.saleValue * rates.total / 100; // custos calculados sobre a venda
    const spent = spentPurchases + overhead;          // REALIZADO = compras + imposto/adm
    // Previsão por ritmo de gastos (burn rate) — média diária desde o 1º lançamento
    // (calculada apenas sobre as compras; o overhead é fixo e entra ao final)
    const dates = purchases.map(x => x.date).filter(Boolean).sort();
    let dailyBurn = 0, projectedPurchases = spentPurchases;
    if(dates.length >= 2){
      const span = Math.max(1, U.daysBetween(dates[0], dates[dates.length-1]));
      dailyBurn = spentPurchases / span;
    }
    const today = new Date();
    const endRef = p.expectedEnd || p.deadline;
    let daysLeft = endRef ? U.daysBetween(today, endRef) : null;
    if(p.status === 'Concluído') daysLeft = 0;
    if(daysLeft != null && daysLeft > 0 && dailyBurn > 0 && p.status === 'Em andamento')
      projectedPurchases = spentPurchases + dailyBurn * daysLeft;
    projectedPurchases = Math.max(projectedPurchases, spentPurchases + plannedFuture);
    const projected = projectedPurchases + overhead;  // projeção também inclui imposto/adm
    // Saldo desconta também o planejamento ainda não realizado (compromissos)
    const balance = budgetTotal - spent - plannedFuture;
    const consumed = budgetTotal > 0 ? spent / budgetTotal * 100 : (spent > 0 ? 999 : 0);
    const marginPlanned = p.saleValue > 0 ? (p.saleValue - budgetTotal - overhead) / p.saleValue * 100 : null;
    const marginCurrent = p.saleValue > 0 ? (p.saleValue - projected) / p.saleValue * 100 : null; // projected já contém overhead
    const profit = p.saleValue - projected;
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
    return { budgetTotal, spent, spentPurchases, projected, projectedPurchases, balance,
             consumed, marginPlanned, marginCurrent, profit, deviation, daysLeft, dailyBurn,
             burnoutDate, health, light, overhead, plannedFuture, purchases, budgets,
             measured, measuredPct };
  },

  // Custo projetado com base na planilha de categorias (usado no dashboard):
  // para cada categoria, o MAIOR entre o projetado (realizado + planejamento
  // futuro) e o orçado — quem estourou carrega o excesso; quem ainda não
  // gastou vai gastar ao menos o orçado. Os encargos da base de cálculo já
  // estão dentro das categorias correspondentes (sem dupla contagem).
  projectedByCategory(projects){
    return this.categoryStats(projects).reduce((s,c) => s + c.projec, 0);
  },

  // Estatísticas por categoria dentro de um conjunto de projetos
  // REGRA (07/2026):
  // • REALIZADO por categoria inclui os encargos da base de cálculo aplicados
  //   sobre a receita (valor de venda) dos projetos, alocados na categoria de
  //   nome correspondente (Imposto, Custo Administrativo, Taxas/Comissão,
  //   Outros). Se a categoria não existir, uma linha é criada.
  // • PROJETADO por categoria = realizado + planejamento de gastos futuro da
  //   categoria — mostra o que ainda está planejado acontecer.
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
      map[k].purchSpent = (map[k].purchSpent||0) + x.value; // só compras (p/ abater o planejado)
      if(x.date){ const mk = x.date.slice(0,7); map[k].monthly[mk] = (map[k].monthly[mk]||0) + x.value; }
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
      if(!cat){ const key='__ov_'+k; map[key] = cat = {name:cfg.label, budget:0, spent:0, monthly:{}}; }
      cat.spent += val;
      cat.overheadSpent = (cat.overheadSpent||0) + val; // parcela vinda da base de cálculo
    }
    // Planejamento por categoria (entra no projetado): o previsto é ABATIDO
    // pelos registros financeiros da mesma categoria — planejou 30 mil e
    // registrou 15 mil, restam 15 mil no projetado (nunca negativo).
    const plannedByCat = {};
    State.planning.filter(x => ids.has(x.projectId)).forEach(x => {
      const k = U.norm(x.category||'');
      plannedByCat[k] = (plannedByCat[k]||0) + x.value;
    });
    const budgetTotal = Object.values(map).reduce((s,c)=>s+c.budget,0);
    return Object.values(map).map(c => {
      const consumed = c.budget>0 ? c.spent/c.budget*100 : (c.spent>0?999:0);
      // tendência: compara média dos 2 últimos meses com a média histórica (só compras)
      const months = Object.keys(c.monthly).sort();
      let trend = 'flat';
      if(months.length >= 3){
        const purchSpent = Object.values(c.monthly).reduce((s,v)=>s+v,0);
        const avg = purchSpent / months.length;
        const recent = (c.monthly[months[months.length-1]] + (c.monthly[months[months.length-2]]||0)) / 2;
        if(recent > avg*1.25) trend = 'up'; else if(recent < avg*0.75) trend = 'down';
      }
      const plannedFuture = Math.max(0, (plannedByCat[U.norm(c.name)] || 0) - (c.purchSpent || 0));
      const projected = c.spent + plannedFuture; // realizado + planejamento ainda não realizado
      // Saldo da categoria também desconta o planejado não realizado — se o
      // planejamento excede o orçado, o saldo fica negativo e alerta o gestor
      return {...c, consumed, weight: budgetTotal>0 ? c.budget/budgetTotal*100 : 0,
              balance: c.budget - c.spent - plannedFuture, projected, plannedFuture, trend,
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
