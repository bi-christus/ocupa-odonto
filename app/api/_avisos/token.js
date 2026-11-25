/* token.js — confere o ID token do Firebase sem dependência nenhuma.

   A assinatura é RS256 com as chaves públicas do Google, e as conferências
   são as da documentação do Firebase para "bibliotecas de terceiros": alg,
   kid, aud, iss, sub, exp, iat e auth_time. O mesmo token segue depois para
   a API REST do Firestore, então um token falso ainda esbarraria nas
   Security Rules — esta conferência vem antes para nem chegar lá. */
'use strict';
const crypto = require('crypto');

const URL_CHAVES = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const FOLGA = 60; /* segundos de diferença de relógio */

class TokenRecusado extends Error {
  constructor(motivo) { super('token recusado: ' + motivo); this.motivo = motivo; }
}

function parte(texto) {
  try { return JSON.parse(Buffer.from(texto, 'base64url').toString('utf8')); } catch (e) { return null; }
}

function criarVerificador(opcoes) {
  const projeto = opcoes.projeto, buscar = opcoes.buscar, agora = opcoes.agora;
  let cache = { ate: 0, lidaEm: 0, chaves: {} };

  async function carregarChaves() {
    const r = await buscar(URL_CHAVES, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('chaves do Google indisponíveis');
    const corpo = await r.json();
    const chaves = {};
    (corpo.keys || []).forEach((k) => { if (k.kid) chaves[k.kid] = k; });
    const m = /max-age=(\d+)/.exec((r.headers && r.headers.get('cache-control')) || '');
    cache = { ate: agora() + (m ? Number(m[1]) : 3600) * 1000, lidaEm: agora(), chaves: chaves };
  }

  async function chave(kid) {
    if (agora() >= cache.ate) await carregarChaves();
    /* kid que não está no cache pode ser rotação: relê, mas no máximo uma
       vez por minuto, senão um kid inventado viraria um pedido ao Google a
       cada chamada. */
    if (!cache.chaves[kid] && agora() - cache.lidaEm > 60000) await carregarChaves();
    return Object.prototype.hasOwnProperty.call(cache.chaves, kid) ? cache.chaves[kid] : null;
  }

  return async function verificar(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw new TokenRecusado('ausente');
    const p = token.split('.');
    if (p.length !== 3) throw new TokenRecusado('formato');
    const cab = parte(p[0]), corpo = parte(p[1]);
    if (!cab || !corpo || typeof cab !== 'object' || typeof corpo !== 'object') throw new TokenRecusado('formato');
    if (cab.alg !== 'RS256' || typeof cab.kid !== 'string') throw new TokenRecusado('algoritmo');

    const jwk = await chave(cab.kid);
    if (!jwk) throw new TokenRecusado('chave');
    const publica = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const confere = crypto.verify('RSA-SHA256', Buffer.from(p[0] + '.' + p[1]), publica,
      Buffer.from(p[2], 'base64url'));
    if (!confere) throw new TokenRecusado('assinatura');

    const s = Math.floor(agora() / 1000);
    if (corpo.aud !== projeto) throw new TokenRecusado('aud');
    if (corpo.iss !== 'https://securetoken.google.com/' + projeto) throw new TokenRecusado('iss');
    if (typeof corpo.sub !== 'string' || !corpo.sub || corpo.sub.length > 128) throw new TokenRecusado('sub');
    if (!(corpo.exp > s - FOLGA)) throw new TokenRecusado('expirado');
    if (!(corpo.iat <= s + FOLGA)) throw new TokenRecusado('iat');
    if (!(corpo.auth_time <= s + FOLGA)) throw new TokenRecusado('auth_time');
    if (typeof corpo.email !== 'string' || !corpo.email) throw new TokenRecusado('email');
    if (corpo.email_verified !== true) throw new TokenRecusado('email não verificado');
    return { uid: corpo.sub, email: corpo.email.trim().toLowerCase(), nome: String(corpo.name || '') };
  };
}

module.exports = { criarVerificador: criarVerificador, TokenRecusado: TokenRecusado, URL_CHAVES: URL_CHAVES };
