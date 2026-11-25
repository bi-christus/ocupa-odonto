/* smtp.js — cliente SMTP mínimo, com os módulos do próprio Node.

   Uma dependência npm obrigaria um package.json na raiz publicada, e este
   projeto não tem build. O que se precisa aqui é pouco: uma conexão TLS (465)
   ou STARTTLS (587), login, e uma mensagem por destinatário.

   Sem TLS não há conversa: a senha nunca vai em claro. As respostas do
   servidor não são registradas em log nem devolvidas a quem chamou — elas
   costumam repetir o endereço do destinatário. Só o código do erro sai. */
'use strict';
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const PRAZO = 10000;

class FalhaSmtp extends Error {
  constructor(codigo) { super('smtp: ' + codigo); this.codigo = codigo; }
}

/* ── Mensagem MIME ───────────────────────────────────────────────────── */
/* Cabeçalho sempre em palavras codificadas (RFC 2047): é ao mesmo tempo o que
   leva acento e o que impede injeção de cabeçalho — uma quebra de linha no
   texto vira base64. */
function cabecalho(texto) {
  const limpo = String(texto).replace(/[\r\n]+/g, ' ');
  const pedacos = [];
  let atual = '';
  Array.from(limpo).forEach((ch) => {
    if (Buffer.byteLength(atual + ch) > 42) { pedacos.push(atual); atual = ''; }
    atual += ch;
  });
  pedacos.push(atual);
  return pedacos.map((p) => '=?UTF-8?B?' + Buffer.from(p).toString('base64') + '?=').join('\r\n ');
}
function base64Linhas(texto) {
  return (Buffer.from(texto, 'utf8').toString('base64').match(/.{1,76}/g) || ['']).join('\r\n');
}
function caixa(c) { return c.nome ? cabecalho(c.nome) + ' <' + c.endereco + '>' : '<' + c.endereco + '>'; }

function montarMime(config, msg, agora) {
  const marca = 'ocupa-' + crypto.randomBytes(12).toString('hex');
  const dominio = config.remetente.endereco.split('@')[1];
  const partes = [
    'From: ' + caixa(config.remetente),
    'To: <' + msg.para + '>',
    config.responder ? 'Reply-To: ' + caixa(config.responder) : null,
    'Subject: ' + cabecalho(msg.assunto),
    'Date: ' + new Date(agora).toUTCString().replace('GMT', '+0000'),
    'Message-ID: <' + crypto.randomBytes(16).toString('hex') + '@' + dominio + '>',
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    'X-Auto-Response-Suppress: All',
    'Content-Type: multipart/alternative; boundary="' + marca + '"',
    '',
    '--' + marca,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Linhas(msg.texto),
    '--' + marca,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Linhas(msg.html),
    '--' + marca + '--',
    ''
  ];
  return partes.filter((l) => l !== null).join('\r\n');
}

/* ── Conversa ────────────────────────────────────────────────────────── */
class Conversa {
  constructor() { this.resto = ''; this.linhas = []; this.prontas = []; this.espera = null; this.erro = null; }

  ligar(socket) {
    this.socket = socket;
    this.resto = ''; this.linhas = []; this.prontas = [];
    this.aoDado = (d) => this.receber(d);
    this.aoErro = (e) => this.falhar(new FalhaSmtp(e && /CERT|SELF_SIGNED|ALTNAME|UNABLE_TO/.test(String(e.code)) ? 'tls' : 'conexao'));
    this.aoFim = () => this.falhar(new FalhaSmtp('conexao'));
    socket.on('data', this.aoDado);
    socket.on('error', this.aoErro);
    socket.on('close', this.aoFim);
  }
  soltar() {
    this.socket.removeListener('data', this.aoDado);
    this.socket.removeListener('error', this.aoErro);
    this.socket.removeListener('close', this.aoFim);
    return this.socket;
  }
  receber(d) {
    this.resto += d.toString('utf8');
    if (this.resto.length > 65536) { this.falhar(new FalhaSmtp('resposta')); return; }
    let i;
    while ((i = this.resto.indexOf('\n')) !== -1) {
      const linha = this.resto.slice(0, i).replace(/\r$/, '');
      this.resto = this.resto.slice(i + 1);
      this.linhas.push(linha);
      if (/^\d{3}(?: |$)/.test(linha)) {
        this.prontas.push({ codigo: Number(linha.slice(0, 3)), linhas: this.linhas });
        this.linhas = [];
      } else if (!/^\d{3}-/.test(linha)) {
        this.falhar(new FalhaSmtp('resposta'));
        return;
      }
    }
    this.entregar();
  }
  falhar(e) { if (!this.erro) this.erro = e; this.entregar(); }
  entregar() {
    if (!this.espera) return;
    const e = this.espera;
    if (this.prontas.length) { this.espera = null; clearTimeout(e.relogio); e.ok(this.prontas.shift()); }
    else if (this.erro) { this.espera = null; clearTimeout(e.relogio); e.erro(this.erro); }
  }
  resposta() {
    return new Promise((ok, erro) => {
      this.espera = { ok: ok, erro: erro, relogio: setTimeout(() => {
        this.espera = null;
        erro(new FalhaSmtp('tempo'));
      }, PRAZO) };
      this.entregar();
    });
  }
  async comando(linha, esperado, codigoErro) {
    this.socket.write(linha + '\r\n');
    const r = await this.resposta();
    if (esperado.indexOf(r.codigo) === -1) {
      const f = new FalhaSmtp(codigoErro || 'resposta');
      f.resposta = r;
      throw f;
    }
    return r;
  }
}

function conectar(config, opcoesTls) {
  const host = config.smtp.host, porta = config.smtp.porta;
  const op = Object.assign({ host: host, port: porta, servername: host, minVersion: 'TLSv1.2' }, opcoesTls || {});
  return new Promise((ok, erro) => {
    const direto = porta === 465 || (opcoesTls && opcoesTls.direto);
    const s = direto ? tls.connect(op) : net.connect({ host: host, port: porta });
    const relogio = setTimeout(() => { s.destroy(); erro(new FalhaSmtp('tempo')); }, PRAZO);
    const falhou = (e) => {
      clearTimeout(relogio);
      erro(new FalhaSmtp(e && /CERT|SELF_SIGNED|ALTNAME|UNABLE_TO/.test(String(e.code)) ? 'tls' : 'conexao'));
    };
    s.once('error', falhou);
    s.once(direto ? 'secureConnect' : 'connect', () => {
      clearTimeout(relogio);
      s.removeListener('error', falhou);
      ok({ socket: s, seguro: !!direto });
    });
  });
}

function subirTls(socket, config, opcoesTls) {
  return new Promise((ok, erro) => {
    const op = Object.assign({ socket: socket, servername: config.smtp.host, minVersion: 'TLSv1.2' }, opcoesTls || {});
    delete op.host; delete op.port;
    const s = tls.connect(op);
    const relogio = setTimeout(() => { s.destroy(); erro(new FalhaSmtp('tempo')); }, PRAZO);
    s.once('error', () => { clearTimeout(relogio); erro(new FalhaSmtp('tls')); });
    s.once('secureConnect', () => { clearTimeout(relogio); ok(s); });
  });
}

async function apresentar(c, config) {
  const r = await c.comando('EHLO ' + config.remetente.endereco.split('@')[1], [250]);
  return r.linhas.map((l) => l.slice(4).toUpperCase());
}

async function autenticar(c, config, recursos) {
  const auth = recursos.find((x) => /^AUTH[ =]/.test(x)) || '';
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
  if (/\bPLAIN\b/.test(auth)) {
    await c.comando('AUTH PLAIN ' + b64('\u0000' + config.smtp.usuario + '\u0000' + config.smtp.senha), [235], 'autenticacao');
  } else if (/\bLOGIN\b/.test(auth)) {
    await c.comando('AUTH LOGIN', [334], 'autenticacao');
    await c.comando(b64(config.smtp.usuario), [334], 'autenticacao');
    await c.comando(b64(config.smtp.senha), [235], 'autenticacao');
  } else {
    throw new FalhaSmtp('autenticacao');
  }
}

/* 5.4.5 e 4.2.x/4.7.x de limite: a cota da conta, e não o endereço. */
function porque(f) {
  if (!f.resposta) return f.codigo || 'resposta';
  const t = f.resposta.linhas.join(' ');
  if (/\b[45]\.4\.5\b|quota|limit exceeded|rate limit/i.test(t)) return 'cota';
  return f.codigo;
}

/* Envia uma a uma, na mesma conexão. Devolve, na ordem, { ok } ou
   { ok:false, codigo } — a falha de uma não derruba as outras, e a da
   conexão vira a falha de todas as que faltavam. Nunca rejeita. */
async function enviar(config, mensagens, opcoes) {
  opcoes = opcoes || {};
  const agora = opcoes.agora || Date.now;
  const saida = mensagens.map(() => ({ ok: false, codigo: 'conexao' }));
  const c = new Conversa();
  let aberta = null;
  let i = 0;
  try {
    aberta = await conectar(config, opcoes.tls);
    c.ligar(aberta.socket);
    const ola = await c.resposta();
    if (ola.codigo !== 220) throw new FalhaSmtp('conexao');
    let recursos = await apresentar(c, config);
    if (!aberta.seguro) {
      if (recursos.indexOf('STARTTLS') === -1) throw new FalhaSmtp('tls');
      await c.comando('STARTTLS', [220], 'tls');
      /* `ligar` descarta o que tiver sobrado no buffer: bytes que chegaram
         em claro junto com o 220 não podem valer depois do TLS. */
      const seguro = await subirTls(c.soltar(), config, opcoes.tls);
      c.ligar(seguro);
      recursos = await apresentar(c, config);
    }
    await autenticar(c, config, recursos);

    for (; i < mensagens.length; i++) {
      const m = mensagens[i];
      try {
        await c.comando('MAIL FROM:<' + config.remetente.endereco + '>', [250], 'remetente');
        await c.comando('RCPT TO:<' + m.para + '>', [250, 251], 'destinatario');
        await c.comando('DATA', [354], 'resposta');
        const corpo = montarMime(config, m, agora()).replace(/^\./gm, '..');
        await c.comando(corpo + '\r\n.', [250], 'resposta');
        saida[i] = { ok: true };
      } catch (e) {
        if (!(e instanceof FalhaSmtp) || !e.resposta || e.resposta.codigo === 421) throw e;
        saida[i] = { ok: false, codigo: porque(e) };
        await c.comando('RSET', [250]);
      }
    }
    try { c.socket.write('QUIT\r\n'); } catch (e) { /* já enviou tudo */ }
  } catch (e) {
    const codigo = e instanceof FalhaSmtp ? porque(e) : 'conexao';
    for (; i < mensagens.length; i++) if (!saida[i].ok) saida[i] = { ok: false, codigo: codigo };
  } finally {
    const s = c.socket || (aberta && aberta.socket);
    if (s) { s.on('error', () => {}); s.end(); setTimeout(() => s.destroy(), 500).unref(); }
  }
  return saida;
}

module.exports = { enviar: enviar, montarMime: montarMime, cabecalho: cabecalho, FalhaSmtp: FalhaSmtp };
