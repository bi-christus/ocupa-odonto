/* views/agora.js — ocupação em tempo real: cadeiras e linha do dia.
   A tela é do AGRUPAMENTO: as clínicas dele aparecem lado a lado, cada uma
   com as suas cadeiras. O número da cadeira NÃO identifica a clínica: as de
   atendimento seguem a numeração contínua do polo, mas cada pré-clínica
   numera as suas do 1. Por isso a seleção guarda a clínica junto do número.

   Desde 05/10/2026 a clínica pode ter VÁRIAS reservas ao mesmo tempo, cada
   uma com as cadeiras dela, e a cadeira alocada já nasce ocupada — o
   professor não registra mais cadeira por cadeira. A grade diz de qual
   reserva é cada cadeira (letra A, B, C… quando há mais de uma), e o
   professor responsável troca, devolve ou acrescenta cadeira dali mesmo. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, M = global.Manutencao;

  var sel = { agrupamentoId: null, clinicaId: null, cadeira: null };

  /* Altura, em pixels, da faixa de uma clínica na linha do dia. Uma
     ocupação das duas clínicas ocupa as duas faixas. */
  var ALTURA_FAIXA = 32;
  var LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function render(alvo, params) {
    if (!S.pode('agenda.ver')) { alvo.appendChild(U.semPermissao()); return; }
    var e = S.estado, hoje = C.hojeISO();

    if (!e.agrupamentos || !e.agrupamentos.length) {
      alvo.appendChild(U.vazio('Nenhum agrupamento de clínicas cadastrado.'));
      return;
    }

    /* Entrada por navegação. Aceita o agrupamento, uma clínica (resolvida
       para o agrupamento dela) ou uma cadeira já selecionada. */
    if (params) {
      var destino = null;
      if (params.agrupamentoId && S.agrupamento(params.agrupamentoId)) destino = params.agrupamentoId;
      else if (params.clinicaId) {
        var g0 = S.agrupamentoDaClinica(params.clinicaId);
        if (g0) destino = g0.id;
      }
      if (destino) {
        sel.agrupamentoId = destino;
        /* Cadeira por navegação só entra acompanhada da clínica: sozinha, o
           número não diz mais de qual clínica ela é. */
        sel.clinicaId = params.clinicaId || null;
        sel.cadeira = (params.clinicaId && params.cadeira) || null;
      }
    }
    if (!sel.agrupamentoId || !S.agrupamento(sel.agrupamentoId)) {
      sel.agrupamentoId = e.agrupamentos[0].id;
      sel.clinicaId = null;
      sel.cadeira = null;
    }
    /* Cadeira herdada de outro agrupamento não pode continuar selecionada. */
    if (sel.cadeira) {
      var cSel = S.clinica(sel.clinicaId);
      if (!cSel || cSel.agrupamentoId !== sel.agrupamentoId) { sel.cadeira = null; sel.clinicaId = null; }
    }

    var ref = referenciaDoAgrupamento(sel.agrupamentoId, hoje);
    alvo.appendChild(C.el('section', { class: 'split3' }, [
      C.el('div', { class: 'c-left' }, listaAgrupamentos(hoje)),
      C.el('div', { class: 'c-mid' }, painelAgrupamento(hoje, ref)),
      C.el('div', { class: 'c-right' }, painelCadeira(hoje, ref))
    ]));
  }

  /* ── Leituras compartilhadas ──────────────────────────────────────── */

  /* Cadeira EM USO é cadeira alocada a uma reserva em andamento. Desde
     05/10/2026 a alocação já é a marcação: a reserva de 8 cadeiras tem 8 em
     uso, sem ninguém registrar uma a uma. */
  function emUsoNoAgrupamento(agrupamentoId, hoje) {
    var n = 0;
    S.ocorrenciasDoDia(hoje, { agrupamentoId: agrupamentoId }).forEach(function (o) {
      if (S.statusOcorrencia(o) === 'em_andamento') n += o.cadeiras;
    });
    return n;
  }
  function interditadasNoAgrupamento(agrupamentoId) {
    return S.clinicasDoAgrupamento(agrupamentoId).reduce(function (s, c) {
      return s + S.cadeirasInterditadas(c.id);
    }, 0);
  }

  /* Reservas de REFERÊNCIA de uma clínica hoje: as que estão em andamento
     agora; se nenhuma, as do próximo horário com ocupação; se não sobrar
     nada hoje, nenhuma — e a última encerrada só serve para a linha de
     estado dizer até quando a clínica foi usada. */
  function referencia(clinicaId, hoje) {
    var doDia = S.ocorrenciasDoDia(hoje, clinicaId);
    var andando = doDia.filter(function (o) { return S.statusOcorrencia(o) === 'em_andamento'; });
    if (andando.length) return { lista: andando, agora: true, doDia: doDia };
    var futuras = doDia.filter(function (o) { return S.statusOcorrencia(o) === 'agendada'; });
    if (futuras.length) {
      var t = futuras.reduce(function (m, o) { return Math.min(m, C.toMin(o.inicio)); }, 24 * 60);
      return {
        lista: futuras.filter(function (o) { return C.toMin(o.inicio) <= t; }),
        agora: false, doDia: doDia
      };
    }
    return { lista: [], agora: false, doDia: doDia };
  }

  /* A letra é do AGRUPAMENTO, não da clínica: a ocupação das duas clínicas
     tem cadeira nas duas grades, e precisa da mesma letra nas duas. */
  function referenciaDoAgrupamento(agrupamentoId, hoje) {
    var vistas = {}, lista = [], porClinica = {};
    S.clinicasDoAgrupamento(agrupamentoId).forEach(function (c) {
      var r = referencia(c.id, hoje);
      porClinica[c.id] = r;
      r.lista.forEach(function (o) {
        if (vistas[o.chave]) return;
        vistas[o.chave] = true;
        lista.push(o);
      });
    });
    lista.sort(function (a, b) {
      return C.toMin(a.inicio) - C.toMin(b.inicio) || String(a.titulo).localeCompare(String(b.titulo));
    });
    var letra = {};
    lista.forEach(function (o, i) { letra[o.chave] = LETRAS.charAt(i % LETRAS.length); });
    return { porClinica: porClinica, lista: lista, letra: letra, varias: lista.length > 1 };
  }

  function donoDaCadeira(ref, clinicaId, n) {
    var r = ref.porClinica[clinicaId];
    if (!r) return null;
    for (var i = 0; i < r.lista.length; i++) if (r.lista[i].cadeirasLista.indexOf(n) !== -1) return r.lista[i];
    return null;
  }

  /* Manutenção vence: cadeira interditada não atende, esteja ou não numa
     reserva. 'ocupada' é cadeira de reserva em andamento; 'reservada', de
     reserva que ainda vai começar hoje. */
  function statusCadeira(ref, clinicaId, n) {
    if (S.cadeiraEmManutencao(clinicaId, n)) return 'manut';
    var o = donoDaCadeira(ref, clinicaId, n);
    if (!o) return 'livre';
    return S.statusOcorrencia(o) === 'em_andamento' ? 'ocupada' : 'reservada';
  }

  function rotuloOcorrencia(ref, o) {
    return (ref.varias ? ref.letra[o.chave] + ' · ' : '') + o.titulo;
  }

  /* ── Coluna esquerda ──────────────────────────────────────────────── */
  function listaAgrupamentos(hoje) {
    var caixa = C.el('div');
    S.estado.agrupamentos.forEach(function (g) {
      var capacidade = S.capacidadeEscopo(g.id, 'ambas');
      var emUso = emUsoNoAgrupamento(g.id, hoje);
      var pct = capacidade ? Math.round((emUso / capacidade) * 100) : 0;
      caixa.appendChild(C.el('button', {
        class: 'list-btn' + (sel.agrupamentoId === g.id ? ' on' : ''),
        onclick: function () { sel.agrupamentoId = g.id; sel.cadeira = null; global.App.recarregar(); }
      }, [
        C.el('div', { style: 'display:flex;justify-content:space-between;gap:10px' }, [
          C.el('b', { text: g.nome }),
          C.el('span', { class: 'num', style: 'font-size:13px', text: pct + '%' })
        ]),
        C.el('small', {
          text: emUso + ' em uso · ' + S.cadeirasOperantesEscopo(g.id, 'ambas') + ' de ' + capacidade + ' operantes'
        })
      ]));
    });

    caixa.appendChild(C.el('div', { class: 'legend', style: 'margin-top:24px' }, [
      legenda('ocupada', 'Ocupada — reserva em andamento'),
      legenda('reservada', 'Reservada para mais tarde'),
      legenda('', 'Livre'),
      legenda('manut', 'Em manutenção')
    ]));
    return caixa;
  }
  function legenda(cls, texto) {
    return C.el('div', { class: 'row', style: 'gap:9px' }, [
      C.el('span', { class: 'chair-k ' + cls }),
      C.el('span', { text: texto })
    ]);
  }

  /* ── Coluna central ───────────────────────────────────────────────── */
  function painelAgrupamento(hoje, ref) {
    var g = S.agrupamento(sel.agrupamentoId);
    var clinicas = S.clinicasDoAgrupamento(g.id);
    var capacidade = S.capacidadeEscopo(g.id, 'ambas');
    var emUso = emUsoNoAgrupamento(g.id, hoje);
    var interditadas = interditadasNoAgrupamento(g.id);
    var caixa = C.el('div');

    var resumo = emUso + ' de ' + capacidade + ' cadeiras em uso';
    /* O déficit precisa aparecer: cadeira interditada some da conta sem que
       ninguém veja. */
    if (interditadas) resumo += ' · ' + C.plural(interditadas, 'cadeira', 'cadeiras') + ' em manutenção';

    caixa.appendChild(C.el('div', {
      style: 'display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px'
    }, [
      C.el('h2', { text: g.nome }),
      C.el('span', { class: 'muted', style: 'font-size:13px', text: resumo })
    ]));

    /* `grades-clinicas` empilha as duas grades em tela estreita: lado a lado
       elas pedem ~510px e empurravam a página para o lado no celular. */
    var grades = C.el('div', {
      class: 'grades-clinicas',
      style: 'display:grid;grid-template-columns:repeat(' + Math.max(1, Math.min(2, clinicas.length)) + ',minmax(0,1fr));gap:0'
    });
    clinicas.forEach(function (c, i) { grades.appendChild(colunaClinica(c, i, hoje, ref)); });
    caixa.appendChild(grades);

    caixa.appendChild(C.el('div', { style: 'margin-top:34px' }, linhaDoDia(hoje)));
    return caixa;
  }

  function colunaClinica(c, indice, hoje, ref) {
    var f = S.faixaCadeiras(c.id);
    var grade = C.el('div', { class: 'chairs' });
    for (var n = f[0]; n <= f[1]; n++) grade.appendChild(cadeiraBtn(c, n, ref));

    return C.el('div', {
      style: indice > 0
        ? 'border-left:1px dashed var(--line);padding-left:30px;min-width:0'
        : 'padding-right:30px;min-width:0'
    }, [
      C.el('div', { class: 'row', style: 'gap:10px;min-width:0' }, [
        C.el('span', { style: 'font:600 18px var(--font-heading);letter-spacing:.02em', text: c.nome }),
        c.especialidade
          ? C.el('span', { style: 'font-size:12px;color:var(--accent-ink)', text: c.especialidade })
          : null
      ]),
      C.el('div', { style: 'margin:6px 0 16px' }, linhasEstado(c, ref)),
      grade
    ]);
  }

  /* O que acontece na clínica: cada reserva de referência numa linha, com
     as cadeiras dela — ou, sem nenhuma, se a clínica está livre o dia
     inteiro ou até quando foi usada. */
  function linhasEstado(c, ref) {
    var r = ref.porClinica[c.id];
    if (!r || !r.lista.length) {
      var ultima = r && r.doDia.length ? r.doDia[r.doDia.length - 1] : null;
      return C.el('div', { class: 'muted', style: 'font-size:12.5px',
        text: ultima ? 'Livre · encerrada ' + ultima.fim : 'Livre o dia inteiro' });
    }
    /* Na ordem das letras, que é a da grade e a da lista da direita. */
    var lista = r.lista.slice().sort(function (a, b) {
      return String(ref.letra[a.chave]).localeCompare(String(ref.letra[b.chave]));
    });
    return C.el('div', { class: 'stack', style: 'gap:3px' }, lista.map(function (o) {
      return C.el('div', { class: 'muted', style: 'font-size:12.5px' }, [
        ref.varias ? C.el('b', { class: 'letra-res', text: ref.letra[o.chave] }) : null,
        (r.agora ? '' : 'Próxima · ') + o.inicio + '–' + o.fim + ' · ' + o.titulo + ' · ' +
        C.primeiroNome(S.nomePessoa(o.responsavelId)) + ' · ' +
        C.plural(o.cadeiras, 'cadeira', 'cadeiras') + ' (' + S.textoCadeiras(o.cadeirasLista) + ')'
      ]);
    }));
  }

  function cadeiraBtn(c, n, ref) {
    var st = statusCadeira(ref, c.id, n);
    var dono = donoDaCadeira(ref, c.id, n);
    /* A seleção é do par (clínica, número): duas clínicas podem ter a
       cadeira 5, e sem a clínica a grade marcaria as duas. */
    var cls = 'chair' + (st === 'livre' ? '' : ' ' + st) +
      (sel.cadeira === n && sel.clinicaId === c.id ? ' sel' : '');
    var nome = dono ? S.atribuicaoDaCadeira(dono.chave, n) : null;
    return C.el('button', {
      class: cls,
      title: (st === 'manut' ? 'Em manutenção' : st === 'ocupada' ? 'Ocupada'
        : st === 'reservada' ? 'Reservada para mais tarde' : 'Livre') +
        (dono ? ' · ' + rotuloOcorrencia(ref, dono) : '') +
        (nome ? ' · ' + S.nomeNaCadeira(nome) : '') + ' · ' + S.localCadeira(n, c),
      onclick: function () { sel.cadeira = n; sel.clinicaId = c.id; global.App.recarregar(); }
    }, [
      C.pad(n),
      dono && ref.varias ? C.el('span', { class: 'letra', text: ref.letra[dono.chave] }) : null
    ]);
  }

  /* Janela horária da régua. Derivada dos horários das clínicas, alargada
     pelos parâmetros do polo e pelo que existe no dia — uma ocupação das
     06:00 às 07:00 sumia por completo do gantt, em silêncio. */
  function janelaDoDia(hoje) {
    var e = S.estado, p = e.parametros || {};
    var ini = C.toMin(p.aberturaPadrao || '07:00');
    var fim = C.toMin(p.fechamentoPadrao || '22:00');
    e.clinicas.forEach(function (c) {
      if (c.abertura) ini = Math.min(ini, C.toMin(c.abertura));
      if (c.fechamento) fim = Math.max(fim, C.toMin(c.fechamento));
    });
    S.ocorrenciasDoDia(hoje).forEach(function (o) {
      ini = Math.min(ini, C.toMin(o.inicio));
      fim = Math.max(fim, C.toMin(o.fim));
    });
    ini = Math.floor(ini / 60) * 60;
    fim = Math.ceil(fim / 60) * 60;
    if (fim <= ini) fim = ini + 60;
    return [ini, fim];
  }

  /* Empilha, dentro da faixa da clínica, as ocupações que se cruzam no
     tempo — desde que a clínica comporta várias ao mesmo tempo, sem isto
     uma barra cobriria a outra. Só conta quem disputa as mesmas clínicas. */
  function nivel(lista, idx) {
    var o = lista[idx], n = 0;
    for (var i = 0; i < idx; i++) {
      var p = lista[i];
      if (!S.escoposColidem(o.agrupamentoId, o.escopo, p.agrupamentoId, p.escopo)) continue;
      if (C.sobrepoe(o.inicio, o.fim, p.inicio, p.fim)) n++;
    }
    return n;
  }

  /* Linha do tempo do dia: uma pista por agrupamento, com uma faixa para
     cada clínica. A ocupação das duas clínicas atravessa as duas faixas. */
  function linhaDoDia(hoje) {
    var janela = janelaDoDia(hoje);
    var ini = janela[0], fim = janela[1], span = fim - ini;
    var agora = C.toMin(C.agoraHHMM());

    var marcas = C.el('div', { class: 'tl-hd' }, [C.el('div', { style: 'width:142px;flex:none' })]);
    for (var h = ini; h < fim; h += 60) marcas.appendChild(C.el('i', { text: C.pad(h / 60) }));

    var linhas = S.estado.agrupamentos.map(function (g) {
      var clinicas = S.clinicasDoAgrupamento(g.id);
      var altura = ALTURA_FAIXA * Math.max(1, clinicas.length);
      var trilha = C.el('div', { class: 'tl-track', style: 'height:' + altura + 'px;padding:0' });

      for (var i = 0; i <= clinicas.length; i++) {
        trilha.appendChild(C.el('div', {
          style: 'position:absolute;left:0;right:0;pointer-events:none;top:' + (i * ALTURA_FAIXA) +
            'px;height:1px;background:var(--line-soft)'
        }));
      }

      var lista = S.ocorrenciasDoDia(hoje, { agrupamentoId: g.id });
      var niveis = lista.map(function (o, k) { return nivel(lista, k); });
      var divisor = 1;
      niveis.forEach(function (n) { if (n + 1 > divisor) divisor = n + 1; });

      lista.forEach(function (o, k) {
        var a = Math.max(ini, C.toMin(o.inicio)), b = Math.min(fim, C.toMin(o.fim));
        if (b <= a) return;
        var ids = S.idsDoEscopo(o.agrupamentoId, o.escopo);
        var dupla = ids.length > 1;
        var idx = Math.max(0, g.clinicas.indexOf(ids[0]));
        var st = S.statusOcorrencia(o);
        var baseTopo = dupla ? 0 : idx * ALTURA_FAIXA;
        var baseAlt = dupla ? altura : ALTURA_FAIXA;
        var sub = baseAlt / divisor;
        trilha.appendChild(C.el('button', {
          class: 'tl-blk amb-' + o.ambiente + (o.origem === 'pontual' ? ' pontual' : '') +
            (st === 'em_andamento' ? ' agora' : ''),
          style: 'left:' + ((a - ini) / span * 100) + '%;width:' + ((b - a) / span * 100) +
            '%;top:' + (baseTopo + niveis[k] * sub + 3) + 'px;height:' + Math.max(8, sub - 6) + 'px',
          title: S.rotuloEscopo(o.agrupamentoId, o.escopo) + ' · ' + o.inicio + '–' + o.fim + ' · ' +
            C.plural(o.cadeiras, 'cadeira', 'cadeiras') + ' (' + S.textoCadeiras(o.cadeirasLista) + ')',
          onclick: function () { global.Agenda.detalhe(o); }
        }, [
          C.el('span', { class: 'marcas' }, [
            U.icone(o.origem === 'pontual' ? 'pontual' : 'recorrente'),
            o.nivel === 'pos' ? U.icone('pos') : null
          ]),
          o.inicio + '–' + o.fim + ' · ' + o.titulo + ' · ' + o.cadeiras + ' cad.'
        ]));
      });

      if (agora >= ini && agora <= fim) {
        trilha.appendChild(C.el('div', { class: 'tl-now', style: 'left:' + ((agora - ini) / span * 100) + '%' }));
      }
      return C.el('div', { class: 'tl-row', style: 'min-height:' + (altura + 20) + 'px' }, [
        C.el('div', { class: 'tl-lbl' }, [
          g.nome,
          /* A linha de baixo lista as clínicas do agrupamento — mas a
             pré-clínica é um agrupamento de uma clínica só, e o nome das
             duas é o mesmo: repetido, vira ruído. */
          S.subtituloAgrupamento(g.id)
            ? C.el('small', { text: S.subtituloAgrupamento(g.id) }) : null
        ]),
        trilha
      ]);
    });

    return C.el('div', {}, [
      C.el('div', { style: 'display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px' }, [
        C.el('h5', { text: 'Hoje' }),
        C.el('span', { class: 'muted', style: 'font-size:12px',
          text: C.pad(ini / 60) + 'h–' + C.pad(fim / 60) + 'h' })
      ]),
      marcas,
      C.el('div', { style: 'border-top:1px solid var(--color-divider)' }, linhas),
      C.el('div', { class: 'legenda-marcas' }, [
        C.el('span', {}, [C.el('i', { class: 'sw amb-clinica' }), 'Clínica']),
        C.el('span', {}, [C.el('i', { class: 'sw amb-dupla' }), 'Duas clínicas']),
        C.el('span', {}, [C.el('i', { class: 'sw amb-pre' }), 'Pré-clínica']),
        C.el('span', {}, [U.icone('recorrente'), 'Recorrente']),
        C.el('span', {}, [U.icone('pontual'), 'Pontual']),
        C.el('span', {}, [U.icone('pos'), 'Pós-graduação'])
      ])
    ]);
  }

  /* ── Coluna direita ───────────────────────────────────────────────── */
  function painelCadeira(hoje, ref) {
    var caixa = C.el('div');

    if (!sel.cadeira) {
      caixa.appendChild(C.el('h5', { text: 'Cadeira' }));
      caixa.appendChild(C.el('p', { class: 'muted', style: 'font-size:13px;line-height:1.6;margin-top:8px',
        text: 'As cadeiras de cada reserva já aparecem ocupadas, escolhidas da menor para a maior. ' +
          'Clique numa cadeira para ver de quem ela é, anotar quem está nela ou trocá-la.' }));
      caixa.appendChild(reservasDeReferencia(ref));
      return caixa;
    }

    var n = sel.cadeira;
    var c = S.clinica(sel.clinicaId);
    var st = statusCadeira(ref, c.id, n);
    var dono = donoDaCadeira(ref, c.id, n);
    var manut = S.cadeiraEmManutencao(c.id, n);

    caixa.appendChild(C.el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px' }, [
      C.el('h4', { text: 'Cadeira ' + n }),
      C.el('span', {
        class: 'badge ' + (st === 'manut' ? 'warn' : st === 'ocupada' ? 'strong' : st === 'reservada' ? 'soft' : 'neutral'),
        text: st === 'manut' ? 'Manutenção' : st === 'ocupada' ? 'Ocupada' : st === 'reservada' ? 'Reservada' : 'Livre'
      })
    ]));
    caixa.appendChild(C.el('div', { class: 'muted', style: 'font-size:12.5px;margin:3px 0 18px',
      text: S.localCadeira(n, c) + (c.especialidade ? ' · ' + c.especialidade : '') }));

    if (manut) {
      caixa.appendChild(M.ficha(manut));
      /* Interditada E alocada: a reserva precisa de outra cadeira, e quem
         pode trocar é avisado aqui, onde descobre. */
      if (dono) {
        caixa.appendChild(C.el('div', { class: 'alert', style: 'margin-top:14px',
          text: 'Esta cadeira está na reserva ' + rotuloOcorrencia(ref, dono) + '. ' +
            (S.podeGerirCadeiras(dono) ? 'Troque-a por uma livre em "Alterar cadeiras".'
              : 'O professor responsável precisa trocá-la por uma livre.') }));
        if (S.podeGerirCadeiras(dono)) caixa.appendChild(botaoAlterar(dono));
      }
      if (S.pode('manutencao.encerrar')) {
        caixa.appendChild(C.el('button', {
          class: 'btn btn-primary', style: 'margin-top:18px', text: 'Encerrar manutenção',
          onclick: function () { M.encerrar(manut, function () { global.App.recarregar(); }); }
        }));
      }
      caixa.appendChild(historico(n, c));
      return caixa;
    }

    if (dono) caixa.appendChild(fichaDaCadeira(dono, n, ref));
    else caixa.appendChild(cadeiraLivre(c, n, ref));

    if (S.pode('manutencao.abrir')) {
      caixa.appendChild(C.el('button', {
        class: 'btn btn-outline', style: 'margin-top:10px', text: 'Registrar manutenção',
        onclick: function () { M.abrir(c.id, n, function () { global.App.recarregar(); }); }
      }));
    }

    caixa.appendChild(historico(n, c));
    return caixa;
  }

  function botaoAlterar(o) {
    return C.el('button', {
      class: 'btn btn-outline', style: 'margin-top:12px', text: 'Alterar cadeiras',
      onclick: function () {
        var doc = S.reservaPorId(o.origemId);
        if (doc) global.Cadeiras.escolher(doc, function () { global.App.recarregar(); });
      }
    });
  }

  /* Cadeira de uma reserva: de quem é, o nome de quem está nela (anotação
     opcional do professor) e, para quem responde pela reserva, as trocas. */
  function fichaDaCadeira(o, n, ref) {
    var caixa = C.el('div');
    var atrib = S.atribuicaoDaCadeira(o.chave, n);
    var al = atrib && atrib.alunoId ? S.aluno(atrib.alunoId) : null;
    var gerir = S.podeGerirCadeiras(o);
    caixa.appendChild(C.el('div', { class: 'stack', style: 'gap:0' }, [
      U.kv('Reserva', rotuloOcorrencia(ref, o)),
      o.subtitulo ? U.kv(o.nivel === 'pos' ? 'Especialização' : 'Disciplina', o.subtitulo) : null,
      U.kv('Professor coordenador', S.nomePessoa(o.responsavelId)),
      U.kv('Horário', o.inicio + '–' + o.fim),
      U.kv('Cadeiras da reserva', C.plural(o.cadeiras, 'cadeira', 'cadeiras') + ' · ' + S.textoCadeiras(o.cadeirasLista)),
      o.descricao ? U.kv('Descrição/Turma', o.descricao) : null,
      /* Matrícula e período só existem quando o registro veio do vínculo
         antigo com aluno cadastrado. */
      atrib && !gerir ? U.kv('Na cadeira', S.nomeNaCadeira(atrib)) : null,
      al ? U.kv('Matrícula', al.matricula) : null
    ]));
    if (!gerir) return caixa;

    var nome = atrib ? S.nomeNaCadeira(atrib) : '';
    caixa.appendChild(C.el('div', { class: 'stack', style: 'gap:10px;margin-top:16px' }, [
      U.campo('Quem está na cadeira', C.el('input', {
        class: 'input', type: 'text', value: atrib ? nome : '', placeholder: 'Nome — opcional',
        oninput: function (ev) { nome = ev.target.value; }
      }), 'anotação deste encontro; em branco apaga'),
      C.el('button', {
        class: 'btn btn-primary', type: 'button', text: 'Salvar nome',
        onclick: function () {
          S.registrarNomeNaCadeira(o, n, nome).then(function (r) {
            if (r && r.ok) C.toast(String(nome || '').trim() ? 'Nome anotado na cadeira ' + n + '.' : 'Anotação da cadeira ' + n + ' apagada.');
            global.App.recarregar();
          });
        }
      })
    ]));

    var acoes = C.el('div', { class: 'row', style: 'gap:10px;margin-top:16px' });
    if (o.cadeiras > 1) {
      acoes.appendChild(C.el('button', {
        class: 'btn btn-outline', type: 'button', text: 'Devolver esta cadeira',
        title: 'Tira a cadeira ' + n + ' da reserva em todas as datas dela — ela fica livre para outras reservas',
        onclick: function () {
          var doc = S.reservaPorId(o.origemId);
          if (!doc) return;
          var nova = S.cadeirasDe(doc).filter(function (x) { return x !== n; });
          S.alterarCadeiras(doc.id, nova).then(function (r) {
            if (r && r.ok) C.toast('Cadeira ' + n + ' devolvida · a reserva fica com ' + S.textoCadeiras(nova) + '.');
            global.App.recarregar();
          });
        }
      }));
    }
    acoes.appendChild(botaoAlterar(o));
    caixa.appendChild(acoes);
    return caixa;
  }

  /* Cadeira livre: quem responde por uma reserva desta clínica neste
     horário pode puxá-la para a reserva — desde que ela esteja livre em
     TODAS as datas da reserva, e que a reserva não passe do aprovado. */
  function cadeiraLivre(c, n, ref) {
    var caixa = C.el('div');
    var r = ref.porClinica[c.id];
    var candidatas = (r ? r.lista : []).filter(function (o) { return S.podeGerirCadeiras(o); });
    caixa.appendChild(C.el('p', { class: 'muted', style: 'font-size:13px;line-height:1.6',
      text: r && r.lista.length
        ? 'Livre — nenhuma das reservas deste horário está com ela.'
        : 'Sem reserva nesta clínica agora.' }));
    candidatas.forEach(function (o) {
      var doc = S.reservaPorId(o.origemId);
      if (!doc) return;
      var mapa = S.mapaDeCadeiras(doc);
      var tomada = !!(mapa.donos[n] && mapa.donos[n].length);
      var noLimite = S.cadeirasDe(doc).length >= S.limiteDeCadeiras(doc);
      caixa.appendChild(C.el('button', {
        class: 'btn btn-outline', type: 'button', style: 'margin-top:8px;display:flex',
        disabled: (tomada || noLimite) ? true : null,
        title: tomada ? 'Em outra data desta reserva a cadeira ' + n + ' já está com outra reserva.'
          : noLimite ? 'A reserva já tem as ' + S.limiteDeCadeiras(doc) + ' cadeiras aprovadas — devolva uma antes.'
            : 'Acrescenta a cadeira ' + n + ' à reserva, em todas as datas dela',
        text: 'Pôr na reserva ' + rotuloOcorrencia(ref, o),
        onclick: function () {
          var nova = S.cadeirasDe(doc).concat([n]);
          S.alterarCadeiras(doc.id, nova).then(function (res) {
            if (res && res.ok) C.toast('Cadeira ' + n + ' entrou na reserva · ' + S.textoCadeiras(S.cadeirasDe(doc)) + '.');
            global.App.recarregar();
          });
        }
      }));
    });
    return caixa;
  }

  /* As reservas do agrupamento neste momento, com as cadeiras de cada uma.
     Substitui a antiga lista de "cadeiras registradas": a alocação já diz
     quais estão em uso, e o que sobra para conferir é de quem são. */
  function reservasDeReferencia(ref) {
    var caixa = C.el('div', { style: 'margin-top:26px' }, [
      C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:10px',
        text: ref.lista.length ? 'Reservas deste horário' : 'Nenhuma reserva neste horário' })
    ]);
    ref.lista.forEach(function (o) {
      var nomes = S.atribuicoesDa(o.chave).length;
      caixa.appendChild(C.el('div', { style: 'padding:9px 0;border-bottom:1px solid var(--line-soft)' }, [
        C.el('div', { class: 'row', style: 'gap:8px' }, [
          ref.varias ? C.el('b', { class: 'letra-res', text: ref.letra[o.chave] }) : null,
          C.el('b', { style: 'font-size:13px', text: o.titulo })
        ]),
        C.el('div', { class: 'muted', style: 'font-size:12px', text:
          o.inicio + '–' + o.fim + ' · ' + S.rotuloEscopoCurto(o.agrupamentoId, o.escopo) + ' · ' +
          C.plural(o.cadeiras, 'cadeira', 'cadeiras') + ' (' + S.textoCadeiras(o.cadeirasLista) + ')' +
          ' · ' + S.nomePessoa(o.responsavelId) +
          (nomes ? ' · ' + C.plural(nomes, 'nome anotado', 'nomes anotados') : '') }),
        S.podeGerirCadeiras(o) ? botaoAlterar(o) : null
      ]));
    });
    return caixa;
  }

  /* Histórico de manutenção da cadeira. A clínica estreita a busca: com as
     pré-clínicas numeradas do 1, o número sozinho não diz de qual cadeira 5
     se trata. */
  function historico(n, c) {
    var hist = S.historicoCadeira(n).filter(function (m) { return !m.clinicaId || m.clinicaId === c.id; });
    if (!hist.length) return C.el('div');
    return C.el('div', { style: 'margin-top:26px' }, [
      C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:8px', text: 'Histórico de manutenção' }),
      C.el('div', {}, hist.slice(0, 4).map(function (m) {
        return C.el('div', { style: 'padding:8px 0;border-bottom:1px solid var(--color-divider);font-size:12.5px' }, [
          C.el('div', {}, [C.el('b', { text: m.protocolo }), ' · ' + S.rotuloCategoriaManutencao(m.categoria)]),
          C.el('div', { class: 'muted', text: C.fmtCarimbo(m.abertoEm) + ' · ' + m.status })
        ]);
      }))
    ]);
  }

  global.ViewAgora = { render: render };
})(window);
