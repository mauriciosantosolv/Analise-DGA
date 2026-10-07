// ---------------------------------------------------------------------------
// CliqueObras v4.5.13 — por que a limpeza parou em 05/10/2026 (e o conserto).
//
// Às 11h09 foram ativados 4 projetos no custo por remessa. Um deles (Fornecimento
// de Quadro Elétrico, 2436071975) não tem NENHUMA conta a pagar no Omie e ficou
// em 1º na lista. Medido em 05/10/2026: logo depois de uma resposta VAZIA, o Omie
// ainda segura o método ListarContasPagar por ~3 s ("Já existe uma requisição
// desse método sendo executada"). A v4.5.10 tratava isso como erro de
// concorrência e repetia a MESMA chamada em 1,5 s / 3 s / 6 s — e o Omie bloqueia
// a mesma requisição repetida dentro de 60 s: "Consumo redundante detectado.
// Aguarde 49 segundos (REDUNDANT)". Como um erro derrubava a execução inteira,
// NENHUM projeto era limpo e os 4 novos nunca ganhavam payables_cleared_at.
//
// Conserto (sem mudar a regra da v4.5.10, que segue em logic.mjs):
//  1. "Consumo redundante" deixa de ser tratado como concorrência: espera o tempo
//     que o próprio Omie pede (+2 s), uma vez por execução.
//  2. Concorrência espera mais (3 s, 6 s, 10 s) — o método fica preso ~3 s.
//  3. Depois de uma lista vazia, pausa de 3,5 s antes da próxima chamada.
//  4. Cada projeto é lido isolado: um projeto que falhar NÃO derruba os outros,
//     não ganha payables_cleared_at e é tentado de novo na próxima execução.
//     Projeto que falhou não tem título lido → nada dele é retirado.
//  5. Prazo de 90 s para as leituras (o agendador corta em 120 s).
// ---------------------------------------------------------------------------

function plain(value){
  const text=value instanceof Error?value.message:value;
  return String(text??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
}

export function isRedundantError(value){
  const text=plain(value);
  return text.includes('consumo redundante')||text.includes('(redundant)');
}

export function isBusyMethodError(value){
  const text=plain(value);
  return text.includes('ja existe uma requisicao desse metodo sendo executada')||text.includes('too many requests');
}

// "Aguarde 49 segundos" → 51 000 ms (limite 65 s). Sem número → 62 s.
export function redundantWaitMs(value){
  const match=plain(value).match(/aguarde\s+(\d+)\s*segundo/);
  const seconds=match?Number(match[1]):60;
  return Math.min(65,Math.max(1,seconds)+2)*1000;
}

export const BUSY_WAITS_MS=[3000,6000,10000];
export const EMPTY_LIST_PAUSE_MS=3500;
export const LIST_DEADLINE_MS=90000;

export function isEmptyListing(data){
  const list=Array.isArray(data?.conta_pagar_cadastro)?data.conta_pagar_cadastro:[];
  return list.length===0;
}
