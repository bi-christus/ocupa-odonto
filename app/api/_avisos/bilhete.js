/* bilhete.js — o "antes" da reserva, guardado pelo navegador sem que ele
   possa mexer.

   Duas situações precisam de um estado que, na hora do e-mail, não existe
   mais: cancelar uma pontual apaga o documento, e a alteração só mostra o
   "de → para" com a versão anterior. Aceitar esse "antes" do navegador seria
   aceitar destinatário e texto dele. Guardar numa coleção exigiria mexer nas
   Security Rules.

   Então o próprio servidor lê a reserva ANTES da gravação, assina o que leu
   (HMAC com AVISOS_SEGREDO) e entrega o resultado para o navegador devolver
   depois. O bilhete vale só para quem o pediu, para aquela reserva e por uma
   hora; mudar uma letra dele invalida a assinatura. */
'use strict';
const crypto = require('crypto');

const VALIDADE = 60 * 60 * 1000;
const TAMANHO_MAXIMO = 60000;

/* Só o que a mensagem compara. `excecoes` fica de fora: pode ser longa e
   nenhum aviso que usa bilhete precisa dela. */
const CAMPOS = ['tipo', 'agrupamentoId', 'escopo', 'disciplinaId', 'turmaId', 'responsavelId',
  'tipoAtividade', 'descricao', 'observacao', 'inicio', 'fim', 'data', 'dias',
  'vigenciaInicio', 'vigenciaFim', 'encerradaEm', 'cadeirasPedidas', 'cadeirasAlocadas',
  'situacao', 'excluidaEm', 'motivoExclusao'];

function assinatura(segredo, corpo) {
  return crypto.createHmac('sha256', segredo).update('ocupa.bilhete.v1.' + corpo).digest();
}

function emitir(segredo, conta, doc, agora) {
  const d = {};
  CAMPOS.forEach((k) => { if (doc.dados[k] !== undefined) d[k] = doc.dados[k]; });
  const corpo = Buffer.from(JSON.stringify({
    u: conta.uid, e: conta.email, i: doc.id, t: agora, v: doc.versao, d: d
  })).toString('base64url');
  return corpo + '.' + assinatura(segredo, corpo).toString('base64url');
}

/* Devolve { id, versao, emitidoEm, dados } ou null. */
function conferir(segredo, texto, conta, id, agora) {
  if (typeof texto !== 'string' || texto.length > TAMANHO_MAXIMO) return null;
  const p = texto.split('.');
  if (p.length !== 2) return null;
  const esperada = assinatura(segredo, p[0]);
  const veio = Buffer.from(p[1], 'base64url');
  if (veio.length !== esperada.length || !crypto.timingSafeEqual(veio, esperada)) return null;
  let c;
  try { c = JSON.parse(Buffer.from(p[0], 'base64url').toString('utf8')); } catch (e) { return null; }
  if (c.u !== conta.uid || c.e !== conta.email || c.i !== id) return null;
  if (!(agora - c.t >= -60000 && agora - c.t <= VALIDADE)) return null;
  return { id: c.i, versao: c.v, emitidoEm: c.t, dados: c.d || {} };
}

module.exports = { emitir: emitir, conferir: conferir, TAMANHO_MAXIMO: TAMANHO_MAXIMO };
