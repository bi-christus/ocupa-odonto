/* views/estrutura.js — agrupamentos, clínicas, cadeiras, parâmetros e
   registros de manutenção.
   A tela tem dois níveis, como o modelo: um cartão por AGRUPAMENTO
   ("Clínicas 3 e 4") e, dentro dele, as duas clínicas com a especialidade,
   a faixa da numeração global e a grade das 14 cadeiras. Número de cadeira
   é sempre global (1 a 112); a posição dentro da clínica é
   n - primeiraCadeira + 1. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, M = global.Manutencao, A = global.Acesso;

  var filtroManut = 'abertas';

  /* Cada campo de horário tem a sua janela: abrir de madrugada ou fechar de
     manhã não são a mesma coisa. */
  var JANELA_ABERTURA = { min: '06:00', max: '12:00' };
  var JANELA_FECHAMENTO = { min: '12:00', max: '23:30' };

  function render(alvo) {
    if (!S.pode('estrutura.ver')) { alvo.appendChild(U.semPermissao()); return; }
    var e = S.estado;

    alvo.appendChild(C.el('div', { class: 'page-head' }, [
      C.el('div', {}, [
        C.el('h1', { text: 'Estrutura' }),
        C.el('div', { class: 'muted', style: 'font-size:13.5px;margin-top:6px', text: resumoEstrutura() })
      ]),
      S.pode('manutencao.abrir') ? C.el('button', {
        class: 'btn btn-primary', text: 'Registrar manutenção', onclick: escolherCadeira
      }) : null
    ]));

    /* O mockup usa uma coluna de conteúdo elástica e uma trilha de 290px
       para os parâmetros. Em telas estreitas as duas empilham sozinhas —
       por isso flex com quebra, e não a grade fixa de duas colunas. */
    alvo.appendChild(C.el('div', {
      style: 'display:flex;flex-wrap:wrap;align-items:flex-start;gap:36px'
    }, [
      C.el('div', { class: 'stack', style: 'gap:16px;flex:1 1 520px;min-width:0' },
        e.agrupamentos.map(cartaoAgrupamento)),
      C.el('div', { style: 'flex:0 1 290px;min-width:250px' }, parametros())
    ]));

    alvo.appendChild(C.el('div', { style: 'margin-top:44px' }, registros()));
  }

  /* "4 agrupamentos · 8 clínicas · 112 cadeiras · 5 cadeiras em manutenção" */
  function resumoEstrutura() {
    var e = S.estado;
    return C.plural(e.agrupamentos.length, 'agrupamento') + ' · ' +
      C.plural(e.clinicas.length, 'clínica', 'clínicas') + ' · ' +
      C.plural(S.totalCadeiras(), 'cadeira') + ' · ' +
      C.plural(totalInterditadas(), 'cadeira') + ' em manutenção';
  }

  function totalInterditadas() {
    return S.estado.clinicas.reduce(function (s, c) { return s + S.cadeirasInterditadas(c.id); }, 0);
  }
  function totalOperantes() {
    return S.estado.clinicas.reduce(function (s, c) { return s + S.cadeirasOperantes(c.id); }, 0);
  }

  /* ── Agrupamento ──────────────────────────────────────────────────── */
  function cartaoAgrupamento(g) {
    var faixa = S.faixaEscopo(g.id, 'ambas');
    var clinicas = S.clinicasDoAgrupamento(g.id);

    return C.el('div', { class: 'card' }, [
      C.el('div', {
        style: 'display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px'
      }, [
        C.el('span', { style: 'font:600 20px var(--font-heading);letter-spacing:-.015em', text: g.nome }),
        C.el('span', { class: 'muted num', style: 'font-size:12px',
          text: 'cadeiras ' + faixa[0] + '–' + faixa[1] })
      ]),
      C.el('div', { style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px' },
        clinicas.map(colunaClinica)),
      C.el('div', { class: 'muted', style: 'font-size:12px;margin-top:14px',
        text: S.pode('manutencao.abrir')
          ? 'Clique numa cadeira para abrir ou consultar o registro de manutenção.'
          : 'Cadeiras riscadas estão em manutenção.' })
    ]);
  }

  function colunaClinica(c) {
    var faixa = S.faixaCadeiras(c.id);
    var interditadas = S.cadeirasInterditadas(c.id);

    var grade = C.el('div', { class: 'chairs compacta' });
    for (var i = 0; i < c.cadeiras; i++) grade.appendChild(botaoCadeira(c, c.primeiraCadeira + i));

    return C.el('div', {}, [
      C.el('div', { style: 'display:flex;align-items:baseline;justify-content:space-between;gap:9px;flex-wrap:wrap' }, [
        C.el('div', { style: 'display:flex;align-items:baseline;gap:9px;flex-wrap:wrap' }, [
          C.el('span', { style: 'font:600 14px var(--font-heading);letter-spacing:.03em', text: c.nome }),
          c.especialidade ? C.el('span', {
            style: 'font-size:11.5px;color:var(--accent-ink)', text: c.especialidade
          }) : null
        ]),
        S.pode('estrutura.editar') ? C.el('button', {
          class: 'btn-ghost', text: 'Editar',
          'aria-label': 'Editar ' + c.nome,
          onclick: function () { editarClinica(c); }
        }) : null
      ]),
      C.el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:4px',
        text: C.plural(c.cadeiras, 'cadeira') + ' (' + faixa[0] + '–' + faixa[1] + ') · ' +
          c.abertura + '–' + c.fechamento }),
      C.el('div', {
        style: 'display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:14px 0 8px'
      }, [
        C.el('span', { style: 'font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)',
          text: 'Manutenção' }),
        C.el('span', { class: 'muted', style: 'font-size:11.5px',
          text: interditadas ? interditadas + ' em manutenção' : 'todas operando' })
      ]),
      grade
    ]);
  }

  /* "n" é o número GLOBAL da cadeira. */
  function botaoCadeira(c, n) {
    var m = S.cadeiraEmManutencao(c.id, n);
    var local = S.localCadeira(n);
    return C.el('button', {
      class: 'chair' + (m ? ' manut' : ''),
      text: C.pad(n),
      title: local + ' · ' + (m
        ? m.protocolo + ' · ' + S.rotuloCategoriaManutencao(m.categoria)
        : 'operando'),
      'aria-label': local + (m ? ' · em manutenção' : ' · operando'),
      onclick: function () {
        if (m) fichaManutencao(m);
        else if (S.pode('manutencao.abrir')) M.abrir(c.id, n, function () { global.App.recarregar(); });
        else C.toast(local + ' · operando normalmente.');
      }
    });
  }

  /* ── Escolha da cadeira para o registro de manutenção ──────────────── */
  function escolherCadeira() {
    var e = S.estado;
    if (!e.agrupamentos.length) { C.toast('Nenhum agrupamento cadastrado.'); return; }

    var f = { agrupamentoId: e.agrupamentos[0].id, clinicaId: null, cadeira: 0 };
    var seletorClinica = C.el('div');
    var seletorCadeira = C.el('div');
    var resumo = C.el('div', { class: 'preview' });

    function opcoesClinica() {
      return S.clinicasDoAgrupamento(f.agrupamentoId).map(function (c) {
        var faixa = S.faixaCadeiras(c.id);
        return {
          valor: c.id,
          rotulo: c.nome + (c.especialidade ? ' · ' + c.especialidade : '') +
            ' (' + faixa[0] + '–' + faixa[1] + ')'
        };
      });
    }

    /* Rótulo em numeração global, com a posição dentro da clínica ao lado:
       quem opera a cadeira conhece as duas leituras. */
    function opcoesCadeira() {
      var c = S.clinica(f.clinicaId), saida = [];
      if (!c) return saida;
      for (var i = 0; i < c.cadeiras; i++) {
        var n = c.primeiraCadeira + i;
        var m = S.cadeiraEmManutencao(c.id, n);
        saida.push({
          valor: String(n),
          rotulo: 'Cadeira ' + C.pad(n) + ' (posição ' + (i + 1) + ' na ' + c.nome + ')' +
            (m ? ' · já em manutenção' : '')
        });
      }
      return saida;
    }

    function desenharClinica() {
      var lista = S.clinicasDoAgrupamento(f.agrupamentoId);
      f.clinicaId = lista.length ? lista[0].id : null;
      C.clear(seletorClinica).appendChild(
        U.campo('Clínica', U.selecao(opcoesClinica(), f.clinicaId, function (v) {
          f.clinicaId = v; desenharCadeira();
        })));
      desenharCadeira();
    }

    function desenharCadeira() {
      var c = S.clinica(f.clinicaId);
      f.cadeira = c ? c.primeiraCadeira : 0;
      C.clear(seletorCadeira).appendChild(
        U.campo('Cadeira', U.selecao(opcoesCadeira(), String(f.cadeira), function (v) {
          f.cadeira = Number(v); desenharResumo();
        }), 'numeração do polo, de 1 a ' + S.totalCadeiras()));
      desenharResumo();
    }

    /* O que o sistema já sabe sobre a escolha, antes de abrir o formulário:
       o restante (protocolo, criticidade, impacto e histórico) é apurado e
       exibido na própria abertura do registro. */
    function desenharResumo() {
      var c = S.clinica(f.clinicaId);
      var m = f.cadeira ? S.cadeiraEmManutencao(f.clinicaId, f.cadeira) : null;
      C.clear(resumo);
      if (!c || !f.cadeira) {
        resumo.appendChild(C.el('div', { class: 'muted', text: 'Escolha uma cadeira.' }));
        return;
      }
      resumo.appendChild(C.el('div', {}, [
        C.el('b', { text: 'Local · ' }), S.localCadeira(f.cadeira)
      ]));
      resumo.appendChild(C.el('div', { class: 'muted', style: 'margin-top:4px',
        text: m
          ? 'Já existe o registro ' + m.protocolo + ', aberto há ' + C.decorrido(m.abertoEm) +
            '. Continuar abre a ficha em vez de um novo registro.'
          : 'Cadeira operando · ' + C.plural(S.cadeirasOperantes(c.id), 'cadeira operante', 'cadeiras operantes') +
            ' em ' + c.nome + ' antes da interdição.' }));
    }

    desenharClinica();

    U.modal({
      titulo: 'Registrar manutenção',
      subtitulo: 'Escolha a cadeira que será interditada',
      largura: '620px',
      conteudo: C.el('div', { class: 'stack' }, [
        C.el('div', { class: 'grid-fields' }, [
          U.campo('Agrupamento', U.selecao(e.agrupamentos.map(function (g) {
            return { valor: g.id, rotulo: g.nome };
          }), f.agrupamentoId, function (v) { f.agrupamentoId = v; desenharClinica(); })),
          seletorClinica,
          seletorCadeira
        ]),
        resumo
      ]),
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Cancelar', onclick: U.fecharModal }),
        C.el('button', {
          class: 'btn btn-primary', text: 'Continuar',
          onclick: function () {
            if (!f.clinicaId || !f.cadeira) { C.toast('Escolha a cadeira.'); return; }
            var existente = S.cadeiraEmManutencao(f.clinicaId, f.cadeira);
            var clinicaId = f.clinicaId, cadeira = f.cadeira;
            U.fecharModal();
            if (existente) fichaManutencao(existente);
            else M.abrir(clinicaId, cadeira, function () { global.App.recarregar(); });
          }
        })
      ]
    });
  }

  /* ── Clínica ──────────────────────────────────────────────────────── */
  function editarClinica(c) {
    if (!S.pode('estrutura.editar')) { C.toast('Seu perfil não altera a estrutura.'); return; }
    /* 'cadeiras' não entra: 14 por clínica é invariante do modelo e
       S.atualizarClinica nem aceita mais o campo. */
    var f = { nome: c.nome, abertura: c.abertura, fechamento: c.fechamento };
    var faixa = S.faixaCadeiras(c.id);

    U.modal({
      titulo: 'Editar ' + c.nome,
      subtitulo: S.nomeAgrupamento(c.agrupamentoId) + (c.especialidade ? ' · ' + c.especialidade : ''),
      largura: '620px',
      conteudo: C.el('div', {}, [
        C.el('div', { class: 'grid-fields' }, [
          U.campo('Nome', C.el('input', { class: 'input', value: f.nome,
            oninput: function (ev) { f.nome = ev.target.value; } })),
          U.campo('Abertura', U.hora(f.abertura, function (v) { f.abertura = v; }, JANELA_ABERTURA),
            'entre ' + JANELA_ABERTURA.min + ' e ' + JANELA_ABERTURA.max),
          U.campo('Fechamento', U.hora(f.fechamento, function (v) { f.fechamento = v; }, JANELA_FECHAMENTO),
            'entre ' + JANELA_FECHAMENTO.min + ' e ' + JANELA_FECHAMENTO.max)
        ]),
        C.el('div', { class: 'alert', style: 'margin-top:16px',
          text: 'Esta clínica ocupa as cadeiras ' + faixa[0] + '–' + faixa[1] +
            ' da numeração do polo (1–' + S.totalCadeiras() + '). A quantidade é fixa em ' +
            C.plural(c.cadeiras, 'cadeira') + '.' })
      ]),
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Cancelar', onclick: U.fecharModal }),
        C.el('button', {
          class: 'btn btn-primary', text: 'Salvar',
          onclick: function () {
            if (!f.nome.trim()) { C.toast('O nome da clínica é obrigatório.'); return; }
            if (!f.abertura || !f.fechamento) { C.toast('Informe a abertura e o fechamento.'); return; }
            if (C.toMin(f.fechamento) <= C.toMin(f.abertura)) {
              C.toast('O fechamento precisa ser depois da abertura.'); return;
            }
            S.atualizarClinica(c.id, { nome: f.nome.trim(), abertura: f.abertura, fechamento: f.fechamento });
            U.fecharModal(); C.toast(f.nome.trim() + ' atualizada.'); global.App.recarregar();
          }
        })
      ]
    });
  }

  /* ── Parâmetros ───────────────────────────────────────────────────── */
  function pill(texto, variante) {
    return C.el('span', { class: 'badge ' + (variante || 'soft'), text: texto });
  }

  /* Faixa em horas quando fecha uma hora cheia, em minutos abaixo disso.
     C.fmtHoras já traz o sufixo " h" e a vírgula decimal do pt-BR. */
  function rotuloFaixa(min) {
    return min >= 60 ? C.fmtHoras(min / 60) : min + ' min';
  }

  /* Quem cancela um registro é o perfil que tem a permissão — não um
     literal na tela. */
  function perfisCom(permissao) {
    var nomes = A.PERFIS.filter(function (p) {
      return A.permissoesDe(p.id).indexOf(permissao) !== -1;
    }).map(function (p) { return p.nome.toLowerCase(); });
    if (!nomes.length) return 'ninguém';
    if (nomes.length === 1) return nomes[0];
    return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
  }

  function rotuloPeriodo(e) {
    if (!C.dataValida(e.semestre.inicio) || !C.dataValida(e.semestre.fim)) {
      return 'não definido';
    }
    return C.fmtDiaAno(e.semestre.inicio) + ' – ' + C.fmtDiaAno(e.semestre.fim);
  }

  function parametros() {
    var e = S.estado, p = e.parametros;
    var editar = S.pode('estrutura.editar');
    return C.el('div', {}, [
      C.el('h5', { text: 'Parâmetros', style: 'margin-bottom:14px' }),
      C.el('div', { class: 'stack', style: 'gap:0' }, [
        U.kv('Semestre', pill(e.periodoLetivo, 'soft')),
        U.kv('Período letivo', rotuloPeriodo(e)),
        U.kv('Numeração das cadeiras', pill('1–' + S.totalCadeiras(), 'soft')),
        U.kv('Estrutura', C.plural(e.agrupamentos.length, 'agrupamento') + ' · ' +
          C.plural(e.clinicas.length, 'clínica', 'clínicas') + ' · ' +
          C.plural(S.totalCadeiras(), 'cadeira')),
        U.kv('Cadeiras operantes', totalOperantes() + ' de ' + S.totalCadeiras()),
        U.kv('Ocupação nas duas clínicas', pill('permitida', 'conjunta')),
        U.kv('Sobreposição na clínica', pill(p.bloquearSobreposicao ? 'bloqueada' : 'permitida',
          p.bloquearSobreposicao ? 'neutral' : 'warn')),
        U.kv('Faixa mínima', pill(rotuloFaixa(p.faixaMinimaMin), 'soft')),
        U.kv('Cancelamento', pill(perfisCom('agenda.cancelarQualquer'), 'neutral')),
        U.kv('Motivo na manutenção', pill(p.exigirMotivoManutencao ? 'obrigatório' : 'opcional',
          p.exigirMotivoManutencao ? 'neutral' : 'warn'))
      ]),
      editar ? C.el('button', {
        class: 'btn btn-outline', style: 'margin-top:18px', text: 'Ajustar parâmetros', onclick: editarParametros
      }) : null
    ]);
  }

  function editarParametros() {
    if (!S.pode('estrutura.editar')) { C.toast('Seu perfil não altera os parâmetros.'); return; }
    var e = S.estado;
    /* Estado já gravado com data vazia geraria NaN/NaN/NaN na tela e, pior,
       trancaria o formulário na validação nova. Cai para hoje. */
    var ini = C.dataValida(e.semestre.inicio) ? e.semestre.inicio : C.hojeISO();
    var fim = C.dataValida(e.semestre.fim) && e.semestre.fim > ini
      ? e.semestre.fim
      : C.addDays(ini, 18 * 7 - 3); /* 18 semanas letivas, como a semente */

    var f = {
      faixaMinimaMin: e.parametros.faixaMinimaMin,
      bloquearSobreposicao: e.parametros.bloquearSobreposicao,
      inicio: ini, fim: fim
    };

    U.modal({
      titulo: 'Parâmetros do semestre',
      largura: '620px',
      conteudo: C.el('div', {}, [
        C.el('div', { class: 'grid-fields' }, [
          U.campo('Início do semestre', C.el('input', { class: 'input', type: 'date', value: f.inicio,
            oninput: function (ev) { f.inicio = ev.target.value; } })),
          U.campo('Fim do semestre', C.el('input', { class: 'input', type: 'date', value: f.fim,
            oninput: function (ev) { f.fim = ev.target.value; } })),
          U.campo('Faixa mínima', U.selecao([30, 60, 90, 120].map(function (m) {
            return { valor: String(m), rotulo: rotuloFaixa(m) };
          }), String(f.faixaMinimaMin), function (v) { f.faixaMinimaMin = Number(v); })),
          U.campo('Sobreposição na clínica', U.selecao([
            { valor: 'sim', rotulo: 'Bloqueada' }, { valor: 'nao', rotulo: 'Permitida' }
          ], f.bloquearSobreposicao ? 'sim' : 'nao', function (v) { f.bloquearSobreposicao = v === 'sim'; }))
        ]),
        (C.dataValida(e.semestre.inicio) && C.dataValida(e.semestre.fim)) ? null
          : C.el('div', { class: 'alert', style: 'margin-top:16px',
            text: 'O semestre gravado estava sem data válida. Os campos vieram preenchidos com uma sugestão — confira antes de salvar.' })
      ]),
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Cancelar', onclick: U.fecharModal }),
        C.el('button', {
          class: 'btn btn-primary', text: 'Salvar',
          onclick: function () {
            if (!C.dataValida(f.inicio) || !C.dataValida(f.fim)) {
              C.toast('Informe datas válidas para o início e o fim do semestre.'); return;
            }
            if (f.fim <= f.inicio) { C.toast('O fim do semestre precisa ser depois do início.'); return; }
            S.atualizarParametros({ faixaMinimaMin: f.faixaMinimaMin, bloquearSobreposicao: f.bloquearSobreposicao });
            S.atualizarSemestre(f.inicio, f.fim);
            U.fecharModal(); C.toast('Parâmetros atualizados.'); global.App.recarregar();
          }
        })
      ]
    });
  }

  /* ── Registros de manutenção ──────────────────────────────────────── */
  function registros() {
    var todos = S.estado.manutencoes.slice().sort(function (a, b) { return b.abertoEm.localeCompare(a.abertoEm); });
    var lista = todos.filter(function (m) {
      return filtroManut === 'todas' || (filtroManut === 'abertas' ? m.status === 'aberta' : m.status === 'encerrada');
    });

    var seg = C.el('div', { class: 'seg' }, ['abertas', 'encerradas', 'todas'].map(function (f) {
      return C.el('button', {
        type: 'button', class: filtroManut === f ? 'on' : '',
        text: f.charAt(0).toUpperCase() + f.slice(1),
        onclick: function () { filtroManut = f; global.App.recarregar(); }
      });
    }));

    var caixa = C.el('div', {}, C.el('div', {
      style: 'display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px'
    }, [
      C.el('div', {}, [
        C.el('h5', { text: 'Registros de manutenção' }),
        C.el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:2px',
          text: 'todo registro exige motivo; protocolo, impacto e histórico são gerados pelo sistema' })
      ]),
      seg
    ]));

    if (!lista.length) { caixa.appendChild(U.vazio('Nenhum registro nesta condição.')); return caixa; }

    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, [
        C.el('th', { text: 'Protocolo' }), C.el('th', { text: 'Local' }),
        C.el('th', { text: 'Motivo' }), C.el('th', { text: 'Criticidade' }),
        C.el('th', { text: 'Aberto' }), C.el('th', { text: 'Previsão' }),
        C.el('th', { text: 'Situação' }), C.el('th', { class: 'right', text: '' })
      ]))
    ]);
    var corpo = C.el('tbody');
    lista.forEach(function (m) {
      corpo.appendChild(C.el('tr', {}, [
        C.el('td', { class: 'num', style: 'font-weight:600;font-size:12.5px', text: m.protocolo }),
        C.el('td', { style: 'font-size:12.5px', text: S.localCadeira(m.cadeira) }),
        C.el('td', {}, [
          C.el('div', { text: S.rotuloCategoriaManutencao(m.categoria) }),
          C.el('div', { class: 'muted', style: 'font-size:12px;max-width:340px',
            text: m.motivo.length > 76 ? m.motivo.slice(0, 76) + '…' : m.motivo })
        ]),
        C.el('td', {}, U.badgeCriticidade(m.criticidade)),
        C.el('td', { style: 'font-size:12.5px' }, [
          C.el('div', { text: C.fmtCarimbo(m.abertoEm) }),
          C.el('div', { class: 'muted', text: S.nomePessoa(m.abertoPor) })
        ]),
        C.el('td', { class: 'num', style: 'font-size:12.5px',
          text: m.previsaoRetorno ? C.fmtDia(m.previsaoRetorno) : '—' }),
        C.el('td', {}, m.status === 'aberta'
          ? C.el('span', { class: 'badge warn', text: 'há ' + C.decorrido(m.abertoEm) })
          : C.el('span', { class: 'badge ok', text: 'encerrada' })),
        C.el('td', { class: 'right', style: 'white-space:nowrap' }, [
          C.el('button', { class: 'btn-ghost', text: 'Ficha', onclick: function () { fichaManutencao(m); } }),
          m.status === 'aberta' && S.pode('manutencao.encerrar') ? C.el('button', {
            class: 'btn-ghost', style: 'margin-left:12px', text: 'Encerrar',
            onclick: function () { M.encerrar(m, function () { global.App.recarregar(); }); }
          }) : null
        ])
      ]));
    });
    tabela.appendChild(corpo);
    /* A coluna "Local" traz agrupamento, clínica e cadeira: em tela estreita
       a tabela rola dentro da própria caixa, sem empurrar a página. */
    caixa.appendChild(C.el('div', { class: 'rolagem-x' }, tabela));
    return caixa;
  }

  function fichaManutencao(m) {
    U.modal({
      titulo: 'Manutenção · cadeira ' + C.pad(m.cadeira),
      subtitulo: S.localCadeira(m.cadeira) + ' · ' + m.protocolo,
      largura: '660px',
      conteudo: M.ficha(m),
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Fechar', onclick: U.fecharModal }),
        m.status === 'aberta' && S.pode('manutencao.encerrar') ? C.el('button', {
          class: 'btn btn-primary', text: 'Encerrar manutenção',
          onclick: function () { U.fecharModal(); M.encerrar(m, function () { global.App.recarregar(); }); }
        }) : null
      ]
    });
  }

  global.ViewEstrutura = { render: render };
})(window);
