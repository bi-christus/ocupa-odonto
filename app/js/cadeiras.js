/* cadeiras.js — troca das cadeiras de uma reserva.

   Desde 05/10/2026 a reserva diz QUANTAS cadeiras usa e o sistema escolhe
   QUAIS, da menor para a maior entre as livres, e já as marca como ocupadas.
   Este seletor é o outro lado do pedido: o professor responsável (ou a
   coordenação) vê o escopo inteiro, cadeira por cadeira, e troca as que a
   reserva segura.

   A escolha vale para TODAS as datas da reserva — a alocação é uma só. Por
   isso uma cadeira aparece como "de outra reserva" quando qualquer encontro
   desta cruza com outra que a segura, e não só o de hoje.

   A gravação é `fixo`: se uma cadeira escolhida aqui for tomada enquanto a
   pessoa escolhia, a transação recusa em vez de trocar por outra que ela não
   viu. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI;

  function legenda(cls, texto) {
    return C.el('span', { class: 'row', style: 'gap:7px' }, [
      C.el('span', { class: 'chair-k ' + cls }), texto
    ]);
  }

  /* `reserva` é o DOCUMENTO (recorrente ou pontual), não a ocorrência. */
  function escolher(reserva, aoConcluir) {
    if (!reserva) return;
    if (!S.podeGerirCadeiras(reserva)) {
      C.toast('Só a coordenação e o professor responsável trocam as cadeiras desta reserva.');
      return;
    }
    if (S.estaExcluida(reserva)) { C.toast('Reserva excluída não tem cadeira para trocar.'); return; }
    if (reserva.tipo === 'pontual' && S.situacaoDe(reserva) !== 'aprovada') {
      C.toast('As cadeiras do pedido são escolhidas na aprovação.');
      return;
    }

    var mapa = S.mapaDeCadeiras(reserva);
    var integral = S.ehIntegral(reserva);
    var limite = S.limiteDeCadeiras(reserva);
    /* Com a sobreposição permitida nos parâmetros, cadeira de outra reserva
       continua escolhível — só fica sinalizada. */
    var podeSobrepor = S.estado.parametros.bloquearSobreposicao === false;
    var sel = {};
    mapa.minhas.forEach(function (n) { sel[n] = true; });

    var grades = C.el('div', { class: 'stack', style: 'gap:18px' });
    var contador = C.el('div', { class: 'preview' });
    var btnSalvar = C.el('button', { class: 'btn btn-primary', type: 'button', text: 'Salvar cadeiras', onclick: salvar });

    function selecionadas() {
      return Object.keys(sel).filter(function (k) { return sel[k]; })
        .map(Number).sort(function (a, b) { return a - b; });
    }
    function donoTexto(n) {
      return (mapa.donos[n] || []).map(function (id) {
        var r = S.reservaPorId(id);
        return r ? S.rotuloReserva(r) + ' · ' + S.nomePessoa(S.responsavelDe(r)) : 'outra reserva';
      }).join(' · ');
    }

    function botao(c, n) {
      var tomada = !!(mapa.donos[n] && mapa.donos[n].length);
      var manut = !!S.cadeiraEmManutencao(c.id, n);
      var minha = !!sel[n];
      var bloqueada = tomada && !minha && !podeSobrepor;
      var cls = 'chair' + (minha ? ' ocupada' : '') + (tomada && !minha ? ' outra' : '') + (manut ? ' manut' : '');
      return C.el('button', {
        type: 'button', class: cls, text: C.pad(n),
        disabled: bloqueada ? true : null,
        'aria-pressed': minha ? 'true' : 'false',
        title: S.localCadeira(n, c) + ' · ' + (minha ? 'nesta reserva'
          : tomada ? 'com outra reserva: ' + donoTexto(n) : 'livre') +
          (manut ? ' · em manutenção agora' : ''),
        onclick: function () {
          if (sel[n]) { delete sel[n]; desenhar(); return; }
          if (selecionadas().length >= limite) {
            C.toast(limite < S.capacidadeEscopo(reserva.agrupamentoId, reserva.escopo)
              ? 'A reserva aprovada é de ' + C.plural(limite, 'cadeira') +
                ' — desmarque uma antes de marcar outra. Mais cadeiras, só com a coordenação.'
              : 'Todas as cadeiras do escopo já estão marcadas.');
            return;
          }
          sel[n] = true;
          desenhar();
        }
      });
    }

    function desenhar() {
      C.clear(grades);
      S.clinicasDoEscopo(reserva.agrupamentoId, reserva.escopo).forEach(function (c) {
        var f = S.faixaCadeiras(c.id);
        var grade = C.el('div', { class: 'chairs' });
        for (var n = f[0]; n <= f[1]; n++) grade.appendChild(botao(c, n));
        grades.appendChild(C.el('div', {}, [
          C.el('div', { class: 'eyebrow', style: 'margin-bottom:8px', text: c.nome + ' · cadeiras ' + f[0] + '–' + f[1] }),
          grade
        ]));
      });
      var l = selecionadas();
      var manut = l.filter(function (n) {
        var c = S.clinicaDaCadeira(n, S.clinicasDoEscopo(reserva.agrupamentoId, reserva.escopo));
        return c && S.cadeiraEmManutencao(c.id, n);
      });
      C.clear(contador);
      contador.appendChild(C.el('div', {}, [
        C.el('b', { text: C.plural(l.length, 'cadeira marcada', 'cadeiras marcadas') }),
        l.length ? ' · ' + C.faixasNumeros(l) : ''
      ]));
      contador.appendChild(C.el('div', { class: 'muted', text:
        limite < S.capacidadeEscopo(reserva.agrupamentoId, reserva.escopo)
          ? 'Até ' + C.plural(limite, 'cadeira', 'cadeiras') + ' — é o que a coordenação aprovou.'
          : 'A escolha vale para todas as datas da reserva.' }));
      if (manut.length) {
        contador.appendChild(C.el('div', { style: 'color:var(--warn)', text:
          (manut.length === 1 ? 'A cadeira ' + manut[0] + ' está' : 'As cadeiras ' + C.faixasNumeros(manut) + ' estão') +
          ' em manutenção agora.' }));
      }
      btnSalvar.disabled = !l.length;
    }

    /* Volta às menores livres na mesma quantidade — o que a alocação
       automática teria escolhido hoje. */
    function menoresLivres() {
      var qtd = selecionadas().length || S.quantidadeDe(reserva);
      var livres = mapa.pool.filter(function (n) {
        return podeSobrepor || !(mapa.donos[n] && mapa.donos[n].length);
      });
      sel = {};
      livres.slice(0, Math.min(qtd, limite)).forEach(function (n) { sel[n] = true; });
      desenhar();
    }

    function salvar() {
      var l = selecionadas();
      if (!l.length) { C.toast('Marque ao menos uma cadeira.'); return; }
      btnSalvar.disabled = true;
      S.alterarCadeiras(reserva.id, l).then(function (r) {
        if (r && r.ok) {
          U.fecharModal();
          C.toast('Cadeiras da reserva: ' + C.faixasNumeros(l) + '.');
          if (aoConcluir) aoConcluir(r);
        } else {
          btnSalvar.disabled = false;
          /* Quem perdeu a corrida precisa ver o mapa atualizado. */
          mapa = S.mapaDeCadeiras(reserva);
          desenhar();
        }
      });
    }

    var quando = reserva.tipo === 'pontual'
      ? C.nomeDia(C.weekday(reserva.data), true) + ', ' + C.fmtDiaAno(reserva.data)
      : 'toda ' + C.listaDias(reserva.dias) + ', de ' + C.fmtDia(reserva.vigenciaInicio) + ' a ' + C.fmtDia(reserva.vigenciaFim);

    desenhar();
    U.modal({
      titulo: 'Cadeiras da reserva',
      subtitulo: S.rotuloReserva(reserva) + ' · ' + quando + ' · ' + reserva.inicio + '–' + reserva.fim,
      largura: '760px',
      conteudo: C.el('div', { class: 'stack', style: 'gap:16px' }, [
        integral ? C.el('div', { class: 'alert', text:
          'Esta reserva é anterior à quantidade de cadeiras e segura a clínica inteira. ' +
          'Desmarque as que não serão usadas: elas ficam livres para outras reservas.' }) : null,
        contador,
        grades,
        C.el('div', { class: 'row', style: 'gap:18px;font-size:12px' }, [
          legenda('ocupada', 'Nesta reserva'),
          legenda('', 'Livre'),
          legenda('outra', 'Com outra reserva no horário'),
          legenda('manut', 'Em manutenção agora')
        ])
      ]),
      acoes: [
        C.el('button', { class: 'btn-ghost', type: 'button', style: 'margin-right:auto', text: 'Voltar às menores livres', onclick: menoresLivres }),
        C.el('button', { class: 'btn btn-outline', type: 'button', text: 'Cancelar', onclick: function () { U.fecharModal(); } }),
        btnSalvar
      ]
    });
  }

  global.Cadeiras = { escolher: escolher };
})(window);
