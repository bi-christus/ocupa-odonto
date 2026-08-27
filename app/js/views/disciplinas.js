/* views/disciplinas.js — disciplinas, turmas e vínculo de alunos.
   O antigo "professor responsável" passou a se chamar professor coordenador.
   Ocupação não aponta mais para uma clínica: é agrupamento + escopo
   ('a', 'b' ou 'ambas'), e quem traduz isso para texto é S.rotuloEscopo. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, D = global.Dados;

  /* Guardada entre redesenhos, mas nunca entre usuários: a validação de
     `render` exige que a turma escolhida esteja na lista visível de quem
     está na sessão — senão um coordenador que sai deixaria a turma dele
     aberta na tela do professor que entra. */
  var turmaSel = null;

  function naLista(lista, id) {
    for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return true;
    return false;
  }

  /* `encerradaEm` é o PRIMEIRO dia inválido: o último encontro que existe é
     o da véspera. Toda contagem desta tela usa o menor entre ele e a
     vigência declarada. */
  function fimEfetivo(r) {
    var ultimo = r.encerradaEm ? C.addDays(r.encerradaEm, -1) : null;
    return ultimo && ultimo < r.vigenciaFim ? ultimo : r.vigenciaFim;
  }
  function temExcecao(r, data) {
    for (var i = 0; i < r.excecoes.length; i++) if (r.excecoes[i].data === data) return true;
    return false;
  }
  function encontrosDaRegra(r) {
    var fim = fimEfetivo(r);
    if (!fim || r.vigenciaInicio > fim) return 0;
    return S.datasDaRegra(r.dias, r.vigenciaInicio, fim).filter(function (d) {
      return !temExcecao(r, d);
    }).length;
  }

  function render(alvo) {
    if (!S.pode('disciplinas.ver')) { alvo.appendChild(U.semPermissao()); return; }
    var e = S.estado;
    var u = S.usuario();
    /* Sem fallback: professor sem turma sob coordenação não enxerga (nem
       edita o vínculo de alunos de) as turmas dos colegas. */
    var lista = u.perfil === 'professor' ? S.turmasDoProfessor(u.id) : e.turmas;
    if (!turmaSel || !naLista(lista, turmaSel)) turmaSel = lista.length ? lista[0].id : null;

    var vistos = {}, alunosVinculados = 0;
    lista.forEach(function (t) {
      t.alunos.forEach(function (id) {
        if (!vistos[id]) { vistos[id] = true; alunosVinculados++; }
      });
    });

    alvo.appendChild(C.el('div', { class: 'page-head' }, [
      C.el('div', {}, [
        C.el('h2', { text: 'Disciplinas · ' + e.periodoLetivo }),
        C.el('div', { class: 'muted', style: 'font-size:13.5px;margin-top:6px',
          text: C.plural(lista.length, 'turma', 'turmas') + ' · ' +
            C.plural(alunosVinculados, 'aluno vinculado', 'alunos vinculados') })
      ]),
      S.pode('disciplinas.editar') ? C.el('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap' }, [
        C.el('button', { class: 'btn-ghost', text: 'Nova turma', onclick: function () { editarTurma(null); } }),
        C.el('button', { class: 'btn btn-primary', text: 'Nova disciplina', onclick: function () { editarDisciplina(null); } })
      ]) : null
    ]));

    /* Estado vazio no lugar da grade inteira, com o motivo certo: para o
       professor a lista está vazia porque ele não coordena nada; para a
       coordenação porque não há turma cadastrada. */
    if (!turmaSel) {
      alvo.appendChild(U.vazio(u.perfil === 'professor'
        ? 'Nenhuma turma sob sua coordenação. Fale com a coordenação para ser vinculado a uma turma.'
        : 'Nenhuma turma cadastrada. Comece por "Nova disciplina" e depois crie a turma.'));
      return;
    }

    /* Larguras em flex-basis, não em coluna fixa: em tela estreita as duas
       colunas quebram uma sob a outra em vez de empurrar a página. */
    alvo.appendChild(C.el('div', {
      style: 'display:flex;flex-wrap:wrap;align-items:flex-start;gap:24px 36px'
    }, [
      C.el('div', { style: 'flex:1 1 288px;min-width:0' }, listaTurmas(lista)),
      C.el('div', { style: 'flex:999 1 420px;min-width:0' }, detalhe())
    ]));
  }

  function listaTurmas(lista) {
    return C.el('div', {}, lista.map(function (t) {
      var d = S.disciplinaDaTurma(t);
      return C.el('button', {
        class: 'list-btn' + (turmaSel === t.id ? ' on' : ''),
        onclick: function () { turmaSel = t.id; global.App.recarregar(); }
      }, [
        C.el('div', { class: 'row', style: 'gap:8px;justify-content:space-between' }, [
          C.el('span', { class: 'row', style: 'gap:8px' }, [
            C.el('span', { class: 'num', style: 'font:600 13.5px var(--font-heading);letter-spacing:.04em',
              text: d ? d.codigo : '—' }),
            C.el('span', { class: 'badge ' + (turmaSel === t.id ? 'strong' : 'neutral'), text: t.codigo })
          ]),
          C.el('small', { text: C.plural(t.alunos.length, 'aluno', 'alunos') })
        ]),
        C.el('div', { style: 'font-size:13.5px', text: d ? d.nome : 'Disciplina removida' }),
        C.el('small', { text: S.nomePessoa(t.professorCoordenadorId) + (d ? ' · ' + d.especialidade : '') })
      ]);
    }));
  }

  function detalhe() {
    var t = S.turma(turmaSel), d = S.disciplinaDaTurma(t);
    var horas = 0, encontros = 0;
    /* Quais clínicas a turma toca: a recorrência guarda agrupamento +
       escopo, então quem abre isso em clínicas é o Store. */
    var usadas = {};
    S.estado.recorrencias.forEach(function (r) {
      if (r.turmaId !== t.id) return;
      var n = encontrosDaRegra(r);
      encontros += n; horas += n * C.duracaoH(r.inicio, r.fim);
      S.idsDoEscopo(r.agrupamentoId, r.escopo).forEach(function (cid) { usadas[cid] = true; });
    });
    var clinicasUsadas = S.estado.clinicas.filter(function (c) { return !!usadas[c.id]; })
      .map(function (c) { return c.nome; });

    var caixa = C.el('div');

    caixa.appendChild(C.el('div', { class: 'card', style: 'margin-bottom:30px' }, [
      C.el('div', { class: 'row', style: 'gap:12px;justify-content:space-between;flex-wrap:wrap' }, [
        C.el('div', { style: 'min-width:0' }, [
          C.el('h3', { text: d ? d.nome : 'Disciplina removida' }),
          C.el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px',
            text: d ? d.codigo + ' · turma ' + t.codigo + ' · ' + d.cargaHoraria + ' h · ' + d.especialidade
                    : 'turma ' + t.codigo })
        ]),
        S.pode('disciplinas.editar') ? C.el('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap' }, [
          d ? C.el('button', { class: 'btn-ghost', text: 'Editar disciplina', onclick: function () { editarDisciplina(d.id); } }) : null,
          C.el('button', { class: 'btn-ghost', text: 'Editar turma', onclick: function () { editarTurma(t.id); } })
        ]) : null
      ]),
      C.el('div', { class: 'grid-fields', style: 'margin-top:20px;gap:0 26px' }, [
        info('Professor coordenador', S.nomePessoa(t.professorCoordenadorId)),
        info('Clínicas em uso', clinicasUsadas.length
          ? clinicasUsadas.join(' · ') : 'sem horário lançado'),
        info('Encontros no semestre', String(encontros)),
        info('Carga na agenda', C.fmtHoras(horas)),
        info('Alunos vinculados', String(t.alunos.length))
      ])
    ]));

    caixa.appendChild(horarios(t));
    caixa.appendChild(alunos(t));
    return caixa;
  }

  function info(rotulo, valor) {
    return C.el('div', { style: 'padding:6px 0' }, [
      C.el('div', { class: 'eyebrow', text: rotulo }),
      C.el('div', { style: 'font-size:14px;margin-top:4px', text: valor })
    ]);
  }

  function horarios(t) {
    var regras = S.estado.recorrencias.filter(function (r) { return r.turmaId === t.id; });
    var pontuais = S.estado.pontuais.filter(function (p) { return p.turmaId === t.id; });
    var caixa = C.el('div', { style: 'margin-bottom:34px' }, C.el('h5', { text: 'Horários', style: 'margin-bottom:14px' }));

    if (!regras.length && !pontuais.length) {
      caixa.appendChild(U.vazio('Nenhum horário lançado para esta turma.'));
      return caixa;
    }
    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, [
        C.el('th', { text: 'Tipo' }), C.el('th', { text: 'Onde' }),
        C.el('th', { text: 'Quando' }), C.el('th', { text: 'Horário' }),
        C.el('th', { text: 'Cadeiras' })
      ]))
    ]);
    var corpo = C.el('tbody');
    regras.forEach(function (r) {
      corpo.appendChild(C.el('tr', {}, [
        C.el('td', { style: 'width:104px' }, C.el('span', { class: 'badge neutral', text: 'Recorrente' })),
        C.el('td', {}, [
          C.el('span', { text: S.rotuloEscopo(r.agrupamentoId, r.escopo) }),
          r.escopo === 'ambas'
            ? C.el('span', { class: 'badge conjunta', style: 'margin-left:8px', text: 'Conjunta' })
            : null
        ]),
        C.el('td', { text: C.listaDias(r.dias) + ' · até ' + C.fmtDia(fimEfetivo(r)) }),
        C.el('td', { class: 'num', text: r.inicio + '–' + r.fim }),
        C.el('td', { class: 'num', text: String(r.cadeiras) })
      ]));
    });
    pontuais.forEach(function (p) {
      corpo.appendChild(C.el('tr', {}, [
        C.el('td', {}, C.el('span', { class: 'badge soft', text: 'Pontual' })),
        C.el('td', {}, [
          C.el('span', { text: S.rotuloEscopo(p.agrupamentoId, p.escopo) }),
          p.escopo === 'ambas'
            ? C.el('span', { class: 'badge conjunta', style: 'margin-left:8px', text: 'Conjunta' })
            : null
        ]),
        C.el('td', { text: C.fmtDiaAno(p.data) + ' · ' + p.titulo }),
        C.el('td', { class: 'num', text: p.inicio + '–' + p.fim }),
        C.el('td', { class: 'num', text: String(p.cadeiras) })
      ]));
    });
    tabela.appendChild(corpo);
    caixa.appendChild(C.el('div', { class: 'rolagem-x' }, tabela));
    return caixa;
  }

  /* ── Alunos ───────────────────────────────────────────────────────── */
  function alunos(t) {
    var caixa = C.el('div');
    var podeEditar = S.pode('alunos.vincular');

    caixa.appendChild(C.el('div', {
      style: 'display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:14px'
    }, [
      C.el('h5', { text: 'Alunos' }),
      podeEditar ? formVincular(t) : null
    ]));

    if (!t.alunos.length) { caixa.appendChild(U.vazio('Nenhum aluno vinculado.')); return caixa; }

    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, [
        C.el('th', { text: 'Aluno' }), C.el('th', { text: 'Matrícula' }),
        C.el('th', { text: 'Período' }), C.el('th', { class: 'right', text: '' })
      ]))
    ]);
    var corpo = C.el('tbody');
    t.alunos.map(S.aluno).filter(Boolean).sort(function (a, b) {
      return a.nome.localeCompare(b.nome, 'pt-BR');
    }).forEach(function (a) {
      corpo.appendChild(C.el('tr', {}, [
        C.el('td', { text: a.nome }),
        C.el('td', { class: 'num', text: a.matricula }),
        C.el('td', { text: a.periodo + 'º período' }),
        C.el('td', { class: 'right' }, podeEditar ? C.el('button', {
          class: 'btn-danger', text: 'Remover',
          onclick: function () {
            S.desvincularAluno(t.id, a.id);
            /* Impessoal: o cadastro não guarda gênero, então nem
               "vinculado" nem "vinculada" seriam sempre corretos. */
            C.toast('Vínculo removido · ' + a.nome + '.');
            global.App.recarregar();
          }
        }) : null)
      ]));
    });
    tabela.appendChild(corpo);
    caixa.appendChild(C.el('div', { class: 'rolagem-x' }, tabela));
    return caixa;
  }

  function alunoPorMatricula(matricula) {
    var achado = null;
    S.estado.alunos.forEach(function (x) { if (x.matricula === matricula) achado = x; });
    return achado;
  }
  function mesmoNome(a, b) {
    return String(a).replace(/\s+/g, ' ').trim().toLowerCase() ===
           String(b).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function aplicarVinculo(t, dados) {
    var a = S.vincularAluno(t.id, dados);
    if (!a) { C.toast('Turma não encontrada.'); return; }
    /* O nome que vale é sempre o do cadastro, não o que foi digitado: se a
       matrícula já existia, o Store reaproveita o aluno preexistente. */
    C.toast('Vínculo criado · ' + a.nome + '.');
    global.App.recarregar();
  }

  function formVincular(t) {
    var dados = { nome: '', matricula: '', periodo: 6 };
    var bNome = C.el('input', { class: 'input', type: 'text', placeholder: 'Nome do aluno',
      style: 'width:180px;max-width:100%',
      oninput: function (ev) { dados.nome = ev.target.value; } });
    var bMat = C.el('input', { class: 'input', type: 'text', placeholder: String(new Date().getFullYear()) + '1234',
      style: 'width:120px;max-width:100%',
      oninput: function (ev) { dados.matricula = ev.target.value; } });
    /* Campos em flex com quebra: em tela estreita a linha se desmonta em
       vez de estourar a largura do bloco. */
    return C.el('div', { style: 'display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px' }, [
      U.campo('Nome', bNome),
      U.campo('Matrícula', bMat),
      U.campo('Período', U.selecao([6, 7, 8, 9, 10].map(function (p) {
        return { valor: String(p), rotulo: p + 'º período' };
      }), '6', function (v) { dados.periodo = Number(v); }, { style: 'width:130px' })),
      C.el('button', {
        class: 'btn btn-primary', text: 'Vincular',
        onclick: function () {
          var limpo = {
            nome: dados.nome.replace(/\s+/g, ' ').trim(),
            matricula: dados.matricula.trim(),
            periodo: dados.periodo
          };
          if (!limpo.nome || !limpo.matricula) { C.toast('Informe nome e matrícula.'); return; }

          var existente = alunoPorMatricula(limpo.matricula);
          if (existente && t.alunos.indexOf(existente.id) !== -1) {
            C.toast(existente.nome + ' já está vinculado a esta turma.');
            return;
          }
          /* Matrícula repetida com outro nome: o Store descarta o nome e o
             período digitados e vincula quem já está no cadastro. Isso
             precisa ser dito antes, não descoberto na tabela depois. */
          if (existente && !mesmoNome(existente.nome, limpo.nome)) {
            U.confirmar({
              titulo: 'Matrícula já cadastrada',
              rotulo: 'Vincular ' + C.primeiroNome(existente.nome),
              texto: 'A matrícula ' + limpo.matricula + ' já pertence a ' + existente.nome +
                ' (' + existente.periodo + 'º período). O nome digitado, ' + limpo.nome +
                ', será descartado e quem entra na turma é ' + existente.nome +
                '. Se não for a mesma pessoa, corrija a matrícula.'
            }, function () { aplicarVinculo(t, limpo); });
            return;
          }
          aplicarVinculo(t, limpo);
        }
      })
    ]);
  }

  /* ── Edição ───────────────────────────────────────────────────────── */
  function editarDisciplina(id) {
    var d = id ? S.disciplina(id) : null;
    if (id && !d) { C.toast('Disciplina não encontrada.'); return; }
    if (!d) d = { codigo: '', nome: '', especialidade: D.ESPECIALIDADES[0], cargaHoraria: 60 };
    var f = { codigo: d.codigo, nome: d.nome, especialidade: d.especialidade, cargaHoraria: d.cargaHoraria };
    U.modal({
      titulo: id ? 'Editar disciplina' : 'Nova disciplina',
      largura: '620px',
      conteudo: C.el('div', { class: 'grid-fields' }, [
        U.campo('Código', C.el('input', { class: 'input', value: f.codigo, placeholder: 'ODO-000',
          oninput: function (ev) { f.codigo = ev.target.value; } })),
        U.campo('Nome', C.el('input', { class: 'input', value: f.nome,
          oninput: function (ev) { f.nome = ev.target.value; } })),
        U.campo('Especialidade', U.selecao(D.ESPECIALIDADES.map(function (x) {
          return { valor: x, rotulo: x };
        }), f.especialidade, function (v) { f.especialidade = v; })),
        U.campo('Carga horária', C.el('input', { class: 'input', type: 'number', min: '1', value: f.cargaHoraria,
          oninput: function (ev) { f.cargaHoraria = Number(ev.target.value); } }))
      ]),
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Cancelar', onclick: U.fecharModal }),
        C.el('button', {
          class: 'btn btn-primary', text: 'Salvar',
          onclick: function () {
            if (!f.codigo.trim() || !f.nome.trim()) { C.toast('Código e nome são obrigatórios.'); return; }
            if (!(f.cargaHoraria > 0)) { C.toast('Informe uma carga horária maior que zero.'); return; }
            S.salvarDisciplina(id, f);
            U.fecharModal(); C.toast('Disciplina salva.'); global.App.recarregar();
          }
        })
      ]
    });
  }

  function editarTurma(id) {
    var e = S.estado;
    var t = id ? S.turma(id) : null;
    if (id && !t) { C.toast('Turma não encontrada.'); return; }
    /* Sem disciplina ou sem professor ativo não há turma possível — dizer
       isso vale mais do que estourar em disciplinas[0] / professores[0]. */
    if (!e.disciplinas.length) { C.toast('Cadastre uma disciplina antes de criar a turma.'); return; }
    var professores = e.usuarios.filter(function (x) {
      return x.ativo && (x.perfil === 'professor' || x.perfil === 'coordenador');
    });
    if (!professores.length) { C.toast('Nenhum professor ou coordenador ativo para coordenar a turma.'); return; }
    if (!t) t = { disciplinaId: e.disciplinas[0].id, codigo: 'T1', professorCoordenadorId: null };
    var f = {
      disciplinaId: t.disciplinaId, codigo: t.codigo,
      professorCoordenadorId: t.professorCoordenadorId || professores[0].id
    };
    U.modal({
      titulo: id ? 'Editar turma' : 'Nova turma',
      largura: '620px',
      conteudo: C.el('div', { class: 'grid-fields' }, [
        U.campo('Disciplina', U.selecao(e.disciplinas.map(function (d) {
          return { valor: d.id, rotulo: d.codigo + ' · ' + d.nome };
        }), f.disciplinaId, function (v) { f.disciplinaId = v; })),
        U.campo('Turma', U.selecao(['T1', 'T2', 'T3', 'T4'].map(function (x) {
          return { valor: x, rotulo: x };
        }), f.codigo, function (v) { f.codigo = v; })),
        U.campo('Professor coordenador', U.selecao(professores.map(function (p) {
          return { valor: p.id, rotulo: p.nome };
        }), f.professorCoordenadorId, function (v) { f.professorCoordenadorId = v; }))
      ]),
      acoes: [
        id && S.pode('disciplinas.editar') ? C.el('button', {
          class: 'btn-danger', style: 'margin-right:auto', text: 'Excluir turma',
          onclick: function () {
            U.fecharModal();
            U.confirmar({
              titulo: 'Excluir turma', rotulo: 'Excluir', perigo: true,
              texto: 'A turma e todas as suas recorrências saem da agenda. Não há como desfazer.'
            }, function () {
              S.excluirTurma(id); turmaSel = null;
              C.toast('Turma excluída.'); global.App.recarregar();
            });
          }
        }) : null,
        C.el('button', { class: 'btn btn-outline', text: 'Cancelar', onclick: U.fecharModal }),
        C.el('button', {
          class: 'btn btn-primary', text: 'Salvar',
          onclick: function () {
            var salva = S.salvarTurma(id, f);
            turmaSel = salva ? salva.id : null;
            U.fecharModal(); C.toast('Turma salva.'); global.App.recarregar();
          }
        })
      ]
    });
  }

  global.ViewDisciplinas = { render: render };
})(window);
