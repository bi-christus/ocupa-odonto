/* servidor.js — o servidor local do harness com e-mail.

     node _auditoria/avisos/servidor.js [porta]

   Serve os arquivos do repositório e a função /api/avisos DE VERDADE, com
   três trocas: o Firestore é o banco de mentira que o harness manda, o token
   é "harness.<perfil>", e o SMTP guarda a mensagem em vez de enviar. Nada
   sai desta máquina. Fora de app/, então não é publicado. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const Atender = require('../../app/api/_avisos/atender');
const Smtp = require('../../app/api/_avisos/smtp');
const { TokenRecusado } = require('../../app/api/_avisos/token');
const BancoFalso = require('./banco-falso');

const RAIZ = path.join(__dirname, '..', '..');
const PORTA = Number(process.argv[2]) || 3010;
const CONTAS = { coordenador: 'coord@teste.br', professor: 'prof@teste.br', tecnico: 'tec@teste.br' };
const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png'
};

let banco = {}, modo = 'ok', caixa = [], chamadas = [];
const fake = BancoFalso.criar({ banco: () => banco });

const atender = Atender.criar({
  env: {
    AVISOS_SMTP_HOST: 'smtp.invalid', AVISOS_SMTP_PORTA: '465',
    AVISOS_SMTP_USUARIO: 'x', AVISOS_SMTP_SENHA: 'x',
    AVISOS_REMETENTE: 'Ocupa <ocupa@teste.br>',
    AVISOS_SEGREDO: 'segredo-de-mentira-do-harness-0123456789'
  },
  buscar: fake.buscar,
  verificar: async (t) => {
    const perfil = /^harness\.([a-z]+)$/.exec(t);
    if (!perfil || !CONTAS[perfil[1]]) throw new TokenRecusado('harness');
    return { uid: 'uid-' + perfil[1], email: CONTAS[perfil[1]], nome: '' };
  },
  enviar: async (cfg, msgs, op) => {
    if (modo === 'falha') return msgs.map(() => ({ ok: false, codigo: 'conexao' }));
    return msgs.map((m) => {
      caixa.push({
        para: m.para, assunto: m.assunto, texto: m.texto, html: m.html,
        mime: Smtp.montarMime(cfg, m, op.agora())
      });
      return { ok: true };
    });
  }
});

function ler(req) {
  return new Promise((ok) => {
    const l = [];
    req.on('data', (d) => l.push(d));
    req.on('end', () => ok(Buffer.concat(l).toString('utf8')));
  });
}
function json(res, v) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(v));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/avisos') {
    chamadas.push(req.method);
    if (modo === 'fora') { req.socket.destroy(); return; }
    if (modo === 'lento') await new Promise((ok) => setTimeout(ok, 4000));
    await atender(req, res);
    return;
  }
  if (url.pathname === '/_harness/banco') { banco = JSON.parse(await ler(req)); json(res, { ok: true }); return; }
  if (url.pathname === '/_harness/modo') { modo = url.searchParams.get('v') || 'ok'; json(res, { modo: modo }); return; }
  if (url.pathname === '/_harness/caixa') { json(res, { caixa: caixa, chamadas: chamadas }); return; }
  if (url.pathname === '/_harness/limpar') { caixa = []; chamadas = []; modo = 'ok'; json(res, { ok: true }); return; }

  const alvo = path.join(RAIZ, decodeURIComponent(url.pathname));
  if (!alvo.startsWith(RAIZ) || !fs.existsSync(alvo) || fs.statSync(alvo).isDirectory()) {
    res.statusCode = 404;
    res.end('404');
    return;
  }
  res.setHeader('Content-Type', (TIPOS[path.extname(alvo)] || 'application/octet-stream') + '; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(alvo).pipe(res);
}).listen(PORTA, '127.0.0.1', () => {
  console.log('harness com e-mail em http://localhost:' + PORTA + '/_auditoria/harness.html?emails=1');
});
