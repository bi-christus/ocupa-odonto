/* views/acessos.js — quem tem acesso ao sistema, e o que cada nível pode.

   Esta tela é de CONSULTA. Ela já teve botões de conceder, editar, suspender
   e remover acesso, e todos mentiam: gravavam no localStorage, que é isolado
   por navegador. Pior, não era só o alcance — o portão de login é
   Autorizados.buscar(email) em store.js, e os registros gravados aqui nem
   participam dessa decisão. Conceder acesso pela tela não liberava a pessoa
   nem na máquina de quem clicou.

   Enquanto não houver servidor, a lista em app/js/autorizados.js é a única
   coisa que concede acesso, e é ela que esta tela mostra. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, A = global.Acesso;

  var vista = 'pessoas';

  function listaAutorizada() {
    var l = global.Autorizados;
    return (l && l.length) ? l : [];
  }

  /* Registro local de quem já entrou NESTE navegador — serve só para mostrar
     o último acesso. Não tem participação nenhuma na liberação. */
  function registroLocal(email) {
    var alvo = String(email || '').trim().toLowerCase(), achado = null;
    S.estado.usuarios.forEach(function (u) {
      if (String(u.email || '').trim().toLowerCase() === alvo) achado = u;
    });
    return achado;
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

    caixa.appendChild(C.el('div', { class: 'alert', style: 'margin-bottom:22px' }, [
      C.el('b', { text: 'Esta tela é de consulta.' }),
      ' Quem tem acesso ao sistema é definido no arquivo ',
      C.el('b', { text: 'app/js/autorizados.js' }),
      '. Para liberar ou revogar alguém, esse arquivo precisa ser alterado e o ' +
      'sistema publicado de novo — não há como fazer isso por aqui, e não ' +
      'adiantaria: o sistema ainda não tem servidor, então qualquer cadastro ' +
      'feito na tela ficaria só neste navegador.'
    ]));

    if (!lista.length) {
      caixa.appendChild(U.vazio('Nenhuma pessoa autorizada. O sistema está inacessível.'));
      return caixa;
    }

    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, [
        C.el('th', { text: 'Pessoa' }),
        C.el('th', { text: 'Nível de acesso' }),
        C.el('th', { text: 'Neste navegador' })
      ]))
    ]);
    var corpo = C.el('tbody');
    var eu = S.usuario();

    lista.forEach(function (a) {
      var local = registroLocal(a.email);
      var nome = a.nome || (local && local.nome) || String(a.email).split('@')[0];
      var souEu = eu && String(eu.email).toLowerCase() === String(a.email).toLowerCase();
      var perfilConhecido = A.nomePerfil(a.perfil);

      corpo.appendChild(C.el('tr', {}, [
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
          : C.el('span', { class: 'badge soft', text: perfilConhecido })),
        C.el('td', { style: 'font-size:12.5px' },
          local && local.ultimoAcesso ? C.fmtCarimbo(local.ultimoAcesso)
            : C.el('span', { class: 'muted', text: 'nunca entrou aqui' }))
      ]));
    });
    tabela.appendChild(corpo);
    caixa.appendChild(C.el('div', { class: 'rolagem-x' }, tabela));

    caixa.appendChild(C.el('div', { class: 'alert', style: 'margin-top:22px' }, [
      C.el('b', { text: '"Neste navegador"' }),
      ' mostra o último acesso registrado nesta máquina, e só nela. Uma ' +
      'pessoa pode ter entrado várias vezes de outro computador e aparecer ' +
      'aqui como "nunca entrou" — os dados do sistema não são compartilhados ' +
      'entre navegadores.'
    ]));

    return caixa;
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
