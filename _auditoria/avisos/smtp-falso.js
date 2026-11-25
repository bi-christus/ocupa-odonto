/* smtp-falso.js — servidor SMTP de teste, com TLS direto ou STARTTLS. Guarda
   o que recebeu em `estado.recebidas` e nunca repassa nada. */
'use strict';
const net = require('net');
const tls = require('tls');

function criar(op) {
  const estado = { recebidas: [], comandos: [], logins: [] };
  const tlsOp = { key: op.chave, cert: op.cert };

  function conversar(socket, seguro, calado) {
    let resto = '', dados = null, atual = null, login = null, usuario = '';
    const diz = (t) => socket.write(t + '\r\n');
    /* Depois do STARTTLS não há nova saudação. */
    if (!calado) diz('220 falso ESMTP');
    socket.on('error', () => {});

    function comando(linha) {
      const v = linha.split(' ')[0].toUpperCase();
      estado.comandos.push((seguro ? 'S ' : 'C ') + linha.replace(/^(AUTH PLAIN).*/, '$1 ***'));
      if (v === 'EHLO') {
        const r = ['250-falso'];
        if (!seguro && op.starttls !== false) r.push('250-STARTTLS');
        if (seguro) r.push('250-AUTH ' + (op.auth || 'PLAIN LOGIN'));
        r.push('250 8BITMIME');
        diz(r.join('\r\n'));
      } else if (v === 'STARTTLS') {
        socket.removeListener('data', aoDado);
        /* `plantar`: bytes em claro colados ao 220. Um cliente que os
           guardasse obedeceria, depois do TLS, a uma resposta plantada. */
        socket.write('220 vai\r\n' + (op.plantar || ''));
        const s = new tls.TLSSocket(socket, Object.assign({ isServer: true }, tlsOp));
        s.on('error', () => {});
        conversar(s, true, true);
      } else if (v === 'AUTH') {
        const p = linha.split(' ');
        if (p[1] === 'PLAIN') {
          const t = Buffer.from(p[2], 'base64').toString().split('\u0000');
          estado.logins.push([t[1], t[2]]);
          diz(op.recusarLogin ? '535 5.7.8 nao' : '235 ok');
        } else { login = 'usuario'; diz('334 VXNlcm5hbWU6'); }
      } else if (v === 'MAIL') { atual = { de: linha, para: [], corpo: '' }; diz('250 ok'); }
      else if (v === 'RCPT') {
        if (op.recusarPara && linha.indexOf(op.recusarPara) !== -1) diz('550 5.1.1 nao existe');
        else { atual.para.push(linha); diz('250 ok'); }
      } else if (v === 'DATA') { dados = []; diz('354 manda'); }
      else if (v === 'RSET') { atual = null; diz('250 ok'); }
      else if (v === 'QUIT') { diz('221 tchau'); socket.end(); }
      else diz('500 ?');
    }

    function aoDado(d) {
      resto += d.toString('utf8');
      let i;
      while ((i = resto.indexOf('\r\n')) !== -1) {
        const linha = resto.slice(0, i);
        resto = resto.slice(i + 2);
        if (dados !== null) {
          if (linha !== '.') { dados.push(linha.replace(/^\.\./, '.')); continue; }
          atual.corpo = dados.join('\r\n');
          dados = null;
          if (op.semCota) { diz('550 5.4.5 Daily user sending limit exceeded'); continue; }
          estado.recebidas.push(atual);
          diz('250 ok');
        } else if (login === 'usuario') {
          login = 'senha';
          usuario = Buffer.from(linha, 'base64').toString();
          diz('334 UGFzc3dvcmQ6');
        } else if (login === 'senha') {
          login = null;
          estado.logins.push([usuario, Buffer.from(linha, 'base64').toString()]);
          diz(op.recusarLogin ? '535 5.7.8 nao' : '235 ok');
        } else comando(linha);
      }
    }
    socket.on('data', aoDado);
  }

  const servidor = op.direto
    ? tls.createServer(tlsOp, (s) => conversar(s, true, false))
    : net.createServer((s) => conversar(s, false, false));
  servidor.on('tlsClientError', () => {});
  const abertas = new Set();
  servidor.on('connection', (s) => { abertas.add(s); s.on('close', () => abertas.delete(s)); s.on('error', () => {}); });
  return {
    estado: estado,
    ouvir: () => new Promise((ok) => servidor.listen(0, '127.0.0.1', () => ok(servidor.address().port))),
    fechar: () => new Promise((ok) => { abertas.forEach((s) => s.destroy()); servidor.close(() => ok()); })
  };
}

module.exports = { criar: criar };
