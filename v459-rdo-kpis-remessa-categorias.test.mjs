// v4.5.9 — (1) a busca do RDO (ex.: projeto) passa a filtrar também os KPIs
// "Aguardando aprovação", "Aprovados" e "Horas registradas" e as contagens das
// pílulas; (2) aba "Categorias das remessas" no DE-PARA do Omie.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function renderRdos(query,status='Todos'){
  const source=read('modules/rdo/rdo.js');
  const start=source.indexOf('Views.rdos={');
  const end=source.indexOf('\n};\n',start)+4;
  assert.ok(start>0&&end>start,'Views.rdos não encontrado');
  const box={innerHTML:''};
  const projects=[{id:'p1',label:'798 | PROJETO AURORA'},{id:'p2',label:'911 | ADEQUACAO CAMINHAO'}];
  const entry=h=>({regular:h,overtime50:0,overtime100:0});
  const State={rdos:[
    {id:'a',projectId:'p1',date:'2026-09-01',status:'Aprovado',number:'RDO-1',entries:[entry(8),entry(8)]},
    {id:'b',projectId:'p1',date:'2026-09-02',status:'Enviado',number:'RDO-2',entries:[entry(4)]},
    {id:'c',projectId:'p2',date:'2026-09-03',status:'Aprovado',number:'RDO-3',entries:[entry(10)]},
    {id:'d',projectId:'p2',date:'2026-09-04',status:'Enviado',number:'RDO-4',entries:[entry(5)]},
    {id:'e',projectId:'p2',date:'2026-09-05',status:'Enviado',number:'RDO-5',entries:[entry(1)]},
    {id:'f',projectId:'p2',date:'2026-09-06',status:'Rascunho',number:'RDO-6',entries:[entry(2)]}
  ]};
  const U={norm:v=>String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(),esc:v=>String(v??''),date:v=>v,jsArg:v=>JSON.stringify(v),debounce:f=>f,icons(){}};
  const RDO={linkedRdoIds:()=>new Set(),allowedProjects:()=>projects,projectLabel:id=>(projects.find(p=>p.id===id)||{}).label||'',fullAccess:()=>false,statusTag:s=>s,visibleEntries:r=>r.entries||[]};
  const context={State,U,RDO,Views:{},$c:()=>box,document:{getElementById:()=>null,querySelectorAll:()=>[]},console};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end)+'\nViews.rdos.query='+JSON.stringify(query)+';Views.rdos.status='+JSON.stringify(status)+';Views.rdos.render();',context);
  const kpi=label=>{const m=box.innerHTML.match(new RegExp(`k-label">${label}</div><div class="k-value">([^<]*)<`));return m&&m[1];};
  const chip=name=>{const m=box.innerHTML.match(new RegExp(`data-rdo-status="${name}">[^<]*<span>(\\d+)</span>`));return m&&Number(m[1]);};
  return {kpi,chip};
}

test('sem busca: indicadores iguais aos de antes (todos os diários)',()=>{
  const r=renderRdos('');
  assert.equal(r.kpi('Diários'),'6');
  assert.equal(r.kpi('Aguardando aprovação'),'3');
  assert.equal(r.kpi('Aprovados'),'2');
  assert.equal(r.kpi('Horas registradas'),'38h');
  assert.equal(r.chip('Todos'),6);
});

test('buscando um projeto: aguardando, aprovados, horas e pílulas seguem o projeto',()=>{
  const r=renderRdos('aurora');
  assert.equal(r.kpi('Diários'),'2');
  assert.equal(r.kpi('Aguardando aprovação'),'1');
  assert.equal(r.kpi('Aprovados'),'1');
  assert.equal(r.kpi('Horas registradas'),'20h');
  assert.equal(r.chip('Todos'),2);assert.equal(r.chip('Rascunho'),0);
  const s=renderRdos('911');
  assert.equal(s.kpi('Aguardando aprovação'),'2');
  assert.equal(s.kpi('Aprovados'),'1');
  assert.equal(s.kpi('Horas registradas'),'18h');
});

test('a pílula de situação não zera os outros indicadores',()=>{
  const r=renderRdos('aurora','Aprovado');
  assert.equal(r.kpi('Diários'),'1');
  assert.equal(r.kpi('Aguardando aprovação'),'1');
  assert.equal(r.kpi('Horas registradas'),'20h');
});

test('Edge Function nova e separada, só leitura; omie-integration intocada',()=>{
  const fn=read('supabase/functions/omie-remessa-categorias/index.ts');
  assert.ok(fn.includes('"ListarCategorias"')&&!fn.includes('filtrar_por_tipo'),'lista categorias sem filtro de tipo');
  assert.ok(fn.includes('"ListarRemessas"')&&fn.includes('infAdic?.cCodCateg'),'conta as categorias das remessas');
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(fn),'não grava nada');
  assert.ok(/admin\.rpc\(/.test(fn)&&(fn.match(/admin\.rpc\(/g)||[]).length===1&&fn.includes('clique_obras_omie_credentials'),'única RPC: ler a credencial');
  assert.ok(fn.includes('membership.role!=="owner"'),'somente o proprietário');
  assert.ok(fn.includes('enforceRateLimit('),'limite de requisições');
  const main=read('supabase/functions/omie-integration/index.ts');
  assert.ok(!main.includes('remessa-categories')&&!main.includes('remessa-categorias'),'omie-integration não foi tocada');
  assert.ok(main.includes('"ListarCategorias","categoria_cadastro",{filtrar_apenas_ativo:"S",filtrar_por_tipo:"D"}'),'catálogo de despesas inalterado');
});

test('front: aba nova envolve configure() e reaproveita o salvar original',()=>{
  const js=read('modules/integracoes/omie-remessa.js');
  assert.ok(js.includes('OmieIntegration.configure=async function'));
  assert.ok(js.includes('Cloud.omieRemessaCategories()'));
  assert.ok(js.includes('catalog.categories.push(item)'));
  assert.ok(js.includes('OmieIntegration.categoryRows('),'mesmas linhas/classes do salvar original');
  assert.ok(!read('modules/integracoes/omie.js').includes('remessa'),'omie.js não foi tocado');
  const cloud=read('database/cloud.js');
  assert.ok(cloud.includes("'/functions/v1/omie-remessa-categorias'")&&cloud.includes('omieRequest, omieRemessaCategories,'));
});
