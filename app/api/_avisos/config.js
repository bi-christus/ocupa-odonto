/* config.js — o que vem das variáveis de ambiente da Vercel.

   Nada aqui tem valor padrão que envie e-mail: faltando qualquer uma das
   obrigatórias, a função responde "não configurado" e não tenta nada. O
   remetente é só variável, para trocar a conta (a do setor hoje, a
   institucional quando houver) sem mexer no código.

     AVISOS_SMTP_HOST       ex.: smtp.gmail.com
     AVISOS_SMTP_PORTA      465 (TLS direto) ou 587 (STARTTLS)
     AVISOS_SMTP_USUARIO    a conta que autentica
     AVISOS_SMTP_SENHA      senha de app da conta — só no painel da Vercel
     AVISOS_REMETENTE       endereço, ou "Nome <endereço>"; aceita apelido
                            (conta+ocupa@dominio)
     AVISOS_SEGREDO         texto aleatório de 32+ caracteres, que assina os
                            bilhetes (ver bilhete.js)
     AVISOS_RESPONDER_PARA  para onde vai a resposta do professor, e o contato
                            do rodapé. Obrigatória quando o remetente é a
                            própria conta que envia; opcional com apelido
     AVISOS_LIMITE_DIA      opcional: teto de e-mails por dia (padrão 150)
     AVISOS_URL             opcional: endereço do sistema no e-mail

   A conta que envia pode ser de mais de uma ferramenta, e alguma delas pode
   ler a caixa de entrada. Por isso a resposta do professor nunca pode cair
   nela: Reply-To na mesma caixa é configuração inválida, e sem Reply-To o
   remetente tem de ser um apelido, que um filtro tira da caixa de entrada. */
'use strict';

const PROJETO = 'ocupa-odonto';
const URL_PADRAO = 'https://controle-de-clinicas-odonto.vercel.app';
const LIMITE_DIA_PADRAO = 150;
const OBRIGATORIAS = ['AVISOS_SMTP_HOST', 'AVISOS_SMTP_PORTA', 'AVISOS_SMTP_USUARIO',
  'AVISOS_SMTP_SENHA', 'AVISOS_REMETENTE', 'AVISOS_SEGREDO'];

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

function ler(env) {
  const v = (nome) => String(env[nome] || '').trim();
  const faltando = OBRIGATORIAS.filter((nome) => !v(nome));
  const invalidas = [];
  const porta = Number(v('AVISOS_SMTP_PORTA'));
  if (v('AVISOS_SMTP_PORTA') && porta !== 465 && porta !== 587) invalidas.push('AVISOS_SMTP_PORTA');
  const remetente = lerCaixa(v('AVISOS_REMETENTE'));
  if (v('AVISOS_REMETENTE') && !remetente) invalidas.push('AVISOS_REMETENTE');
  if (v('AVISOS_SEGREDO') && v('AVISOS_SEGREDO').length < 32) invalidas.push('AVISOS_SEGREDO');
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
    smtp: {
      host: v('AVISOS_SMTP_HOST'), porta: porta,
      usuario: v('AVISOS_SMTP_USUARIO'), senha: v('AVISOS_SMTP_SENHA')
    },
    remetente: remetente, responder: responder, limiteDia: limiteDia,
    segredo: v('AVISOS_SEGREDO'),
    url: url.replace(/\/+$/, '')
  };
}

module.exports = { ler: ler, enderecoValido: enderecoValido, lerCaixa: lerCaixa, OBRIGATORIAS: OBRIGATORIAS };
