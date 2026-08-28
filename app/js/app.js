/* app.js — casca do sistema: sessão, navegação e tema. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, A = global.Acesso;

  var raiz, rota = 'painel', paramsRota = null, tema = 'claro';

  var ROTAS = [
    { id: 'painel', rotulo: 'Painel', permissao: 'painel.ver', view: 'ViewPainel' },
    { id: 'agora', rotulo: 'Ocupação agora', permissao: 'agenda.ver', view: 'ViewAgora' },
    { id: 'agenda', rotulo: 'Agenda', permissao: 'agenda.ver', view: 'ViewAgenda' },
    { id: 'disciplinas', rotulo: 'Disciplinas', permissao: 'disciplinas.ver', view: 'ViewDisciplinas' },
    { id: 'relatorios', rotulo: 'Relatórios', permissao: 'relatorios.ver', view: 'ViewRelatorios' },
    { id: 'estrutura', rotulo: 'Estrutura', permissao: 'estrutura.ver', view: 'ViewEstrutura' },
    { id: 'acessos', rotulo: 'Acessos', permissao: 'acessos.ver', view: 'ViewAcessos' }
  ];

  /* `boot` separa "ainda não sei quem é" de "não tem ninguém logado". Sem
     essa distinção a tela de login pisca antes de o Firebase devolver a
     sessão que já existia, e quem recarregava a página via a tela de entrada
     por um instante mesmo estando autenticado. */
  var boot = true;

  function iniciar() {
    raiz = document.getElementById('raiz');
    try { tema = localStorage.getItem('ocupa.tema') || 'claro'; } catch (e) { }

    if (!global.Nuvem || !global.Nuvem.iniciar()) {
      boot = false;
      desenhar();
      return;
    }

    /* Uma assinatura só, que cobre os três casos: login novo, sessão
       retomada ao reabrir a aba, e saída. */
    global.Nuvem.aoMudarSessao(function (conta) {
      if (!conta) { boot = false; desenhar(); return; }
      if (S.usuario()) { boot = false; desenhar(); return; }
      desenhar();
      S.conferir(conta).then(function (r) {
        boot = false;
        if (!r.ok && r.motivo !== 'cancelado') erroLogin = r.mensagem;
        if (r.ok) rota = 'painel';
        desenhar();
      }, function (e) {
        boot = false;
        erroLogin = 'Falha ao carregar o sistema: ' + ((e && e.message) || 'erro desconhecido');
        desenhar();
      });
    });

    S.assinar(function () { if (S.usuario()) desenhar(); });

    /* Relógio do cabeçalho e status das ocupações mudam com o tempo. */
    setInterval(function () {
      var t = document.getElementById('relogio');
      if (t) t.textContent = C.fmtCabecalho(C.hojeISO()) + ' · ' + C.agoraHHMM();
    }, 20000);
  }

  function desenhar() {
    document.documentElement.setAttribute('data-tema', tema);
    C.clear(raiz);
    raiz.setAttribute('data-tema', tema);
    if (boot) { raiz.appendChild(aguardando('Carregando…')); return; }
    if (carregando) { raiz.appendChild(aguardando('Entrando…')); return; }
    if (!S.usuario()) { raiz.appendChild(login()); return; }
    if (S.estruturaPendente()) { raiz.appendChild(provisionar()); return; }
    rotaValida();
    raiz.appendChild(C.el('div', { class: 'app' }, [
      cabecalho(),
      conteudo()
    ]));
  }

  function rotaValida() {
    var atual = null;
    ROTAS.forEach(function (r) { if (r.id === rota) atual = r; });
    if (!atual || !S.pode(atual.permissao)) {
      var primeira = rotasVisiveis()[0];
      rota = primeira ? primeira.id : 'painel';
      paramsRota = null;
    }
  }
  function rotasVisiveis() {
    return ROTAS.filter(function (r) { return S.pode(r.permissao); });
  }

  /* ── Entrada ────────────────────────────────────────────────────────
     Login por conta Google via Firebase Auth. Quem pode entrar está na
     coleção `autorizados` do Firestore — estar autenticado no Google não é
     estar autorizado aqui. */
  var erroLogin = null;
  var carregando = false;

  function entrar() {
    if (carregando) return;
    erroLogin = null;
    carregando = true;
    desenhar();
    S.entrar().then(function (r) {
      carregando = false;
      if (r.ok) { rota = 'painel'; erroLogin = null; desenhar(); C.toast('Bem-vindo, ' + C.primeiroNome(r.usuario.nome) + '.'); return; }
      /* Fechar o popup é escolha da pessoa, não erro a ser exibido. */
      erroLogin = (r.motivo === 'cancelado') ? null : r.mensagem;
      desenhar();
    }, function (e) {
      carregando = false;
      erroLogin = 'Falha inesperada ao entrar: ' + ((e && e.message) || 'erro desconhecido');
      desenhar();
    });
  }

  /* Coluna da direita da tela de entrada. */
  function painelDeEntrada() {
    var caixa = C.el('div', { style: 'width:330px;max-width:100%' });

    if (!global.Nuvem || !global.Nuvem.disponivel()) {
      caixa.appendChild(C.el('h4', { text: 'Sistema indisponível', style: 'margin-bottom:10px' }));
      caixa.appendChild(C.el('div', { class: 'alert danger' },
        'Não foi possível carregar o Firebase. Verifique a conexão e recarregue a página.'));
      return caixa;
    }

    caixa.appendChild(C.el('h4', { text: 'Entrar', style: 'margin-bottom:6px' }));
    caixa.appendChild(C.el('p', {
      class: 'muted', style: 'font-size:12.5px;line-height:1.6;margin:0 0 18px',
      text: 'Use a sua conta Google institucional.'
    }));

    if (erroLogin) {
      caixa.appendChild(C.el('div', { class: 'alert danger', style: 'margin-bottom:16px' }, erroLogin));
    }

    caixa.appendChild(C.el('button', {
      class: 'btn btn-primary btn-lg', style: 'width:100%',
      text: carregando ? 'Entrando…' : 'Entrar com o Google',
      disabled: carregando ? true : null,
      onclick: entrar
    }));

    caixa.appendChild(C.el('p', {
      class: 'muted', style: 'font-size:11.5px;line-height:1.6;margin-top:22px',
      text: 'O acesso é restrito à lista mantida pela coordenação.'
    }));
    return caixa;
  }

  function login() {
    var cfg = global.Config || {};
    return C.el('div', { class: 'login' }, [
      C.el('div', { class: 'login-l' }, [
        C.el('div', { class: 'row', style: 'gap:11px' }, [
          C.el('div', { style: 'border:1px solid var(--color-divider);width:30px;height:30px;display:grid;place-items:center;font:600 13px var(--font-heading);color:var(--accent-ink)', text: 'O' }),
          C.el('span', { class: 'brand', text: 'Ocupa' })
        ]),
        C.el('div', {}, [
          C.el('h1', { text: 'Ocupação das clínicas de odontologia' }),
          C.el('p', {
            class: 'muted', style: 'font-size:14px;line-height:1.7;max-width:46ch;margin-top:18px',
            text: 'Agenda das clínicas, cadeiras em tempo real, turmas do semestre e manutenção — com acesso por nível.'
          })
        ]),
        C.el('div', { class: 'row', style: 'gap:44px' }, [
          ['4', 'agrupamentos'], ['8', 'clínicas'], ['112', 'cadeiras']
        ].map(function (n) {
          return C.el('div', {}, [
            C.el('div', { style: 'font:600 34px var(--font-heading);line-height:1', text: n[0] }),
            C.el('div', { class: 'eyebrow', text: n[1] })
          ]);
        })),
        C.el('div', { class: 'eyebrow', text: cfg.nomeInstituicao || 'Odontologia' })
      ]),
      C.el('div', { class: 'login-r' }, painelDeEntrada())
    ]);
  }

  /* Banco vazio: a estrutura física precisa ser gravada uma vez antes de
     qualquer tela ter o que mostrar. Só o coordenador provisiona. */
  function provisionar() {
    var podeFazer = S.pode('estrutura.editar');
    var caixa = C.el('div', { class: 'login-l', style: 'max-width:640px' }, [
      C.el('span', { class: 'brand', text: 'Ocupa' }),
      C.el('h2', { text: 'Estrutura ainda não cadastrada', style: 'margin-top:14px' }),
      C.el('p', {
        class: 'muted', style: 'font-size:14px;line-height:1.7;margin-top:14px',
        text: podeFazer
          ? 'O banco está vazio. Vou gravar os 4 agrupamentos, as 8 clínicas e as 112 cadeiras, junto com a configuração inicial do semestre. Isso é feito uma única vez; nenhuma pessoa ou atividade é criada.'
          : 'O sistema ainda não foi configurado pela coordenação. Assim que a estrutura das clínicas for cadastrada, esta tela dá lugar ao painel.'
      })
    ]);
    if (podeFazer) {
      var botao = C.el('button', {
        class: 'btn btn-primary btn-lg', style: 'margin-top:24px',
        text: 'Cadastrar a estrutura',
        onclick: function () {
          botao.disabled = true;
          botao.textContent = 'Gravando…';
          S.provisionarEstrutura().then(function (r) {
            if (r && r.ok) { rota = 'painel'; desenhar(); C.toast('Estrutura cadastrada.'); }
            else { botao.disabled = false; botao.textContent = 'Tentar de novo'; }
          });
        }
      });
      caixa.appendChild(botao);
    }
    return C.el('div', { class: 'login' }, caixa);
  }

  /* Tela intermediária: autenticando ou baixando o acervo. Sem ela a página
     pisca em branco entre o clique e o painel. */
  function aguardando(texto) {
    return C.el('div', { class: 'login' }, C.el('div', {
      class: 'login-l', style: 'justify-content:center'
    }, [
      C.el('span', { class: 'brand', text: 'Ocupa' }),
      C.el('h2', { text: texto, style: 'margin-top:14px' })
    ]));
  }

  /* ── Cabeçalho ────────────────────────────────────────────────────── */
  function cabecalho() {
    var u = S.usuario();
    var nav = C.el('nav', { class: 'nav' }, rotasVisiveis().map(function (r) {
      return C.el('button', {
        class: rota === r.id ? 'on' : '', text: r.rotulo,
        onclick: function () { ir(r.id); }
      });
    }));

    return C.el('header', { class: 'hdr' }, [
      C.el('div', { class: 'row', style: 'gap:24px;min-width:0' }, [
        C.el('span', { class: 'brand', text: 'Ocupa · Odontologia' }),
        nav
      ]),
      C.el('div', { class: 'hdr-right' }, [
        C.el('span', { id: 'relogio', class: 'muted num', style: 'font-size:12.5px;white-space:nowrap',
          text: C.fmtCabecalho(C.hojeISO()) + ' · ' + C.agoraHHMM() }),
        C.el('button', {
          class: 'chip-btn', text: tema === 'escuro' ? 'Claro' : 'Escuro',
          onclick: function () {
            tema = tema === 'escuro' ? 'claro' : 'escuro';
            try { localStorage.setItem('ocupa.tema', tema); } catch (e) { }
            desenhar();
          }
        }),
        C.el('div', { class: 'row', style: 'gap:9px' }, [
          C.el('div', { class: 'avatar', text: C.iniciais(u.nome) }),
          C.el('div', { style: 'line-height:1.3' }, [
            C.el('div', { style: 'font-size:12.5px;white-space:nowrap', text: u.nome }),
            C.el('span', { class: 'role-tag', text: A.nomePerfil(u.perfil) })
          ])
        ]),
        C.el('button', {
          class: 'chip-btn', text: 'Sair',
          onclick: function () {
            /* S.sair() derruba a sessão local e a do Firebase; o
               onAuthStateChanged devolve a tela de entrada. */
            rota = 'painel';
            erroLogin = null;
            S.sair();
            desenhar();
          }
        })
      ])
    ]);
  }

  /* ── Conteúdo ─────────────────────────────────────────────────────── */
  function conteudo() {
    var main = C.el('main');
    var atual = null;
    ROTAS.forEach(function (r) { if (r.id === rota) atual = r; });
    var view = atual ? global[atual.view] : null;
    if (view && view.render) {
      try {
        view.render(main, paramsRota);
      } catch (err) {
        main.appendChild(C.el('div', { class: 'alert danger',
          text: 'Não foi possível montar esta tela: ' + err.message }));
        if (global.console) console.error(err);
      }
    } else {
      main.appendChild(U.vazio('Tela indisponível.'));
    }
    paramsRota = null;
    return main;
  }

  /* ── API de navegação ─────────────────────────────────────────────── */
  function ir(destino, params) {
    rota = destino; paramsRota = params || null;
    U.fecharModal();
    desenhar();
    window.scrollTo(0, 0);
  }
  function recarregar() { desenhar(); }

  global.App = { iniciar: iniciar, ir: ir, recarregar: recarregar };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(window);
