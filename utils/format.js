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

  // Datas sem horário são sempre tratadas no calendário local. O construtor
  // new Date('AAAA-MM-DD') interpreta a string como UTC e, no fuso do Brasil,
  // exibe o dia anterior.
  date(d){ if(!d) return '—'; const x = this.parseDate(d); return !x ? '—' : x.toLocaleDateString('pt-BR'); },

  isoDate(d){
    if(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim()))
      return this.parseDate(d) ? d.trim() : '';
    const x = this.parseDate(d);
    return !x ? '' : `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  },

  monthKey(d){ const iso = this.isoDate(d); return iso ? iso.slice(0,7) : ''; },

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
    if(v instanceof Date && !isNaN(v)) return new Date(v.getTime());
    if(typeof v === 'number'){
      if(v > 20000 && v < 60000){
        const d = new Date(1899, 11, 30);
        d.setDate(d.getDate() + Math.floor(v));
        return isNaN(d) ? null : d;
      }
      const d = new Date(v);
      return isNaN(d) ? null : d;
    }
    if(typeof v === 'string'){
      const iso = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if(iso){
        const d = new Date(+iso[1], +iso[2]-1, +iso[3]);
        return d.getFullYear()===+iso[1] && d.getMonth()===+iso[2]-1 && d.getDate()===+iso[3] ? d : null;
      }
      const m = v.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      if(m){
        let y = +m[3]; if(y<100) y+=2000;
        const d = new Date(y, +m[2]-1, +m[1]);
        return d.getFullYear()===y && d.getMonth()===+m[2]-1 && d.getDate()===+m[1] ? d : null;
      }
      const d = new Date(v); return isNaN(d)?null:d;
    }
    return null;
  },

  daysBetween(a,b){
    const x = this.parseDate(a), y = this.parseDate(b);
    if(!x || !y) return NaN;
    const ux = Date.UTC(x.getFullYear(),x.getMonth(),x.getDate());
    const uy = Date.UTC(y.getFullYear(),y.getMonth(),y.getDate());
    return Math.round((uy-ux)/86400000);
  },

  projLabel(p){ return p ? `${p.proposal} — ${p.name||''}`.replace(/ — $/,'') : '—'; },

  initials: s => String(s||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()
};
