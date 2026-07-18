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

  icons(){ const raf = (typeof requestAnimationFrame==='function') ? requestAnimationFrame : (f)=>setTimeout(f,16); raf(()=>{ try{ lucide.createIcons(); }catch(e){} }); },

  download(name, content, mime='application/octet-stream'){
    const blob = content instanceof Blob ? content : new Blob([content],{type:mime});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  },

  // Reduz imagens (logos) para no máx. 256px — evita data URLs gigantes no banco,
  // que deixam o carregamento lento ou travam o navegador
  resizeImage(dataUrl, max=256){
    return new Promise(res => {
      const t = setTimeout(() => res(dataUrl), 3000); // nunca trava o carregamento
      const done = v => { clearTimeout(t); res(v); };
      try{
        const img = new Image();
        img.onload = () => {
          try{
            const sc = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
            if(sc >= 1 && dataUrl.length < 200000) return res(dataUrl);
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round((img.width||max) * sc));
            cv.height = Math.max(1, Math.round((img.height||max) * sc));
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            const out = cv.toDataURL('image/png');
            done(out && out.length > 30 ? out : dataUrl);
          }catch(e){ done(dataUrl); }
        };
        img.onerror = () => done(dataUrl);
        img.src = dataUrl;
      }catch(e){ done(dataUrl); }
    });
  }
});

/* ===== UI: toasts, modais, confirmação, loading ===== */
const UI = {
  toast(msg, type='info', ms=3800){
    const icons = {info:'info', success:'check-circle', error:'x-circle', warn:'alert-triangle'};
    const colors = {info:'var(--blue)', success:'var(--green)', error:'var(--red)', warn:'var(--amber)'};
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i data-lucide="${icons[type]}" style="color:${colors[type]}"></i><div>${msg}</div>`;
    document.getElementById('toasts').appendChild(el);
    U.icons();
    setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(), 260); }, ms);
  },
  modal({title, body, footer, wide=false, onOpen}){
    const ov = document.getElementById('modal-overlay'), m = document.getElementById('modal');
    m.className = 'modal' + (wide ? ' wide' : '');
    m.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="icon-btn" onclick="UI.close()"><i data-lucide="x"></i></button></div>
      <div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}`;
    ov.classList.add('open');
    U.icons();
    if(onOpen) onOpen(m);
  },
  close(){ document.getElementById('modal-overlay').classList.remove('open'); },
  confirm(msg, onYes, danger=true){
    this.modal({
      title:'Confirmação',
      body:`<p style="font-size:.95rem;line-height:1.6">${msg}</p>`,
      footer:`<button class="btn btn-ghost" onclick="UI.close()">Cancelar</button>
              <button class="btn ${danger?'btn-danger':'btn-primary'}" id="confirm-yes">Confirmar</button>`
    });
    document.getElementById('confirm-yes').onclick = () => { UI.close(); onYes(); };
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

function statusTag(st){ const m = {'Em andamento':'tag-blue','Concluído':'tag-green','Paralisado':'tag-amber','A executar':'tag-gray'}; return `<span class="tag ${m[st]||'tag-gray'}">${st||'—'}</span>`; }

function lightDot(l){ return `<span class="dot dot-${l}" title="${{green:'Saudável',amber:'Atenção',red:'Crítico'}[l]}"></span>`; }

function clientAvatar(name){
  const c = State.clients.find(x=>x.name===name);
  if(c && c.logo) return `<img class="avatar" src="${c.logo}" alt="">`;
  return `<span class="avatar-ph">${U.initials(name)}</span>`;
}

/* Clique fora do modal (ou Esc) NÃO fecha — evita perda de dados em formulários.
   O fechamento ocorre apenas pelos botões Fechar/Cancelar/Salvar. */
document.addEventListener('keydown', e => {
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); document.getElementById('global-search').focus(); }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='d'){ e.preventDefault(); App.toggleTheme(); }
});
