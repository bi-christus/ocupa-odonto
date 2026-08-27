/* views/agenda.js — ocupações das clínicas: semana, dia e recorrências.
   A agenda é do AGRUPAMENTO: uma ocupação não aponta para uma clínica, e sim
   para um agrupamento mais um escopo ('a', 'b' ou 'ambas'). O rótulo e a cor
   de cada bloco saem daí, nunca de um nome de clínica isolado. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI;

  var vista = 'semana';
  var refSemana = null;
  var diaSel = null;

  /* Janela mínima da régua de horas, alargada por janelaHoras(). */
  var H0_MIN = 7, H1_MIN = 21;
  /* Altura, em pixels, da faixa de uma clínica na pista do agrupamento.
     Uma ocupação das duas clínicas ocupa as duas faixas. */
  var ALTURA_FAIXA = 32;

  function render(alvo, params) {
    if (!S.pode('agenda.ver')) { alvo.appendChild(U.semPermissao()); return; }
    if (!refSemana) refSemana = C.startOfWeek(C.hojeISO());
    if (params && params.vista) vista = params.vista;
    var fim = S.fimDaSemana(refSemana);
    if (!diaSel || diaSel < refSemana || diaSel > fim) {
      var hoje = C.hojeISO();
      diaSel = (hoje >= refSemana && hoje <= fim) ? hoje : refSemana;
    }

    alvo.appendChild(cabecalho());
    if (vista === 'semana') alvo.appendChild(gradeSemana());
    else if (vista === 'dia') alvo.appendChild(gantt());
    else alvo.appendChild(listaRecorrencias());
  }

  /* "17 a 22 de agosto" quando a semana não vira o mês, "28 de agosto a
     2 de setembro" quando vira. */
  function rotuloSemana() {
    var fim = S.fimDaSemana(refSemana);
    var a = C.parseISO(refSemana), b = C.parseISO(fim);
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
      return a.getDate() + ' a ' + C.fmtExtenso(fim);
    }
    return C.fmtExtenso(refSemana) + ' a ' + C.fmtExtenso(fim);
  }

  function cabecalho() {
    var podeCriar = S.pode('agenda.criarRecorrente') || S.pode('agenda.criarPontual');
    var titulo = vista === 'recorrencias'
      ? 'Recorrências · semestre ' + S.estado.periodoLetivo
      : 'Ocupações · ' + rotuloSemana();
    return C.el('div', { class: 'page-head' }, [
      C.el('h2', { text: titulo }),
      C.el('div', { class: 'row', style: 'gap:10px' }, [
        vista !== 'recorrencias' ? C.el('div', { class: 'row', style: 'gap:4px' }, [
          C.el('button', { class: 'chip-btn', text: '‹', 'aria-label': 'Semana anterior', title: 'Semana anterior',
            onclick: function () { refSemana = C.addDays(refSemana, -7); diaSel = null; global.App.recarregar(); } }),
          C.el('button', { class: 'chip-btn', text: 'Hoje',
            onclick: function () { refSemana = C.startOfWeek(C.hojeISO()); diaSel = C.hojeISO(); global.App.recarregar(); } }),
          C.el('button', { class: 'chip-btn', text: '›', 'aria-label': 'Próxima semana', title: 'Próxima semana',
            onclick: function () { refSemana = C.addDays(refSemana, 7); diaSel = null; global.App.recarregar(); } })
        ]) : null,
        C.el('div', { class: 'seg' }, [
          aba('semana', 'Semana'), aba('dia', 'Dia'), aba('recorrencias', 'Recorrências')
        ]),
        podeCriar ? C.el('button', { class: 'btn btn-primary', text: 'Nova ocupação', onclick: novaOcupacao }) : null
      ])
    ]);
  }
  function aba(id, rotulo) {
    return C.el('button', {
      type: 'button', class: vista === id ? 'on' : '', text: rotulo,
      'aria-pressed': vista === id ? 'true' : 'false',
      onclick: function () { vista = id; global.App.recarregar(); }
    });
  }

  function novaOcupacao() {
    var slot = C.el('div');
    U.modal({
      titulo: 'Nova ocupação',
      subtitulo: 'Semestre ' + S.estado.periodoLetivo,
      largura: '840px',
      conteudo: slot
    });
    global.Registro.montar(slot, {
      compacto: true,
      aoRegistrar: function () { U.fecharModal(); global.App.recarregar(); }
    });
  }

  /* ── Régua de horas ───────────────────────────────────────────────────
     A janela era 07h–22h cravada. Uma clínica pode abrir às 06:00 e fechar
     às 23:30 (é o que a tela de Estrutura permite gravar), e o gantt do dia
     descartava em silêncio o bloco que caísse fora: com fim = 22:00, uma
     ocupação das 22:00 às 23:00 dava b <= a e simplesmente não era
     desenhada. A janela agora sai dos horários das clínicas, dos parâmetros
     do polo e do que existe nas datas mostradas — a mesma derivação que a
     tela de Ocupação agora já faz. Devolve [primeiraHora, ultimaHora],
     ambas inclusivas. */
  function janelaHoras(datas) {
    var e = S.estado, p = e.parametros || {};
    var ini = Math.min(H0_MIN * 60, C.toMin(p.aberturaPadrao || '07:00'));
    var fim = Math.max((H1_MIN + 1) * 60, C.toMin(p.fechamentoPadrao || '22:00'));
    e.clinicas.forEach(function (c) {
      if (c.abertura) ini = Math.min(ini, C.toMin(c.abertura));
      if (c.fechamento) fim = Math.max(fim, C.toMin(c.fechamento));
    });
    datas.forEach(function (d) {
      S.ocorrenciasDoDia(d).forEach(function (o) {
        ini = Math.min(ini, C.toMin(o.inicio));
        fim = Math.max(fim, C.toMin(o.fim));
      });
    });
    var h0 = Math.floor(ini / 60);
    var h1 = Math.ceil(fim / 60) - 1;
    if (h1 < h0) h1 = h0;
    if (h1 > 23) h1 = 23;
    return [h0, h1];
  }

  /* ── Leituras de escopo compartilhadas ────────────────────────────── */
  function ehConjunta(o) {
    return S.idsDoEscopo(o.agrupamentoId, o.escopo).length > 1;
  }
  function classeEvento(o, base) {
    return base + (o.origem === 'pontual' ? ' pontual' : '') + (ehConjunta(o) ? ' conjunta' : '');
  }

  /* ── Semana ───────────────────────────────────────────────────────────
     Calendário com eixo de horas: 58px de rótulo mais seis colunas de dia.
     Sem o eixo a tela virava uma lista por coluna, sem nenhuma referência
     de horário. Cada bloco cai na linha da hora em que começa. */
  function gradeSemana() {
    var hoje = C.hojeISO();
    var dias = [], datas = [], total = 0, i, h;

    for (i = 0; i < 6; i++) datas.push(C.addDays(refSemana, i));
    var janela = janelaHoras(datas);
    var H0 = janela[0], H1 = janela[1];

    for (i = 0; i < 6; i++) {
      var itens = S.ocorrenciasDoDia(datas[i]);
      total += itens.length;
      dias.push({ data: datas[i], baldes: porHora(itens, H0, H1) });
    }

    var topoFixo = 'position:sticky;top:0;z-index:2;background:var(--color-bg);';
    var grade = C.el('div', {
      style: 'display:grid;grid-template-columns:58px repeat(6,minmax(104px,1fr));gap:0 8px'
    });
    grade.appendChild(C.el('div', { style: topoFixo + 'height:30px' }));
    dias.forEach(function (d) {
      grade.appendChild(C.el('div', {
        style: topoFixo + 'padding-bottom:8px;font:600 13px var(--font-heading);' +
          'letter-spacing:.05em;white-space:nowrap;color:' +
          (d.data === hoje ? 'var(--accent-ink)' : 'var(--color-text)')
      }, [
        C.nomeDia(C.weekday(d.data)) + ' ',
        C.el('span', { style: 'color:var(--muted);font-weight:400', text: C.fmtDia(d.data) })
      ]));
    });

    for (h = H0; h <= H1; h++) {
      grade.appendChild(C.el('div', {
        style: 'font-size:11.5px;color:var(--muted-2);padding:9px 0;' +
          'border-top:1px solid var(--line-soft);font-variant-numeric:tabular-nums',
        text: C.pad(h) + ':00'
      }));
      for (i = 0; i < dias.length; i++) {
        var cel = C.el('div', {
          style: 'display:flex;flex-direction:column;gap:4px;min-height:42px;' +
            'padding:6px 0;border-top:1px solid var(--line-soft)'
        });
        (dias[i].baldes[h] || []).forEach(function (o) { cel.appendChild(evento(o)); });
        grade.appendChild(cel);
      }
    }

    return C.el('div', {}, [
      C.el('div', { style: 'max-height:600px;overflow:auto' }, grade),
      total ? null : C.el('div', { class: 'muted', style: 'padding:14px 0;font-size:12.5px',
        text: 'Nenhuma ocupação registrada nesta semana.' }),
      legendaSemana()
    ]);
  }

  /* Distribui as ocorrências do dia na linha da hora em que começam.
     O que começa antes da abertura entra na primeira linha e o que começa
     depois da última entra na última — nada some da tela. */
  function porHora(itens, H0, H1) {
    var mapa = {};
    itens.forEach(function (o) {
      var h = Math.floor(C.toMin(o.inicio) / 60);
      if (h < H0) h = H0;
      if (h > H1) h = H1;
      if (!mapa[h]) mapa[h] = [];
      mapa[h].push(o);
    });
    return mapa;
  }

  function evento(o) {
    var rot = S.rotuloEscopo(o.agrupamentoId, o.escopo);
    return C.el('button', {
      class: classeEvento(o, 'ev'),
      style: 'margin:0;width:100%',
      title: rot + ' · ' + o.inicio + '–' + o.fim + ' · ' + o.titulo,
      onclick: function () { detalhe(o); }
    }, [
      C.el('b', { text: rot }),
      C.el('span', { text: o.inicio + '–' + o.fim + ' · ' + o.titulo })
    ]);
  }

  function legendaSemana() {
    function item(estilo, rotulo) {
      return C.el('span', { class: 'row', style: 'gap:8px' }, [
        C.el('span', { style: 'width:14px;height:14px;flex:none;' + estilo }), rotulo
      ]);
    }
    return C.el('div', { class: 'row', style: 'gap:22px;margin-top:16px;font-size:12.5px;flex-wrap:wrap' }, [
      item('background:var(--fill-soft);border-left:3px solid var(--fill-strong)', 'Aula recorrente'),
      item('background:var(--fill-soft);border-left:3px dashed var(--fill-strong)', 'Atividade pontual'),
      item('background:var(--fill-tint);border-left:3px solid var(--fill-deep)', 'Ocupação nas duas clínicas')
    ]);
  }

  /* ── Dia (gantt) ──────────────────────────────────────────────────────
     Uma pista por AGRUPAMENTO, com duas faixas — uma por clínica. A
     ocupação de escopo duplo toma as duas faixas de uma vez. */
  function gantt() {
    var janela = janelaHoras([diaSel]);
    var H0 = janela[0], H1 = janela[1];
    var ini = H0 * 60, fim = (H1 + 1) * 60, span = fim - ini;
    var agrupamentos = S.estado.agrupamentos || [];

    var seletor = C.el('div', { class: 'row', style: 'gap:5px;margin-bottom:22px' });
    for (var i = 0; i < 6; i++) {
      (function (i) {
        var d = C.addDays(refSemana, i);
        var on = diaSel === d;
        seletor.appendChild(C.el('button', {
          class: 'chip-btn',
          style: on ? 'background:var(--fill-strong);color:var(--on-strong);border-color:var(--fill-strong)' : '',
          'aria-pressed': on ? 'true' : 'false',
          text: C.nomeDia(C.weekday(d)) + ' ' + C.fmtDia(d),
          onclick: function () { diaSel = d; global.App.recarregar(); }
        }));
      })(i);
    }

    var marcas = C.el('div', { class: 'tl-hd' }, [C.el('div', { style: 'width:142px;flex:none' })]);
    for (var h = H0; h <= H1; h++) marcas.appendChild(C.el('i', { text: C.pad(h) }));

    var corpo = agrupamentos.length
      ? C.el('div', { style: 'border-top:1px solid var(--color-divider)' },
        agrupamentos.map(function (g) { return pistaAgrupamento(g, ini, fim, span); }))
      : U.vazio('Nenhum agrupamento de clínicas cadastrado.');

    return C.el('div', {}, [
      seletor,
      C.el('h5', { style: 'margin-bottom:12px',
        text: C.nomeDia(C.weekday(diaSel), true) + ', ' + C.fmtExtenso(diaSel) }),
      C.el('div', { style: 'overflow-x:auto' }, [marcas, corpo])
    ]);
  }

  function pistaAgrupamento(g, ini, fim, span) {
    var clinicas = S.clinicasDoAgrupamento(g.id);
    var faixas = Math.max(1, clinicas.length);
    var altura = ALTURA_FAIXA * faixas;
    var trilha = C.el('div', { class: 'tl-track', style: 'height:' + altura + 'px;padding:0' });

    /* Guias horizontais: uma acima, uma entre as clínicas e uma abaixo. */
    for (var k = 0; k <= faixas; k++) {
      trilha.appendChild(C.el('div', {
        style: 'position:absolute;left:0;right:0;top:' + (k * ALTURA_FAIXA) +
          'px;height:1px;background:var(--line-soft)'
      }));
    }

    var lista = S.ocorrenciasDoDia(diaSel, { agrupamentoId: g.id });
    var niveis = lista.map(function (o, idx) { return nivel(lista, idx); });
    var divisor = 1;
    niveis.forEach(function (n) { if (n + 1 > divisor) divisor = n + 1; });

    lista.forEach(function (o, idx) {
      var a = Math.max(ini, C.toMin(o.inicio)), b = Math.min(fim, C.toMin(o.fim));
      if (b <= a) return;
      var ids = S.idsDoEscopo(o.agrupamentoId, o.escopo);
      var dupla = ids.length > 1;
      var pos = Math.max(0, g.clinicas.indexOf(ids[0]));
      var st = S.statusOcorrencia(o);
      var baseTopo = dupla ? 0 : pos * ALTURA_FAIXA;
      var baseAlt = dupla ? altura : ALTURA_FAIXA;
      /* O empilhamento por sobreposição só subdivide a própria faixa: uma
         ocupação da Clínica 3 nunca pode ser empurrada para a pista da 4. */
      var sub = baseAlt / divisor;
      trilha.appendChild(C.el('button', {
        class: classeEvento(o, 'tl-blk') + (st === 'em_andamento' ? ' agora' : ''),
        style: 'left:' + ((a - ini) / span * 100) + '%;width:' + ((b - a) / span * 100) +
          '%;top:' + (baseTopo + niveis[idx] * sub + 3) + 'px;height:' + Math.max(8, sub - 6) + 'px',
        text: o.titulo + ' · ' + C.primeiroNome(S.nomePessoa(o.responsavelId)),
        title: S.rotuloEscopo(o.agrupamentoId, o.escopo) + ' · ' + o.inicio + '–' + o.fim,
        onclick: function () { detalhe(o); }
      }));
    });

    return C.el('div', { class: 'tl-row', style: 'min-height:' + (altura + 20) + 'px' }, [
      C.el('div', { class: 'tl-lbl' }, [
        g.nome,
        C.el('small', { text: clinicas.map(function (c) { return c.nome; }).join(' · ') })
      ]),
      trilha
    ]);
  }

  /* Empilha blocos que se sobrepõem DENTRO da mesma faixa: só conta quem
     disputa as mesmas clínicas, e não qualquer bloco do agrupamento. */
  function nivel(lista, idx) {
    var o = lista[idx], n = 0;
    for (var i = 0; i < idx; i++) {
      var p = lista[i];
      if (!S.escoposColidem(o.agrupamentoId, o.escopo, p.agrupamentoId, p.escopo)) continue;
      if (C.sobrepoe(o.inicio, o.fim, p.inicio, p.fim)) n++;
    }
    return n;
  }

  /* ── Recorrências ─────────────────────────────────────────────────── */
  /* `encerradaEm` é o PRIMEIRO dia inválido: o último encontro que existe
     é o da véspera. Tudo que a tela mostra ao usuário usa esse último dia. */
  function ultimoDiaValido(r) {
    return r.encerradaEm ? C.addDays(r.encerradaEm, -1) : null;
  }
  function fimEfetivoDaRegra(r) {
    var u = ultimoDiaValido(r);
    return u && u < r.vigenciaFim ? u : r.vigenciaFim;
  }
  function regraEncerrada(r, hoje) {
    return !!r.encerradaEm && r.encerradaEm <= hoje;
  }
  function temExcecao(r, data) {
    for (var i = 0; i < r.excecoes.length; i++) if (r.excecoes[i].data === data) return true;
    return false;
  }
  /* Encontros que ainda vão acontecer a partir de `deISO`, já descontadas as
     exceções e respeitando o menor entre encerradaEm e vigenciaFim. */
  function encontrosRestantes(r, deISO) {
    var fim = fimEfetivoDaRegra(r);
    var ini = deISO > r.vigenciaInicio ? deISO : r.vigenciaInicio;
    if (!fim || ini > fim) return 0;
    return S.datasDaRegra(r.dias, ini, fim).filter(function (d) {
      return !temExcecao(r, d);
    }).length;
  }

  function listaRecorrencias() {
    var hoje = C.hojeISO();
    var regras = S.estado.recorrencias.slice().sort(function (a, b) {
      return (a.dias[0] - b.dias[0]) || C.toMin(a.inicio) - C.toMin(b.inicio);
    });
    if (!regras.length) return U.vazio('Nenhuma recorrência criada neste semestre.');

    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, [
        C.el('th', { text: 'Turma' }), C.el('th', { text: 'Onde' }),
        C.el('th', { text: 'Dias' }), C.el('th', { text: 'Horário' }),
        C.el('th', { text: 'Cadeiras' }), C.el('th', { text: 'Vigência' }),
        C.el('th', { text: 'Restantes' }), C.el('th', { class: 'right', text: '' })
      ]))
    ]);
    var corpo = C.el('tbody');
    regras.forEach(function (r) {
      var t = S.turma(r.turmaId), d = S.disciplinaDaTurma(t);
      var fimEfetivo = fimEfetivoDaRegra(r);
      var encerrada = regraEncerrada(r, hoje);
      var restantes = encerrada ? 0 : encontrosRestantes(r, hoje);
      corpo.appendChild(C.el('tr', { style: encerrada ? 'opacity:.55' : '' }, [
        C.el('td', {}, [
          C.el('b', { text: d.codigo + ' ' + t.codigo }),
          C.el('div', { class: 'muted', style: 'font-size:12px', text: d.nome + ' · ' + S.nomePessoa(t.professorCoordenadorId) })
        ]),
        C.el('td', { text: S.rotuloEscopo(r.agrupamentoId, r.escopo) }),
        C.el('td', { text: C.listaDias(r.dias) }),
        C.el('td', { class: 'num', text: r.inicio + '–' + r.fim }),
        C.el('td', { class: 'num', text: String(r.cadeiras) }),
        C.el('td', { class: 'num', style: 'font-size:12.5px',
          text: C.fmtDia(r.vigenciaInicio) + ' – ' + C.fmtDia(fimEfetivo) }),
        C.el('td', {}, encerrada
          ? C.el('span', { class: 'badge neutral', text: 'encerrada' })
          : C.el('span', { class: 'num', text: String(restantes) })),
        C.el('td', { class: 'right', style: 'white-space:nowrap' }, [
          r.excecoes.length ? C.el('button', {
            class: 'btn-ghost', text: C.plural(r.excecoes.length, 'exceção', 'exceções'),
            onclick: function () { verExcecoes(r); }
          }) : null,
          S.pode('agenda.criarRecorrente') && !encerrada ? C.el('button', {
            class: 'btn-danger', style: 'margin-left:12px', text: 'Encerrar',
            onclick: function () { encerrarRegra(r); }
          }) : null
        ])
      ]));
    });
    tabela.appendChild(corpo);
    return C.el('div', { class: 'rolagem-x' }, tabela);
  }

  function verExcecoes(r) {
    var t = S.turma(r.turmaId);
    U.modal({
      titulo: 'Exceções · ' + S.rotuloTurma(t),
      subtitulo: 'Datas em que a recorrência não acontece',
      largura: '620px',
      conteudo: C.el('table', { class: 'table' }, C.el('tbody', {}, r.excecoes.map(function (ex) {
        return C.el('tr', {}, [
          C.el('td', { class: 'num', style: 'width:110px', text: C.fmtDiaAno(ex.data) }),
          C.el('td', {}, [
            C.el('div', { text: ex.motivo }),
            C.el('div', { class: 'muted', style: 'font-size:12px',
              text: S.nomePessoa(ex.registradoPor) + ' · ' + C.fmtCarimbo(ex.registradoEm) })
          ]),
          C.el('td', { class: 'right', style: 'width:100px' },
            S.pode('agenda.cancelarQualquer') ? C.el('button', {
              class: 'btn-ghost', text: 'Restaurar',
              onclick: function () {
                /* A permissão é reconferida aqui, e não só na renderização. */
                if (!S.pode('agenda.cancelarQualquer')) {
                  C.toast('Você não tem permissão para restaurar encontros.');
                  return;
                }
                S.restaurarExcecao(r.id, ex.data);
                U.fecharModal(); C.toast('Encontro de ' + C.fmtDia(ex.data) + ' restaurado.');
                global.App.recarregar();
              }
            }) : null)
        ]);
      })))
    });
  }

  function encerrarRegra(r) {
    if (!S.pode('agenda.criarRecorrente')) {
      C.toast('Você não tem permissão para encerrar recorrências.');
      return;
    }
    var t = S.turma(r.turmaId);
    U.confirmar({
      titulo: 'Encerrar recorrência',
      subtitulo: S.rotuloTurmaLongo(t),
      rotulo: 'Encerrar a partir de hoje',
      perigo: true,
      conteudo: C.el('div', {}, [
        C.el('p', { style: 'margin:0' }, [
          'Os encontros já realizados continuam no histórico. Os encontros de ',
          C.el('b', { text: 'hoje em diante' }),
          ' deixam de existir na agenda.'
        ]),
        C.el('p', { class: 'muted', style: 'margin:12px 0 0' }, [
          C.listaDias(r.dias) + ' · ' + r.inicio + '–' + r.fim + ' · ' +
          S.rotuloEscopo(r.agrupamentoId, r.escopo) + '.'
        ])
      ])
    }, function () {
      /* A data gravada é o primeiro dia inválido: hoje já não acontece. */
      S.encerrarRecorrencia(r.id, C.hojeISO());
      C.toast('Recorrência encerrada.');
      global.App.recarregar();
    });
  }

  /* ── Detalhe de uma ocorrência ────────────────────────────────────── */
  function detalhe(o) {
    var st = S.statusOcorrencia(o);
    var podeCancelar = podeCancelarOcorrencia(o) && st !== 'encerrada';
    var faixa = S.faixaEscopo(o.agrupamentoId, o.escopo);

    var conteudo = C.el('div', { class: 'stack', style: 'gap:0' }, [
      U.kv('Agrupamento', S.nomeAgrupamento(o.agrupamentoId)),
      U.kv('Escopo', S.rotuloEscopo(o.agrupamentoId, o.escopo)),
      U.kv('Faixa de cadeiras', faixa[1] >= faixa[0] ? C.pad(faixa[0]) + '–' + C.pad(faixa[1]) : '—'),
      U.kv('Data', C.nomeDia(C.weekday(o.data), true) + ', ' + C.fmtDiaAno(o.data)),
      U.kv('Horário', o.inicio + '–' + o.fim + ' · ' + C.fmtHoras(C.duracaoH(o.inicio, o.fim))),
      U.kv('Tipo', o.origem === 'recorrente'
        ? 'Aula recorrente do semestre'
        : S.rotuloTipoAtividade(o.tipoAtividade) + ' · ocorrência única'),
      o.turmaId ? U.kv('Turma', S.rotuloTurmaLongo(S.turma(o.turmaId))) : null,
      U.kv(o.origem === 'recorrente' ? 'Professor coordenador' : 'Responsável', S.nomePessoa(o.responsavelId)),
      U.kv('Cadeiras', C.plural(o.cadeiras, 'cadeira') + ' de ' +
        S.cadeirasOperantesEscopo(o.agrupamentoId, o.escopo) + ' operantes'),
      U.kv('Situação', U.badgeStatus(st)),
      o.descricao ? C.el('div', { style: 'padding:16px 0 0;font-size:13.5px;line-height:1.6' }, o.descricao) : null
    ]);

    U.modal({
      titulo: o.titulo,
      subtitulo: o.subtitulo,
      largura: '620px',
      conteudo: conteudo,
      acoes: [
        podeCancelar ? C.el('button', {
          class: 'btn btn-outline', text: 'Cancelar ocupação',
          onclick: function () { U.fecharModal(); cancelar(o, function () { global.App.recarregar(); }); }
        }) : null,
        C.el('button', {
          class: 'btn btn-primary', text: 'Ver cadeiras',
          onclick: function () { U.fecharModal(); global.App.ir('agora', { agrupamentoId: o.agrupamentoId }); }
        })
      ]
    });
  }

  /* ── Cancelamento ─────────────────────────────────────────────────────
     `cancelar` é publicada em window e é o ponto de entrada do painel: a
     permissão precisa ser conferida AQUI, e não apenas em quem desenha o
     botão. Esconder o botão não impede ninguém de chamar a função. */
  function podeCancelarOcorrencia(o) {
    if (!o) return false;
    var u = S.usuario();
    if (!u) return false;
    if (S.pode('agenda.cancelarQualquer')) return true;
    return S.pode('agenda.cancelarPropria') && o.responsavelId === u.id;
  }

  function cancelar(o, aoConcluir) {
    if (!o) return;
    if (!podeCancelarOcorrencia(o)) {
      C.toast('Você não tem permissão para cancelar esta ocupação.');
      return;
    }

    if (o.origem === 'pontual') {
      U.confirmar({
        titulo: 'Cancelar atividade',
        subtitulo: o.titulo,
        rotulo: 'Cancelar atividade',
        perigo: true,
        conteudo: C.el('div', {}, [
          'A atividade de ',
          C.el('b', { text: C.fmtDiaAno(o.data) }),
          ', das ' + o.inicio + ' às ' + o.fim + ' em ' +
          S.rotuloEscopo(o.agrupamentoId, o.escopo) + ', será removida da agenda.'
        ])
      }, function () {
        if (!podeCancelarOcorrencia(o)) return;
        S.cancelarOcorrencia(o);
        C.toast('Atividade cancelada.');
        if (aoConcluir) aoConcluir();
      });
      return;
    }

    /* Recorrente: cancela só esta data ou encerra a regra. */
    var motivo = '';
    var alcance = 'data';
    var podeEncerrar = S.pode('agenda.criarRecorrente');
    var btn = C.el('button', { class: 'btn btn-primary', text: 'Confirmar cancelamento', disabled: true, onclick: gravar });

    var conteudo = C.el('div', { class: 'stack' }, [
      C.el('div', { class: 'preview' }, [
        C.el('div', {}, [C.el('b', { text: o.titulo }), ' · ' + o.subtitulo]),
        C.el('div', { class: 'muted', text: C.nomeDia(C.weekday(o.data), true) + ', ' + C.fmtDiaAno(o.data) +
          ' · ' + o.inicio + '–' + o.fim + ' · ' + S.rotuloEscopo(o.agrupamentoId, o.escopo) })
      ]),
      C.el('div', {}, [
        C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:8px', text: 'Alcance' }),
        C.el('div', { class: 'seg' }, [
          C.el('button', { type: 'button', class: 'on', text: 'Somente esta data',
            'aria-pressed': 'true',
            onclick: function () { alcance = 'data'; marcar(this); } }),
          podeEncerrar ? C.el('button', { type: 'button', text: 'Encerrar a recorrência',
            'aria-pressed': 'false',
            onclick: function () { alcance = 'regra'; marcar(this); } }) : null
        ])
      ]),
      U.campo('Motivo', C.el('input', {
        class: 'input', type: 'text', placeholder: 'Ex.: feriado acadêmico, professor em congresso…',
        oninput: function (ev) { motivo = ev.target.value; btn.disabled = motivo.trim().length < 3; }
      }), 'fica registrado na recorrência')
    ]);

    function marcar(b) {
      Array.prototype.forEach.call(b.parentNode.children, function (x) {
        x.className = '';
        x.setAttribute('aria-pressed', 'false');
      });
      b.className = 'on';
      b.setAttribute('aria-pressed', 'true');
    }

    U.modal({
      titulo: 'Cancelar ocupação recorrente',
      subtitulo: 'Escolha se o cancelamento vale só para esta data',
      largura: '620px',
      conteudo: conteudo,
      acoes: [C.el('button', { class: 'btn btn-outline', text: 'Voltar', onclick: U.fecharModal }), btn]
    });

    function gravar() {
      if (motivo.trim().length < 3) return;
      /* Reconferência no caminho de gravação: a sessão pode ter mudado
         entre a abertura do modal e o clique. */
      if (!podeCancelarOcorrencia(o)) {
        U.fecharModal();
        C.toast('Você não tem permissão para cancelar esta ocupação.');
        return;
      }
      if (alcance === 'regra' && !S.pode('agenda.criarRecorrente')) {
        U.fecharModal();
        C.toast('Você não tem permissão para encerrar recorrências.');
        return;
      }
      if (alcance === 'data') {
        S.cancelarOcorrencia(o, motivo.trim());
        C.toast('Encontro de ' + C.fmtDia(o.data) + ' cancelado.');
      } else {
        /* `encerradaEm` é o primeiro dia inválido, então o encontro desta
           data já deixa de existir: a exceção seria redundante. */
        S.encerrarRecorrencia(o.origemId, o.data);
        C.toast('Recorrência encerrada a partir de ' + C.fmtDia(o.data) + '.');
      }
      U.fecharModal();
      if (aoConcluir) aoConcluir();
    }
  }

  global.ViewAgenda = { render: render };
  global.Agenda = { detalhe: detalhe, cancelar: cancelar, podeCancelar: podeCancelarOcorrencia };
})(window);
