/* banco-falso.js — um `fetch` que responde como a API REST do Firestore, a
   partir de um objeto { colecao: { id: { dados, criadoEm, mudadoEm } } }.
   `regras(colecao, id, token)` imita as Security Rules: false vira 403. */
'use strict';

function tipado(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(tipado) } : {} };
  if (typeof v === 'object') return { mapValue: { fields: campos(v) } };
  return { stringValue: String(v) };
}
function campos(o) {
  const f = {};
  Object.keys(o).forEach((k) => { if (o[k] !== undefined) f[k] = tipado(o[k]); });
  return f;
}
function documento(projeto, colecao, id, d) {
  return {
    name: 'projects/' + projeto + '/databases/(default)/documents/' + colecao + '/' + id,
    fields: campos(d.dados),
    createTime: new Date(d.criadoEm).toISOString(),
    updateTime: new Date(d.mudadoEm).toISOString()
  };
}
function resposta(status, corpo) {
  return { ok: status >= 200 && status < 300, status: status, headers: new Headers(), json: async () => corpo };
}

function criar(opcoes) {
  const projeto = opcoes.projeto || 'ocupa-odonto';
  const base = 'https://firestore.googleapis.com/v1/projects/' + projeto + '/databases/(default)/documents/';
  const pedidos = [];
  async function buscar(url, op) {
    if (!String(url).startsWith(base)) throw new Error('rede proibida no teste: ' + url);
    const token = /^Bearer (.+)$/.exec(((op || {}).headers || {}).Authorization || '');
    const resto = String(url).slice(base.length).split('?')[0].split('/').map(decodeURIComponent);
    pedidos.push(resto.join('/'));
    if (!token) return resposta(401, {});
    if (opcoes.regras && !opcoes.regras(resto[0], resto[1], token[1])) return resposta(403, {});
    const col = opcoes.banco()[resto[0]] || {};
    if (resto.length === 1) {
      return resposta(200, { documents: Object.keys(col).map((id) => documento(projeto, resto[0], id, col[id])) });
    }
    const d = col[resto[1]];
    return d ? resposta(200, documento(projeto, resto[0], resto[1], d)) : resposta(404, {});
  }
  return { buscar: buscar, pedidos: pedidos };
}

module.exports = { criar: criar };
