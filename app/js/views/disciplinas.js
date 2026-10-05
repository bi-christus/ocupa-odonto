/* views/disciplinas.js — cadastro de disciplinas da graduação e
   especializações da pós.

   Desde 05/10/2026 disciplina é SÓ disciplina: código e nome na graduação,
   nome na pós. Saíram o cadastro de turma, o código de turma e o vínculo de
   alunos, que era por turma. A turma de cada ocupação é escrita na
   "Descrição/Turma" do formulário, e o professor é ligado às disciplinas
   dele na tela ACESSOS — aqui o vínculo só é mostrado.

   A LIMPEZA DO CADASTRO mora aqui: o banco ainda guarda turma de três
   jeitos (reserva antiga apontando para turma, especialização com "T1" no
   nome, professor herdado da turma), e a coordenação resolve os três de uma
   vez, com prévia. Ver `S.planoDeLimpeza`. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI;

  var vista = 'graduacao';

  function render(alvo) {
    if (!S.pode('disciplinas.ver')) { alvo.appendChild(U.semPermissao()); return; }
    var e = S.estado;
    var podeEditar = S.pode('disciplinas.editar');
    var lista = S.disciplinasDoNivel(vista);

    alvo.appendChild(C.el('div', { class: 'page-head' }, [
      C.el('div', {}, [
        C.el('h2', { text: 'Disciplinas · ' + e.periodoLetivo }),
        C.el('div', { class: 'muted', style: 'font-size:13.5px;margin-top:6px',
          text: vista === 'pos'
            ? C.plural(lista.length, 'especialização cadastrada', 'especializações cadastradas')
            : C.plural(lista.length, 'disciplina cadastrada', 'disciplinas cadastradas') })
      ]),
      C.el('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap;align-items:center' }, [
        C.el('div', { class: 'seg' }, [aba('graduacao', 'Graduação'), aba('pos', 'Pós-graduação')]),
        /* O botão de criar é o da aba aberta: "Nova disciplina" na aba da pós
           ofereceria justamente o cadastro que a pós não tem. */
        podeEditar ? C.el('button', {
          class: 'btn btn-primary', text: vista === 'pos' ? 'Nova especialização' : 'Nova disciplina',
          onclick: function () { editar(null); }
        }) : null
      ])
    ]));

    if (podeEditar) {
      var aviso = avisoDeLimpeza();
      if (aviso) alvo.appendChild(aviso);
    }
    alvo.appendChild(tabela(lista));
  }

  function aba(id, rotulo) {
    return C.el('button', {
      type: 'button', class: vista === id ? 'on' : '', text: rotulo,
      'aria-pressed': vista === id ? 'true' : 'false',
      onclick: function () { vista = id; global.App.recarregar(); }
    });
  }

  /* Encontros e horas de cada disciplina no semestre, numa varredura só. */
  function usoNoSemestre() {
    var s = S.estado.semestre || {};
    var uso = {};
    if (!C.dataValida(s.inicio) || !C.dataValida(s.fim)) return uso;
    S.ocorrenciasIntervalo(s.inicio, s.fim).forEach(function (o) {
      if (!o.disciplinaId) return;
      var u = uso[o.disciplinaId] || (uso[o.disciplinaId] = { encontros: 0, horas: 0 });
      u.encontros++;
      u.horas += C.duracaoH(o.inicio, o.fim);
    });
    return uso;
  }

  function tabela(lista) {
    var podeEditar = S.pode('disciplinas.editar');
    var eu = S.usuario();
    var pos = vista === 'pos';
    if (!lista.length) {
      return U.vazio((pos ? 'Nenhuma especialização cadastrada.' : 'Nenhuma disciplina cadastrada.') +
        (podeEditar ? (pos ? ' Comece por "Nova especialização".' : ' Comece por "Nova disciplina".') : ''));
    }
    var uso = usoNoSemestre();
    var corpo = C.el('tbody');
    lista.forEach(function (d) {
      var profs = S.professoresDaDisciplina(d);
      var minha = !!eu && profs.indexOf(eu.id) !== -1;
      var u = uso[d.id] || { encontros: 0, horas: 0 };
      var reservas = S.reservasDaDisciplina(d.id);
      var celulas = [];
      if (!pos) celulas.push(C.el('td', { class: 'num', style: 'font-weight:600', text: d.codigo || '—' }));
      celulas.push(C.el('td', {}, [
        C.el('span', { text: d.nome }),
        minha ? C.el('span', { class: 'badge soft', style: 'margin-left:8px', text: 'sua' }) : null
      ]));
      celulas.push(C.el('td', { style: 'font-size:12.5px' }, profs.length
        ? profs.map(S.nomePessoa).join(', ')
        : C.el('span', { class: 'muted', text: 'nenhum — vincule em Acessos' })));
      celulas.push(C.el('td', { class: 'num', style: 'font-size:12.5px', text: u.encontros
        ? C.plural(u.encontros, 'encontro', 'encontros') + ' · ' + C.fmtHoras(u.horas)
        : (reservas.length ? 'só pedidos' : '—') }));
      celulas.push(C.el('td', { class: 'right', style: 'white-space:nowrap' }, [
        C.el('button', {
          class: 'btn-ghost', text: 'Ver no semestre',
          onclick: function () { global.App.ir('agenda', { disciplinaId: d.id }); }
        }),
        podeEditar ? C.el('button', {
          class: 'btn-ghost', style: 'margin-left:12px', text: 'Editar',
          onclick: function () { editar(d.id); }
        }) : null,
        podeEditar ? C.el('button', {
          class: 'btn-danger', style: 'margin-left:12px', text: 'Excluir',
          onclick: function () { confirmarExclusao(d); }
        }) : null
      ]));
      corpo.appendChild(C.el('tr', {}, celulas));
    });
    var cab = pos ? [] : [C.el('th', { text: 'Código' })];
    cab = cab.concat([
      C.el('th', { text: pos ? 'Especialização' : 'Nome' }),
      C.el('th', { text: 'Professores' }),
      C.el('th', { text: 'No semestre' }),
      C.el('th', { class: 'right', text: '' })
    ]);
    return C.el('div', {}, [
      C.el('div', { class: 'rolagem-x' }, C.el('table', { class: 'table' }, [
        C.el('thead', {}, C.el('tr', {}, cab)), corpo
      ])),
      C.el('p', { class: 'muted', style: 'font-size:12.5px;margin-top:16px;line-height:1.6', text:
        'A turma não é mais cadastrada: quem ocupa a clínica escreve a turma na "Descrição/Turma" da ocupação. ' +
        'O professor é vinculado às disciplinas dele na tela Acessos.' })
    ]);
  }

  /* ── Edição ───────────────────────────────────────────────────────── */
  function editar(id) {
    var d = id ? S.disciplina(id) : null;
    if (id && !d) { C.toast('Disciplina não encontrada.'); return; }
    var pos = d ? S.ehEspecializacao(d) : vista === 'pos';
    var f = { codigo: d ? (d.codigo || '') : '', nome: d ? d.nome : '' };
    var profs = d ? S.professoresDaDisciplina(d).map(S.nomePessoa) : [];
    var campos = pos
      ? [U.campo('Nome da especialização', C.el('input', {
        class: 'input', value: f.nome, placeholder: 'Ex.: Implantodontia',
        oninput: function (ev) { f.nome = ev.target.value; }
      }), 'é este nome que aparece na agenda — a turma vai na descrição de cada ocupação')]
      : [
        U.campo('Código', C.el('input', { class: 'input', value: f.codigo, placeholder: 'ODO-000',
          oninput: function (ev) { f.codigo = ev.target.value; } })),
        U.campo('Nome', C.el('input', { class: 'input', value: f.nome,
          oninput: function (ev) { f.nome = ev.target.value; } }))
      ];
    U.modal({
      titulo: id ? (pos ? 'Editar especialização' : 'Editar disciplina') : (pos ? 'Nova especialização' : 'Nova disciplina'),
      subtitulo: (pos ? 'Pós-graduação' : 'Graduação') + ' · semestre ' + S.estado.periodoLetivo,
      largura: '620px',
      conteudo: C.el('div', { class: 'stack', style: 'gap:16px' }, [
        C.el('div', { class: 'grid-fields' }, campos),
        C.el('div', { class: 'muted', style: 'font-size:12.5px;line-height:1.6', text:
          (profs.length ? 'Professores vinculados: ' + profs.join(', ') + '. ' : 'Nenhum professor vinculado. ') +
          'O vínculo é feito na tela Acessos, pessoa por pessoa.' })
      ]),
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Cancelar', onclick: U.fecharModal }),
        C.el('button', {
          class: 'btn btn-primary', text: 'Salvar',
          onclick: function () {
            if (!S.pode('disciplinas.editar')) { C.toast('Seu perfil não edita disciplinas.'); return; }
            if (pos) {
              if (!f.nome.trim()) { C.toast('Informe o nome da especialização.'); return; }
              if (!S.salvarEspecializacao(id, { nome: f.nome })) { C.toast('Não foi possível salvar a especialização.'); return; }
              U.fecharModal(); C.toast('Especialização salva.'); global.App.recarregar();
              return;
            }
            if (!f.codigo.trim() || !f.nome.trim()) { C.toast('Código e nome são obrigatórios.'); return; }
            S.salvarDisciplina(id, { codigo: f.codigo.trim(), nome: f.nome.trim(), nivel: 'graduacao' });
            U.fecharModal(); C.toast('Disciplina salva.'); global.App.recarregar();
          }
        })
      ]
    });
  }

  /* Sem cascata: disciplina com reserva não sai. O caminho é tirar as
     reservas pela agenda (exclusão reversível) ou deixá-las com a disciplina
     — nunca ficar com reserva apontando para o vazio. */
  function confirmarExclusao(d) {
    var reservas = S.reservasDaDisciplina(d.id);
    if (reservas.length) {
      C.toast(d.nome + ' tem ' + C.plural(reservas.length, 'reserva', 'reservas') +
        ' na agenda. Exclua-as pela Agenda antes de remover a disciplina.');
      return;
    }
    U.confirmar({
      titulo: S.ehEspecializacao(d) ? 'Excluir especialização' : 'Excluir disciplina',
      rotulo: 'Excluir', perigo: true,
      conteudo: C.el('span', {}, [C.el('b', { text: d.nome }), ' sai do cadastro. Não há como desfazer.'])
    }, function () {
      if (!S.pode('disciplinas.editar')) { C.toast('Seu perfil não exclui disciplinas.'); return; }
      S.excluirDisciplina(d.id);
      C.toast('Excluída.');
      global.App.recarregar();
    });
  }

  /* ── Limpeza do cadastro ──────────────────────────────────────────── */
  function avisoDeLimpeza() {
    var p = S.planoDeLimpeza();
    if (p.vazio) return null;
    var partes = [];
    if (p.unificar.length) {
      var n = 0;
      p.unificar.forEach(function (g) { n += g.membros.length; });
      partes.push(C.plural(n, 'disciplina com turma no nome', 'disciplinas com turma no nome'));
    }
    if (p.migrar.length) partes.push(C.plural(p.migrar.length, 'reserva antiga ligada a turma', 'reservas antigas ligadas a turma'));
    if (p.professores.length) partes.push(C.plural(p.professores.length, 'vínculo de professor herdado de turma', 'vínculos de professor herdados de turma'));
    return C.el('div', { class: 'alert', style: 'margin-bottom:20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap' }, [
      C.el('span', { style: 'flex:1 1 320px' }, [
        C.el('b', { text: 'O cadastro ainda carrega turma. ' }),
        partes.join(' · ') + '. A limpeza junta as disciplinas pelo nome, leva a turma para a ' +
        'descrição das reservas e grava o vínculo dos professores.'
      ]),
      C.el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Revisar e limpar', onclick: revisarLimpeza })
    ]);
  }

  function revisarLimpeza() {
    var p = S.planoDeLimpeza();
    if (p.vazio) { C.toast('Nada a limpar.'); return; }
    var marcadas = {};
    p.unificar.forEach(function (g) { marcadas[g.chave] = true; });

    var blocos = [];
    if (p.unificar.length) {
      blocos.push(C.el('div', {}, [
        C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:8px', text: 'Turma no nome → uma disciplina só' }),
        C.el('div', { class: 'stack', style: 'gap:8px' }, p.unificar.map(function (g) {
          var caixa = C.el('input', {
            type: 'checkbox', checked: true,
            onchange: function (ev) { marcadas[g.chave] = ev.target.checked; }
          });
          return C.el('label', { class: 'limpeza-item' }, [
            caixa,
            C.el('span', {}, [
              C.el('b', { text: g.membros.map(function (m) { return m.disciplina.nome; }).join(', ') }),
              ' → ', C.el('b', { text: g.base }),
              C.el('small', { class: 'muted', style: 'display:block', text:
                (g.nivel === 'pos' ? 'Pós-graduação' : 'Graduação') + ' · ' +
                (g.renomear ? 'renomeia "' + g.destino.nome + '"' : 'junta na "' + g.destino.nome + '" que já existe') +
                ' · ' + C.plural(g.reservas, 'reserva recebe', 'reservas recebem') + ' a turma (' +
                g.membros.map(function (m) { return m.turma; }).join(', ') + ') na descrição' })
            ])
          ]);
        }))
      ]));
    }
    if (p.migrar.length) {
      blocos.push(C.el('div', { class: 'muted', style: 'font-size:13px;line-height:1.6' }, [
        C.el('b', { text: C.plural(p.migrar.length, 'reserva antiga', 'reservas antigas') }),
        ' apontam para turma: passam a apontar para a disciplina da turma, com o professor dela e a turma escrita na descrição.'
      ]));
    }
    if (p.professores.length) {
      blocos.push(C.el('div', { class: 'muted', style: 'font-size:13px;line-height:1.6' }, [
        C.el('b', { text: C.plural(p.professores.length, 'disciplina', 'disciplinas') }),
        ' ganham gravado o vínculo de professor que vinha das turmas: ' +
        p.professores.map(function (d) { return d.nome; }).join(', ') + '.'
      ]));
    }
    blocos.push(C.el('p', { class: 'muted', style: 'font-size:12px;margin:0', text:
      'O cadastro de turmas não é apagado — fica sem uso. Se a gravação falhar no meio, rode a limpeza de novo: ela continua de onde parou.' }));

    U.modal({
      titulo: 'Limpar o cadastro de disciplinas',
      subtitulo: 'Revise antes de gravar — vale para todo mundo',
      largura: '720px',
      conteudo: C.el('div', { class: 'stack', style: 'gap:18px' }, blocos),
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Voltar', onclick: U.fecharModal }),
        C.el('button', {
          class: 'btn btn-primary', text: 'Limpar',
          onclick: function () {
            if (!S.pode('disciplinas.editar')) { C.toast('Seu perfil não edita disciplinas.'); return; }
            var chaves = Object.keys(marcadas).filter(function (k) { return marcadas[k]; });
            U.fecharModal();
            S.executarLimpeza(S.planoDeLimpeza(), chaves).then(function (r) {
              if (r && r.ok) {
                C.toast('Cadastro limpo · ' + C.plural(r.contagem.reservas, 'reserva atualizada', 'reservas atualizadas') +
                  ' · ' + C.plural(r.contagem.apagadas, 'disciplina unificada', 'disciplinas unificadas') + '.');
              }
              global.App.recarregar();
            });
          }
        })
      ]
    });
  }

  global.ViewDisciplinas = { render: render };
})(window);
