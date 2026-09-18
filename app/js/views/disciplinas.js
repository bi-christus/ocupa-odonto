/* views/disciplinas.js — disciplinas, turmas e vínculo de alunos.
   O antigo "professor responsável" passou a se chamar professor coordenador.
   Ocupação não aponta mais para uma clínica: é agrupamento + escopo
   ('a', 'b' ou 'ambas'), e quem traduz isso para texto é S.rotuloEscopo. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI;

  /* Guardadas entre redesenhos, mas nunca entre usuários: a validação de
     `render` exige que a turma escolhida esteja na lista visível de quem
     está na sessão — senão um coordenador que sai deixaria a turma dele
     aberta na tela do professor que entra. `vista` reseta sozinha porque
     'turmas' é sempre uma aba válida, então não precisa da mesma checagem. */
  var turmaSel = null;
  var vista = 'turmas';

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
       edita o vínculo de alunos de) as turmas dos colegas.
       A turma que o sistema mantém por trás de uma especialização da pós não
       entra aqui: ela não tem código para exibir, não recebe aluno e não é
       editável como turma — quem responde por ela é a aba Pós-graduação. */
    var lista = (u.perfil === 'professor' ? S.turmasDoProfessor(u.id) : e.turmas)
      .filter(function (t) { return !S.ehEspecializacao(S.disciplinaDaTurma(t)); });
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
          text: vista === 'turmas'
            ? C.plural(lista.length, 'turma', 'turmas') + ' · ' +
              C.plural(alunosVinculados, 'aluno vinculado', 'alunos vinculados')
            : vista === 'pos'
              ? C.plural(S.especializacoes().length, 'especialização cadastrada', 'especializações cadastradas')
              : C.plural(S.disciplinasDeGraduacao().length, 'disciplina cadastrada', 'disciplinas cadastradas') })
      ]),
      C.el('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap;align-items:center' }, [
        C.el('div', { class: 'seg' }, [
          aba('turmas', 'Turmas'), aba('disciplinas', 'Disciplinas'), aba('pos', 'Pós-graduação')
        ]),
        S.pode('disciplinas.editar') ? acoesDoCabecalho() : null
      ])
    ]));

    if (vista === 'pos') { alvo.appendChild(especializacoesLista()); return; }

    /* Aba de controle do cadastro: existe para editar ou excluir uma
       disciplina sem precisar ter (ou selecionar) uma turma dela — antes
       disso só dava para editar a disciplina de dentro do detalhe de uma
       turma já criada. */
    if (vista === 'disciplinas') { alvo.appendChild(disciplinasLista()); return; }

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

  /* O botão de criar é o da aba aberta: "Nova disciplina" na aba da pós
     ofereceria justamente o cadastro que a pós não tem. */
  function acoesDoCabecalho() {
    if (vista === 'pos') {
      return C.el('button', {
        class: 'btn btn-primary', text: 'Nova especialização',
        onclick: function () { editarEspecializacao(null); }
      });
    }
    return C.el('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap' }, [
      C.el('button', { class: 'btn btn-primary', text: 'Nova disciplina', onclick: function () { editarDisciplina(null); } }),
      C.el('button', { class: 'btn-ghost', text: 'Nova turma', onclick: function () { editarTurma(null); } })
    ]);
  }

  function aba(id, rotulo) {
    return C.el('button', {
      type: 'button', class: vista === id ? 'on' : '', text: rotulo,
      onclick: function () { vista = id; global.App.recarregar(); }
    });
  }

  /* ── Pós-graduação ────────────────────────────────────────────────────
     A pós não trabalha com código de disciplina nem com identificador de
     turma: uma especialização é o nome dela e quem responde por ela. É só
     isso que este cadastro pede. A turma que o sistema cria por trás — para
     a reserva recorrente ter a quem apontar — não aparece em lugar nenhum
     desta tela, nem precisa. */
  function especializacoesLista() {
    var podeEditar = S.pode('disciplinas.editar');
    var lista = S.especializacoes();

    var nota = C.el('div', { class: 'alert', style: 'margin-bottom:18px', text:
      'Cada especialização é cadastrada pelo nome e pelo professor responsável — ' +
      'sem código, sem turma e sem vínculo de alunos. A partir do cadastro ela já pode ' +
      'ocupar clínica pela aba Agenda, e o responsável é quem pode cancelar as reservas dela.' });

    if (!lista.length) {
      return C.el('div', {}, [nota, U.vazio('Nenhuma especialização cadastrada.' +
        (podeEditar ? ' Comece por "Nova especialização".' : ''))]);
    }

    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, [
        C.el('th', { text: 'Especialização' }), C.el('th', { text: 'Professor responsável' }),
        C.el('th', { text: 'Na agenda' }), C.el('th', { class: 'right', text: '' })
      ]))
    ]);
    var corpo = C.el('tbody');
    lista.forEach(function (d) {
      var t = S.turmaDaEspecializacao(d.id);
      corpo.appendChild(C.el('tr', {}, [
        C.el('td', {}, C.el('b', { text: d.nome })),
        C.el('td', { text: t ? S.nomePessoa(t.professorCoordenadorId) : '—' }),
        C.el('td', { style: 'font-size:12.5px' }, agendaDaEspecializacao(t)),
        C.el('td', { class: 'right', style: 'white-space:nowrap' }, podeEditar ? [
          C.el('button', { class: 'btn-ghost', text: 'Editar', onclick: function () { editarEspecializacao(d.id); } }),
          C.el('button', {
            class: 'btn-danger', style: 'margin-left:12px', text: 'Excluir',
            onclick: function () { confirmarExclusaoEspecializacao(d); }
          })
        ] : null)
      ]));
    });
    tabela.appendChild(corpo);
    return C.el('div', {}, [nota, C.el('div', { class: 'rolagem-x' }, tabela)]);
  }

  /* Carga semanal da especialização: encontros por semana e horas, somando
     as recorrências ativas. É o número que diz se a especialização está de
     fato usando a clínica ou só cadastrada. */
  function agendaDaEspecializacao(t) {
    if (!t) return C.el('span', { class: 'muted', text: 'sem turma — salve de novo' });
    var encontros = 0, horas = 0;
    S.recorrenciasAtivas().forEach(function (r) {
      if (r.turmaId !== t.id) return;
      encontros += r.dias.length;
      horas += C.duracaoH(r.inicio, r.fim) * r.dias.length;
    });
    if (!encontros) return C.el('span', { class: 'muted', text: 'sem reserva recorrente' });
    return C.el('span', { text: C.plural(encontros, 'encontro', 'encontros') +
      '/semana · ' + C.fmtHoras(horas) });
  }

  function editarEspecializacao(id) {
    var e = S.estado;
    var d = id ? S.disciplina(id) : null;
    if (id && !S.ehEspecializacao(d)) { C.toast('Especialização não encontrada.'); return; }
    var professores = e.usuarios.filter(function (x) {
      return x.ativo && (x.perfil === 'professor' || x.perfil === 'coordenador');
    });
    if (!professores.length) {
      C.toast('Nenhum professor ou coordenador ativo para responder pela especialização.');
      return;
    }
    var f = {
      nome: d ? d.nome : '',
      professorResponsavelId: (id && S.professorDaEspecializacao(id)) || professores[0].id
    };
    U.modal({
      titulo: id ? 'Editar especialização' : 'Nova especialização',
      subtitulo: 'Pós-graduação · semestre ' + e.periodoLetivo,
      largura: '620px',
      conteudo: C.el('div', { class: 'stack', style: 'gap:16px' }, [
        U.campo('Nome da especialização', C.el('input', {
          class: 'input', value: f.nome, placeholder: 'Ex.: Implantodontia',
          oninput: function (ev) { f.nome = ev.target.value; }
        }), 'é este nome que aparece na agenda das clínicas'),
        U.campo('Professor responsável', U.selecao(professores.map(function (p) {
          return { valor: p.id, rotulo: p.nome + ' · ' + global.Acesso.nomePerfil(p.perfil) };
        }), f.professorResponsavelId, function (v) { f.professorResponsavelId = v; }),
          'responde pelas reservas da especialização e pode cancelá-las')
      ]),
      acoes: [
        id ? C.el('button', {
          class: 'btn-danger', style: 'margin-right:auto', text: 'Excluir especialização',
          onclick: function () { U.fecharModal(); confirmarExclusaoEspecializacao(d); }
        }) : null,
        C.el('button', { class: 'btn btn-outline', text: 'Cancelar', onclick: U.fecharModal }),
        C.el('button', {
          class: 'btn btn-primary', text: 'Salvar',
          onclick: function () {
            if (!f.nome.trim()) { C.toast('Informe o nome da especialização.'); return; }
            if (!S.pode('disciplinas.editar')) { C.toast('Seu perfil não cadastra especializações.'); return; }
            var salva = S.salvarEspecializacao(id, {
              nome: f.nome, professorResponsavelId: f.professorResponsavelId
            });
            if (!salva) { C.toast('Não foi possível salvar a especialização.'); return; }
            U.fecharModal(); C.toast('Especialização salva.'); global.App.recarregar();
          }
        })
      ]
    });
  }

  /* Diferente da disciplina da graduação, aqui a exclusão é em cascata — a
     especialização não tem turmas que alguém possa reatribuir antes. Por
     isso o aviso precisa dizer, com todas as letras, que a agenda dela vai
     junto. */
  function confirmarExclusaoEspecializacao(d) {
    var t = S.turmaDaEspecializacao(d.id);
    var regras = t ? S.recorrenciasAtivas().filter(function (r) { return r.turmaId === t.id; }).length : 0;
    U.confirmar({
      titulo: 'Excluir especialização', rotulo: 'Excluir', perigo: true,
      conteudo: C.el('div', {}, [
        C.el('span', {}, ['A especialização ', C.el('b', { text: d.nome }), ' sai do cadastro.']),
        regras ? C.el('p', { style: 'margin:10px 0 0', text:
          C.plural(regras, 'reserva recorrente sai', 'reservas recorrentes saem') +
          ' da agenda junto, liberando os horários. Não há como desfazer.' })
          : C.el('p', { class: 'muted', style: 'margin:10px 0 0', text: 'Não há como desfazer.' })
      ])
    }, function () {
      if (!S.pode('disciplinas.editar')) { C.toast('Seu perfil não exclui especializações.'); return; }
      S.excluirEspecializacao(d.id);
      C.toast('Especialização excluída.');
      global.App.recarregar();
    });
  }

  /* ── Cadastro de disciplinas ──────────────────────────────────────────
     Independente de turma: é aqui que dá para editar ou excluir uma
     disciplina logo depois de criá-la, sem esperar existir turma alguma —
     e é essa lista que alimenta o dropdown "Disciplina" do formulário de
     turma, então mantê-la limpa mantém o dropdown limpo. */
  function disciplinasLista() {
    var e = S.estado;
    var podeEditar = S.pode('disciplinas.editar');
    var disciplinas = S.disciplinasDeGraduacao();
    if (!disciplinas.length) {
      return U.vazio('Nenhuma disciplina cadastrada.' +
        (podeEditar ? ' Comece por "Nova disciplina".' : ''));
    }
    var turmasPorDisciplina = {};
    e.turmas.forEach(function (t) {
      turmasPorDisciplina[t.disciplinaId] = (turmasPorDisciplina[t.disciplinaId] || 0) + 1;
    });

    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, [
        C.el('th', { text: 'Código' }), C.el('th', { text: 'Nome' }),
        C.el('th', { text: 'Turmas' }), C.el('th', { class: 'right', text: '' })
      ]))
    ]);
    var corpo = C.el('tbody');
    disciplinas.slice().sort(function (a, b) {
      return String(a.codigo).localeCompare(String(b.codigo), 'pt-BR');
    }).forEach(function (d) {
      var vinculadas = turmasPorDisciplina[d.id] || 0;
      corpo.appendChild(C.el('tr', {}, [
        C.el('td', { text: d.codigo }),
        C.el('td', { text: d.nome }),
        C.el('td', { class: 'num', text: String(vinculadas) }),
        C.el('td', { class: 'right', style: 'white-space:nowrap' }, podeEditar ? [
          C.el('button', { class: 'btn-ghost', text: 'Editar', onclick: function () { editarDisciplina(d.id); } }),
          C.el('button', {
            class: 'btn-danger', style: 'margin-left:12px', text: 'Excluir',
            onclick: function () { confirmarExclusaoDisciplina(d, vinculadas); }
          })
        ] : null)
      ]));
    });
    tabela.appendChild(corpo);
    return C.el('div', { class: 'rolagem-x' }, tabela);
  }

  /* Sem cascata: excluir aqui não mexe em turmas. Com vínculo, a exclusão
     fica bloqueada — o caminho é excluir ou reatribuir as turmas primeiro,
     nunca deixar uma turma apontando para uma disciplina que sumiu. */
  function confirmarExclusaoDisciplina(d, vinculadas) {
    if (vinculadas > 0) {
      C.toast(d.nome + ' tem ' + C.plural(vinculadas, 'turma vinculada', 'turmas vinculadas') +
        '. Exclua ou reatribua antes de remover a disciplina.');
      return;
    }
    U.confirmar({
      titulo: 'Excluir disciplina', rotulo: 'Excluir', perigo: true,
      conteudo: C.el('span', {}, ['A disciplina ', C.el('b', { text: d.nome }), ' sai do cadastro. Não há como desfazer.'])
    }, function () {
      S.excluirDisciplina(d.id);
      C.toast('Disciplina excluída.');
      global.App.recarregar();
    });
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
        C.el('small', { text: S.nomePessoa(t.professorCoordenadorId) })
      ]);
    }));
  }

  function detalhe() {
    var t = S.turma(turmaSel), d = S.disciplinaDaTurma(t);
    var horas = 0, encontros = 0;
    /* Quais clínicas a turma toca: a recorrência guarda agrupamento +
       escopo, então quem abre isso em clínicas é o Store. */
    var usadas = {};
    S.recorrenciasAtivas().forEach(function (r) {
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
            text: d ? d.codigo + ' · turma ' + t.codigo : 'turma ' + t.codigo })
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
    /* Pelos seletores do store: fora o que foi excluído e o pedido que a
       coordenação ainda não aprovou. Listar pendente aqui faria a turma
       parecer ter aula que ninguém confirmou. */
    var regras = S.recorrenciasAtivas().filter(function (r) { return r.turmaId === t.id; });
    var pontuais = S.pontuaisAtivas().filter(function (p) { return p.turmaId === t.id; });
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
        /* Derivado do escopo: `cadeiras` não é mais gravado no documento, e
           ler o campo cru mostraria "undefined" nas ocupações novas. */
        C.el('td', { class: 'num', text: String(S.capacidadeEscopo(r.agrupamentoId, r.escopo)) })
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
        /* `titulo` e `cadeiras` também são derivados agora. */
        C.el('td', { text: C.fmtDiaAno(p.data) + ' · ' + S.rotuloPedido(p) }),
        C.el('td', { class: 'num', text: p.inicio + '–' + p.fim }),
        C.el('td', { class: 'num', text: String(S.capacidadeEscopo(p.agrupamentoId, p.escopo)) })
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
    if (!d) d = { codigo: '', nome: '' };
    var f = { codigo: d.codigo, nome: d.nome };
    U.modal({
      titulo: id ? 'Editar disciplina' : 'Nova disciplina',
      largura: '620px',
      conteudo: C.el('div', { class: 'grid-fields' }, [
        U.campo('Código', C.el('input', { class: 'input', value: f.codigo, placeholder: 'ODO-000',
          oninput: function (ev) { f.codigo = ev.target.value; } })),
        U.campo('Nome', C.el('input', { class: 'input', value: f.nome,
          oninput: function (ev) { f.nome = ev.target.value; } }))
      ]),
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Cancelar', onclick: U.fecharModal }),
        C.el('button', {
          class: 'btn btn-primary', text: 'Salvar',
          onclick: function () {
            if (!f.codigo.trim() || !f.nome.trim()) { C.toast('Código e nome são obrigatórios.'); return; }
            var limpo = { codigo: f.codigo.trim(), nome: f.nome.trim() };
            S.salvarDisciplina(id, limpo);
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
       isso vale mais do que estourar em disciplinas[0] / professores[0].
       Só disciplina da graduação: especialização da pós tem a turma que o
       sistema mantém, e criar uma segunda por aqui quebraria a premissa de
       turma única em que o cadastro da pós se apoia. */
    var disciplinas = S.disciplinasDeGraduacao();
    if (!disciplinas.length) { C.toast('Cadastre uma disciplina antes de criar a turma.'); return; }
    var professores = e.usuarios.filter(function (x) {
      return x.ativo && (x.perfil === 'professor' || x.perfil === 'coordenador');
    });
    if (!professores.length) { C.toast('Nenhum professor ou coordenador ativo para coordenar a turma.'); return; }
    if (!t) t = { disciplinaId: disciplinas[0].id, codigo: 'T1', professorCoordenadorId: null };
    var f = {
      disciplinaId: t.disciplinaId, codigo: t.codigo,
      professorCoordenadorId: t.professorCoordenadorId || professores[0].id
    };
    U.modal({
      titulo: id ? 'Editar turma' : 'Nova turma',
      largura: '620px',
      conteudo: C.el('div', { class: 'grid-fields' }, [
        U.campo('Disciplina', U.selecao(disciplinas.map(function (d) {
          return { valor: d.id, rotulo: d.codigo + ' · ' + d.nome };
        }), f.disciplinaId, function (v) { f.disciplinaId = v; })),
        U.campo('Turma', C.el('input', { class: 'input', value: f.codigo, placeholder: 'T1',
          oninput: function (ev) { f.codigo = ev.target.value; } })),
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
            if (!f.codigo.trim()) { C.toast('Informe o identificador da turma.'); return; }
            var salva = S.salvarTurma(id, { disciplinaId: f.disciplinaId, codigo: f.codigo.trim(),
              professorCoordenadorId: f.professorCoordenadorId });
            turmaSel = salva ? salva.id : null;
            U.fecharModal(); C.toast('Turma salva.'); global.App.recarregar();
          }
        })
      ]
    });
  }

  global.ViewDisciplinas = { render: render };
})(window);
