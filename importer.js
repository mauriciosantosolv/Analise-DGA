/**
 * Importador de Planilhas (importer.js)
 *
 * Responsabilidades:
 * - leitura de planilhas-modelo (XLSX) com mapeamento por sinônimos
 * - importação de orçamentos (usada pelo módulo orcamentos)
 * - importação cumulativa de compras, contas pagas e mão de obra
 * - criação automática de projetos e categorias
 *
 * Dependências:
 * - database
 * - utils
 * - vendor XLSX
 *
 * Não modificar:
 * - sinônimos de colunas (MAPS) sem validar com as planilhas-modelo
 * - regra cumulativa: linhas válidas nunca são descartadas por semelhança
 */

/* ================= [5] IMPORTADORES =================
   Reconhecem automaticamente as colunas das planilhas-modelo:
   • Modelo de orçamentos: PROJETO | DESCRIÇÃO | VALOR ORÇADO
   • Modelo compras: Projeto | Pedido de Compra | Fornecedor | Categoria |
     Descrição do Produto | Observações | Valor Total | Data de Inclusão
   • Modelo contas pagas: Projeto | Categoria | Valor da Conta | Conta Corrente |
     Observação da Conta | Data de Pagto ou Recbto (completa)
   • Modelo mão de obra: PROJETO | CUSTO | DATA, com fornecedor, pedido/nota,
     categoria, descrição e observações opcionais
   Mapeamento por sinônimos + validação linha a linha. Sempre SOMA ao banco. */
const Importer = (() => {
  let lastImportedIds = [];
  const MAX_FILE_BYTES = 15*1024*1024;
  const MAX_ROWS = 25000;
  const MAX_COLUMNS = 80;
  const MAX_CELL_CHARS = 5000;

  // Sinônimos aceitos por campo (comparação normalizada, sem acentos)
  const MAPS = {
    budget: {
      project:  ['projeto','proposta','obra','numero da proposta','n proposta'],
      category: ['descricao','categoria','item','descricao da categoria'],
      value:    ['valor orcado','orcado','valor','valor previsto','orcamento']
    },
    purchase: {
      project:  ['projeto','obra','proposta','numero da proposta'],
      order:    ['pedido de compra','pedido/nota','pedido nota','pedido','n pedido','numero do pedido','nota','nf'],
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
      supplier: ['fornecedor','favorecido','beneficiario','razao social','nome fantasia'],
      order:    ['pedido/nota','pedido nota','pedido','nota','nota fiscal','nf','documento'],
      desc:     ['observacao da conta','observacoes da conta','observacao','observacoes','descricao'],
      date:     ['data de pagto ou recbto (completa)','data de pagto ou recbto','data de pagamento','data do pagamento','data']
    },
    labor: {
      project:  ['projeto','obra','proposta','numero da proposta'],
      value:    ['custo','valor da mao de obra','valor','total'],
      date:     ['data','data do custo','data de lancamento'],
      category: ['categoria','classe','classificacao'],
      supplier: ['fornecedor','colaborador','funcionario','prestador','nome'],
      order:    ['pedido/nota','pedido nota','pedido','nota','nota fiscal','nf','documento'],
      desc:     ['descricao','servico','atividade','funcao','cargo'],
      notes:    ['observacoes','observacao','obs','detalhes']
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

  // Alguns relatórios trazem título ou filtros antes do cabeçalho. Procura a
  // linha com mais campos reconhecidos nas primeiras 20 linhas e começa a
  // importação logo abaixo dela.
  function findHeader(rows,map,kind){
    let best={headerIndex:0,headerRow:rows[0]||[],cols:{},missing:Object.keys(map),score:-1};
    rows.slice(0,20).forEach((row,index)=>{
      if(!Array.isArray(row)) return;
      const detected=mapHeaders(row,map,kind);
      const score=Object.keys(detected.cols).length;
      if(score>best.score) best={headerIndex:index,headerRow:row,score,...detected};
    });
    return best;
  }

  function readWorkbook(file){
    return new Promise((res, rej) => {
      if(!file || file.size>MAX_FILE_BYTES)
        return rej(new Error('A planilha excede o limite de 15 MB.'));
      if(!/\.(xlsx|xls|csv)$/i.test(String(file.name||'')))
        return rej(new Error('Formato não permitido. Use XLSX, XLS ou CSV.'));
      const fr = new FileReader();
      fr.onload = e => {
        try{
          const wb = XLSX.read(e.target.result, {type:'array', cellDates:true});
          if(!wb.SheetNames.length) throw new Error('A planilha não contém abas.');
          const ws = wb.Sheets[wb.SheetNames[0]];
          const range=ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
          if(range && range.e.r-range.s.r+1>MAX_ROWS)
            throw new Error(`A planilha excede o limite de ${MAX_ROWS.toLocaleString('pt-BR')} linhas.`);
          if(range && range.e.c-range.s.c+1>MAX_COLUMNS)
            throw new Error(`A planilha excede o limite de ${MAX_COLUMNS} colunas.`);
          const rows=XLSX.utils.sheet_to_json(ws, {header:1, defval:null, raw:true});
          for(const row of rows){
            if(row.length>MAX_COLUMNS) throw new Error(`A planilha excede o limite de ${MAX_COLUMNS} colunas.`);
            for(const cell of row){
              if(typeof cell==='string' && cell.length>MAX_CELL_CHARS)
                throw new Error(`Uma célula excede o limite de ${MAX_CELL_CHARS.toLocaleString('pt-BR')} caracteres.`);
            }
          }
          res(rows);
        }catch(err){ rej(err); }
      };
      fr.onerror = () => rej(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }

  // Separa o código inicial do nome sem remover pontos, traços ou letras.
  // Exemplos: "649 Caramuru" e "815-USF Unidade".
  function splitProject(raw){
    const s = String(raw??'').normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g,'-').trim();
    // Espaços ao redor de um traço continuam sendo tratados como separador
    // legado entre proposta e nome ("649 - Caramuru"). No código composto, o
    // separador vem junto: "815-USF" ou "815.02-A".
    const legacy = s.match(/^([a-z0-9]+)\s+-\s+(.+)$/i);
    if(legacy) return {proposal:U.projectCode(legacy[1]),name:String(legacy[2]||'').trim()};
    const m = s.match(/^([a-z0-9]+(?:[.\-_/][a-z0-9]+)*)\s+(.+)$/i);
    return m
      ? {proposal:U.projectCode(m[1]), name:String(m[2]||'').trim()}
      : {proposal:U.projectCode(s), name:''};
  }

  // Garante que o projeto existe; cria automaticamente se necessário
  async function ensureProject(raw, created){
    const {proposal, name} = splitProject(raw);
    const proposalKey=U.projectCodeKey(proposal);
    let p = State.projects.find(x => U.projectCodeKey(x.proposal) === proposalKey);
    if(!p){
      p = {id:U.id(), proposal, name, client:'', clientLogo:'', saleValue:0, type:'Obra',
           status:'Em andamento', start:'', deadline:'', expectedEnd:'', realEnd:'', notes:'', createdAt:Date.now()};
      await DB.put('projects', p); State.projects.push(p); created.add(proposal);
    } else if(name && !p.name){ p.name = name; await DB.put('projects', p); }
    return p;
  }

  async function ensureCategory(name){
    const n = Biz.categoryKey(name);
    if(!n) return '';
    let existing=State.categories.find(c => Biz.categoryKey(c.name) === n);
    if(!existing){
      const palette = ['#2563EB','#16A34A','#D97706','#DC2626','#7C3AED','#0891B2','#DB2777','#65A30D','#EA580C','#4F46E5'];
      const c = {id:U.id(), name:Biz.categoryName(name), color:palette[State.categories.length % palette.length], icon:'tag'};
      await DB.put('categories', c); State.categories.push(c);
      existing=c;
    }
    return existing.name;
  }

  const SPECIAL_BUDGET = ['total','valor de venda']; // linhas especiais do modelo de orçamentos

  async function importBudget(file){
    const rows = await readWorkbook(file);
    if(!rows.length) throw new Error('Planilha vazia.');
    const {cols, missing, headerIndex, headerRow} = findHeader(rows, MAPS.budget, 'budget');
    if(missing.length) return {error:`Colunas não reconhecidas no modelo de orçamentos: ${missing.map(f=>({project:'PROJETO',category:'DESCRIÇÃO',value:'VALOR ORÇADO'}[f])).join(', ')}. Cabeçalho encontrado: ${headerRow.filter(Boolean).join(' | ')}`};
    const created = new Set(); let added = 0, skipped = [], saleUpdates = 0;
    const records = [];
    for(let i=headerIndex+1; i<rows.length; i++){
      const r = rows[i]; if(!r || r.every(c=>c==null||c==='')) continue;
      const rawProj = r[cols.project], cat = r[cols.category], val = U.num(r[cols.value]);
      if(rawProj==null || !String(cat??'').trim()){ skipped.push(i+1); continue; }
      const catNorm = U.norm(cat);
      const p = await ensureProject(rawProj, created);
      if(catNorm === 'valor de venda'){ if(val>0){ p.saleValue = val; await DB.put('projects', p); saleUpdates++; } continue; }
      if(SPECIAL_BUDGET.includes(catNorm)) continue; // TOTAL é derivado, não armazenado
      const category=await ensureCategory(cat);
      records.push({id:U.id(), projectId:p.id, category, value:val, importedAt:Date.now(), file:file.name});
      added++;
    }
    await DB.bulkPut('budgets', records);
    await State.reload();
    return {summary:{projects:created, added, skipped, saleUpdates, type:'Orçamentos'}};
  }

  async function importPurchases(file){
    const rows = await readWorkbook(file);
    if(!rows.length) throw new Error('Planilha vazia.');
    const {cols, missing, headerIndex, headerRow} = findHeader(rows, MAPS.purchase, 'purchase');
    const critical = missing.filter(f => ['project','value','category'].includes(f));
    if(critical.length) return {error:`Colunas obrigatórias não reconhecidas no modelo de compras: ${critical.join(', ')}. Cabeçalho encontrado: ${headerRow.filter(Boolean).join(' | ')}`};
    const created = new Set(); let added = 0; const skipped = [];
    const records = [];
    for(let i=headerIndex+1; i<rows.length; i++){
      const r = rows[i]; if(!r || r.every(c=>c==null||c==='')) continue;
      const rawProj = r[cols.project], val = U.num(r[cols.value]);
      const cat = String(r[cols.category]??'').trim();
      if(rawProj==null || !cat || !(val>0 || val<0)){ skipped.push(i+1); continue; }
      const p = await ensureProject(rawProj, created);
      const date = cols.date!=null ? U.parseDate(r[cols.date]) : null;
      const category=await ensureCategory(cat);
      const rec = {
        id:U.id(), projectId:p.id, category,
        supplier: cols.supplier!=null ? String(r[cols.supplier]??'').trim() : '',
        desc:     cols.desc!=null ? String(r[cols.desc]??'').trim() : '',
        notes:    cols.notes!=null ? String(r[cols.notes]??'').trim() : '',
        order:    cols.order!=null ? String(r[cols.order]??'').trim() : '',
        value:val, date: date ? U.isoDate(date) : '', costCenter:category,
        importedAt:Date.now(), file:file.name, sourceType:'purchase'
      };
      records.push(rec); added++;
    }
    await DB.bulkPut('purchases', records);
    await State.reload();
    return {summary:{projects:created, added, skipped, type:'Compras'},recordIds:records.map(x=>x.id)};
  }

  // Contas pagas entram na mesma base financeira das compras e, portanto,
  // compõem o Realizado do projeto e da categoria escolhida na planilha.
  async function importPaidAccounts(file){
    const rows = await readWorkbook(file);
    if(!rows.length) throw new Error('Planilha vazia.');
    const {cols, missing, headerIndex, headerRow} = findHeader(rows, MAPS.paidAccount, 'paidAccount');
    const critical = missing.filter(f => ['project','category','value','date'].includes(f));
    if(critical.length) return {error:`Colunas obrigatórias não reconhecidas no modelo de contas pagas: ${critical.join(', ')}. Cabeçalho encontrado: ${headerRow.filter(Boolean).join(' | ')}`};
    const created = new Set(); let added = 0; const skipped = [];
    const records = [];
    for(let i=headerIndex+1; i<rows.length; i++){
      const r = rows[i]; if(!r || r.every(c=>c==null||c==='')) continue;
      const rawProj = r[cols.project], cat = String(r[cols.category]??'').trim(), val = U.num(r[cols.value]);
      if(rawProj==null || !cat || !(val>0 || val<0)){ skipped.push(i+1); continue; }
      const p = await ensureProject(rawProj, created);
      const date = U.parseDate(r[cols.date]);
      const account = cols.account!=null ? String(r[cols.account]??'').trim() : '';
      const supplier = cols.supplier!=null ? String(r[cols.supplier]??'').trim() : '';
      const desc = cols.desc!=null ? String(r[cols.desc]??'').trim() : '';
      const category=await ensureCategory(cat);
      const rec = {
        id:U.id(), projectId:p.id, category, supplier:supplier||account,
        desc:desc || 'Conta paga', notes:account&&supplier?`Conta: ${account}`:'',
        order:cols.order!=null ? String(r[cols.order]??'').trim() : '', value:val,
        date:date ? U.isoDate(date) : '', costCenter:category,
        importedAt:Date.now(), file:file.name, sourceType:'paidAccount'
      };
      records.push(rec); added++;
    }
    await DB.bulkPut('purchases', records);
    await State.reload();
    return {summary:{projects:created, added, skipped, type:'Contas pagas'},recordIds:records.map(x=>x.id)};
  }

  // Na ausência de uma categoria no modelo, os registros continuam sendo
  // classificados como "Mão de Obra". Campos administrativos opcionais são
  // preservados quando existirem na planilha.
  async function importLabor(file){
    const rows = await readWorkbook(file);
    if(!rows.length) throw new Error('Planilha vazia.');
    const {cols, missing, headerIndex, headerRow} = findHeader(rows, MAPS.labor, 'labor');
    const critical = missing.filter(f => ['project','value','date'].includes(f));
    if(critical.length) return {error:`Colunas obrigatórias não reconhecidas no modelo de mão de obra: ${critical.join(', ')}. Cabeçalho encontrado: ${headerRow.filter(Boolean).join(' | ')}`};
    const created = new Set(); let added = 0; const skipped = [];
    const records = [];
    const laborCategory = 'Mão de Obra';
    for(let i=headerIndex+1; i<rows.length; i++){
      const r = rows[i]; if(!r || r.every(c=>c==null||c==='')) continue;
      const rawProj = r[cols.project], val = U.num(r[cols.value]);
      if(rawProj==null || !(val>0 || val<0)){ skipped.push(i+1); continue; }
      const p = await ensureProject(rawProj, created);
      const date = U.parseDate(r[cols.date]);
      const category=await ensureCategory(cols.category!=null ? r[cols.category] : laborCategory);
      const rec = {
        id:U.id(), projectId:p.id, category,
        supplier:cols.supplier!=null ? String(r[cols.supplier]??'').trim() : '',
        desc:cols.desc!=null ? String(r[cols.desc]??'').trim() || 'Custo de mão de obra' : 'Custo de mão de obra',
        notes:cols.notes!=null ? String(r[cols.notes]??'').trim() : '',
        order:cols.order!=null ? String(r[cols.order]??'').trim() : '', value:val,
        date:date ? U.isoDate(date) : '', costCenter:category,
        importedAt:Date.now(), file:file.name, sourceType:'labor'
      };
      records.push(rec); added++;
    }
    await DB.bulkPut('purchases', records);
    await State.reload();
    // v4.0.2 — mão de obra importada abate o planejamento pela mesma regra do
    // RDO e da integração Omie, sem depender de confirmação manual.
    const offset=await applyLaborPlanningOffset(records.map(x=>x.id));
    return {summary:{projects:created, added, skipped, type:'Mão de obra', planningOffset:offset},
      recordIds:records.map(x=>x.id), autoOffset:true};
  }

  // Abate do planejamento os custos de mão de obra recém-importados. Na nuvem a
  // operação é atômica no banco; sem nuvem, replica a mesma regra localmente.
  async function applyLaborPlanningOffset(recordIds){
    const ids=(recordIds||[]).map(String).filter(Boolean);
    const empty={offsetCount:0,applied:0,unmatched:0};
    if(!ids.length) return empty;
    try{
      if(typeof Cloud!=='undefined' && Cloud.active()){
        if(!Cloud.canEditStore('planning')) return empty;
        const result=await Cloud.offsetLaborPlanning(ids)||empty;
        await DB.syncFromCloud();
        await State.reload();
        return {offsetCount:Number(result.offsetCount)||0,
          applied:Number(result.applied)||0,unmatched:Number(result.unmatched)||0};
      }
      let offsetCount=0, applied=0, unmatched=0;
      for(const id of ids){
        const purchase=State.purchases.find(item=>String(item.id)===id);
        if(!purchase || !(Number(purchase.value)>0)) continue;
        if(purchase.planningOffset || (Array.isArray(purchase.planningOffsets)&&purchase.planningOffsets.length)) continue;
        const offset=State.planPlanningConsumption(
          purchase.projectId,purchase.category,purchase.value,purchase.id,
          'labor_consumed','labor','Mão de obra importada abatida do planejamento');
        unmatched=Math.round((unmatched+offset.unmatched)*100)/100;
        if(!(offset.applied>0)) continue;
        for(const row of offset.planningRows) await DB.put('planning',row);
        for(const row of offset.historyRows) await DB.put('planning_history',row);
        await DB.put('purchases',{...purchase,planningOffsets:offset.offsets,
          planningOffsetAmount:offset.applied,planningUnmatchedAmount:offset.unmatched,
          abatido:true,planningOffsetAt:new Date().toISOString()});
        offsetCount++; applied=Math.round((applied+offset.applied)*100)/100;
      }
      if(offsetCount) await State.reload();
      return {offsetCount,applied,unmatched};
    }catch(err){
      // O abatimento nunca pode derrubar a importação já concluída.
      if(typeof UI!=='undefined')
        UI.toast('Os lançamentos foram importados, mas o abatimento do planejamento falhou: '+U.esc(err.message||err),'warn',9000);
      return empty;
    }
  }



  async function saveModel(file, kind){
    const rows = await readWorkbook(file);
    if(!rows.length || !rows.some(row=>Array.isArray(row)&&row.some(Boolean))) throw new Error('O modelo não possui cabeçalho válido.');
    const map = MAPS[kind];
    if(!map) throw new Error('Base de dados não reconhecida.');
    const detected = findHeader(rows, map, null);
    const criticalByKind = {budget:['project','category','value'], purchase:['project','category','value'], paidAccount:['project','category','value','date'], labor:['project','value','date']};
    const missingCritical = (criticalByKind[kind]||[]).filter(f=>detected.cols[f] == null);
    if(missingCritical.length) throw new Error('Não foi possível identificar no modelo: '+missingCritical.join(', ')+'.');
    const fields = {};
    Object.entries(detected.cols).forEach(([field, idx]) => fields[field] = String(detected.headerRow[idx]??'').trim());
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
    lines.push(s.skipped.length ? `⚠ ${s.skipped.length} linha(s) ignorada(s) por dados obrigatórios ausentes ou inválidos (linhas: ${s.skipped.slice(0,15).join(', ')}${s.skipped.length>15?'…':''})` : `✔ Nenhum erro encontrado`);
    if(s.planningOffset){
      const offset=s.planningOffset;
      lines.push(offset.offsetCount
        ? `✔ ${offset.offsetCount} lançamento(s) abatido(s) automaticamente do planejamento (${U.money2(offset.applied)})`
        : `⚠ Nenhum item planejado de mesmo projeto e categoria foi encontrado para abater`);
      if(Number(offset.unmatched)>0)
        lines.push(`⚠ ${U.money2(offset.unmatched)} sem saldo planejado correspondente`);
    }
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
      if(res.error){ UI.modal({title:'⚠ Inconsistência na planilha', body:`<div class="import-log">${U.esc(res.error)}</div>`, footer:`<button class="btn btn-primary" onclick="UI.close()">Entendi</button>`}); return; }
      lastImportedIds=(res.recordIds||[]).slice();
      // Mão de obra já foi abatida automaticamente; não reoferece o vínculo manual.
      const canOffset=!res.autoOffset && lastImportedIds.length
        && (typeof Cloud==='undefined' || !Cloud.active() || Cloud.canEditStore('planning'));
      UI.modal({title:'Resumo da Importação', body:`${renderSummary(res.summary)}${canOffset?'<p style="margin-top:12px;color:var(--text2);font-size:.84rem">Você pode vincular os novos gastos aos itens planejados de mesmo projeto e categoria.</p>':''}`, footer:`<button class="btn btn-ghost" onclick="UI.close()">Fechar</button>${canOffset?'<button class="btn btn-primary" onclick="Importer.reconcileLast()"><i data-lucide="calendar-check"></i>Abater do planejamento</button>':''}`});
      UI.toast(`${res.summary.added} registros adicionados`, 'success');
      App.render();
    }catch(err){ UI.loading(false); UI.toast('Falha ao ler a planilha: '+U.esc(err.message), 'error', 6000); }
  }
  function pick(kind){
    const inp = document.getElementById('file-input');
    inp.onchange = () => { const file = inp.files[0]; inp.value = ''; if(file) handle(file, kind); };
    inp.click();
  }
  function reconcileLast(){
    const ids=lastImportedIds.slice();
    UI.close();
    Views.financeiro.showImportReconciliation(ids);
  }

  return { pick, handle, pickModel, clearModel, saveModel, reconcileLast, projectParts:splitProject, KIND_LABELS };
})();
