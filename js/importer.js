/**
 * Importador de Planilhas (importer.js)
 *
 * Responsabilidades:
 * - leitura de planilhas-modelo (XLSX) com mapeamento por sinônimos
 * - importação de orçamentos (usada pelo módulo orcamentos)
 * - importação de compras, contas pagas e mão de obra com deduplicação
 * - criação automática de projetos e categorias
 *
 * Dependências:
 * - database
 * - utils
 * - vendor XLSX
 *
 * Não modificar:
 * - sinônimos de colunas (MAPS) sem validar com as planilhas-modelo
 * - regra de deduplicação por multiplicidade
 */

/* ================= [5] IMPORTADORES =================
   Reconhecem automaticamente as colunas das planilhas-modelo:
   • Modelo de orçamentos: PROJETO | DESCRIÇÃO | VALOR ORÇADO
   • Modelo compras: Projeto | Pedido de Compra | Fornecedor | Categoria |
     Descrição do Produto | Observações | Valor Total | Data de Inclusão
   • Modelo contas pagas: Projeto | Categoria | Valor da Conta | Conta Corrente |
     Observação da Conta | Data de Pagto ou Recbto (completa)
   • Modelo mão de obra: PROJETO | CUSTO | DATA
   Mapeamento por sinônimos + validação linha a linha. Sempre SOMA ao banco. */
const Importer = (() => {

  // Sinônimos aceitos por campo (comparação normalizada, sem acentos)
  const MAPS = {
    budget: {
      project:  ['projeto','proposta','obra','numero da proposta','n proposta'],
      category: ['descricao','categoria','item','descricao da categoria'],
      value:    ['valor orcado','orcado','valor','valor previsto','orcamento']
    },
    purchase: {
      project:  ['projeto','obra','proposta','numero da proposta'],
      order:    ['pedido de compra','pedido','n pedido','numero do pedido','nota','nf'],
      supplier: ['fornecedor (nome fantasia)','fornecedor','nome fantasia','fornecedor nome fantasia'],
      category: ['categoria','classe','classificacao','centro de custo categoria'],
      desc:     ['descricao do produto','descricao','produto','item','descricao do item'],
      notes:    ['observacoes internas do pedido','observacoes','observacao','obs','observacoes internas'],
      value:    ['valor total da compra/importacao','valor total','valor','valor da compra','total'],
      date:     ['data de inclusao (completa)','data de inclusao','data','data da compra','data completa','data inclusao']
    },
    paidAccount: {
      project:  ['projeto','obra','proposta','numero da proposta'],
      category: ['categoria','classe','classificacao','centro de custo categoria'],
      value:    ['valor da conta','valor pago','valor do pagamento','valor','total'],
      account:  ['conta corrente','conta','banco','conta bancaria'],
      desc:     ['observacao da conta','observacoes da conta','observacao','observacoes','descricao'],
      date:     ['data de pagto ou recbto (completa)','data de pagto ou recbto','data de pagamento','data do pagamento','data']
    },
    labor: {
      project:  ['projeto','obra','proposta','numero da proposta'],
      value:    ['custo','valor da mao de obra','valor','total'],
      date:     ['data','data do custo','data de lancamento']
    }
  };

  const KIND_LABELS = {budget:'Orçamentos', purchase:'Compras', paidAccount:'Contas pagas', labor:'Mão de obra'};

  function configuredMap(kind){
    const all = State.settings.importMappings || {};
    return all[kind] || null;
  }

  // Encontra o índice de cada coluna pelo texto do cabeçalho, nunca pela posição.
  // Quando o administrador cadastrou um modelo, os cabeçalhos salvos têm prioridade.
  function mapHeaders(headerRow, map, kind){
    const cols = {}, missing = [];
    const normHead = headerRow.map(h => U.norm(h));
    const saved = configuredMap(kind);
    for(const [field, aliases] of Object.entries(map)){
      let idx = -1;
      const learned = saved && saved.fields ? U.norm(saved.fields[field]) : '';
      if(learned) idx = normHead.findIndex(h => h === learned);
      for(const a of (idx === -1 ? aliases : [])){
        idx = normHead.findIndex(h => h === a);
        if(idx === -1) idx = normHead.findIndex(h => h && (h.includes(a) || a.includes(h)) && h.length > 2);
        if(idx !== -1) break;
      }
      if(idx === -1) missing.push(field); else cols[field] = idx;
    }
    return {cols, missing};
  }

  function readWorkbook(file){
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = e => {
        try{
          const wb = XLSX.read(e.target.result, {type:'array', cellDates:true});
          const ws = wb.Sheets[wb.SheetNames[0]];
          res(XLSX.utils.sheet_to_json(ws, {header:1, defval:null, raw:true}));
        }catch(err){ rej(err); }
      };
      fr.onerror = () => rej(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }

  // Separa "649 Caramuru São Simão" em proposta=649 e nome
  function splitProject(raw){
    const s = String(raw??'').trim();
    const m = s.match(/^(\d+)\s*[-–—]?\s*(.*)$/);
    return m ? {proposal:m[1], name:(m[2]||'').trim()} : {proposal:s, name:''};
  }

  // Garante que o projeto existe; cria automaticamente se necessário
  async function ensureProject(raw, created){
    const {proposal, name} = splitProject(raw);
    let p = State.projects.find(x => x.proposal === proposal);
    if(!p){
      p = {id:U.id(), proposal, name, client:'', clientLogo:'', saleValue:0, type:'Obra',
           status:'Em andamento', start:'', deadline:'', expectedEnd:'', realEnd:'', notes:'', createdAt:Date.now()};
      await DB.put('projects', p); State.projects.push(p); created.add(proposal);
    } else if(name && !p.name){ p.name = name; await DB.put('projects', p); }
    return p;
  }

  async function ensureCategory(name){
    const n = U.norm(name);
    if(!n) return;
    if(!State.categories.find(c => U.norm(c.name) === n)){
      const palette = ['#2563EB','#16A34A','#D97706','#DC2626','#7C3AED','#0891B2','#DB2777','#65A30D','#EA580C','#4F46E5'];
      const c = {id:U.id(), name:String(name).trim(), color:palette[State.categories.length % palette.length], icon:'tag'};
      await DB.put('categories', c); State.categories.push(c);
    }
  }

  const SPECIAL_BUDGET = ['total','valor de venda']; // linhas especiais do modelo de orçamentos

  async function importBudget(file){
    const rows = await readWorkbook(file);
    if(!rows.length) throw new Error('Planilha vazia.');
    const {cols, missing} = mapHeaders(rows[0], MAPS.budget, 'budget');
    if(missing.length) return {error:`Colunas não reconhecidas no modelo de orçamentos: <b>${missing.map(f=>({project:'PROJETO',category:'DESCRIÇÃO',value:'VALOR ORÇADO'}[f])).join(', ')}</b>. Cabeçalho encontrado: ${rows[0].filter(Boolean).join(' | ')}`};
    const created = new Set(); let added = 0, skipped = [], saleUpdates = 0;
    const records = [];
    for(let i=1; i<rows.length; i++){
      const r = rows[i]; if(!r || r.every(c=>c==null||c==='')) continue;
      const rawProj = r[cols.project], cat = r[cols.category], val = U.num(r[cols.value]);
      if(rawProj==null || !String(cat??'').trim()){ skipped.push(i+1); continue; }
      const catNorm = U.norm(cat);
      const p = await ensureProject(rawProj, created);
      if(catNorm === 'valor de venda'){ if(val>0){ p.saleValue = val; await DB.put('projects', p); saleUpdates++; } continue; }
      if(SPECIAL_BUDGET.includes(catNorm)) continue; // TOTAL é derivado, não armazenado
      await ensureCategory(cat);
      records.push({id:U.id(), projectId:p.id, category:String(cat).trim(), value:val, importedAt:Date.now(), file:file.name});
      added++;
    }
    await DB.bulkPut('budgets', records);
    await State.reload();
    return {summary:{projects:created, added, skipped, saleUpdates, type:'Orçamentos'}};
  }

  async function importPurchases(file){
    const rows = await readWorkbook(file);
    if(!rows.length) throw new Error('Planilha vazia.');
    const {cols, missing} = mapHeaders(rows[0], MAPS.purchase, 'purchase');
    const critical = missing.filter(f => ['project','value','category'].includes(f));
    if(critical.length) return {error:`Colunas obrigatórias não reconhecidas no modelo de compras: <b>${critical.join(', ')}</b>. Cabeçalho encontrado: ${rows[0].filter(Boolean).join(' | ')}`};
    const created = new Set(); let added = 0; const skipped = [];
    // Deduplicação por multiplicidade: reimportar o mesmo arquivo não duplica nada,
    // mas lançamentos legitimamente idênticos (ex.: parcelas iguais) são preservados.
    const existingCount = {};
    State.purchases.forEach(x => { if(x.dedupe) existingCount[x.dedupe] = (existingCount[x.dedupe]||0)+1; });
    const seenCount = {};
    const records = [];
    for(let i=1; i<rows.length; i++){
      const r = rows[i]; if(!r || r.every(c=>c==null||c==='')) continue;
      const rawProj = r[cols.project], val = U.num(r[cols.value]);
      const cat = String(r[cols.category]??'').trim();
      if(rawProj==null || !cat || !(val>0 || val<0)){ skipped.push(i+1); continue; }
      const p = await ensureProject(rawProj, created);
      const date = cols.date!=null ? U.parseDate(r[cols.date]) : null;
      const rec = {
        id:U.id(), projectId:p.id, category:cat,
        supplier: cols.supplier!=null ? String(r[cols.supplier]??'').trim() : '',
        desc:     cols.desc!=null ? String(r[cols.desc]??'').trim() : '',
        notes:    cols.notes!=null ? String(r[cols.notes]??'').trim() : '',
        order:    cols.order!=null ? String(r[cols.order]??'').trim() : '',
        value:val, date: date ? U.isoDate(date) : '', costCenter:cat,
        importedAt:Date.now(), file:file.name, sourceType:'purchase'
      };
      rec.dedupe = [p.proposal, rec.order, rec.supplier, rec.category, rec.desc, rec.value, rec.date].join('|');
      seenCount[rec.dedupe] = (seenCount[rec.dedupe]||0)+1;
      if(seenCount[rec.dedupe] <= (existingCount[rec.dedupe]||0)){ skipped.push(i+1); continue; }
      await ensureCategory(cat);
      records.push(rec); added++;
    }
    await DB.bulkPut('purchases', records);
    await State.reload();
    return {summary:{projects:created, added, skipped, type:'Compras'}};
  }

  // Contas pagas entram na mesma base financeira das compras e, portanto,
  // compõem o Realizado do projeto e da categoria escolhida na planilha.
  async function importPaidAccounts(file){
    const rows = await readWorkbook(file);
    if(!rows.length) throw new Error('Planilha vazia.');
    const {cols, missing} = mapHeaders(rows[0], MAPS.paidAccount, 'paidAccount');
    const critical = missing.filter(f => ['project','category','value','date'].includes(f));
    if(critical.length) return {error:`Colunas obrigatórias não reconhecidas no modelo de contas pagas: <b>${critical.join(', ')}</b>. Cabeçalho encontrado: ${rows[0].filter(Boolean).join(' | ')}`};
    const created = new Set(); let added = 0; const skipped = [];
    const existingCount = {};
    State.purchases.forEach(x => { if(x.dedupe) existingCount[x.dedupe] = (existingCount[x.dedupe]||0)+1; });
    const seenCount = {}, records = [];
    for(let i=1; i<rows.length; i++){
      const r = rows[i]; if(!r || r.every(c=>c==null||c==='')) continue;
      const rawProj = r[cols.project], cat = String(r[cols.category]??'').trim(), val = U.num(r[cols.value]);
      if(rawProj==null || !cat || !(val>0 || val<0)){ skipped.push(i+1); continue; }
      const p = await ensureProject(rawProj, created);
      const date = U.parseDate(r[cols.date]);
      const account = cols.account!=null ? String(r[cols.account]??'').trim() : '';
      const desc = cols.desc!=null ? String(r[cols.desc]??'').trim() : '';
      const rec = {
        id:U.id(), projectId:p.id, category:cat, supplier:account,
        desc:desc || 'Conta paga', notes:'', order:'', value:val,
        date:date ? U.isoDate(date) : '', costCenter:cat,
        importedAt:Date.now(), file:file.name, sourceType:'paidAccount'
      };
      rec.dedupe = ['paidAccount', p.proposal, rec.category, account, desc, rec.value, rec.date].join('|');
      seenCount[rec.dedupe] = (seenCount[rec.dedupe]||0)+1;
      if(seenCount[rec.dedupe] <= (existingCount[rec.dedupe]||0)){ skipped.push(i+1); continue; }
      await ensureCategory(cat);
      records.push(rec); added++;
    }
    await DB.bulkPut('purchases', records);
    await State.reload();
    return {summary:{projects:created, added, skipped, type:'Contas pagas'}};
  }

  // O modelo de mão de obra não possui categoria. Todos os registros são
  // classificados como "Mão de Obra" para aparecerem corretamente no
  // realizado do Dashboard das Categorias.
  async function importLabor(file){
    const rows = await readWorkbook(file);
    if(!rows.length) throw new Error('Planilha vazia.');
    const {cols, missing} = mapHeaders(rows[0], MAPS.labor, 'labor');
    const critical = missing.filter(f => ['project','value','date'].includes(f));
    if(critical.length) return {error:`Colunas obrigatórias não reconhecidas no modelo de mão de obra: <b>${critical.join(', ')}</b>. Cabeçalho encontrado: ${rows[0].filter(Boolean).join(' | ')}`};
    const created = new Set(); let added = 0; const skipped = [];
    const existingCount = {};
    State.purchases.forEach(x => { if(x.dedupe) existingCount[x.dedupe] = (existingCount[x.dedupe]||0)+1; });
    const seenCount = {}, records = [];
    const laborCategory = 'Mão de Obra';
    await ensureCategory(laborCategory);
    for(let i=1; i<rows.length; i++){
      const r = rows[i]; if(!r || r.every(c=>c==null||c==='')) continue;
      const rawProj = r[cols.project], val = U.num(r[cols.value]);
      if(rawProj==null || !(val>0 || val<0)){ skipped.push(i+1); continue; }
      const p = await ensureProject(rawProj, created);
      const date = U.parseDate(r[cols.date]);
      const rec = {
        id:U.id(), projectId:p.id, category:laborCategory, supplier:'',
        desc:'Custo de mão de obra', notes:'', order:'', value:val,
        date:date ? U.isoDate(date) : '', costCenter:laborCategory,
        importedAt:Date.now(), file:file.name, sourceType:'labor'
      };
      rec.dedupe = ['labor', p.proposal, rec.value, rec.date].join('|');
      seenCount[rec.dedupe] = (seenCount[rec.dedupe]||0)+1;
      if(seenCount[rec.dedupe] <= (existingCount[rec.dedupe]||0)){ skipped.push(i+1); continue; }
      records.push(rec); added++;
    }
    await DB.bulkPut('purchases', records);
    await State.reload();
    return {summary:{projects:created, added, skipped, type:'Mão de obra'}};
  }



  async function saveModel(file, kind){
    const rows = await readWorkbook(file);
    if(!rows.length || !rows[0].some(Boolean)) throw new Error('O modelo não possui cabeçalho válido.');
    const map = MAPS[kind];
    if(!map) throw new Error('Base de dados não reconhecida.');
    const detected = mapHeaders(rows[0], map, null);
    const criticalByKind = {budget:['project','category','value'], purchase:['project','category','value'], paidAccount:['project','category','value','date'], labor:['project','value','date']};
    const missingCritical = (criticalByKind[kind]||[]).filter(f=>detected.cols[f] == null);
    if(missingCritical.length) throw new Error('Não foi possível identificar no modelo: '+missingCritical.join(', ')+'.');
    const fields = {};
    Object.entries(detected.cols).forEach(([field, idx]) => fields[field] = String(rows[0][idx]??'').trim());
    const mappings = {...(State.settings.importMappings||{})};
    mappings[kind] = {fileName:file.name, savedAt:Date.now(), fields};
    await State.setSetting('importMappings', mappings);
    return mappings[kind];
  }

  function pickModel(kind){
    const inp = document.getElementById('file-input');
    inp.onchange = async () => {
      const file = inp.files[0]; inp.value=''; if(!file) return;
      UI.loading(true, 'Analisando cabeçalhos do modelo…');
      try{
        const saved = await saveModel(file, kind);
        UI.loading(false);
        UI.toast(`Modelo de ${KIND_LABELS[kind]} atualizado sem alterar dados existentes`, 'success', 5000);
        if(State.view==='configuracoes') Views.configuracoes.render();
      }catch(err){ UI.loading(false); UI.toast('Modelo não salvo: '+U.esc(err.message), 'error', 6000); }
    };
    inp.click();
  }

  async function clearModel(kind){
    const mappings = {...(State.settings.importMappings||{})};
    delete mappings[kind];
    await State.setSetting('importMappings', mappings);
    UI.toast('Modelo removido. O reconhecimento padrão por cabeçalhos continua ativo.', 'warn');
    if(State.view==='configuracoes') Views.configuracoes.render();
  }

  function renderSummary(s){
    const lines = [`✔ ${s.type} — importação concluída`];
    if(s.projects.size) lines.push(`✔ ${s.projects.size} projeto(s) novo(s) identificado(s): ${[...s.projects].join(', ')}`);
    if(s.saleUpdates) lines.push(`✔ ${s.saleUpdates} valor(es) de venda atualizado(s)`);
    lines.push(`✔ ${s.added} registro(s) adicionado(s) ao banco`);
    lines.push(s.skipped.length ? `⚠ ${s.skipped.length} linha(s) ignorada(s) por inconsistência ou duplicidade (linhas: ${s.skipped.slice(0,15).join(', ')}${s.skipped.length>15?'…':''})` : `✔ Nenhum erro encontrado`);
    return `<div class="import-log">${lines.map(U.esc).join('<br>')}</div>`;
  }

  // Fluxo de importação (usado pelo seletor de arquivo e pelo drag&drop)
  async function handle(file, kind){
    UI.loading(true, 'Analisando planilha…');
    try{
      const fn = ({budget:importBudget, purchase:importPurchases,
                   paidAccount:importPaidAccounts, labor:importLabor})[kind];
      if(!fn) throw new Error('Tipo de importação não reconhecido.');
      const res = await fn(file);
      UI.loading(false);
      if(res.error){ UI.modal({title:'⚠ Inconsistência na planilha', body:`<div class="import-log">${res.error}</div>`, footer:`<button class="btn btn-primary" onclick="UI.close()">Entendi</button>`}); return; }
      UI.modal({title:'Resumo da Importação', body:renderSummary(res.summary), footer:`<button class="btn btn-primary" onclick="UI.close()">Fechar</button>`});
      UI.toast(`${res.summary.added} registros adicionados`, 'success');
      App.render();
    }catch(err){ UI.loading(false); UI.toast('Falha ao ler a planilha: '+U.esc(err.message), 'error', 6000); }
  }
  function pick(kind){
    const inp = document.getElementById('file-input');
    inp.onchange = () => { const file = inp.files[0]; inp.value = ''; if(file) handle(file, kind); };
    inp.click();
  }

  return { pick, handle, pickModel, clearModel, saveModel, KIND_LABELS };
})();
