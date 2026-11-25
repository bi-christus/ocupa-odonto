/* config.js — o que vem das variáveis de ambiente da Vercel.

   DUAS são obrigatórias, e sem elas a função responde "não configurado" e não
   tenta nada:

     AVISOS_SMTP_USUARIO    a conta que autentica (um endereço de e-mail)
     AVISOS_SMTP_SENHA      senha de app da conta — só no painel da Vercel

   As outras têm padrão e existem para trocar de conta ou de provedor sem
   mexer no código:

     AVISOS_SMTP_HOST       padrão smtp.gmail.com
     AVISOS_SMTP_PORTA      padrão 465 (TLS direto); ou 587 (STARTTLS)
     AVISOS_REMETENTE       endereço, ou "Nome <endereço>". Padrão:
                            "Ocupa · não responda" no apelido +ocupa da conta
     AVISOS_RESPONDER_PARA  para onde vai a resposta do professor, e o contato
                            do rodapé. Obrigatória quando o remetente é a
                            própria conta que envia; opcional com apelido
     AVISOS_SEGREDO         32+ caracteres, que assinam os bilhetes
                            (bilhete.js). Padrão: derivado da senha de app
     AVISOS_LIMITE_DIA      teto de e-mails por dia (padrão 150)
     AVISOS_URL             endereço do sistema no e-mail

   A conta que envia pode ser de mais de uma ferramenta, e alguma delas pode
   ler a caixa de entrada. Por isso a resposta do professor nunca pode cair
   nela: Reply-To na mesma caixa é configuração inválida, e sem Reply-To o
   remetente tem de ser um apelido, que um filtro tira da caixa de entrada. */
'use strict';
const crypto = require('crypto');

const PROJETO = 'ocupa-odonto';
const HOST_PADRAO = 'smtp.gmail.com';
const PORTA_PADRAO = 465;
const NOME_PADRAO = 'Ocupa · não responda';
const URL_PADRAO = 'https://controle-de-clinicas-odonto.vercel.app';
const LIMITE_DIA_PADRAO = 150;
const OBRIGATORIAS = ['AVISOS_SMTP_USUARIO', 'AVISOS_SMTP_SENHA'];
/* Como o Google mostra a senha de app: quatro grupos de quatro letras. */
const SENHA_DE_APP = /^[a-z]{4} ?[a-z]{4} ?[a-z]{4} ?[a-z]{4}$/;

/* Estreito de propósito: só o que pode ir cru para o envelope SMTP. Sem
   espaço, sem aspas, sem quebra de linha, sem "<" nem ">". */
const ENDERECO = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function enderecoValido(e) {
  return typeof e === 'string' && e.length <= 254 && ENDERECO.test(e);
}

/* "Ocupa <a@b.c>" ou "a@b.c" → { nome, endereco }, ou null. */
function lerCaixa(texto) {
  const t = String(texto || '').trim();
  const m = /^([^<>\r\n]*)<([^<>\s]+)>$/.exec(t);
  const caixa = m ? { nome: m[1].replace(/"/g, '').trim(), endereco: m[2] } : { nome: '', endereco: t };
  return enderecoValido(caixa.endereco) ? caixa : null;
}

/* A caixa por trás do endereço: maiúscula e apelido (+algo) não mudam onde a
   mensagem chega. */
function caixaDe(endereco) {
  const p = String(endereco || '').toLowerCase().split('@');
  return p.length === 2 ? p[0].split('+')[0] + '@' + p[1] : String(endereco || '').toLowerCase();
}

/* conta@dominio → conta+ocupa@dominio, com o nome padrão; null se não der. */
function remetentePadrao(usuario) {
  const u = String(usuario || '').toLowerCase();
  if (!enderecoValido(u) || u.indexOf('+') !== -1) return null;
  const p = u.split('@');
  const endereco = p[0] + '+ocupa@' + p[1];
  return enderecoValido(endereco) ? { nome: NOME_PADRAO, endereco: endereco } : null;
}

/* O segredo dos bilhetes sai da senha de app quando não há variável própria.
   Só da senha de app, que o Google sorteia: de uma senha escolhida por gente,
   o bilhete serviria para adivinhá-la fora daqui. Guardado por senha porque o
   scrypt é caro de propósito. */
let derivado = { senha: null, segredo: '' };
function segredoDaSenha(senha) {
  if (!SENHA_DE_APP.test(senha)) return '';
  if (derivado.senha !== senha) {
    derivado = { senha: senha, segredo: crypto.scryptSync(senha, 'ocupa.avisos.bilhete.v1', 32).toString('hex') };
  }
  return derivado.segredo;
}

function ler(env) {
  const v = (nome) => String(env[nome] || '').trim();
  const faltando = OBRIGATORIAS.filter((nome) => !v(nome));
  const invalidas = [];
  const host = v('AVISOS_SMTP_HOST') || HOST_PADRAO;
  const porta = Number(v('AVISOS_SMTP_PORTA') || PORTA_PADRAO);
  if (porta !== 465 && porta !== 587) invalidas.push('AVISOS_SMTP_PORTA');
  /* Colada com os espaços que o Google mostra, ela vale sem eles. */
  const senha = SENHA_DE_APP.test(v('AVISOS_SMTP_SENHA')) ? v('AVISOS_SMTP_SENHA').replace(/ /g, '') : v('AVISOS_SMTP_SENHA');
  const remetente = v('AVISOS_REMETENTE') ? lerCaixa(v('AVISOS_REMETENTE')) : remetentePadrao(v('AVISOS_SMTP_USUARIO'));
  if (v('AVISOS_REMETENTE') && !remetente) invalidas.push('AVISOS_REMETENTE');
  else if (!remetente && v('AVISOS_SMTP_USUARIO')) faltando.push('AVISOS_REMETENTE');
  const segredo = v('AVISOS_SEGREDO') || segredoDaSenha(senha);
  if (v('AVISOS_SEGREDO') && v('AVISOS_SEGREDO').length < 32) invalidas.push('AVISOS_SEGREDO');
  else if (!segredo && senha) faltando.push('AVISOS_SEGREDO');
  const responder = v('AVISOS_RESPONDER_PARA') ? lerCaixa(v('AVISOS_RESPONDER_PARA')) : null;
  if (v('AVISOS_RESPONDER_PARA') && (!responder ||
    [v('AVISOS_SMTP_USUARIO'), remetente && remetente.endereco].some((e) => e && caixaDe(e) === caixaDe(responder.endereco)))) {
    invalidas.push('AVISOS_RESPONDER_PARA');
  }
  if (!responder && !v('AVISOS_RESPONDER_PARA') && remetente &&
    remetente.endereco.toLowerCase() === v('AVISOS_SMTP_USUARIO').toLowerCase()) {
    faltando.push('AVISOS_RESPONDER_PARA');
  }
  const limiteDia = v('AVISOS_LIMITE_DIA') ? Number(v('AVISOS_LIMITE_DIA')) : LIMITE_DIA_PADRAO;
  if (!(Number.isInteger(limiteDia) && limiteDia >= 1 && limiteDia <= 2000)) invalidas.push('AVISOS_LIMITE_DIA');
  const url = v('AVISOS_URL') || URL_PADRAO;
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) invalidas.push('AVISOS_URL');

  return {
    projeto: PROJETO,
    configurado: !faltando.length && !invalidas.length,
    faltando: faltando, invalidas: invalidas,
    smtp: { host: host, porta: porta, usuario: v('AVISOS_SMTP_USUARIO'), senha: senha },
    remetente: remetente, responder: responder, limiteDia: limiteDia,
    /* O Reply-To vai sempre: se o provedor trocar o From do apelido pela conta
       principal, a resposta ainda vai para o apelido, que o filtro tira da
       caixa de entrada. */
    responderPara: responder || (remetente ? { nome: '', endereco: remetente.endereco } : null),
    segredo: segredo,
    url: url.replace(/\/+$/, '')
  };
}

module.exports = { ler: ler, enderecoValido: enderecoValido, lerCaixa: lerCaixa, OBRIGATORIAS: OBRIGATORIAS };
