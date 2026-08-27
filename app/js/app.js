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

  function iniciar() {
    raiz = document.getElementById('raiz');
    try { tema = localStorage.getItem('ocupa.tema') || 'claro'; } catch (e) { }
    S.carregar();
    S.iniciarSessao();
    desenhar();
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
    if (!S.usuario()) { raiz.appendChild(login()); return; }
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
     Login exclusivamente por conta Google, restrito ao domínio institucional
     e à lista de autorizados.js. Não há senha, cadastro aberto nem seleção
     de pessoa. */
  var erroLogin = null;

  /* Lê o corpo do token do Google. A assinatura NÃO é conferida — sem
     servidor não há onde validar. Ver o aviso em autorizados.js. */
  function corpoDoToken(jwt) {
    var partes = String(jwt || '').split('.');
    if (partes.length !== 3) return null;
    try {
      var b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) { b64 += '='; }
      var bruto = atob(b64);
      var pct = '';
      for (var i = 0; i < bruto.length; i++) {
        pct += '%' + ('00' + bruto.charCodeAt(i).toString(16)).slice(-2);
      }
      return JSON.parse(decodeURIComponent(pct));
    } catch (e) { return null; }
  }

  function aoReceberCredencial(resposta) {
    var p = corpoDoToken(resposta && resposta.credential);
    if (!p) {
      erroLogin = 'Não foi possível ler a resposta do Google. Tente novamente.';
      desenhar(); return;
    }
    var r = S.entrarComGoogle({
      email: p.email, nome: p.name, hd: p.hd, emailVerificado: p.email_verified
    });
    if (!r.ok) {
      erroLogin = r.mensagem;
      /* Esquece a conta escolhida para o próximo clique poder trocar. */
      try { global.google.accounts.id.disableAutoSelect(); } catch (e) { }
      desenhar(); return;
    }
    erroLogin = null;
    rota = 'painel';
    desenhar();
    C.toast('Bem-vindo, ' + C.primeiroNome(r.usuario.nome) + '.');
  }

  function montarBotaoGoogle(alvo) {
    var cfg = global.Config;
    if (!global.google || !global.google.accounts || !global.google.accounts.id) {
      alvo.appendChild(C.el('div', { class: 'alert danger' },
        'Não foi possível carregar o login do Google. Verifique a conexão e recarregue a página.'));
      return;
    }
    var opcoes = {
      client_id: cfg.googleClientId,
      callback: aoReceberCredencial,
      auto_select: false,
      cancel_on_tap_outside: true,
      ux_mode: 'popup'
    };
    if (cfg.dominioInstitucional) {
      opcoes.hosted_domain = String(cfg.dominioInstitucional).replace(/^@/, '');
    }
    try {
      global.google.accounts.id.initialize(opcoes);
      global.google.accounts.id.renderButton(alvo, {
        type: 'standard', theme: tema === 'escuro' ? 'filled_black' : 'outline',
        size: 'large', text: 'signin_with', shape: 'rectangular',
        logo_alignment: 'left', locale: 'pt-BR', width: 320
      });
    } catch (e) {
      alvo.appendChild(C.el('div', { class: 'alert danger' },
        'O login do Google recusou a configuração: ' + e.message));
    }
  }

  /* Coluna da direita: ou o botão do Google, ou a instrução do que falta
     configurar. Prefiro dizer exatamente o que preencher a mostrar um botão
     que falharia. */
  function painelDeEntrada() {
    var cfg = global.Config || {};
    var lista = global.Autorizados || [];
    var caixa = C.el('div', { style: 'width:330px;max-width:100%' });

    if (!cfg.configurado || !cfg.configurado()) {
      caixa.appendChild(C.el('h4', { text: 'Falta configurar', style: 'margin-bottom:10px' }));
      caixa.appendChild(C.el('div', { class: 'alert' },
        'O login por conta Google ainda não foi configurado neste sistema.'));
      caixa.appendChild(C.el('p', {
        class: 'muted', style: 'font-size:12.5px;line-height:1.7;margin-top:16px'
      }, [
        'Edite ', C.el('b', { text: 'app/js/config.js' }),
        ' e preencha o Client ID do Google e o domínio institucional. ',
        'As instruções de onde obter o Client ID estão no próprio arquivo.'
      ]));
      return caixa;
    }

    if (!lista.length) {
      caixa.appendChild(C.el('h4', { text: 'Nenhum acesso concedido', style: 'margin-bottom:10px' }));
      caixa.appendChild(C.el('div', { class: 'alert' },
        'A lista de pessoas autorizadas está vazia, então ninguém consegue entrar.'));
      caixa.appendChild(C.el('p', {
        class: 'muted', style: 'font-size:12.5px;line-height:1.7;margin-top:16px'
      }, [
        'Edite ', C.el('b', { text: 'app/js/autorizados.js' }),
        ' e acrescente ao menos um e-mail com o nível ', C.el('b', { text: 'coordenador' }), '.'
      ]));
      return caixa;
    }

    caixa.appendChild(C.el('h4', { text: 'Entrar', style: 'margin-bottom:6px' }));
    caixa.appendChild(C.el('p', {
      class: 'muted', style: 'font-size:12.5px;line-height:1.6;margin:0 0 18px',
      text: cfg.dominioInstitucional
        ? 'Use a sua conta institucional @' + String(cfg.dominioInstitucional).replace(/^@/, '') + '.'
        : 'Use a sua conta Google institucional.'
    }));

    if (erroLogin) {
      caixa.appendChild(C.el('div', { class: 'alert danger', style: 'margin-bottom:16px' }, erroLogin));
    }

    var alvoBotao = C.el('div', { style: 'min-height:44px' });
    caixa.appendChild(alvoBotao);
    /* O script do Google carrega de forma assíncrona; montar o botão no
       próximo tique evita a corrida com o defer da tag. */
    global.setTimeout(function () { montarBotaoGoogle(alvoBotao); }, 0);

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
            /* Sem isto o Google reentra sozinho com a mesma conta no próximo
               carregamento, e trocar de pessoa fica impossível. */
            try { global.google.accounts.id.disableAutoSelect(); } catch (e) { }
            S.sair(); rota = 'painel'; erroLogin = null; desenhar();
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
