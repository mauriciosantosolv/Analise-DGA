(function(){
  'use strict';

  const aliases=Object.freeze({
    'alarm-clock':'alarm','alert-triangle':'triangle-warning','arrow-left':'arrow-left-md',
    'badge-check':'circle-check','badge-dollar-sign':'credit-card-02','banknote':'credit-card-01',
    'briefcase':'suitcase','briefcase-business':'suitcase','building-2':'building-02','cable':'link-horizontal',
    'calculator':'data','calendar-check':'calendar-check','calendar-clock':'calendar-event',
    'calendar-days':'calendar-days','calendar-minus':'calendar-remove','calendar-x':'calendar-close',
    'camera':'camera','car':'car-auto','check':'check','check-circle':'circle-check',
    'check-circle-2':'circle-check','chevron-left':'chevron-left','chevron-right':'chevron-right',
    'circle-user-round':'user-circle','clipboard-check':'list-checklist','clipboard-x':'list-remove',
    'clock':'clock','clock-3':'clock','cloud':'cloud','cloud-upload':'cloud-upload','coffee':'coffee',
    'coins':'credit-card-01','database-backup':'cylinder','dollar-sign':'credit-card-02',
    'download':'download','eye':'show','eye-off':'hide','file-bar-chart':'chart-bar-vertical-01',
    'file-check-2':'file-check','file-clock':'note','file-down':'file-download','file-image':'image-01',
    'file-json':'file-code','file-spreadsheet':'table','file-text':'file-document','filter':'filter',
    'filter-x':'filter-off','flame':'bulb','folder-open':'folder-open','fuel':'water-drop',
    'gauge':'chart-pie','git-compare':'arrow-left-right','hard-hat':'building-03','history':'arrows-reload-01',
    'home':'house-01','image':'image-01','image-off':'image-02','image-plus':'image-02','info':'info',
    'key-round':'lock','layers':'layers','layout-dashboard':'more-grid-big','list':'list-unordered',
    'loader-circle':'loading','log-in':'exit','log-out':'log-out','mail':'mail','mail-check':'mail',
    'menu':'hamburger-md','message-square-check':'chat-check','message-square-warning':'chat-dots',
    'message-square-x':'chat-close','moon':'moon','package':'download-package',
    'paperclip':'paperclip-attechment-horizontal','pencil':'edit-pencil-01','percent':'chart-pie',
    'phone':'phone','piggy-bank':'handbag','plane':'paper-plane','plus':'add-plus','printer':'printer',
    'receipt':'ticket-voucher','refresh-cw':'arrows-reload-01','ruler':'ruler','save':'save',
    'search':'search-magnifying-glass','send':'paper-plane','settings':'settings','shield':'shield',
    'shield-check':'shield-check','shirt':'user-card-id','shopping-cart':'shopping-cart-01',
    'siren':'alarm','sliders-horizontal':'slider-02','smartphone':'mobile','sun':'sun','tag':'tag',
    'tags':'tag','trash-2':'trash-empty','trending-down':'trending-down','trending-up':'trending-up',
    'triangle-alert':'triangle-warning','truck':'car-auto','undo-2':'undo','upload':'file-upload',
    'user':'user-01','user-minus':'user-remove','user-plus':'user-add','user-x':'user-close',
    'users':'users','utensils':'coffee','wallet':'handbag','wrench':'settings','x':'close-md',
    'x-circle':'close-circle','zap':'bulb'
  });

  const fallback='dummy-square-small';
  const asset=name=>`assets/coolicons/icons/${aliases[name]||fallback}.svg`;

  function createIcons(root=document){
    const nodes=root.querySelectorAll?root.querySelectorAll('[data-lucide]'):[];
    nodes.forEach(node=>{
      const name=String(node.getAttribute('data-lucide')||'').trim();
      node.classList.add('coolicon');
      node.setAttribute('aria-hidden','true');
      node.style.setProperty('--coolicon-url',`url("${asset(name)}")`);
    });
  }

  window.CoolIcons={aliases,createIcons};
  window.lucide={createIcons};
})();
