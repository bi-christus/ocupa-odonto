/* views/painel.js — visão geral do dia e registro de ocupações.
   O polo tem 4 agrupamentos de 2 clínicas: 8 clínicas e 112 cadeiras, com
   numeração global de 1 a 112. Uma ocupação pertence a um agrupamento e
   tem escopo 'a', 'b' ou 'ambas' — por isso a lista do dia rotula pelo
   escopo, e não pelo nome de uma clínica só. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI;

  function render(alvo) {
    if (!S.pode('painel.ver')) { alvo.appendChild(U.semPermissao()); return; }
    var hoje = C.hojeISO();
    var seg = C.startOfWeek(hoje);

    alvo.appendChild(kpis(hoje, seg));

    alvo.appendChild(C.el('section', { class: 'split', style: 'margin-top:32px' }, [
      C.el('div', { class: 'stack', style: 'gap:28px;min-width:0' }, [
        cartaoRegistro(),
        ocupacoesDeHoje(hoje)
      ]),
      C.el('div', { class: 'stack', style: 'gap:32px;min-width:0' }, [
        horasPorClinica(seg),
        manutencoesAbertas()
      ])
    ]));
  }

  /* ── Indicadores ──────────────────────────────────────────────────── */
  function kpis(hoje, seg) {
    var total = S.totalCadeiras();
    var emUso = S.cadeirasEmUsoAgora();
    var manut = S.manutencoesAbertas().length;
    /* A semana do indicador é a mesma do bloco de horas: segunda a sábado,
       fechada por S.fimDaSemana. */
    var dados = [
      ['Cadeiras em uso', emUso, 'de ' + total],
      ['Em andamento', S.emAndamento().length, 'ocupações'],
      ['Horas na semana', C.fmtHoras(S.horasSemana(seg)).replace(' h', ''), 'h'],
      ['Em manutenção', manut, manut === 1 ? 'cadeira' : 'cadeiras']
    ];
    return C.el('section', { class: 'kpis' }, dados.map(function (k) {
      return C.el('div', { class: 'kpi' }, [
        C.el('div', { class: 'eyebrow', text: k[0] }),
        C.el('b', {}, [String(k[1]), C.el('small', { text: k[2] })])
      ]);
    }));
  }

  /* ── Registro ─────────────────────────────────────────────────────── */
  function cartaoRegistro() {
    var caixa = C.el('div', { class: 'card' });
    var cabecalho = C.el('div', {
      style: 'display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:18px'
    }, [
      C.el('h5', { style: 'font-size:22px', text: 'Nova ocupação' }),
      C.el('span', { class: 'muted', style: 'font-size:12px', text: 'semestre ' + S.estado.periodoLetivo })
    ]);
    caixa.appendChild(cabecalho);
    var slot = C.el('div');
    caixa.appendChild(slot);
    global.Registro.montar(slot, {
      compacto: true,
      aoRegistrar: function () { global.App.recarregar(); }
    });
    return caixa;
  }

  /* ── Ocupações de hoje ────────────────────────────────────────────────
     Dois filtros independentes: situação (todas / em andamento) e local.
     O local aceita o agrupamento inteiro — as duas clínicas juntas — ou
     uma clínica de cada vez, porque uma ocupação de escopo duplo precisa
     aparecer nas duas. Quem resolve isso é o filtro do store. */
  function ocupacoesDeHoje(hoje) {
    var filtro = 'todas';
    var local = '';                    /* '' | 'ag:<id>' | 'cl:<id>' */
    var secao = C.el('section');
    var lista = C.el('div');

    var rotulos = { todas: 'Todas', em_andamento: 'Em andamento' };
    var botoes = ['todas', 'em_andamento'].map(function (f) {
      var b = C.el('button', {
        type: 'button', class: filtro === f ? 'on' : '',
        'aria-pressed': filtro === f ? 'true' : 'false',
        text: rotulos[f],
        onclick: function () {
          filtro = f;
          botoes.forEach(function (outro) {
            var ligado = outro === b;
            outro.className = ligado ? 'on' : '';
            outro.setAttribute('aria-pressed', ligado ? 'true' : 'false');
          });
          desenhar();
        }
      });
      return b;
    });

    secao.appendChild(C.el('div', {
      style: 'display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px'
    }, [
      C.el('div', {}, [
        C.el('h5', { style: 'font-size:22px', text: 'Ocupações de hoje' }),
        C.el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:2px',
          text: C.nomeDia(C.weekday(hoje), true) + ', ' + C.fmtExtenso(hoje) })
      ]),
      C.el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, [
        seletorLocal(function (v) { local = v; desenhar(); }),
        C.el('div', { class: 'seg' }, botoes)
      ])
    ]));
    secao.appendChild(lista);

    /* Select com as 4 opções de agrupamento e, dentro de cada uma, as duas
       clínicas. Montado à mão porque UI.selecao não faz optgroup. */
    function seletorLocal(aoMudar) {
      var s = C.el('select', {
        class: 'input',
        style: 'width:auto;min-width:196px;height:34px;font-size:12.5px',
        'aria-label': 'Filtrar por clínica'
      });
      s.appendChild(C.el('option', { value: '', text: 'Todas as clínicas', selected: true }));
      (S.estado.agrupamentos || []).forEach(function (g) {
        var grupo = C.el('optgroup', { label: g.nome });
        grupo.appendChild(C.el('option', {
          value: 'ag:' + g.id,
          text: g.nome + ' · as duas'
        }));
        S.clinicasDoAgrupamento(g.id).forEach(function (c) {
          grupo.appendChild(C.el('option', {
            value: 'cl:' + c.id,
            text: c.nome + ' · ' + c.especialidade
          }));
        });
        s.appendChild(grupo);
      });
      s.value = local;
      s.addEventListener('change', function () { aoMudar(s.value); });
      return s;
    }

    function filtroLocal() {
      if (local.indexOf('ag:') === 0) return { agrupamentoId: local.slice(3) };
      if (local.indexOf('cl:') === 0) return { clinicaId: local.slice(3) };
      return null;
    }

    function nomeDoLocal() {
      if (local.indexOf('ag:') === 0) return S.nomeAgrupamento(local.slice(3));
      if (local.indexOf('cl:') === 0) return S.nomeClinica(local.slice(3));
      return '';
    }

    function textoVazio() {
      var onde = local ? ' em ' + nomeDoLocal() : '';
      if (filtro === 'todas') return 'Nenhuma ocupação registrada para hoje' + onde + '.';
      return 'Nenhuma ocupação em andamento neste momento' + onde + '.';
    }

    function desenhar() {
      C.clear(lista);
      var itens = S.ocorrenciasDoDia(hoje, filtroLocal()).filter(function (o) {
        return filtro === 'todas' || S.statusOcorrencia(o) === 'em_andamento';
      });
      if (!itens.length) {
        lista.appendChild(U.vazio(textoVazio()));
        return;
      }
      /* Linhas flex em vez de tabela: as colunas fixas da tabela antiga
         somavam ~580px e estouravam a tela estreita, onde nenhuma media
         query alcança um atributo style. */
      lista.appendChild(C.el('div', { style: 'display:flex;flex-direction:column' },
        itens.map(linha)));
    }

    function linha(o) {
      var st = S.statusOcorrencia(o);
      var u = S.usuario();
      var conjunta = o.escopo === 'ambas';
      var podeCancelar = S.pode('agenda.cancelarQualquer') ||
        (S.pode('agenda.cancelarPropria') && o.responsavelId === u.id);
      return C.el('div', {
        style: 'display:flex;align-items:center;justify-content:space-between;gap:16px;' +
          'padding:13px 0;border-bottom:1px solid var(--color-divider);' +
          (st === 'encerrada' ? 'opacity:.6' : '')
      }, [
        C.el('div', { style: 'min-width:0;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap' }, [
          C.el('span', {
            style: 'font:600 14px var(--font-heading);letter-spacing:.02em;min-width:150px',
            text: S.rotuloEscopo(o.agrupamentoId, o.escopo)
          }),
          C.el('span', {
            class: 'num', style: 'font-size:13px;color:var(--accent-ink);min-width:96px',
            text: o.inicio + '–' + o.fim
          }),
          C.el('span', { style: 'font-size:13px;min-width:0' }, [
            C.el('b', { style: 'font-weight:600', text: o.titulo }),
            C.el('span', {
              class: 'muted',
              text: ' · ' + o.subtitulo + ' · ' + S.nomePessoa(o.responsavelId) +
                ' · ' + C.plural(o.cadeiras, 'cadeira', 'cadeiras')
            })
          ]),
          C.el('span', {
            class: 'badge ' + (o.origem === 'recorrente' ? 'neutral' : 'soft'),
            text: o.origem === 'recorrente' ? 'Recorrente' : 'Pontual'
          }),
          conjunta ? C.el('span', { class: 'badge conjunta', text: 'Conjunta' }) : null,
          U.badgeStatus(st)
        ]),
        C.el('div', { style: 'display:flex;gap:6px;flex:none' }, [
          C.el('button', {
            class: 'btn-ghost', text: 'Ver cadeiras',
            onclick: function () { global.App.ir('agora', { agrupamentoId: o.agrupamentoId }); }
          }),
          podeCancelar && st !== 'encerrada' ? C.el('button', {
            class: 'btn-danger', text: 'Cancelar',
            onclick: function () { global.Agenda.cancelar(o, function () { global.App.recarregar(); }); }
          }) : null
        ])
      ]);
    }

    desenhar();
    return secao;
  }

  /* ── Horas por clínica ──────────────────────────────────────────────
     São as 8 clínicas, como no mockup. A barra é medida contra a
     capacidade real da semana (parametros.capacidadeSemanalH), e não
     contra o maior valor da série — normalizar pelo maior fazia a clínica
     mais ocupada parecer sempre lotada. */
  function horasPorClinica(seg) {
    var dados = S.horasPorClinica(seg);
    var cap = (S.estado.parametros && S.estado.parametros.capacidadeSemanalH) || 60;
    var fim = S.fimDaSemana(seg);
    return C.el('section', {}, [
      C.el('h5', { style: 'font-size:22px', text: 'Horas por clínica' }),
      C.el('div', { class: 'muted', style: 'font-size:12.5px;margin:2px 0 16px',
        text: 'semana de ' + C.fmtDia(seg) + ' a ' + C.fmtDia(fim) +
          ' · capacidade de ' + C.fmtHoras(cap) + ' por clínica' }),
      C.el('div', { class: 'stack', style: 'gap:12px' }, dados.map(function (d) {
        return C.el('div', { class: 'row', style: 'gap:12px' }, [
          C.el('span', { style: 'width:82px;flex:none;font-size:12.5px', text: d.clinica.nome }),
          U.barra(d.horas, cap),
          C.el('span', { class: 'num muted', style: 'width:52px;text-align:right;font-size:12.5px',
            text: C.fmtHoras(d.horas) })
        ]);
      }))
    ]);
  }

  /* ── Manutenções abertas ──────────────────────────────────────────── */
  function manutencoesAbertas() {
    var abertas = S.manutencoesAbertas();
    return C.el('section', {}, [
      C.el('div', { style: 'display:flex;align-items:baseline;justify-content:space-between;gap:12px' }, [
        C.el('h5', { text: 'Manutenções abertas' }),
        S.pode('estrutura.ver') ? C.el('button', {
          class: 'btn-ghost', text: 'Estrutura', onclick: function () { global.App.ir('estrutura'); }
        }) : null
      ]),
      abertas.length ? C.el('div', { class: 'stack', style: 'gap:0;margin-top:12px' }, abertas.map(function (m) {
        return C.el('div', { style: 'padding:11px 0;border-bottom:1px solid var(--color-divider)' }, [
          C.el('div', { class: 'row', style: 'gap:8px' }, [
            /* A cadeira é sempre o número global de 1 a 112. */
            C.el('b', { style: 'font-size:13px',
              text: S.nomeClinica(m.clinicaId) + ' · cadeira ' + C.pad(m.cadeira) }),
            U.badgeCriticidade(m.criticidade)
          ]),
          C.el('div', { class: 'muted', style: 'font-size:12px;margin-top:3px',
            text: S.rotuloCategoriaManutencao(m.categoria) + ' · ' + m.protocolo +
              ' · há ' + C.decorrido(m.abertoEm) })
        ]);
      })) : C.el('div', { class: 'muted', style: 'font-size:13px;margin-top:12px',
        text: 'Todas as cadeiras estão operando.' })
    ]);
  }

  global.ViewPainel = { render: render };
})(window);
