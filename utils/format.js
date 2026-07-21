/**
 * Utilitários de Formatação (format.js)
 *
 * Responsabilidades:
 * - formatação de moeda, percentual e datas (pt-BR)
 * - parsing de números BR/US e datas (Excel serial, dd/mm/aaaa, ISO)
 * - normalização e escape de strings
 *
 * Dependências:
 * - database (State.settings.currency em U.money)
 *
 * Não modificar:
 * - regras de parsing sem revisar importações e exportações
 */

const U = {
  money(v){ const cur = State.settings.currency || 'BRL'; return new Intl.NumberFormat('pt-BR',{style:'currency',currency:cur,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)||0); },

  money2(v){ return this.money(v); },

  pct(v,d=1){ return (v==null||!isFinite(v)) ? '—' : v.toFixed(d).replace('.',',')+'%'; },

  date(d){ if(!d) return '—'; const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('pt-BR'); },

  isoDate(d){ const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? '' : x.toISOString().slice(0,10); },

  monthKey(d){ const x = new Date(d); return isNaN(x)?'':`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`; },

  norm: s => String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(),

  esc: s => String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])),

  num(v){ // interpreta número em formatos BR/US
    if(typeof v === 'number') return v;
    if(v==null || v==='') return 0;
    let s = String(v).replace(/[R$\s]/g,'');
    if(/,\d{1,2}$/.test(s)) s = s.replace(/\./g,'').replace(',','.');
    else s = s.replace(/,/g,'');
    const n = parseFloat(s); return isNaN(n) ? 0 : n;
  },

  parseDate(v){ // aceita Date, serial Excel, dd/mm/aaaa, ISO
    if(v instanceof Date && !isNaN(v)) return v;
    if(typeof v === 'number' && v > 20000 && v < 60000){ const d = new Date(Math.round((v - 25569) * 86400000)); return isNaN(d)?null:d; }
    if(typeof v === 'string'){
      const m = v.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      if(m){ let y = +m[3]; if(y<100) y+=2000; const d = new Date(y, +m[2]-1, +m[1]); return isNaN(d)?null:d; }
      const d = new Date(v); return isNaN(d)?null:d;
    }
    return null;
  },

  daysBetween(a,b){ return Math.round((new Date(b) - new Date(a)) / 86400000); },

  projLabel(p){ return p ? `${p.proposal} — ${p.name||''}`.replace(/ — $/,'') : '—'; },

  initials: s => String(s||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()
};
