/* registro.js — formulário de registro de ocupação.
   Um único formulário atende os dois casos:
     · recorrente — disciplina do semestre, criada uma vez, repete toda
       semana nos mesmos dias e horários até o fim do semestre;
     · pontual — atividade única, com data própria. Desde 05/10/2026 o mesmo
       envio pode levar VÁRIAS ocupações pontuais ("linhas"), cada uma com
       clínica, cadeiras, data e horário próprios; disciplina, professor e
       descrição valem para todas.
   A ocupação escolhe um ESCOPO — a primeira clínica do agrupamento, a
   segunda, ou as duas juntas — e QUANTAS cadeiras usa. Quais, o sistema
   escolhe sozinho, da menor para a maior entre as livres, e o resto da
   clínica continua disponível para outras reservas.
   Turma não é mais cadastro: é escrita na "Descrição/Turma".
   Valida faixa, janela de funcionamento e cadeiras livres antes de deixar
   registrar, e mostra o que será gerado antes da confirmação. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, D = global.Dados, A = global.Acesso;

  /* Valor do "Outros" no campo de vínculo da atividade pontual. Mora fora de
     montar() porque é usado na montagem do formulário, antes de o corpo da
     função chegar às declarações locais — como `var`, ele ainda valeria
     `undefined` ali dentro. Nunca chega ao Firestore: vira null. */
  var SEM_VINCULO = 'outros';

  function maiorData(a, b) { if (!a) return b; if (!b) return a; return a > b ? a : b; }
  function menorData(a, b) { if (!a) return b; if (!b) return a; return a < b ? a : b; }
  function inteiro(v) {
    var n = Number(v);
    return (String(v).trim() !== '' && Math.floor(n) === n) ? n : null;
  }

  /* montar(alvo, opcoes) → renderiza no elemento `alvo`.
     opcoes.modo          'recorrente' | 'pontual' (inicial)
     opcoes.aoRegistrar   callback(resultado) após gravar
     opcoes.compacto      true no painel (esconde o título interno)
     opcoes.inicial       pré-preenchimento vindo do clique na agenda —
                          { data, inicio, fim, agrupamentoId, escopo } */
  function montar(alvo, opcoes) {
    opcoes = opcoes || {};
    var u = S.usuario();
    var podeRec = S.pode('agenda.criarRecorrente');
    var podePont = S.pode('agenda.criarPontual');
    if (!podeRec && !podePont) {
      C.clear(alvo).appendChild(U.semPermissao(
        'Seu perfil consulta a agenda, mas não registra ocupações. Peça à coordenação para lançar o horário.'));
      return;
    }

    var e = S.estado;

    /* Sem agrupamento com clínica não existe escopo possível: o formulário
       inteiro dependeria de um índice zero que não está lá. */
    var agrupamentosValidos = (e.agrupamentos || []).filter(function (g) {
      return S.clinicasDoAgrupamento(g.id).length > 0;
    });
    if (!agrupamentosValidos.length) {
      C.clear(alvo).appendChild(U.vazio(
        'Nenhuma clínica cadastrada — a coordenação precisa montar a estrutura antes de registrar ocupação.'));
      return;
    }

    var modo = opcoes.modo || (podeRec ? 'recorrente' : 'pontual');
    if (modo === 'recorrente' && !podeRec) modo = 'pontual';
    if (modo === 'pontual' && !podePont) modo = 'recorrente';

    var lim = limitesSemestre();
    var inicioUtil = menorData(maiorData(lim.inicio, C.hojeISO()), lim.fim);

    /* ── Linhas ───────────────────────────────────────────────────────────
       Cada linha é uma ocupação: onde, quantas cadeiras, quando. A
       recorrente usa só a primeira; a pontual, todas.
       `cadeiras` nasce VAZIA de propósito: o pedido da coordenação é que a
       quantidade seja informada, e um número preenchido sozinho seria
       confirmado sem ninguém ler. */
    var seq = 0;
    function novaLinha(base) {
      base = base || {};
      return {
        id: ++seq,
        agrupamentoId: base.agrupamentoId || agrupamentosValidos[0].id,
        escopo: base.escopo || 'a',
        cadeiras: base.cadeiras !== undefined ? base.cadeiras : '',
        data: base.data || primeiroDiaUtil(inicioUtil),
        inicio: base.inicio || '07:30', fim: base.fim || '11:30'
      };
    }

    var form = {
      tipo: 'graduacao',
      disciplinaId: '',
      /* O professor coordenador padrão é quem registra, até a disciplina dizer
         outra coisa: é ele quem responde pela ocupação e quem pode cancelá-la
         depois. O campo continua se chamando `responsavelId` no Firestore e
         em toda a lógica de permissão — só o rótulo de tela é outro. */
      responsavelId: u.id,
      descricao: '',
      dias: [1, 3],
      vigenciaInicio: inicioUtil,
      vigenciaFim: lim.fim,
      linhas: [novaLinha()]
    };
    aplicarInicial(opcoes.inicial);
    form.linhas.forEach(encaixarNaJanela);
    /* A disciplina nasce preenchida: a primeira do tipo, ou "Outros" na
       pontual quando não há nenhuma. Nunca em branco. */
    ajustarDisciplina();

    var raiz = C.clear(alvo);
    var corpo = C.el('div');
    var painelPre = C.el('div', { class: 'preview' });
    var avisos = C.el('div', { class: 'stack', style: 'gap:9px' });
    var acao = C.el('button', { class: 'btn btn-primary', type: 'button', onclick: registrar });
    /* Válvula de escape da falta de cadeira: uma data cheia em qualquer
       sexta do semestre não pode inviabilizar a disciplina inteira. */
    var acaoPular = C.el('button', {
      class: 'btn btn-outline', type: 'button',
      style: 'display:none', onclick: registrarPulando
    });

    /* Seletor de modo */
    var botoesModo = [];
    var seg = C.el('div', { class: 'seg', style: 'margin-bottom:20px' }, [
      podeRec ? botaoModo('recorrente', 'Recorrente · aula do semestre') : null,
      podePont ? botaoModo('pontual', 'Pontual · atividade única') : null
    ]);

    function botaoModo(m, rotulo) {
      var b = C.el('button', {
        type: 'button', class: modo === m ? 'on' : '', text: rotulo,
        'aria-pressed': modo === m ? 'true' : 'false',
        onclick: function () { trocar(m); }
      });
      botoesModo.push({ modo: m, no: b });
      return b;
    }

    if (!opcoes.compacto) raiz.appendChild(C.el('h5', { text: 'Nova ocupação', style: 'margin-bottom:16px' }));
    raiz.appendChild(seg);
    raiz.appendChild(corpo);
    raiz.appendChild(C.el('div', { style: 'display:flex;flex-direction:column;gap:14px;margin-top:20px' }, [
      painelPre, avisos,
      C.el('div', { class: 'row', style: 'display:flex;gap:10px;flex-wrap:wrap' }, [acao, acaoPular])
    ]));

    function trocar(m) {
      if (modo === m) return;
      modo = m;
      botoesModo.forEach(function (b) {
        b.no.className = b.modo === m ? 'on' : '';
        b.no.setAttribute('aria-pressed', b.modo === m ? 'true' : 'false');
      });
      /* A recorrente é UMA ocupação repetida: as linhas extras da pontual não
         têm lugar nela, e ficariam invisíveis até a hora de gravar. */
      if (m === 'recorrente') form.linhas = form.linhas.slice(0, 1);
      ajustarDisciplina();
      desenhar();
    }

    /* ── Semestre, janela e escopo ────────────────────────────────────── */
    /* Limites do semestre, tolerantes a um estado já corrompido: com
       semestre.inicio vazio a validação trancaria o usuário para sempre em
       vez de apenas recusar a data errada. */
    function limitesSemestre() {
      var s = (S.estado && S.estado.semestre) || {};
      var ini = C.dataValida(s.inicio) ? s.inicio : C.hojeISO();
      var fim = C.dataValida(s.fim) ? s.fim : C.addDays(ini, 18 * 7);
      if (fim < ini) fim = ini;
      return { inicio: ini, fim: fim };
    }

    /* Domingo não existe na grade da semana nem no gantt (seg–sáb). */
    function primeiroDiaUtil(iso) {
      return C.weekday(iso) === 0 ? C.addDays(iso, 1) : iso;
    }

    /* Janela de funcionamento do escopo: a interseção das duas clínicas,
       porque a ocupação conjunta precisa caber nas duas. */
    function janelaDe(agrupamentoId, escopo) {
      var l = S.clinicasDoEscopo(agrupamentoId, escopo);
      var p = e.parametros || {};
      var ab = null, fe = null;
      l.forEach(function (c) {
        var a = c.abertura || p.aberturaPadrao || '07:00';
        var f = c.fechamento || p.fechamentoPadrao || '22:00';
        if (ab === null || C.toMin(a) > C.toMin(ab)) ab = a;
        if (fe === null || C.toMin(f) < C.toMin(fe)) fe = f;
      });
      if (!ab) ab = p.aberturaPadrao || '07:00';
      if (!fe) fe = p.fechamentoPadrao || '22:00';
      if (C.toMin(fe) <= C.toMin(ab)) fe = C.fromMin(Math.min(23 * 60 + 55, C.toMin(ab) + 60));
      return { abertura: ab, fechamento: fe };
    }
    function janela(l) { return janelaDe(l.agrupamentoId, l.escopo); }
    function duracaoMinima() {
      return Math.max(60, Number((e.parametros || {}).faixaMinimaMin) || 60);
    }

    /* Encaixa início e término na janela do escopo da linha. Trocar de
       escopo pode estreitar o horário de funcionamento. */
    function encaixarNaJanela(l) {
      var jan = janela(l);
      var ab = C.toMin(jan.abertura), fe = C.toMin(jan.fechamento);
      var ini = Math.min(Math.max(C.toMin(l.inicio), ab), fe);
      var fim = Math.min(Math.max(C.toMin(l.fim), ab), fe);
      if (fim <= ini) fim = Math.min(fe, ini + duracaoMinima());
      if (fim <= ini) ini = Math.max(ab, fim - duracaoMinima());
      /* Puxa o início para trás quando a faixa mínima não cabe daqui até o
         fechamento. Clicar na última linha da grade — 21:00, com a clínica
         fechando às 22:00 — abria um formulário de 60 minutos que a validação
         recusava por faixa mínima: um beco sem saída, e sem pista do motivo. */
      if (fim - ini < duracaoMinima() && fe - ab >= duracaoMinima()) {
        fim = Math.min(fe, ini + duracaoMinima());
        ini = fim - duracaoMinima();
      }
      l.inicio = C.fromMin(ini);
      l.fim = C.fromMin(fim);
    }

    /* ── Pré-preenchimento vindo do clique na agenda ──────────────────
       A agenda passa o que o clique já determinou — dia, hora, agrupamento e
       escopo — para a PRIMEIRA linha, e o resto do formulário continua nos
       padrões. Nada entra sem ser conferido: o clique devolve coordenada de
       tela, não garantia de que o agrupamento ainda existe ou de que a data
       cabe no semestre. */
    function aplicarInicial(ini) {
      if (!ini) return;
      var l = form.linhas[0];
      var achou = false;
      agrupamentosValidos.forEach(function (g) { if (g.id === ini.agrupamentoId) achou = true; });
      if (achou) {
        l.agrupamentoId = ini.agrupamentoId;
        l.escopo = (ini.escopo === 'b' || ini.escopo === 'ambas') ? ini.escopo : 'a';
      }
      if (/^\d{1,2}:\d{2}$/.test(String(ini.inicio))) l.inicio = ini.inicio;
      if (/^\d{1,2}:\d{2}$/.test(String(ini.fim))) l.fim = ini.fim;
      if (C.dataValida(ini.data) && C.weekday(ini.data) !== 0) {
        l.data = ini.data;
        /* Trocar de modo preserva o que já foi preenchido, então o dia
           clicado também precisa fazer sentido na recorrente: vira o único
           dia da semana marcado e o começo da vigência. */
        form.dias = [C.weekday(ini.data)];
        if (ini.data >= lim.inicio && ini.data <= lim.fim) form.vigenciaInicio = ini.data;
      }
      encaixarNaJanela(l);
      /* Sem clínica apontada — o clique na grade da semana é por dia e hora,
         não por clínica — a escolhida é a primeira com cadeira LIVRE naquele
         horário, e não a primeira da lista. Cair sempre na Clínica 1 fazia o
         formulário abrir já bloqueado sempre que ela estivesse cheia, com as
         outras vazias ao lado; na tela isso se lê como "a agenda não deixa
         lançar", e não como "troque de clínica". */
      if (!achou && C.dataValida(l.data)) {
        var vago = primeiroEscopoLivre(l.data, l.inicio, l.fim);
        if (vago) {
          l.agrupamentoId = vago.agrupamentoId;
          l.escopo = vago.escopo;
        }
      }
    }

    /* Primeira clínica com ao menos uma cadeira livre no horário, varrendo
       os agrupamentos na ordem em que aparecem no seletor. A quantidade
       ainda não foi informada aqui — a lista de clínicas mostra quantas
       sobram em cada uma, e é ali que a pessoa acerta. Devolve null quando
       nenhuma tem vaga: aí o formulário abre na primeira mesmo, e o aviso de
       falta de cadeira é a resposta correta. */
    function primeiroEscopoLivre(data, inicio, fim) {
      var achado = null;
      agrupamentosValidos.forEach(function (g) {
        if (achado) return;
        var cls = S.clinicasDoAgrupamento(g.id);
        ['a', 'b'].forEach(function (esc, i) {
          if (achado || i >= cls.length) return;
          var d = S.disponibilidade({ agrupamentoId: g.id, escopo: esc, datas: [data], inicio: inicio, fim: fim });
          if (d.livres.length) achado = { agrupamentoId: g.id, escopo: esc };
        });
      });
      return achado;
    }

    function valorEscopo(agrupamentoId, escopo) { return agrupamentoId + '|' + escopo; }

    /* Lista única de escopos: cada clínica e, onde o agrupamento tem duas, a
       opção conjunta. Só o NOME da clínica: a especialidade saiu do rótulo em
       05/10/2026 — lida ao lado do nome, ela passava por nome de disciplina.
       As cadeiras livres no horário de cada linha são acrescentadas em
       `atualizar`, que é quem sabe o horário. */
    function opcoesEscopo() {
      var out = [];
      agrupamentosValidos.forEach(function (g) {
        var cls = S.clinicasDoAgrupamento(g.id);
        cls.forEach(function (c, i) {
          out.push({ valor: valorEscopo(g.id, i === 0 ? 'a' : 'b'), rotulo: c.nome });
        });
        if (cls.length > 1) {
          out.push({ valor: valorEscopo(g.id, 'ambas'), rotulo: g.nome + ' · as duas' });
        }
      });
      return out;
    }
    function rotuloBaseEscopo(v) {
      var achado = '';
      opcoesEscopo().forEach(function (o) { if (o.valor === v) achado = o.rotulo; });
      return achado;
    }

    function aplicarEscopo(l, v) {
      var p = String(v).split('|');
      if (!S.agrupamento(p[0])) return;
      l.agrupamentoId = p[0];
      l.escopo = p[1] === 'b' || p[1] === 'ambas' ? p[1] : 'a';
      encaixarNaJanela(l);
      desenhar();
    }

    /* ── Turnos ───────────────────────────────────────────────────────
       Atalho que preenche início e término de uma vez — e desde 05/10/2026
       aceita VÁRIOS: manhã e tarde marcadas dão 07:40–17:20. O início é o do
       primeiro turno marcado e o término, o do último.
       NÃO substituem os campos de hora: eles seguem livres, e digitar neles
       apenas desmarca os turnos. A marcação é DERIVADA do horário, não um
       estado à parte — então não existe como botão e campo discordarem.
       Por isso os turnos marcados são sempre uma faixa contínua: manhã e
       noite juntas cobrem a tarde, e a tarde aparece marcada, porque está. */
    function faixaDeTurnos(l) {
      var a = -1, b = -1;
      D.TURNOS.forEach(function (t, i) {
        if (t.inicio === l.inicio) a = i;
        if (t.fim === l.fim) b = i;
      });
      return (a === -1 || b === -1 || b < a) ? null : [a, b];
    }
    function turnoCabe(l, t) {
      var jan = janela(l);
      return C.toMin(t.inicio) >= C.toMin(jan.abertura) &&
        C.toMin(t.fim) <= C.toMin(jan.fechamento) &&
        C.toMin(t.fim) - C.toMin(t.inicio) >= duracaoMinima();
    }
    /* Clique num turno: o de fora estende a faixa até ele; o da ponta sai; o
       único marcado fica (sem turno nenhum não há horário). O do MEIO não sai
       sozinho — tirar a tarde de manhã-tarde-noite partiria a ocupação em
       duas, e uma ocupação é uma faixa contínua. */
    function clicarTurno(l, i) {
      var f = faixaDeTurnos(l), a, b;
      if (!f) { a = i; b = i; }
      else {
        a = f[0]; b = f[1];
        if (i < a) a = i;
        else if (i > b) b = i;
        else if (a === b) return;
        else if (i === a) a = i + 1;
        else if (i === b) b = i - 1;
        else {
          C.toast('Uma ocupação é uma faixa contínua: com manhã e noite marcadas, a tarde vai junto. ' +
            (modo === 'pontual' ? 'Para usar as duas sem a tarde, adicione outra ocupação.' : 'Para usar as duas sem a tarde, crie duas recorrências.'));
          return;
        }
      }
      l.inicio = D.TURNOS[a].inicio;
      l.fim = D.TURNOS[b].fim;
      desenhar();
    }

    /* Único lugar que decide a aparência dos botões — quem monta e quem
       re-sincroniza chamam a mesma função. Precisa existir separado da
       montagem porque os campos de hora chamam só `atualizar()`, sem
       redesenhar (redesenhar roubaria o foco de quem está digitando). */
    function sincronizarTurnos(l) {
      if (!l._turnos) return;
      var f = faixaDeTurnos(l);
      var jan = janela(l);
      D.TURNOS.forEach(function (t, i) {
        var b = l._turnos.querySelector('[data-turno="' + t.id + '"]');
        if (!b) return;
        var on = !!f && i >= f[0] && i <= f[1];
        var cabe = turnoCabe(l, t);
        b.className = on ? 'on' : '';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = !cabe;
        b.title = !cabe
          ? 'Não cabe na janela deste escopo (' + jan.abertura + '–' + jan.fechamento + ').'
          : on ? (f[0] === f[1] ? 'Turno marcado — clique em outro para somar' : 'Faz parte da faixa ' + D.TURNOS[f[0]].inicio + '–' + D.TURNOS[f[1]].fim)
            : 'Soma ' + t.rotulo.toLowerCase() + ' (' + t.inicio + '–' + t.fim + ') à faixa';
      });
    }
    function blocoTurnos(l) {
      l._turnos = C.el('div', { class: 'turnos' }, D.TURNOS.map(function (t, i) {
        return C.el('button', {
          type: 'button', 'data-turno': t.id,
          onclick: function () { clicarTurno(l, i); }
        }, [t.rotulo, C.el('small', { text: t.inicio + '–' + t.fim })]);
      }));
      sincronizarTurnos(l);
      return C.el('div', { style: 'margin-top:14px' }, [
        C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:7px', text: 'Turnos' }),
        l._turnos,
        C.el('small', { class: 'muted', style: 'display:block;margin-top:6px;font-size:11.5px',
          text: 'Marque um ou mais: o início e o término seguem os turnos marcados.' })
      ]);
    }

    /* Professor com a exigência ligada não registra: pede. Muda o rótulo do
       botão, o aviso do formulário e o toast — a ação é outra. */
    function souPedido() {
      return u.perfil === 'professor' && S.exigirAprovacao();
    }

    /* ── Disciplina e professor ───────────────────────────────────────
       A lista segue o TIPO: "Graduação" lista disciplinas, "Pós-graduação"
       lista especializações — uma lista só com as duas coisas dentro era o
       que fazia o campo oferecer disciplina depois de a pessoa escolher pós.
       O professor vê só as disciplinas a que foi vinculado em Acessos; a
       coordenação vê todas. "Outros" existe só na pontual: a recorrente
       precisa de disciplina, porque é ela que diz de quem é a aula. */
    function disciplinasVisiveis() {
      var l = S.disciplinasDoNivel(form.tipo);
      if (u.perfil !== 'professor') return l;
      return l.filter(function (d) { return S.professoresDaDisciplina(d).indexOf(u.id) !== -1; });
    }
    function opcoesDisciplina() {
      var l = disciplinasVisiveis().map(function (d) {
        return { valor: d.id, rotulo: S.rotuloDisciplinaLongo(d) };
      });
      if (modo === 'pontual') l.push({ valor: SEM_VINCULO, rotulo: 'Outros' });
      if (!l.length) l.push({ valor: '', rotulo: '— nenhuma ' + (form.tipo === 'pos' ? 'especialização' : 'disciplina') + ' disponível —' });
      return l;
    }
    /* Trocar o tipo ou o modo troca a lista, e a escolha anterior pode não
       existir mais nela. Sem este reencaixe o select ficaria mostrando um
       valor que a lista não contém — o campo em branco que se quer evitar. */
    function ajustarDisciplina() {
      var lista = disciplinasVisiveis();
      var valido = modo === 'pontual' && form.disciplinaId === SEM_VINCULO;
      lista.forEach(function (d) { if (d.id === form.disciplinaId) valido = true; });
      if (!valido) form.disciplinaId = lista.length ? lista[0].id : (modo === 'pontual' ? SEM_VINCULO : '');
      ajustarResponsavel();
    }
    function disciplinaEscolhida() {
      return form.disciplinaId && form.disciplinaId !== SEM_VINCULO ? S.disciplina(form.disciplinaId) : null;
    }
    function elegiveis() {
      return e.usuarios.filter(function (x) {
        return x.ativo && (x.perfil === 'professor' || x.perfil === 'coordenador');
      });
    }
    /* O professor responde pelo que pede. A coordenação escolhe — e a
       disciplina sugere: quem está vinculado a ela vem primeiro e é o padrão. */
    function ajustarResponsavel() {
      if (u.perfil === 'professor') { form.responsavelId = u.id; return; }
      var d = disciplinaEscolhida();
      var ativos = elegiveis().map(function (x) { return x.id; });
      var vinc = d ? S.professoresDaDisciplina(d).filter(function (id) { return ativos.indexOf(id) !== -1; }) : [];
      if (vinc.length && vinc.indexOf(form.responsavelId) === -1) form.responsavelId = vinc[0];
      if (ativos.indexOf(form.responsavelId) === -1) form.responsavelId = u.id;
    }
    function opcoesResponsavel() {
      var d = disciplinaEscolhida();
      var vinc = d ? S.professoresDaDisciplina(d) : [];
      function op(x) { return { valor: x.id, rotulo: x.nome + ' · ' + A.nomePerfil(x.perfil) }; }
      var ligados = elegiveis().filter(function (x) { return vinc.indexOf(x.id) !== -1; });
      var demais = elegiveis().filter(function (x) { return vinc.indexOf(x.id) === -1; });
      if (!ligados.length) return demais.map(op);
      return [
        { grupo: 'Vinculados à disciplina', itens: ligados.map(op) },
        { grupo: 'Demais professores', itens: demais.map(op) }
      ];
    }
    function vinculoGravavel() {
      return form.disciplinaId && form.disciplinaId !== SEM_VINCULO ? form.disciplinaId : null;
    }

    /* ── Desenho ──────────────────────────────────────────────────────── */
    function campoComDica(rotulo, controle, dica) {
      return C.el('label', { class: 'fld' }, [C.el('span', { text: rotulo }), controle, dica]);
    }

    function blocoLinha(l, i) {
      var cap = S.capacidadeEscopo(l.agrupamentoId, l.escopo);
      l._sel = U.selecao(opcoesEscopo(), valorEscopo(l.agrupamentoId, l.escopo), function (v) { aplicarEscopo(l, v); });
      l._dica = C.el('small', { class: 'muted', style: 'font-size:11.5px' });
      var qtd = C.el('input', {
        class: 'input', type: 'number', min: '1', max: String(cap), step: '1',
        inputmode: 'numeric', placeholder: 'quantas?', value: String(l.cadeiras),
        'aria-label': 'Quantidade de cadeiras',
        oninput: function (ev) { l.cadeiras = ev.target.value; atualizar(); }
      });
      var multi = modo === 'pontual' && form.linhas.length > 1;
      var campos = [
        U.campo('Clínica', l._sel),
        campoComDica('Cadeiras', qtd, l._dica)
      ];
      if (modo === 'pontual') {
        var l0 = limitesSemestre();
        var minPontual = maiorData(l0.inicio, C.hojeISO());
        if (minPontual > l0.fim) minPontual = l0.inicio;
        campos.push(U.campo('Data', C.el('input', {
          class: 'input', type: 'date', value: l.data, min: minPontual, max: l0.fim,
          oninput: function (ev) { l.data = ev.target.value; atualizar(); }
        })));
      }
      var jan = janela(l);
      return C.el('div', { class: modo === 'pontual' ? 'linha-ocup' : '' }, [
        modo === 'pontual' ? C.el('div', { class: 'linha-ocup-hd' }, [
          C.el('span', { class: 'eyebrow', text: multi ? 'Ocupação ' + (i + 1) : 'Ocupação' }),
          multi ? C.el('button', {
            class: 'btn-danger', type: 'button', text: 'Remover',
            'aria-label': 'Remover a ocupação ' + (i + 1),
            onclick: function () {
              form.linhas = form.linhas.filter(function (x) { return x !== l; });
              desenhar();
            }
          }) : null
        ]) : null,
        C.el('div', { class: 'grid-fields' }, campos),
        blocoTurnos(l),
        C.el('div', { class: 'grid-fields', style: 'margin-top:14px' }, [
          U.campo('Início', U.hora(l.inicio, function (v) {
            l.inicio = v; ajustarFim(l); atualizar();
          }, { min: jan.abertura, max: jan.fechamento })),
          U.campo('Término', U.hora(l.fim, function (v) {
            l.fim = v; atualizar();
          }, { min: jan.abertura, max: jan.fechamento }))
        ])
      ]);
    }

    function desenhar() {
      C.clear(corpo);
      var ehPos = form.tipo === 'pos';
      var nomeVinculo = ehPos ? 'especialização' : 'disciplina';

      /* Dizer que o pedido NÃO segura o horário é obrigatório: quem pede
         assume que pedir já garante, e aí descobre no dia. */
      if (modo === 'pontual' && souPedido()) {
        corpo.appendChild(C.el('div', {
          class: 'alert', style: 'margin-bottom:16px',
          text: 'Isto vai para a coordenação como pedido. Não reserva cadeira enquanto ' +
            'não for aprovado, e as mesmas cadeiras podem ser pedidas por outra pessoa nesse meio-tempo.'
        }));
      }

      /* Trocar o tipo REDESENHA, e não só atualiza: é o tipo que define
         qual lista o campo de disciplina mostra e como ele se chama. */
      corpo.appendChild(C.el('div', { class: 'grid-fields' }, [
        U.campo('Tipo', U.selecao(D.TIPOS_ATIVIDADE.map(function (t) {
          return { valor: t.id, rotulo: t.rotulo };
        }), form.tipo, function (v) {
          form.tipo = v; ajustarDisciplina(); desenhar();
        }), 'o nome da atividade vem do tipo e da ' + nomeVinculo),
        U.campo(ehPos ? 'Especialização' : 'Disciplina',
          U.selecao(opcoesDisciplina(), form.disciplinaId, function (v) {
            form.disciplinaId = v; ajustarResponsavel(); desenhar();
          }), modo === 'pontual' ? 'obrigatório — escolha "Outros" se não houver ' + nomeVinculo : null),
        U.campo('Professor coordenador', U.selecao(opcoesResponsavel(), form.responsavelId, function (v) {
          form.responsavelId = v; atualizar();
        }, u.perfil === 'professor' ? { disabled: true } : null))
      ]));

      if (u.perfil === 'professor' && !disciplinasVisiveis().length) {
        corpo.appendChild(C.el('div', { class: 'alert', style: 'margin-top:12px', text:
          'Você ainda não está vinculado a nenhuma ' + nomeVinculo + '. A coordenação faz o vínculo na tela Acessos; ' +
          'até lá, a ocupação pode ser pedida como "Outros".' }));
      }

      if (modo === 'recorrente') {
        corpo.appendChild(C.el('div', { style: 'margin-top:18px' }, blocoLinha(form.linhas[0], 0)));
        corpo.appendChild(C.el('div', { style: 'margin-top:16px' }, [
          C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:7px', text: 'Dias da semana' }),
          U.seletorDias(form.dias, function () { atualizar(); })
        ]));
        var l = limitesSemestre();
        corpo.appendChild(C.el('div', { class: 'grid-fields', style: 'margin-top:16px' }, [
          U.campo('Repete de', C.el('input', {
            class: 'input', type: 'date', value: form.vigenciaInicio, min: l.inicio, max: l.fim,
            oninput: function (ev) { form.vigenciaInicio = ev.target.value; atualizar(); }
          }), 'primeira semana'),
          U.campo('Repete até', C.el('input', {
            class: 'input', type: 'date', value: form.vigenciaFim, min: l.inicio, max: l.fim,
            oninput: function (ev) { form.vigenciaFim = ev.target.value; atualizar(); }
          }), 'fim do semestre ' + e.periodoLetivo)
        ]));
        acao.textContent = 'Criar recorrência';
      } else {
        var lista = C.el('div', { class: 'stack', style: 'gap:12px;margin-top:18px' });
        form.linhas.forEach(function (ln, i) { lista.appendChild(blocoLinha(ln, i)); });
        corpo.appendChild(lista);
        /* A nova ocupação nasce igual à última: o caso comum é repetir a
           atividade noutro dia ou noutra clínica, e só o que muda é editado. */
        corpo.appendChild(C.el('div', { class: 'row', style: 'gap:12px;margin-top:10px' }, [
          C.el('button', {
            class: 'btn btn-outline', type: 'button', text: '+ Adicionar ocupação',
            onclick: function () {
              form.linhas.push(novaLinha(form.linhas[form.linhas.length - 1]));
              desenhar();
            }
          }),
          C.el('small', { class: 'muted', style: 'font-size:11.5px',
            text: 'Mesma disciplina, professor e descrição; clínica, cadeiras, data e horário próprios.' })
        ]));
      }

      /* "Descrição/Turma" nos dois modos e nos dois tipos: a turma deixou de
         ser cadastro em 05/10/2026, e é aqui que ela é escrita. */
      corpo.appendChild(C.el('div', { style: 'margin-top:16px' },
        U.campo('Descrição/Turma', C.el('textarea', {
          class: 'input', rows: '2', value: form.descricao,
          placeholder: 'Qual turma e o que acontece nesta ocupação? Ex.: T1 · triagem. Fica visível para quem consulta a agenda.',
          oninput: function (ev) { form.descricao = ev.target.value; atualizar(); }
        }), 'a turma é escrita aqui')));

      if (modo === 'pontual') {
        var n = form.linhas.length;
        /* O botão não pode prometer "registrar" quando o que vai acontecer é
           um pedido esperando a coordenação. */
        acao.textContent = souPedido()
          ? (n > 1 ? 'Solicitar ' + n + ' ocupações' : 'Solicitar ocupação')
          : (n > 1 ? 'Registrar ' + n + ' atividades' : 'Registrar atividade');
      }
      atualizar();
    }

    /* Ao mudar o início, empurra o término mantendo a duração mínima. O teto
       é o fechamento real do escopo: um valor fora da janela deixava o campo
       inconsistente e o formulário guardava um término que não existe. */
    function ajustarFim(l) {
      if (C.toMin(l.fim) > C.toMin(l.inicio)) return;
      var teto = C.toMin(janela(l).fechamento);
      l.fim = C.fromMin(Math.min(teto, C.toMin(l.inicio) + duracaoMinima()));
      desenhar();
    }

    /* ── Validação, disponibilidade e prévia ───────────────────────── */
    function datasRecorrencia() {
      if (!C.dataValida(form.vigenciaInicio) || !C.dataValida(form.vigenciaFim)) return [];
      if (form.vigenciaFim < form.vigenciaInicio) return [];
      return S.datasDaRegra(form.dias, form.vigenciaInicio, form.vigenciaFim);
    }
    function datasDaLinha(l) {
      if (modo === 'pontual') return C.dataValida(l.data) ? [l.data] : [];
      return datasRecorrencia();
    }

    function errosDoHorario(l) {
      var erros = [];
      var jan = janela(l);
      if (!/^\d{1,2}:\d{2}$/.test(String(l.inicio)) || !/^\d{1,2}:\d{2}$/.test(String(l.fim))) {
        erros.push('Informe o início e o término.');
        return erros;
      }
      var dur = C.toMin(l.fim) - C.toMin(l.inicio);
      if (dur <= 0) erros.push('O término precisa ser depois do início.');
      else if (dur < e.parametros.faixaMinimaMin) {
        erros.push('A faixa mínima de ocupação é de ' + C.fmtHoras(e.parametros.faixaMinimaMin / 60) + '.');
      }
      if (C.toMin(l.inicio) < C.toMin(jan.abertura) || C.toMin(l.fim) > C.toMin(jan.fechamento)) {
        erros.push('O horário precisa ficar entre ' + jan.abertura + ' e ' + jan.fechamento +
          ' — é a janela de funcionamento deste escopo.');
      }
      return erros;
    }

    /* Analisa todas as linhas, em ordem. Cada linha disputa cadeira com as
       reservas gravadas E com as linhas anteriores do mesmo formulário: duas
       linhas na mesma clínica e horário somam cadeiras, e o formulário não
       pode prometer as duas se só cabe uma. */
    function analisar() {
      var l0 = limitesSemestre();
      var minPontual = maiorData(l0.inicio, C.hojeISO());
      if (minPontual > l0.fim) minPontual = l0.inicio;
      var gerais = [];

      if (!form.disciplinaId) {
        gerais.push(modo === 'recorrente'
          ? 'Selecione a ' + (form.tipo === 'pos' ? 'especialização' : 'disciplina') + '.'
          : (form.tipo === 'pos' ? 'Selecione a especialização, ou escolha "Outros".'
            : 'Selecione a disciplina, ou escolha "Outros".'));
      } else if (form.disciplinaId !== SEM_VINCULO && !S.disciplina(form.disciplinaId)) {
        gerais.push('A disciplina escolhida não existe mais — escolha outra.');
      }
      if (!form.responsavelId || !S.pessoa(form.responsavelId)) gerais.push('Informe o professor coordenador.');

      if (modo === 'recorrente') {
        if (!form.dias.length) gerais.push('Escolha ao menos um dia da semana.');
        else if (form.dias.indexOf(0) !== -1) {
          gerais.push('Domingo não entra na grade da semana — escolha de segunda a sábado.');
        }
        if (!C.dataValida(form.vigenciaInicio) || !C.dataValida(form.vigenciaFim)) {
          gerais.push('Informe o período de vigência.');
        } else if (form.vigenciaFim < form.vigenciaInicio) {
          gerais.push('"Repete até" precisa ser depois de "Repete de".');
        } else if (form.vigenciaInicio < l0.inicio || form.vigenciaFim > l0.fim) {
          gerais.push('A vigência precisa ficar dentro do semestre — de ' +
            C.fmtDiaAno(l0.inicio) + ' a ' + C.fmtDiaAno(l0.fim) + '.');
        } else if (!datasRecorrencia().length) {
          gerais.push('O período de vigência não gera nenhum encontro.');
        }
      }

      var extras = [];
      var linhas = (modo === 'recorrente' ? form.linhas.slice(0, 1) : form.linhas).map(function (l, i) {
        var erros = errosDoHorario(l);
        var cap = S.capacidadeEscopo(l.agrupamentoId, l.escopo);
        var qtd = inteiro(l.cadeiras);
        /* Vazia trava o envio, mas não vira alerta vermelho: formulário
           recém-aberto que acusa erro antes de a pessoa digitar ensina a
           ignorar alerta. Quem avisa é a dica do próprio campo. */
        var semQuantidade = String(l.cadeiras).trim() === '';
        if (!semQuantidade && (qtd === null || qtd < 1)) {
          erros.push('A quantidade de cadeiras precisa ser um número inteiro a partir de 1.');
        } else if (!semQuantidade && qtd > cap) {
          erros.push(S.rotuloEscopoCurto(l.agrupamentoId, l.escopo) + ' tem ' + C.plural(cap, 'cadeira') + ' — peça até ' + cap + '.');
        }
        if (modo === 'pontual') {
          if (!C.dataValida(l.data)) erros.push('Informe a data.');
          else if (C.weekday(l.data) === 0) erros.push('Domingo não entra na grade da semana — escolha de segunda a sábado.');
          else if (l.data < minPontual || l.data > l0.fim) {
            erros.push('A data precisa ficar entre ' + C.fmtDiaAno(minPontual) + ' e ' + C.fmtDiaAno(l0.fim) + '.');
          }
        }
        var datas = datasDaLinha(l);
        var disp = (datas.length && !errosDoHorario(l).length)
          ? S.disponibilidade({
            agrupamentoId: l.agrupamentoId, escopo: l.escopo, datas: datas,
            inicio: l.inicio, fim: l.fim, quantidade: qtd || 0,
            extras: extras.filter(function (x) { return x.agrupamentoId === l.agrupamentoId; })
              .map(function (x) { return x.item; })
          })
          : null;
        var falta = !!disp && qtd > 0 && qtd <= cap && disp.livres.length < qtd;
        var resultado = {
          l: l, i: i, erros: erros, datas: datas, disp: disp, qtd: qtd, cap: cap, falta: falta,
          semQuantidade: semQuantidade
        };
        /* A linha entra como item virtual para as seguintes — com as
           cadeiras que ela levaria, ou com as que sobram, se faltar. */
        if (disp && qtd > 0) {
          var cad = disp.sugestao || disp.livres.slice(0, qtd);
          if (cad.length) {
            extras.push({
              agrupamentoId: l.agrupamentoId,
              item: {
                id: '__linha' + l.id, tipo: 'pontual', escopo: l.escopo, inicio: l.inicio, fim: l.fim,
                data: modo === 'pontual' ? l.data : null, dias: null, excecoes: [], cadeiras: cad
              }
            });
          }
        }
        return resultado;
      });
      return { gerais: gerais, linhas: linhas };
    }

    function rotuloDaDisputa(x) {
      var r = S.reservaPorId(x.item.id);
      var quem = r ? S.rotuloReserva(r) : 'outra ocupação deste formulário';
      return C.fmtDia(x.datas[0]) + ' ' + x.item.inicio + '–' + x.item.fim + ' · ' + quem +
        ' (' + C.plural(x.cadeiras.length, 'cadeira', 'cadeiras') + ')';
    }

    function atualizar() {
      var an = analisar();
      var multi = modo === 'pontual' && form.linhas.length > 1;

      /* Linhas: turnos, dica da quantidade e cadeiras livres por clínica. */
      an.linhas.forEach(function (r) {
        var l = r.l;
        sincronizarTurnos(l);
        if (l._dica) {
          var txt = (r.semQuantidade ? 'obrigatório · ' : '') + 'de ' + r.cap;
          if (r.disp) {
            txt += ' · ' + C.plural(r.disp.livres.length, 'livre', 'livres') + ' neste horário';
            if (r.disp.sugestao) txt += ' · ficariam as ' + C.faixasNumeros(r.disp.sugestao);
          }
          l._dica.textContent = txt;
          l._dica.style.color = r.falta ? 'var(--danger)' : '';
        }
        /* As cadeiras livres de cada clínica, no horário DESTA linha, vão no
           próprio seletor: é ali que a pessoa decide para onde ir quando a
           escolhida não comporta a turma. */
        if (l._sel && !errosDoHorario(l).length && r.datas.length) {
          Array.prototype.forEach.call(l._sel.options, function (op) {
            var p = String(op.value).split('|');
            if (!S.agrupamento(p[0])) return;
            var d = S.disponibilidade({
              agrupamentoId: p[0], escopo: p[1], datas: r.datas, inicio: l.inicio, fim: l.fim,
              extras: an.linhas.filter(function (o) { return o.i < r.i && o.l.agrupamentoId === p[0] && o.disp; })
                .map(function (o) {
                  return {
                    id: '__linha' + o.l.id, tipo: 'pontual', escopo: o.l.escopo, inicio: o.l.inicio, fim: o.l.fim,
                    data: modo === 'pontual' ? o.l.data : null, dias: null, excecoes: [],
                    cadeiras: o.disp.sugestao || o.disp.livres.slice(0, o.qtd || 0)
                  };
                }).filter(function (it) { return it.cadeiras.length; })
            });
            var base = rotuloBaseEscopo(op.value);
            var novo = base + ' · ' + C.plural(d.livres.length, 'livre', 'livres');
            if (op.textContent !== novo) op.textContent = novo;
          });
        }
      });

      /* Prévia */
      C.clear(painelPre);
      var d = disciplinaEscolhida();
      var rotuloDisc = d ? S.rotuloDisciplinaLongo(d) : (form.disciplinaId === SEM_VINCULO ? 'Outros' : '—');
      if (modo === 'recorrente') {
        var r0 = an.linhas[0], l0 = r0.l;
        var dur = C.duracaoH(l0.inicio, l0.fim);
        if (isNaN(dur) || dur < 0) dur = 0;
        painelPre.appendChild(C.el('div', {}, [
          C.el('b', { text: 'Repete toda semana' }), ' · ',
          C.el('b', { text: C.listaDias(form.dias) }), ' · ',
          C.el('b', { text: l0.inicio + '–' + l0.fim }),
          ' · ' + C.fmtHoras(dur) + ' por encontro',
          l0.escopo === 'ambas'
            ? C.el('span', { class: 'badge conjunta', style: 'margin-left:8px', text: 'Nas duas clínicas' })
            : null
        ]));
        painelPre.appendChild(C.el('div', { class: 'muted' }, [
          C.plural(r0.datas.length, 'encontro', 'encontros') +
          ' entre ' + (C.dataValida(form.vigenciaInicio) ? C.fmtDiaAno(form.vigenciaInicio) : '—') +
          ' e ' + (C.dataValida(form.vigenciaFim) ? C.fmtDiaAno(form.vigenciaFim) : '—') +
          ' · ' + C.fmtHoras(dur * r0.datas.length) + ' no semestre'
        ]));
        painelPre.appendChild(C.el('div', { class: 'muted' }, [
          rotuloDisc + ' · ' + S.rotuloEscopoCurto(l0.agrupamentoId, l0.escopo) + ' · ' +
          (r0.qtd ? C.plural(r0.qtd, 'cadeira', 'cadeiras') +
            (r0.disp && r0.disp.sugestao ? ' (' + C.faixasNumeros(r0.disp.sugestao) + ')' : '') : 'cadeiras a informar') +
          ' · professor coordenador: ' + S.nomePessoa(form.responsavelId)
        ]));
      } else {
        painelPre.appendChild(C.el('div', {}, [
          C.el('b', { text: S.rotuloTipoAtividade(form.tipo) + ' · ' + rotuloDisc }),
          ' · professor coordenador: ' + S.nomePessoa(form.responsavelId)
        ]));
        an.linhas.forEach(function (r) {
          var l = r.l;
          var dur = C.duracaoH(l.inicio, l.fim);
          if (isNaN(dur) || dur < 0) dur = 0;
          painelPre.appendChild(C.el('div', { class: 'muted' }, [
            (multi ? (r.i + 1) + '. ' : 'Uma vez · ') +
            (C.dataValida(l.data) ? C.nomeDia(C.weekday(l.data)) + ', ' + C.fmtDiaAno(l.data) : '—') +
            ' · ' + l.inicio + '–' + l.fim + ' (' + C.fmtHoras(dur) + ') · ' +
            S.rotuloEscopoCurto(l.agrupamentoId, l.escopo) + ' · ' +
            (r.qtd ? C.plural(r.qtd, 'cadeira', 'cadeiras') +
              (r.disp && r.disp.sugestao && !souPedido() ? ' (' + C.faixasNumeros(r.disp.sugestao) + ')' : '')
              : 'cadeiras a informar')
          ]));
        });
        if (souPedido()) {
          painelPre.appendChild(C.el('div', { class: 'muted', text:
            'As cadeiras são escolhidas na aprovação, da menor para a maior entre as livres.' }));
        }
      }

      /* Avisos */
      C.clear(avisos);
      var bloqueia = an.gerais.length > 0;
      an.gerais.forEach(function (m) {
        avisos.appendChild(C.el('div', { class: 'alert danger', text: m }));
      });
      var pular = [];
      an.linhas.forEach(function (r) {
        var prefixo = multi ? 'Ocupação ' + (r.i + 1) + ': ' : '';
        if (r.semQuantidade) bloqueia = true;
        r.erros.forEach(function (m) {
          bloqueia = true;
          avisos.appendChild(C.el('div', { class: 'alert danger', text: prefixo + m }));
        });
        if (r.falta) {
          bloqueia = true;
          var amostra = r.disp.disputas.slice(0, 3).map(rotuloDaDisputa).join(' · ');
          var semVaga = r.disp.datasSemVaga;
          /* Nós do DOM, e não markup: o título de uma atividade é escrito por
             usuário e chegava cru ao innerHTML. */
          avisos.appendChild(C.el('div', { class: 'alert' }, [
            C.el('b', { text: prefixo + 'faltam cadeiras em ' + S.rotuloEscopoCurto(r.l.agrupamentoId, r.l.escopo) + '.' }),
            ' A ocupação pede ' + C.plural(r.qtd, 'cadeira', 'cadeiras') + ' e ' +
            (r.disp.livres.length === 1 ? 'só 1 está livre' : r.disp.livres.length
              ? 'só ' + r.disp.livres.length + ' estão livres' : 'nenhuma está livre') +
            (modo === 'recorrente' ? ' em todas as datas' : '') + ' neste horário.',
            amostra ? C.el('br') : null,
            amostra ? 'Já reservado: ' + amostra + (r.disp.disputas.length > 3 ? ' · e mais ' + (r.disp.disputas.length - 3) + '.' : '') : null,
            C.el('br'),
            modo === 'recorrente' && semVaga.length && semVaga.length < r.datas.length
              ? 'Faltam cadeiras em ' + C.plural(semVaga.length, 'data', 'datas') + ' — dá para criar pulando ' +
                (semVaga.length === 1 ? 'ela' : 'elas') + ', ou ajustar a quantidade, o horário ou a clínica.'
              : 'Ajuste a quantidade, o horário ou a clínica — a lista de clínicas mostra quantas estão livres em cada uma.'
          ]));
          if (modo === 'recorrente') pular = semVaga;
        }
      });

      acao.disabled = bloqueia;

      /* "Pular" só resolve quando, sem as datas cheias, a mesma alocação cabe
         em todas as outras — a recorrente usa as mesmas cadeiras toda semana. */
      var podePular = false;
      if (modo === 'recorrente' && pular.length && !an.gerais.length && !an.linhas[0].erros.length) {
        var r0b = an.linhas[0];
        if (pular.length < r0b.datas.length) {
          var restantes = r0b.datas.filter(function (dt) { return pular.indexOf(dt) === -1; });
          var d2 = S.disponibilidade({
            agrupamentoId: r0b.l.agrupamentoId, escopo: r0b.l.escopo, datas: restantes,
            inicio: r0b.l.inicio, fim: r0b.l.fim, quantidade: r0b.qtd
          });
          podePular = d2.livres.length >= r0b.qtd;
        }
      }
      if (podePular) {
        acaoPular.style.display = '';
        acaoPular.textContent = 'Criar pulando ' + C.plural(pular.length, 'data', 'datas') + ' sem cadeira';
      } else {
        acaoPular.style.display = 'none';
      }
    }

    /* ── Gravação ─────────────────────────────────────────────────── */
    function gravarRecorrencia(pular) {
      /* Reconferência: disciplina vazia vira "Sem disciplina" na agenda
         inteira — o formulário não deixa, e a gravação também não. */
      if (!S.pode('agenda.criarRecorrente') || !vinculoGravavel()) return null;
      var l = form.linhas[0];
      /* As datas puladas vão JUNTO na criação. Gravá-las depois, por
         `cancelarOcorrencia`, era uma segunda escrita correndo com a
         transação da primeira — e o resumo que a transação leva para o índice
         sairia sem elas, fazendo a própria gravação ser recusada pela falta
         que o botão existe para contornar. */
      var r = S.criarRecorrencia({
        agrupamentoId: l.agrupamentoId, escopo: l.escopo,
        disciplinaId: vinculoGravavel(), responsavelId: form.responsavelId,
        tipoAtividade: form.tipo, cadeiras: inteiro(l.cadeiras),
        dias: form.dias, inicio: l.inicio, fim: l.fim,
        vigenciaInicio: form.vigenciaInicio, vigenciaFim: form.vigenciaFim,
        descricao: form.descricao,
        pular: pular || []
      });
      var total = datasRecorrencia().length;
      if (r && pular && pular.length) total = Math.max(0, total - pular.length);
      C.toast('Recorrência criada · ' + C.plural(total, 'encontro', 'encontros') +
        ' até ' + C.fmtDiaAno(form.vigenciaFim) + ' · cadeiras ' + S.textoCadeiras(S.cadeirasDe(r)));
      return r;
    }

    function registrar() {
      var an = analisar();
      if (an.gerais.length) return;
      for (var i = 0; i < an.linhas.length; i++) {
        if (an.linhas[i].erros.length || an.linhas[i].falta || an.linhas[i].semQuantidade) return;
      }
      var res;
      if (modo === 'recorrente') {
        res = gravarRecorrencia(null);
        if (!res) return;
      } else {
        if (!S.pode('agenda.criarPontual')) return;
        /* Uma por vez e em ordem: cada gravação entra no cache antes da
           seguinte, e a seguinte escolhe as cadeiras dela já sabendo das que
           a anterior levou. */
        res = form.linhas.map(function (l) {
          return S.criarPontual({
            agrupamentoId: l.agrupamentoId, escopo: l.escopo,
            data: l.data, inicio: l.inicio, fim: l.fim,
            cadeiras: inteiro(l.cadeiras),
            tipoAtividade: form.tipo,
            descricao: form.descricao,
            /* `vinculoGravavel` traduz "Outros" para null: o valor é do
               formulário e não do modelo, e o Firestore não pode recebê-lo. */
            disciplinaId: vinculoGravavel(), responsavelId: form.responsavelId
          });
        });
        var n = res.length;
        var pendente = res[0] && res[0].situacao === 'pendente';
        C.toast(pendente
          ? (n > 1 ? n + ' pedidos enviados' : 'Pedido enviado') + ' para a coordenação — vale' + (n > 1 ? 'm' : '') + ' só depois de aprovado' + (n > 1 ? 's' : '') + '.'
          : n > 1 ? n + ' atividades registradas.'
            : 'Atividade registrada em ' + C.fmtDiaAno(form.linhas[0].data) + ' · cadeiras ' + S.textoCadeiras(S.cadeirasDe(res[0])) + '.');
      }
      if (opcoes.aoRegistrar) opcoes.aoRegistrar(res, modo);
    }

    /* Cria a recorrência já com as datas sem cadeira marcadas como exceção,
       em vez de deixar a disciplina inteira impossível de lançar. */
    function registrarPulando() {
      if (modo !== 'recorrente') return;
      var an = analisar();
      if (an.gerais.length || an.linhas[0].erros.length) return;
      var r0 = an.linhas[0];
      if (!r0.falta) { registrar(); return; }
      var pular = r0.disp.datasSemVaga;
      if (!pular.length || pular.length >= r0.datas.length) return;

      var lista = C.el('ul', { style: 'margin:10px 0 0;padding-left:18px' },
        pular.slice(0, 8).map(function (d) {
          return C.el('li', { text: C.nomeDia(C.weekday(d), true) + ', ' + C.fmtDiaAno(d) });
        }));
      U.confirmar({
        titulo: 'Criar pulando as datas sem cadeira',
        subtitulo: S.rotuloEscopo(r0.l.agrupamentoId, r0.l.escopo),
        rotulo: 'Criar assim',
        conteudo: C.el('div', {}, [
          C.el('span', {
            text: 'A recorrência fica com ' +
              C.plural(r0.datas.length - pular.length, 'encontro', 'encontros') + '. ' +
              C.plural(pular.length, 'data', 'datas') +
              (pular.length === 1 ? ' é registrada' : ' são registradas') + ' como exceção:'
          }),
          lista,
          pular.length > 8
            ? C.el('div', { class: 'muted', style: 'margin-top:6px', text: 'e mais ' + (pular.length - 8) + '.' })
            : null
        ])
      }, function () {
        var res = gravarRecorrencia(pular);
        if (res && opcoes.aoRegistrar) opcoes.aoRegistrar(res, modo);
      });
    }

    desenhar();
  }

  global.Registro = { montar: montar };
})(window);
