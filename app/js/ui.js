/* ui.js — componentes compartilhados: modal, campos de formulário e blocos
   de exibição reaproveitados pelas telas. */
(function (global) {
  'use strict';
  var C = global.Core;

  /* ── Modal ────────────────────────────────────────────────────────────
     Um modal por vez: abrir outro substitui o atual, como as telas já
     esperavam. O foco de origem é guardado só na primeira abertura, para
     voltar ao lugar certo mesmo quando um modal chama outro. */
  var scrimAtual = null;
  var caixaAtual = null;
  var focoOriginal = null;

  /* Object.assign é de ES2015 e o projeto é ES5 estrito: em navegador sem
     o método os campos de formulário nem chegavam a ser montados. */
  function mesclar(base, extra) {
    var saida = {};
    Object.keys(base).forEach(function (k) { saida[k] = base[k]; });
    if (extra) Object.keys(extra).forEach(function (k) { saida[k] = extra[k]; });
    return saida;
  }

  function focaveis(raiz) {
    var sel = 'a[href],button:not([disabled]),input:not([disabled]),' +
      'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    return Array.prototype.filter.call(raiz.querySelectorAll(sel), function (n) {
      return n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement;
    });
  }

  /* Esc fecha; Tab circula dentro da caixa em vez de escapar para a página
     que ficou atrás do scrim. */
  function aoTeclar(e) {
    if (!caixaAtual) return;
    if (e.key === 'Escape') { e.preventDefault(); fecharModal(); return; }
    if (e.key !== 'Tab') return;
    var l = focaveis(caixaAtual);
    if (!l.length) { e.preventDefault(); return; }
    var primeiro = l[0], ultimo = l[l.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  }

  function modal(opts) {
    var anterior = document.activeElement;
    var tinhaModal = !!scrimAtual;
    fecharModal(true);
    if (!tinhaModal) focoOriginal = anterior;

    var tituloId = C.uid('mt');
    var corpo = C.el('div', { class: 'modal-bd' }, opts.conteudo);
    var rodape = opts.acoes ? C.el('div', { class: 'modal-ft' }, opts.acoes) : null;
    var caixa = C.el('div', {
      class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tituloId,
      tabindex: '-1',
      style: opts.largura ? 'max-width:' + opts.largura : null,
      onclick: function (e) { e.stopPropagation(); }
    }, [
      C.el('div', { class: 'modal-hd' }, [
        C.el('div', {}, [
          C.el('h4', { id: tituloId, text: opts.titulo }),
          opts.subtitulo ? C.el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:3px', text: opts.subtitulo }) : null
        ]),
        C.el('button', { class: 'x', text: '×', 'aria-label': 'Fechar', onclick: function () { fecharModal(); } })
      ]),
      corpo, rodape
    ]);
    var scrim = C.el('div', { class: 'scrim', onclick: function () { fecharModal(); } }, caixa);
    document.body.appendChild(scrim);
    scrimAtual = scrim;
    caixaAtual = caixa;
    document.addEventListener('keydown', aoTeclar);
    var l = focaveis(caixa);
    if (l.length) l[0].focus(); else caixa.focus();
    return { fechar: fecharModal, caixa: caixa, corpo: corpo };
  }

  function fecharModal(substituindo) {
    if (scrimAtual && scrimAtual.parentNode) scrimAtual.parentNode.removeChild(scrimAtual);
    scrimAtual = null;
    caixaAtual = null;
    document.removeEventListener('keydown', aoTeclar);
    /* Só `true` conta. Várias telas passam a função direto em onclick
       (`onclick: U.fecharModal`), e aí o primeiro argumento é o Event do
       clique: qualquer objeto truthy fazia o modal fechar sem devolver o
       foco a quem o abriu. */
    if (substituindo === true) return;
    /* Só devolve o foco se o nó ainda existir: as ações costumam chamar
       App.recarregar(), que reconstrói a página inteira. */
    if (focoOriginal && focoOriginal.focus && document.body.contains(focoOriginal)) {
      focoOriginal.focus();
    }
    focoOriginal = null;
  }

  /* `conteudo` recebe nós do DOM; `texto` é tratado como texto puro e nunca
     como markup. Não existe caminho de HTML cru aqui de propósito: o título
     de uma atividade é escrito pelo usuário e chegava a innerHTML. */
  function confirmar(opts, aoConfirmar) {
    var dentro = opts.conteudo || C.el('span', { text: opts.texto || '' });
    return modal({
      titulo: opts.titulo,
      subtitulo: opts.subtitulo,
      largura: '520px',
      conteudo: C.el('div', { style: 'font-size:13.5px;line-height:1.6' }, dentro),
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Voltar', onclick: function () { fecharModal(); } }),
        C.el('button', {
          class: 'btn ' + (opts.perigo ? 'btn-perigo' : 'btn-primary'),
          text: opts.rotulo || 'Confirmar',
          onclick: function () { fecharModal(); aoConfirmar(); }
        })
      ]
    });
  }

  /* ── Campos ───────────────────────────────────────────────────────── */
  function campo(rotulo, controle, dica) {
    return C.el('label', { class: 'fld' }, [
      C.el('span', { text: rotulo }),
      controle,
      dica ? C.el('small', { class: 'muted', style: 'font-size:11.5px', text: dica }) : null
    ]);
  }

  function selecao(opcoes, valor, aoMudar, atributos) {
    var s = C.el('select', mesclar({ class: 'input' }, atributos));
    var achou = false;
    opcoes.forEach(function (o) {
      if (o.valor === valor) achou = true;
      s.appendChild(C.el('option', { value: o.valor, text: o.rotulo, selected: o.valor === valor }));
    });
    /* Sem esta opção de resgate, um valor fora da lista deixaria o select
       visualmente em branco enquanto o formulário seguia com ele guardado. */
    if (!achou && valor !== null && valor !== undefined && valor !== '') {
      s.insertBefore(C.el('option', { value: valor, text: String(valor), selected: true }), s.firstChild);
    }
    s.value = valor;
    if (aoMudar) s.addEventListener('change', function () { aoMudar(s.value); });
    return s;
  }

  /* Hora e minuto de verdade, em passos de 5 minutos — e não uma lista de
     meias horas, que tornava 07:45 impossível de registrar. */
  function hora(valor, aoMudar, atributos) {
    var i = C.el('input', mesclar({
      class: 'input', type: 'time', step: '300', value: valor || ''
    }, atributos));
    if (aoMudar) {
      i.addEventListener('change', function () { if (i.value) aoMudar(i.value); });
      i.addEventListener('blur', function () { if (i.value) aoMudar(i.value); });
    }
    return i;
  }

  function seletorDias(selecionados, aoMudar) {
    var caixa = C.el('div', { class: 'days' });
    [1, 2, 3, 4, 5, 6].forEach(function (d) {
      var b = C.el('button', {
        type: 'button',
        class: selecionados.indexOf(d) !== -1 ? 'on' : '',
        text: C.DIAS_CURTO[d],
        'aria-pressed': selecionados.indexOf(d) !== -1 ? 'true' : 'false',
        'aria-label': C.DIAS_LONGO ? C.DIAS_LONGO[d] : C.DIAS_CURTO[d],
        onclick: function () {
          var i = selecionados.indexOf(d);
          if (i === -1) selecionados.push(d); else selecionados.splice(i, 1);
          var on = selecionados.indexOf(d) !== -1;
          b.className = on ? 'on' : '';
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          aoMudar(selecionados);
        }
      });
      caixa.appendChild(b);
    });
    return caixa;
  }

  /* ── Blocos de exibição ───────────────────────────────────────────── */
  function kv(rotulo, valor) {
    return C.el('div', { class: 'kv' }, [
      C.el('span', { text: rotulo }),
      typeof valor === 'object' && valor !== null ? valor : C.el('span', { text: valor === null || valor === undefined ? '—' : String(valor) })
    ]);
  }

  function badgeStatus(status) {
    var mapa = {
      em_andamento: ['strong', 'Em atendimento'],
      agendada: ['soft', 'Agendada'],
      encerrada: ['neutral', 'Encerrada']
    };
    var m = mapa[status] || ['neutral', status];
    return C.el('span', { class: 'badge ' + m[0], text: m[1] });
  }

  function badgeCriticidade(c) {
    var mapa = { 'crítica': 'danger', alta: 'warn', 'média': 'soft', baixa: 'neutral' };
    return C.el('span', { class: 'badge ' + (mapa[c] || 'neutral'), text: c });
  }

  /* `maximo` é a capacidade real, não o maior valor da série: normalizar
     pelo maior fazia a clínica mais ocupada parecer sempre lotada. */
  function barra(valor, maximo) {
    var pct = maximo > 0 ? Math.max(0, Math.min(100, Math.round((valor / maximo) * 100))) : 0;
    return C.el('div', { class: 'bar' }, C.el('i', { style: 'width:' + pct + '%' }));
  }

  function vazio(texto) { return C.el('div', { class: 'empty', text: texto }); }

  function semPermissao(texto) {
    return C.el('div', { class: 'card', style: 'max-width:560px' }, [
      C.el('h4', { text: 'Acesso restrito' }),
      C.el('p', {
        class: 'muted', style: 'font-size:13.5px;line-height:1.6;margin:10px 0 0',
        text: texto || 'Seu perfil não tem permissão para esta área. Fale com a coordenação se precisar de acesso.'
      })
    ]);
  }

  global.UI = {
    modal: modal, fecharModal: fecharModal, confirmar: confirmar,
    campo: campo, selecao: selecao, hora: hora, seletorDias: seletorDias,
    kv: kv, badgeStatus: badgeStatus, badgeCriticidade: badgeCriticidade,
    barra: barra, vazio: vazio, semPermissao: semPermissao
  };
})(window);
