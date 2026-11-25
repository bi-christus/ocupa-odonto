/* firestore.js — leitura pela API REST, com o token de QUEM CHAMOU.

   Não há conta de serviço de propósito: quem decide o que a função enxerga
   são as Security Rules, as mesmas do navegador. Esta camada só lê — não
   existe aqui nenhum caminho que grave. */
'use strict';

class LeituraNegada extends Error {
  constructor() { super('leitura negada pelas Security Rules'); }
}

/* Valor tipado do Firestore → valor de JavaScript. */
function valor(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue || {}).values || []).map(valor);
  if ('mapValue' in v) return campos((v.mapValue || {}).fields);
  return null;
}
function campos(f) {
  const o = {};
  Object.keys(f || {}).forEach((k) => { o[k] = valor(f[k]); });
  return o;
}
function documento(bruto) {
  const partes = String(bruto.name || '').split('/');
  return {
    id: partes[partes.length - 1],
    dados: campos(bruto.fields),
    criadoEm: Date.parse(bruto.createTime) || 0,
    mudadoEm: Date.parse(bruto.updateTime) || 0,
    versao: String(bruto.updateTime || '')
  };
}

function criarLeitor(opcoes) {
  const buscar = opcoes.buscar;
  const base = 'https://firestore.googleapis.com/v1/projects/' + opcoes.projeto + '/databases/(default)/documents/';

  async function pedir(caminho, token) {
    const r = await buscar(base + caminho, {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(8000)
    });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new LeituraNegada();
    if (!r.ok) throw new Error('firestore ' + r.status);
    return r.json();
  }

  /* Um documento, ou null quando não existe. */
  async function ler(colecao, id, token) {
    const b = await pedir(colecao + '/' + encodeURIComponent(id), token);
    return b && b.name ? documento(b) : null;
  }

  async function listar(colecao, token) {
    let saida = [], pagina = '';
    for (let i = 0; i < 20; i++) {
      const b = await pedir(colecao + '?pageSize=300' + (pagina ? '&pageToken=' + encodeURIComponent(pagina) : ''), token);
      saida = saida.concat(((b && b.documents) || []).map(documento));
      pagina = (b && b.nextPageToken) || '';
      if (!pagina) break;
    }
    return saida;
  }

  return { ler: ler, listar: listar };
}

module.exports = { criarLeitor: criarLeitor, LeituraNegada: LeituraNegada, campos: campos };
