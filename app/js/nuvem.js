/* nuvem.js — Firebase: inicialização, leitura em bloco, assinaturas e
   escrita transacional.

   Builds "compat" de propósito: o app é ES5 estrito, com IIFEs penduradas em
   window e dependência resolvida pela ordem das tags <script>. O SDK modular
   pressupõe ESM e bundler, que este projeto não tem. Os compat expõem o
   global `firebase` e encaixam no padrão existente.

   Esta camada não conhece regra de negócio: ela busca, assina e grava.
   Quem sabe o que é conflito de horário é o store. */
(function (global) {
  'use strict';

  /* A apiKey do Firebase é identificador público do projeto, não segredo —
     pode ir para o repositório. Quem protege os dados são as Security
     Rules do lado do servidor. */
  var CONFIG = {
    apiKey: 'AIzaSyCz_yKNT4grtM2fj8OKEZASqjdDQFwaPhA',
    authDomain: 'ocupa-odonto.firebaseapp.com',
    projectId: 'ocupa-odonto',
    storageBucket: 'ocupa-odonto.firebasestorage.app',
    messagingSenderId: '771816455765',
    appId: '1:771816455765:web:42339758c221bea6ee1edc'
  };

  /* Coleções carregadas inteiras no boot. O volume é pequeno — 4
     agrupamentos, 8 clínicas, um semestre de ocupações — então cabe tudo em
     memória e as leituras do store seguem síncronas. */
  var COLECOES = [
    'agrupamentos', 'clinicas', 'autorizados', 'disciplinas', 'turmas',
    'alunos', 'matriculas', 'ocupacoes', 'manutencoes', 'atribuicoes'
  ];

  /* Coleções que mudam pela mão de outras pessoas e por isso são assinadas. */
  var VIVAS = ['ocupacoes', 'manutencoes', 'autorizados', 'atribuicoes', 'matriculas'];

  var auth = null, db = null, pronto = false;
  var cancelamentos = [];

  function iniciar() {
    if (pronto) return true;
    if (!global.firebase || !global.firebase.initializeApp) return false;
    global.firebase.initializeApp(CONFIG);
    auth = global.firebase.auth();
    db = global.firebase.firestore();
    /* Sessão sobrevive ao fechar a aba; é o comportamento que as pessoas
       esperam de um sistema interno. */
    try { auth.setPersistence(global.firebase.auth.Auth.Persistence.LOCAL); } catch (e) { }
    pronto = true;
    return true;
  }

  function disponivel() { return pronto; }

  /* ── Autenticação ─────────────────────────────────────────────────── */
  function entrarComGoogle() {
    var p = new global.firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    return auth.signInWithPopup(p);
  }
  function sair() { return auth.signOut(); }
  function aoMudarSessao(cb) { return auth.onAuthStateChanged(cb); }
  function contaAtual() { return auth ? auth.currentUser : null; }

  /* ── Leitura ──────────────────────────────────────────────────────── */
  function docsDe(snap) {
    var saida = [];
    snap.forEach(function (d) {
      var o = d.data() || {};
      o.id = d.id;
      saida.push(o);
    });
    return saida;
  }

  function lerColecao(nome) {
    return db.collection(nome).get().then(function (snap) { return docsDe(snap); });
  }

  function lerAutorizado(email) {
    return db.collection('autorizados').doc(String(email).trim().toLowerCase())
      .get().then(function (d) {
        if (!d.exists) return null;
        var o = d.data() || {};
        o.id = d.id;
        return o;
      });
  }

  function lerConfig() {
    return db.collection('config').doc('sistema').get().then(function (d) {
      return d.exists ? (d.data() || {}) : null;
    });
  }

  /* Carrega tudo de uma vez. Devolve um objeto {colecao: [documentos]}. */
  function carregarTudo() {
    var saida = {};
    var pedidos = COLECOES.map(function (nome) {
      return lerColecao(nome).then(function (l) { saida[nome] = l; });
    });
    pedidos.push(lerConfig().then(function (c) { saida.config = c; }));
    return global.Promise.all(pedidos).then(function () { return saida; });
  }

  /* ── Assinaturas ──────────────────────────────────────────────────── */
  /* aoMudar(nomeDaColecao, documentos) sempre que a coleção mudar no
     servidor — inclusive por gravação de outra pessoa. */
  function assinarVivas(aoMudar) {
    encerrarAssinaturas();
    VIVAS.forEach(function (nome) {
      var parar = db.collection(nome).onSnapshot(function (snap) {
        aoMudar(nome, docsDe(snap));
      }, function (erro) {
        if (global.console) global.console.warn('assinatura de ' + nome + ' falhou:', erro.message);
      });
      cancelamentos.push(parar);
    });
  }
  function encerrarAssinaturas() {
    cancelamentos.forEach(function (f) { try { f(); } catch (e) { } });
    cancelamentos = [];
  }

  /* ── Escrita ──────────────────────────────────────────────────────── */
  function novoId(colecao) { return db.collection(colecao).doc().id; }

  function gravar(colecao, id, dados) {
    return db.collection(colecao).doc(String(id)).set(dados, { merge: true })
      .then(function () { return id; });
  }
  function apagar(colecao, id) {
    return db.collection(colecao).doc(String(id)).delete();
  }
  function apagarVarios(colecao, ids) {
    if (!ids.length) return global.Promise.resolve();
    var lote = db.batch();
    ids.forEach(function (id) { lote.delete(db.collection(colecao).doc(String(id))); });
    return lote.commit();
  }

  /* ── Gravação transacional de ocupação ────────────────────────────────
     O problema: validar-e-gravar em dois passos é corrida. Duas pessoas
     passam na validação e as duas gravam por cima uma da outra.

     A saída natural seria reler as ocupações dentro da transação, mas o SDK
     web só aceita `transaction.get()` de DOCUMENTO, nunca de consulta — o
     que existe no Admin SDK não existe aqui. Então mantemos um documento de
     índice por agrupamento, indices/{agrupamentoId}, com a forma compacta de
     tudo que ocupa aquele agrupamento. A transação lê ESSE documento,
     revalida contra ele e grava os dois — índice e ocupação — atômicamente.

     Cabe folgado em 1 MiB: um semestre inteiro de um agrupamento são algumas
     centenas de linhas de {id, escopo, dias, inicio, fim, vigencia}.

     `validar(indice)` é do store e devolve null quando pode gravar, ou a
     mensagem do choque quando não pode. */
  function gravarOcupacao(agrupamentoId, ocupacaoId, dados, validar, resumoParaIndice) {
    var refIndice = db.collection('indices').doc(String(agrupamentoId));
    var refOcup = db.collection('ocupacoes').doc(String(ocupacaoId));

    return db.runTransaction(function (t) {
      return t.get(refIndice).then(function (d) {
        var indice = d.exists ? (d.data() || {}) : { agrupamentoId: agrupamentoId, itens: [] };
        if (!indice.itens) indice.itens = [];

        var choque = validar(indice.itens);
        if (choque) return global.Promise.reject({ conflito: true, mensagem: choque });

        var itens = indice.itens.filter(function (i) { return i.id !== ocupacaoId; });
        itens.push(resumoParaIndice);

        t.set(refOcup, dados, { merge: true });
        t.set(refIndice, { agrupamentoId: agrupamentoId, itens: itens }, { merge: true });
        return ocupacaoId;
      });
    });
  }

  /* Remoção precisa sair do índice também, senão o espaço fica ocupado por
     um fantasma que nenhuma tela mostra. */
  function removerOcupacao(agrupamentoId, ocupacaoId) {
    var refIndice = db.collection('indices').doc(String(agrupamentoId));
    var refOcup = db.collection('ocupacoes').doc(String(ocupacaoId));
    return db.runTransaction(function (t) {
      return t.get(refIndice).then(function (d) {
        var itens = (d.exists && d.data() && d.data().itens) ? d.data().itens : [];
        t.set(refIndice, {
          agrupamentoId: agrupamentoId,
          itens: itens.filter(function (i) { return i.id !== ocupacaoId; })
        }, { merge: true });
        t.delete(refOcup);
        return true;
      });
    });
  }

  /* Atualiza só o resumo no índice — usado quando a ocupação muda de
     vigência ou é encerrada, sem sair do sistema. */
  function atualizarIndice(agrupamentoId, ocupacaoId, resumo) {
    var refIndice = db.collection('indices').doc(String(agrupamentoId));
    return db.runTransaction(function (t) {
      return t.get(refIndice).then(function (d) {
        var itens = (d.exists && d.data() && d.data().itens) ? d.data().itens : [];
        itens = itens.filter(function (i) { return i.id !== ocupacaoId; });
        if (resumo) itens.push(resumo);
        t.set(refIndice, { agrupamentoId: agrupamentoId, itens: itens }, { merge: true });
        return true;
      });
    });
  }

  global.Nuvem = {
    iniciar: iniciar, disponivel: disponivel, COLECOES: COLECOES,
    entrarComGoogle: entrarComGoogle, sair: sair,
    aoMudarSessao: aoMudarSessao, contaAtual: contaAtual,
    lerAutorizado: lerAutorizado, lerColecao: lerColecao, lerConfig: lerConfig,
    carregarTudo: carregarTudo,
    assinarVivas: assinarVivas, encerrarAssinaturas: encerrarAssinaturas,
    novoId: novoId, gravar: gravar, apagar: apagar, apagarVarios: apagarVarios,
    gravarOcupacao: gravarOcupacao, removerOcupacao: removerOcupacao,
    atualizarIndice: atualizarIndice
  };
})(window);
