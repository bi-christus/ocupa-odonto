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

  /* A régua de horas vem de S.janelaHoras: a versão impressa precisa montar
     a mesma grade, e uma cópia da derivação em cada lado divergiria. */
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

    /* A aba da lixeira só existe para quem pode recuperar: mostrar a lista
       de excluídas a quem não pode fazer nada com ela é ruído. */
    if (vista === 'excluidas' && !S.pode('agenda.excluir')) vista = 'semana';

    alvo.appendChild(cabecalho());
    if (vista === 'semana') alvo.appendChild(gradeSemana());
    else if (vista === 'dia') alvo.appendChild(gantt());
    else if (vista === 'excluidas') alvo.appendChild(listaExcluidas());
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
      : vista === 'excluidas'
        ? 'Reservas excluídas'
        : 'Ocupações · ' + rotuloSemana();
    return C.el('div', { class: 'page-head' }, [
      C.el('h2', { text: titulo }),
      C.el('div', { class: 'row', style: 'gap:10px' }, [
        (vista !== 'recorrencias' && vista !== 'excluidas') ? C.el('div', { class: 'row', style: 'gap:4px' }, [
          C.el('button', { class: 'chip-btn', text: '‹', 'aria-label': 'Semana anterior', title: 'Semana anterior',
            onclick: function () { refSemana = C.addDays(refSemana, -7); diaSel = null; global.App.recarregar(); } }),
          C.el('button', { class: 'chip-btn', text: 'Hoje',
            onclick: function () { refSemana = C.startOfWeek(C.hojeISO()); diaSel = C.hojeISO(); global.App.recarregar(); } }),
          C.el('button', { class: 'chip-btn', text: '›', 'aria-label': 'Próxima semana', title: 'Próxima semana',
            onclick: function () { refSemana = C.addDays(refSemana, 7); diaSel = null; global.App.recarregar(); } })
        ]) : null,
        C.el('div', { class: 'seg' }, [
          aba('semana', 'Semana'), aba('dia', 'Dia'), aba('recorrencias', 'Recorrências'),
          S.pode('agenda.excluir') ? abaExcluidas() : null
        ]),
        /* A lixeira é a única aba sem versão impressa: lista de reserva
           excluída não é documento que circula. */
        vista !== 'excluidas' ? C.el('button', {
          class: 'chip-btn', text: 'Imprimir · PDF',
          title: 'Abre a impressão do navegador — escolha "Salvar como PDF" para gerar o arquivo',
          onclick: imprimirVista
        }) : null,
        podeCriar ? C.el('button', {
          class: 'btn btn-primary', text: 'Nova ocupação',
          onclick: function () { novaOcupacao(); }
        }) : null
      ])
    ]);
  }

  /* Imprime o que está na tela, na mesma forma em que está: é o que a folha
     promete ao sair da aba Agenda. */
  function imprimirVista() {
    if (vista === 'dia') global.Impressao.dia(diaSel);
    else if (vista === 'recorrencias') global.Impressao.recorrencias();
    else global.Impressao.semana(refSemana);
  }
  function aba(id, rotulo) {
    return C.el('button', {
      type: 'button', class: vista === id ? 'on' : '', text: rotulo,
      'aria-pressed': vista === id ? 'true' : 'false',
      onclick: function () { vista = id; global.App.recarregar(); }
    });
  }
  /* A contagem vai na própria aba: lixeira que não avisa que tem coisa
     dentro é lixeira que ninguém abre. */
  function abaExcluidas() {
    var n = S.reservasExcluidas().length;
    return C.el('button', {
      type: 'button', class: vista === 'excluidas' ? 'on' : '',
      'aria-pressed': vista === 'excluidas' ? 'true' : 'false',
      text: n ? 'Excluídas · ' + n : 'Excluídas',
      onclick: function () { vista = 'excluidas'; global.App.recarregar(); }
    });
  }

  /* ── Excluir e recuperar ──────────────────────────────────────────────
     Só coordenação (`agenda.excluir`). Exclusão é reversível: marca o
     documento e solta o horário, mas não apaga nada. */
  function excluirReserva(o) {
    if (!S.pode('agenda.excluir')) { C.toast('Somente a coordenação exclui reservas.'); return; }
    var motivo = '';
    U.modal({
      titulo: 'Excluir reserva',
      subtitulo: S.rotuloReserva(o),
      largura: '580px',
      conteudo: C.el('div', { class: 'stack', style: 'gap:14px' }, [
        C.el('p', { style: 'margin:0;font-size:13.5px;line-height:1.6',
          text: o.tipo === 'pontual'
            ? 'A atividade sai da agenda e o horário fica livre para outra reserva.'
            : 'A recorrência sai da agenda inteira — todos os encontros do semestre — e os horários ficam livres.' }),
        C.el('p', {
          class: 'muted', style: 'margin:0;font-size:12.5px;line-height:1.6',
          text: 'Não é definitivo: fica na aba Excluídas e pode ser recuperada. ' +
            'Mas a recuperação pode falhar se alguém ocupar o horário nesse meio-tempo.'
        }),
        U.campo('Motivo', C.el('input', {
          class: 'input', type: 'text', placeholder: 'Por que está sendo excluída',
          oninput: function (ev) { motivo = ev.target.value; }
        }), 'opcional')
      ]),
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Voltar', onclick: U.fecharModal }),
        C.el('button', {
          class: 'btn btn-perigo', text: 'Excluir reserva',
          onclick: function () {
            U.fecharModal();
            /* Reconferida aqui, não só na renderização. */
            if (!S.pode('agenda.excluir')) { C.toast('Somente a coordenação exclui reservas.'); return; }
            S.excluirReserva(o.id, motivo).then(function (r) {
              if (r && r.ok) C.toast('Reserva excluída — está na aba Excluídas.');
              global.App.recarregar();
            });
          }
        })
      ]
    });
  }

  function recuperarReserva(o) {
    if (!S.pode('agenda.excluir')) { C.toast('Somente a coordenação recupera reservas.'); return; }
    /* A mensagem de choque, quando houver, vem do próprio store pelo toast:
       o horário pode ter sido ocupado enquanto a reserva estava excluída. */
    S.recuperarReserva(o.id).then(function (r) {
      if (r && r.ok) C.toast('Reserva recuperada · ' + S.rotuloReserva(o) + '.');
      global.App.recarregar();
    });
  }

  function listaExcluidas() {
    var lista = S.reservasExcluidas();
    if (!lista.length) {
      return U.vazio('Nenhuma reserva excluída. O que a coordenação excluir aparece aqui e pode ser recuperado.');
    }
    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, [
        C.el('th', { text: 'Tipo' }), C.el('th', { text: 'Reserva' }),
        C.el('th', { text: 'Onde' }), C.el('th', { text: 'Quando' }),
        C.el('th', { text: 'Excluída' }), C.el('th', { class: 'right', text: '' })
      ]))
    ]);
    var corpo = C.el('tbody');
    lista.forEach(function (o) {
      corpo.appendChild(C.el('tr', {}, [
        C.el('td', {}, C.el('span', {
          class: 'badge ' + (o.tipo === 'pontual' ? 'soft' : 'neutral'),
          text: o.tipo === 'pontual' ? 'Pontual' : 'Recorrente'
        })),
        C.el('td', { text: S.rotuloReserva(o) }),
        C.el('td', { text: S.rotuloEscopo(o.agrupamentoId, o.escopo) }),
        C.el('td', { style: 'font-size:12.5px', text: o.tipo === 'pontual'
          ? C.fmtDiaAno(o.data) + ' · ' + o.inicio + '–' + o.fim
          : C.listaDias(o.dias) + ' · ' + o.inicio + '–' + o.fim }),
        C.el('td', { style: 'font-size:12.5px' }, [
          C.el('div', { text: C.fmtCarimbo(o.excluidaEm) }),
          C.el('div', { class: 'muted', text: S.nomePessoa(o.excluidaPor) }),
          o.motivoExclusao
            ? C.el('div', { class: 'muted', text: 'Motivo: ' + o.motivoExclusao })
            : null
        ]),
        C.el('td', { class: 'right', style: 'white-space:nowrap' }, C.el('button', {
          class: 'btn-ghost', text: 'Recuperar',
          onclick: function () { recuperarReserva(o); }
        }))
      ]));
    });
    tabela.appendChild(corpo);
    return C.el('div', {}, [
      C.el('div', {
        class: 'alert', style: 'margin-bottom:18px',
        text: 'Reserva excluída não aparece na agenda e não bloqueia horário. ' +
          'Recuperar devolve a reserva com os registros de cadeira que ela tinha — ' +
          'mas passa pela checagem de sobreposição, e falha se o horário já estiver ocupado.'
      }),
      C.el('div', { class: 'rolagem-x' }, tabela)
    ]);
  }

  /* `inicial` chega do clique na grade ou na pista do dia: { data, inicio }
     e, quando a pista identifica a clínica, também { agrupamentoId, escopo }.
     Sem ele é o botão "Nova ocupação" de sempre, com o formulário em branco. */
  function novaOcupacao(inicial) {
    var slot = C.el('div');
    var pre = null;
    if (inicial && inicial.inicio) {
      pre = {
        data: inicial.data || null,
        inicio: inicial.inicio,
        fim: inicial.fim || terminoPadrao(inicial.inicio),
        agrupamentoId: inicial.agrupamentoId || null,
        escopo: inicial.escopo || null
      };
    }
    U.modal({
      titulo: 'Nova ocupação',
      /* O subtítulo repete o que o clique capturou. Sem isso, um clique de
         um pixel ao lado do pretendido só apareceria lá embaixo, no campo
         de data — e o formulário passaria a impressão de ter inventado o
         horário sozinho. */
      subtitulo: pre && pre.data
        ? C.nomeDia(C.weekday(pre.data), true) + ', ' + C.fmtDiaAno(pre.data) +
          ' · ' + pre.inicio + '–' + pre.fim +
          (pre.agrupamentoId ? ' · ' + S.rotuloEscopo(pre.agrupamentoId, pre.escopo) : '')
        : 'Semestre ' + S.estado.periodoLetivo,
      largura: '840px',
      conteudo: slot
    });
    global.Registro.montar(slot, {
      compacto: true,
      inicial: pre,
      /* Clique num dia e numa hora concretos descreve uma atividade única —
         é assim que se lê o gesto. Trocar para recorrente continua a um
         clique, e leva junto o horário e o dia da semana apontados. */
      modo: pre && pre.data ? 'pontual' : null,
      aoRegistrar: function () { U.fecharModal(); global.App.recarregar(); }
    });
  }

  /* ── Leituras de escopo compartilhadas ────────────────────────────── */
  function ehConjunta(o) {
    return S.idsDoEscopo(o.agrupamentoId, o.escopo).length > 1;
  }
  function classeEvento(o, base) {
    return base + (o.origem === 'pontual' ? ' pontual' : '') + (ehConjunta(o) ? ' conjunta' : '');
  }

  /* ── Semana ───────────────────────────────────────────────────────────
     Calendário de verdade: 58px de régua de horas mais seis colunas de dia,
     e o bloco de cada ocupação POSICIONADO E DIMENSIONADO pelo horário — o
     topo sai do início, a altura sai da duração. Antes o bloco era jogado no
     balde da hora em que começava, todos do mesmo tamanho: uma reserva de
     07:40 às 11:20 parecia durar o mesmo que uma de duas horas, e a coluna
     não dizia nada sobre ocupação real da clínica.

     Ocupações que se cruzam no tempo dividem a largura entre si, como em
     qualquer agenda. A faixa da direita (LARGURA_GUTTER) fica reservada e
     nenhum bloco a ocupa: é o que garante um alvo de clique em QUALQUER
     horário, por mais cheia que a coluna esteja — sem ela, dois blocos lado
     a lado tomam a coluna inteira e lançar uma terceira turma no mesmo
     horário vira impossível, que foi o defeito relatado.

     E a COLUNA SE ADAPTA AOS CARTÕES: a largura de cada dia sai do pico de
     sobreposição dele, não de uma fatia igual para todos. Com seis colunas
     de mesma largura, cinco ocupações cruzadas numa segunda deixavam cada
     cartão com ~35px — o texto virava uma coluna de letras — enquanto os
     outros cinco dias ficavam vazios ocupando o mesmo espaço. Agora o dia
     cheio pede o espaço dos cartões que tem (piso em px) e ainda leva a
     maior parte da sobra (peso em fr); o dia vazio se contenta com o piso. */
  var ALTURA_HORA = 46;
  var LARGURA_GUTTER = 15;
  /* Piso de um cartão. Abaixo disso "Clínicas 7 e 8" e "13:40–17:20 · …" não
     cabem mais em linha e o bloco deixa de ser legível — é a medida que
     decide quando a grade prefere rolar na horizontal a continuar espremendo. */
  var LARGURA_MIN_CARTAO = 104;

  function gradeSemana() {
    var hoje = C.hojeISO();
    var datas = [], total = 0, i;

    for (i = 0; i < 6; i++) datas.push(C.addDays(refSemana, i));
    var janela = S.janelaHoras(datas);
    var H0 = janela[0], H1 = janela[1];
    var altura = (H1 - H0 + 1) * ALTURA_HORA;

    /* A disposição dos seis dias é resolvida ANTES de montar o grid: é o pico
       de sobreposição de cada dia que dimensiona a coluna dele, e a conta não
       pode ser feita lá dentro, depois que as trilhas já estão escritas. De
       quebra, colunaDoDia deixa de repetir a repartição. */
    var dias = datas.map(function (d) {
      var itens = disporEmColunas(S.ocorrenciasDoDia(d));
      var pico = 1;
      itens.forEach(function (x) { if (x.total > pico) pico = x.total; });
      total += itens.length;
      return { data: d, itens: itens, pico: pico };
    });

    /* Cada coluna pede o que os cartões dela precisam. O piso em px reserva
       LARGURA_MIN_CARTAO para cada bloco sobreposto mais o gutter de clique;
       o peso em fr reparte a sobra na mesma proporção, para o dia cheio ficar
       largo quando há espaço. Quando nem os pisos cabem, a grade rola na
       horizontal — voltar a espremer o cartão seria desfazer o conserto. */
    var trilhas = dias.map(function (x) {
      return 'minmax(' + (LARGURA_GUTTER + x.pico * LARGURA_MIN_CARTAO) +
        'px,' + x.pico + 'fr)';
    }).join(' ');

    var topoFixo = 'position:sticky;top:0;z-index:3;background:var(--color-bg);';
    var grade = C.el('div', {
      style: 'display:grid;grid-template-columns:58px ' + trilhas + ';gap:0 8px'
    });
    /* O canto fica preso nos dois eixos: é ele que tapa a régua quando a
       semana cheia rola para o lado. */
    grade.appendChild(C.el('div', {
      style: topoFixo + 'left:0;z-index:5;height:30px'
    }));
    /* O cabeçalho do dia carrega o mesmo sinal da coluna: hoje em destaque,
       dia passado apagado. Sem legenda e sem texto explicativo — é a coluna
       inteira que muda de tom, e isso basta para a pessoa parar de tentar. */
    datas.forEach(function (d) {
      grade.appendChild(C.el('div', {
        style: topoFixo + 'padding-bottom:8px;font:600 13px var(--font-heading);' +
          'letter-spacing:.05em;white-space:nowrap;color:' +
          (d === hoje ? 'var(--accent-ink)'
            : d < hoje ? 'var(--muted-2)' : 'var(--color-text)')
      }, [
        C.nomeDia(C.weekday(d)) + ' ',
        C.el('span', { style: 'color:var(--muted);font-weight:400', text: C.fmtDia(d) })
      ]));
    });

    var regua = C.el('div', { class: 'wk-regua', style: 'height:' + altura + 'px' });
    for (i = H0; i <= H1; i++) {
      regua.appendChild(C.el('div', {
        class: 'wk-hora', style: 'top:' + ((i - H0) * ALTURA_HORA) + 'px',
        text: C.pad(i) + ':00'
      }));
    }
    grade.appendChild(regua);

    dias.forEach(function (x) {
      grade.appendChild(colunaDoDia(x.data, x.itens, H0, H1, altura));
    });

    return C.el('div', {}, [
      C.el('div', { style: 'max-height:640px;overflow:auto' }, grade),
      total ? null : C.el('div', { class: 'muted', style: 'padding:14px 0;font-size:12.5px',
        text: 'Nenhuma ocupação registrada nesta semana.' }),
      legendaSemana()
    ]);
  }

  /* Reparte as ocorrências de um dia em colunas lado a lado: quem se cruza no
     tempo divide a largura, quem não se cruza reaproveita a mesma coluna. O
     agrupamento é por CACHO de sobreposição — um bloco solto no fim do dia
     não fica espremido por causa de dois que se cruzaram de manhã. */
  function disporEmColunas(itens) {
    var ordenados = itens.slice().sort(function (a, b) {
      return C.toMin(a.inicio) - C.toMin(b.inicio) || C.toMin(b.fim) - C.toMin(a.fim);
    });
    var saida = [], cacho = [], fimDoCacho = -1;

    function fechar() {
      if (!cacho.length) return;
      var colunas = [];
      cacho.forEach(function (d) {
        var c = 0;
        while (c < colunas.length && colunas[c] > C.toMin(d.o.inicio)) c++;
        colunas[c] = C.toMin(d.o.fim);
        d.coluna = c;
      });
      cacho.forEach(function (d) { d.total = colunas.length; saida.push(d); });
      cacho = [];
      fimDoCacho = -1;
    }

    ordenados.forEach(function (o) {
      if (cacho.length && C.toMin(o.inicio) >= fimDoCacho) fechar();
      cacho.push({ o: o, coluna: 0, total: 1 });
      fimDoCacho = Math.max(fimDoCacho, C.toMin(o.fim));
    });
    fechar();
    return saida;
  }

  /* `itens` já chega repartido por gradeSemana — [{o, coluna, total}] —,
     porque é da mesma repartição que sai a largura da coluna. */
  function colunaDoDia(data, itens, H0, H1, altura) {
    var livre = podeCriarEm(data);
    var ini = H0 * 60, fim = (H1 + 1) * 60;
    /* A hachura diz "passado", e não "sem permissão": vale para os três
       perfis, inclusive para quem não lança nada. Dia passado nunca é
       `livre`, então as duas classes não se encontram. */
    var col = C.el('div', {
      class: 'wk-col' + (livre ? ' livre' : '') + (data < C.hojeISO() ? ' passado' : ''),
      style: 'height:' + altura + 'px'
    });
    for (var h = H0; h <= H1; h++) {
      col.appendChild(C.el('div', {
        class: 'wk-linha', style: 'top:' + ((h - H0) * ALTURA_HORA) + 'px'
      }));
    }

    itens.forEach(function (d) {
      var a = Math.max(ini, C.toMin(d.o.inicio)), b = Math.min(fim, C.toMin(d.o.fim));
      if (b <= a) return;
      var largura = 'calc((100% - ' + LARGURA_GUTTER + 'px) / ' + d.total + ')';
      col.appendChild(evento(d.o,
        'top:' + ((a - ini) / 60 * ALTURA_HORA) + 'px;' +
        'height:' + Math.max(20, (b - a) / 60 * ALTURA_HORA - 2) + 'px;' +
        'left:calc((100% - ' + LARGURA_GUTTER + 'px) * ' + (d.coluna / d.total) + ');' +
        'width:' + largura));
    });

    if (livre) ligarLancamento(col, data, ini, fim);
    return col;
  }

  /* Arraste para escolher o horário, à maneira de uma agenda de calendário:
     o botão desce numa hora, arrasta e solta noutra, e o formulário abre com
     a faixa inteira já escolhida. O eixo Y da coluna vira horário, encaixado
     em meia hora.

     NÃO EXISTE MAIS `click` AQUI, e é de propósito: clicar sem arrastar é o
     arraste de comprimento zero, que a mesma conta resolve. Manter os dois
     abriria o formulário duas vezes no mesmo gesto.

     O arraste é um por vez e mora fora da função — as outras cinco colunas
     precisam se calar enquanto ele existe, senão o fantasma delas pisca ao
     passar o cursor por cima durante o gesto. */
  var arrastando = null;

  function ligarLancamento(col, data, ini, fim) {
    var minimo = Math.max(60, Number((S.estado.parametros || {}).faixaMinimaMin) || 120);
    var rotulo = C.el('span');
    var fantasma = C.el('div', { class: 'wk-fantasma' }, rotulo);
    col.appendChild(fantasma);

    function minutoDe(ev) {
      var r = col.getBoundingClientRect();
      var m = ini + ((ev.clientY - r.top) / ALTURA_HORA) * 60;
      m = Math.floor(m / 30) * 30;
      return Math.max(ini, Math.min(m, fim - 30));
    }

    /* A faixa vai do slot onde o botão desceu até o slot sob o cursor,
       inclusive — daí o +30. Nunca menor que a faixa mínima, que é o que a
       validação aceita: arrastar 30 minutos e receber um formulário recusado
       seria ensinar a regra pelo erro. Arrastar para CIMA vale igual, o topo
       é só o menor dos dois. */
    function faixa(a, b) {
      var topo = Math.min(a, b);
      var base = Math.max(a, b) + 30;
      if (base - topo < minimo) base = topo + minimo;
      if (base > fim) { base = fim; topo = Math.min(topo, fim - minimo); }
      if (topo < ini) topo = ini;
      return { topo: topo, base: base };
    }
    function mostrar(f) {
      fantasma.style.top = ((f.topo - ini) / 60 * ALTURA_HORA) + 'px';
      fantasma.style.height = ((f.base - f.topo) / 60 * ALTURA_HORA) + 'px';
      /* O rótulo diz a faixa, e não "lançar": durante o arraste é essa
         informação que a pessoa está procurando na tela. */
      rotulo.textContent = C.fromMin(f.topo) + '–' + C.fromMin(f.base);
      fantasma.className = 'wk-fantasma on';
    }
    function esconder() { fantasma.className = 'wk-fantasma'; }

    col.addEventListener('mousemove', function (ev) {
      if (arrastando) return;
      /* Sobre um bloco não há convite: ali o clique abre o detalhe dele. */
      if (ev.target !== col) { esconder(); return; }
      mostrar(faixa(minutoDe(ev), minutoDe(ev)));
    });
    col.addEventListener('mouseleave', function () { if (!arrastando) esconder(); });

    col.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0 || ev.target !== col) return;
      /* Sem isto o navegador entende o gesto como seleção de texto e pinta a
         coluna de azul enquanto se arrasta. */
      ev.preventDefault();
      var origem = minutoDe(ev);
      arrastando = { origem: origem, atual: origem };
      mostrar(faixa(origem, origem));
      document.documentElement.className += ' arrastando-agenda';

      /* Os ouvintes vão no documento, não na coluna: o cursor sai dela o
         tempo todo durante um arraste, e soltar o botão lá fora não pode
         deixar o gesto pela metade. */
      function mover(e) {
        if (!arrastando) return;
        arrastando.atual = minutoDe(e);
        mostrar(faixa(arrastando.origem, arrastando.atual));
      }
      function soltar() {
        document.removeEventListener('mousemove', mover);
        document.removeEventListener('mouseup', soltar);
        document.documentElement.className =
          document.documentElement.className.replace(/\s*arrastando-agenda/, '');
        var f = faixa(arrastando.origem, arrastando.atual);
        arrastando = null;
        esconder();
        novaOcupacao({ data: data, inicio: C.fromMin(f.topo), fim: C.fromMin(f.base) });
      }
      document.addEventListener('mousemove', mover);
      document.addEventListener('mouseup', soltar);
    });
  }

  /* ── Lançamento pelo clique na grade ──────────────────────────────────
     A faixa em que o clique vira formulário é a mesma que o formulário
     aceita: de hoje (ou da abertura do semestre, quando ela ainda não
     chegou) até o fim do semestre. Fora dela a célula não ganha affordance
     nenhuma — abrir um formulário que já nasce recusado ensina o contrário
     do que a regra diz. */
  function podeCriarEm(data) {
    if (!S.pode('agenda.criarRecorrente') && !S.pode('agenda.criarPontual')) return false;
    var s = S.estado.semestre || {};
    var hoje = C.hojeISO();
    var ini = (C.dataValida(s.inicio) && s.inicio > hoje) ? s.inicio : hoje;
    if (data < ini) return false;
    if (C.dataValida(s.fim) && data > s.fim) return false;
    return true;
  }

  /* Duração de partida do bloco criado pelo clique: a faixa mínima do polo,
     que é o menor lançamento que a validação aceita. O turno continua a um
     clique de distância no formulário — ele é atalho, não regra, e por isso
     não é aplicado por conta própria em cima do horário que a pessoa
     acabou de apontar. */
  function terminoPadrao(inicio) {
    var min = Math.max(60, Number((S.estado.parametros || {}).faixaMinimaMin) || 120);
    return C.fromMin(Math.min(23 * 60 + 55, C.toMin(inicio) + min));
  }

  /* `estilo` traz posição e tamanho calculados pela coluna do dia: o bloco é
     absoluto dentro dela, com a altura proporcional à duração. */
  function evento(o, estilo) {
    var rot = S.rotuloEscopo(o.agrupamentoId, o.escopo);
    return C.el('button', {
      class: classeEvento(o, 'ev'),
      style: estilo,
      title: rot + ' · ' + o.inicio + '–' + o.fim + ' · ' + o.titulo +
        ' · ' + C.fmtHoras(C.duracaoH(o.inicio, o.fim)),
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
    var janela = S.janelaHoras([diaSel]);
    var H0 = janela[0], H1 = janela[1];
    var ini = H0 * 60, fim = (H1 + 1) * 60, span = fim - ini;
    var agrupamentos = S.estado.agrupamentos || [];

    var seletor = C.el('div', { class: 'row', style: 'gap:5px;margin-bottom:22px' });
    for (var i = 0; i < 6; i++) {
      (function (i) {
        var d = C.addDays(refSemana, i);
        var on = diaSel === d;
        /* Dia passado continua consultável — só não aceita lançamento. O chip
           fica apagado pelo mesmo motivo do cabeçalho da semana. */
        seletor.appendChild(C.el('button', {
          class: 'chip-btn' + (!on && d < C.hojeISO() ? ' passado' : ''),
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
    var livre = podeCriarEm(diaSel);
    var trilha = C.el('div', {
      class: 'tl-track' + (livre ? ' livre' : '') +
        (diaSel < C.hojeISO() ? ' passado' : ''),
      style: 'height:' + altura + 'px;padding:0'
    });

    /* Guias horizontais: uma acima, uma entre as clínicas e uma abaixo.
       `pointer-events:none` porque elas cobrem a pista inteira: sem isso um
       clique que calhasse na linha de 1px não chegaria à trilha. */
    for (var k = 0; k <= faixas; k++) {
      trilha.appendChild(C.el('div', {
        style: 'position:absolute;left:0;right:0;pointer-events:none;top:' + (k * ALTURA_FAIXA) +
          'px;height:1px;background:var(--line-soft)'
      }));
    }

    /* Clique na pista = lançar aqui. O eixo X vira horário (encaixado em
       meia hora, que é a menor marcação que a régua deixa apontar com
       precisão) e o eixo Y diz qual das duas clínicas do agrupamento foi
       apontada — a faixa de cima é a primeira, a de baixo é a segunda. */
    if (livre) {
      trilha.setAttribute('title', 'Clique para lançar ocupação em ' + g.nome);
      trilha.addEventListener('click', function (ev) {
        if (ev.target !== trilha) return;
        var r = trilha.getBoundingClientRect();
        if (!r.width) return;
        var frac = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        var min = Math.floor((ini + frac * span) / 30) * 30;
        min = Math.max(ini, Math.min(min, fim - 30));
        var faixa = Math.floor(Math.max(0, ev.clientY - r.top) / ALTURA_FAIXA);
        novaOcupacao({
          data: diaSel, inicio: C.fromMin(min), agrupamentoId: g.id,
          escopo: (clinicas.length > 1 && faixa >= 1) ? 'b' : 'a'
        });
      });
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
        /* Nada de repetir o nome embaixo dele: a pré-clínica é um agrupamento
           de uma clínica só, e as duas se chamam igual. */
        S.subtituloAgrupamento(g.id)
          ? C.el('small', { text: S.subtituloAgrupamento(g.id) }) : null
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
    var regras = S.recorrenciasAtivas().slice().sort(function (a, b) {
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
      var t = S.turma(r.turmaId);
      var fimEfetivo = fimEfetivoDaRegra(r);
      var encerrada = regraEncerrada(r, hoje);
      var restantes = encerrada ? 0 : encontrosRestantes(r, hoje);
      corpo.appendChild(C.el('tr', { style: encerrada ? 'opacity:.55' : '' }, [
        /* Rótulos do Store: a especialização da pós se chama pelo nome, e
           nenhum dos dois estoura quando a disciplina sumiu do banco. */
        C.el('td', {}, [
          C.el('b', { text: S.rotuloTurma(t) }),
          C.el('div', { class: 'muted', style: 'font-size:12px',
            text: S.subtituloTurma(t) + ' · ' + S.nomePessoa(t ? t.professorCoordenadorId : null) })
        ]),
        C.el('td', { text: S.rotuloEscopo(r.agrupamentoId, r.escopo) }),
        C.el('td', { text: C.listaDias(r.dias) }),
        C.el('td', { class: 'num', text: r.inicio + '–' + r.fim }),
        /* Derivado: `cadeiras` saiu do documento. */
        C.el('td', { class: 'num', text: String(S.capacidadeEscopo(r.agrupamentoId, r.escopo)) }),
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
          }) : null,
          /* Encerrar preserva o histórico e para daqui pra frente; excluir
             tira a recorrência inteira da agenda, e dá para desfazer. */
          S.pode('agenda.excluir') ? C.el('button', {
            class: 'btn-danger', style: 'margin-left:12px', text: 'Excluir',
            onclick: function () { excluirReserva(r); }
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
      U.kv('Professor coordenador', S.nomePessoa(o.responsavelId)),
      U.kv('Cadeiras', C.plural(o.cadeiras, 'cadeira') + ' de ' +
        S.cadeirasOperantesEscopo(o.agrupamentoId, o.escopo) + ' operantes'),
      U.kv('Situação', U.badgeStatus(st)),
      /* Ocupação gravada antes de 17/09/2026 tem título escrito à mão. O
         nome exibido agora é derivado do tipo e da turma, então o texto
         original só sobrevive aqui — some da tela se não for mostrado. */
      o.tituloOriginal ? U.kv('Título original', o.tituloOriginal) : null,
      o.descricao ? C.el('div', { style: 'padding:16px 0 0;font-size:13.5px;line-height:1.6' }, o.descricao) : null
    ]);

    U.modal({
      titulo: o.titulo,
      subtitulo: o.subtitulo,
      largura: '620px',
      conteudo: conteudo,
      acoes: [
        /* Excluir age no DOCUMENTO, não nesta data: numa recorrente derruba o
           semestre inteiro. Por isso o rótulo é diferente de "Cancelar
           ocupação", que tira só este encontro. */
        S.pode('agenda.excluir') ? C.el('button', {
          class: 'btn btn-danger', style: 'margin-right:auto',
          text: o.origem === 'recorrente' ? 'Excluir recorrência' : 'Excluir reserva',
          onclick: function () {
            var bruta = S.reservaPorId(o.origemId);
            if (!bruta) { C.toast('Reserva não encontrada.'); return; }
            U.fecharModal();
            excluirReserva(bruta);
          }
        }) : null,
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
        C.el('div', {}, [C.el('b', { text: o.titulo }), o.subtitulo ? ' · ' + o.subtitulo : '']),
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
