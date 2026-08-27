/* views/agora.js — ocupação em tempo real: cadeiras, alunos e linha do dia.
   A tela é do AGRUPAMENTO: as duas clínicas aparecem lado a lado, cada uma
   com suas 14 cadeiras. Número de cadeira é sempre o global, de 1 a 112. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, M = global.Manutencao;

  var sel = { agrupamentoId: null, cadeira: null };

  /* Altura, em pixels, da faixa de uma clínica na linha do dia. Uma
     ocupação das duas clínicas ocupa as duas faixas. */
  var ALTURA_FAIXA = 32;

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
      } else if (params.cadeira) {
        var c0 = S.clinicaDaCadeira(params.cadeira);
        if (c0) destino = c0.agrupamentoId;
      }
      if (destino) {
        sel.agrupamentoId = destino;
        sel.cadeira = params.cadeira || null;
      }
    }
    if (!sel.agrupamentoId || !S.agrupamento(sel.agrupamentoId)) {
      sel.agrupamentoId = e.agrupamentos[0].id;
      sel.cadeira = null;
    }
    /* Cadeira herdada de outro agrupamento não pode continuar selecionada. */
    if (sel.cadeira) {
      var cSel = S.clinicaDaCadeira(sel.cadeira);
      if (!cSel || cSel.agrupamentoId !== sel.agrupamentoId) sel.cadeira = null;
    }

    alvo.appendChild(C.el('section', { class: 'split3' }, [
      C.el('div', { class: 'c-left' }, listaAgrupamentos(hoje)),
      C.el('div', { class: 'c-mid' }, painelAgrupamento(hoje)),
      C.el('div', { class: 'c-right' }, painelCadeira(hoje))
    ]));
  }

  /* ── Leituras compartilhadas ──────────────────────────────────────── */

  /* "Cadeiras em uso" é sempre cadeira com aluno registrado. O antigo
     fallback `atribuições || o.cadeiras` fazia a mesma tela dizer 71% num
     canto e 0 de 13 no outro — cadeira reservada não é cadeira em uso. */
  function cadeirasEmUso(o) { return S.atribuicoesDa(o.chave).length; }
  function cadeirasReservadas(o) { return o.cadeiras; }

  function emUsoNoAgrupamento(agrupamentoId, hoje) {
    var n = 0;
    S.ocorrenciasDoDia(hoje, { agrupamentoId: agrupamentoId }).forEach(function (o) {
      if (S.statusOcorrencia(o) !== 'em_andamento') return;
      n += cadeirasEmUso(o);
    });
    return n;
  }
  function interditadasNoAgrupamento(agrupamentoId) {
    return S.clinicasDoAgrupamento(agrupamentoId).reduce(function (s, c) {
      return s + S.cadeirasInterditadas(c.id);
    }, 0);
  }

  /* Ocupação vigente na clínica — a que está em andamento agora; se não
     houver, a próxima de hoje; se não houver, a última encerrada. */
  function ocupacaoVigente(clinicaId, hoje) {
    var doDia = S.ocorrenciasDoDia(hoje, clinicaId);
    var andando = doDia.filter(function (o) { return S.statusOcorrencia(o) === 'em_andamento'; });
    if (andando.length) return andando[0];
    var futuras = doDia.filter(function (o) { return S.statusOcorrencia(o) === 'agendada'; });
    if (futuras.length) return futuras[0];
    return doDia.length ? doDia[doDia.length - 1] : null;
  }

  /* A ocupação que toma as duas clínicas do agrupamento neste momento. */
  function ocupacaoConjunta(agrupamentoId, hoje) {
    var l = S.ocorrenciasDoDia(hoje, { agrupamentoId: agrupamentoId }).filter(function (o) {
      return S.clinicasDoEscopo(o.agrupamentoId, o.escopo).length > 1 &&
        S.statusOcorrencia(o) === 'em_andamento';
    });
    return l.length ? l[0] : null;
  }

  /* Sem cadeira escolhida, a lista de alunos mostra a ocupação conjunta do
     agrupamento ou a primeira clínica que tiver ocupação vigente. */
  function ocupacaoDeReferencia(agrupamentoId, hoje) {
    var conj = ocupacaoConjunta(agrupamentoId, hoje);
    if (conj) return conj;
    var clinicas = S.clinicasDoAgrupamento(agrupamentoId), achada = null;
    clinicas.forEach(function (c) {
      if (achada) return;
      achada = ocupacaoVigente(c.id, hoje);
    });
    return achada;
  }

  /* Posição da cadeira dentro do escopo da ocupação (0 é a primeira do
     escopo). Com numeração global, comparar `numero <= o.cadeiras` diria
     que a Clínica 8 inteira está livre. */
  function posicaoNoEscopo(o, numero) {
    var l = S.clinicasDoEscopo(o.agrupamentoId, o.escopo), base = 0;
    for (var i = 0; i < l.length; i++) {
      var f = S.faixaCadeiras(l[i].id);
      if (numero >= f[0] && numero <= f[1]) return base + (numero - f[0]);
      base += l[i].cadeiras;
    }
    return -1;
  }

  function statusCadeira(clinicaId, numero, occ) {
    if (S.cadeiraEmManutencao(clinicaId, numero)) return 'manut';
    if (!occ) return 'livre';
    if (S.atribuicaoDaCadeira(occ.chave, numero)) return 'ocupada';
    var pos = posicaoNoEscopo(occ, numero);
    return (pos !== -1 && pos < cadeirasReservadas(occ)) ? 'vaga' : 'livre';
  }

  /* Ocupar e liberar dependem da permissão E da relação com a ocupação:
     a coordenação opera qualquer uma, o professor só as suas. */
  function podeOperar(occ) {
    if (!occ || !S.pode('cadeira.ocupar')) return false;
    var u = S.usuario();
    if (!u) return false;
    return u.perfil === 'coordenador' || occ.responsavelId === u.id;
  }

  function rotuloResponsavel(o) {
    return o.origem === 'recorrente' ? 'Professor coordenador' : 'Responsável';
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
          text: S.cadeirasOperantesEscopo(g.id, 'ambas') + ' de ' + capacidade + ' cadeiras operantes'
        })
      ]));
    });

    caixa.appendChild(C.el('div', { class: 'legend', style: 'margin-top:24px' }, [
      legenda('ocupada', 'Com aluno'),
      legenda('vaga', 'Vaga na ocupação'),
      legenda('', 'Livre'),
      legenda('manut', 'Em manutenção')
    ]));
    return caixa;
  }
  function legenda(cls, texto) {
    return C.el('div', { class: 'row', style: 'gap:9px' }, [
      C.el('span', { class: 'k ' + cls, style: cls === 'ocupada'
        ? 'background:var(--fill-strong);border-color:var(--fill-strong)'
        : cls === 'vaga' ? 'border-color:var(--fill-strong);border-width:2px'
          : cls === 'manut' ? 'background:var(--color-neutral-300)' : '' }),
      C.el('span', { text: texto })
    ]);
  }

  /* ── Coluna central ───────────────────────────────────────────────── */
  function painelAgrupamento(hoje) {
    var g = S.agrupamento(sel.agrupamentoId);
    var clinicas = S.clinicasDoAgrupamento(g.id);
    var capacidade = S.capacidadeEscopo(g.id, 'ambas');
    var faixa = S.faixaEscopo(g.id, 'ambas');
    var emUso = emUsoNoAgrupamento(g.id, hoje);
    var interditadas = interditadasNoAgrupamento(g.id);
    var caixa = C.el('div');

    var resumo = emUso + ' de ' + capacidade + ' cadeiras em uso · ' + faixa[0] + '–' + faixa[1];
    /* O déficit precisa aparecer: cadeira interditada dentro da faixa
       reservada some da conta sem que ninguém veja. */
    if (interditadas) resumo += ' · ' + C.plural(interditadas, 'cadeira', 'cadeiras') + ' em manutenção';

    caixa.appendChild(C.el('div', {
      style: 'display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px'
    }, [
      C.el('h2', { text: g.nome }),
      C.el('span', { class: 'muted', style: 'font-size:13px', text: resumo })
    ]));

    var conj = ocupacaoConjunta(g.id, hoje);
    if (conj) {
      caixa.appendChild(C.el('div', {
        class: 'row',
        style: 'gap:14px;padding:12px 16px;margin-bottom:20px;background:var(--fill-tint);color:var(--on-tint)'
      }, [
        /* A faixa já é --fill-tint; o selo repete o tom mais escuro da
           ocupação conjunta para não sumir dentro dela. */
        C.el('span', { class: 'badge conjunta',
          style: 'background:var(--fill-deep);color:var(--color-accent-100)', text: 'Conjunta' }),
        C.el('span', { style: 'font-size:13px', text: conj.titulo + ' nas duas clínicas até ' + conj.fim })
      ]));
    }

    var grades = C.el('div', { style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0' });
    clinicas.forEach(function (c, i) { grades.appendChild(colunaClinica(c, i, hoje)); });
    caixa.appendChild(grades);

    caixa.appendChild(C.el('div', { style: 'margin-top:34px' }, linhaDoDia(hoje)));
    return caixa;
  }

  function colunaClinica(c, indice, hoje) {
    var occ = ocupacaoVigente(c.id, hoje);
    var f = S.faixaCadeiras(c.id);
    var grade = C.el('div', { class: 'chairs' });
    for (var n = f[0]; n <= f[1]; n++) grade.appendChild(cadeiraBtn(c, n, occ));

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
      C.el('div', { class: 'muted', style: 'font-size:12.5px;margin:6px 0 16px', text: linhaEstado(occ) }),
      grade
    ]);
  }

  /* Uma linha por clínica: o que está acontecendo, o que vem a seguir, ou
     o que já encerrou. */
  function linhaEstado(occ) {
    if (!occ) return 'Livre o dia inteiro';
    var st = S.statusOcorrencia(occ);
    if (st === 'em_andamento') {
      return occ.titulo + ' · ' + S.nomePessoa(occ.responsavelId) + ' · ' + occ.inicio + '–' + occ.fim;
    }
    if (st === 'agendada') return 'Livre · próxima ' + occ.inicio + ' · ' + occ.titulo;
    return 'Livre · encerrada ' + occ.fim;
  }

  function cadeiraBtn(c, n, occ) {
    var st = statusCadeira(c.id, n, occ);
    var cls = 'chair' + (st === 'livre' ? '' : ' ' + st) + (sel.cadeira === n ? ' sel' : '');
    return C.el('button', {
      class: cls, text: C.pad(n),
      title: (st === 'manut' ? 'Em manutenção' : st === 'ocupada' ? 'Com aluno'
        : st === 'vaga' ? 'Vaga na ocupação' : 'Livre') + ' · ' + S.localCadeira(n),
      onclick: function () { sel.cadeira = n; global.App.recarregar(); }
    });
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
          style: 'position:absolute;left:0;right:0;top:' + (i * ALTURA_FAIXA) +
            'px;height:1px;background:var(--line-soft)'
        }));
      }

      S.ocorrenciasDoDia(hoje, { agrupamentoId: g.id }).forEach(function (o) {
        var a = Math.max(ini, C.toMin(o.inicio)), b = Math.min(fim, C.toMin(o.fim));
        if (b <= a) return;
        var ids = S.idsDoEscopo(o.agrupamentoId, o.escopo);
        var dupla = ids.length > 1;
        var idx = Math.max(0, g.clinicas.indexOf(ids[0]));
        var st = S.statusOcorrencia(o);
        var topo = (dupla ? 0 : idx * ALTURA_FAIXA) + 3;
        var alt = (dupla ? altura : ALTURA_FAIXA) - 6;
        trilha.appendChild(C.el('button', {
          class: 'tl-blk' + (dupla ? ' conjunta' : o.origem === 'pontual' ? ' pontual' : '') +
            (st === 'em_andamento' ? ' agora' : ''),
          style: 'left:' + ((a - ini) / span * 100) + '%;width:' + ((b - a) / span * 100) +
            '%;top:' + topo + 'px;height:' + alt + 'px',
          text: o.inicio + '–' + o.fim + ' · ' + o.titulo,
          title: S.rotuloEscopo(o.agrupamentoId, o.escopo) + ' · ' + o.inicio + '–' + o.fim,
          onclick: function () { global.Agenda.detalhe(o); }
        }));
      });

      if (agora >= ini && agora <= fim) {
        trilha.appendChild(C.el('div', { class: 'tl-now', style: 'left:' + ((agora - ini) / span * 100) + '%' }));
      }
      return C.el('div', { class: 'tl-row' }, [
        C.el('div', { class: 'tl-lbl' }, [
          g.nome,
          C.el('small', {
            text: clinicas.map(function (c) { return c.nome; }).join(' · ')
          })
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
      C.el('div', { style: 'border-top:1px solid var(--color-divider)' }, linhas)
    ]);
  }

  /* ── Coluna direita ───────────────────────────────────────────────── */
  function painelCadeira(hoje) {
    var caixa = C.el('div');

    if (!sel.cadeira) {
      caixa.appendChild(C.el('h5', { text: 'Cadeira' }));
      caixa.appendChild(C.el('p', { class: 'muted', style: 'font-size:13px;line-height:1.6;margin-top:8px',
        text: 'Escolha uma cadeira em uma das duas grades para ver quem está atendendo, ocupá-la com um aluno ou registrar manutenção.' }));
      caixa.appendChild(alunosDaOcupacao(ocupacaoDeReferencia(sel.agrupamentoId, hoje)));
      return caixa;
    }

    var n = sel.cadeira;
    var c = S.clinicaDaCadeira(n);
    var occ = ocupacaoVigente(c.id, hoje);
    var st = statusCadeira(c.id, n, occ);
    var manut = S.cadeiraEmManutencao(c.id, n);

    caixa.appendChild(C.el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px' }, [
      C.el('h4', { text: 'Cadeira ' + n }),
      C.el('span', {
        class: 'badge ' + (st === 'manut' ? 'warn' : st === 'ocupada' ? 'strong' : st === 'vaga' ? 'soft' : 'neutral'),
        text: st === 'manut' ? 'Manutenção' : st === 'ocupada' ? 'Ocupada' : st === 'vaga' ? 'Vaga' : 'Livre'
      })
    ]));
    caixa.appendChild(C.el('div', { class: 'muted', style: 'font-size:12.5px;margin:3px 0 18px',
      text: S.localCadeira(n) + (c.especialidade ? ' · ' + c.especialidade : '') }));

    if (manut) {
      caixa.appendChild(M.ficha(manut));
      if (S.pode('manutencao.encerrar')) {
        caixa.appendChild(C.el('button', {
          class: 'btn btn-primary', style: 'margin-top:18px', text: 'Encerrar manutenção',
          onclick: function () { M.encerrar(manut, function () { global.App.recarregar(); }); }
        }));
      }
      caixa.appendChild(historico(n));
      return caixa;
    }

    var atrib = occ ? S.atribuicaoDaCadeira(occ.chave, n) : null;
    if (atrib) {
      var a = S.aluno(atrib.alunoId);
      caixa.appendChild(C.el('div', { class: 'stack', style: 'gap:0' }, [
        U.kv('Aluno', a ? a.nome : '—'),
        U.kv('Matrícula', a ? a.matricula : '—'),
        U.kv('Período', a ? a.periodo + 'º período' : '—'),
        U.kv('Ocupação', occ.titulo),
        U.kv('Onde', S.rotuloEscopo(occ.agrupamentoId, occ.escopo)),
        U.kv(rotuloResponsavel(occ), S.nomePessoa(occ.responsavelId)),
        U.kv('Faixa', occ.inicio + '–' + occ.fim),
        U.kv('Registrado', C.fmtCarimbo(atrib.registradoEm))
      ]));
      if (podeOperar(occ)) {
        caixa.appendChild(C.el('button', {
          class: 'btn btn-primary', style: 'margin-top:18px', text: 'Liberar cadeira',
          onclick: function () {
            S.liberarCadeira(occ.chave, n);
            C.toast('Cadeira ' + n + ' liberada.');
            global.App.recarregar();
          }
        }));
      }
    } else if (occ && st === 'vaga') {
      caixa.appendChild(ocuparForm(occ, n));
    } else {
      caixa.appendChild(C.el('p', { class: 'muted', style: 'font-size:13px;line-height:1.6',
        text: occ
          ? 'Esta cadeira está fora da faixa reservada pela ocupação atual (' +
            C.plural(cadeirasReservadas(occ), 'cadeira', 'cadeiras') + ' em ' +
            S.rotuloEscopo(occ.agrupamentoId, occ.escopo) + ').'
          : 'Sem ocupação vigente nesta clínica.' }));
    }

    if (S.pode('manutencao.abrir')) {
      caixa.appendChild(C.el('button', {
        class: 'btn btn-outline', style: 'margin-top:10px', text: 'Registrar manutenção',
        onclick: function () { M.abrir(c.id, n, function () { global.App.recarregar(); }); }
      }));
    }

    caixa.appendChild(historico(n));
    return caixa;
  }

  /* Histórico de manutenção da cadeira — pelo número global, que já
     determina a clínica. */
  function historico(n) {
    var hist = S.historicoCadeira(n);
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

  function ocuparForm(occ, n) {
    if (!podeOperar(occ)) {
      return C.el('p', { class: 'muted', style: 'font-size:13px', text: 'Vaga livre nesta ocupação.' });
    }
    /* Sem turma vinculada não existe lista de candidatos: cair na base
       inteira de alunos ofereceria a faculdade toda. */
    var t = occ.turmaId ? S.turma(occ.turmaId) : null;
    if (!t) {
      return C.el('p', { class: 'muted', style: 'font-size:13px;line-height:1.6',
        text: 'Esta ocupação não tem turma vinculada, então não há lista de alunos para ocupar a cadeira.' });
    }
    var usados = S.atribuicoesDa(occ.chave).map(function (a) { return a.alunoId; });
    var candidatos = t.alunos.map(S.aluno).filter(function (a) {
      return a && usados.indexOf(a.id) === -1;
    });
    if (!candidatos.length) {
      return C.el('p', { class: 'muted', style: 'font-size:13px', text: 'Todos os alunos da turma já estão em cadeiras.' });
    }
    var escolhido = candidatos[0].id;
    return C.el('div', { class: 'stack', style: 'gap:14px' }, [
      U.campo('Aluno', U.selecao(candidatos.map(function (a) {
        return { valor: a.id, rotulo: a.nome + ' · ' + a.periodo + 'º' };
      }), escolhido, function (v) { escolhido = v; })),
      C.el('button', {
        class: 'btn btn-primary', text: 'Ocupar cadeira ' + n,
        onclick: function () {
          /* Gravação pode falhar (cadeira tomada no intervalo, sem espaço
             para persistir): só anuncia sucesso quando houve sucesso. */
          if (S.ocuparCadeira(occ, n, escolhido)) {
            var al = S.aluno(escolhido);
            C.toast((al ? al.nome : 'Aluno') + ' na cadeira ' + n + '.');
          } else {
            C.toast('Não foi possível ocupar a cadeira ' + n + '. Recarregue e tente de novo.');
          }
          global.App.recarregar();
        }
      })
    ]);
  }

  function alunosDaOcupacao(occ) {
    if (!occ || !occ.turmaId) return C.el('div');
    var t = S.turma(occ.turmaId);
    if (!t) return C.el('div');
    var clinicas = S.clinicasDoEscopo(occ.agrupamentoId, occ.escopo);
    var titulo = clinicas.length > 1
      ? 'Turma nas ' + S.capacidadeEscopo(occ.agrupamentoId, occ.escopo) + ' cadeiras'
      : clinicas.length ? 'Alunos na ' + clinicas[0].nome : 'Alunos da ocupação';
    var atribs = S.atribuicoesDa(occ.chave);
    var mapa = {};
    atribs.forEach(function (a) { mapa[a.alunoId] = a.cadeira; });
    return C.el('div', { style: 'margin-top:28px' }, [
      C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:10px',
        text: titulo + ' · ' + S.rotuloTurma(t) }),
      C.el('div', {}, t.alunos.map(function (id) {
        var a = S.aluno(id);
        if (!a) return null;
        return C.el('div', { class: 'row', style: 'gap:11px;padding:7px 0' }, [
          C.el('span', {
            class: 'num',
            style: 'width:26px;height:22px;display:grid;place-items:center;font-size:11px;flex:none;' +
              (mapa[id] ? 'background:var(--fill-strong);color:var(--on-strong)' : 'background:var(--color-surface);color:var(--muted)'),
            text: mapa[id] ? C.pad(mapa[id]) : '—'
          }),
          C.el('span', {}, [
            C.el('div', { style: 'font-size:13px', text: a.nome }),
            C.el('div', { class: 'muted', style: 'font-size:11.5px', text: a.periodo + 'º período' })
          ])
        ]);
      }))
    ]);
  }

  global.ViewAgora = { render: render };
})(window);
