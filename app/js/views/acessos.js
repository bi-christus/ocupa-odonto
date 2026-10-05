/* views/acessos.js — quem tem acesso ao sistema, e o que cada nível pode.

   Esta tela já foi só de consulta, e por um bom motivo: enquanto a lista
   morava no navegador, conceder acesso por aqui não liberava ninguém.

   Com a lista no Firestore isso mudou — o que é gravado aqui vale para todo
   mundo, imediatamente. A concessão voltou. Quem garante que só o
   coordenador escreve são as Security Rules: a interface esconde o botão,
   mas é o servidor que recusa.

   Desde 05/10/2026 é também aqui que o professor é ligado às DISCIPLINAS
   dele — o vínculo que antes passava pela turma com código. Ele é gravado
   na disciplina (`professores`), não no documento de `autorizados`: a regra
   de `autorizados` é por campo, e a de `disciplinas` já é da coordenação. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, A = global.Acesso;

  var vista = 'pessoas';

  /* A lista vem do Firestore, já hidratada pelo store — `perfil` aqui é o
     campo `nivel` do documento. */
  function listaAutorizada() {
    return (S.estado && S.estado.usuarios) ? S.estado.usuarios : [];
  }

  function render(alvo) {
    if (!S.pode('acessos.ver')) {
      alvo.appendChild(U.semPermissao('O controle de acessos é da coordenação do curso.'));
      return;
    }
    var autorizados = listaAutorizada();
    var porNivel = {};
    autorizados.forEach(function (a) { porNivel[a.perfil] = (porNivel[a.perfil] || 0) + 1; });

    alvo.appendChild(C.el('div', { class: 'page-head' }, [
      C.el('div', {}, [
        C.el('h1', { text: 'Controle de acessos' }),
        C.el('div', {
          class: 'muted', style: 'font-size:13.5px;margin-top:6px',
          text: C.plural(autorizados.length, 'pessoa autorizada', 'pessoas autorizadas') +
            ' · ' + C.plural(A.PERFIS.length, 'nível', 'níveis')
        })
      ]),
      C.el('div', { class: 'seg' }, [
        aba('pessoas', 'Quem tem acesso'), aba('niveis', 'Níveis e permissões')
      ])
    ]));

    alvo.appendChild(vista === 'pessoas' ? pessoas() : niveis());
  }

  function aba(id, rotulo) {
    return C.el('button', {
      type: 'button', class: vista === id ? 'on' : '', text: rotulo,
      onclick: function () { vista = id; global.App.recarregar(); }
    });
  }

  /* ── Quem tem acesso ──────────────────────────────────────────────── */
  function pessoas() {
    var autorizados = listaAutorizada();
    var ordem = { coordenador: 0, professor: 1, tecnico: 2 };
    var lista = autorizados.slice().sort(function (a, b) {
      var d = (ordem[a.perfil] === undefined ? 9 : ordem[a.perfil]) -
        (ordem[b.perfil] === undefined ? 9 : ordem[b.perfil]);
      return d || String(a.email).localeCompare(String(b.email), 'pt-BR');
    });

    var caixa = C.el('div');
    var eu = S.usuario();
    var podeEditar = S.pode('acessos.editar');

    if (podeEditar) {
      caixa.appendChild(C.el('div', { class: 'row', style: 'justify-content:flex-end;margin-bottom:18px' },
        C.el('button', {
          class: 'btn btn-primary', text: 'Conceder acesso',
          onclick: function () { editar(null); }
        })));
    }

    if (!lista.length) {
      caixa.appendChild(U.vazio('Nenhuma pessoa autorizada. O sistema está inacessível.'));
      return caixa;
    }

    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, [
        C.el('th', { text: 'Pessoa' }),
        C.el('th', { text: 'Nível de acesso' }),
        C.el('th', { text: 'Disciplinas' }),
        C.el('th', { text: 'Situação' }),
        C.el('th', { text: 'Último acesso' }),
        C.el('th', { class: 'right', text: '' })
      ]))
    ]);
    var corpo = C.el('tbody');

    lista.forEach(function (a) {
      var nome = a.nome || String(a.email).split('@')[0];
      var souEu = eu && String(eu.email).toLowerCase() === String(a.email).toLowerCase();

      corpo.appendChild(C.el('tr', { style: a.ativo ? '' : 'opacity:.5' }, [
        C.el('td', {}, C.el('div', { class: 'row', style: 'gap:10px' }, [
          C.el('span', {
            class: 'avatar', style: 'width:26px;height:26px;font-size:10px',
            text: C.iniciais(nome)
          }),
          C.el('span', {}, [
            C.el('div', { style: 'font-weight:600', text: nome + (souEu ? ' · você' : '') }),
            C.el('div', { class: 'muted', style: 'font-size:12px', text: a.email })
          ])
        ])),
        C.el('td', {}, ordem[a.perfil] === undefined
          ? C.el('span', { class: 'badge danger', text: 'nível inválido: ' + a.perfil })
          : C.el('span', { class: 'badge soft', text: A.nomePerfil(a.perfil) })),
        C.el('td', { style: 'font-size:12.5px;max-width:280px' }, textoDisciplinas(a)),
        C.el('td', {}, C.el('span', {
          class: 'badge ' + (a.ativo ? 'ok' : 'neutral'),
          text: a.ativo ? 'ativo' : 'suspenso'
        })),
        C.el('td', { style: 'font-size:12.5px' },
          a.ultimoAcesso ? C.fmtCarimbo(a.ultimoAcesso)
            : C.el('span', { class: 'muted', text: 'nunca entrou' })),
        C.el('td', { class: 'right', style: 'white-space:nowrap' }, podeEditar ? [
          C.el('button', { class: 'btn-ghost', text: 'Editar', onclick: function () { editar(a); } }),
          souEu ? null : C.el('button', {
            class: a.ativo ? 'btn-danger' : 'btn-ghost', style: 'margin-left:12px',
            text: a.ativo ? 'Suspender' : 'Reativar',
            onclick: function () { alternar(a); }
          })
        ] : null)
      ]));
    });
    tabela.appendChild(corpo);
    caixa.appendChild(C.el('div', { class: 'rolagem-x' }, tabela));

    caixa.appendChild(C.el('div', { class: 'alert', style: 'margin-top:22px' }, [
      C.el('b', { text: 'O acesso vale para todo mundo.' }),
      ' A lista fica no servidor, então conceder, suspender ou revogar aqui ' +
      'tem efeito imediato para a pessoa, em qualquer computador. Suspender ' +
      'não apaga histórico: o que a pessoa registrou continua na agenda e nos ' +
      'relatórios. As disciplinas de cada professor também são escolhidas aqui, ' +
      'em "Editar": é por elas que ele pede ocupação e troca as cadeiras das reservas.'
    ]));

    return caixa;
  }

  /* Técnico não responde por disciplina: a coluna fica vazia para ele. */
  function textoDisciplinas(a) {
    if (a.perfil === 'tecnico') return C.el('span', { class: 'muted', text: '—' });
    var l = S.disciplinasDoProfessor(a.email);
    if (!l.length) return C.el('span', { class: 'muted', text: a.perfil === 'professor' ? 'nenhuma' : '—' });
    var nomes = l.map(function (d) { return S.rotuloDisciplina(d); });
    return C.el('span', { title: l.map(function (d) { return S.rotuloDisciplinaLongo(d); }).join('\n'),
      text: nomes.length > 3 ? nomes.slice(0, 3).join(', ') + ' e mais ' + (nomes.length - 3) : nomes.join(', ') });
  }

  /* Lista marcável das disciplinas, em dois grupos, com busca: são dezenas
     de disciplinas, e achar a certa rolando seria o gargalo do vínculo. */
  function escolhaDeDisciplinas(marcadas) {
    var busca = '';
    var lista = C.el('div', { class: 'escolha-disc' });
    function desenhar() {
      C.clear(lista);
      var termo = busca.trim().toLowerCase();
      [['Graduação', S.disciplinasDeGraduacao()], ['Pós-graduação', S.especializacoes()]].forEach(function (par) {
        var itens = par[1].filter(function (d) {
          return !termo || (String(d.codigo || '') + ' ' + d.nome).toLowerCase().indexOf(termo) !== -1;
        });
        if (!itens.length) return;
        lista.appendChild(C.el('span', { class: 'eyebrow', style: 'display:block;margin:8px 0 4px', text: par[0] }));
        itens.forEach(function (d) {
          lista.appendChild(C.el('label', { class: 'limpeza-item' }, [
            C.el('input', {
              type: 'checkbox', checked: marcadas[d.id] ? true : null,
              onchange: function (ev) { marcadas[d.id] = ev.target.checked; contador(); }
            }),
            C.el('span', { text: S.rotuloDisciplinaLongo(d) })
          ]));
        });
      });
      if (!lista.childNodes.length) {
        lista.appendChild(C.el('div', { class: 'muted', style: 'font-size:12.5px;padding:8px 0',
          text: S.estado.disciplinas.length ? 'Nenhuma disciplina com esse nome.' : 'Nenhuma disciplina cadastrada ainda.' }));
      }
    }
    var rotulo = C.el('span');
    function contador() {
      var n = Object.keys(marcadas).filter(function (k) { return marcadas[k]; }).length;
      rotulo.textContent = 'Disciplinas · ' + n + (n === 1 ? ' marcada' : ' marcadas');
    }
    desenhar(); contador();
    return C.el('div', { class: 'fld' }, [
      C.el('span', {}, rotulo),
      C.el('input', {
        class: 'input', type: 'search', placeholder: 'Buscar por código ou nome',
        oninput: function (ev) { busca = ev.target.value; desenhar(); }
      }),
      lista,
      C.el('small', { class: 'muted', style: 'font-size:11.5px',
        text: 'O professor pede ocupação para estas disciplinas e troca as cadeiras das reservas delas.' })
    ]);
  }

  /* ── Conceder, alterar e revogar ──────────────────────────────────────
     Grava na coleção `autorizados`. As Security Rules é que decidem se a
     gravação passa — esconder o botão é conveniência, não controle. */
  function alternar(a) {
    var suspendendo = a.ativo;
    U.confirmar({
      titulo: suspendendo ? 'Suspender acesso' : 'Reativar acesso',
      rotulo: suspendendo ? 'Suspender' : 'Reativar',
      perigo: suspendendo,
      conteudo: C.el('span', {}, [
        C.el('b', { text: a.nome || a.email }),
        suspendendo
          ? ' deixa de entrar no sistema imediatamente, em qualquer computador. O histórico é preservado.'
          : ' volta a entrar com o nível ' + A.nomePerfil(a.perfil) + '.'
      ])
    }, function () {
      S.salvarAutorizado(a.email, { nome: a.nome, nivel: a.perfil, ativo: !a.ativo })
        .then(function (r) {
          if (r.ok) C.toast(suspendendo ? 'Acesso suspenso.' : 'Acesso reativado.');
        });
    });
  }

  function editar(a) {
    var novo = !a;
    var f = {
      email: a ? a.email : '',
      nome: a ? (a.nome || '') : '',
      perfil: a ? a.perfil : 'professor',
      ativo: a ? a.ativo : true
    };
    var erro = C.el('div');
    /* Disciplinas: só para quem responde por elas — professor e
       coordenação. O técnico não pede ocupação. */
    var marcadas = {};
    if (a) S.disciplinasDoProfessor(a.email).forEach(function (d) { marcadas[d.id] = true; });
    var blocoDisc = C.el('div');
    function desenharDisc() {
      C.clear(blocoDisc);
      if (f.perfil === 'professor' || f.perfil === 'coordenador') blocoDisc.appendChild(escolhaDeDisciplinas(marcadas));
    }
    desenharDisc();

    return U.modal({
      titulo: novo ? 'Conceder acesso' : 'Editar acesso',
      subtitulo: novo ? 'A pessoa entra com a conta Google deste e-mail.' : f.email,
      largura: '620px',
      conteudo: C.el('div', { class: 'stack' }, [
        erro,
        C.el('div', { class: 'grid-fields' }, [
          novo ? U.campo('E-mail institucional', C.el('input', {
            class: 'input', type: 'email', value: f.email,
            placeholder: 'nome.sobrenome@instituicao.edu.br',
            oninput: function (ev) { f.email = ev.target.value; }
          })) : null,
          U.campo('Nome', C.el('input', {
            class: 'input', value: f.nome,
            oninput: function (ev) { f.nome = ev.target.value; }
          }), 'Em branco, usa o nome da conta Google.'),
          U.campo('Nível de acesso', U.selecao(A.PERFIS.map(function (p) {
            return { valor: p.id, rotulo: p.nome };
          }), f.perfil, function (v) { f.perfil = v; desenharDisc(); }))
        ]),
        blocoDisc
      ]),
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Voltar', onclick: function () { U.fecharModal(); } }),
        novo ? null : C.el('button', {
          class: 'btn btn-danger', text: 'Remover do sistema',
          onclick: function () { remover(a); }
        }),
        C.el('button', {
          class: 'btn btn-primary', text: novo ? 'Conceder' : 'Salvar',
          onclick: function () {
            var email = String(f.email || '').trim().toLowerCase();
            C.clear(erro);
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
              erro.appendChild(C.el('div', { class: 'alert danger', text: 'Informe um e-mail válido.' }));
              return;
            }
            U.fecharModal();
            /* Técnico não fica vinculado a nada: trocar alguém para técnico
               desfaz os vínculos que ele tinha. */
            var ids = (f.perfil === 'professor' || f.perfil === 'coordenador')
              ? Object.keys(marcadas).filter(function (k) { return marcadas[k]; }) : [];
            S.salvarAutorizado(email, { nome: f.nome, nivel: f.perfil, ativo: f.ativo })
              .then(function (r) {
                if (!r.ok) return r;
                return S.vincularDisciplinas(email, ids).then(function (v) {
                  if (v.ok) {
                    C.toast((novo ? 'Acesso concedido' : 'Acesso atualizado') +
                      (ids.length ? ' · ' + C.plural(ids.length, 'disciplina', 'disciplinas') : '') + '.');
                  }
                  global.App.recarregar();
                });
              });
          }
        })
      ]
    });
  }

  function remover(a) {
    U.confirmar({
      titulo: 'Remover do sistema',
      rotulo: 'Remover',
      perigo: true,
      conteudo: C.el('span', {}, [
        'Prefira ', C.el('b', { text: 'suspender' }),
        ': remover apaga o registro de ',
        C.el('b', { text: a.nome || a.email }),
        ' e com ele o histórico de quando a pessoa entrou.'
      ])
    }, function () {
      S.removerAutorizado(a.email).then(function (r) {
        C.toast(r.ok ? 'Acesso removido.' : (r.mensagem || 'Não foi possível remover.'));
      });
    });
  }

  /* ── Níveis e matriz ──────────────────────────────────────────────── */
  function niveis() {
    var caixa = C.el('div');
    var autorizados = listaAutorizada();

    caixa.appendChild(C.el('div', { class: 'kpis', style: 'margin-bottom:34px' }, A.PERFIS.map(function (p) {
      var n = autorizados.filter(function (a) { return a.perfil === p.id; }).length;
      return C.el('div', { class: 'card' }, [
        C.el('div', { class: 'row', style: 'gap:10px;justify-content:space-between' }, [
          C.el('h5', { text: p.nome }),
          C.el('span', { class: 'badge soft', text: C.plural(n, 'pessoa', 'pessoas') })
        ]),
        C.el('p', { class: 'muted', style: 'font-size:12.5px;line-height:1.6;margin:9px 0 0', text: p.descricao }),
        C.el('div', {
          style: 'margin-top:12px;font-size:12px',
          text: A.permissoesDe(p.id).length + ' de ' + A.PERMISSOES.length + ' permissões'
        })
      ]);
    })));

    var tabela = C.el('table', { class: 'table matrix' }, [
      C.el('thead', {}, C.el('tr', {}, [C.el('th', { text: 'Permissão' })].concat(
        A.PERFIS.map(function (p) { return C.el('th', { class: 'c', style: 'text-align:center', text: p.nome }); })
      )))
    ]);
    var corpo = C.el('tbody');
    A.areas().forEach(function (grupo) {
      corpo.appendChild(C.el('tr', {}, C.el('td', {
        colspan: String(A.PERFIS.length + 1),
        style: 'padding-top:20px;padding-bottom:6px;border-bottom:0'
      }, C.el('span', { class: 'eyebrow', text: grupo.area }))));
      grupo.itens.forEach(function (perm) {
        corpo.appendChild(C.el('tr', {}, [C.el('td', { text: perm.rotulo })].concat(
          A.PERFIS.map(function (p) {
            var tem = A.permissoesDe(p.id).indexOf(perm.id) !== -1;
            return C.el('td', { class: 'c' }, C.el('span', {
              class: tem ? 'dot-yes' : 'dot-no', text: tem ? '●' : '—',
              title: tem ? 'permitido' : 'bloqueado'
            }));
          })
        )));
      });
    });
    tabela.appendChild(corpo);

    caixa.appendChild(C.el('h5', { text: 'Matriz de permissões', style: 'margin-bottom:6px' }));
    caixa.appendChild(C.el('div', {
      class: 'muted', style: 'font-size:12.5px;margin-bottom:16px',
      text: 'O sistema consulta esta matriz para decidir o que cada pessoa vê e pode fazer.'
    }));
    caixa.appendChild(C.el('div', { class: 'rolagem-x' }, tabela));
    return caixa;
  }

  global.ViewAcessos = { render: render };
})(window);
