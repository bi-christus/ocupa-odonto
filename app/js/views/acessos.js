/* views/acessos.js — painel de controle de acessos.
   Concede, altera e revoga o nível de cada pessoa, e documenta o que cada
   nível pode fazer. Visível somente a quem tem acessos.ver. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, A = global.Acesso;

  var vista = 'pessoas';

  function render(alvo) {
    if (!S.pode('acessos.ver')) {
      alvo.appendChild(U.semPermissao('O controle de acessos é da coordenação do curso.'));
      return;
    }
    var e = S.estado;
    var ativos = e.usuarios.filter(function (u) { return u.ativo; }).length;

    alvo.appendChild(C.el('div', { class: 'page-head' }, [
      C.el('div', {}, [
        C.el('h1', { text: 'Controle de acessos' }),
        C.el('div', { class: 'muted', style: 'font-size:13.5px;margin-top:6px',
          text: C.plural(e.usuarios.length, 'pessoa', 'pessoas') + ' · ' + ativos +
            ' com acesso ativo · ' + C.plural(A.PERFIS.length, 'nível', 'níveis') })
      ]),
      C.el('div', { class: 'row', style: 'gap:10px' }, [
        C.el('div', { class: 'seg' }, [
          aba('pessoas', 'Pessoas'), aba('niveis', 'Níveis e permissões')
        ]),
        S.pode('acessos.editar') ? C.el('button', {
          class: 'btn btn-primary', text: 'Conceder acesso', onclick: function () { editar(null); }
        }) : null
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

  /* ── Pessoas ──────────────────────────────────────────────────────── */
  function pessoas() {
    var e = S.estado, eu = S.usuario();
    var ordem = { coordenador: 0, professor: 1, tecnico: 2 };
    var lista = e.usuarios.slice().sort(function (a, b) {
      return (ordem[a.perfil] - ordem[b.perfil]) || a.nome.localeCompare(b.nome, 'pt-BR');
    });

    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, [
        C.el('th', { text: 'Pessoa' }), C.el('th', { text: 'Nível de acesso' }),
        C.el('th', { text: 'Turmas' }), C.el('th', { text: 'Último acesso' }),
        C.el('th', { text: 'Situação' }), C.el('th', { class: 'right', text: '' })
      ]))
    ]);
    var corpo = C.el('tbody');
    lista.forEach(function (u) {
      var turmas = S.turmasDoProfessor(u.id);
      corpo.appendChild(C.el('tr', { style: u.ativo ? '' : 'opacity:.5' }, [
        C.el('td', {}, [
          C.el('div', { class: 'row', style: 'gap:10px' }, [
            C.el('span', { class: 'avatar', style: 'width:26px;height:26px;font-size:10px', text: C.iniciais(u.nome) }),
            C.el('span', {}, [
              C.el('div', { style: 'font-weight:600', text: u.nome + (u.id === eu.id ? ' · você' : '') }),
              C.el('div', { class: 'muted', style: 'font-size:12px', text: u.email })
            ])
          ])
        ]),
        C.el('td', {}, C.el('span', { class: 'badge soft', text: A.nomePerfil(u.perfil) })),
        C.el('td', { class: 'num', text: turmas.length ? String(turmas.length) : '—' }),
        C.el('td', { style: 'font-size:12.5px' }, u.ultimoAcesso ? C.fmtCarimbo(u.ultimoAcesso) : 'nunca acessou'),
        C.el('td', {}, C.el('span', {
          class: 'badge ' + (u.ativo ? 'ok' : 'neutral'), text: u.ativo ? 'ativo' : 'suspenso'
        })),
        C.el('td', { class: 'right', style: 'white-space:nowrap' }, S.pode('acessos.editar') ? [
          C.el('button', { class: 'btn-ghost', text: 'Editar', onclick: function () { editar(u.id); } }),
          u.id !== eu.id ? C.el('button', {
            class: u.ativo ? 'btn-danger' : 'btn-ghost', style: 'margin-left:12px',
            text: u.ativo ? 'Suspender' : 'Reativar',
            onclick: function () { alternar(u); }
          }) : null
        ] : null)
      ]));
    });
    tabela.appendChild(corpo);

    return C.el('div', {}, [
      tabela,
      /* Nós do DOM: C.el não renderiza mais markup em `html:` — o texto
         sairia com as tags removidas e o negrito perdido. */
      C.el('div', { class: 'alert', style: 'margin-top:22px' }, [
        C.el('b', { text: 'Como o acesso é aplicado.' }),
        ' Cada tela e cada botão consulta o nível da pessoa antes de aparecer. ' +
        'Suspender alguém não apaga o histórico: os registros que a pessoa criou continuam na agenda e nos relatórios.'
      ])
    ]);
  }

  function alternar(u) {
    var suspendendo = u.ativo;
    if (suspendendo && u.perfil === 'coordenador' && S.estado.usuarios.filter(function (x) {
      return x.perfil === 'coordenador' && x.ativo;
    }).length <= 1) {
      C.toast('É preciso manter ao menos um coordenador ativo.');
      return;
    }
    U.confirmar({
      titulo: suspendendo ? 'Suspender acesso' : 'Reativar acesso',
      subtitulo: u.nome,
      rotulo: suspendendo ? 'Suspender' : 'Reativar',
      perigo: suspendendo,
      /* `texto` é texto puro e escapado: o nome vai num nó próprio para o
         negrito continuar existindo em vez de aparecer como "<b>". */
      conteudo: C.el('span', {}, [
        C.el('b', { text: u.nome }),
        suspendendo
          ? ' deixa de entrar no sistema imediatamente. O histórico é preservado e o acesso pode ser reativado depois.'
          : ' volta a acessar o sistema como ' + A.nomePerfil(u.perfil).toLowerCase() + '.'
      ])
    }, function () {
      S.alternarAtivo(u.id);
      C.toast(u.nome + (suspendendo ? ' suspenso.' : ' reativado.'));
      global.App.recarregar();
    });
  }

  function editar(id) {
    var u = id ? S.pessoa(id) : { nome: '', email: '', perfil: 'professor', ativo: true };
    var f = { nome: u.nome, email: u.email, perfil: u.perfil, ativo: u.ativo };
    var descricao = C.el('div', { class: 'preview' });

    function atualizarDescricao() {
      var p = A.perfil(f.perfil);
      var perms = A.permissoesDe(f.perfil);
      C.clear(descricao);
      descricao.appendChild(C.el('div', {}, C.el('b', { text: p.nome })));
      descricao.appendChild(C.el('div', { class: 'muted', style: 'margin-top:4px', text: p.descricao }));
      descricao.appendChild(C.el('div', { style: 'margin-top:8px',
        text: perms.length + ' de ' + A.PERMISSOES.length + ' permissões do sistema' }));
    }
    atualizarDescricao();

    U.modal({
      titulo: id ? 'Editar acesso' : 'Conceder acesso',
      subtitulo: id ? u.nome : 'Nova pessoa no sistema',
      largura: '640px',
      conteudo: C.el('div', { class: 'stack' }, [
        C.el('div', { class: 'grid-fields' }, [
          U.campo('Nome', C.el('input', { class: 'input', value: f.nome,
            oninput: function (ev) { f.nome = ev.target.value; } })),
          U.campo('E-mail institucional', C.el('input', { class: 'input', type: 'email', value: f.email,
            placeholder: 'nome.sobrenome@' + (((global.Config || {}).dominioInstitucional || 'instituicao.edu.br').replace(/^@/, '')),
            oninput: function (ev) { f.email = ev.target.value; } })),
          U.campo('Nível de acesso', U.selecao(A.PERFIS.map(function (p) {
            return { valor: p.id, rotulo: p.nome };
          }), f.perfil, function (v) { f.perfil = v; atualizarDescricao(); }))
        ]),
        descricao
      ]),
      acoes: [
        id && S.podeRemoverUsuario(id) ? C.el('button', {
          class: 'btn-danger', style: 'margin-right:auto', text: 'Remover do sistema',
          onclick: function () {
            U.fecharModal();
            U.confirmar({
              titulo: 'Remover do sistema', subtitulo: u.nome, rotulo: 'Remover',
              perigo: true,
              conteudo: C.el('span', {}, [
                'A pessoa deixa de existir no controle de acessos. Prefira ',
                C.el('b', { text: 'suspender' }),
                ' se ela ainda tiver histórico relevante.'
              ])
            }, function () {
              S.removerUsuario(id); C.toast('Acesso removido.'); global.App.recarregar();
            });
          }
        }) : null,
        C.el('button', { class: 'btn btn-outline', text: 'Cancelar', onclick: U.fecharModal }),
        C.el('button', {
          class: 'btn btn-primary', text: 'Salvar',
          onclick: function () {
            if (!f.nome.trim() || !f.email.trim()) { C.toast('Nome e e-mail são obrigatórios.'); return; }
            if (id && u.perfil === 'coordenador' && f.perfil !== 'coordenador' &&
              S.estado.usuarios.filter(function (x) { return x.perfil === 'coordenador' && x.ativo; }).length <= 1) {
              C.toast('É preciso manter ao menos um coordenador.');
              return;
            }
            S.salvarUsuario(id, f);
            U.fecharModal(); C.toast('Acesso salvo.'); global.App.recarregar();
          }
        })
      ]
    });
  }

  /* ── Níveis e matriz ──────────────────────────────────────────────── */
  function niveis() {
    var caixa = C.el('div');

    caixa.appendChild(C.el('div', { class: 'kpis', style: 'margin-bottom:34px' }, A.PERFIS.map(function (p) {
      var n = S.estado.usuarios.filter(function (u) { return u.perfil === p.id && u.ativo; }).length;
      return C.el('div', { class: 'card' }, [
        C.el('div', { class: 'row', style: 'gap:10px;justify-content:space-between' }, [
          C.el('h5', { text: p.nome }),
          C.el('span', { class: 'badge soft', text: n + (n === 1 ? ' pessoa' : ' pessoas') })
        ]),
        C.el('p', { class: 'muted', style: 'font-size:12.5px;line-height:1.6;margin:9px 0 0', text: p.descricao }),
        C.el('div', { style: 'margin-top:12px;font-size:12px',
          text: A.permissoesDe(p.id).length + ' de ' + A.PERMISSOES.length + ' permissões' })
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
    caixa.appendChild(C.el('div', { class: 'muted', style: 'font-size:12.5px;margin-bottom:16px',
      text: 'O sistema consulta esta matriz para decidir o que cada pessoa vê e pode fazer.' }));
    caixa.appendChild(C.el('div', { style: 'overflow-x:auto' }, tabela));
    return caixa;
  }

  global.ViewAcessos = { render: render };
})(window);
