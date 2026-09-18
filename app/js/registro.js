/* registro.js — formulário de registro de ocupação.
   Um único formulário atende os dois casos:
     · recorrente — turma da graduação, criada uma vez, repete toda semana
       nos mesmos dias e horários até o fim do semestre;
     · pontual — atividade única, com data própria.
   A ocupação não aponta mais para uma clínica solta: escolhe um ESCOPO —
   a primeira clínica do agrupamento, a segunda, ou as duas juntas. É o par
   (agrupamentoId, escopo) que viaja para a capacidade, para os conflitos e
   para o store.
   Valida faixa, capacidade, janela de funcionamento e sobreposição antes de
   deixar registrar, e mostra o que será gerado antes da confirmação. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, D = global.Dados;

  /* `inteiroDe` saiu junto com o campo de quantidade de cadeiras: não há mais
     número digitado para sanear. A reserva é sempre o escopo inteiro. */

  function maiorData(a, b) { if (!a) return b; if (!b) return a; return a > b ? a : b; }
  function menorData(a, b) { if (!a) return b; if (!b) return a; return a < b ? a : b; }

  /* montar(alvo, opcoes) → renderiza no elemento `alvo`.
     opcoes.modo          'recorrente' | 'pontual' (inicial)
     opcoes.aoRegistrar   callback(resultado) após gravar
     opcoes.compacto      true no painel (esconde o título interno)
     opcoes.inicial       pré-preenchimento vindo do clique na agenda —
                          { data, inicio, fim, agrupamentoId, escopo } */
  function montar(alvo, opcoes) {
    opcoes = opcoes || {};
    var u = S.usuario();
    var podeRec = S.pode('agenda.criarRecorrente');
    var podePont = S.pode('agenda.criarPontual');
    if (!podeRec && !podePont) {
      C.clear(alvo).appendChild(U.semPermissao(
        'Seu perfil consulta a agenda, mas não registra ocupações. Peça à coordenação para lançar o horário.'));
      return;
    }

    var e = S.estado;

    /* Sem agrupamento com clínica não existe escopo possível: o formulário
       inteiro dependeria de um índice zero que não está lá. */
    var agrupamentosValidos = (e.agrupamentos || []).filter(function (g) {
      return S.clinicasDoAgrupamento(g.id).length > 0;
    });
    if (!agrupamentosValidos.length) {
      C.clear(alvo).appendChild(U.vazio(
        'Nenhuma clínica cadastrada — a coordenação precisa montar a estrutura antes de registrar ocupação.'));
      return;
    }

    var modo = opcoes.modo || (podeRec ? 'recorrente' : 'pontual');
    if (modo === 'recorrente' && !podeRec) modo = 'pontual';
    if (modo === 'pontual' && !podePont) modo = 'recorrente';

    /* Turmas visíveis: o professor lança apenas para as turmas que coordena.
       Sem fallback para a lista inteira — quem não coordena turma nenhuma
       não pode vincular a atividade pontual à turma de outro professor. */
    var turmasVisiveis = u.perfil === 'professor' ? S.turmasDoProfessor(u.id) : e.turmas;

    var lim = limitesSemestre();
    var form = {
      agrupamentoId: agrupamentosValidos[0].id,
      escopo: 'a',
      turmaId: turmasVisiveis.length ? turmasVisiveis[0].id : null,
      dias: [1, 3],
      inicio: '07:30', fim: '11:30',
      vigenciaInicio: menorData(maiorData(lim.inicio, C.hojeISO()), lim.fim),
      vigenciaFim: lim.fim,
      observacao: '',
      /* pontual */
      data: primeiroDiaUtil(menorData(maiorData(lim.inicio, C.hojeISO()), lim.fim)),
      tipoAtividade: 'graduacao',
      turmaVinculada: '',
      /* O professor coordenador padrão é sempre quem está registrando: é ele
         quem responde pela ocupação e quem pode cancelá-la depois. O campo
         continua se chamando `responsavelId` no Firestore e em toda a lógica
         de permissão — só o rótulo de tela virou "Professor coordenador". */
      responsavelId: u.id,
      descricao: ''
    };
    aplicarInicial(opcoes.inicial);
    encaixarNaJanela();

    var raiz = C.clear(alvo);
    var corpo = C.el('div');
    var painelPre = C.el('div', { class: 'preview' });
    var avisos = C.el('div', { class: 'stack', style: 'gap:9px' });
    var acao = C.el('button', { class: 'btn btn-primary', type: 'button', onclick: registrar });
    /* Válvula de escape do bloqueio por choque: um único conflito em
       qualquer sexta do semestre não pode inviabilizar a turma inteira. */
    var acaoPular = C.el('button', {
      class: 'btn btn-outline', type: 'button',
      style: 'display:none', onclick: registrarPulando
    });

    /* Seletor de modo */
    var botoesModo = [];
    var seg = C.el('div', { class: 'seg', style: 'margin-bottom:20px' }, [
      podeRec ? botaoModo('recorrente', 'Recorrente · turma do semestre') : null,
      podePont ? botaoModo('pontual', 'Pontual · atividade única') : null
    ]);

    function botaoModo(m, rotulo) {
      var b = C.el('button', {
        type: 'button', class: modo === m ? 'on' : '', text: rotulo,
        'aria-pressed': modo === m ? 'true' : 'false',
        onclick: function () { trocar(m); }
      });
      botoesModo.push({ modo: m, no: b });
      return b;
    }

    if (!opcoes.compacto) raiz.appendChild(C.el('h5', { text: 'Nova ocupação', style: 'margin-bottom:16px' }));
    raiz.appendChild(seg);
    raiz.appendChild(corpo);
    raiz.appendChild(C.el('div', { style: 'display:flex;flex-direction:column;gap:14px;margin-top:20px' }, [
      painelPre, avisos,
      C.el('div', { class: 'row', style: 'display:flex;gap:10px;flex-wrap:wrap' }, [acao, acaoPular])
    ]));

    function trocar(m) {
      if (modo === m) return;
      modo = m;
      botoesModo.forEach(function (b) {
        b.no.className = b.modo === m ? 'on' : '';
        b.no.setAttribute('aria-pressed', b.modo === m ? 'true' : 'false');
      });
      /* Higiene: o texto livre da tentativa anterior não segue para o outro
         modo, onde ele ficaria invisível até a hora de gravar. */
      form.observacao = '';
      form.descricao = '';
      desenhar();
    }

    /* ── Semestre, janela e escopo ────────────────────────────────────── */
    /* Limites do semestre, tolerantes a um estado já corrompido: com
       semestre.inicio vazio a validação nova trancaria o usuário para
       sempre em vez de apenas recusar a data errada. */
    function limitesSemestre() {
      var s = (S.estado && S.estado.semestre) || {};
      var ini = C.dataValida(s.inicio) ? s.inicio : C.hojeISO();
      var fim = C.dataValida(s.fim) ? s.fim : C.addDays(ini, 18 * 7);
      if (fim < ini) fim = ini;
      return { inicio: ini, fim: fim };
    }

    /* Domingo não existe na grade da semana nem no gantt (seg–sáb). */
    function primeiroDiaUtil(iso) {
      return C.weekday(iso) === 0 ? C.addDays(iso, 1) : iso;
    }

    /* Janela de funcionamento do escopo: a interseção das duas clínicas,
       porque a ocupação conjunta precisa caber nas duas. */
    function janelaDe(agrupamentoId, escopo) {
      var l = S.clinicasDoEscopo(agrupamentoId, escopo);
      var p = e.parametros || {};
      var ab = null, fe = null;
      l.forEach(function (c) {
        var a = c.abertura || p.aberturaPadrao || '07:00';
        var f = c.fechamento || p.fechamentoPadrao || '22:00';
        if (ab === null || C.toMin(a) > C.toMin(ab)) ab = a;
        if (fe === null || C.toMin(f) < C.toMin(fe)) fe = f;
      });
      if (!ab) ab = p.aberturaPadrao || '07:00';
      if (!fe) fe = p.fechamentoPadrao || '22:00';
      if (C.toMin(fe) <= C.toMin(ab)) fe = C.fromMin(Math.min(23 * 60 + 55, C.toMin(ab) + 60));
      return { abertura: ab, fechamento: fe };
    }
    function janela() { return janelaDe(form.agrupamentoId, form.escopo); }

    /* Encaixa início e término na janela do escopo atual. Trocar de escopo
       pode estreitar o horário de funcionamento. */
    function encaixarNaJanela() {
      var jan = janela();
      var ab = C.toMin(jan.abertura), fe = C.toMin(jan.fechamento);
      var ini = Math.min(Math.max(C.toMin(form.inicio), ab), fe);
      var fim = Math.min(Math.max(C.toMin(form.fim), ab), fe);
      if (fim <= ini) fim = Math.min(fe, ini + duracaoMinima());
      if (fim <= ini) ini = Math.max(ab, fim - duracaoMinima());
      form.inicio = C.fromMin(ini);
      form.fim = C.fromMin(fim);
    }
    function duracaoMinima() {
      return Math.max(60, Number((e.parametros || {}).faixaMinimaMin) || 60);
    }

    /* ── Pré-preenchimento vindo do clique na agenda ──────────────────
       A agenda passa o que o clique já determinou — dia, hora, agrupamento e
       escopo — e o resto do formulário continua nos padrões. Nada entra sem
       ser conferido: o clique devolve coordenada de tela, não garantia de
       que o agrupamento ainda existe ou de que a data cabe no semestre.
       A hora entra crua; quem encaixa na janela de funcionamento é
       `encaixarNaJanela`, chamada logo depois. */
    function aplicarInicial(ini) {
      if (!ini) return;
      var achou = false;
      agrupamentosValidos.forEach(function (g) { if (g.id === ini.agrupamentoId) achou = true; });
      if (achou) {
        form.agrupamentoId = ini.agrupamentoId;
        form.escopo = (ini.escopo === 'b' || ini.escopo === 'ambas') ? ini.escopo : 'a';
      }
      if (/^\d{1,2}:\d{2}$/.test(String(ini.inicio))) form.inicio = ini.inicio;
      if (/^\d{1,2}:\d{2}$/.test(String(ini.fim))) form.fim = ini.fim;
      if (C.dataValida(ini.data) && C.weekday(ini.data) !== 0) {
        form.data = ini.data;
        /* Trocar de modo preserva o que já foi preenchido, então o dia
           clicado também precisa fazer sentido na recorrente: vira o único
           dia da semana marcado e o começo da vigência. */
        form.dias = [C.weekday(ini.data)];
        if (ini.data >= lim.inicio && ini.data <= lim.fim) form.vigenciaInicio = ini.data;
      }
    }

    function valorEscopo(agrupamentoId, escopo) { return agrupamentoId + '|' + escopo; }

    /* Lista única de escopos: as duas clínicas de cada agrupamento e a
       opção conjunta. "Clínica 3 · Endodontia" / "Clínicas 3 e 4 · duas
       clínicas". */
    function opcoesEscopo() {
      var out = [];
      agrupamentosValidos.forEach(function (g) {
        var cls = S.clinicasDoAgrupamento(g.id);
        cls.forEach(function (c, i) {
          out.push({
            valor: valorEscopo(g.id, i === 0 ? 'a' : 'b'),
            rotulo: c.nome + (c.especialidade ? ' · ' + c.especialidade : '')
          });
        });
        if (cls.length > 1) {
          out.push({ valor: valorEscopo(g.id, 'ambas'), rotulo: g.nome + ' · duas clínicas' });
        }
      });
      return out;
    }

    function aplicarEscopo(v) {
      var p = String(v).split('|');
      if (!S.agrupamento(p[0])) return;
      form.agrupamentoId = p[0];
      form.escopo = p[1] === 'b' || p[1] === 'ambas' ? p[1] : 'a';
      encaixarNaJanela();
      desenhar();
    }

    function campoEscopo() {
      var f = S.faixaEscopo(form.agrupamentoId, form.escopo);
      return U.campo('Clínica',
        U.selecao(opcoesEscopo(), valorEscopo(form.agrupamentoId, form.escopo), aplicarEscopo),
        'cadeiras ' + f[0] + '–' + f[1]);
    }

    /* Não existe mais campo de quantidade: reservar uma clínica reserva as 14
       cadeiras dela, e o escopo duplo reserva as 28. O que o professor
       registra depois, cadeira por cadeira, é quem está em uso — e é isso que
       mede a ocupação nos relatórios. A linha abaixo mostra o que a reserva
       compromete, sem pedir número. */
    function avisoDaReserva() {
      var cap = S.capacidadeEscopo(form.agrupamentoId, form.escopo);
      var operantes = S.cadeirasOperantesEscopo(form.agrupamentoId, form.escopo);
      var texto = 'Reserva ' + C.plural(cap, 'cadeira', 'cadeiras') + ' — ' +
        S.rotuloEscopo(form.agrupamentoId, form.escopo) + ' por inteiro.';
      if (operantes < cap) {
        texto += ' ' + C.plural(cap - operantes, 'cadeira está', 'cadeiras estão') +
          ' em manutenção, então ' + operantes + ' ficam utilizáveis.';
      }
      return C.el('div', { class: 'alert', style: 'margin-top:16px', text: texto });
    }

    function campoInicio() {
      var jan = janela();
      return U.campo('Início', U.hora(form.inicio, function (v) {
        form.inicio = v; ajustarFim(); atualizar();
      }, { min: jan.abertura, max: jan.fechamento }));
    }
    function campoTermino() {
      var jan = janela();
      return U.campo('Término', U.hora(form.fim, function (v) {
        form.fim = v; atualizar();
      }, { min: jan.abertura, max: jan.fechamento }));
    }

    /* ── Turnos ───────────────────────────────────────────────────────
       Atalho que preenche início e término de uma vez. NÃO substitui os
       campos de hora: eles seguem livres, e digitar neles apenas desmarca o
       turno — a marcação é derivada do horário, não um estado à parte, então
       não existe como o botão e os campos discordarem.
       Um turno que não cabe na janela do escopo, ou que seria menor que a
       faixa mínima, aparece desabilitado com o motivo no title: melhor do que
       oferecer um preenchimento que a validação recusaria logo em seguida. */
    /* Professor com a exigência ligada não registra: pede. Muda o rótulo do
       botão, o aviso do formulário e o toast — a ação é outra. */
    function souPedido() {
      return u.perfil === 'professor' && S.exigirAprovacao();
    }

    function turnoCabe(t) {
      var jan = janela();
      return C.toMin(t.inicio) >= C.toMin(jan.abertura) &&
        C.toMin(t.fim) <= C.toMin(jan.fechamento) &&
        C.toMin(t.fim) - C.toMin(t.inicio) >= duracaoMinima();
    }
    function turnoAtual() {
      var achado = null;
      D.TURNOS.forEach(function (t) {
        if (t.inicio === form.inicio && t.fim === form.fim) achado = t.id;
      });
      return achado;
    }

    /* Único lugar que decide a aparência dos botões — quem monta e quem
       re-sincroniza chamam a mesma função, então não há como as duas
       versões divergirem.
       Precisa existir separado da montagem porque os campos de hora chamam
       só `atualizar()`, sem redesenhar (redesenhar roubaria o foco de quem
       está digitando). Sem esta re-sincronização, escolher "Manhã" e depois
       corrigir o término na mão deixava o botão aceso mentindo sobre o
       horário que está de fato no formulário. */
    var caixaTurnos = null;
    function sincronizarTurnos() {
      if (!caixaTurnos) return;
      var atual = turnoAtual();
      var jan = janela();
      D.TURNOS.forEach(function (t) {
        var b = caixaTurnos.querySelector('[data-turno="' + t.id + '"]');
        if (!b) return;
        var on = atual === t.id;
        var cabe = turnoCabe(t);
        b.className = on ? 'on' : '';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = !cabe;
        b.title = cabe
          ? 'Preenche início e término com ' + t.inicio + '–' + t.fim
          : 'Não cabe na janela deste escopo (' + jan.abertura + '–' + jan.fechamento + ').';
      });
    }
    function blocoTurnos() {
      caixaTurnos = C.el('div', { class: 'turnos' }, D.TURNOS.map(function (t) {
        return C.el('button', {
          type: 'button', 'data-turno': t.id,
          onclick: function () {
            form.inicio = t.inicio;
            form.fim = t.fim;
            desenhar();
          }
        }, [t.rotulo, C.el('small', { text: t.inicio + '–' + t.fim })]);
      }));
      sincronizarTurnos();
      return C.el('div', { style: 'margin-top:16px' }, [
        C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:7px', text: 'Turno' }),
        caixaTurnos
      ]);
    }

    /* ── Campos ───────────────────────────────────────────────────── */
    function opcoesTurma(lista, comVazio) {
      var arr = comVazio ? [{ valor: '', rotulo: '— sem turma vinculada —' }] : [];
      if (!comVazio && !lista.length) arr.push({ valor: '', rotulo: '— nenhuma turma disponível —' });
      /* Pelo rótulo longo do Store: na graduação dá o mesmo texto de sempre
         ("ODO-101 T1 · Clínica Integrada") e na pós dá "Pós-graduação ·
         Implantodontia", em vez do código interno da especialização. */
      return arr.concat(lista.map(function (t) {
        return { valor: t.id, rotulo: S.rotuloTurmaLongo(t) };
      }));
    }
    function opcoesResponsavel() {
      return e.usuarios.filter(function (x) {
        return x.ativo && (x.perfil === 'professor' || x.perfil === 'coordenador');
      }).map(function (x) { return { valor: x.id, rotulo: x.nome + ' · ' + global.Acesso.nomePerfil(x.perfil) }; });
    }

    function desenhar() {
      C.clear(corpo);
      var l = limitesSemestre();
      var minPontual = maiorData(l.inicio, C.hojeISO());
      if (minPontual > l.fim) minPontual = l.inicio;

      if (modo === 'recorrente') {
        corpo.appendChild(C.el('div', { class: 'grid-fields' }, [
          U.campo('Disciplina · turma', U.selecao(opcoesTurma(turmasVisiveis), form.turmaId, function (v) {
            form.turmaId = v || null; atualizar();
          })),
          campoEscopo()
        ]));

        corpo.appendChild(C.el('div', { style: 'margin-top:16px' }, [
          C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:7px', text: 'Dias da semana' }),
          U.seletorDias(form.dias, function () { atualizar(); })
        ]));

        corpo.appendChild(blocoTurnos());

        corpo.appendChild(C.el('div', { class: 'grid-fields', style: 'margin-top:16px' }, [
          campoInicio(), campoTermino()
        ]));

        corpo.appendChild(avisoDaReserva());

        corpo.appendChild(C.el('div', { class: 'grid-fields', style: 'margin-top:16px' }, [
          U.campo('Repete de', C.el('input', {
            class: 'input', type: 'date', value: form.vigenciaInicio, min: l.inicio, max: l.fim,
            oninput: function (ev) { form.vigenciaInicio = ev.target.value; atualizar(); }
          }), 'primeira semana'),
          U.campo('Repete até', C.el('input', {
            class: 'input', type: 'date', value: form.vigenciaFim, min: l.inicio, max: l.fim,
            oninput: function (ev) { form.vigenciaFim = ev.target.value; atualizar(); }
          }), 'fim do semestre ' + e.periodoLetivo)
        ]));

        corpo.appendChild(C.el('div', { style: 'margin-top:16px' },
          U.campo('Observação', C.el('textarea', {
            class: 'input', rows: '2', value: form.observacao,
            placeholder: 'Opcional — ex.: turma dividida em dois grupos alternados.',
            oninput: function (ev) { form.observacao = ev.target.value; }
          }))));

        acao.textContent = 'Criar recorrência';
      } else {
        /* Dizer que o pedido NÃO segura o horário é obrigatório: quem pede
           assume que pedir já garante, e aí descobre no dia. */
        if (souPedido()) {
          corpo.appendChild(C.el('div', {
            class: 'alert', style: 'margin-bottom:16px',
            text: 'Isto vai para a coordenação como pedido. Não reserva a clínica enquanto ' +
              'não for aprovado, e o mesmo horário pode ser pedido por outra pessoa nesse meio-tempo.'
          }));
        }

        /* Não existe mais campo de título: o nome da atividade é derivado do
           tipo e da turma (ou de quem pediu, quando não há turma). */
        corpo.appendChild(C.el('div', { class: 'grid-fields' }, [
          U.campo('Tipo', U.selecao(D.TIPOS_ATIVIDADE.map(function (t) {
            return { valor: t.id, rotulo: t.rotulo };
          }), form.tipoAtividade, function (v) { form.tipoAtividade = v; atualizar(); }),
            'o nome da atividade vem do tipo e da turma')
        ]));

        corpo.appendChild(C.el('div', { class: 'grid-fields', style: 'margin-top:16px' }, [
          campoEscopo(),
          U.campo('Data', C.el('input', {
            class: 'input', type: 'date', value: form.data, min: minPontual, max: l.fim,
            oninput: function (ev) { form.data = ev.target.value; atualizar(); }
          }))
        ]));

        corpo.appendChild(blocoTurnos());

        corpo.appendChild(C.el('div', { class: 'grid-fields', style: 'margin-top:16px' }, [
          campoInicio(), campoTermino()
        ]));

        corpo.appendChild(avisoDaReserva());

        corpo.appendChild(C.el('div', { class: 'grid-fields', style: 'margin-top:16px' }, [
          U.campo('Turma vinculada', U.selecao(opcoesTurma(turmasVisiveis, true), form.turmaVinculada, function (v) {
            form.turmaVinculada = v; atualizar();
          }), 'opcional'),
          U.campo('Professor coordenador', U.selecao(opcoesResponsavel(), form.responsavelId, function (v) {
            form.responsavelId = v; atualizar();
          }, u.perfil === 'professor' ? { disabled: true } : null))
        ]));

        corpo.appendChild(C.el('div', { style: 'margin-top:16px' },
          U.campo('Descrição', C.el('textarea', {
            class: 'input', rows: '2', value: form.descricao,
            placeholder: 'O que acontece nesta ocupação? Fica visível para quem consulta a agenda.',
            oninput: function (ev) { form.descricao = ev.target.value; }
          }))));

        /* O botão não pode prometer "registrar" quando o que vai acontecer é
           um pedido esperando a coordenação. */
        acao.textContent = souPedido() ? 'Solicitar ocupação' : 'Registrar atividade';
      }
      atualizar();
    }

    /* Ao mudar o início, empurra o término mantendo a duração mínima. O teto
       é o fechamento real do escopo: um valor fora da janela deixava o campo
       inconsistente e o formulário guardava um término que não existe. */
    function ajustarFim() {
      if (C.toMin(form.fim) > C.toMin(form.inicio)) return;
      var teto = C.toMin(janela().fechamento);
      form.fim = C.fromMin(Math.min(teto, C.toMin(form.inicio) + duracaoMinima()));
      desenhar();
    }

    /* ── Validação e prévia ───────────────────────────────────────── */
    function datasAlvo() {
      if (modo === 'pontual') return C.dataValida(form.data) ? [form.data] : [];
      if (!C.dataValida(form.vigenciaInicio) || !C.dataValida(form.vigenciaFim)) return [];
      if (form.vigenciaFim < form.vigenciaInicio) return [];
      return S.datasDaRegra(form.dias, form.vigenciaInicio, form.vigenciaFim);
    }

    function validar() {
      var erros = [];
      var l = limitesSemestre();
      var jan = janela();
      var minPontual = maiorData(l.inicio, C.hojeISO());
      if (minPontual > l.fim) minPontual = l.inicio;

      /* Horário */
      if (!/^\d{1,2}:\d{2}$/.test(String(form.inicio)) || !/^\d{1,2}:\d{2}$/.test(String(form.fim))) {
        erros.push('Informe o início e o término.');
      } else {
        var dur = C.toMin(form.fim) - C.toMin(form.inicio);
        if (dur <= 0) erros.push('O término precisa ser depois do início.');
        else if (dur < e.parametros.faixaMinimaMin) {
          erros.push('A faixa mínima de ocupação é de ' + C.fmtHoras(e.parametros.faixaMinimaMin / 60) + '.');
        }
        if (C.toMin(form.inicio) < C.toMin(jan.abertura) || C.toMin(form.fim) > C.toMin(jan.fechamento)) {
          erros.push('O horário precisa ficar entre ' + jan.abertura + ' e ' + jan.fechamento +
            ' — é a janela de funcionamento deste escopo.');
        }
      }

      /* Sem validação de quantidade de cadeiras: não há número a validar. A
         reserva é o escopo inteiro, e cadeira em manutenção não impede a
         reserva — só reduz o que fica utilizável, o que o aviso já diz. */

      if (modo === 'recorrente') {
        if (!form.turmaId || !S.turma(form.turmaId)) erros.push('Selecione a disciplina · turma.');
        if (!form.dias.length) erros.push('Escolha ao menos um dia da semana.');
        else if (form.dias.indexOf(0) !== -1) {
          erros.push('Domingo não entra na grade da semana — escolha de segunda a sábado.');
        }
        if (!C.dataValida(form.vigenciaInicio) || !C.dataValida(form.vigenciaFim)) {
          erros.push('Informe o período de vigência.');
        } else if (form.vigenciaFim < form.vigenciaInicio) {
          erros.push('"Repete até" precisa ser depois de "Repete de".');
        } else if (form.vigenciaInicio < l.inicio || form.vigenciaFim > l.fim) {
          erros.push('A vigência precisa ficar dentro do semestre — de ' +
            C.fmtDiaAno(l.inicio) + ' a ' + C.fmtDiaAno(l.fim) + '.');
        } else if (!datasAlvo().length) {
          erros.push('O período de vigência não gera nenhum encontro.');
        }
      } else {
        if (!C.dataValida(form.data)) erros.push('Informe a data.');
        else if (C.weekday(form.data) === 0) {
          erros.push('Domingo não entra na grade da semana — escolha de segunda a sábado.');
        } else if (form.data < minPontual || form.data > l.fim) {
          erros.push('A data precisa ficar entre ' + C.fmtDiaAno(minPontual) + ' e ' + C.fmtDiaAno(l.fim) + '.');
        }
        if (!form.responsavelId || !S.pessoa(form.responsavelId)) erros.push('Informe o professor coordenador.');
      }
      return erros;
    }

    /* Datas distintas em que a ocupação bateria com uma já registrada. */
    function datasEmChoque(choques) {
      var out = [];
      choques.forEach(function (o) { if (out.indexOf(o.data) === -1) out.push(o.data); });
      return out.sort();
    }

    function atualizar() {
      sincronizarTurnos();
      var erros = validar();
      var datas = datasAlvo();
      var choques = erros.length ? [] :
        S.conflitos(form.agrupamentoId, form.escopo, datas, form.inicio, form.fim);
      var rotulo = S.rotuloEscopo(form.agrupamentoId, form.escopo);
      /* A prévia diz o que a reserva compromete — o escopo inteiro. */
      var cad = S.capacidadeEscopo(form.agrupamentoId, form.escopo);

      /* Prévia */
      C.clear(painelPre);
      var dur = C.duracaoH(form.inicio, form.fim);
      if (isNaN(dur) || dur < 0) dur = 0;
      if (modo === 'recorrente') {
        var t = S.turma(form.turmaId);
        painelPre.appendChild(C.el('div', {}, [
          C.el('b', { text: 'Repete toda semana' }), ' · ',
          C.el('b', { text: C.listaDias(form.dias) }), ' · ',
          C.el('b', { text: form.inicio + '–' + form.fim }),
          ' · ' + C.fmtHoras(dur) + ' por encontro',
          form.escopo === 'ambas'
            ? C.el('span', { class: 'badge conjunta', style: 'margin-left:8px', text: 'Nas duas clínicas' })
            : null
        ]));
        painelPre.appendChild(C.el('div', { class: 'muted' }, [
          C.plural(datas.length, 'encontro', 'encontros') +
          ' entre ' + (C.dataValida(form.vigenciaInicio) ? C.fmtDiaAno(form.vigenciaInicio) : '—') +
          ' e ' + (C.dataValida(form.vigenciaFim) ? C.fmtDiaAno(form.vigenciaFim) : '—') +
          ' · ' + C.fmtHoras(dur * datas.length) + ' no semestre'
        ]));
        if (t) {
          painelPre.appendChild(C.el('div', { class: 'muted' }, [
            rotulo + ' · ' + C.plural(cad, 'cadeira', 'cadeiras') +
            ' · professor coordenador: ' + S.nomePessoa(t.professorCoordenadorId)
          ]));
        }
      } else {
        painelPre.appendChild(C.el('div', {}, [
          C.el('b', { text: 'Ocorre uma única vez' }), ' · ',
          C.el('b', {
            text: C.dataValida(form.data)
              ? C.nomeDia(C.weekday(form.data), true) + ', ' + C.fmtDiaAno(form.data) : '—'
          }),
          ' · ', C.el('b', { text: form.inicio + '–' + form.fim }), ' · ' + C.fmtHoras(dur),
          form.escopo === 'ambas'
            ? C.el('span', { class: 'badge conjunta', style: 'margin-left:8px', text: 'Nas duas clínicas' })
            : null
        ]));
        painelPre.appendChild(C.el('div', { class: 'muted' }, [
          S.rotuloTipoAtividade(form.tipoAtividade) + ' · ' + rotulo +
          ' · ' + C.plural(cad, 'cadeira', 'cadeiras') + ' · professor coordenador: ' + S.nomePessoa(form.responsavelId) +
          (form.turmaVinculada && S.turma(form.turmaVinculada)
            ? ' · ' + S.rotuloTurma(S.turma(form.turmaVinculada)) : '')
        ]));
      }

      /* Avisos */
      C.clear(avisos);
      /* Sistema recém-instalado não tem turma nenhuma. Aí a ausência de turma
         não é erro do usuário, é o próximo passo dele: mostrar alerta
         vermelho em quem acabou de chegar acusa de um engano que não houve. */
      var semTurmaAlguma = modo === 'recorrente' && !S.estado.turmas.length;
      if (semTurmaAlguma) {
        avisos.appendChild(C.el('div', { class: 'alert' }, [
          'Nenhuma turma cadastrada ainda. Crie a disciplina e a turma na aba ',
          C.el('b', { text: 'Disciplinas' }),
          ' — a partir daí as aulas do semestre podem ser registradas aqui.'
        ]));
      }
      erros.forEach(function (m) {
        /* Nesse estado inicial, cobrar a turma é repetir o aviso acima. */
        if (semTurmaAlguma && m.indexOf('disciplina') !== -1) return;
        avisos.appendChild(C.el('div', { class: 'alert danger', text: m }));
      });
      if (choques.length) {
        var amostra = choques.slice(0, 3).map(function (o) {
          return C.fmtDia(o.data) + ' ' + o.inicio + '–' + o.fim + ' · ' + o.titulo;
        }).join(' · ');
        /* Nós do DOM, e não markup: o título de uma atividade pontual é
           escrito pelo usuário e chegava cru ao innerHTML. */
        avisos.appendChild(C.el('div', { class: 'alert' }, [
          C.el('b', { text: C.plural(choques.length, 'choque', 'choques') + ' em ' + rotulo + '.' }),
          ' ' + amostra + (choques.length > 3 ? ' · e mais ' + (choques.length - 3) + '.' : ''),
          C.el('br'),
          'A sobreposição está bloqueada nos parâmetros — ajuste o horário, o dia ou a clínica.'
        ]));
      }

      acao.disabled = erros.length > 0 || choques.length > 0;

      var pular = modo === 'recorrente' && !erros.length && choques.length > 0
        ? datasEmChoque(choques) : [];
      if (pular.length && pular.length < datas.length) {
        acaoPular.style.display = '';
        acaoPular.textContent = 'Criar pulando ' + C.plural(pular.length, 'data', 'datas') + ' em conflito';
      } else {
        acaoPular.style.display = 'none';
      }
    }

    /* ── Gravação ─────────────────────────────────────────────────── */
    function gravarRecorrencia(pular) {
      /* Reconferência: turma vazia estoura na expansão da regra e derruba
         todas as telas que leem a agenda, não só esta. */
      if (!S.pode('agenda.criarRecorrente') || !form.turmaId || !S.turma(form.turmaId)) return null;
      var r = S.criarRecorrencia({
        agrupamentoId: form.agrupamentoId, escopo: form.escopo,
        turmaId: form.turmaId, dias: form.dias,
        inicio: form.inicio, fim: form.fim,
        vigenciaInicio: form.vigenciaInicio, vigenciaFim: form.vigenciaFim,
        observacao: form.observacao
      });
      var total = datasAlvo().length;
      if (r && pular && pular.length) {
        pular.forEach(function (d) {
          S.cancelarOcorrencia({
            origem: 'recorrente', origemId: r.id, data: d,
            chave: 'r:' + r.id + ':' + d
          }, 'Data em conflito no lançamento da recorrência');
        });
        total = Math.max(0, total - pular.length);
      }
      C.toast('Recorrência criada · ' + C.plural(total, 'encontro', 'encontros') +
        ' até ' + C.fmtDiaAno(form.vigenciaFim));
      return r;
    }

    function registrar() {
      if (validar().length) return;
      var res;
      if (modo === 'recorrente') {
        res = gravarRecorrencia(null);
        if (!res) return;
      } else {
        if (!S.pode('agenda.criarPontual')) return;
        res = S.criarPontual({
          agrupamentoId: form.agrupamentoId, escopo: form.escopo,
          data: form.data, inicio: form.inicio, fim: form.fim,
          tipoAtividade: form.tipoAtividade,
          descricao: form.descricao,
          turmaId: form.turmaVinculada || null, responsavelId: form.responsavelId
        });
        C.toast(res && res.situacao === 'pendente'
          ? 'Pedido enviado para a coordenação — vale só depois de aprovado.'
          : 'Atividade registrada em ' + C.fmtDiaAno(form.data) + '.');
      }
      if (opcoes.aoRegistrar) opcoes.aoRegistrar(res, modo);
    }

    /* Cria a recorrência já com as datas conflitantes marcadas como exceção,
       em vez de deixar a turma inteira impossível de lançar. */
    function registrarPulando() {
      if (modo !== 'recorrente' || validar().length) return;
      var datas = datasAlvo();
      var pular = datasEmChoque(
        S.conflitos(form.agrupamentoId, form.escopo, datas, form.inicio, form.fim));
      if (!pular.length) { registrar(); return; }
      if (pular.length >= datas.length) return;

      var lista = C.el('ul', { style: 'margin:10px 0 0;padding-left:18px' },
        pular.slice(0, 8).map(function (d) {
          return C.el('li', { text: C.nomeDia(C.weekday(d), true) + ', ' + C.fmtDiaAno(d) });
        }));
      U.confirmar({
        titulo: 'Criar pulando as datas em conflito',
        subtitulo: S.rotuloEscopo(form.agrupamentoId, form.escopo),
        rotulo: 'Criar assim',
        conteudo: C.el('div', {}, [
          C.el('span', {
            text: 'A recorrência fica com ' +
              C.plural(datas.length - pular.length, 'encontro', 'encontros') + '. ' +
              C.plural(pular.length, 'data', 'datas') +
              (pular.length === 1 ? ' é registrada' : ' são registradas') + ' como exceção:'
          }),
          lista,
          pular.length > 8
            ? C.el('div', { class: 'muted', style: 'margin-top:6px', text: 'e mais ' + (pular.length - 8) + '.' })
            : null
        ])
      }, function () {
        var res = gravarRecorrencia(pular);
        if (res && opcoes.aoRegistrar) opcoes.aoRegistrar(res, modo);
      });
    }

    desenhar();
  }

  global.Registro = { montar: montar };
})(window);
