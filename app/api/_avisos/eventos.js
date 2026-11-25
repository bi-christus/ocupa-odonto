/* eventos.js — cada aviso só existe se o banco confirmar o que aconteceu.

   O navegador diz "reserva X, evento Y". Daqui para baixo nada do que ele
   disse vira texto nem destinatário: o evento precisa bater com o documento
   relido (e, quando há, com o bilhete do antes), a gravação precisa ser
   recente, a pessoa precisa ter a permissão daquela ação na matriz de
   acesso.js, e quem recebe é quem o banco diz que responde pela reserva. */
'use strict';

/* Gravação que o aviso acompanha: feita há pouco. Impede reaproveitar uma
   reserva antiga para disparar e-mail. */
const RECENTE = 15 * 60 * 1000;

const EVENTOS = ['criada', 'aprovada', 'recusada', 'editada', 'cadeiras',
  'cancelada', 'restaurada', 'encerrada', 'excluida', 'recuperada'];

/* Com `data` (encontro de recorrente) ou sem (a pontual inteira). */
const COM_DATA = { cancelada: 'opcional', restaurada: 'obrigatoria' };

function precisaBilhete(item) {
  return item.evento === 'editada' || item.evento === 'cadeiras' || item.evento === 'recuperada' ||
    (item.evento === 'cancelada' && !item.data);
}

function nao(motivo) { return { ok: false, motivo: motivo }; }

/* ctx: { S, C, conta, agora }  ·  depois: documento lido agora, ou null
   antes: bilhete conferido, ou null.
   Devolve { ok, o, antes, para: [{ id, papel }] } ou { ok:false, motivo }. */
function apurar(item, ctx, depois, antes) {
  const S = ctx.S, C = ctx.C, eu = ctx.conta.email;
  const d = depois ? depois.dados : null;
  const a = antes ? antes.dados : null;
  const pontual = !!d && d.tipo === 'pontual';

  if (precisaBilhete(item) && !a) return nao('sem_bilhete');
  if (d && ctx.agora - depois.mudadoEm > RECENTE) return nao('nao_confere');

  function podeCancelar(o) {
    return S.pode('agenda.cancelarQualquer') ||
      (S.pode('agenda.cancelarPropria') && S.responsavelDe(o) === eu);
  }
  function para(o, outro) {
    const saida = [];
    const atual = S.responsavelDe(o);
    if (atual) saida.push({ id: String(atual), papel: 'responsavel' });
    const anterior = outro ? S.responsavelDe(outro) : null;
    if (anterior && anterior !== atual) saida.push({ id: String(anterior), papel: 'anterior' });
    return saida;
  }
  function feito(o, extra) {
    return Object.assign({ ok: true, o: o, antes: a, data: item.data || null, para: para(o) }, extra || {});
  }
  function excecao() {
    return (Array.isArray(d.excecoes) ? d.excecoes : []).find((x) => x && x.data === item.data);
  }

  if (item.evento === 'cancelada' && !item.data) {
    /* Pontual cancelada: o documento não existe mais. O que prova que ela
       existia, e de quem era, é o bilhete que este servidor assinou. */
    if (d) return nao('nao_confere');
    if (a.tipo !== 'pontual' || S.situacaoDe(a) !== 'aprovada') return nao('nao_confere');
    if (!podeCancelar(a)) return nao('sem_permissao');
    return feito(a, { antes: null });
  }

  if (!d || (d.tipo !== 'pontual' && d.tipo !== 'recorrente')) return nao('nao_confere');

  switch (item.evento) {
    case 'criada':
      /* Só a coordenação registra em nome de outra pessoa. */
      if (!S.pode('agenda.aprovar')) return nao('sem_permissao');
      if (d.criadoPor !== eu || ctx.agora - depois.criadoEm > RECENTE) return nao('nao_confere');
      if (S.estaExcluida(d) || S.situacaoDe(d) === 'recusada') return nao('nao_confere');
      return feito(d);

    case 'aprovada':
      if (!S.pode('agenda.aprovar')) return nao('sem_permissao');
      if (!pontual || d.situacao !== 'aprovada' || d.decididoPor !== eu || S.estaExcluida(d)) return nao('nao_confere');
      return feito(d);

    case 'recusada':
      if (!S.pode('agenda.aprovar')) return nao('sem_permissao');
      if (!pontual || d.situacao !== 'recusada' || d.decididoPor !== eu) return nao('nao_confere');
      return feito(d);

    case 'editada':
      if (!S.pode('agenda.editar')) return nao('sem_permissao');
      if (d.editadoPor !== eu || antes.versao === depois.versao) return nao('nao_confere');
      return feito(d, { para: para(d, a) });

    case 'cadeiras':
      if (!S.podeGerirCadeiras(d)) return nao('sem_permissao');
      if (S.estaExcluida(d) || antes.versao === depois.versao) return nao('nao_confere');
      if (S.textoCadeiras(S.cadeirasDe(d)) === S.textoCadeiras(S.cadeirasDe(a))) return nao('sem_mudanca');
      return feito(d);

    case 'cancelada': {
      if (pontual) return nao('nao_confere');
      if (!podeCancelar(d)) return nao('sem_permissao');
      const ex = excecao();
      if (!ex || ex.registradoPor !== eu) return nao('nao_confere');
      return feito(d, { motivoDoBanco: ex.motivo });
    }

    case 'restaurada': {
      if (pontual) return nao('nao_confere');
      if (!S.pode('agenda.cancelarQualquer')) return nao('sem_permissao');
      const ocorre = Array.isArray(d.dias) && d.dias.indexOf(C.weekday(item.data)) !== -1 &&
        item.data >= d.vigenciaInicio && item.data <= d.vigenciaFim &&
        (!d.encerradaEm || item.data < d.encerradaEm);
      if (excecao() || !ocorre || S.estaExcluida(d)) return nao('nao_confere');
      return feito(d);
    }

    case 'encerrada':
      if (!S.pode('agenda.criarRecorrente')) return nao('sem_permissao');
      if (pontual || !C.dataValida(d.encerradaEm)) return nao('nao_confere');
      return feito(d);

    case 'excluida':
      if (!S.pode('agenda.excluir')) return nao('sem_permissao');
      if (!S.estaExcluida(d) || d.excluidaPor !== eu) return nao('nao_confere');
      return feito(d, { motivoDoBanco: d.motivoExclusao });

    case 'recuperada':
      if (!S.pode('agenda.excluir')) return nao('sem_permissao');
      if (S.estaExcluida(d) || !S.estaExcluida(a)) return nao('nao_confere');
      return feito(d);
  }
  return nao('nao_confere');
}

module.exports = { apurar: apurar, precisaBilhete: precisaBilhete, EVENTOS: EVENTOS, COM_DATA: COM_DATA };
