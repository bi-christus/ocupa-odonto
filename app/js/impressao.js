/* impressao.js — versão para impressão e PDF da agenda.

   Não há biblioteca de PDF aqui, e não vai haver: o projeto é ES5 sem
   bundler e sem npm, e a impressão do próprio navegador já entrega PDF pelo
   destino "Salvar como PDF". O que este arquivo faz é montar um documento
   limpo — sem cabeçalho do app, sem botão, sem rolagem, sem cor de fundo que
   a impressora ignora — e passá-lo ao window.print().

   O documento é anexado ao <body> FORA de #raiz, e o CSS de impressão
   esconde #raiz e mostra só ele. Foi a alternativa a abrir outra janela com
   window.open, que o bloqueador de pop-up derruba sem avisar e sem deixar
   rastro para a pessoa entender por que nada aconteceu.

   A grade da semana sai com a MESMA régua de horas da tela (S.janelaHoras e
   S.baldesPorHora): a folha precisa ser reconhecível como a aba Agenda, não
   como outro relatório. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store;

  var area = null, folha = null, tituloAnterior = null, relogio = null;

  /* ── Mecânica ─────────────────────────────────────────────────────── */
  function limpar() {
    if (relogio) { global.clearTimeout(relogio); relogio = null; }
    if (area && area.parentNode) area.parentNode.removeChild(area);
    if (folha && folha.parentNode) folha.parentNode.removeChild(folha);
    area = null; folha = null;
    if (tituloAnterior !== null) { document.title = tituloAnterior; tituloAnterior = null; }
  }

  /* `@page` não aceita seletor de classe, então a orientação do papel entra
     como folha de estilo própria, criada e descartada junto do documento. */
  function orientar(paisagem) {
    folha = C.el('style', { type: 'text/css' });
    folha.appendChild(document.createTextNode(
      '@page{size:A4 ' + (paisagem ? 'landscape' : 'portrait') + ';margin:9mm 8mm}'));
    document.head.appendChild(folha);
  }

  /* imprimir(no, opcoes)
       opcoes.arquivo   nome sugerido do PDF (vira o title da página)
       opcoes.paisagem  false para retrato; o padrão é paisagem            */
  function imprimir(no, opcoes) {
    opcoes = opcoes || {};
    limpar();
    orientar(opcoes.paisagem !== false);
    area = C.el('div', { class: 'imp' }, no);
    document.body.appendChild(area);
    /* O Chrome usa o título da página como nome do arquivo em "Salvar como
       PDF". Sem isto todo PDF sai chamado "Ocupa · Controle de clínicas…". */
    if (opcoes.arquivo) {
      tituloAnterior = document.title;
      document.title = opcoes.arquivo;
    }
    /* A limpeza é do evento `afterprint`. O prazo é só a rede de segurança
       para o navegador que não dispara o evento: sem ele o título da página
       ficaria trocado para sempre. */
    relogio = global.setTimeout(limpar, 120000);
    /* Um respiro antes de imprimir: o documento acabou de entrar no DOM e
       precisa estar medido quando a pré-visualização é gerada. */
    global.setTimeout(function () {
      try { global.print(); } catch (e) { limpar(); }
    }, 60);
  }

  if (global.addEventListener) {
    global.addEventListener('afterprint', function () { limpar(); });
  }

  /* ── Moldura ──────────────────────────────────────────────────────────
     Cabeçalho e rodapé iguais em toda folha: sem eles a impressão vira uma
     tabela solta, sem semestre, sem data de emissão e sem quem emitiu — que
     é justamente o que se cobra de um papel que circula em reunião. */
  function documento(titulo, subtitulo, corpo) {
    var u = S.usuario();
    return C.el('div', {}, [
      C.el('div', { class: 'imp-hd' }, [
        C.el('div', { class: 'imp-marca', text: 'Ocupa · Odontologia' }),
        C.el('h1', { text: titulo }),
        C.el('div', { class: 'imp-sub', text: subtitulo })
      ]),
      corpo,
      C.el('div', { class: 'imp-ft', text:
        'Emitido em ' + C.fmtDiaAno(C.hojeISO()) + ' às ' + C.agoraHHMM() +
        (u ? ' por ' + u.nome : '') +
        ' · Ocupa, controle de ocupação das clínicas de odontologia' })
    ]);
  }

  function subtituloPadrao(extra) {
    var e = S.estado;
    return 'Semestre ' + e.periodoLetivo + (extra ? ' · ' + extra : '');
  }

  /* Bloco de uma ocupação na folha. Em papel não há cor garantida — o
     navegador imprime sem fundo por padrão —, então o que distingue
     recorrente de pontual é o traço da borda, e a ocupação das duas clínicas
     se anuncia por escrito. */
  function bloco(o) {
    var dupla = S.idsDoEscopo(o.agrupamentoId, o.escopo).length > 1;
    return C.el('div', { class: 'imp-ev' + (o.origem === 'pontual' ? ' pontual' : '') }, [
      C.el('b', { text: S.rotuloEscopo(o.agrupamentoId, o.escopo) +
        (dupla ? ' · 2 clínicas' : '') }),
      C.el('span', { text: o.inicio + '–' + o.fim + ' · ' + o.titulo }),
      C.el('small', { text: S.nomePessoa(o.responsavelId) })
    ]);
  }

  function legenda() {
    return C.el('div', { class: 'imp-leg' }, [
      C.el('span', {}, [C.el('i', { class: 'am-rec' }), 'Aula recorrente']),
      C.el('span', {}, [C.el('i', { class: 'am-pont' }), 'Atividade pontual']),
      C.el('span', { text: '"2 clínicas" = ocupação das duas clínicas do agrupamento' })
    ]);
  }

  /* ── Semana: a grade da aba Agenda ────────────────────────────────── */
  function semana(seg) {
    var datas = [], i;
    for (i = 0; i < 6; i++) datas.push(C.addDays(seg, i));
    var janela = S.janelaHoras(datas);
    var h0 = janela[0], h1 = janela[1];

    var total = 0;
    var dias = datas.map(function (d) {
      var itens = S.ocorrenciasDoDia(d);
      total += itens.length;
      return { data: d, baldes: S.baldesPorHora(itens, h0, h1) };
    });

    var cabecalho = C.el('tr', {}, [C.el('th', { class: 'h', text: 'Hora' })].concat(
      dias.map(function (d) {
        return C.el('th', {}, [
          C.nomeDia(C.weekday(d.data), true),
          C.el('small', { text: C.fmtDiaAno(d.data) })
        ]);
      })));

    var corpo = C.el('tbody');
    for (var h = h0; h <= h1; h++) {
      var linha = C.el('tr', {}, C.el('td', { class: 'h', text: C.pad(h) + ':00' }));
      for (i = 0; i < dias.length; i++) {
        linha.appendChild(C.el('td', {}, (dias[i].baldes[h] || []).map(bloco)));
      }
      corpo.appendChild(linha);
    }

    var tabela = C.el('table', { class: 'imp-grade' }, [
      C.el('thead', {}, cabecalho), corpo
    ]);

    return documento(
      'Ocupação das clínicas · semana de ' + C.fmtDiaAno(seg) + ' a ' + C.fmtDiaAno(datas[5]),
      subtituloPadrao(C.plural(total, 'ocupação', 'ocupações') + ' na semana'),
      C.el('div', {}, [tabela, legenda()]));
  }

  function imprimirSemana(seg) {
    imprimir(semana(seg), {
      arquivo: 'agenda-semana-' + seg,
      paisagem: true
    });
  }

  /* ── Dia: uma tabela por agrupamento ──────────────────────────────────
     A pista do gantt não sobrevive ao papel (é posicionamento absoluto sobre
     uma régua que depende da largura da tela), então o dia vira lista por
     agrupamento, na mesma ordem em que as pistas aparecem. */
  function dia(data) {
    var caixa = C.el('div');
    var agrupamentos = S.estado.agrupamentos || [];
    var total = 0;

    agrupamentos.forEach(function (g) {
      var lista = S.ocorrenciasDoDia(data, { agrupamentoId: g.id });
      total += lista.length;
      var corpo = C.el('tbody');
      if (!lista.length) {
        corpo.appendChild(C.el('tr', {}, C.el('td', {
          colspan: '5', class: 'vazio', text: 'Sem ocupação registrada.'
        })));
      }
      lista.forEach(function (o) {
        corpo.appendChild(C.el('tr', {}, [
          C.el('td', { class: 'h', text: o.inicio + '–' + o.fim }),
          C.el('td', { text: S.rotuloEscopo(o.agrupamentoId, o.escopo) }),
          C.el('td', {}, [
            C.el('b', { text: o.titulo }),
            o.subtitulo ? C.el('small', { text: o.subtitulo }) : null
          ]),
          C.el('td', { text: S.nomePessoa(o.responsavelId) }),
          C.el('td', { text: o.origem === 'pontual' ? 'Pontual' : 'Recorrente' })
        ]));
      });
      caixa.appendChild(C.el('div', { class: 'imp-sec' }, [
        C.el('h2', { text: g.nome + ' · ' +
          S.clinicasDoAgrupamento(g.id).map(function (c) { return c.nome; }).join(' e ') }),
        C.el('table', { class: 'imp-lista' }, [
          C.el('thead', {}, C.el('tr', {}, [
            C.el('th', { class: 'h', text: 'Horário' }), C.el('th', { text: 'Onde' }),
            C.el('th', { text: 'Atividade' }), C.el('th', { text: 'Professor coordenador' }),
            C.el('th', { text: 'Tipo' })
          ])),
          corpo
        ])
      ]));
    });

    return documento(
      'Ocupação das clínicas · ' + C.nomeDia(C.weekday(data), true) + ', ' + C.fmtDiaAno(data),
      subtituloPadrao(C.plural(total, 'ocupação', 'ocupações') + ' no dia'),
      caixa);
  }

  function imprimirDia(data) {
    imprimir(dia(data), { arquivo: 'agenda-dia-' + data, paisagem: false });
  }

  /* ── Recorrências do semestre ─────────────────────────────────────── */
  function fimEfetivo(r) {
    var ultimo = r.encerradaEm ? C.addDays(r.encerradaEm, -1) : null;
    return ultimo && ultimo < r.vigenciaFim ? ultimo : r.vigenciaFim;
  }

  function recorrencias() {
    var regras = S.recorrenciasAtivas().slice().sort(function (a, b) {
      return (a.dias[0] - b.dias[0]) || C.toMin(a.inicio) - C.toMin(b.inicio);
    });
    var corpo = C.el('tbody');
    if (!regras.length) {
      corpo.appendChild(C.el('tr', {}, C.el('td', {
        colspan: '6', class: 'vazio', text: 'Nenhuma recorrência criada neste semestre.'
      })));
    }
    regras.forEach(function (r) {
      var t = S.turma(r.turmaId);
      corpo.appendChild(C.el('tr', {}, [
        C.el('td', {}, [
          C.el('b', { text: S.rotuloTurma(t) }),
          C.el('small', { text: S.nomePessoa(t ? t.professorCoordenadorId : null) })
        ]),
        C.el('td', { text: S.rotuloEscopo(r.agrupamentoId, r.escopo) }),
        C.el('td', { text: C.listaDias(r.dias) }),
        C.el('td', { class: 'h', text: r.inicio + '–' + r.fim }),
        C.el('td', { class: 'h', text: C.fmtDia(r.vigenciaInicio) + ' – ' + C.fmtDia(fimEfetivo(r)) }),
        C.el('td', { class: 'h', text: String(S.capacidadeEscopo(r.agrupamentoId, r.escopo)) })
      ]));
    });

    return documento(
      'Recorrências do semestre',
      subtituloPadrao(C.plural(regras.length, 'recorrência ativa', 'recorrências ativas')),
      C.el('table', { class: 'imp-lista' }, [
        C.el('thead', {}, C.el('tr', {}, [
          C.el('th', { text: 'Turma' }), C.el('th', { text: 'Onde' }),
          C.el('th', { text: 'Dias' }), C.el('th', { class: 'h', text: 'Horário' }),
          C.el('th', { class: 'h', text: 'Vigência' }), C.el('th', { class: 'h', text: 'Cadeiras' })
        ])),
        corpo
      ]));
  }

  function imprimirRecorrencias() {
    imprimir(recorrencias(), {
      arquivo: 'recorrencias-' + S.estado.periodoLetivo, paisagem: false
    });
  }

  global.Impressao = {
    imprimir: imprimir,
    semana: imprimirSemana, dia: imprimirDia, recorrencias: imprimirRecorrencias
  };
})(window);
