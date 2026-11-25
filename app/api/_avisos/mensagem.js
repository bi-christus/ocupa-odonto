/* mensagem.js — do que o banco confirmou ao texto do e-mail.

   Tudo que vem do banco passa por `limpo` (tira quebra de linha, controle e
   marcas de direção de texto) e, no HTML, por `esc`. Os rótulos e as frases
   são só daqui.

   A conta que envia pode ser lida por outra ferramenta que abre chamado pelo
   assunto ("[sigla] texto") ou por um número "OS-123" em qualquer parte da
   mensagem, inclusive citada numa resposta ou devolução. Por isso o assunto
   não leva colchete, parêntese nem chave, e "OS-123" vira "OS 123" no e-mail
   inteiro, venha de onde vier. */
'use strict';

const CONTROLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+', 'g');
const INVISIVEL = new RegExp('[\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff]', 'g');

function limpo(v, max) {
  const t = String(v === null || v === undefined ? '' : v)
    .replace(CONTROLE, ' ').replace(INVISIVEL, '').replace(/\s+/g, ' ')
    .replace(/\b(OS)-(?=\d)/gi, '$1 ').trim();
  const m = max || 300;
  return t.length > m ? t.slice(0, m - 1) + '…' : t;
}
const ENTIDADES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
function esc(v) { return String(v).replace(/[&<>"']/g, (c) => ENTIDADES[c]); }

/* ── A reserva em linhas ─────────────────────────────────────────────── */
function dataLonga(C, iso) {
  return C.dataValida(iso) ? C.nomeDia(C.weekday(iso), true) + ', ' + C.fmtDiaAno(iso) : '—';
}
function disciplina(S, o) {
  const d = S.disciplinaDe(o);
  if (d) return S.rotuloDisciplinaLongo(d);
  return S.disciplinaIdDe(o) ? 'Disciplina removida do cadastro' : 'Outros (sem disciplina)';
}
/* Para o assunto: só o nome. */
function disciplinaCurta(S, o) {
  const d = S.disciplinaDe(o);
  return limpo(d ? (d.nome || d.codigo) : (o.tipo === 'pontual' ? 'Atividade' : 'Reserva'), 60);
}
function cadeiras(S, C, o) {
  if (S.escopoSemCadeiras(o.agrupamentoId, o.escopo)) return 'Ambiente inteiro';
  const cap = S.capacidadeEscopo(o.agrupamentoId, o.escopo);
  const lista = S.cadeirasDe(o);
  /* Pré-clínica só é "inteira" se a reserva toma todas: as parciais gravadas
     antes de 05/11/2026 continuam valendo como foram gravadas. */
  if (S.escopoInteiro(o.agrupamentoId, o.escopo) && (!lista.length || lista.length === cap)) {
    return 'Pré-clínica inteira (' + C.plural(cap, 'cadeira') + ')';
  }
  if (S.ehIntegral(o)) {
    return (S.clinicasDoEscopo(o.agrupamentoId, o.escopo).length > 1 ? 'As duas clínicas inteiras' : 'Clínica inteira') +
      ' (' + C.plural(cap, 'cadeira') + ')';
  }
  if (!lista.length) return C.plural(S.quantidadeDe(o), 'cadeira');
  return C.plural(lista.length, 'cadeira') + ': ' + S.textoCadeiras(lista);
}
function dias(C, o) { return C.listaDias((Array.isArray(o.dias) ? o.dias : []).slice()); }
function vigencia(C, o) {
  return C.dataValida(o.vigenciaInicio) && C.dataValida(o.vigenciaFim)
    ? 'de ' + C.fmtDiaAno(o.vigenciaInicio) + ' a ' + C.fmtDiaAno(o.vigenciaFim) : '—';
}
function horario(o) { return limpo(o.inicio, 5) + ' às ' + limpo(o.fim, 5); }
function quandoCurto(C, o, data) {
  const h = limpo(o.inicio, 5) + '–' + limpo(o.fim, 5);
  if (data) return C.fmtDia(data) + ' ' + h;
  if (o.tipo === 'pontual') return (C.dataValida(o.data) ? C.fmtDia(o.data) + ' ' : '') + h;
  return dias(C, o) + ' ' + h;
}

/* `data` vale para o aviso de um encontro só: no lugar dos dias e da
   vigência, a data dele. */
function linhas(S, C, o, data) {
  const l = [];
  l.push([S.nivelDe(o) === 'pos' ? 'Especialização' : 'Disciplina', disciplina(S, o)]);
  const desc = S.descricaoDe(o);
  if (desc) l.push(['Descrição/Turma', desc]);
  l.push(['Clínica', S.rotuloEscopoCurto(o.agrupamentoId, o.escopo)]);
  l.push(['Cadeiras', cadeiras(S, C, o)]);
  if (data) l.push(['Encontro', dataLonga(C, data)]);
  else if (o.tipo === 'pontual') l.push(['Data', dataLonga(C, o.data)]);
  else {
    l.push(['Dias', 'toda semana: ' + dias(C, o)]);
    l.push(['Vigência', vigencia(C, o)]);
  }
  l.push(['Horário', horario(o)]);
  l.push(['Professor coordenador', S.nomePessoa(S.responsavelDe(o))]);
  return l;
}

/* O que mudou, campo a campo, na ordem em que a pessoa confere. */
function mudancas(S, C, a, o) {
  const tipo = (x) => (S.nivelDe(x) === 'pos' ? 'Pós-graduação' : 'Graduação');
  const pares = [
    ['Disciplina', disciplina(S, a), disciplina(S, o)],
    ['Tipo', tipo(a), tipo(o)],
    ['Descrição/Turma', S.descricaoDe(a) || '(vazia)', S.descricaoDe(o) || '(vazia)'],
    ['Clínica', S.rotuloEscopoCurto(a.agrupamentoId, a.escopo), S.rotuloEscopoCurto(o.agrupamentoId, o.escopo)],
    ['Cadeiras', cadeiras(S, C, a), cadeiras(S, C, o)]
  ];
  if (o.tipo === 'pontual') pares.push(['Data', dataLonga(C, a.data), dataLonga(C, o.data)]);
  else {
    pares.push(['Dias', dias(C, a), dias(C, o)]);
    pares.push(['Vigência', vigencia(C, a), vigencia(C, o)]);
  }
  pares.push(['Horário', horario(a), horario(o)]);
  pares.push(['Professor coordenador', S.nomePessoa(S.responsavelDe(a)), S.nomePessoa(S.responsavelDe(o))]);
  return pares.filter((p) => limpo(p[1], 500) !== limpo(p[2], 500));
}

/* ── Um bloco por reserva avisada ────────────────────────────────────────
   `ap` é o que eventos.apurar confirmou; `papel` diz se quem lê é quem
   responde agora pela reserva ou quem respondia antes da edição.
   Devolve null quando não há nada a dizer (edição só de cor, por exemplo). */
function bloco(ctx, item, ap, papel) {
  const S = ctx.S, C = ctx.C, o = ap.o, a = ap.antes, u = S.usuario();
  const quem = limpo(u.nome, 80) + (u.perfil === 'coordenador' ? ' (coordenação)' : '');
  const pend = S.situacaoDe(o) === 'pendente';
  const recorrente = o.tipo === 'recorrente';
  const b = {
    evento: item.evento, titulo: '', plural: '', frase: '', nota: '', motivo: '', mudancas: [],
    linhas: linhas(S, C, o, ap.data),
    chamada: disciplinaCurta(S, o) + ', ' + quandoCurto(C, o, ap.data),
    rotuloAutor: 'Feito por', autor: quem
  };
  function nomear(titulo, plural, rotuloAutor) {
    b.titulo = titulo; b.plural = plural; b.rotuloAutor = rotuloAutor;
  }

  switch (item.evento) {
    case 'criada':
      if (pend) {
        nomear('Pedido registrado', 'pedidos registrados', 'Registrado por');
        b.frase = quem + ' registrou este pedido em seu nome. Ele ainda não reserva o horário: ' +
          'aguarda aprovação da coordenação.';
      } else {
        nomear('Reserva confirmada', 'reservas confirmadas', 'Registrada por');
        b.frase = quem + ' registrou esta reserva em seu nome. Ela já está confirmada na agenda.';
      }
      if (recorrente && Array.isArray(o.excecoes)) {
        const fora = o.excecoes.map((x) => x && x.data).filter((x) => C.dataValida(x)).sort();
        if (fora.length) {
          b.linhas.push(['Sem encontro em', fora.slice(0, 12).map((x) => C.fmtDiaAno(x)).join(', ') +
            (fora.length > 12 ? ' e mais ' + (fora.length - 12) : '')]);
        }
      }
      break;

    case 'aprovada':
      nomear('Reserva confirmada', 'reservas confirmadas', 'Aprovada por');
      b.frase = 'O seu pedido foi aprovado. A reserva está confirmada na agenda.';
      break;

    case 'recusada':
      nomear('Pedido recusado', 'pedidos recusados', 'Recusado por');
      b.frase = 'O seu pedido foi recusado. O horário não está reservado.';
      b.motivo = limpo(o.motivoRecusa, 500) || 'não informado';
      break;

    case 'editada':
      b.mudancas = mudancas(S, C, a, o);
      if (!b.mudancas.length) return null;
      if (pend) nomear('Pedido alterado', 'pedidos alterados', 'Alterado por');
      else nomear('Reserva alterada', 'reservas alteradas', 'Alterada por');
      b.frase = papel === 'anterior'
        ? quem + ' alterou ' + (pend ? 'este pedido' : 'esta reserva') +
          ', que passou a ter outra pessoa como professor coordenador.'
        : quem + ' alterou ' + (pend ? 'o seu pedido' : 'a sua reserva') + '. Veja o que mudou.';
      if (S.estaExcluida(o)) b.nota = 'A reserva está excluída da agenda no momento.';
      else if (pend) b.nota = 'O pedido continua aguardando aprovação da coordenação.';
      break;

    case 'cadeiras':
      nomear('Cadeiras alteradas', 'reservas com cadeiras alteradas', 'Alteradas por');
      b.frase = quem + ' trocou as cadeiras da sua reserva.' +
        (recorrente ? ' A troca vale para todas as datas dela.' : '');
      b.mudancas = [['Cadeiras', cadeiras(S, C, a), cadeiras(S, C, o)]];
      break;

    case 'cancelada':
      if (ap.data) {
        nomear('Encontro cancelado', 'encontros cancelados', 'Cancelado por');
        b.frase = 'O encontro de ' + dataLonga(C, ap.data) + ' foi cancelado. Os demais encontros continuam valendo.';
        b.motivo = limpo(ap.motivoDoBanco, 500) || 'não informado';
      } else {
        nomear('Reserva cancelada', 'reservas canceladas', 'Cancelada por');
        b.frase = 'A reserva abaixo foi cancelada e saiu da agenda.';
      }
      break;

    case 'restaurada':
      nomear('Encontro restaurado', 'encontros restaurados', 'Restaurado por');
      b.frase = 'O encontro de ' + dataLonga(C, ap.data) + ', que estava cancelado, voltou a valer.';
      break;

    case 'encerrada':
      nomear('Recorrência encerrada', 'recorrências encerradas', 'Encerrada por');
      b.frase = 'Esta recorrência foi encerrada: de ' + dataLonga(C, o.encerradaEm) +
        ' em diante não há mais encontros. Os anteriores continuam no histórico.';
      b.linhas.push(['Encerrada a partir de', dataLonga(C, o.encerradaEm)]);
      break;

    case 'excluida':
      if (pend) nomear('Pedido excluído', 'pedidos excluídos', 'Excluído por');
      else nomear('Reserva excluída', 'reservas excluídas', 'Excluída por');
      b.frase = recorrente
        ? 'A recorrência inteira foi excluída da agenda: nenhum encontro dela está mais reservado.'
        : 'A reserva abaixo foi excluída da agenda. O horário não está mais reservado.';
      b.motivo = limpo(ap.motivoDoBanco, 500) || 'não informado';
      break;

    case 'recuperada':
      if (pend) nomear('Pedido recuperado', 'pedidos recuperados', 'Recuperado por');
      else nomear('Reserva recuperada', 'reservas recuperadas', 'Recuperada por');
      b.frase = pend
        ? 'O pedido que estava excluído voltou à fila e aguarda aprovação da coordenação.'
        : 'A reserva que estava excluída voltou para a agenda.';
      if (!pend && cadeiras(S, C, a) !== cadeiras(S, C, o)) {
        b.mudancas = [['Cadeiras', cadeiras(S, C, a), cadeiras(S, C, o)]];
        b.nota = 'As cadeiras de antes foram tomadas por outra reserva enquanto esta estava excluída.';
      }
      break;
  }
  return b;
}

/* ── A mensagem de uma pessoa ────────────────────────────────────────── */
function assunto(blocos) {
  const mesmo = blocos.every((b) => b.plural === blocos[0].plural);
  const t = blocos.length === 1 ? blocos[0].titulo + ' · ' + blocos[0].chamada
    : blocos.length + ' ' + (mesmo ? blocos[0].plural : 'atualizações nas suas reservas');
  return limpo(('Ocupa · ' + t).replace(/[[\](){}<>]/g, ' '), 150);
}

/* O contato é o Reply-To configurado. Sem ele não se inventa endereço. */
function rodape(contato) {
  return 'Não responda a este e-mail: a mensagem é automática e esta caixa não é lida. ' +
    (contato ? 'Dúvidas sobre a reserva: ' + contato + '. ' : 'Dúvidas sobre a reserva: procure a coordenação do curso. ') +
    'Ocupa, controle de ocupação das clínicas de Odontologia. Este aviso é enviado a quem responde pela reserva ' +
    'como professor coordenador.';
}

function texto(nome, blocos, url, contato) {
  const l = ['Olá, ' + nome + '.', ''];
  if (blocos.length > 1) l.push('Há ' + blocos.length + ' atualizações nas suas reservas.', '');
  blocos.forEach((b) => {
    l.push('== ' + b.titulo.toUpperCase() + ' ==', b.frase, '');
    if (b.mudancas.length) {
      l.push('O que mudou:');
      b.mudancas.forEach((m) => l.push('  ' + m[0] + ': de "' + limpo(m[1], 500) + '" para "' + limpo(m[2], 500) + '"'));
      l.push('');
    }
    if (b.motivo) l.push('Motivo: ' + b.motivo);
    b.linhas.forEach((x) => l.push(x[0] + ': ' + limpo(x[1], 500)));
    l.push(b.rotuloAutor + ': ' + b.autor);
    if (b.nota) l.push('', b.nota);
    l.push('');
  });
  l.push('Abrir o sistema: ' + url, '', rodape(contato));
  return l.join('\r\n');
}

const F = 'font-family:Arial,Helvetica,sans-serif;';
const TABELA = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse';

function linhaHtml(rotulo, v, forte) {
  return '<tr><td style="' + F + 'padding:7px 14px 7px 0;border-bottom:1px solid #e2e5e9;font-size:13px;color:#5b6169;' +
    'vertical-align:top;width:150px">' + esc(rotulo) + '</td><td style="' + F + 'padding:7px 0;border-bottom:1px solid #e2e5e9;' +
    'font-size:14px;color:#16181c;vertical-align:top' + (forte ? ';font-weight:bold' : '') + '">' + esc(limpo(v, 500)) + '</td></tr>';
}
function celula(v, estilo) {
  return '<td style="' + F + 'padding:8px 10px;font-size:13px;border-top:1px solid #e2e5e9;vertical-align:top;' + estilo + '">' +
    esc(limpo(v, 500)) + '</td>';
}
function titulo(t) {
  return '<th align="left" style="' + F + 'padding:7px 10px;font-size:12px;color:#5b6169;background:#eef2f6">' + t + '</th>';
}
function blocoHtml(b) {
  let h = '<tr><td style="padding:22px 26px 6px">' +
    '<h2 style="' + F + 'margin:0 0 6px;font-size:19px;color:#16181c">' + esc(b.titulo) + '</h2>' +
    '<p style="' + F + 'margin:0 0 14px;font-size:14px;line-height:1.55;color:#2a2e34">' + esc(b.frase) + '</p>';
  if (b.mudancas.length) {
    h += TABELA + ';margin:0 0 16px;border:1px solid #cfd8e2"><tr>' + titulo('O que mudou') + titulo('Antes') + titulo('Agora') + '</tr>' +
      b.mudancas.map((m) => '<tr>' + celula(m[0], 'color:#5b6169') + celula(m[1], 'color:#5b6169;text-decoration:line-through') +
        celula(m[2], 'color:#16181c;font-weight:bold') + '</tr>').join('') + '</table>';
  }
  h += TABELA + '">' + (b.motivo ? linhaHtml('Motivo', b.motivo, true) : '') +
    b.linhas.map((x) => linhaHtml(x[0], x[1])).join('') + linhaHtml(b.rotuloAutor, b.autor) + '</table>';
  if (b.nota) h += '<p style="' + F + 'margin:14px 0 0;font-size:13px;line-height:1.5;color:#2a2e34">' + esc(b.nota) + '</p>';
  return h + '</td></tr>';
}
function html(nome, blocos, url, contato) {
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ocupa</title></head>' +
    '<body style="margin:0;padding:0;background:#f2f2f3">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f3"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #d9dde2">' +
    '<tr><td style="' + F + 'background:#416180;color:#ffffff;padding:14px 26px;font-size:15px;font-weight:bold;letter-spacing:1px">OCUPA' +
    '<span style="font-weight:normal;font-size:12px;letter-spacing:0">&nbsp;&nbsp;Clínicas de Odontologia</span></td></tr>' +
    '<tr><td style="' + F + 'padding:20px 26px 0;font-size:14px;color:#16181c">Olá, ' + esc(nome) + '.' +
    (blocos.length > 1 ? ' Há ' + blocos.length + ' atualizações nas suas reservas.' : '') + '</td></tr>' +
    blocos.map(blocoHtml).join('') +
    '<tr><td style="padding:22px 26px 26px"><a href="' + esc(url) + '" style="' + F + 'display:inline-block;background:#416180;color:#ffffff;' +
    'text-decoration:none;font-size:14px;padding:10px 18px">Abrir o Ocupa</a></td></tr>' +
    '<tr><td style="' + F + 'padding:14px 26px;border-top:1px solid #e2e5e9;font-size:12px;line-height:1.5;color:#5b6169">' +
    esc(rodape(contato)) + '</td></tr></table></td></tr></table></body></html>';
}

function montar(nome, blocos, url, contato) {
  const n = limpo(nome, 80);
  return { assunto: assunto(blocos), texto: texto(n, blocos, url, contato), html: html(n, blocos, url, contato) };
}

module.exports = { bloco: bloco, montar: montar, limpo: limpo, esc: esc };
