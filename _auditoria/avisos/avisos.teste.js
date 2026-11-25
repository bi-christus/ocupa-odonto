/* avisos.teste.js — a função /api/avisos, sem rede e sem e-mail de verdade.

     node --test _auditoria/avisos/avisos.teste.js

   Firestore, chaves do Google e SMTP são falsos e locais; o resto é o código
   publicado. Precisa do `openssl` no PATH para os certificados de teste. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Readable } = require('stream');

const Atender = require('../../app/api/_avisos/atender');
const Smtp = require('../../app/api/_avisos/smtp');
const { URL_CHAVES } = require('../../app/api/_avisos/token');
const BancoFalso = require('./banco-falso');
const SmtpFalso = require('./smtp-falso');

/* ── Chaves e tokens ─────────────────────────────────────────────────── */
const par = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const outroPar = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(par.publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

function token(email, mudar, cab, chave) {
  const s = Math.floor(Date.now() / 1000);
  const corpo = Object.assign({
    iss: 'https://securetoken.google.com/ocupa-odonto', aud: 'ocupa-odonto', sub: 'uid-' + email,
    auth_time: s - 10, iat: s - 10, exp: s + 3000, email: email, email_verified: true
  }, mudar || {});
  const base = b64(Object.assign({ alg: 'RS256', kid: 'k1', typ: 'JWT' }, cab || {})) + '.' + b64(corpo);
  return base + '.' + crypto.sign('RSA-SHA256', Buffer.from(base), chave || par.privateKey).toString('base64url');
}

/* ── Acervo ──────────────────────────────────────────────────────────── */
const ENV = {
  AVISOS_SMTP_HOST: 'smtp.invalid', AVISOS_SMTP_PORTA: '465', AVISOS_SMTP_USUARIO: 'conta', AVISOS_SMTP_SENHA: 'senha-secreta',
  AVISOS_REMETENTE: 'Ocupa <ocupa@teste.br>', AVISOS_SEGREDO: 'segredo-de-teste-com-mais-de-32-letras'
};
function doc(dados, idadeMs) {
  const t = Date.now() - (idadeMs || 1000);
  return { dados: dados, criadoEm: t, mudadoEm: t };
}
const faixa = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function acervo() {
  const b = {
    config: { sistema: doc({ periodoLetivo: '2026.2', semestre: { inicio: '2026-08-03', fim: '2026-12-19' }, parametros: { enviarEmails: true } }) },
    autorizados: {
      'coord@teste.br': doc({ nome: 'Andréa Coordenação', nivel: 'coordenador', ativo: true }),
      'prof@teste.br': doc({ nome: 'Filipe Professor', nivel: 'professor', ativo: true }),
      'outra@teste.br': doc({ nome: 'Marina Professora', nivel: 'professor', ativo: true }),
      'suspensa@teste.br': doc({ nome: 'Suspensa', nivel: 'professor', ativo: false }),
      'tec@teste.br': doc({ nome: 'Murilo Técnico', nivel: 'tecnico', ativo: true })
    },
    agrupamentos: {
      ag1: doc({ nome: 'Clínicas 1 e 2', clinicas: ['cl1', 'cl2'] }),
      ag5: doc({ nome: 'Pré-clínica maior', clinicas: ['cl9'] }),
      ag7: doc({ nome: 'Lab Radio', clinicas: ['cl11'] })
    },
    clinicas: {
      cl1: doc({ nome: 'Clínica 1', agrupamentoId: 'ag1', cadeiras: 14, primeiraCadeira: 1 }),
      cl2: doc({ nome: 'Clínica 2', agrupamentoId: 'ag1', cadeiras: 14, primeiraCadeira: 15 }),
      cl9: doc({ nome: 'Pré-clínica maior', especialidade: 'Pré-clínica', agrupamentoId: 'ag5', cadeiras: 70, primeiraCadeira: 1 }),
      cl11: doc({ nome: 'Lab Radio', agrupamentoId: 'ag7', cadeiras: 0, primeiraCadeira: 1, semCadeiras: true })
    },
    disciplinas: {
      d1: doc({ codigo: 'ODO-301', nome: 'Clínica Integrada I', nivel: 'graduacao', professores: ['prof@teste.br', 'outra@teste.br'] }),
      d2: doc({ codigo: 'POS-01', nome: 'Endodontia', nivel: 'pos', professores: [] })
    },
    turmas: { t1: doc({ disciplinaId: 'd1', codigo: '1', professorCoordenadorId: 'prof@teste.br' }) },
    ocupacoes: {}
  };
  return b;
}
function pontual(x) {
  return Object.assign({
    tipo: 'pontual', agrupamentoId: 'ag1', escopo: 'a', data: '2026-12-01', inicio: '07:40', fim: '11:20',
    disciplinaId: 'd1', responsavelId: 'prof@teste.br', tipoAtividade: 'graduacao', descricao: 'T1 · atendimento',
    cadeirasPedidas: 6, cadeirasAlocadas: faixa(1, 6), situacao: 'aprovada', excecoes: [], criadoPor: 'coord@teste.br'
  }, x);
}
function recorrente(x) {
  return Object.assign({
    tipo: 'recorrente', agrupamentoId: 'ag1', escopo: 'b', dias: [1, 3], inicio: '13:40', fim: '17:20',
    vigenciaInicio: '2026-08-03', vigenciaFim: '2026-12-19', disciplinaId: 'd1', responsavelId: 'prof@teste.br',
    tipoAtividade: 'graduacao', descricao: 'T2', cadeirasPedidas: 8, cadeirasAlocadas: faixa(15, 22),
    excecoes: [], encerradaEm: null, criadoPor: 'coord@teste.br'
  }, x);
}

/* ── Banca: função + banco + caixa de saída ──────────────────────────── */
function banca(op) {
  op = op || {};
  const b = { banco: acervo(), caixa: [], logs: [], relogio: 0 };
  const fake = BancoFalso.criar({
    banco: () => b.banco,
    /* Como as Security Rules publicadas: só quem está ativo em autorizados. */
    regras: (col, id, t) => {
      const email = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).email;
      const a = b.banco.autorizados[email];
      return !!(a && a.dados.ativo === true);
    }
  });
  b.lidos = fake.pedidos;
  b.atender = Atender.criar({
    env: op.env || ENV,
    agora: () => Date.now() + b.relogio,
    log: (m) => b.logs.push(m),
    buscar: async (url, o) => url === URL_CHAVES
      ? { ok: true, status: 200, headers: new Headers({ 'cache-control': 'max-age=3600' }), json: async () => ({ keys: [jwk] }) }
      : fake.buscar(url, o),
    enviar: op.enviar || (async (cfg, msgs) => msgs.map((m) => { b.caixa.push(m); return { ok: true }; }))
  });
  b.chamar = async (corpo, quem, extra) => {
    extra = extra || {};
    const req = Readable.from([Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo))]);
    req.method = extra.metodo || 'POST';
    req.headers = Object.assign({ 'content-type': 'application/json' },
      quem === null ? {} : { authorization: 'Bearer ' + (quem && /^eyJ/.test(quem) ? quem : (extra.token || token(quem || 'coord@teste.br'))) },
      extra.headers || {});
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(t) { this.corpo = JSON.parse(t); } };
    await b.atender(req, res);
    return { status: res.statusCode, corpo: res.corpo };
  };
  b.avisar = (itens, quem) => b.chamar({ acao: 'avisar', itens: [].concat(itens) }, quem);
  b.bilhete = async (id, quem) => (await b.chamar({ acao: 'bilhete', id: id }, quem)).corpo.bilhete;
  b.por = (id, dados, idade) => { b.banco.ocupacoes[id] = doc(dados, idade); };
  b.mudar = (id, x) => { b.banco.ocupacoes[id] = { dados: Object.assign({}, b.banco.ocupacoes[id].dados, x), criadoEm: b.banco.ocupacoes[id].criadoEm, mudadoEm: Date.now() }; };
  return b;
}
const motivos = (r) => r.corpo.ignorados.map((x) => x.motivo);

/* ── Token ───────────────────────────────────────────────────────────── */
test('token: só o válido passa; os outros dão 401 sem ler banco nem enviar', async () => {
  const b = banca();
  b.por('p1', pontual({ decididoPor: 'coord@teste.br' }));
  const item = { acao: 'avisar', itens: [{ evento: 'aprovada', id: 'p1' }] };
  const s = Math.floor(Date.now() / 1000);
  const hs = (() => {
    const base = b64({ alg: 'HS256', kid: 'k1' }) + '.' + b64({ aud: 'ocupa-odonto', email: 'coord@teste.br' });
    return base + '.' + crypto.createHmac('sha256', par.publicKey.export({ type: 'spki', format: 'pem' })).update(base).digest('base64url');
  })();
  const bom = token('coord@teste.br');
  const trocado = (() => {
    const p = bom.split('.');
    const c = JSON.parse(Buffer.from(p[1], 'base64url')); c.email = 'outra@teste.br';
    return p[0] + '.' + b64(c) + '.' + p[2];
  })();
  const ruins = {
    expirado: token('coord@teste.br', { exp: s - 3600 }),
    'outro projeto': token('coord@teste.br', { aud: 'outro' }),
    'outro emissor': token('coord@teste.br', { iss: 'https://securetoken.google.com/outro' }),
    'sem sub': token('coord@teste.br', { sub: '' }),
    'do futuro': token('coord@teste.br', { iat: s + 9999 }),
    'sem e-mail': token('coord@teste.br', { email: undefined }),
    'e-mail não verificado': token('coord@teste.br', { email_verified: false }),
    'assinado por outra chave': token('coord@teste.br', {}, {}, outroPar.privateKey),
    'kid desconhecido': token('coord@teste.br', {}, { kid: 'k9' }),
    'kid de protótipo': token('coord@teste.br', {}, { kid: '__proto__' }),
    'alg none': b64({ alg: 'none', kid: 'k1' }) + '.' + bom.split('.')[1] + '.',
    'HS256 com a chave pública': hs,
    'corpo trocado': trocado,
    'não é JWT': 'a'.repeat(70) + '.b.c',
    vazio: 'x'
  };
  for (const nome of Object.keys(ruins)) {
    const r = await b.chamar(item, null, { headers: { authorization: 'Bearer ' + ruins[nome] } });
    assert.strictEqual(r.status, 401, nome);
    assert.deepStrictEqual(r.corpo, { ok: false, erro: 'sessao' }, nome);
  }
  assert.strictEqual((await b.chamar(item, null)).status, 401, 'sem cabeçalho');
  assert.strictEqual(b.lidos.length, 0, 'nada lido do banco');
  assert.strictEqual(b.caixa.length, 0);
  const r = await b.chamar(item, bom);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.corpo.enviados, ['Filipe Professor']);
});

/* ── Porta ───────────────────────────────────────────────────────────── */
test('GET diz o que falta, sem valor nenhum; sem configuração o POST dá 503', async () => {
  const b = banca({ env: { AVISOS_SMTP_HOST: 'smtp.invalid', AVISOS_SMTP_SENHA: 'senha-secreta', AVISOS_SEGREDO: 'curto' } });
  const g = await b.chamar('', null, { metodo: 'GET' });
  assert.strictEqual(g.status, 200);
  assert.strictEqual(g.corpo.configurado, false);
  assert.deepStrictEqual(g.corpo.faltando, ['AVISOS_SMTP_USUARIO']);
  assert.deepStrictEqual(g.corpo.invalidas, ['AVISOS_SEGREDO']);
  assert.ok(!JSON.stringify(g.corpo).includes('senha-secreta'));
  const r = await b.avisar({ evento: 'aprovada', id: 'p1' });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.corpo.erro, 'nao_configurado');
  assert.strictEqual((await b.chamar('', null, { metodo: 'DELETE' })).status, 405);
});

test('configuração inválida não é aceita', async () => {
  for (const x of [{ AVISOS_SMTP_PORTA: '25' }, { AVISOS_REMETENTE: 'sem arroba' }, { AVISOS_REMETENTE: 'a@b.c>\r\nBcc: x@y.z' },
    { AVISOS_RESPONDER_PARA: 'x' }, { AVISOS_URL: 'http://inseguro' }, { AVISOS_URL: 'javascript:alert(1)' },
    { AVISOS_LIMITE_DIA: '0' }, { AVISOS_LIMITE_DIA: 'muitos' }, { AVISOS_LIMITE_DIA: '99999' }]) {
    const b = banca({ env: Object.assign({}, ENV, x) });
    assert.strictEqual((await b.chamar('', null, { metodo: 'GET' })).corpo.configurado, false, JSON.stringify(x));
  }
});

test('duas variáveis bastam: usuário e senha de app', async () => {
  const Config = require('../../app/api/_avisos/config');
  const min = { AVISOS_SMTP_USUARIO: 'conta@teste.br', AVISOS_SMTP_SENHA: 'abcd efgh ijkl mnop' };
  const c = Config.ler(min);
  assert.deepStrictEqual([c.configurado, c.faltando, c.invalidas], [true, [], []]);
  assert.deepStrictEqual(c.smtp, { host: 'smtp.gmail.com', porta: 465, usuario: 'conta@teste.br', senha: 'abcdefghijklmnop' });
  assert.deepStrictEqual(c.remetente, { nome: 'Ocupa · não responda', endereco: 'conta+ocupa@teste.br' });
  assert.deepStrictEqual(c.responderPara, { nome: '', endereco: 'conta+ocupa@teste.br' });
  assert.strictEqual(c.responder, null, 'apelido não vira contato no rodapé');
  /* O segredo derivado: estável, diferente por senha, e nunca a senha. */
  assert.match(c.segredo, /^[0-9a-f]{64}$/);
  assert.strictEqual(Config.ler(Object.assign({}, min, { AVISOS_SMTP_SENHA: 'abcdefghijklmnop' })).segredo, c.segredo);
  assert.notStrictEqual(Config.ler(Object.assign({}, min, { AVISOS_SMTP_SENHA: 'abcd efgh ijkl mnoq' })).segredo, c.segredo);
  /* De senha escolhida por gente não se deriva segredo. */
  assert.deepStrictEqual(Config.ler(Object.assign({}, min, { AVISOS_SMTP_SENHA: 'Senha2026!' })).faltando, ['AVISOS_SEGREDO']);
  assert.deepStrictEqual(Config.ler({}).faltando, ['AVISOS_SMTP_USUARIO', 'AVISOS_SMTP_SENHA']);
  assert.deepStrictEqual(Config.ler(Object.assign({}, min, { AVISOS_SMTP_USUARIO: 'semarroba' })).faltando, ['AVISOS_REMETENTE']);
  /* E o bilhete funciona com ele. */
  const b = banca({ env: min });
  b.por('p1', pontual({}), 60000);
  const bil = await b.bilhete('p1');
  delete b.banco.ocupacoes.p1;
  assert.deepStrictEqual((await b.avisar({ evento: 'cancelada', id: 'p1', bilhete: bil })).corpo.enviados, ['Filipe Professor']);
});

test('teste de envio: só coordenação, só para si, com o aviso desligado, e com teto', async () => {
  const b = banca();
  b.banco.config.sistema.dados.parametros = {};
  let r = await b.chamar({ acao: 'teste' });
  assert.deepStrictEqual([r.status, r.corpo.enviados], [200, ['Andréa Coordenação']]);
  assert.strictEqual(b.caixa[0].para, 'coord@teste.br');
  assert.strictEqual(b.caixa[0].assunto, 'Ocupa · Teste de envio · servidor de e-mail funcionando');
  for (const quem of ['prof@teste.br', 'tec@teste.br']) assert.strictEqual((await b.chamar({ acao: 'teste' }, quem)).status, 403, quem);
  assert.strictEqual((await b.chamar({ acao: 'teste' }, 'suspensa@teste.br')).status, 403);
  for (const x of [{ para: 'vitima@fora.com' }, { texto: 'x' }, { itens: [] }]) {
    assert.strictEqual((await b.chamar(Object.assign({ acao: 'teste' }, x))).status, 400, JSON.stringify(x));
  }
  assert.strictEqual((await b.chamar({ acao: 'teste' }, null)).status, 401);
  for (let i = 0; i < 4; i++) assert.strictEqual((await b.chamar({ acao: 'teste' })).status, 200);
  assert.strictEqual((await b.chamar({ acao: 'teste' })).status, 429);
  assert.strictEqual(b.caixa.length, 5);
  assert.ok(b.caixa.every((m) => m.para === 'coord@teste.br'));
  const f = banca({ enviar: async () => [{ ok: false, codigo: 'autenticacao' }] });
  r = await f.chamar({ acao: 'teste' });
  assert.deepStrictEqual([r.corpo.ok, r.corpo.falhas[0].motivo], [false, 'autenticacao']);
  const semConfig = banca({ env: {} });
  assert.strictEqual((await semConfig.chamar({ acao: 'teste' })).status, 503);
});

test('enviar-teste: a mensagem vai marcada e só para o endereço pedido', async () => {
  const { marcar } = require('./enviar-teste');
  const { gerar } = require('./exemplos');
  const l = (await gerar(true)).map((x) => marcar(x.m, 'so-este@teste.br'));
  assert.ok(l.length >= 14);
  l.forEach((m) => {
    assert.strictEqual(m.para, 'so-este@teste.br');
    assert.ok(m.assunto.startsWith('Ocupa · TESTE · '), m.assunto);
    assert.ok(m.texto.startsWith('TESTE do Ocupa') && m.html.includes('TESTE do Ocupa'));
    assert.ok(!/exemplo\.br/.test(m.texto + m.html), 'sem endereço fictício no corpo');
  });
});

test('a resposta do professor nunca volta para a caixa que envia', async () => {
  const conta = { AVISOS_SMTP_USUARIO: 'conta@teste.br' };
  const ver = async (x) => (await banca({ env: Object.assign({}, ENV, conta, x) }).chamar('', null, { metodo: 'GET' })).corpo;
  let c = await ver({ AVISOS_REMETENTE: 'Ocupa <conta@teste.br>' });
  assert.deepStrictEqual([c.configurado, c.faltando], [false, ['AVISOS_RESPONDER_PARA']], 'remetente é a própria conta, sem Reply-To');
  c = await ver({ AVISOS_REMETENTE: 'Ocupa <CONTA@teste.br>' });
  assert.strictEqual(c.configurado, false, 'maiúscula não disfarça');
  c = await ver({ AVISOS_REMETENTE: 'Ocupa · não responda <conta+ocupa@teste.br>' });
  assert.strictEqual(c.configurado, true, 'apelido dispensa o Reply-To');
  c = await ver({ AVISOS_REMETENTE: 'Ocupa <conta@teste.br>', AVISOS_RESPONDER_PARA: 'Coordenação <contato@teste.br>' });
  assert.strictEqual(c.configurado, true);
  for (const r of ['conta@teste.br', 'Conta+x@teste.br', 'Nome <CONTA@TESTE.BR>']) {
    c = await ver({ AVISOS_REMETENTE: 'Ocupa <conta+ocupa@teste.br>', AVISOS_RESPONDER_PARA: r });
    assert.deepStrictEqual([c.configurado, c.invalidas], [false, ['AVISOS_RESPONDER_PARA']], r);
  }
});

test('outra ferramenta que lê a caixa não confunde o aviso: assunto sem sigla e nada de OS-nnn no e-mail inteiro', async () => {
  /* As mesmas leituras de quem abre chamado pela caixa de entrada. */
  const numero = /\bOS-\d{3,}\b/i, cabecalho = /X-OS-Ticket-ID:\s*(OS-\d+)/i, sigla = /[[({]([^\])}]+)[\])}]/;
  const b = banca();
  b.banco.autorizados['prof@teste.br'].dados.nome = 'Filipe OS-0331 (BS)';
  b.banco.autorizados['coord@teste.br'].dados.nome = 'Andréa os-12 [PE]';
  b.banco.disciplinas.d1.dados.nome = '[BS] Clínica (prática) {OS-0417}';
  b.banco.clinicas.cl1.dados.nome = 'Clínica OS-0999';
  b.por('p1', pontual({ situacao: 'recusada', decididoPor: 'coord@teste.br', descricao: 'OS\u200b-0263 · T1 OS-\n0263',
    motivoRecusa: 'Veja a Os-0263. X-OS-Ticket-ID: OS-5' }));
  b.por('p2', pontual({}), 60000);
  const bil = await b.bilhete('p2');
  b.mudar('p2', { descricao: 'mudou por causa da OS-7777', editadoPor: 'coord@teste.br' });
  await b.avisar([{ evento: 'recusada', id: 'p1' }]);
  await b.avisar([{ evento: 'editada', id: 'p2', bilhete: bil }]);
  assert.strictEqual(b.caixa.length, 2);
  b.caixa.forEach((m) => {
    assert.ok(m.assunto.startsWith('Ocupa · '), m.assunto);
    assert.ok(!sigla.test(m.assunto) && !/[[\](){}]/.test(m.assunto), m.assunto);
    assert.ok(m.assunto.includes('Clínica prática OS 0417'), m.assunto);
    ['assunto', 'texto', 'html'].forEach((k) => {
      assert.ok(!numero.test(m[k]) && !cabecalho.test(m[k]) && !/\bOS-\d/i.test(m[k]), k + ': ' + m[k]);
    });
    assert.ok(!numero.test(m.html.replace(/<[^>]*>/g, '')), 'html sem as marcas');
  });
  assert.ok(b.caixa[0].texto.includes('OS 0263'), 'o texto segue legível');
});

test('rodapé: não responda, com o contato configurado e sem inventar endereço', async () => {
  const com = banca({ env: Object.assign({}, ENV, { AVISOS_RESPONDER_PARA: 'Coordenação <contato@teste.br>' }) });
  com.por('p1', pontual({ decididoPor: 'coord@teste.br' }));
  await com.avisar({ evento: 'aprovada', id: 'p1' });
  const sem = banca();
  sem.por('p1', pontual({ decididoPor: 'coord@teste.br' }));
  await sem.avisar({ evento: 'aprovada', id: 'p1' });
  for (const k of ['texto', 'html']) {
    assert.ok(com.caixa[0][k].includes('Não responda a este e-mail') && com.caixa[0][k].includes('contato@teste.br'));
    assert.ok(sem.caixa[0][k].includes('procure a coordenação do curso') && !/@/.test(sem.caixa[0][k]));
  }
});

test('tentativa de escolher destinatário ou texto derruba o pedido inteiro', async () => {
  const b = banca();
  b.por('p1', pontual({ decididoPor: 'coord@teste.br' }));
  const it = { evento: 'aprovada', id: 'p1' };
  const ruins = [
    { acao: 'avisar', itens: [it], para: 'vitima@fora.com' },
    { acao: 'avisar', itens: [it], destinatario: 'vitima@fora.com' },
    { acao: 'avisar', itens: [Object.assign({ para: 'vitima@fora.com' }, it)] },
    { acao: 'avisar', itens: [Object.assign({ responsavelId: 'vitima@fora.com' }, it)] },
    { acao: 'avisar', itens: [Object.assign({ texto: 'clique aqui' }, it)] },
    { acao: 'avisar', itens: [Object.assign({ assunto: 'x', html: '<b>x</b>' }, it)] },
    { acao: 'avisar', itens: [Object.assign({ motivo: 'texto livre' }, it)] },
    { acao: 'avisar', itens: [it, { evento: 'aprovada', id: 'p1', cc: 'x@y.z' }] },
    { acao: 'bilhete', id: 'p1', dados: { responsavelId: 'vitima@fora.com' } }
  ];
  for (const r of ruins) {
    const resp = await b.chamar(r);
    assert.strictEqual(resp.status, 400, JSON.stringify(r));
    assert.strictEqual(resp.corpo.erro, 'pedido_invalido');
  }
  assert.strictEqual(b.caixa.length, 0);
  assert.strictEqual(b.lidos.length, 0);
});

test('formato do pedido: evento, id, data, quantidade, tipo e tamanho', async () => {
  const b = banca();
  const um = (x) => b.chamar({ acao: 'avisar', itens: [Object.assign({ evento: 'aprovada', id: 'p1' }, x)] });
  for (const x of [{ evento: 'inventado' }, { evento: 'constructor' }, { id: '../config/sistema' }, { id: 'a/b' }, { id: '' }, { id: 7 },
    { data: '2026-12-01' }, { evento: 'restaurada' }, { evento: 'restaurada', data: '01/12/2026' }, { evento: 'cancelada', data: { a: 1 } }, { bilhete: 1 }]) {
    assert.strictEqual((await um(x)).status, 400, JSON.stringify(x));
  }
  for (const c of [{ acao: 'avisar', itens: [] }, { acao: 'avisar' }, { acao: 'avisar', itens: {} }, { acao: 'outra' }, [], 'null', '{quebrado', '"texto"',
    { acao: 'avisar', itens: Array.from({ length: 31 }, () => ({ evento: 'aprovada', id: 'p1' })) }]) {
    assert.strictEqual((await b.chamar(c)).status, 400, JSON.stringify(c).slice(0, 60));
  }
  assert.strictEqual((await b.chamar({}, undefined, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.strictEqual((await b.chamar('{"acao":"' + 'a'.repeat(500000) + '"}')).status, 413);
  assert.strictEqual(b.caixa.length, 0);
});

test('interruptor: ausente ou falso no banco não envia nada', async () => {
  for (const p of [{}, { enviarEmails: false }, { enviarEmails: 'true' }, { enviarEmails: 1 }]) {
    const b = banca();
    b.banco.config.sistema.dados.parametros = p;
    b.por('p1', pontual({ decididoPor: 'coord@teste.br' }));
    const r = await b.avisar({ evento: 'aprovada', id: 'p1' });
    assert.strictEqual(r.corpo.desligado, true);
    assert.strictEqual(b.caixa.length, 0);
  }
  const b = banca();
  delete b.banco.config.sistema;
  b.por('p1', pontual({ decididoPor: 'coord@teste.br' }));
  assert.strictEqual((await b.avisar({ evento: 'aprovada', id: 'p1' })).corpo.desligado, true);
});

test('quem não está ativo em autorizados não passa (Security Rules)', async () => {
  const b = banca();
  b.por('p1', pontual({ decididoPor: 'coord@teste.br' }));
  for (const quem of ['suspensa@teste.br', 'estranho@fora.com']) {
    const r = await b.avisar({ evento: 'aprovada', id: 'p1' }, quem);
    assert.strictEqual(r.status, 403, quem);
    assert.strictEqual((await b.chamar({ acao: 'bilhete', id: 'p1' }, quem)).status, 403);
  }
  assert.strictEqual(b.caixa.length, 0);
});

/* ── Eventos ─────────────────────────────────────────────────────────── */
test('criada, aprovada, recusada, excluída, encerrada, cancelada e restaurada: mensagem certa para a pessoa certa', async () => {
  const casos = [
    ['criada', pontual({}), {}, 'Reserva confirmada', /registrou esta reserva em seu nome/],
    ['criada', recorrente({ excecoes: [{ data: '2026-12-02', motivo: 'x', registradoPor: 'coord@teste.br' }] }), {}, 'Reserva confirmada', /Sem encontro em: 02\/12\/2026/],
    ['criada', pontual({ situacao: 'pendente', cadeirasAlocadas: undefined }), {}, 'Pedido registrado', /aguarda aprovação/],
    ['aprovada', pontual({ decididoPor: 'coord@teste.br' }), {}, 'Reserva confirmada', /pedido foi aprovado/],
    ['recusada', pontual({ situacao: 'recusada', decididoPor: 'coord@teste.br', motivoRecusa: 'Clínica em obra', cadeirasAlocadas: undefined }), {}, 'Pedido recusado', /Motivo: Clínica em obra/],
    ['recusada', pontual({ situacao: 'recusada', decididoPor: 'coord@teste.br', motivoRecusa: '' }), {}, 'Pedido recusado', /Motivo: não informado/],
    ['excluida', recorrente({ excluidaEm: '2026-11-25 10:00', excluidaPor: 'coord@teste.br', motivoExclusao: 'Duplicada' }), {}, 'Reserva excluída', /Motivo: Duplicada/],
    ['encerrada', recorrente({ encerradaEm: '2026-11-30' }), {}, 'Recorrência encerrada', /Encerrada a partir de: segunda-feira, 30\/11\/2026/],
    ['cancelada', recorrente({ excecoes: [{ data: '2026-12-07', motivo: 'Feriado', registradoPor: 'coord@teste.br' }] }), { data: '2026-12-07' }, 'Encontro cancelado', /Motivo: Feriado[\s\S]*Encontro: segunda-feira, 07\/12\/2026/],
    ['restaurada', recorrente({}), { data: '2026-12-07' }, 'Encontro restaurado', /segunda-feira, 07\/12\/2026, que estava cancelado, voltou a valer/]
  ];
  for (const [evento, dados, extra, titulo, trecho] of casos) {
    const b = banca();
    b.por('x1', dados);
    const r = await b.avisar(Object.assign({ evento: evento, id: 'x1' }, extra));
    assert.deepStrictEqual(r.corpo.enviados, ['Filipe Professor'], evento + ' ' + JSON.stringify(r.corpo));
    assert.strictEqual(b.caixa.length, 1);
    const m = b.caixa[0];
    assert.strictEqual(m.para, 'prof@teste.br');
    assert.ok(m.assunto.startsWith('Ocupa · ' + titulo + ' · Clínica Integrada I, '), m.assunto);
    assert.match(m.texto, trecho);
    assert.ok(m.texto.startsWith('Olá, Filipe Professor.'));
    for (const l of ['Disciplina: ODO-301 · Clínica Integrada I', 'Descrição/Turma: T', 'Clínica: Clínica ', 'Cadeiras: ', 'Horário: ',
      'por: Andréa Coordenação (coordenação)', 'Abrir o sistema: https://controle-de-clinicas-odonto.vercel.app']) {
      assert.ok(m.texto.includes(l), evento + ' sem ' + l);
    }
  }
});

test('editada: de → para, e troca de professor avisa os dois', async () => {
  const b = banca();
  b.por('p1', pontual({}), 60000);
  const bil = await b.bilhete('p1');
  b.mudar('p1', { inicio: '13:40', fim: '17:20', escopo: 'b', cadeirasAlocadas: faixa(15, 24), cadeirasPedidas: 10,
    data: '2026-12-02', descricao: 'T1 · manhã trocada', disciplinaId: 'd2', tipoAtividade: 'pos', editadoPor: 'coord@teste.br' });
  let r = await b.avisar({ evento: 'editada', id: 'p1', bilhete: bil });
  assert.deepStrictEqual(r.corpo.enviados, ['Filipe Professor']);
  const t = b.caixa[0].texto;
  for (const l of [
    'Disciplina: de "ODO-301 · Clínica Integrada I" para "Pós-graduação · Endodontia"',
    'Tipo: de "Graduação" para "Pós-graduação"',
    'Descrição/Turma: de "T1 · atendimento" para "T1 · manhã trocada"',
    'Clínica: de "Clínica 1" para "Clínica 2"',
    'Cadeiras: de "6 cadeiras: 1–6" para "10 cadeiras: 15–24"',
    'Data: de "terça-feira, 01/12/2026" para "quarta-feira, 02/12/2026"',
    'Horário: de "07:40 às 11:20" para "13:40 às 17:20"'
  ]) assert.ok(t.includes(l), l + '\n' + t);

  const b2 = banca();
  b2.por('r1', recorrente({}), 60000);
  const bil2 = await b2.bilhete('r1');
  b2.mudar('r1', { responsavelId: 'outra@teste.br', dias: [2], vigenciaFim: '2026-12-10', editadoPor: 'coord@teste.br' });
  r = await b2.avisar({ evento: 'editada', id: 'r1', bilhete: bil2 });
  assert.deepStrictEqual(r.corpo.enviados.sort(), ['Filipe Professor', 'Marina Professora']);
  const velho = b2.caixa.find((m) => m.para === 'prof@teste.br'), novo = b2.caixa.find((m) => m.para === 'outra@teste.br');
  assert.match(velho.texto, /passou a ter outra pessoa como professor coordenador/);
  assert.match(novo.texto, /alterou a sua reserva/);
  assert.ok(novo.texto.includes('Dias: de "seg e qua" para "ter"'));
  assert.ok(novo.texto.includes('Professor coordenador: de "Filipe Professor" para "Marina Professora"'));

  const b3 = banca();
  b3.por('p1', pontual({}), 60000);
  const bil3 = await b3.bilhete('p1');
  b3.mudar('p1', { cor: 'verde', editadoPor: 'coord@teste.br' });
  r = await b3.avisar({ evento: 'editada', id: 'p1', bilhete: bil3 });
  assert.deepStrictEqual(motivos(r), ['sem_mudanca']);
  assert.strictEqual(b3.caixa.length, 0);

  const b4 = banca();
  b4.por('p1', pontual({ situacao: 'pendente', cadeirasAlocadas: undefined }), 60000);
  const bil4 = await b4.bilhete('p1');
  b4.mudar('p1', { inicio: '18:20', fim: '22:00', editadoPor: 'coord@teste.br' });
  await b4.avisar({ evento: 'editada', id: 'p1', bilhete: bil4 });
  assert.ok(b4.caixa[0].assunto.startsWith('Ocupa · Pedido alterado · '));
  assert.match(b4.caixa[0].texto, /continua aguardando aprovação/);
});

test('cadeiras: coordenação ou professor vinculado avisa o responsável; o próprio não recebe', async () => {
  const b = banca();
  b.por('p1', pontual({}), 60000);
  const bil = await b.bilhete('p1', 'outra@teste.br');
  b.mudar('p1', { cadeirasAlocadas: [2, 3, 9], cadeirasPedidas: 3 });
  let r = await b.avisar({ evento: 'cadeiras', id: 'p1', bilhete: bil }, 'outra@teste.br');
  assert.deepStrictEqual(r.corpo.enviados, ['Filipe Professor']);
  assert.ok(b.caixa[0].texto.includes('Cadeiras: de "6 cadeiras: 1–6" para "3 cadeiras: 2–3, 9"'));
  assert.ok(b.caixa[0].texto.includes('Alteradas por: Marina Professora\r\n'));

  const b2 = banca();
  b2.por('p1', pontual({}), 60000);
  const bil2 = await b2.bilhete('p1', 'prof@teste.br');
  b2.mudar('p1', { cadeirasAlocadas: [1], cadeirasPedidas: 1 });
  r = await b2.avisar({ evento: 'cadeiras', id: 'p1', bilhete: bil2 }, 'prof@teste.br');
  assert.deepStrictEqual(motivos(r), ['proprio']);
  assert.strictEqual(b2.caixa.length, 0);
});

test('cadeiras: vínculo herdado da turma (legado) vale para o professor', async () => {
  const b = banca();
  delete b.banco.disciplinas.d1.dados.professores;
  b.banco.turmas.t2 = doc({ disciplinaId: 'd1', codigo: '2', professorCoordenadorId: 'outra@teste.br' });
  b.por('p1', pontual({}), 60000);
  const bil = await b.bilhete('p1', 'outra@teste.br');
  b.mudar('p1', { cadeirasAlocadas: [1], cadeirasPedidas: 1 });
  const r = await b.avisar({ evento: 'cadeiras', id: 'p1', bilhete: bil }, 'outra@teste.br');
  assert.deepStrictEqual(r.corpo.enviados, ['Filipe Professor']);
});

test('pontual cancelada: o documento sumiu, e o bilhete diz de quem era', async () => {
  const b = banca();
  b.por('p1', pontual({}), 60000);
  const bil = await b.bilhete('p1');
  let r = await b.avisar({ evento: 'cancelada', id: 'p1', bilhete: bil });
  assert.deepStrictEqual(motivos(r), ['nao_confere'], 'ainda existe');
  delete b.banco.ocupacoes.p1;
  r = await b.avisar({ evento: 'cancelada', id: 'p1' });
  assert.deepStrictEqual(motivos(r), ['sem_bilhete']);
  r = await b.avisar({ evento: 'cancelada', id: 'p1', bilhete: bil });
  assert.deepStrictEqual(r.corpo.enviados, ['Filipe Professor']);
  assert.ok(b.caixa[0].assunto.startsWith('Ocupa · Reserva cancelada · Clínica Integrada I, 01/12 07:40–11:20'));
  r = await b.avisar({ evento: 'cancelada', id: 'p1', bilhete: bil });
  assert.deepStrictEqual(motivos(r), ['repetido']);
  assert.strictEqual(b.caixa.length, 1);
});

test('recuperada: mostra as cadeiras novas quando mudaram', async () => {
  const b = banca();
  b.por('p1', pontual({ excluidaEm: '2026-11-20 08:00', excluidaPor: 'coord@teste.br' }), 60000);
  const bil = await b.bilhete('p1');
  b.mudar('p1', { excluidaEm: null, excluidaPor: null, cadeirasAlocadas: faixa(7, 12) });
  await b.avisar({ evento: 'recuperada', id: 'p1', bilhete: bil });
  assert.ok(b.caixa[0].texto.includes('Cadeiras: de "6 cadeiras: 1–6" para "6 cadeiras: 7–12"'));
  assert.match(b.caixa[0].texto, /tomadas por outra reserva/);
  const b2 = banca();
  b2.por('p1', pontual({ excluidaEm: '2026-11-20 08:00' }), 60000);
  const bil2 = await b2.bilhete('p1');
  b2.mudar('p1', { excluidaEm: null });
  await b2.avisar({ evento: 'recuperada', id: 'p1', bilhete: bil2 });
  assert.ok(!b2.caixa[0].texto.includes('O que mudou'));
});

test('legado: reserva por turma e integral, pré-clínica e ambiente sem cadeira', async () => {
  const b = banca();
  b.por('velha', { tipo: 'recorrente', agrupamentoId: 'ag1', escopo: 'ambas', turmaId: 't1', dias: [5], inicio: '07:40', fim: '11:20',
    vigenciaInicio: '2026-08-03', vigenciaFim: '2026-12-19', excecoes: [], encerradaEm: '2026-12-01' });
  b.por('pre', pontual({ agrupamentoId: 'ag5', cadeirasPedidas: 70, cadeirasAlocadas: faixa(1, 70), decididoPor: 'coord@teste.br' }));
  b.por('lab', pontual({ agrupamentoId: 'ag7', cadeirasPedidas: null, cadeirasAlocadas: null, decididoPor: 'coord@teste.br', disciplinaId: null }));
  const r = await b.avisar([{ evento: 'encerrada', id: 'velha' }, { evento: 'aprovada', id: 'pre' }, { evento: 'aprovada', id: 'lab' }]);
  assert.deepStrictEqual(r.corpo.enviados, ['Filipe Professor']);
  const t = b.caixa[0].texto;
  assert.strictEqual(b.caixa[0].assunto, 'Ocupa · 3 atualizações nas suas reservas');
  for (const l of ['Descrição/Turma: Turma 1', 'Clínica: Clínicas 1 e 2', 'Cadeiras: As duas clínicas inteiras (28 cadeiras)',
    'Cadeiras: Pré-clínica inteira (70 cadeiras)', 'Cadeiras: Ambiente inteiro', 'Disciplina: Outros (sem disciplina)']) assert.ok(t.includes(l), l + '\n' + t);
});

test('várias linhas do mesmo envio: um e-mail por pessoa', async () => {
  const b = banca();
  ['p1', 'p2', 'p3'].forEach((id, i) => b.por(id, pontual({ data: '2026-12-0' + (i + 1) })));
  b.por('p4', pontual({ responsavelId: 'outra@teste.br' }));
  b.por('p5', pontual({ responsavelId: 'coord@teste.br' }));
  const r = await b.avisar(['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ evento: 'criada', id: id })));
  assert.deepStrictEqual(r.corpo.enviados, ['Filipe Professor', 'Marina Professora']);
  assert.deepStrictEqual(motivos(r), ['proprio']);
  assert.strictEqual(b.caixa.length, 2);
  assert.strictEqual(b.caixa[0].assunto, 'Ocupa · 3 reservas confirmadas');
  assert.strictEqual((b.caixa[0].texto.match(/RESERVA CONFIRMADA/g) || []).length, 3);
});

/* ── Permissão e confirmação no banco ────────────────────────────────── */
test('professor e técnico não disparam aviso de ação da coordenação', async () => {
  for (const quem of ['outra@teste.br', 'tec@teste.br']) {
    const b = banca();
    b.por('p1', pontual({ decididoPor: quem, criadoPor: quem, editadoPor: quem, excluidaPor: quem }), 1000);
    b.por('r1', recorrente({ encerradaEm: '2026-12-01', excecoes: [{ data: '2026-12-07', motivo: 'spam', registradoPor: quem }] }));
    b.por('x1', pontual({ excluidaEm: '2026-11-25 10:00', excluidaPor: quem }));
    const bil = await b.bilhete('p1', quem);
    b.mudar('p1', { inicio: '13:40', fim: '17:20' });
    const r = await b.avisar([
      { evento: 'criada', id: 'p1' }, { evento: 'aprovada', id: 'p1' }, { evento: 'recusada', id: 'p1' },
      { evento: 'editada', id: 'p1', bilhete: bil }, { evento: 'cancelada', id: 'r1', data: '2026-12-07' },
      { evento: 'restaurada', id: 'r1', data: '2026-12-09' }, { evento: 'encerrada', id: 'r1' }, { evento: 'excluida', id: 'x1' }
    ], quem);
    assert.deepStrictEqual(motivos(r), Array(8).fill('sem_permissao'), quem);
    assert.strictEqual(b.caixa.length, 0);
  }
  const b = banca();
  b.por('p1', pontual({ disciplinaId: 'd2' }), 60000);
  const bil = await b.bilhete('p1', 'outra@teste.br');
  b.mudar('p1', { cadeirasAlocadas: [1] });
  assert.deepStrictEqual(motivos(await b.avisar({ evento: 'cadeiras', id: 'p1', bilhete: bil }, 'outra@teste.br')), ['sem_permissao']);
});

test('o banco precisa confirmar: gravação antiga, de outra pessoa ou de outro estado não avisa', async () => {
  const b = banca();
  b.por('velha', pontual({ decididoPor: 'coord@teste.br' }), 3600000);
  b.por('outra', pontual({ decididoPor: 'alguem@teste.br' }));
  b.por('pend', pontual({ situacao: 'pendente', decididoPor: 'coord@teste.br' }));
  b.por('rec', recorrente({}));
  b.por('naoexc', pontual({}));
  const r = await b.avisar([
    { evento: 'aprovada', id: 'velha' }, { evento: 'aprovada', id: 'outra' }, { evento: 'aprovada', id: 'pend' },
    { evento: 'aprovada', id: 'rec' }, { evento: 'recusada', id: 'outra' }, { evento: 'encerrada', id: 'rec' },
    { evento: 'excluida', id: 'naoexc' }, { evento: 'cancelada', id: 'rec', data: '2026-12-07' },
    { evento: 'restaurada', id: 'rec', data: '2026-12-08' }, { evento: 'restaurada', id: 'rec', data: '2027-03-01' },
    { evento: 'aprovada', id: 'naoexiste' }, { evento: 'criada', id: 'velha' }
  ]);
  assert.deepStrictEqual(motivos(r), Array(12).fill('nao_confere'));
  assert.strictEqual(b.caixa.length, 0);
});

test('destinatário: só pessoa ativa de autorizados, e endereço que cabe no envelope', async () => {
  const b = banca();
  b.banco.autorizados['ruim>@x.br'] = doc({ nome: 'Ruim', nivel: 'professor', ativo: true });
  b.banco.autorizados['semcampo@teste.br'] = doc({ nome: 'Sem campo ativo', nivel: 'professor' });
  [['p1', 'suspensa@teste.br'], ['p2', 'vitima@fora.com'], ['p3', 'prof@teste.br\r\nBcc: x@y.z'], ['p4', 'ruim>@x.br'], ['p6', 'semcampo@teste.br']].forEach(([id, resp]) => {
    b.por(id, pontual({ decididoPor: 'coord@teste.br', responsavelId: resp }));
  });
  const r = await b.avisar(['p1', 'p2', 'p3', 'p4', 'p6'].map((id) => ({ evento: 'aprovada', id: id })));
  assert.deepStrictEqual(motivos(r), Array(5).fill('sem_acesso'));
  assert.strictEqual(b.caixa.length, 0);
  b.por('p5', pontual({ decididoPor: 'coord@teste.br', responsavelId: null }));
  assert.deepStrictEqual(motivos(await b.avisar({ evento: 'aprovada', id: 'p5' })), ['sem_responsavel']);
});

test('bilhete: adulterado, de outra pessoa, de outra reserva ou vencido não vale', async () => {
  const b = banca();
  b.por('p1', pontual({}), 60000);
  b.por('p2', pontual({}), 60000);
  const bil = await b.bilhete('p1');
  const p = bil.split('.');
  const c = JSON.parse(Buffer.from(p[0], 'base64url'));
  c.d.responsavelId = 'outra@teste.br';
  const falso = b64(c) + '.' + p[1];
  const reassinado = b64(c) + '.' + crypto.createHmac('sha256', 'chute').update('ocupa.bilhete.v1.' + b64(c)).digest('base64url');
  const deOutra = await b.bilhete('p1', 'outra@teste.br');
  const deP2 = await b.bilhete('p2');
  delete b.banco.ocupacoes.p1;
  for (const x of [falso, reassinado, deOutra, deP2, p[0] + '.', 'lixo', p[0] + '.' + p[1] + '.z', 'x'.repeat(70000)]) {
    assert.deepStrictEqual(motivos(await b.avisar({ evento: 'cancelada', id: 'p1', bilhete: x })), ['sem_bilhete'], x.slice(0, 30));
  }
  b.relogio = 61 * 60 * 1000;
  assert.deepStrictEqual(motivos(await b.chamar({ acao: 'avisar', itens: [{ evento: 'cancelada', id: 'p1', bilhete: bil }] },
    token('coord@teste.br', { exp: Math.floor(Date.now() / 1000) + 99999 }))), ['sem_bilhete']);
  assert.strictEqual(b.caixa.length, 0);
  assert.strictEqual((await b.chamar({ acao: 'bilhete', id: 'naoexiste' }, token('coord@teste.br', { exp: Math.floor(Date.now() / 1000) + 99999 }))).status, 404);
});

test('conteúdo do banco é escapado no HTML e não vira cabeçalho', async () => {
  const b = banca();
  b.banco.autorizados['coord@teste.br'].dados.nome = 'Ana\r\nBcc: vitima@fora.com <script>alert(1)</script>';
  b.banco.disciplinas.d1.dados.nome = 'Clínica <img src=x onerror=alert(1)>\r\nSubject: outro';
  b.por('p1', pontual({ situacao: 'recusada', decididoPor: 'coord@teste.br',
    motivoRecusa: '</td><a href="https://mal.example">clique</a>\n.\r\nQUIT', descricao: '"><svg/onload=alert(1)>‮oculto' }));
  await b.avisar({ evento: 'recusada', id: 'p1' });
  const m = b.caixa[0];
  assert.ok(!/<(script|img|svg)/i.test(m.html), 'marcação do banco no HTML');
  assert.ok(!m.html.includes('<a href="https://mal.example'));
  assert.ok(m.html.includes('&lt;script&gt;') || m.html.includes('&lt;img'));
  assert.ok(!/[\r\n]/.test(m.assunto));
  assert.ok(!m.texto.includes('‮'));
  const mime = Smtp.montarMime({ remetente: { nome: 'Ocupa\r\nBcc: x@y.z', endereco: 'ocupa@teste.br' } }, m, Date.now());
  const cab = mime.split('\r\n\r\n')[0];
  assert.ok(!/^Bcc:/im.test(cab));
  assert.strictEqual((cab.match(/^Subject:/gim) || []).length, 1);
  assert.strictEqual((cab.match(/^To:/gim) || []).length, 1);
  assert.ok(cab.split('\r\n').every((l) => l.length <= 120), 'linha longa no cabeçalho');
});

/* ── Falha, repetição e volume ───────────────────────────────────────── */
test('falha de envio: diz que falhou, não marca como enviado e o log não traz endereço', async () => {
  let falhar = true;
  const b = banca({ enviar: async (cfg, msgs) => msgs.map(() => (falhar ? { ok: false, codigo: 'conexao' } : { ok: true })) });
  b.por('p1', pontual({ decididoPor: 'coord@teste.br' }));
  let r = await b.avisar({ evento: 'aprovada', id: 'p1' });
  assert.strictEqual(r.corpo.ok, false);
  assert.deepStrictEqual(r.corpo.falhas, [{ nome: 'Filipe Professor', motivo: 'conexao' }]);
  falhar = false;
  r = await b.avisar({ evento: 'aprovada', id: 'p1' });
  assert.deepStrictEqual(r.corpo.enviados, ['Filipe Professor']);
  r = await b.avisar({ evento: 'aprovada', id: 'p1' });
  assert.deepStrictEqual(motivos(r), ['repetido']);
  assert.ok(b.logs.length && !/@|Filipe|senha/.test(b.logs.join(' ')));
});

test('erro inesperado vira 500 genérico, sem detalhe no corpo nem no log', async () => {
  const b = banca({ enviar: async () => { throw new Error('prof@teste.br senha-secreta'); } });
  b.por('p1', pontual({ decididoPor: 'coord@teste.br' }));
  const r = await b.avisar({ evento: 'aprovada', id: 'p1' });
  assert.deepStrictEqual([r.status, r.corpo], [500, { ok: false, erro: 'interno' }]);
  assert.ok(!/@|senha/.test(b.logs.join(' ')));
});

test('limite de pedidos por pessoa', async () => {
  const b = banca();
  let ultimo;
  for (let i = 0; i < 61; i++) ultimo = await b.avisar({ evento: 'aprovada', id: 'naoexiste' });
  assert.strictEqual(ultimo.status, 429);
  assert.strictEqual((await b.avisar({ evento: 'aprovada', id: 'x' }, 'prof@teste.br')).status, 200, 'outra pessoa segue');
});

test('teto do dia: depois dele ninguém mais recebe, e a cota das outras ferramentas fica de pé', async () => {
  const b = banca({ env: Object.assign({}, ENV, { AVISOS_LIMITE_DIA: '3' }) });
  for (let i = 1; i <= 5; i++) b.por('p' + i, pontual({ decididoPor: 'coord@teste.br' }));
  const status = [];
  for (let i = 1; i <= 5; i++) status.push((await b.avisar({ evento: 'aprovada', id: 'p' + i })).status);
  assert.deepStrictEqual(status, [200, 200, 200, 429, 429]);
  assert.strictEqual(b.caixa.length, 3);
  b.relogio = 25 * 60 * 60 * 1000;
  b.por('p9', pontual({ decididoPor: 'coord@teste.br' }));
  b.banco.ocupacoes.p9.mudadoEm += b.relogio;
  const r = await b.chamar({ acao: 'avisar', itens: [{ evento: 'aprovada', id: 'p9' }] }, token('coord@teste.br', { exp: Math.floor(Date.now() / 1000) + 999999 }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(b.caixa.length, 4, 'no dia seguinte volta');
});

test('a função só lê: nenhum pedido ao Firestore grava', async () => {
  const b = banca();
  const vistos = [];
  const fake = BancoFalso.criar({ banco: () => b.banco });
  const atender = Atender.criar({
    env: ENV, log: () => {}, enviar: async (c, m) => m.map(() => ({ ok: true })),
    verificar: async () => ({ uid: 'u', email: 'coord@teste.br', nome: '' }),
    buscar: async (url, o) => { vistos.push((o && o.method) || 'GET'); return fake.buscar(url, o); }
  });
  b.por('p1', pontual({ decididoPor: 'coord@teste.br' }));
  const req = Readable.from([Buffer.from(JSON.stringify({ acao: 'avisar', itens: [{ evento: 'aprovada', id: 'p1' }] }))]);
  req.method = 'POST'; req.headers = { 'content-type': 'application/json', authorization: 'Bearer abc' };
  const res = { setHeader() {}, end(t) { this.corpo = JSON.parse(t); } };
  await atender(req, res);
  assert.deepStrictEqual(res.corpo.enviados, ['Filipe Professor']);
  assert.ok(vistos.length && vistos.every((m) => m === 'GET'));
});

/* ── SMTP ────────────────────────────────────────────────────────────── */
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ocupa-smtp-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '//CN=localhost',
  '-addext', 'subjectAltName=DNS:localhost', '-keyout', path.join(pasta, 'k.pem'), '-out', path.join(pasta, 'c.pem')], { stdio: 'ignore' });
const chave = fs.readFileSync(path.join(pasta, 'k.pem')), cert = fs.readFileSync(path.join(pasta, 'c.pem'));
test.after(() => fs.rmSync(pasta, { recursive: true, force: true }));

const MSG = { para: 'prof@teste.br', assunto: 'Reserva confirmada: Clínica Integrada I é ótima e o assunto é bem comprido — 01/12', texto: 'Olá, ação\r\n.ponto', html: '<b>Olá, ação</b>' };
async function comServidor(op, fn, tlsCliente) {
  const s = SmtpFalso.criar(Object.assign({ chave: chave, cert: cert }, op));
  const porta = await s.ouvir();
  const cfg = {
    smtp: { host: 'localhost', porta: porta, usuario: 'conta@teste.br', senha: 'sênha' },
    remetente: { nome: 'Ocupa · não responda', endereco: 'conta+ocupa@teste.br' }, responderPara: { nome: 'Coordenação', endereco: 'contato@teste.br' }
  };
  try {
    return await fn((msgs) => Smtp.enviar(cfg, msgs, { tls: Object.assign({ direto: !!op.direto }, tlsCliente || { ca: cert }) }), s.estado);
  } finally { await s.fechar(); }
}
function partes(mime) {
  return mime.split(/--ocupa-[0-9a-f]+(?:--)?/).slice(1).map((x) => Buffer.from((x.split('\r\n\r\n')[1] || '').replace(/\s/g, ''), 'base64').toString('utf8'));
}

for (const direto of [true, false]) {
  test('smtp: envia por ' + (direto ? 'TLS direto' : 'STARTTLS'), async () => {
    await comServidor({ direto: direto }, async (enviar, e) => {
      assert.deepStrictEqual(await enviar([MSG, Object.assign({}, MSG, { para: 'outra@teste.br' })]), [{ ok: true }, { ok: true }]);
      assert.strictEqual(e.recebidas.length, 2);
      assert.deepStrictEqual(e.recebidas.map((r) => [r.de, r.para]), [
        ['MAIL FROM:<conta+ocupa@teste.br>', ['RCPT TO:<prof@teste.br>']], ['MAIL FROM:<conta+ocupa@teste.br>', ['RCPT TO:<outra@teste.br>']]]);
      assert.deepStrictEqual(e.logins, [['conta@teste.br', 'sênha']]);
      assert.ok(e.comandos.filter((c) => /AUTH|MAIL|RCPT|DATA/.test(c)).every((c) => c.startsWith('S ')), 'nada sensível em claro');
      const mime = e.recebidas[0].corpo;
      const cab = mime.split('\r\n\r\n')[0].replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, x) => Buffer.from(x, 'base64').toString());
      for (const l of ['From: Ocupa · não responda <conta+ocupa@teste.br>', 'Reply-To: Coordenação <contato@teste.br>', 'To: <prof@teste.br>',
        'Auto-Submitted: auto-generated', 'X-Auto-Response-Suppress: All']) assert.ok(cab.split('\r\n').includes(l), l + '\n' + cab);
      const p = partes(mime);
      assert.strictEqual(p[0], MSG.texto);
      assert.strictEqual(p[1], MSG.html);
      const assunto = /Subject: ([\s\S]*?)\r\nDate:/.exec(mime)[1].replace(/\r\n /g, '').replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, t) => Buffer.from(t, 'base64').toString());
      assert.strictEqual(assunto, MSG.assunto);
    });
  });
}
test('smtp: AUTH LOGIN quando é o que o servidor oferece', async () => {
  await comServidor({ direto: true, auth: 'LOGIN' }, async (enviar, e) => {
    assert.deepStrictEqual(await enviar([MSG]), [{ ok: true }]);
    assert.deepStrictEqual(e.logins, [['conta@teste.br', 'sênha']]);
  });
});
test('smtp: certificado não confiável é recusado antes da senha', async () => {
  for (const direto of [true, false]) {
    await comServidor({ direto: direto }, async (enviar, e) => {
      assert.deepStrictEqual(await enviar([MSG]), [{ ok: false, codigo: 'tls' }]);
      assert.strictEqual(e.logins.length, 0);
    }, {});
  }
});
test('smtp: sem STARTTLS não autentica', async () => {
  await comServidor({ direto: false, starttls: false }, async (enviar, e) => {
    assert.deepStrictEqual(await enviar([MSG]), [{ ok: false, codigo: 'tls' }]);
    assert.strictEqual(e.logins.length, 0);
    assert.strictEqual(e.recebidas.length, 0);
  });
});
test('smtp: resposta plantada antes do TLS é descartada', async () => {
  await comServidor({ direto: false, plantar: '250 plantado\r\n' }, async (enviar, e) => {
    const r = await enviar([MSG]);
    /* Ou o TLS falha por causa do lixo, ou segue sem obedecê-lo. */
    assert.ok(r[0].ok ? e.recebidas.length === 1 : e.logins.length === 0);
  });
});
test('smtp: login recusado, cota e destinatário recusado', async () => {
  await comServidor({ direto: true, recusarLogin: true }, async (enviar, e) => {
    assert.deepStrictEqual(await enviar([MSG, MSG]), [{ ok: false, codigo: 'autenticacao' }, { ok: false, codigo: 'autenticacao' }]);
    assert.strictEqual(e.recebidas.length, 0);
  });
  await comServidor({ direto: true, semCota: true }, async (enviar) => {
    assert.deepStrictEqual(await enviar([MSG]), [{ ok: false, codigo: 'cota' }]);
  });
  await comServidor({ direto: true, recusarPara: 'ruim@' }, async (enviar, e) => {
    assert.deepStrictEqual(await enviar([Object.assign({}, MSG, { para: 'ruim@teste.br' }), MSG]), [{ ok: false, codigo: 'destinatario' }, { ok: true }]);
    assert.strictEqual(e.recebidas.length, 1);
  });
});
test('smtp: servidor fora do ar não rejeita, devolve a falha', async () => {
  const cfg = { smtp: { host: '127.0.0.1', porta: 1, usuario: 'x', senha: 'y' }, remetente: { nome: '', endereco: 'a@b.br' } };
  assert.deepStrictEqual(await Smtp.enviar(cfg, [MSG], {}), [{ ok: false, codigo: 'conexao' }]);
});

test('ponta a ponta: da função ao servidor SMTP de mentira', async () => {
  await comServidor({ direto: true }, async (enviar, e) => {
    const b = banca({ enviar: (cfg, msgs) => enviar(msgs) });
    b.por('p1', pontual({ decididoPor: 'coord@teste.br' }));
    const r = await b.avisar({ evento: 'aprovada', id: 'p1' });
    assert.deepStrictEqual(r.corpo.enviados, ['Filipe Professor']);
    assert.deepStrictEqual(e.recebidas[0].para, ['RCPT TO:<prof@teste.br>']);
    assert.match(partes(e.recebidas[0].corpo)[0], /O seu pedido foi aprovado/);
  });
});
