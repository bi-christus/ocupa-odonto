/* enviar-teste.js — manda os exemplos DE VERDADE, para um endereço só.

     node _auditoria/avisos/enviar-teste.js --usuario conta@dominio --para quem@dominio

   É o único arquivo desta pasta que envia e-mail, e só quando uma pessoa o
   roda e digita a senha de app no próprio terminal. A senha não aparece na
   tela, não vai para arquivo nem para o histórico, e morre com o processo.
   Serve para provar a conta, o remetente e a aparência antes de pôr as
   variáveis na Vercel. O conteúdo é fictício e o assunto leva "TESTE".

     --quantos N   só os N primeiros (padrão: todos)                          */
'use strict';
const readline = require('readline');
const Config = require('../../app/api/_avisos/config');
const Smtp = require('../../app/api/_avisos/smtp');
const { gerar } = require('./exemplos');

function opcao(nome) {
  const i = process.argv.indexOf('--' + nome);
  return i === -1 ? '' : String(process.argv[i + 1] || '');
}

function perguntar(texto, escondido) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 0 });
    rl.question(texto, (r) => { rl.close(); if (escondido) process.stdout.write('\n'); ok(r); });
    if (escondido) rl._writeToOutput = () => {};
  });
}

const MOTIVOS = {
  autenticacao: 'a conta ou a senha de app foi recusada',
  conexao: 'o servidor de e-mail não respondeu (rede ou firewall)',
  tls: 'a conexão segura falhou',
  tempo: 'o servidor demorou a responder',
  cota: 'a cota da conta acabou',
  destinatario: 'o destinatário foi recusado',
  remetente: 'o remetente foi recusado'
};

function marcar(m, para) {
  const aviso = 'TESTE do Ocupa: pessoas e reservas fictícias.';
  return {
    para: para,
    assunto: m.assunto.replace('Ocupa · ', 'Ocupa · TESTE · '),
    texto: aviso + '\r\n\r\n' + m.texto,
    html: m.html.replace('Clínicas de Odontologia</span>', 'Clínicas de Odontologia · ' + aviso + '</span>')
  };
}

async function principal() {
  const para = opcao('para');
  if (!Config.enderecoValido(para)) { console.log('Informe o destinatário: --para quem@dominio'); return 1; }
  const usuario = opcao('usuario') || await perguntar('Conta que envia: ', false);
  const senha = await perguntar('Senha de app de ' + usuario + ' (não aparece enquanto você digita): ', true);
  const cfg = Config.ler({ AVISOS_SMTP_USUARIO: usuario, AVISOS_SMTP_SENHA: senha, AVISOS_SEGREDO: 'so-para-o-teste-local-nao-assina-nada' });
  if (!cfg.configurado) { console.log('Não dá para enviar. Falta ou está inválido: ' + cfg.faltando.concat(cfg.invalidas).join(', ')); return 1; }

  const todos = await gerar(true);
  const n = Math.max(1, Math.min(Number(opcao('quantos')) || todos.length, todos.length));
  const lista = todos.slice(0, n).map((x) => marcar(x.m, para));
  console.log('Enviando ' + n + ' mensagens de teste como "' + cfg.remetente.nome + ' <' + cfg.remetente.endereco + '>" para ' + para + '...');
  const r = await Smtp.enviar(cfg, lista);
  r.forEach((x, i) => console.log((x.ok ? '  enviado  ' : '  FALHOU   ') + lista[i].assunto + (x.ok ? '' : ' (' + (MOTIVOS[x.codigo] || x.codigo) + ')')));
  const ok = r.filter((x) => x.ok).length;
  console.log('Resultado: ' + ok + ' de ' + n + ' aceitas pelo servidor de e-mail.');
  return ok === n ? 0 : 1;
}

if (require.main === module) principal().then((c) => { process.exitCode = c; });
module.exports = { marcar: marcar };
