/**
 * v4.5.17 - PDF gerado como ARQUIVO no próprio aparelho.
 *
 * Por que existe: o PDF do RDO dependia de window.print(). No iPhone, com o
 * CliqueObras aberto pela tela inicial (app instalado), a janela de impressão
 * não abre: aparecia só o aviso "Na janela de impressão, selecione Salvar como
 * PDF" e nada acontecia. Aqui o PDF é montado com jsPDF e entregue como
 * arquivo (Compartilhar / Baixar), sem janela de impressão.
 *
 * As bibliotecas (jsPDF, AutoTable e fflate para o ZIP do arquivamento) são
 * carregadas só quando alguém gera um PDF/arquivo. Ficam em assets/vendor,
 * servidas pelo próprio site (a CSP só aceita scripts de 'self').
 */
const Pdf = {
  vendor:{
    jspdf:'assets/vendor/jspdf.umd.min.js?v=4.2.1',
    autotable:'assets/vendor/jspdf.plugin.autotable.min.js?v=5.0.9',
    fflate:'assets/vendor/fflate.min.js?v=0.8.3'
  },
  scripts:new Map(),

  loadScript(src){
    if(this.scripts.has(src)) return this.scripts.get(src);
    const promise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=src;
      script.async=false;
      script.onload=()=>resolve(true);
      script.onerror=()=>{
        this.scripts.delete(src);
        script.remove();
        reject(new Error('Não foi possível carregar o gerador de PDF. Verifique a conexão e tente de novo.'));
      };
      document.head.appendChild(script);
    });
    this.scripts.set(src,promise);
    return promise;
  },
  async ready(){
    await this.loadScript(this.vendor.jspdf);
    await this.loadScript(this.vendor.autotable);
    const ctor=window.jspdf&&window.jspdf.jsPDF;
    if(typeof ctor!=='function') throw new Error('O gerador de PDF não foi carregado.');
    return ctor;
  },
  async zipReady(){
    await this.loadScript(this.vendor.fflate);
    if(!window.fflate||typeof window.fflate.zipSync!=='function') throw new Error('O gerador de ZIP não foi carregado.');
    return window.fflate;
  },
  async create(orientation='portrait'){
    const JsPDF=await this.ready();
    const doc=new JsPDF({orientation,unit:'mm',format:'a4',compress:true});
    doc.setProperties({creator:'CliqueObras',producer:'CliqueObras'});
    return doc;
  },
  table(doc,options){
    if(typeof doc.autoTable==='function') return doc.autoTable(options);
    if(typeof window.autoTable==='function') return window.autoTable(doc,options);
    throw new Error('O gerador de tabelas do PDF não foi carregado.');
  },

  // As fontes padrão do PDF (Helvetica) cobrem o português (Latin-1), mas não
  // travessões, aspas curvas e outros símbolos tipográficos: viram "?" ou
  // somem. Troca por equivalentes simples antes de escrever.
  text(value){
    return String(value??'')
      .replace(/\r\n?/g,'\n')
      .replace(/[‒-―−]/g,'-')
      .replace(/[‘’‚′]/g,"'")
      .replace(/[“”„″]/g,'"')
      .replace(/…/g,'...')
      .replace(/[•‧∙]/g,'·')
      .replace(/[  -​  　]/g,' ')
      .replace(/[←-⇿]/g,'>')
      .replace(/[^\n -~ -ÿ]/g,'');
  },

  // Nome de arquivo seguro em qualquer sistema.
  fileName(value,fallback='documento'){
    const clean=String(value||'')
      .normalize('NFKD').replace(/[̀-ͯ]/g,'')
      .replace(/[^a-z0-9._ -]+/gi,' ')
      .replace(/\s+/g,' ')
      .replace(/-{2,}/g,'-')
      .replace(/ (?:- )+/g,' - ')
      .replace(/^[-. ]+|[-. ]+$/g,'')
      .slice(0,120);
    return clean||fallback;
  },

  // Celular/tablet (ou app instalado): entrega arquivo em vez de imprimir.
  preferFile(){
    try{
      const nav=typeof navigator!=='undefined'?navigator:{};
      const ua=String(nav.userAgent||'');
      const ios=/iPad|iPhone|iPod/.test(ua)||(nav.platform==='MacIntel'&&Number(nav.maxTouchPoints)>1);
      const android=/Android/i.test(ua);
      const standalone=nav.standalone===true
        ||(typeof window.matchMedia==='function'&&window.matchMedia('(display-mode: standalone)').matches);
      const coarseOnly=typeof window.matchMedia==='function'
        &&window.matchMedia('(pointer: coarse)').matches
        &&!window.matchMedia('(any-pointer: fine)').matches;
      return ios||android||standalone||coarseOnly||typeof window.print!=='function';
    }catch(err){ return false; }
  },

  loadImage(src){
    return new Promise((resolve,reject)=>{
      const image=new Image();
      image.decoding='async';
      image.onload=()=>resolve(image);
      image.onerror=()=>reject(new Error('Imagem indisponível.'));
      image.src=src;
    });
  },
  // Lê a imagem (blob:, data: ou assets/) e devolve JPEG reduzido. Com box
  // {width,height} recorta ao centro, como object-fit:cover do PDF impresso.
  async imageData(src,{maxSide=1400,quality=.8,cover=null}={}){
    if(!src) return null;
    try{
      const image=await this.loadImage(src);
      const naturalW=image.naturalWidth||image.width, naturalH=image.naturalHeight||image.height;
      if(!naturalW||!naturalH) return null;
      let sx=0, sy=0, sw=naturalW, sh=naturalH;
      if(cover&&cover.width>0&&cover.height>0){
        const target=cover.width/cover.height, actual=naturalW/naturalH;
        if(actual>target){ sw=naturalH*target; sx=(naturalW-sw)/2; }
        else{ sh=naturalW/target; sy=(naturalH-sh)/2; }
      }
      const scale=Math.min(1,maxSide/Math.max(sw,sh));
      const width=Math.max(1,Math.round(sw*scale)), height=Math.max(1,Math.round(sh*scale));
      const canvas=document.createElement('canvas');
      canvas.width=width; canvas.height=height;
      const context=canvas.getContext('2d');
      context.fillStyle='#ffffff';
      context.fillRect(0,0,width,height);
      context.drawImage(image,sx,sy,sw,sh,0,0,width,height);
      const data=canvas.toDataURL('image/jpeg',quality);
      canvas.width=canvas.height=0;
      return /^data:image\/jpeg;base64,/.test(data)?{data,width,height}:null;
    }catch(err){ return null; }
  },
  // Desenha a imagem dentro da caixa mantendo a proporção (object-fit:contain).
  drawContain(doc,image,x,y,w,h,align='center'){
    if(!image) return;
    const ratio=Math.min(w/image.width,h/image.height);
    const dw=image.width*ratio, dh=image.height*ratio;
    const dx=align==='left'?x:x+(w-dw)/2;
    const dy=align==='top'?y:y+(h-dh)/2;
    doc.addImage(image.data,'JPEG',dx,dy,dw,dh,undefined,'FAST');
  },

  async sha256(blob){
    const buffer=await blob.arrayBuffer();
    const digest=await crypto.subtle.digest('SHA-256',buffer);
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  },
  formatSize(bytes){
    const size=Number(bytes)||0;
    if(size<1024) return `${size} B`;
    if(size<1024*1024) return `${(size/1024).toLocaleString('pt-BR',{maximumFractionDigits:0})} KB`;
    return `${(size/1024/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB`;
  },

  // Entrega o arquivo. No celular abre uma janela com "Compartilhar/Salvar"
  // (folha de compartilhamento do sistema: Arquivos, WhatsApp, e-mail...) e
  // "Baixar". Os botões disparam a ação no toque do usuário: o iPhone recusa
  // compartilhar depois de uma espera longa sem toque.
  deliver(blob,fileName,{title='PDF pronto',direct=false}={}){
    const name=String(fileName||'documento.pdf');
    if(direct||!this.preferFile()){
      U.download(name,blob);
      return;
    }
    const type=blob.type||'application/pdf';
    const file=typeof File==='function'?new File([blob],name,{type}):null;
    const canShare=!!(file&&navigator.share&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]}));
    const url=URL.createObjectURL(blob);
    const kind=/\.pdf$/i.test(name)?'PDF':'arquivo';
    UI.modal({
      title,
      body:`<div class="pdf-ready">
        <i data-lucide="file-check-2"></i>
        <div><b>${U.esc(name)}</b><small>${U.esc(this.formatSize(blob.size))}</small></div>
      </div>
      <p class="pdf-ready-hint">${canShare
        ?'Toque em <b>Compartilhar / Salvar</b> e escolha <b>Salvar em Arquivos</b>, WhatsApp ou e-mail.'
        :`Toque em <b>Baixar ${kind}</b>. O arquivo vai para a pasta de downloads do aparelho.`}</p>`,
      footer:`<button class="btn btn-ghost" type="button" id="pdf-ready-close">Fechar</button>
        <a class="btn ${canShare?'btn-ghost':'btn-primary'}" id="pdf-ready-download" href="${U.esc(url)}" download="${U.esc(name)}"><i data-lucide="download"></i>Baixar ${kind}</a>
        ${canShare?'<button class="btn btn-primary" type="button" id="pdf-ready-share"><i data-lucide="share-2"></i>Compartilhar / Salvar</button>':''}`
    });
    let released=false;
    const release=()=>{ if(released) return; released=true; setTimeout(()=>URL.revokeObjectURL(url),60000); };
    const closeButton=document.getElementById('pdf-ready-close');
    if(closeButton) closeButton.onclick=()=>{ release(); UI.close(); };
    const shareButton=document.getElementById('pdf-ready-share');
    if(shareButton) shareButton.onclick=async()=>{
      try{
        await navigator.share({files:[file],title:name});
      }catch(err){
        if(err&&err.name==='AbortError') return;
        UI.toast(`Não foi possível abrir o compartilhamento. Use "Baixar ${kind}".`,'warn',6000);
      }
    };
  }
};
