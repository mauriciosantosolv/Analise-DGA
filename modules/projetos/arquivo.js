/**
 * v4.5.17 - Arquivamento de obra concluída
 *
 * Fluxo (somente proprietário/administrador, com a nuvem ativa):
 *  1. lê do banco TUDO da obra (clique_obras_archive_project_snapshot), com
 *     a impressão digital desses dados;
 *  2. monta no aparelho um ZIP com: relatório da obra em PDF, planilha Excel
 *     com todos os lançamentos, PDF de cada RDO (com fotos), as fotos e
 *     documentos originais e o JSON com todos os registros (para consulta ou
 *     restauração futura). O ZIP é reaberto e conferido antes de liberar;
 *  3. o usuário baixa/salva o arquivo, confirma que guardou e digita o número
 *     da proposta;
 *  4. a Edge Function arquivar-obra chama clique_obras_archive_project, que só
 *     apaga se a impressão digital continuar igual, e depois apaga as fotos.
 *
 * O que fica no sistema: o projeto (ficha "Arquivada"), orçamento,
 * planejamento, medições, recebimentos, previsões e as compras resumidas por
 * categoria x mês x origem. Os totais do Dashboard não mudam.
 */
const ProjectArchive = {
  busy:false,
  current:null,

  isArchived(project){
    return !!(project && project.archive && typeof project.archive==='object');
  },
  canManage(){
    return typeof Cloud!=='undefined' && Cloud.active() && ['owner','admin'].includes(Cloud.role());
  },
  canArchive(project){
    return !!project && project.status==='Concluído' && !this.isArchived(project) && this.canManage();
  },
  badge(project){
    if(!this.isArchived(project)) return '';
    const pending=project.archive.status==='photos_pending';
    return ` <span class="tag ${pending?'tag-amber':'tag-gray'}" title="${pending?'Arquivada · fotos ainda no armazenamento':'Obra arquivada'}"><i data-lucide="archive"></i>Arquivada</span>`;
  },

  // Quadro mostrado no detalhe da obra arquivada.
  detailCard(project){
    if(!this.isArchived(project)) return '';
    const archive=project.archive||{};
    const counts=archive.counts||{};
    const file=archive.file||{};
    const pending=archive.status==='photos_pending' && Number(counts.photosRemaining)>0;
    return `<div class="card archive-card" style="margin-bottom:14px">
      <div class="archive-card-head">
        <i data-lucide="archive"></i>
        <div><b>Obra arquivada</b><small>Em ${U.esc(archive.archivedAt?new Date(archive.archivedAt).toLocaleString('pt-BR'):'—')}${archive.archivedByName?` por ${U.esc(archive.archivedByName)}`:''}</small></div>
      </div>
      <p>Os detalhes saíram do banco e estão no arquivo <b>${U.esc(file.name||'—')}</b>${file.bytes?` (${U.esc(Pdf.formatSize(file.bytes))})`:''}.
        Ficaram aqui: orçamento, planejamento, medições e os lançamentos resumidos por categoria e mês. Os totais não mudaram.</p>
      <div class="archive-counts">
        <span><b>${Number(counts.purchases)||0}</b> lançamentos → ${Number(counts.purchaseSummaries)||0} linhas de resumo</span>
        <span><b>${Number(counts.rdos)||0}</b> RDOs</span>
        <span><b>${Number(counts.photos)||0}</b> fotos/anexos${counts.photoBytes?` (${U.esc(Pdf.formatSize(counts.photoBytes))})`:''}</span>
        <span><b>${Number(counts.planningHistory)||0}</b> registros de histórico</span>
      </div>
      ${file.sha256?`<small class="archive-hash">Código de conferência do arquivo (SHA-256): <code>${U.esc(file.sha256)}</code></small>`:''}
      ${pending?`<div class="import-log archive-pending"><b>${Number(counts.photosRemaining)} foto(s) ainda no armazenamento.</b>
        ${this.canManage()?`<button class="btn btn-ghost btn-sm" onclick="ProjectArchive.finishPhotos(${U.jsArg(project.id)})"><i data-lucide="refresh-cw"></i>Concluir limpeza das fotos</button>`:''}</div>`:''}
    </div>`;
  },

  money(value){ return U.money2?U.money2(value):U.money(value); },
  slug(project){
    return Pdf.fileName(`${project.proposal||''} ${project.name||''}`.trim(),'obra').slice(0,80);
  },

  // Resumo que o banco vai gravar no lugar das compras (mesma regra do SQL).
  summaryPreview(purchases){
    const keys=new Set();
    purchases.forEach(item=>keys.add([item.category||'',String(item.date||'').slice(0,7),item.sourceType||'purchase'].join('|')));
    return keys.size;
  },

  async open(projectId){
    const project=State.projects.find(item=>String(item.id)===String(projectId));
    if(!project) return UI.toast('Projeto não encontrado.','warn');
    if(!this.canManage()) return UI.toast('Somente proprietário ou administrador pode arquivar obras.','warn');
    if(this.busy) return UI.toast('Já existe um arquivamento em andamento.','warn');
    try{
      UI.loading(true,'Sincronizando com a nuvem…');
      await DB.syncFromCloud();
      await State.reload();
      UI.loading(true,'Lendo os dados da obra…');
      const snapshot=await Cloud.archiveProjectSnapshot(project.id);
      UI.loading(false);
      this.current={projectId:String(project.id),snapshot,zip:null};
      this.showPlan();
    }catch(err){
      UI.loading(false);
      UI.toast('Não foi possível ler os dados da obra: '+U.esc(err.message||err),'error',8000);
    }
  },

  records(store){
    const snapshot=this.current&&this.current.snapshot;
    const list=snapshot&&snapshot.records&&snapshot.records[store];
    return Array.isArray(list)?list:[];
  },

  showPlan(){
    const {snapshot}=this.current;
    const project=snapshot.project||{};
    const purchases=this.records('purchases');
    const attachments=Array.isArray(snapshot.attachments)?snapshot.attachments:[];
    const photoBytes=attachments.reduce((sum,item)=>sum+(Number(item.sizeBytes)||0),0);
    const rdos=this.records('rdos');
    const pending=Array.isArray(snapshot.pendingRdos)?snapshot.pendingRdos:[];
    const omieOn=(snapshot.omieProjects||[]).filter(item=>item.enabled);
    const blockers=[];
    if(snapshot.archived) blockers.push('Esta obra já está arquivada.');
    if(!snapshot.concluded) blockers.push('Só é possível arquivar obra com status <b>Concluído</b>.');
    if(pending.length) blockers.push(`A obra tem ${pending.length} RDO(s) que não estão aprovados. Aprove ou exclua antes de arquivar:<br>${pending.slice(0,12).map(item=>`<span class="tag tag-amber">${U.esc(item.number||item.rdoId)} · ${U.esc(U.date(item.date))} · ${U.esc(item.status||'')}</span>`).join(' ')}${pending.length>12?' …':''}`);
    const label=U.projLabel(project);
    const estimate=photoBytes+rdos.length*180000+purchases.length*400+300000;
    UI.modal({
      title:`Arquivar obra ${label}`,
      wide:true,
      body:`${blockers.length?`<div class="import-log archive-blockers">${blockers.map(item=>`<p>${item}</p>`).join('')}</div>`:''}
        <div class="archive-plan">
          <div>
            <h3><i data-lucide="file-archive"></i>Vai para o arquivo (ZIP)</h3>
            <ul>
              <li>Relatório da obra em PDF (indicadores, categorias, medições, RDOs e lançamentos)</li>
              <li>Planilha Excel com <b>${purchases.length}</b> lançamentos, orçamento, planejamento, histórico, medições e horas dos RDOs</li>
              <li>PDF de cada um dos <b>${rdos.length}</b> RDOs, com as fotos</li>
              <li><b>${attachments.length}</b> fotos e documentos originais (${U.esc(Pdf.formatSize(photoBytes))})</li>
              <li>Arquivo de dados (JSON) com todos os registros, para consulta ou restauração</li>
            </ul>
          </div>
          <div>
            <h3><i data-lucide="trash-2"></i>Sai do banco</h3>
            <ul>
              <li>${purchases.length} lançamentos → viram <b>${this.summaryPreview(purchases)}</b> linhas de resumo (categoria × mês)</li>
              <li>${rdos.length} RDOs e seus valores aprovados</li>
              <li>${attachments.length} fotos/anexos do armazenamento</li>
              <li>${this.records('planning_history').length} registros do histórico do planejamento</li>
            </ul>
            <h3><i data-lucide="check-circle"></i>Fica no sistema</h3>
            <ul>
              <li>Projeto, orçamento, planejamento, ${this.records('measurements').length} medição(ões) e recebimentos</li>
              <li>Totais do Dashboard, Curva S e margem continuam iguais</li>
              ${omieOn.length?`<li>A integração Omie desta obra será desligada (${omieOn.map(item=>U.esc(item.omieProjectName||item.omieProjectCode)).join(', ')})</li>`:''}
            </ul>
          </div>
        </div>
        <p class="archive-note"><i data-lucide="monitor"></i>Tamanho estimado do arquivo: <b>${U.esc(Pdf.formatSize(estimate))}</b>. Prefira fazer no computador e guardar o arquivo em local com cópia de segurança (servidor, OneDrive, Google Drive).</p>
        <div id="archive-step2"></div>`,
      footer:`<button class="btn btn-ghost" onclick="ProjectArchive.cancel()">Cancelar</button>
        ${blockers.length?'':`<button class="btn btn-primary" id="archive-build"><i data-lucide="download"></i>1. Gerar e baixar arquivo</button>`}`
    });
    const build=document.getElementById('archive-build');
    if(build) build.onclick=()=>this.build();
  },

  cancel(){
    if(this.busy) return;
    this.revokeUrls();
    this.current=null;
    UI.close();
  },

  progress(message){ UI.loading(true,message); },

  urls:[],
  revokeUrls(){ this.urls.forEach(url=>{ try{ URL.revokeObjectURL(url); }catch(e){} }); this.urls=[]; },

  async build(){
    if(this.busy||!this.current) return;
    this.busy=true;
    const {snapshot}=this.current;
    const project=State.projects.find(item=>String(item.id)===String(snapshot.projectId))||snapshot.project;
    const encoder=new TextEncoder();
    const folder=this.slug(project);
    const files={};
    const put=(path,bytes,compress=true)=>{ files[`${folder}/${path}`]=compress?bytes:[bytes,{level:0}]; };
    const used=new Set();
    const unique=path=>{
      let candidate=path, index=2;
      while(used.has(candidate.toLowerCase())){
        candidate=path.replace(/(\.[a-z0-9]+)?$/i,match=>` (${index})${match}`);
        index++;
      }
      used.add(candidate.toLowerCase());
      return candidate;
    };
    try{
      const fflate=await Pdf.zipReady();
      await Pdf.ready();
      const rdos=this.records('rdos').slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.number||'').localeCompare(String(b.number||'')));
      const financialByRdo=new Map(this.records('rdo_financial').map(item=>[String(item.rdoId||item.id),item]));
      const attachments=Array.isArray(snapshot.attachments)?snapshot.attachments:[];
      const byRdo=new Map();
      attachments.forEach(item=>{ const key=String(item.rdoId); if(!byRdo.has(key)) byRdo.set(key,[]); byRdo.get(key).push(item); });
      const rdoLabel=rdo=>Pdf.fileName(rdo.number||RDO.documentNumber(rdo),'RDO');

      // 1. Fotos e documentos originais
      const blobs=new Map();
      const fileIndex=[];
      let count=0, failed=[];
      for(const rdo of rdos){
        const list=byRdo.get(String(rdo.id))||[];
        let photoNumber=0;
        for(const item of list){
          count++;
          this.progress(`Baixando fotos e anexos ${count}/${attachments.length}…`);
          let blob=null;
          for(let attempt=0;attempt<3&&!blob;attempt++){
            try{ blob=await Cloud.downloadRdoAttachment(item.objectPath,{cache:false}); }
            catch(err){ if(attempt===2) failed.push(item); else await new Promise(resolve=>setTimeout(resolve,800*(attempt+1))); }
          }
          if(!blob) continue;
          blobs.set(String(item.id),blob);
          const ext=(String(item.fileName||'').match(/\.([a-z0-9]{2,5})$/i)||[])[1]||(RDO.isImage(item)?'jpg':'pdf');
          const base=RDO.isImage(item)
            ?`${String(++photoNumber).padStart(2,'0')} - ${item.description||item.fileName||'foto'}`
            :(item.description||item.fileName||'documento');
          const path=unique(`${RDO.isImage(item)?'fotos':'documentos'}/${rdoLabel(rdo)}/${Pdf.fileName(base,'arquivo').slice(0,90)}.${ext.toLowerCase()}`);
          put(path,new Uint8Array(await blob.arrayBuffer()),false);
          fileIndex.push({rdo:rdo.number||RDO.documentNumber(rdo),date:rdo.date,path,description:item.description||'',originalName:item.fileName||'',sizeBytes:Number(item.sizeBytes)||blob.size,uploadedAt:item.uploadedAt||''});
        }
      }
      // anexos de RDO que não está mais na lista (não deveria acontecer)
      const orphan=attachments.filter(item=>!rdos.some(rdo=>String(rdo.id)===String(item.rdoId)));
      for(const item of orphan){
        try{
          const blob=await Cloud.downloadRdoAttachment(item.objectPath,{cache:false});
          const path=unique(`documentos/sem-rdo/${Pdf.fileName(item.fileName||item.id,'arquivo')}`);
          put(path,new Uint8Array(await blob.arrayBuffer()),false);
          fileIndex.push({rdo:'',date:'',path,description:item.description||'',originalName:item.fileName||'',sizeBytes:blob.size,uploadedAt:item.uploadedAt||''});
        }catch(err){ failed.push(item); }
      }
      if(failed.length){
        throw new Error(`${failed.length} foto(s)/anexo(s) não puderam ser baixados (${failed.slice(0,3).map(item=>item.fileName||item.id).join(', ')}${failed.length>3?'…':''}). Verifique a conexão e gere o arquivo de novo. Nada foi apagado.`);
      }

      // 2. PDF de cada RDO
      const rdoIndex=[];
      for(let index=0;index<rdos.length;index++){
        const rdo=rdos[index];
        this.progress(`Gerando PDF dos RDOs ${index+1}/${rdos.length}…`);
        const list=byRdo.get(String(rdo.id))||[];
        const data=await RDO.documentData(rdo,{
          financial:financialByRdo.get(String(rdo.id))||null,
          attachments:list,
          imageUrl:item=>{
            const blob=blobs.get(String(item.id));
            if(!blob) throw new Error('sem arquivo');
            const url=URL.createObjectURL(blob);
            this.urls.push(url);
            return url;
          }
        });
        const pdf=await RDO.pdfBlob(data);
        const path=unique(`rdos/${String(rdo.date||'').slice(0,10)} - ${Pdf.fileName(RDO.pdfFileName(rdo).replace(/\.pdf$/i,''),'RDO')}.pdf`);
        put(path,new Uint8Array(await pdf.arrayBuffer()),false);
        rdoIndex.push({id:rdo.id,number:rdo.number||'',document:RDO.documentNumber(rdo),date:rdo.date,path});
        this.revokeUrls();
      }

      // 3. Planilha
      this.progress('Montando a planilha…');
      put(`${folder}.xlsx`,new Uint8Array(this.workbook(project,rdos,financialByRdo,fileIndex)));

      // 4. Relatório da obra
      this.progress('Gerando o relatório da obra…');
      const report=await this.reportPdf(project,rdos,financialByRdo,attachments);
      put('relatorio-da-obra.pdf',new Uint8Array(await report.arrayBuffer()),false);

      // 5. Dados completos + manifesto
      const manifest={
        app:'CliqueObras',kind:'arquivo-de-obra',version:1,
        appVersion:document.querySelector('meta[name="application-version"]')?.content||'',
        generatedAt:new Date().toISOString(),
        generatedBy:(Cloud.user()&&Cloud.user().email)||'',
        organization:{id:snapshot.organizationId,name:(Cloud.organization()||{}).name||''},
        project:{id:snapshot.projectId,proposal:project.proposal||'',name:project.name||'',client:project.client||''},
        fingerprint:snapshot.fingerprint,
        counts:Object.fromEntries(Object.entries(snapshot.records||{}).map(([store,list])=>[store,Array.isArray(list)?list.length:0])),
        attachments:attachments.length,
        files:{rdos:rdoIndex,attachments:fileIndex}
      };
      put('dados/obra.json',encoder.encode(JSON.stringify({manifest,snapshot},null,1)));
      put('LEIA-ME.txt',encoder.encode(this.readme(project,manifest,rdos.length,attachments.length)));

      // 6. ZIP + conferência
      this.progress('Compactando o arquivo…');
      const zipped=fflate.zipSync(files,{level:6,mtime:new Date()});
      this.progress('Conferindo o arquivo…');
      const check=fflate.unzipSync(zipped);
      const expectedFiles=Object.keys(files).length;
      if(Object.keys(check).length!==expectedFiles) throw new Error('A conferência do ZIP falhou (quantidade de arquivos). Gere de novo.');
      const reread=JSON.parse(new TextDecoder().decode(check[`${folder}/dados/obra.json`]));
      if(!reread||!reread.snapshot||reread.snapshot.fingerprint!==snapshot.fingerprint
        ||(reread.snapshot.records.purchases||[]).length!==this.records('purchases').length
        ||(reread.snapshot.records.rdos||[]).length!==rdos.length)
        throw new Error('A conferência do ZIP falhou (dados). Gere de novo.');
      const blob=new Blob([zipped],{type:'application/zip'});
      const sha256=await Pdf.sha256(blob);
      const stamp=new Date().toISOString().slice(0,10);
      const name=`Arquivo da obra ${folder} - ${stamp}.zip`;
      this.current.zip={blob,name,sha256,bytes:blob.size,files:expectedFiles};
      UI.loading(false);
      this.busy=false;
      this.showConfirm();
      this.download();
    }catch(err){
      this.busy=false;
      this.revokeUrls();
      UI.loading(false);
      UI.toast('Não foi possível gerar o arquivo: '+U.esc(err.message||err),'error',10000);
    }
  },

  download(){
    const zip=this.current&&this.current.zip;
    if(!zip) return;
    if(typeof Pdf!=='undefined'&&Pdf.preferFile()) return Pdf.deliver(zip.blob,zip.name,{title:'Arquivo da obra pronto'});
    // arquivo grande: o link temporário fica válido por mais tempo que o padrão
    const anchor=document.createElement('a');
    anchor.href=URL.createObjectURL(zip.blob);
    anchor.download=zip.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(anchor.href),120000);
  },

  showConfirm(){
    const zip=this.current.zip;
    const project=this.current.snapshot.project||{};
    const target=document.getElementById('archive-step2');
    const html=`<div class="archive-confirm">
        <div class="pdf-ready"><i data-lucide="file-check-2"></i><div><b>${U.esc(zip.name)}</b><small>${U.esc(Pdf.formatSize(zip.bytes))} · ${zip.files} arquivos · conferido</small></div>
          <button class="btn btn-ghost btn-sm" type="button" onclick="ProjectArchive.download()"><i data-lucide="download"></i>Baixar de novo</button></div>
        <small class="archive-hash">Código de conferência (SHA-256): <code>${U.esc(zip.sha256)}</code></small>
        <label class="archive-check"><input type="checkbox" id="archive-saved"> Abri o arquivo e guardei uma cópia em local seguro (servidor, OneDrive, Google Drive).</label>
        <label for="archive-proposal">Para confirmar, digite o número da proposta: <b>${U.esc(project.proposal||'')}</b></label>
        <input id="archive-proposal" autocomplete="off" inputmode="text">
        <p class="archive-warning"><i data-lucide="alert-triangle"></i>Depois de arquivar, os lançamentos, RDOs e fotos desta obra só existirão no arquivo. Não há como desfazer pelo sistema.</p>
      </div>`;
    if(target && document.getElementById('archive-build')){
      target.innerHTML=html;
      const build=document.getElementById('archive-build');
      build.outerHTML=`<button class="btn btn-danger" id="archive-commit" disabled><i data-lucide="archive"></i>2. Arquivar obra</button>`;
    }else{
      UI.modal({title:`Arquivar obra ${U.projLabel(project)}`,wide:true,body:html,
        footer:`<button class="btn btn-ghost" onclick="ProjectArchive.cancel()">Cancelar</button><button class="btn btn-danger" id="archive-commit" disabled><i data-lucide="archive"></i>2. Arquivar obra</button>`,replace:true});
    }
    U.icons();
    const saved=document.getElementById('archive-saved');
    const proposal=document.getElementById('archive-proposal');
    const commit=document.getElementById('archive-commit');
    const refresh=()=>{
      const typed=U.projectCodeKey?U.projectCodeKey(proposal.value):String(proposal.value).trim();
      const expected=U.projectCodeKey?U.projectCodeKey(project.proposal||''):String(project.proposal||'').trim();
      commit.disabled=!(saved.checked&&typed&&typed===expected);
    };
    saved.onchange=refresh;
    proposal.oninput=refresh;
    commit.onclick=()=>this.commit();
  },

  async commit(){
    if(this.busy||!this.current||!this.current.zip) return;
    const {snapshot,zip}=this.current;
    this.busy=true;
    try{
      UI.loading(true,'Arquivando a obra e liberando espaço…');
      const result=await Cloud.archiveProject(snapshot.projectId,snapshot.fingerprint,{name:zip.name,sha256:zip.sha256,bytes:zip.bytes});
      UI.loading(true,'Atualizando os dados…');
      await DB.syncFromCloud();
      await State.reload();
      UI.loading(false);
      this.busy=false;
      this.current=null;
      UI.closeAll();
      const photos=result&&result.photos||{};
      const counts=result&&result.archive&&result.archive.counts||{};
      UI.modal({
        title:'Obra arquivada',
        body:`<div class="pdf-ready"><i data-lucide="archive"></i><div><b>${U.esc(U.projLabel(snapshot.project||{}))}</b>
          <small>${Number(counts.purchases)||0} lançamentos, ${Number(counts.rdos)||0} RDOs e ${Number(photos.removed)||0} foto(s)/anexo(s) saíram do banco.</small></div></div>
          ${photos.remaining>0?`<p class="archive-warning"><i data-lucide="alert-triangle"></i>${Number(photos.remaining)} foto(s) ainda não saíram do armazenamento. Abra a obra e use <b>Concluir limpeza das fotos</b>.</p>`:''}
          <p class="pdf-ready-hint">Guarde o arquivo <b>${U.esc(zip.name)}</b>: ele é o único registro dos detalhes desta obra.</p>`,
        footer:`<button class="btn btn-primary" onclick="UI.close()">Fechar</button>`
      });
      App.render();
    }catch(err){
      this.busy=false;
      UI.loading(false);
      UI.toast('Não foi possível arquivar: '+U.esc(err.message||err),'error',10000);
    }
  },

  async finishPhotos(projectId){
    if(this.busy) return;
    this.busy=true;
    try{
      UI.loading(true,'Removendo as fotos do armazenamento…');
      const result=await Cloud.archiveProjectPhotos(projectId);
      await DB.syncFromCloud();
      await State.reload();
      UI.loading(false);
      const remaining=Number(result&&result.photos&&result.photos.remaining)||0;
      UI.toast(remaining?`Ainda restam ${remaining} foto(s). Tente novamente em alguns minutos.`:'Fotos removidas. Arquivamento concluído.',remaining?'warn':'success',7000);
      UI.closeAll();
      if(Views.projetos&&typeof Views.projetos.detail==='function') Views.projetos.detail(projectId);
    }catch(err){
      UI.loading(false);
      UI.toast('Não foi possível concluir a limpeza: '+U.esc(err.message||err),'error',8000);
    }finally{
      this.busy=false;
    }
  },

  readme(project,manifest,rdoCount,attachmentCount){
    return [
      'ARQUIVO DA OBRA - CliqueObras',
      '',
      `Obra: ${U.projLabel(project)}`,
      `Cliente: ${project.client||'-'}`,
      `Gerado em: ${new Date(manifest.generatedAt).toLocaleString('pt-BR')} por ${manifest.generatedBy||'-'}`,
      '',
      'Conteúdo:',
      '  relatorio-da-obra.pdf  Indicadores, categorias, medições, RDOs e todos os lançamentos.',
      `  ${this.slug(project)}.xlsx  Planilha com todos os registros (uma aba por tipo).`,
      `  rdos/                  PDF de cada RDO (${rdoCount}), com as fotos.`,
      `  fotos/ e documentos/   Fotos e anexos originais (${attachmentCount}), separados por RDO.`,
      '  dados/obra.json        Todos os registros exatamente como estavam no banco.',
      '',
      'Depois do arquivamento, os lançamentos, RDOs e fotos desta obra existem',
      'somente neste arquivo. Guarde-o em local com cópia de segurança.',
      `Impressão digital dos dados: ${manifest.fingerprint}`,
      ''
    ].join('\r\n');
  },

  // Texto que começa com = + - @ vira fórmula no Excel; recebe apóstrofo (igual Exports.spreadsheetCell).
  sheet(rows){
    const cell=value=>typeof value==='string'&&/^[\u0000-\u0020]*[=+\-@]/.test(value)?`'${value}`:value;
    const safe=rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,cell(value)])));
    return XLSX.utils.json_to_sheet(safe.length?safe:[{Registros:'Sem registros'}]);
  },

  workbook(project,rdos,financialByRdo,fileIndex){
    const stats=Biz.projectStats(project);
    const purchases=this.records('purchases').slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
    const originLabel=item=>({labor:'Mão de obra',paidAccount:'Conta paga',omiePayable:'Omie · conta a pagar',omieRemessa:'Omie · remessa',rdoLabor:'Mão de obra (RDO)',purchase:'Compra'}[item.sourceType]||item.sourceType||'Compra');
    const wb=XLSX.utils.book_new();
    const add=(name,rows)=>XLSX.utils.book_append_sheet(wb,this.sheet(rows),name);
    add('Resumo',[
      {Item:'Proposta',Valor:project.proposal||''},
      {Item:'Obra',Valor:project.name||''},
      {Item:'Cliente',Valor:project.client||''},
      {Item:'Tipo de contrato',Valor:project.type||''},
      {Item:'Status',Valor:project.status||''},
      {Item:'Início',Valor:project.start||''},
      {Item:'Encerramento real',Valor:project.realEnd||''},
      {Item:'Valor de venda',Valor:Number(project.saleValue)||0},
      {Item:'Orçado',Valor:stats.budgetTotal},
      {Item:'Compras e custos lançados',Valor:stats.spentPurchases},
      {Item:'Encargos da base de cálculo',Valor:stats.overhead},
      {Item:'Realizado (compras + encargos)',Valor:stats.spent},
      {Item:'Projetado (planejamento)',Valor:stats.projected},
      {Item:'Saldo',Valor:stats.balance},
      {Item:'Margem atual (%)',Valor:stats.marginCurrent!=null?Math.round(stats.marginCurrent*10)/10:''},
      {Item:'Total medido',Valor:stats.measured},
      {Item:'Faturado',Valor:stats.invoiced},
      {Item:'Aprovado (a faturar)',Valor:stats.approved},
      {Item:'Aguardando aprovação',Valor:stats.awaitingApproval},
      {Item:'Lançamentos',Valor:purchases.length},
      {Item:'RDOs',Valor:rdos.length},
      {Item:'Fotos e anexos',Valor:fileIndex.length},
      {Item:'Gerado em',Valor:new Date().toLocaleString('pt-BR')}
    ]);
    add('Lançamentos',purchases.map(item=>({
      Data:item.date||'',Categoria:item.category||'',Origem:originLabel(item),Fornecedor:item.supplier||'',Pedido:item.order||'',
      'NF':item.nfNumber||'',Descricao:item.desc||'',Observacoes:item.notes||'',Valor:Number(item.value)||0,
      'Valor bruto':item.grossValue!=null?Number(item.grossValue)||0:'','Devolvido':item.returnedValue!=null?Number(item.returnedValue)||0:'',
      'Status Omie':item.omieStatus||'','RDO':item.sourceRdoId?((rdos.find(rdo=>String(rdo.id)===String(item.sourceRdoId))||{}).number||item.sourceRdoId):'',
      'Arquivo de origem':item.file||'',ID:item.id
    })));
    add('Orçamento',this.records('budgets').map(item=>({Categoria:item.category||'',Valor:Number(item.value)||0,Arquivo:item.file||'',ID:item.id})));
    add('Planejamento',this.records('planning').map(item=>({Data:item.date||'',Categoria:item.category||'',Descricao:item.desc||'',
      'Valor atual':Number(item.value)||0,'Valor original':item.originalValue!==''&&item.originalValue!=null?Number(item.originalValue)||0:'',
      Consumido:Number(item.realizedAmount)||0,Situacao:item.consumptionStatus||'',Observacoes:item.notes||'',ID:item.id})));
    add('Hist. planejamento',this.records('planning_history').slice().sort((a,b)=>String(a.occurredAt||'').localeCompare(String(b.occurredAt||''))).map(item=>({
      Quando:item.occurredAt||'',Acao:item.action||'',Categoria:item.category||'',Descricao:item.description||'',Valor:Number(item.amount)||0,
      Antes:item.beforeValue!=null?Number(item.beforeValue):'',Depois:item.afterValue!=null?Number(item.afterValue):'',Origem:item.source||'',Referencia:item.sourceId||'',ID:item.id})));
    add('Medições',this.records('measurements').slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).map(item=>({
      Data:item.date||'',Referencia:item.ref||'',Status:item.status||'',Valor:Number(item.value)||0,'Mão de obra':item.laborValue!=null?Number(item.laborValue)||0:'',
      Horas:item.hours!=null?Number(item.hours)||0:'',De:item.periodFrom||'',Ate:item.periodTo||'',Origem:item.source==='rdo-hh'?'RDOs (HH)':'Manual',
      RDOs:(item.rdoIds||[]).map(id=>(rdos.find(rdo=>String(rdo.id)===String(id))||{}).number||id).join(', '),Observacoes:item.notes||'',ID:item.id})));
    add('Recebimentos',this.records('measurement_receipts').map(item=>({Data:item.date||'',Documento:item.documentNumber||'',Cliente:item.customerName||'',
      Valor:Number(item.value)||0,Pendente:item.pendingAmount!=null?Number(item.pendingAmount)||0:'',Status:item.omieStatus||'',Origem:item.origin||'',Medicao:item.measurementId||'',ID:item.id})));
    add('Previsões',this.records('forecasts').map(item=>({Medicao:item.measurementDate||'',Faturamento:item.billingDate||'',Recebimento:item.receiptDate||'',
      Valor:Number(item.value)||0,Prazo:item.paymentTermDays||'',Observacoes:item.notes||'',ID:item.id})));
    add('RDOs',rdos.map(rdo=>{
      const financial=financialByRdo.get(String(rdo.id))||{};
      const entries=RDO.visibleEntries(rdo);
      return {Numero:rdo.number||'',Documento:RDO.documentNumber(rdo),Data:rdo.date||'',Status:rdo.status||'',Local:rdo.location||'',
        Servico:rdo.description||'',Ocorrencias:rdo.notes||'',Pessoas:entries.length,
        Horas:entries.reduce((sum,row)=>sum+(Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0),0),
        Custo:Number(financial.costTotal)||0,Venda:Number(financial.saleTotal)||0,
        'Aprovado em':rdo.approvedAt||financial.approvedAt||'','Aprovado por':rdo.approvedBy||financial.approvedBy||'',
        'Criado por':rdo.createdBy||'',Fotos:fileIndex.filter(item=>item.rdo===(rdo.number||RDO.documentNumber(rdo))).length,ID:rdo.id};
    }));
    const hours=[];
    rdos.forEach(rdo=>{
      const financial=financialByRdo.get(String(rdo.id))||{};
      (rdo.entries||[]).forEach(entry=>{
        const row=(financial.rows||[]).find(item=>String(item.employeeId)===String(entry.employeeId))||{};
        const absent=typeof RDO.isAbsent==='function'&&RDO.isAbsent(entry);
        hours.push({RDO:rdo.number||RDO.documentNumber(rdo),Data:rdo.date||'',Matricula:entry.employeeRegistration||row.employeeRegistration||'',
          Colaborador:entry.employeeName||row.employeeName||'',Situacao:absent?'Falta':'Presente',
          'Função interna':row.internalRole||entry.internalRole||'','Função vendida':row.commercialRole||entry.commercialRole||'',
          Entrada:entry.start||'',Saida:entry.end||'',Intervalo:entry.breakMinutes!=null?Number(entry.breakMinutes)||0:'',
          Normal:Number(entry.regular)||0,'HE 50%':Number(entry.overtime50)||0,'HE 100%':Number(entry.overtime100)||0,
          'Adic. noturno (h)':Number(entry.nightHours)||0,Custo:row.cost!=null?Number(row.cost)||0:'',Venda:row.sale!=null?Number(row.sale)||0:''});
      });
    });
    add('Horas RDO',hours);
    add('Fotos e anexos',fileIndex.map(item=>({RDO:item.rdo,Data:item.date,'Arquivo no ZIP':item.path,Descricao:item.description,'Nome original':item.originalName,Bytes:item.sizeBytes,'Enviado em':item.uploadedAt})));
    return XLSX.write(wb,{bookType:'xlsx',type:'array'});
  },

  async reportPdf(project,rdos,financialByRdo,attachments){
    const doc=await Pdf.create('portrait');
    const T=value=>Pdf.text(value);
    const page={w:210,h:297,m:12};
    const left=page.m, right=page.w-page.m, width=right-left;
    const ink=[11,31,58], muted=[102,112,133], line=[223,228,234], soft=[245,247,250];
    const stats=Biz.projectStats(project);
    const categories=Biz.categoryStats([project]);
    const money=value=>T(this.money(Number(value)||0));
    const font=(size,style='normal',color=ink)=>{ doc.setFont('helvetica',style); doc.setFontSize(size); doc.setTextColor(...color); };
    const logoSrc=U.safeImageSrc(State.settings.companyLogo)||'assets/logo-clique.png';
    const logo=await Pdf.imageData(logoSrc,{maxSide:300,quality:.9});
    let y=page.m;
    if(logo) Pdf.drawContain(doc,logo,left,y,12,12);
    font(12.5,'bold'); doc.text(T(State.settings.companyName||'CliqueObras'),left+15,y+5);
    font(6.5,'normal',muted); doc.text('RELATÓRIO DE ENCERRAMENTO E ARQUIVO DA OBRA',left+15,y+9.5);
    font(6.5,'normal',muted); doc.text(T(`Gerado em ${new Date().toLocaleString('pt-BR')}`),right,y+3,{align:'right'});
    y+=15;
    doc.setDrawColor(...ink); doc.setLineWidth(.6); doc.line(left,y,right,y); y+=6;
    font(14,'bold'); const title=doc.splitTextToSize(T(U.projLabel(project)),width); doc.text(title,left,y+4); y+=title.length*6+2;
    font(8,'normal',muted);
    doc.text(T(`Cliente: ${project.client||'—'} · Contrato: ${project.type||'—'} · Status: ${project.status||'—'}`),left,y); y+=4.5;
    doc.text(T(`Início: ${project.start?U.date(project.start):'—'} · Prazo: ${project.deadline?U.date(project.deadline):'—'} · Encerramento: ${project.realEnd?U.date(project.realEnd):'—'}`),left,y); y+=7;

    const kpis=[
      ['Venda',money(project.saleValue)],['Orçado',money(stats.budgetTotal)],['Realizado',money(stats.spent)],['Saldo',money(stats.balance)],
      ['Margem atual',T(U.pct(stats.marginCurrent))],['Medido',money(stats.measured)],['Faturado',money(stats.invoiced)],['Aguardando aprovação',money(stats.awaitingApproval)],
      ['Lançamentos',String(this.records('purchases').length)],['RDOs',String(rdos.length)],
      ['Horas apontadas',T(`${rdos.reduce((sum,rdo)=>sum+RDO.visibleEntries(rdo).reduce((s,row)=>s+(Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0),0),0).toLocaleString('pt-BR',{maximumFractionDigits:2})}h`)],
      ['Fotos e anexos',String(attachments.length)]
    ];
    const boxW=(width-3*2.2)/4, boxH=12;
    kpis.forEach(([label,value],index)=>{
      const col=index%4, row=Math.floor(index/4);
      const x=left+col*(boxW+2.2), by=y+row*(boxH+2.2);
      doc.setDrawColor(...line); doc.setLineWidth(.25); doc.roundedRect(x,by,boxW,boxH,1.8,1.8,'S');
      font(6,'normal',muted); doc.text(T(label),x+2.5,by+4);
      font(9,'bold'); doc.text(value,x+2.5,by+9.2);
    });
    y+=Math.ceil(kpis.length/4)*(boxH+2.2)+4;
    font(6.5,'normal',muted);
    doc.text(doc.splitTextToSize(T(`Realizado = compras e custos lançados (${this.money(stats.spentPurchases)}) + encargos da base de cálculo (${this.money(stats.overhead)}). Saldo = orçado - realizado - projetado.`),width),left,y);
    y+=8;

    const table=(titleText,head,body,columnStyles={})=>{
      if(y>page.h-40){ doc.addPage(); y=page.m; }
      font(10,'bold'); doc.text(T(titleText),left,y+3.5); y+=6;
      Pdf.table(doc,{
        startY:y,margin:{left,right:page.m,top:page.m,bottom:page.m+6},
        head:[head.map(T)],body:body.length?body.map(row=>row.map(cell=>typeof cell==='string'?T(cell):cell)):[[{content:'Sem registros.',colSpan:head.length}]],
        theme:'grid',tableWidth:width,columnStyles,
        styles:{font:'helvetica',fontSize:6.6,cellPadding:1.4,textColor:ink,lineColor:line,lineWidth:.2,overflow:'linebreak'},
        headStyles:{fillColor:soft,textColor:[71,84,103],fontSize:6,fontStyle:'bold'}
      });
      y=(doc.lastAutoTable&&doc.lastAutoTable.finalY?doc.lastAutoTable.finalY:y)+7;
    };
    const num={halign:'right'};
    table('Categorias',['Categoria','Orçado','Realizado','Projetado','Saldo'],
      categories.filter(item=>item.budget||item.spent||item.projected).map(item=>[item.name,money(item.budget),money(item.spent),money(item.projected),money(item.balance)]),
      {1:num,2:num,3:num,4:num});
    table('Medições',['Data','Referência','Período','Origem','Status','Valor'],
      this.records('measurements').slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).map(item=>[
        U.date(item.date),item.ref||'',item.periodFrom?`${U.date(item.periodFrom)} a ${U.date(item.periodTo)}`:'',item.source==='rdo-hh'?`RDOs (${(item.rdoIds||[]).length})`:'Manual',item.status||'',money(item.value)]),
      {5:num});
    table('RDOs',['Data','Número','Pessoas','Horas','Custo','Venda','Anexos'],
      rdos.map(rdo=>{
        const financial=financialByRdo.get(String(rdo.id))||{};
        const entries=RDO.visibleEntries(rdo);
        return [U.date(rdo.date),rdo.number||RDO.documentNumber(rdo),String(entries.length),
          `${entries.reduce((s,row)=>s+(Number(row.regular)||0)+(Number(row.overtime50)||0)+(Number(row.overtime100)||0),0).toLocaleString('pt-BR',{maximumFractionDigits:2})}h`,
          money(financial.costTotal),money(financial.saleTotal),String(attachments.filter(item=>String(item.rdoId)===String(rdo.id)).length)];
      }),{2:num,3:num,4:num,5:num,6:num});
    const purchases=this.records('purchases').slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
    table(`Lançamentos (${purchases.length})`,['Data','Categoria','Fornecedor','Descrição','Valor'],
      purchases.map(item=>[U.date(item.date),item.category||'',item.supplier||'',item.desc||'',money(item.value)]),
      {0:{cellWidth:17},1:{cellWidth:30},2:{cellWidth:38},4:{halign:'right',cellWidth:24}});

    const pages=doc.getNumberOfPages();
    for(let number=1;number<=pages;number++){
      doc.setPage(number);
      doc.setDrawColor(...line); doc.setLineWidth(.2); doc.line(left,page.h-page.m-3.5,right,page.h-page.m-3.5);
      font(5.8,'normal',muted);
      doc.text(T(`${U.projLabel(project)} · arquivo da obra`),left,page.h-page.m);
      doc.text(`Página ${number} de ${pages}`,right,page.h-page.m,{align:'right'});
    }
    doc.setProperties({title:T(`Arquivo da obra ${U.projLabel(project)}`)});
    return doc.output('blob');
  }
};
