/* avisos.js — pede ao servidor o e-mail para o professor coordenador.

   O e-mail é CONSEQUÊNCIA da gravação. Este arquivo acompanha a promessa de
   quem gravou e só fala com /api/avisos depois que ela deu certo; se o
   envio falhar, a reserva fica como está e um toast diz que o e-mail não
   saiu. Com `parametros.enviarEmails` desligado (o padrão, ausência
   inclusive), `gravar` só chama quem grava, na mesma hora, e nenhum pedido
   sai do navegador.

   O navegador não escolhe destinatário nem texto: manda o id da reserva e o
   evento, e o servidor lê o resto no banco (ver app/api/_avisos).

   BILHETE. Três mudanças apagam o que o e-mail precisa mostrar: cancelar uma
   pontual remove o documento, e editar, trocar cadeiras ou recuperar
   sobrescrevem o estado anterior. Para elas o servidor assina o "antes"
   ANTES da gravação, e o navegador devolve o bilhete depois. As telas que
   abrem um formulário chamam `preparar` na abertura, então o bilhete
   costuma estar pronto no clique; quando não está, a gravação espera no
   máximo ESPERA e segue sem ele. Gravação nunca fica presa ao e-mail. */
(function (global) {
  'use strict';
  var C = global.Core, N = global.Nuvem;

  var ENDERECO = '/api/avisos';
  var ESPERA = 2500;       /* quanto a gravação espera pelo bilhete */
  var PRAZO = 28000;       /* quanto se espera pelo envio */
  var JUNTAR = 700;        /* o que chega dentro disto vai no mesmo e-mail */
  var VALIDADE = 10 * 60 * 1000;

  var bilhetes = {};       /* id da reserva → { promessa, em } */
  var emCurso = 0, fila = [], relogio = null;

  function loja() { return global.Store; }
  function ligado() {
    var e = loja() && loja().estado;
    return !!(e && e.parametros && e.parametros.enviarEmails === true);
  }
  function eu() {
    var u = loja() && loja().usuario();
    return u ? u.id : null;
  }

  /* ── Conversa com o servidor ──────────────────────────────────────── */
  function comPrazo(promessa, ms) {
    return new global.Promise(function (ok, erro) {
      var t = global.setTimeout(function () { erro({ erro: 'tempo' }); }, ms);
      promessa.then(function (v) { global.clearTimeout(t); ok(v); },
        function (e) { global.clearTimeout(t); erro(e); });
    });
  }
  /* Resolve com o corpo da resposta 200; rejeita com { erro: motivo }. */
  function chamar(corpo, prazo) {
    if (!N.tokenAtual || !global.fetch) return global.Promise.reject({ erro: 'rede' });
    return comPrazo(N.tokenAtual().then(function (token) {
      return global.fetch(ENDERECO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(corpo)
      });
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw { erro: (j && j.erro) || 'interno' };
        return j;
      });
    }), prazo);
  }

  /* ── Bilhete do antes ─────────────────────────────────────────────── */
  function pedirBilhete(id) {
    var promessa = chamar({ acao: 'bilhete', id: id }, PRAZO).then(function (r) { return r.bilhete || null; });
    promessa['catch'](function () { });
    bilhetes[id] = { promessa: promessa, em: Date.now() };
    return promessa;
  }
  /* Chamado pela tela ao ABRIR um formulário que pode alterar a reserva. */
  function preparar(id) {
    if (!id || !ligado()) return;
    var S = loja(), doc = S.reservaPorId(id);
    /* Professor mexendo na própria reserva não avisa ninguém. A coordenação
       pode trocar o professor de uma reserva dela, então pede sempre. */
    if (doc && !S.pode('agenda.editar') && S.responsavelDe(doc) === eu()) return;
    pedirBilhete(id);
  }
  /* Nunca rejeita: { texto } ou, quando falhou ou demorou, { erro }. */
  function bilheteDe(id) {
    var b = bilhetes[id];
    var promessa = b && Date.now() - b.em < VALIDADE ? b.promessa : pedirBilhete(id);
    return comPrazo(promessa, ESPERA).then(function (t) {
      return t ? { texto: t } : { erro: 'sem_bilhete' };
    }, function (e) {
      return { erro: !e || !e.erro ? 'rede' : e.erro === 'tempo' ? 'sem_bilhete' : e.erro };
    });
  }

  /* ── Acompanhar a gravação ────────────────────────────────────────────
     gravar(aviso, fn): roda `fn` (que grava e devolve a promessa) e, se ela
     der certo, põe o aviso na fila. Devolve a promessa da gravação.
       aviso.evento  o que aconteceu
       aviso.id      a reserva
       aviso.data    o encontro, quando o aviso é de um só
       aviso.antes   true quando o e-mail precisa do estado anterior
       aviso.de      quem responde pela reserva (antes e depois); se for só
                     quem está fazendo, não há a quem avisar                */
  function interessa(aviso) {
    var meu = eu();
    return (aviso.de || []).some(function (r) { return !!r && r !== meu; });
  }
  function gravar(aviso, fn) {
    if (!ligado() || !interessa(aviso)) return fn();
    if (!aviso.antes) return acompanhar(aviso, null, fn());
    return bilheteDe(aviso.id).then(function (b) { return acompanhar(aviso, b, fn()); });
  }
  function acompanhar(aviso, bilhete, promessa) {
    emCurso++;
    /* O que já estava na fila espera por esta gravação: a faixa a mais criada
       logo depois de uma edição vai no mesmo e-mail dela. */
    global.clearTimeout(relogio);
    function fim() {
      emCurso--;
      /* O que se sabia do antes deixou de valer. */
      delete bilhetes[aviso.id];
      agendar();
    }
    promessa.then(function () {
      var item = { evento: aviso.evento, id: aviso.id };
      if (aviso.data) item.data = aviso.data;
      if (bilhete && bilhete.texto) item.bilhete = bilhete.texto;
      fila.push({ item: item, erro: bilhete ? bilhete.erro : null });
      fim();
    }, fim);
    return promessa;
  }

  /* Espera as gravações em curso e mais um instante, e manda tudo junto: as
     linhas do mesmo formulário, e o que foi feito em seguida, chegam num
     e-mail só por pessoa. */
  function agendar() {
    if (emCurso || !fila.length) return;
    global.clearTimeout(relogio);
    relogio = global.setTimeout(enviar, JUNTAR);
  }

  var MOTIVOS = {
    nao_configurado: 'o servidor de e-mail ainda não foi configurado',
    limite: 'o limite de envios foi atingido, tente mais tarde',
    sessao: 'a sessão expirou, entre de novo',
    acesso: 'o seu acesso não permitiu',
    tempo: 'o servidor demorou a responder',
    rede: 'sem conexão com o servidor',
    sem_bilhete: 'não foi possível ler o estado anterior da reserva',
    autenticacao: 'a conta de envio foi recusada',
    cota: 'a cota diária da conta de envio acabou',
    destinatario: 'o endereço foi recusado',
    conexao: 'o servidor de e-mail não respondeu',
    tls: 'a conexão segura com o servidor de e-mail falhou'
  };
  function naoSaiu(motivo) {
    C.toast('Mudança salva, mas o e-mail de aviso não saiu' +
      (MOTIVOS[motivo] ? ': ' + MOTIVOS[motivo] : '') + '.');
  }
  /* Ninguém a avisar não é falha: quem agiu é o próprio professor, nada que
     ele veja mudou, ou o mesmo aviso já saiu. */
  var CALADOS = ['proprio', 'sem_mudanca', 'repetido'];

  function enviar() {
    var lote = fila;
    fila = [];
    var vao = [], erro = null;
    lote.forEach(function (x) { if (x.erro) erro = x.erro; else vao.push(x.item); });
    if (erro) naoSaiu(erro);
    while (vao.length) despachar(vao.splice(0, 30));
  }
  function despachar(itens) {
    return chamar({ acao: 'avisar', itens: itens }, PRAZO).then(function (r) {
      if (r.desligado) return;
      if (r.enviados && r.enviados.length) C.toast('Aviso por e-mail enviado a ' + r.enviados.join(', ') + '.');
      if (r.falhas && r.falhas.length) naoSaiu(r.falhas[0].motivo);
      var fora = (r.ignorados || []).filter(function (x) { return CALADOS.indexOf(x.motivo) === -1; });
      if (!fora.length) return;
      if (fora.every(function (x) { return x.motivo === 'sem_acesso'; })) {
        C.toast('Sem aviso por e-mail' + (fora[0].nome ? ' para ' + fora[0].nome : '') +
          ': a pessoa não tem acesso ativo ao sistema.');
      } else naoSaiu(fora[0].motivo);
    }, function (e) { naoSaiu(e && e.erro ? e.erro : 'rede'); });
  }

  global.Avisos = { ligado: ligado, preparar: preparar, gravar: gravar };
})(window);
