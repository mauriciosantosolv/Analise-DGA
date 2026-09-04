/**
 * Utilitários Gerais (helpers.js)
 *
 * Responsabilidades:
 * - funções reutilizáveis: id, debounce, download, resizeImage, ícones
 * - UI: toasts, modais, confirmação, loading
 * - helpers de interface das telas (searchBox, statusTag, avatar)
 * - atalhos de teclado globais (Ctrl+K busca, Ctrl+D tema)
 *
 * Dependências:
 * - utils/format.js (objeto U é estendido aqui)
 *
 * Não modificar:
 * - IDs de elementos usados (#toasts, #modal, #loading)
 */

Object.assign(U, {
  id: () => Date.now().toString(36) + Math.random().toString(36).slice(2,9),

  debounce(fn,ms=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; },

  formatCnpj(value){
    const digits=String(value||'').replace(/\D/g,'').slice(0,14);
    return digits
      .replace(/^(\d{2})(\d)/,'$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/,'$1.$2.$3')
      .replace(/\.(\d{3})(\d)/,'.$1/$2')
      .replace(/(\d{4})(\d)/,'$1-$2');
  },

  validCnpj(value){
    const digits=String(value||'').replace(/\D/g,'');
    if(digits.length!==14||/^(\d)\1{13}$/.test(digits)) return false;
    const digit=base=>{
      let factor=base.length-7, total=0;
      for(const char of base){ total+=Number(char)*factor--; if(factor<2) factor=9; }
      const remainder=total%11;
      return remainder<2?0:11-remainder;
    };
    const first=digit(digits.slice(0,12));
    const second=digit(digits.slice(0,12)+first);
    return digits.endsWith(`${first}${second}`);
  },

  icons(){ const raf = (typeof requestAnimationFrame==='function') ? requestAnimationFrame : (f)=>setTimeout(f,16); raf(()=>{ try{ lucide.createIcons(); }catch(e){} }); },

  // Valores inseridos em atributos HTML e handlers inline precisam de
  // codificações diferentes. JSON.stringify protege o contexto JavaScript;
  // U.esc impede que o atributo HTML seja encerrado antes da execução.
  jsArg(value){ return U.esc(JSON.stringify(String(value??''))); },

  safeImageSrc(value){
    const src=String(value||'').trim();
    if(/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\r\n]+$/i.test(src)) return src;
    if(/^assets\/[a-z0-9_./-]+\.(?:png|jpe?g|webp|svg)$/i.test(src) && !src.includes('..')) return src;
    return '';
  },

  safeColor(value, fallback='#2563EB'){
    const color=String(value||'').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  },

  download(name, content, mime='application/octet-stream'){
    const blob = content instanceof Blob ? content : new Blob([content],{type:mime});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  },

  // Reduz imagens (logos) para no máx. 256px — evita data URLs gigantes no banco,
  // que deixam o carregamento lento ou travam o navegador
  resizeImage(dataUrl, max=256, outputType='image/png', quality=.9){
    return new Promise((res,rej) => {
      if(!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(String(dataUrl||'')))
        return rej(new Error('Formato de imagem não permitido. Use PNG, JPEG ou WebP.'));
      if(String(dataUrl).length>7000000)
        return rej(new Error('A imagem excede o limite de 5 MB.'));
      let settled=false;
      const done = v => {
        if(settled) return;
        settled=true;
        clearTimeout(t);
        if(v) res(v); else rej(new Error('Não foi possível processar a imagem.'));
      };
      const t = setTimeout(() => done(''), 5000);
      try{
        const img = new Image();
        img.onload = () => {
          try{
            const sc = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round((img.width||max) * sc));
            cv.height = Math.max(1, Math.round((img.height||max) * sc));
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            const safeType=['image/png','image/jpeg','image/webp'].includes(outputType)?outputType:'image/png';
            const out = cv.toDataURL(safeType,Math.max(.55,Math.min(.96,Number(quality)||.9)));
            done(out && out.length > 30 ? out : '');
          }catch(e){ done(''); }
        };
        img.onerror = () => done('');
        img.src = dataUrl;
      }catch(e){ done(''); }
    });
  },

  /* v4.2.19 - decodifica um File/Blob de imagem sem passar por base64.
     Usa <img> + object URL de proposito: e o mesmo caminho que o navegador
     usa para desenhar a foto na tela, entao a orientacao EXIF da camera do
     celular ja vem aplicada (foto em pe continua em pe). Devolve null em
     qualquer falha - quem chama decide o que fazer. */
  decodeImageFile(file, timeoutMs=8000){
    return new Promise(resolve => {
      let url='';
      let settled=false;
      const finish = value => {
        if(settled) return;
        settled=true;
        clearTimeout(timer);
        if(url){ try{ URL.revokeObjectURL(url); }catch(e){} }
        resolve(value||null);
      };
      const timer=setTimeout(()=>finish(null), Math.max(1000, Number(timeoutMs)||8000));
      try{
        url=URL.createObjectURL(file);
        const img=new Image();
        img.onload=()=>finish(img);
        img.onerror=()=>finish(null);
        img.src=url;
      }catch(e){ finish(null); }
    });
  },

  /* v4.2.19 - reduz uma foto antes de subir para a nuvem.
     Tres regras de seguranca, nessa ordem:
     1. arquivo que nao for JPG/PNG/WebP (PDF, por exemplo) passa INTACTO;
     2. qualquer falha, timeout ou navegador sem suporte devolve o arquivo
        ORIGINAL - comprimir nunca pode impedir o salvamento;
     3. o resultado so e aceito se for pelo menos 10% menor que o original,
        para nao reprocessar foto que ja veio pequena. */
  async compressImageFile(file, options){
    const opts=options||{};
    const maxSide=Math.max(320, Number(opts.maxSide)||1280);
    const quality=Math.max(.5, Math.min(.95, Number(opts.quality)||.75));
    const keepRatio=Math.max(.5, Math.min(1, Number(opts.minGain)||.9));
    if(!file || typeof document==='undefined') return file;
    if(!/^image\/(?:jpeg|png|webp)$/i.test(String(file.type||''))) return file;
    if(typeof HTMLCanvasElement==='undefined'
      || typeof HTMLCanvasElement.prototype.toBlob!=='function') return file;
    try{
      const img=await U.decodeImageFile(file);
      const width=(img&&(img.naturalWidth||img.width))||0;
      const height=(img&&(img.naturalHeight||img.height))||0;
      if(!width||!height) return file;
      const scale=Math.min(1, maxSide/Math.max(width,height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(width*scale));
      canvas.height=Math.max(1,Math.round(height*scale));
      const ctx=canvas.getContext('2d');
      if(!ctx) return file;
      try{ ctx.imageSmoothingQuality='high'; }catch(e){}
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve => {
        let done=false;
        const finish=value=>{ if(!done){ done=true; clearTimeout(timer); resolve(value||null); } };
        const timer=setTimeout(()=>finish(null),10000);
        try{ canvas.toBlob(result=>finish(result),'image/jpeg',quality); }
        catch(e){ finish(null); }
      });
      if(!blob || !blob.size || blob.size>=Number(file.size||0)*keepRatio) return file;
      const name=String(file.name||'foto').replace(/\.[a-z0-9]+$/i,'')+'.jpg';
      if(typeof File==='function'){
        try{ return new File([blob],name,{type:'image/jpeg',lastModified:Date.now()}); }catch(e){}
      }
      try{ blob.name=name; }catch(e){}
      return blob;
    }catch(e){ return file; }
  }
});

/* ===== UI: toasts, modais, confirmação, loading ===== */
const UI = {
  modalStack:[],
  plainText(value){
    const entities={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"};
    return String(value??'').replace(/&(amp|lt|gt|quot|#39);/g,match=>entities[match]||match);
  },
  toast(msg, type='info', ms=3800){
    const icons = {info:'info', success:'check-circle', error:'x-circle', warn:'alert-triangle'};
    const colors = {info:'var(--blue)', success:'var(--green)', error:'var(--red)', warn:'var(--amber)'};
    const safeType=Object.prototype.hasOwnProperty.call(icons,type)?type:'info';
    const el = document.createElement('div');
    const icon=document.createElement('i');
    const message=document.createElement('div');
    el.className = `toast ${safeType}`;
    icon.dataset.lucide=icons[safeType];
    icon.style.color=colors[safeType];
    message.textContent=this.plainText(msg);
    el.append(icon,message);
    document.getElementById('toasts').appendChild(el);
    U.icons();
    setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(), 260); }, ms);
  },
  modal({title, body, footer, wide=false, onOpen, replace=false}){
    const ov = document.getElementById('modal-overlay'), m = document.getElementById('modal');
    if(ov.classList.contains('open') && !replace){
      const fragment=document.createDocumentFragment();
      while(m.firstChild) fragment.appendChild(m.firstChild);
      this.modalStack.push({className:m.className, fragment});
    }
    m.className = 'modal' + (wide ? ' wide' : '');
    m.innerHTML = `<div class="modal-head"><h2></h2><button class="icon-btn" onclick="UI.close()"><i data-lucide="x"></i></button></div>
      <div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}`;
    m.querySelector('.modal-head h2').textContent=this.plainText(title);
    ov.classList.add('open');
    U.icons();
    if(onOpen) onOpen(m);
  },
  close(){
    const ov=document.getElementById('modal-overlay'), m=document.getElementById('modal');
    const previous=this.modalStack.pop();
    if(previous){
      m.className=previous.className;
      m.innerHTML='';
      m.appendChild(previous.fragment);
      ov.classList.add('open');
      U.icons();
    }else{
      ov.classList.remove('open');
      m.innerHTML='';
    }
  },
  closeAll(){
    this.modalStack=[];
    const ov=document.getElementById('modal-overlay'), m=document.getElementById('modal');
    ov.classList.remove('open'); m.innerHTML='';
  },
  isModalOpen(){ return document.getElementById('modal-overlay').classList.contains('open'); },
  confirm(msg, onYes, danger=true){
    this.modal({
      title:'Confirmação',
      body:`<p style="font-size:.95rem;line-height:1.6">${msg}</p>`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
              <button class="btn ${danger?'btn-danger':'btn-primary'}" id="confirm-yes">Confirmar</button>`
    });
    document.getElementById('confirm-yes').onclick = () => { UI.closeAll(); onYes(); };
  },
  loading(on, msg='Processando…'){
    document.getElementById('loading-msg').textContent = msg;
    document.getElementById('loading').classList.toggle('open', !!on);
  }
};

const $c = () => document.getElementById('content');

/* ---------- helpers de tabela ---------- */
function searchBox(id, ph){ return `<div style="position:relative;flex:1;max-width:340px"><input id="${id}" placeholder="${ph}" style="padding-left:12px"></div>`; }

function bindSearch(id, fn){ const el = document.getElementById(id); if(el) el.oninput = U.debounce(()=>fn(el.value), 180); }

function statusTag(st){ const m = {'Em andamento':'tag-blue','Concluído':'tag-green','Paralisado':'tag-amber','A executar':'tag-gray'}; return `<span class="tag ${m[st]||'tag-gray'}">${U.esc(st||'—')}</span>`; }

function lightDot(l){ return `<span class="dot dot-${l}" title="${{green:'Saudável',amber:'Atenção',red:'Crítico'}[l]}"></span>`; }

function clientAvatar(name){
  const c = State.clients.find(x=>x.name===name);
  const logo=c && U.safeImageSrc(c.logo);
  if(logo) return `<img class="avatar" src="${U.esc(logo)}" alt="">`;
  return `<span class="avatar-ph">${U.esc(U.initials(name))}</span>`;
}

/* Clique fora do modal (ou Esc) NÃO fecha — evita perda de dados em formulários.
   O fechamento ocorre apenas pelos botões Fechar/Cancelar/Salvar. */
document.addEventListener('keydown', e => {
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); document.getElementById('global-search').focus(); }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='d'){ e.preventDefault(); App.toggleTheme(); }
});
