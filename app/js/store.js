/* store.js — estado, persistência e regras de negócio.
   Toda leitura de agenda passa por ocorrencias(): recorrências são
   expandidas em ocorrências concretas e mescladas às atividades pontuais. */
(function (global) {
  'use strict';
  var C = global.Core, A = global.Acesso, D = global.Dados;
  var N = global.Nuvem;
  var VERSAO = 6;

  var estado = null;
  var ouvintes = [];
  var usuarioAtual = null;

  /* ── Estado em memória ────────────────────────────────────────────────
     O acervo inteiro cabe em memória — 4 agrupamentos, 8 clínicas, um
     semestre de ocupações — então as LEITURAS do sistema continuam
     síncronas, servidas deste cache. Só as ESCRITAS são assíncronas.
     É o que permitiu trocar o armazenamento sem reescrever as sete telas. */
  function vazio() {
    return {
      versao: VERSAO,
      periodoLetivo: '',
      semestre: { inicio: '', fim: '' },
      parametros: {
        faixaMinimaMin: 120, capacidadeSemanalH: 60, bloquearSobreposicao: true,
        exigirMotivoManutencao: true, exigirAprovacaoProfessor: true,
        aberturaPadrao: '07:00', fechamentoPadrao: '22:00'
      },
      agrupamentos: [], clinicas: [], usuarios: [], alunos: [], disciplinas: [],
      turmas: [], recorrencias: [], pontuais: [], manutencoes: [], atribuicoes: []
    };
  }

  /* Documento de ocupação que a agenda consegue montar. Quarentena de
     entrada, e não zelo: o antigo "criar pulando as datas em conflito" podia
     gravar em `ocupacoes` um documento só com `excecoes` — sem `dias`, sem
     horário —, e a primeira expansão da agenda estourava TypeError em
     `r.dias.indexOf`, derrubando Agenda, Agora, Painel e Relatórios de todo
     mundo. O caminho que criava esses órfãos foi fechado em 18/09/2026, mas
     os que já estiverem gravados continuam chegando pelo onSnapshot.
     Ignorá-los aqui é o que impede um documento quebrado de derrubar o
     sistema inteiro — eles somem da tela, que é o que já acontecia na
     prática, só que sem levar o resto junto. */
  function ocupacaoUtil(o) {
    if (!o || !o.inicio || !o.fim) return false;
    if (o.tipo === 'pontual') return !!o.data;
    return !!(o.dias && o.dias.length) && !!o.vigenciaInicio && !!o.vigenciaFim;
  }

  /* Traduz o formato do Firestore para o formato que as telas já conhecem.
     Duas traduções valem nota:
       autorizados  -> usuarios   (o campo `nivel` vira `perfil`)
       ocupacoes    -> recorrencias + pontuais, separadas por `tipo`
     Assim nenhuma view precisou saber que os dados mudaram de lugar.
     `matriculas` -> turma.alunos saiu em 05/10/2026, junto com a turma: o
     vínculo de alunos deixou de existir na tela. As turmas ainda são lidas,
     cruas, só para as reservas antigas acharem a disciplina delas. */
  function hidratar(bruto) {
    var e = vazio();
    var cfg = bruto.config || {};
    if (cfg.periodoLetivo) e.periodoLetivo = cfg.periodoLetivo;
    if (cfg.semestre && cfg.semestre.inicio) e.semestre = cfg.semestre;
    if (cfg.parametros) {
      Object.keys(cfg.parametros).forEach(function (k) { e.parametros[k] = cfg.parametros[k]; });
    }

    e.agrupamentos = (bruto.agrupamentos || []).slice().sort(function (a, b) {
      return String(a.id).localeCompare(String(b.id));
    });
    /* Ordenar só por `primeiraCadeira` deixou de bastar em 22/09/2026: as duas
       pré-clínicas também começam no 1, e três clínicas empatadas davam uma
       ordem que dependia de como o Firestore tivesse devolvido a lista. O
       agrupamento desempata, e a ordem passa a ser a das abas: atendimento
       primeiro, pré-clínicas depois. */
    var ordemAg = {};
    e.agrupamentos.forEach(function (g, i) { ordemAg[g.id] = i; });
    function posAg(id) { return ordemAg[id] === undefined ? 99 : ordemAg[id]; }
    e.clinicas = (bruto.clinicas || []).slice().sort(function (a, b) {
      return posAg(a.agrupamentoId) - posAg(b.agrupamentoId) ||
        (a.primeiraCadeira || 0) - (b.primeiraCadeira || 0);
    });

    e.usuarios = (bruto.autorizados || []).map(function (a) {
      return {
        id: a.id, email: a.id,
        nome: a.nome || String(a.id).split('@')[0],
        perfil: a.nivel,
        ativo: a.ativo !== false,
        criadoEm: a.criadoEm || null,
        ultimoAcesso: a.ultimoAcesso || null
      };
    });

    e.alunos = (bruto.alunos || []).slice();
    e.disciplinas = (bruto.disciplinas || []).slice();
    e.turmas = (bruto.turmas || []).slice();

    (bruto.ocupacoes || []).forEach(function (o) {
      if (!ocupacaoUtil(o)) return;
      if (!o.excecoes) o.excecoes = [];
      if (o.tipo === 'pontual') e.pontuais.push(o); else e.recorrencias.push(o);
    });

    e.manutencoes = (bruto.manutencoes || []).slice();
    e.atribuicoes = (bruto.atribuicoes || []).slice();
    return e;
  }

  /* Carrega tudo do Firestore e liga as assinaturas. Devolve promessa. */
  function carregar() {
    estado = vazio();
    return N.carregarTudo().then(function (bruto) {
      estado = hidratar(bruto);
      N.assinarVivas(aoChegarMudanca);
      return estado;
    });
  }

  /* Uma coleção mudou no servidor — inclusive por gravação de outra pessoa.
     Reidrata só o que aquela coleção alimenta e avisa a interface. */
  function aoChegarMudanca(colecao, documentos) {
    if (!estado) return;
    if (colecao === 'ocupacoes') {
      estado.recorrencias = [];
      estado.pontuais = [];
      documentos.forEach(function (o) {
        if (!ocupacaoUtil(o)) return;
        if (!o.excecoes) o.excecoes = [];
        if (o.tipo === 'pontual') estado.pontuais.push(o); else estado.recorrencias.push(o);
      });
    } else if (colecao === 'autorizados') {
      estado.usuarios = documentos.map(function (a) {
        return {
          id: a.id, email: a.id, nome: a.nome || String(a.id).split('@')[0],
          perfil: a.nivel, ativo: a.ativo !== false,
          criadoEm: a.criadoEm || null, ultimoAcesso: a.ultimoAcesso || null
        };
      });
      /* Perder o acesso enquanto se está dentro do sistema tem de ter
         efeito imediato, não só no próximo login. */
      if (usuarioAtual) {
        var eu = porId(estado.usuarios, usuarioAtual.id);
        if (!eu || eu.ativo === false) { sair(); return; }
        usuarioAtual = eu;
      }
    } else if (colecao === 'disciplinas') {
      estado.disciplinas = documentos;
    } else if (colecao === 'manutencoes') {
      estado.manutencoes = documentos;
    } else if (colecao === 'atribuicoes') {
      estado.atribuicoes = documentos;
    }
    emitir();
  }

  function assinar(fn) { ouvintes.push(fn); }
  function emitir() { ouvintes.forEach(function (f) { f(); }); }
  /* Antes gravava no localStorage e avisava. Agora cada escrita fala com o
     Firestore por conta própria, e isto só reflete a mudança na tela. */
  function commit() { emitir(); }

  /* ── Sessão e permissões ────────────────────────────────────────────
     A identidade vem do Firebase Auth; o nível vem do documento
     autorizados/{email}. Uma coisa não substitui a outra: estar
     autenticado no Google não é estar autorizado neste sistema. */
  function usuario() { return usuarioAtual; }
  function euId() { return usuarioAtual ? usuarioAtual.id : null; }
  function pode(perm) { return A.pode(usuarioAtual, perm); }

  function perfilValido(id) {
    for (var i = 0; i < A.PERFIS.length; i++) if (A.PERFIS[i].id === id) return true;
    return false;
  }
  function recusa(motivo, mensagem) { return { ok: false, motivo: motivo, mensagem: mensagem }; }

  /* Recusa que também desfaz a autenticação: ficar logado no Google sem
     poder entrar no sistema deixaria o usuário preso numa tela sem saída. */
  function negar(motivo, mensagem) {
    usuarioAtual = null;
    return N.sair().then(function () { return recusa(motivo, mensagem); },
      function () { return recusa(motivo, mensagem); });
  }

  /* Abre o popup do Google. Devolve promessa de {ok:true, usuario} ou
     {ok:false, motivo, mensagem}. */
  function entrar() {
    return N.entrarComGoogle().then(function (cred) {
      return conferir(cred && cred.user);
    }, function (e) {
      var cod = e && e.code;
      if (cod === 'auth/popup-closed-by-user' || cod === 'auth/cancelled-popup-request') {
        return recusa('cancelado', 'Entrada cancelada.');
      }
      if (cod === 'auth/popup-blocked') {
        return recusa('popup_bloqueado',
          'O navegador bloqueou a janela do Google. Libere os pop-ups deste endereço e tente de novo.');
      }
      if (cod === 'auth/unauthorized-domain') {
        return recusa('dominio_nao_autorizado',
          'Este endereço não está entre os domínios autorizados do Firebase Auth.');
      }
      return recusa('falha', 'Não foi possível falar com o Google: ' + ((e && e.message) || cod || 'erro desconhecido'));
    });
  }

  /* Confere a conta autenticada contra a lista e, se passar, carrega o
     acervo. É chamada tanto no login quanto na reabertura da aba, quando o
     Firebase devolve a sessão que já existia. */
  function conferir(conta) {
    if (!conta || !conta.email) {
      return negar('sem_email', 'A conta Google não informou um endereço de e-mail.');
    }
    var email = String(conta.email).trim().toLowerCase();
    return N.lerAutorizado(email).then(function (reg) {
      if (!reg) {
        return negar('nao_autorizado',
          'Este e-mail não está na lista de acesso ao sistema. Fale com a coordenação.');
      }
      if (reg.ativo !== true) {
        return negar('suspenso', 'O seu acesso está suspenso. Fale com a coordenação.');
      }
      if (!perfilValido(reg.nivel)) {
        return negar('perfil_invalido',
          'O nível configurado para este e-mail é inválido: "' + reg.nivel + '".');
      }
      usuarioAtual = {
        id: email, email: email,
        nome: reg.nome || conta.displayName || email.split('@')[0],
        perfil: reg.nivel, ativo: true,
        criadoEm: reg.criadoEm || null, ultimoAcesso: reg.ultimoAcesso || null
      };
      return carregar().then(function () {
        /* Melhor esforço: se as regras não deixarem a pessoa escrever no
           próprio registro, o login não pode falhar por causa disso. */
        N.gravar('autorizados', email, {
          ultimoAcesso: C.carimbo(),
          nome: usuarioAtual.nome
        })['catch'](function () { });
        return { ok: true, usuario: usuarioAtual };
      });
    }, function (e) {
      return negar('leitura_negada',
        'Não foi possível consultar a lista de acesso: ' + ((e && e.message) || 'erro desconhecido'));
    });
  }

  function sair() {
    usuarioAtual = null;
    N.encerrarAssinaturas();
    return N.sair().then(function () { emitir(); }, function () { emitir(); });
  }


  /* ── Seletores ────────────────────────────────────────────────────── */
  function porId(lista, id) {
    for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i];
    return null;
  }
  /* Datas ISO comparam corretamente como texto; estas duas só existem para
     deixar as intenções de clamp legíveis. */
  function maiorISO(a, b) { if (!a) return b; if (!b) return a; return a > b ? a : b; }
  function menorISO(a, b) { if (!a) return b; if (!b) return a; return a < b ? a : b; }
  function clinica(id) { return porId(estado.clinicas, id); }
  function nomeClinica(id) { var c = clinica(id); return c ? c.nome : '—'; }

  /* ── Agrupamentos, escopos e cadeiras ───────────────────────────────
     Um agrupamento reúne duas clínicas de 14 cadeiras (ou uma pré-clínica
     sozinha). O escopo de uma ocupação diz ONDE ela está: 'a' a primeira
     clínica, 'b' a segunda, 'ambas' as duas. QUANTAS cadeiras ela segura é
     outra conversa desde 05/10/2026 — ver "Cadeiras da reserva", mais abaixo.
     Número de cadeira é único DENTRO da clínica (contínuo de 1 a 112 nas de
     atendimento, do 1 em cada pré-clínica) e, por consequência, único dentro
     do agrupamento; a posição dentro da clínica é n - primeiraCadeira + 1. */
  function agrupamento(id) { return porId(estado.agrupamentos, id); }
  function nomeAgrupamento(id) { var g = agrupamento(id); return g ? g.nome : '—'; }
  function clinicasDoAgrupamento(id) {
    var g = agrupamento(id);
    if (!g) return [];
    return g.clinicas.map(clinica).filter(function (c) { return !!c; });
  }
  function agrupamentoDaClinica(clinicaId) {
    var c = clinica(clinicaId);
    return c ? agrupamento(c.agrupamentoId) : null;
  }
  function clinicasDoEscopo(agrupamentoId, escopo) {
    var l = clinicasDoAgrupamento(agrupamentoId);
    if (escopo === 'a') return l.slice(0, 1);
    if (escopo === 'b') return l.slice(1, 2);
    return l;
  }
  function idsDoEscopo(agrupamentoId, escopo) {
    return clinicasDoEscopo(agrupamentoId, escopo).map(function (c) { return c.id; });
  }
  function escopoCobre(agrupamentoId, escopo, clinicaId) {
    return idsDoEscopo(agrupamentoId, escopo).indexOf(clinicaId) !== -1;
  }
  /* Duas ocupações disputam espaço quando compartilham ao menos uma clínica. */
  function escoposColidem(agA, escA, agB, escB) {
    if (agA !== agB) return false;
    var a = idsDoEscopo(agA, escA), b = idsDoEscopo(agB, escB);
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) !== -1) return true;
    return false;
  }
  function faixaCadeiras(clinicaId) {
    var c = clinica(clinicaId);
    if (!c) return [0, -1];
    return [c.primeiraCadeira, c.primeiraCadeira + c.cadeiras - 1];
  }
  function faixaEscopo(agrupamentoId, escopo) {
    var l = clinicasDoEscopo(agrupamentoId, escopo);
    if (!l.length) return [0, -1];
    return [faixaCadeiras(l[0].id)[0], faixaCadeiras(l[l.length - 1].id)[1]];
  }
  /* Todas as cadeiras de um escopo, na ordem em que a alocação as oferece: a
     primeira clínica do agrupamento antes da segunda, e dentro de cada uma da
     menor para a maior. É o "seguindo da menor até a maior" pedido para a
     ocupação automática. */
  function poolDoEscopo(agrupamentoId, escopo) {
    var saida = [];
    clinicasDoEscopo(agrupamentoId, escopo).forEach(function (c) {
      for (var i = 0; i < c.cadeiras; i++) saida.push(c.primeiraCadeira + i);
    });
    return saida;
  }
  /* Rótulo curto do LUGAR, para bloco de agenda: o nome da clínica, ou o do
     agrupamento quando a ocupação toma as duas. O longo (rotuloEscopo) traz a
     capacidade entre parênteses e não cabe num cartão de 104px. */
  function rotuloEscopoCurto(agrupamentoId, escopo) {
    var l = clinicasDoEscopo(agrupamentoId, escopo);
    if (!l.length) return '—';
    return l.length === 1 ? l[0].nome : nomeAgrupamento(agrupamentoId);
  }
  /* Tipo de AMBIENTE reservado — um dos dois eixos dos marcadores da agenda
     (o outro é o tipo de reserva). Três valores: uma clínica de atendimento,
     as duas clínicas do agrupamento, ou uma pré-clínica de laboratório. A
     pré-clínica é reconhecida pela especialidade ou pelo nome, que é o que a
     semente grava nelas. */
  function ehPreClinica(c) {
    return !!c && /pr[ée]-?\s*cl[íi]nica/i.test(String(c.especialidade || '') + ' ' + String(c.nome || ''));
  }
  function ambienteDe(agrupamentoId, escopo) {
    var l = clinicasDoEscopo(agrupamentoId, escopo);
    if (l.length > 1) return 'dupla';
    return ehPreClinica(l[0]) ? 'pre' : 'clinica';
  }
  /* O número da cadeira NÃO É MAIS ÚNICO NO POLO. As oito clínicas de
     atendimento seguem numeradas de 1 a 112, mas cada pré-clínica numera as
     suas do 1 — a 5 existe na Clínica 1, na Pré-clínica maior e na menor.
     Por isso quem procura precisa dizer ENTRE QUAIS clínicas procurar; sem
     `entre`, a busca varre o polo e devolve a primeira faixa que contém o
     número, o que só é confiável na numeração contínua do atendimento.
     Todo chamador que conhece a clínica (ou a ocupação) deve passar a lista
     — é isso que impede a cadeira 5 da pré-clínica virar cadeira 5 da
     Clínica 1 na hora de gravar. */
  function clinicaDaCadeira(n, entre) {
    var l = entre || estado.clinicas;
    for (var i = 0; i < l.length; i++) {
      var f = faixaCadeiras(l[i].id);
      if (n >= f[0] && n <= f[1]) return l[i];
    }
    return null;
  }
  /* "Clínica 3" para escopo simples, "Clínicas 3 e 4 (28 cadeiras)" para duplo. */
  function rotuloEscopo(agrupamentoId, escopo) {
    var l = clinicasDoEscopo(agrupamentoId, escopo);
    if (!l.length) return '—';
    if (l.length === 1) return l[0].nome;
    return nomeAgrupamento(agrupamentoId) + ' (' + capacidadeEscopo(agrupamentoId, escopo) + ' cadeiras)';
  }
  /* "Clínicas 3 e 4 · Clínica 4 · cadeira 51". `clinica` vem de quem sabe —
     com a numeração local das pré-clínicas, deduzi-la do número sozinho
     apontaria para a clínica errada. */
  function localCadeira(n, clinica) {
    var c = clinica || clinicaDaCadeira(n);
    if (!c) return 'cadeira ' + C.pad(n);
    var ag = nomeAgrupamento(c.agrupamentoId);
    /* Agrupamento de uma clínica só se chama como ela: "Pré-clínica maior ·
       Pré-clínica maior · cadeira 05" diz a mesma coisa duas vezes. */
    return (ag === c.nome ? '' : ag + ' · ') + c.nome + ' · cadeira ' + C.pad(n);
  }
  function capacidadeEscopo(agrupamentoId, escopo) {
    return clinicasDoEscopo(agrupamentoId, escopo).reduce(function (s, c) { return s + c.cadeiras; }, 0);
  }
  function cadeirasOperantesEscopo(agrupamentoId, escopo) {
    return clinicasDoEscopo(agrupamentoId, escopo).reduce(function (s, c) {
      return s + cadeirasOperantes(c.id);
    }, 0);
  }
  function turma(id) { return porId(estado.turmas, id); }
  function disciplina(id) { return porId(estado.disciplinas, id); }
  function aluno(id) { return porId(estado.alunos, id); }
  function pessoa(id) { return porId(estado.usuarios, id); }
  function nomePessoa(id) { var u = pessoa(id); return u ? u.nome : '—'; }

  /* Linha de apoio da pista do agrupamento: as clínicas que ele reúne. Vem
     vazia quando o agrupamento tem uma clínica só com o mesmo nome — é o caso
     das pré-clínicas, que são individuais, e repetir o nome logo abaixo dele
     não informa nada. */
  function subtituloAgrupamento(agrupamentoId) {
    var l = clinicasDoAgrupamento(agrupamentoId);
    if (l.length === 1 && l[0].nome === nomeAgrupamento(agrupamentoId)) return '';
    return l.map(function (c) { return c.nome; }).join(' · ');
  }
  /* ── Disciplinas ──────────────────────────────────────────────────────
     Desde 05/10/2026 disciplina é SÓ disciplina: código e nome na
     graduação, nome na pós. A turma saiu do cadastro e do formulário — quem
     precisa dizer que turma ocupa a clínica escreve na descrição da reserva
     ("Descrição/Turma") —, e a reserva aponta direto para a disciplina
     (`disciplinaId`).

     A pós continua sendo uma `disciplina` com `nivel: 'pos'`; sem `nivel` é
     graduação, que é o estado de tudo gravado antes de 18/09/2026. A turma
     interna que o sistema criava por trás de cada especialização deixou de
     ser necessária: ela existia porque a reserva recorrente precisava de uma
     turma para herdar o professor, e agora a reserva grava o professor nela
     mesma.

     O professor é ligado às disciplinas na tela ACESSOS, e o vínculo mora
     na disciplina (`professores`, lista de e-mails). Na disciplina, e não em
     `autorizados`, porque a escrita de `disciplinas` já é da coordenação nas
     Security Rules sem restrição de campo; a de `autorizados` tem regra por
     campo, e um campo novo ali só funcionaria depois de alguém mexer no
     console — o que não pode ser pré-requisito de nada que vai para `main`. */
  var CODIGO_TURMA_POS = 'PÓS';

  function ehEspecializacao(d) { return !!d && d.nivel === 'pos'; }
  function nivelDaDisciplina(d) { return ehEspecializacao(d) ? 'pos' : 'graduacao'; }
  function porNome(a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); }
  function especializacoes() {
    return estado.disciplinas.filter(ehEspecializacao).sort(porNome);
  }
  function disciplinasDeGraduacao() {
    return estado.disciplinas.filter(function (d) { return !ehEspecializacao(d); })
      .sort(function (a, b) {
        return String(a.codigo || a.nome).localeCompare(String(b.codigo || b.nome), 'pt-BR');
      });
  }
  function disciplinasDoNivel(nivel) {
    return nivel === 'pos' ? especializacoes() : disciplinasDeGraduacao();
  }

  /* Rótulos. A guarda de `d` nulo não é zelo: o título de toda ocorrência
     passa por aqui, e uma disciplina apagada direto no console do Firebase
     estourava TypeError dentro da montagem das ocorrências — o que derruba
     Agenda, Painel e Agora de uma vez.
     Na pós o nome da especialização É o rótulo; na graduação o rótulo curto
     é o código, e o nome vai para a linha de apoio. */
  function rotuloDisciplina(d) {
    if (!d) return '—';
    if (ehEspecializacao(d)) return d.nome;
    return d.codigo || d.nome;
  }
  function rotuloDisciplinaLongo(d) {
    if (!d) return '—';
    if (ehEspecializacao(d)) return 'Pós-graduação · ' + d.nome;
    return (d.codigo ? d.codigo + ' · ' : '') + d.nome;
  }
  function subtituloDisciplina(d) {
    if (!d) return '';
    return ehEspecializacao(d) ? 'Pós-graduação' : d.nome;
  }

  /* Professores vinculados. Gravados em `professores` desde 05/10/2026; a
     disciplina que ainda não tem o campo herda o vínculo antigo, que era o
     professor coordenador de cada TURMA dela. A limpeza do cadastro grava
     essa herança no documento — depois dela, nada mais lê turma para isso. */
  function professoresDaDisciplina(d) {
    if (!d) return [];
    if (Array.isArray(d.professores)) return d.professores.slice();
    var saida = [];
    estado.turmas.forEach(function (t) {
      if (t.disciplinaId !== d.id || !t.professorCoordenadorId) return;
      if (saida.indexOf(t.professorCoordenadorId) === -1) saida.push(t.professorCoordenadorId);
    });
    return saida;
  }
  function disciplinasDoProfessor(uid) {
    return estado.disciplinas.filter(function (d) {
      return professoresDaDisciplina(d).indexOf(uid) !== -1;
    });
  }

  /* ── Leitura da reserva, com o legado embutido ─────────────────────────
     Reserva gravada antes de 05/10/2026 não tem `disciplinaId`: aponta para
     uma turma. A recorrente também não tem `responsavelId` — ele saía da
     turma na hora de montar a ocorrência. Estas funções resolvem as duas
     formas, e nenhuma tela deve ler `disciplinaId`/`responsavelId` cru de um
     DOCUMENTO de reserva (a ocorrência já vem resolvida). A limpeza do
     cadastro grava o que hoje é derivado, e a partir dela o legado deixa de
     ser consultado. */
  function turmaLegada(o) { return (o && o.turmaId) ? turma(o.turmaId) : null; }
  function disciplinaIdDe(o) {
    if (!o) return null;
    if (o.disciplinaId) return o.disciplinaId;
    var t = turmaLegada(o);
    return t ? t.disciplinaId : null;
  }
  function disciplinaDe(o) { return disciplina(disciplinaIdDe(o)); }
  function responsavelDe(o) {
    if (!o) return null;
    if (o.responsavelId) return o.responsavelId;
    var t = turmaLegada(o);
    return t ? t.professorCoordenadorId : null;
  }
  /* A turma passou a ser escrita na descrição. Na reserva antiga ela estava
     no cadastro de turma e é trazida para o mesmo lugar: "T1 · …". A turma
     interna da pós ('PÓS') não diz nada a ninguém e fica de fora. */
  function rotuloTurmaTexto(codigo) {
    var c = String(codigo || '').trim();
    if (!c || c === CODIGO_TURMA_POS) return '';
    return /^t/i.test(c) ? c : 'Turma ' + c;
  }
  function descricaoDe(o) {
    if (!o) return '';
    var base = String(o.descricao || o.observacao || '').trim();
    if (!o.disciplinaId) {
      var t = turmaLegada(o);
      var tt = t ? rotuloTurmaTexto(t.codigo) : '';
      if (tt && base.indexOf(tt) === -1) base = tt + (base ? ' · ' + base : '');
    }
    return base;
  }
  /* Graduação ou pós. A reserva nova grava o tipo; a recorrente antiga era
     sempre 'aula' e a pontual antiga podia ter um dos sete tipos legados —
     nos dois casos quem decide é o nível da disciplina. */
  function nivelDe(o) {
    if (o && (o.tipoAtividade === 'pos' || o.tipoAtividade === 'graduacao')) return o.tipoAtividade;
    var d = disciplinaDe(o);
    return d ? nivelDaDisciplina(d) : 'graduacao';
  }

  /* O código não é pedido a ninguém — a pós não trabalha com código de
     disciplina. Ele existe porque o documento e as colunas de CSV anteriores
     à pós contam com ele. Sequencial sobre o que já está cadastrado. */
  function proximoCodigoPos() {
    var maior = 0;
    estado.disciplinas.forEach(function (d) {
      var m = /^POS-(\d+)$/.exec(String(d.codigo || ''));
      if (m && Number(m[1]) > maior) maior = Number(m[1]);
    });
    return 'POS-' + C.pad(maior + 1);
  }

  /* ── Manutenção: capacidade efetiva ───────────────────────────────── */
  function manutencoesAbertas(clinicaId) {
    return estado.manutencoes.filter(function (m) {
      return m.status === 'aberta' && (!clinicaId || m.clinicaId === clinicaId);
    });
  }
  /* `numero` é o número GLOBAL da cadeira. `clinicaId` é opcional e serve
     apenas para estreitar a busca. */
  function cadeiraEmManutencao(clinicaId, numero) {
    var abertas = manutencoesAbertas(clinicaId);
    for (var i = 0; i < abertas.length; i++) if (abertas[i].cadeira === numero) return abertas[i];
    return null;
  }
  /* Conta cadeiras DISTINTAS interditadas: dois chamados abertos na mesma
     cadeira não podem descontar duas cadeiras da capacidade. */
  function cadeirasInterditadas(clinicaId) {
    var f = faixaCadeiras(clinicaId), vistas = {}, total = 0;
    manutencoesAbertas(clinicaId).forEach(function (m) {
      if (m.cadeira < f[0] || m.cadeira > f[1]) return;
      if (vistas[m.cadeira]) return;
      vistas[m.cadeira] = true; total++;
    });
    return total;
  }
  function cadeirasOperantes(clinicaId) {
    var c = clinica(clinicaId);
    if (!c) return 0;
    return c.cadeiras - cadeirasInterditadas(clinicaId);
  }

  /* ── Cadeiras da reserva ──────────────────────────────────────────────
     Até 05/10/2026 a reserva era sempre INTEGRAL: reservar uma clínica
     tomava todas as cadeiras dela, e nada mais cabia ali no mesmo horário.
     Desde então a reserva diz QUANTAS cadeiras usa (`cadeirasPedidas`) e o
     sistema escolhe QUAIS (`cadeirasAlocadas`), da menor para a maior, entre
     as que nenhuma outra reserva segura naquele horário. O resto da clínica
     continua livre para outras reservas até as cadeiras acabarem — e as
     escolhidas já nascem marcadas como ocupadas, sem o professor registrar
     uma a uma.

     Três estados de documento:
       · com `cadeirasAlocadas` — reserva nova (ou ajustada): segura aquelas;
       · só com `cadeirasPedidas` — pedido do professor ainda não aprovado:
         não segura cadeira, como não segura horário; elas são escolhidas na
         aprovação;
       · sem nenhum dos dois — reserva gravada antes da mudança. Continua
         INTEGRAL, segurando o escopo inteiro, até alguém ajustar as cadeiras
         dela: não há como adivinhar quantas ela usaria.
     `cadeiras`, sem sufixo, é o nome antigo e segue ignorado: está gravado
     com valores de antes de 17/09/2026 que ninguém confirma mais.

     A alocação é a MESMA em todas as datas da reserva — a recorrente usa as
     mesmas cadeiras toda semana. Por isso uma cadeira só é livre para ela se
     estiver livre em TODAS as datas em que ela cai. */
  function numeroCrescente(a, b) { return a - b; }
  function ehIntegral(o) {
    return !!o && !Array.isArray(o.cadeirasAlocadas) && !o.cadeirasPedidas;
  }
  function quantidadeDe(o) {
    if (!o) return 0;
    if (Array.isArray(o.cadeirasAlocadas)) return o.cadeirasAlocadas.length;
    if (o.cadeirasPedidas) return Number(o.cadeirasPedidas) || 0;
    return capacidadeEscopo(o.agrupamentoId, o.escopo);
  }
  /* Cadeiras que o DOCUMENTO segura. Pedido pendente não segura nenhuma. */
  function cadeirasDe(o) {
    if (!o) return [];
    if (Array.isArray(o.cadeirasAlocadas)) return o.cadeirasAlocadas.slice().sort(numeroCrescente);
    if (o.cadeirasPedidas) return [];
    return poolDoEscopo(o.agrupamentoId, o.escopo);
  }
  function textoCadeiras(lista) {
    return lista && lista.length ? C.faixasNumeros(lista) : '—';
  }

  /* ── Expansão de recorrências ─────────────────────────────────────── */
  /* O que toda ocorrência carrega da reserva de origem — disciplina,
     professor, nível, descrição, ambiente e cadeiras —, já resolvido, com o
     legado embutido. As telas leem daqui, nunca do documento. */
  function baseDaOcorrencia(o) {
    var did = disciplinaIdDe(o);
    var d = disciplina(did);
    var lista = cadeirasDe(o);
    return {
      d: d, disciplinaId: did,
      cadeiras: lista.length, cadeirasLista: lista, integral: ehIntegral(o),
      responsavelId: responsavelDe(o), nivel: nivelDe(o), descricao: descricaoDe(o),
      ambiente: ambienteDe(o.agrupamentoId, o.escopo)
    };
  }
  function ocorrenciaDeRegra(r, data) {
    var b = baseDaOcorrencia(r);
    return {
      chave: 'r:' + r.id + ':' + data,
      origem: 'recorrente', origemId: r.id,
      agrupamentoId: r.agrupamentoId, escopo: r.escopo,
      data: data, inicio: r.inicio, fim: r.fim,
      disciplinaId: b.disciplinaId,
      /* Quantas e quais cadeiras a reserva segura; na reserva anterior a
         05/10/2026 é o escopo inteiro, e `integral` diz isso. */
      cadeiras: b.cadeiras, cadeirasLista: b.cadeirasLista, integral: b.integral,
      /* Pelo rótulo do Store: é o único que sabe que a pós se chama pelo nome
         da especialização — e o único que não estoura quando a disciplina
         foi apagada por fora, no console. */
      titulo: b.d ? rotuloDisciplina(b.d) : (b.disciplinaId ? 'Disciplina removida' : 'Sem disciplina'),
      subtitulo: subtituloDisciplina(b.d),
      responsavelId: b.responsavelId,
      tipoAtividade: 'aula', nivel: b.nivel, ambiente: b.ambiente,
      descricao: b.descricao
    };
  }
  /* Título DERIVADO: tipo + disciplina, ou tipo + quem pediu quando a
     atividade não tem disciplina ("Outros"). Deixou de ser campo digitado em
     17/09/2026 — cada pessoa escrevia num formato diferente e a mesma
     atividade aparecia com três nomes diferentes na agenda.
     `titulo` aparece sozinho em dez lugares (bloco da agenda, gantt, CSV,
     toasts), por isso carrega o tipo junto; o nome da disciplina vai para
     `subtitulo`, como na recorrente. */
  function tituloPontual(p) {
    var did = disciplinaIdDe(p), d = disciplina(did);
    return rotuloTipoAtividade(p.tipoAtividade) + ' · ' +
      (d ? rotuloDisciplina(d) : did ? 'Disciplina removida' : nomePessoa(responsavelDe(p)));
  }
  function ocorrenciaDePontual(p) {
    var b = baseDaOcorrencia(p);
    return {
      chave: 'p:' + p.id,
      origem: 'pontual', origemId: p.id,
      agrupamentoId: p.agrupamentoId, escopo: p.escopo,
      data: p.data, inicio: p.inicio, fim: p.fim,
      disciplinaId: b.disciplinaId,
      cadeiras: b.cadeiras, cadeirasLista: b.cadeirasLista, integral: b.integral,
      titulo: tituloPontual(p),
      subtitulo: subtituloDisciplina(b.d),
      /* Só existe em ocupação gravada antes da mudança. O detalhe da agenda
         mostra quando houver, para o texto que alguém escreveu não sumir. */
      tituloOriginal: p.titulo || '',
      responsavelId: b.responsavelId,
      tipoAtividade: p.tipoAtividade, nivel: b.nivel, ambiente: b.ambiente,
      descricao: b.descricao
    };
  }

  /* Filtro de agenda. Aceita null (tudo), uma string com id de clínica, ou
     { clinicaId } / { agrupamentoId }. Uma ocupação de escopo duplo aparece
     nas duas clínicas que ela toma — por isso o teste é de cobertura, e não
     de igualdade. */
  function casaFiltro(o, filtro) {
    if (!filtro) return true;
    if (typeof filtro === 'string') filtro = { clinicaId: filtro };
    if (filtro.agrupamentoId && o.agrupamentoId !== filtro.agrupamentoId) return false;
    if (filtro.clinicaId && !escopoCobre(o.agrupamentoId, o.escopo, filtro.clinicaId)) return false;
    return true;
  }

  /* Ocorrências de um dia, ordenadas por horário. */
  function ocorrenciasDoDia(data, filtro) {
    var dow = C.weekday(data), saida = [];
    /* Pelos seletores: reserva excluída não é ocupação, e pedido pendente ou
       recusado também não. Esta função é o funil de Agenda, Agora, Painel,
       relatórios e `conflitos` — filtrar aqui cobre o sistema inteiro. */
    recorrenciasAtivas().forEach(function (r) {
      if (r.dias.indexOf(dow) === -1) return;
      if (data < r.vigenciaInicio || data > r.vigenciaFim) return;
      /* encerradaEm é o primeiro dia inválido: "de hoje em diante" inclui hoje. */
      if (r.encerradaEm && data >= r.encerradaEm) return;
      for (var i = 0; i < r.excecoes.length; i++) if (r.excecoes[i].data === data) return;
      var o = ocorrenciaDeRegra(r, data);
      if (!casaFiltro(o, filtro)) return;
      saida.push(o);
    });
    pontuaisAtivas().forEach(function (p) {
      if (p.data !== data) return;
      var o = ocorrenciaDePontual(p);
      if (!casaFiltro(o, filtro)) return;
      saida.push(o);
    });
    return saida.sort(function (a, b) {
      return C.toMin(a.inicio) - C.toMin(b.inicio) ||
        String(a.agrupamentoId).localeCompare(String(b.agrupamentoId));
    });
  }

  function ocorrenciasIntervalo(ini, fim, filtro) {
    var saida = [], d = ini;
    var guarda = 0;
    while (d <= fim && guarda++ < 400) {
      saida = saida.concat(ocorrenciasDoDia(d, filtro));
      d = C.addDays(d, 1);
    }
    return saida;
  }

  /* Datas em que uma regra ocorre dentro de um intervalo. */
  function datasDaRegra(dias, vigInicio, vigFim, limite) {
    var saida = [], d = vigInicio, guarda = 0;
    while (d <= vigFim && guarda++ < 400) {
      if (dias.indexOf(C.weekday(d)) !== -1) {
        saida.push(d);
        if (limite && saida.length >= limite) break;
      }
      d = C.addDays(d, 1);
    }
    return saida;
  }

  function statusOcorrencia(o) {
    var hoje = C.hojeISO(), agora = C.agoraHHMM();
    if (o.data < hoje) return 'encerrada';
    if (o.data > hoje) return 'agendada';
    if (C.toMin(agora) < C.toMin(o.inicio)) return 'agendada';
    if (C.toMin(agora) >= C.toMin(o.fim)) return 'encerrada';
    return 'em_andamento';
  }

  /* ── Régua de horas da grade ──────────────────────────────────────────
     Mora aqui, e não na Agenda, porque a tela e a folha impressa precisam
     abrir e fechar o dia na MESMA hora — é o que a impressão promete. Duas
     cópias da derivação divergiriam na primeira clínica que mudasse de
     horário, e a folha passaria a mostrar uma semana que não é a que está na
     tela.

     A janela nunca é menor que 07h–21h, e cresce com o que existir: os
     horários gravados em cada clínica, os parâmetros do polo e as próprias
     ocupações das datas mostradas — uma ocupação das 22:00 às 23:00 estava
     sendo descartada em silêncio quando o teto era fixo. Devolve
     [primeiraHora, ultimaHora], ambas inclusivas. */
  var H0_MIN = 7, H1_MIN = 21;
  function janelaHoras(datas) {
    var p = estado.parametros || {};
    var ini = Math.min(H0_MIN * 60, C.toMin(p.aberturaPadrao || '07:00'));
    var fim = Math.max((H1_MIN + 1) * 60, C.toMin(p.fechamentoPadrao || '22:00'));
    estado.clinicas.forEach(function (c) {
      if (c.abertura) ini = Math.min(ini, C.toMin(c.abertura));
      if (c.fechamento) fim = Math.max(fim, C.toMin(c.fechamento));
    });
    (datas || []).forEach(function (d) {
      ocorrenciasDoDia(d).forEach(function (o) {
        ini = Math.min(ini, C.toMin(o.inicio));
        fim = Math.max(fim, C.toMin(o.fim));
      });
    });
    var h0 = Math.floor(ini / 60);
    var h1 = Math.ceil(fim / 60) - 1;
    if (h1 < h0) h1 = h0;
    if (h1 > 23) h1 = 23;
    return [h0, h1];
  }

  /* `baldesPorHora` — que jogava cada ocorrência no balde da hora em que
     começava — saiu em 21/09/2026. A tela passou a posicionar o bloco pelo
     horário e a dimensioná-lo pela duração, e a folha impressa virou gantt
     de uma linha por dia: nenhuma das duas trabalha mais por hora cheia. */

  /* ── Disputa de cadeiras ──────────────────────────────────────────────
     Substituiu o antigo `conflitos` em 05/10/2026. Ele recusava qualquer
     cruzamento de horário na mesma clínica; com a reserva por quantidade,
     duas ocupações podem dividir a clínica no mesmo horário — o que não
     podem é dividir a CADEIRA.

     Toda a conta trabalha sobre ITENS na forma do índice
     (`resumoDaOcupacao`), e é a MESMA função que roda no formulário, sobre o
     cache, e dentro da transação, sobre o índice relido. Duas cópias da
     regra, uma em cada lado, divergiriam na primeira mudança — e o
     formulário passaria a prometer o que a gravação recusa. */

  /* Cadeiras de um item do índice: as alocadas, ou o escopo inteiro no item
     de reserva integral (gravado antes de 05/10/2026, sem `cadeiras`). */
  function cadeirasDoItem(agrupamentoId, it) {
    return (it.cadeiras && it.cadeiras.length) ? it.cadeiras : poolDoEscopo(agrupamentoId, it.escopo);
  }

  /* Itens que disputam cadeira com `alvo`: alguma clínica em comum, horário
     cruzado e ao menos uma data em comum. Cada disputa leva as DATAS do
     cruzamento — é com elas que a recorrente descobre em que dia falta
     cadeira. `datasAlvo` substitui as datas do alvo quando quem pergunta já
     as tem (o formulário, antes de o item existir). */
  function disputas(agrupamentoId, alvo, itens, datasAlvo) {
    var da = datasAlvo || datasDoItem(alvo);
    var mapa = {};
    da.forEach(function (d) { mapa[d] = true; });
    var saida = [];
    itens.forEach(function (it) {
      if (it.id === alvo.id) return;
      if (!escoposColidem(agrupamentoId, alvo.escopo, agrupamentoId, it.escopo)) return;
      if (!C.sobrepoe(alvo.inicio, alvo.fim, it.inicio, it.fim)) return;
      var comuns = datasDoItem(it).filter(function (d) { return mapa[d]; });
      if (!comuns.length) return;
      saida.push({ item: it, datas: comuns, cadeiras: cadeirasDoItem(agrupamentoId, it) });
    });
    return saida;
  }
  function tomadasPor(lista) {
    var s = {};
    lista.forEach(function (x) { x.cadeiras.forEach(function (n) { s[n] = true; }); });
    return s;
  }

  /* As N menores, deixando por último as que estão em manutenção AGORA:
     cadeira interditada não impede a reserva — o conserto costuma sair antes
     da aula, e a regra de antes já era essa —, mas não é oferecida antes de
     uma que funciona. */
  function menores(agrupamentoId, candidatas, n) {
    var cls = clinicasDoAgrupamento(agrupamentoId), boas = [], ruins = [];
    candidatas.slice().sort(numeroCrescente).forEach(function (num) {
      var c = clinicaDaCadeira(num, cls);
      (c && cadeiraEmManutencao(c.id, num) ? ruins : boas).push(num);
    });
    return boas.concat(ruins).slice(0, n).sort(numeroCrescente);
  }

  function frasesLivres(n) {
    if (n === 0) return 'nenhuma está livre';
    return n === 1 ? 'só 1 está livre' : 'só ' + n + ' estão livres';
  }

  /* Escolhe as cadeiras de `alvo` (um item do índice) contra `itens`.
       opcoes.quantidade  quantas
       opcoes.preferidas  as que ela já tem — mantidas se continuarem livres
       opcoes.fixo        só confere `preferidas`, sem trocar nenhuma: é o
                          caminho de quem escolheu cadeira por cadeira
       opcoes.checar      false quando a coordenação permitiu sobreposição
     Devolve { ok, cadeiras } ou { ok:false, mensagem }. */
  function alocar(agrupamentoId, alvo, itens, opcoes) {
    var pool = poolDoEscopo(agrupamentoId, alvo.escopo);
    var noPool = {};
    pool.forEach(function (n) { noPool[n] = true; });
    var tomadas = opcoes.checar === false ? {} : tomadasPor(disputas(agrupamentoId, alvo, itens));
    var livres = pool.filter(function (n) { return !tomadas[n]; });
    var pref = opcoes.preferidas || null;

    if (opcoes.fixo) {
      var presas = (pref || []).filter(function (n) { return !noPool[n] || tomadas[n]; });
      if (presas.length) {
        return {
          ok: false, presas: presas,
          mensagem: (presas.length === 1
            ? 'A cadeira ' + presas[0] + ' já está com outra reserva neste horário'
            : 'As cadeiras ' + C.faixasNumeros(presas) + ' já estão com outra reserva neste horário') +
            '. Se pareciam livres, alguém reservou enquanto você escolhia — reveja as cadeiras.'
        };
      }
      return { ok: true, cadeiras: (pref || []).slice().sort(numeroCrescente) };
    }
    var n = opcoes.quantidade;
    if (pref && pref.length === n && pref.every(function (x) { return noPool[x] && !tomadas[x]; })) {
      return { ok: true, cadeiras: pref.slice().sort(numeroCrescente) };
    }
    if (n > 0 && livres.length >= n) return { ok: true, cadeiras: menores(agrupamentoId, livres, n) };
    /* Cobre o choque com o que já estava lá e a corrida em que alguém gravou
       enquanto o formulário era preenchido. Culpar "outra pessoa" sempre
       seria mentira na primeira situação, que é a mais comum. */
    return {
      ok: false, livres: livres.length,
      mensagem: 'Faltam cadeiras em ' + rotuloEscopoCurto(agrupamentoId, alvo.escopo) +
        ': a reserva é de ' + C.plural(n, 'cadeira', 'cadeiras') + ' e ' + frasesLivres(livres.length) +
        ' neste horário. Se a agenda parecia livre, alguém reservou enquanto você preenchia — ' +
        'reveja a quantidade, o horário ou a clínica.'
    };
  }

  /* Itens do CACHE na forma do índice: o que segura cadeira neste
     agrupamento — reservas ativas e aprovadas. Pedido pendente e reserva
     excluída ficam de fora, como ficam fora do índice. */
  function itensLocais(agrupamentoId, ignorarId) {
    return recorrenciasAtivas().concat(pontuaisAtivas()).filter(function (o) {
      return o.agrupamentoId === agrupamentoId && o.id !== ignorarId;
    }).map(resumoDaOcupacao);
  }

  /* Quanto cabe, para o formulário: dado onde, quando e quantas, diz quais
     cadeiras ficam livres em TODAS as datas, quantas ficam livres em cada
     data, quem disputa e quais seriam as escolhidas.
     `extras` são itens que ainda não existem — as outras linhas do mesmo
     formulário, que disputam cadeira com esta igual a uma reserva gravada. */
  function disponibilidade(q) {
    var ag = q.agrupamentoId;
    var pool = poolDoEscopo(ag, q.escopo);
    var alvo = { id: q.ignorarId || '__novo', escopo: q.escopo, inicio: q.inicio, fim: q.fim };
    var lista = estado.parametros.bloquearSobreposicao !== false
      ? disputas(ag, alvo, itensLocais(ag, q.ignorarId).concat(q.extras || []), q.datas)
      : [];
    var tomadas = tomadasPor(lista);
    var livres = pool.filter(function (n) { return !tomadas[n]; });
    var porData = {};
    q.datas.forEach(function (d) { porData[d] = {}; });
    lista.forEach(function (x) {
      x.datas.forEach(function (d) {
        x.cadeiras.forEach(function (n) { porData[d][n] = true; });
      });
    });
    var livresNaData = {};
    q.datas.forEach(function (d) {
      livresNaData[d] = pool.filter(function (n) { return !porData[d][n]; }).length;
    });
    var qtd = Number(q.quantidade) || 0;
    return {
      pool: pool, livres: livres, livresNaData: livresNaData, disputas: lista,
      sugestao: qtd > 0 && livres.length >= qtd ? menores(ag, livres, qtd) : null,
      datasSemVaga: qtd > 0 ? q.datas.filter(function (d) { return livresNaData[d] < qtd; }) : []
    };
  }

  /* Para o seletor de cadeiras: de quem é cada cadeira do escopo durante a
     reserva `o` — em qualquer das datas dela, porque a alocação vale para
     todas. */
  function mapaDeCadeiras(o) {
    var resumo = resumoDaOcupacao(o);
    var lista = disputas(o.agrupamentoId, resumo, itensLocais(o.agrupamentoId, o.id));
    var donos = {};
    lista.forEach(function (x) {
      x.cadeiras.forEach(function (n) {
        if (!donos[n]) donos[n] = [];
        if (donos[n].indexOf(x.item.id) === -1) donos[n].push(x.item.id);
      });
    });
    return { pool: poolDoEscopo(o.agrupamentoId, o.escopo), donos: donos, minhas: cadeirasDe(o) };
  }

  /* ── Aprovação de pedidos ─────────────────────────────────────────────
     Com a exigência ligada, ocupação criada por PROFESSOR nasce 'pendente':
     é pedido, não reserva. Pedido NÃO entra no índice de sobreposição, então
     não segura horário — vários professores podem pedir o mesmo, e é a
     APROVAÇÃO que passa pela transação e pode falhar por choque.

     Ocupação gravada antes de 17/09/2026 não tem `situacao`. A ausência vale
     como aprovada: tratar como pendente faria a agenda inteira desaparecer
     da tela no dia do deploy.

     ATENÇÃO — hoje esta barreira é só de interface. A Security Rule de
     `ocupacoes` ainda deixa professor gravar direto, então o servidor aceita
     um registro que não passou por aqui. Enquanto a regra não for ajustada
     no console, isto é convenção de tela, não controle. */
  function exigirAprovacao() {
    return estado.parametros.exigirAprovacaoProfessor !== false;
  }
  function situacaoDe(o) { return (o && o.situacao) || 'aprovada'; }
  function ehPendente(o) { return situacaoDe(o) === 'pendente'; }
  function precisaAprovacao() {
    return !!usuarioAtual && usuarioAtual.perfil === 'professor' && exigirAprovacao();
  }

  /* ── Exclusão reversível ──────────────────────────────────────────────
     Excluir reserva não apaga documento: grava `excluidaEm` e tira a entrada
     do índice de sobreposição. As duas coisas importam — sem a marca não há
     o que recuperar; sem sair do índice a reserva desapareceria de todas as
     telas e continuaria bloqueando o horário.

     Os SELETORES abaixo existem para a regra morar num lugar só. Nesta mesma
     sequência de mudanças eu já esqueci o filtro duas vezes em telas que leem
     `estado.recorrencias`/`estado.pontuais` direto — quem monta tela nova usa
     o seletor e recebe o filtro de graça. */
  function estaExcluida(o) { return !!(o && o.excluidaEm); }
  /* A ocorrência é derivada e não serve para excluir: a exclusão é do
     DOCUMENTO. `origemId` de uma ocorrência recorrente é a regra inteira. */
  function reservaPorId(id) {
    return porId(estado.recorrencias, id) || porId(estado.pontuais, id);
  }
  function recorrenciasAtivas() {
    return estado.recorrencias.filter(function (r) { return !estaExcluida(r); });
  }
  function pontuaisAtivas() {
    return estado.pontuais.filter(function (p) {
      return !estaExcluida(p) && situacaoDe(p) === 'aprovada';
    });
  }
  /* Lixeira: as duas coleções juntas, da exclusão mais recente para a mais
     antiga, que é a ordem em que alguém procura o que acabou de apagar. */
  function reservasExcluidas() {
    return estado.recorrencias.concat(estado.pontuais)
      .filter(estaExcluida)
      .sort(function (a, b) { return String(b.excluidaEm).localeCompare(String(a.excluidaEm)); });
  }

  /* `excedeCapacidade` saiu em 17/09/2026 e não voltou com a quantidade, em
     05/10/2026: a quantidade não é comparada com um teto, e sim ALOCADA —
     quem decide se cabe é `alocar`, cadeira por cadeira. */

  /* ── Escrita ──────────────────────────────────────────────────────────
     Toda mutação aplica a mudança no cache PRIMEIRO e persiste em seguida.
     É o que mantém as telas chamando sem await: a interface reage na hora, e
     se a gravação falhar o cache é desfeito e a pessoa é avisada — em vez de
     ver um sucesso que não aconteceu. */
  function persistir(promessa, desfazer) {
    return promessa.then(function (v) { return { ok: true, valor: v }; },
      function (e) {
        if (desfazer) { try { desfazer(); } catch (x) { } }
        commit();
        var msg = (e && e.conflito) ? e.mensagem
          : 'Não foi possível salvar: ' + ((e && e.message) || 'falha de rede ou de permissão');
        C.toast(msg);
        if (global.console) global.console.error('falha ao gravar:', e);
        return { ok: false, erro: e, mensagem: msg };
      });
  }

  /* ── Índice de ocupação e revalidação transacional ────────────────────
     O índice indices/{agrupamentoId} guarda a forma compacta de tudo que
     ocupa aquele agrupamento. A transação relê ESSE documento e revalida a
     disputa de cadeiras antes de gravar — é o que impede duas pessoas de
     gravarem em cima uma da outra depois de as duas passarem na validação
     local.
     `cadeiras` entrou no item em 05/10/2026: as que a reserva segura, ou
     null na reserva integral. Item gravado antes disso não tem o campo, e a
     ausência vale como integral — o mesmo que ele sempre significou. */
  function resumoDaOcupacao(o) {
    return {
      id: o.id, tipo: o.tipo, escopo: o.escopo,
      inicio: o.inicio, fim: o.fim,
      dias: o.dias || null, data: o.data || null,
      vigenciaInicio: o.vigenciaInicio || null, vigenciaFim: o.vigenciaFim || null,
      encerradaEm: o.encerradaEm || null,
      excecoes: (o.excecoes || []).map(function (x) { return x.data; }),
      cadeiras: Array.isArray(o.cadeirasAlocadas) ? o.cadeirasAlocadas.slice() : null
    };
  }

  /* Datas concretas que um item do índice ocupa, já descontadas as exceções
     e o encerramento. */
  function datasDoItem(i) {
    if (i.tipo === 'pontual') return i.data ? [i.data] : [];
    var fim = i.vigenciaFim;
    if (i.encerradaEm) fim = menorISO(fim, C.addDays(i.encerradaEm, -1));
    if (!i.vigenciaInicio || !fim || fim < i.vigenciaInicio) return [];
    var exc = i.excecoes || [];
    return datasDaRegra(i.dias || [], i.vigenciaInicio, fim).filter(function (d) {
      return exc.indexOf(d) === -1;
    });
  }

  /* Grava a reserva pela transação, escolhendo as cadeiras DENTRO dela.
     A escolha feita no cache (`alocarLocal`) entra como preferência: se as
     cadeiras continuam livres no índice relido, ficam; se alguém tomou uma
     delas no meio-tempo, a transação escolhe outras da menor para a maior, e
     só recusa quando não sobra quantidade. É por isso que a alocação muda o
     documento e o item do índice ali dentro, antes do `set`.
       opcoes.fixo — cadeira por cadeira, escolhidas por alguém (o seletor de
       cadeiras): não troca nenhuma, recusa se uma já estiver tomada.
       opcoes.mensagem(res) — texto da recusa para quem chama num contexto
       em que o padrão ("enquanto você escolhia") não faz sentido.
     A reserva integral, anterior a 05/10/2026, continua com a regra de
     antes: o escopo inteiro precisa estar livre. */
  function gravarOcupacaoNaNuvem(o, opcoes) {
    opcoes = opcoes || {};
    var resumo = resumoDaOcupacao(o);
    var checar = estado.parametros.bloquearSobreposicao !== false;
    var integral = ehIntegral(o);
    var quantidade = quantidadeDe(o);
    return N.gravarOcupacao(o.agrupamentoId, o.id, o, function (itens) {
      if (integral) {
        if (!checar) return null;
        var todas = alocar(o.agrupamentoId, resumo, itens, {
          fixo: true, preferidas: poolDoEscopo(o.agrupamentoId, o.escopo)
        });
        return todas.ok ? null
          : 'Este horário choca com uma ocupação já registrada neste agrupamento, e esta reserva ' +
            'toma a clínica inteira. Se a agenda parecia livre, alguém gravou enquanto você ' +
            'preenchia — reveja o horário.';
      }
      var res = alocar(o.agrupamentoId, resumo, itens, {
        checar: checar, quantidade: quantidade,
        fixo: !!opcoes.fixo, preferidas: o.cadeirasAlocadas
      });
      if (!res.ok) return opcoes.mensagem ? opcoes.mensagem(res) : res.mensagem;
      o.cadeirasAlocadas = res.cadeiras;
      resumo.cadeiras = res.cadeiras.slice();
      return null;
    }, resumo);
  }

  /* A mesma escolha, feita no cache, para a tela já mostrar as cadeiras no
     instante do clique — o cache é aplicado ANTES da gravação, como em toda
     mutação daqui. A transação confere e, se precisar, corrige. */
  function alocarLocal(o) {
    var res = alocar(o.agrupamentoId, resumoDaOcupacao(o), itensLocais(o.agrupamentoId, o.id), {
      checar: estado.parametros.bloquearSobreposicao !== false,
      quantidade: quantidadeDe(o), preferidas: o.cadeirasAlocadas
    });
    return res.ok ? res.cadeiras
      : poolDoEscopo(o.agrupamentoId, o.escopo).slice(0, quantidadeDe(o));
  }

  /* ── Mutações: agenda ─────────────────────────────────────────────────
     `dados.pular` são as datas que já nascem como exceção — o caminho do
     botão "Criar pulando as datas em conflito". Elas precisam entrar AQUI,
     antes da transação, e não por `cancelarOcorrencia` logo depois:

       · o resumo que vai para o índice é congelado em `gravarOcupacaoNaNuvem`
         com as exceções que a regra tiver NESTE instante. Com a lista vazia,
         a transação revalida contra as mesmas datas em choque que motivaram o
         botão e recusa a gravação — o recurso nunca funcionou;
       · pior, o `cancelarOcorrencia` disparado em seguida grava
         `set({excecoes}, {merge:true})` no mesmo documento e corre com a
         transação. Chegando primeiro, cria em `ocupacoes` um documento só com
         `excecoes` — sem `dias`, sem horário. Esse órfão volta pelo onSnapshot
         e estoura TypeError em `r.dias.indexOf` dentro de `ocorrenciasDoDia`,
         derrubando Agenda, Agora, Painel e Relatórios de todo mundo. */
  /* Quantidade pedida, saneada: inteiro de 1 até a capacidade do escopo. */
  function quantidadeValida(dados) {
    var n = Math.floor(Number(dados.cadeiras) || 0);
    var cap = capacidadeEscopo(dados.agrupamentoId, dados.escopo || 'a');
    return Math.max(1, Math.min(n || cap, cap));
  }

  /* Recorrente e pontual gravam os mesmos campos de vínculo desde
     05/10/2026: `disciplinaId` (null no "Outros" da pontual), `responsavelId`
     — que a recorrente antes herdava da turma — e `tipoAtividade`, que diz
     se é graduação ou pós. Nenhum vai como `undefined`, que o Firestore
     recusa e derrubaria o registro inteiro no primeiro clique. Sem `titulo`
     nem `turmaId`: título é derivado, turma é texto na descrição. */
  function criarRecorrencia(dados) {
    var agora = C.carimbo();
    var r = {
      id: N.novoId('ocupacoes'), tipo: 'recorrente',
      agrupamentoId: dados.agrupamentoId, escopo: dados.escopo || 'a',
      disciplinaId: dados.disciplinaId || null,
      responsavelId: dados.responsavelId || euId(),
      tipoAtividade: dados.tipoAtividade === 'pos' ? 'pos' : 'graduacao',
      dias: dados.dias.slice().sort(), inicio: dados.inicio, fim: dados.fim,
      cadeirasPedidas: quantidadeValida(dados),
      /* A vigência nunca escapa do semestre: fora dele a agenda geraria
         encontros que nenhuma tela consegue mostrar. */
      vigenciaInicio: maiorISO(dados.vigenciaInicio, estado.semestre.inicio),
      vigenciaFim: menorISO(dados.vigenciaFim, estado.semestre.fim),
      periodoLetivo: estado.periodoLetivo,
      excecoes: (dados.pular || []).map(function (d) {
        return {
          data: d, motivo: dados.motivoPular || 'Sem cadeira suficiente no lançamento da recorrência',
          registradoPor: euId(), registradoEm: agora
        };
      }),
      encerradaEm: null,
      criadoPor: euId(), criadoEm: agora,
      descricao: String(dados.descricao || '').trim()
    };
    /* As cadeiras são escolhidas já com as datas puladas fora: é contra as
       datas que de fato acontecem que elas precisam estar livres. */
    r.cadeirasAlocadas = alocarLocal(r);
    estado.recorrencias.push(r);
    commit();
    persistir(gravarOcupacaoNaNuvem(r), function () {
      estado.recorrencias = estado.recorrencias.filter(function (x) { return x.id !== r.id; });
    });
    return r;
  }

  function criarPontual(dados) {
    var soPedido = precisaAprovacao();
    var p = {
      id: N.novoId('ocupacoes'), tipo: 'pontual',
      agrupamentoId: dados.agrupamentoId, escopo: dados.escopo || 'a',
      data: dados.data, inicio: dados.inicio, fim: dados.fim,
      tipoAtividade: dados.tipoAtividade,
      descricao: String(dados.descricao || '').trim(),
      disciplinaId: dados.disciplinaId || null, responsavelId: dados.responsavelId,
      cadeirasPedidas: quantidadeValida(dados),
      excecoes: [],
      situacao: soPedido ? 'pendente' : 'aprovada',
      criadoPor: euId(), criadoEm: C.carimbo()
    };
    /* Pedido não segura cadeira, como não segura horário: as cadeiras dele
       são escolhidas na aprovação, contra a agenda daquele momento. */
    if (!soPedido) p.cadeirasAlocadas = alocarLocal(p);
    estado.pontuais.push(p);
    commit();
    /* Pedido é gravação simples: não reserva nada, logo não passa pela
       transação nem entra no índice. Quem indexa é `aprovarPedido`. */
    persistir(soPedido ? N.gravar('ocupacoes', p.id, p) : gravarOcupacaoNaNuvem(p), function () {
      estado.pontuais = estado.pontuais.filter(function (x) { return x.id !== p.id; });
    });
    return p;
  }

  /* ── Mutações: fila de aprovação ──────────────────────────────────── */
  /* Pedido pendente é filtrado em `ocorrenciasDoDia`, então nunca chega a
     virar ocorrência — a fila precisa do rótulo por outro caminho. Reusa
     `tituloPontual` para a fila e a agenda não divergirem no mesmo pedido. */
  function rotuloPedido(p) {
    return tituloPontual(p);
  }

  /* Rótulo de uma reserva CRUA (o documento), não de ocorrência: a lixeira
     lista documentos, que não passam por `ocorrenciaDeRegra`/`DePontual`.
     Serve os dois tipos. */
  function rotuloReserva(o) {
    if (!o) return '—';
    if (o.tipo === 'pontual') return rotuloPedido(o);
    var d = disciplinaDe(o);
    return rotuloTipoAtividade(nivelDe(o)) + ' · ' + (d ? rotuloDisciplina(d) : 'Sem disciplina');
  }
  function pedidosPendentes() {
    return estado.pontuais.filter(ehPendente).sort(ordemDePedido);
  }
  /* O professor acompanha os próprios pedidos, recusados incluídos: recusa
     sem retorno visível para quem pediu é pior do que recusa. */
  function meusPedidos() {
    var eu = euId();
    return estado.pontuais.filter(function (p) {
      return situacaoDe(p) !== 'aprovada' && (p.responsavelId === eu || p.criadoPor === eu);
    }).sort(ordemDePedido);
  }
  function ordemDePedido(a, b) {
    return String(a.data).localeCompare(String(b.data)) || C.toMin(a.inicio) - C.toMin(b.inicio);
  }

  /* Aprovar é o instante em que o pedido passa a reservar de verdade: é aqui
     que ele entra na transação e no índice, que as cadeiras dele são
     escolhidas, e aqui que a falta de cadeira pode barrar. Devolve promessa
     porque a coordenação precisa saber se passou — se dois pedidos disputam
     as mesmas cadeiras, o segundo falha e o motivo aparece.
     Pedido gravado antes de 05/10/2026 não tem quantidade e é aprovado como
     era pedido: a clínica inteira. */
  function aprovarPedido(id) {
    var p = porId(estado.pontuais, id);
    if (!p || !ehPendente(p)) return global.Promise.resolve({ ok: false, mensagem: 'Pedido não está pendente.' });
    var antes = {
      situacao: p.situacao, decididoPor: p.decididoPor, decididoEm: p.decididoEm,
      cadeirasAlocadas: p.cadeirasAlocadas
    };
    p.situacao = 'aprovada';
    p.decididoPor = euId();
    p.decididoEm = C.carimbo();
    if (!ehIntegral(p)) p.cadeirasAlocadas = alocarLocal(p);
    commit();
    return persistir(gravarOcupacaoNaNuvem(p), function () {
      Object.keys(antes).forEach(function (k) {
        if (antes[k] === undefined) delete p[k]; else p[k] = antes[k];
      });
    });
  }

  /* Recusa não toca o índice: o pedido nunca esteve lá. O motivo é opcional,
     e vai como string vazia quando não houver — nunca undefined, que o
     Firestore recusa. */
  function recusarPedido(id, motivo) {
    var p = porId(estado.pontuais, id);
    if (!p || !ehPendente(p)) return global.Promise.resolve({ ok: false, mensagem: 'Pedido não está pendente.' });
    var antes = {
      situacao: p.situacao, motivoRecusa: p.motivoRecusa,
      decididoPor: p.decididoPor, decididoEm: p.decididoEm
    };
    p.situacao = 'recusada';
    p.motivoRecusa = String(motivo || '').trim();
    p.decididoPor = euId();
    p.decididoEm = C.carimbo();
    commit();
    return persistir(N.gravar('ocupacoes', p.id, {
      situacao: p.situacao, motivoRecusa: p.motivoRecusa,
      decididoPor: p.decididoPor, decididoEm: p.decididoEm
    }), function () {
      Object.keys(antes).forEach(function (k) { p[k] = antes[k]; });
    });
  }

  /* Quem pediu pode retirar o próprio pedido enquanto ninguém decidiu —
     sem isto, um pedido feito por engano só sairia pela recusa da
     coordenação, e a pessoa ficaria esperando por um erro dela mesma. */
  function retirarPedido(id) {
    var p = porId(estado.pontuais, id);
    if (!p || !ehPendente(p)) return global.Promise.resolve({ ok: false });
    var eu = euId();
    if (p.responsavelId !== eu && p.criadoPor !== eu && !pode('agenda.aprovar')) {
      return global.Promise.resolve({ ok: false, mensagem: 'Este pedido é de outra pessoa.' });
    }
    estado.pontuais = estado.pontuais.filter(function (x) { return x.id !== id; });
    commit();
    return persistir(N.apagar('ocupacoes', id), function () { estado.pontuais.push(p); });
  }

  /* `atualizarRecorrencia` e `atualizarPontual` saíram em 05/10/2026: nunca
     tiveram botão, e ainda gravavam `turmaId`. O que se edita numa reserva
     hoje são as cadeiras, por aqui — com a lista escolhida pela pessoa.

     Troca as cadeiras de uma reserva aprovada pela lista escolhida, cadeira
     por cadeira (`fixo`): se uma delas foi tomada enquanto a pessoa
     escolhia, recusa em vez de trocar por outra que ela não viu. A
     quantidade passa a ser o tamanho da lista. Vale para TODAS as datas da
     reserva, porque a alocação é uma só.
     Na reserva integral é aqui que ela deixa de ser integral: ganha lista e
     quantidade, e o resto da clínica fica livre para outras. */
  function alterarCadeiras(id, lista) {
    var o = porId(estado.recorrencias, id) || porId(estado.pontuais, id);
    if (!o) return global.Promise.resolve({ ok: false, mensagem: 'Reserva não encontrada.' });
    var limpa = [];
    (lista || []).forEach(function (n) {
      n = Number(n);
      if (n > 0 && limpa.indexOf(n) === -1) limpa.push(n);
    });
    if (!limpa.length) return global.Promise.resolve({ ok: false, mensagem: 'Escolha ao menos uma cadeira.' });
    var antes = { cadeirasAlocadas: o.cadeirasAlocadas, cadeirasPedidas: o.cadeirasPedidas };
    o.cadeirasAlocadas = limpa.sort(numeroCrescente);
    o.cadeirasPedidas = limpa.length;
    commit();
    return persistir(gravarOcupacaoNaNuvem(o, { fixo: true }), function () {
      Object.keys(antes).forEach(function (k) {
        if (antes[k] === undefined) delete o[k]; else o[k] = antes[k];
      });
    });
  }

  /* Cancela uma ocorrência: vira exceção na recorrência, ou some se for
     pontual. Quem pode cancelar o quê é decidido pela matriz de acesso. */
  function cancelarOcorrencia(o, motivo) {
    if (o.origem === 'recorrente') {
      var r = porId(estado.recorrencias, o.origemId);
      if (!r) return;
      r.excecoes.push({
        data: o.data, motivo: motivo || 'Sem motivo informado',
        registradoPor: euId(), registradoEm: C.carimbo()
      });
      commit();
      persistir(N.gravar('ocupacoes', r.id, { excecoes: r.excecoes })
        .then(function () { return N.atualizarIndice(r.agrupamentoId, r.id, resumoDaOcupacao(r)); }),
        function () {
          r.excecoes = r.excecoes.filter(function (x) { return x.data !== o.data; });
        });
    } else {
      var p = porId(estado.pontuais, o.origemId);
      if (!p) return;
      estado.pontuais = estado.pontuais.filter(function (x) { return x.id !== o.origemId; });
      commit();
      persistir(N.removerOcupacao(p.agrupamentoId, p.id), function () {
        estado.pontuais.push(p);
      });
    }
    limparAtribuicoes(o.chave);
  }

  function encerrarRecorrencia(id, data) {
    var r = porId(estado.recorrencias, id);
    if (!r) return;
    var antes = r.encerradaEm;
    r.encerradaEm = data || C.hojeISO();
    commit();
    persistir(N.gravar('ocupacoes', id, { encerradaEm: r.encerradaEm })
      .then(function () { return N.atualizarIndice(r.agrupamentoId, id, resumoDaOcupacao(r)); }),
      function () { r.encerradaEm = antes; });
  }

  /* Substituiu o antigo `excluirRecorrencia`, que apagava o documento de vez
     e nunca foi ligado a botão nenhum. Serve recorrência e pontual: a marca
     e a saída do índice são as mesmas nos dois casos.
     Nem as cadeiras alocadas nem os nomes registrados nelas são limpos — é
     isso que faz a recuperação devolver a reserva como ela era. */
  function excluirReserva(id, motivo) {
    var o = porId(estado.recorrencias, id) || porId(estado.pontuais, id);
    if (!o) return global.Promise.resolve({ ok: false, mensagem: 'Reserva não encontrada.' });
    if (estaExcluida(o)) return global.Promise.resolve({ ok: false, mensagem: 'Reserva já está excluída.' });
    var antes = {
      excluidaEm: o.excluidaEm, excluidaPor: o.excluidaPor, motivoExclusao: o.motivoExclusao
    };
    o.excluidaEm = C.carimbo();
    o.excluidaPor = euId();
    o.motivoExclusao = String(motivo || '').trim();
    commit();
    return persistir(N.desindexarOcupacao(o.agrupamentoId, o.id, {
      excluidaEm: o.excluidaEm, excluidaPor: o.excluidaPor, motivoExclusao: o.motivoExclusao
    }), function () {
      Object.keys(antes).forEach(function (k) { o[k] = antes[k]; });
    });
  }

  /* Recuperar reindexa pela transação, e PODE FALHAR: enquanto a reserva
     estava na lixeira as cadeiras dela estavam livres, e alguém pode ter
     ocupado. Se as mesmas cadeiras não estiverem mais livres, a transação
     escolhe outras na mesma quantidade; falha só quando não sobra
     quantidade — o contrário seria criar duas reservas na mesma cadeira
     pelas costas da validação. `valor.realocada` avisa quem chamou que as
     cadeiras mudaram.
     Pedido que ainda não foi aprovado volta sem indexar, como nasceu. */
  function recuperarReserva(id) {
    var o = porId(estado.recorrencias, id) || porId(estado.pontuais, id);
    if (!o) return global.Promise.resolve({ ok: false, mensagem: 'Reserva não encontrada.' });
    if (!estaExcluida(o)) return global.Promise.resolve({ ok: false, mensagem: 'Reserva não está excluída.' });
    var antes = {
      excluidaEm: o.excluidaEm, excluidaPor: o.excluidaPor, motivoExclusao: o.motivoExclusao,
      cadeirasAlocadas: o.cadeirasAlocadas
    };
    var tinha = textoCadeiras(cadeirasDe(o));
    o.excluidaEm = null;
    o.excluidaPor = null;
    o.motivoExclusao = '';
    var indexavel = !(o.tipo === 'pontual' && situacaoDe(o) !== 'aprovada');
    if (indexavel && !ehIntegral(o)) o.cadeirasAlocadas = alocarLocal(o);
    commit();
    return persistir(
      indexavel ? gravarOcupacaoNaNuvem(o) : N.gravar('ocupacoes', o.id, o),
      function () {
        Object.keys(antes).forEach(function (k) {
          if (antes[k] === undefined) delete o[k]; else o[k] = antes[k];
        });
      }
    ).then(function (r) {
      if (r.ok) r.realocada = textoCadeiras(cadeirasDe(o)) !== tinha;
      return r;
    });
  }

  /* Devolver uma data à recorrência passa pela transação, com as cadeiras
     que ela já tem (`fixo`): naquela data alguém pode ter reservado as
     mesmas cadeiras depois do cancelamento, e o encontro não pode voltar por
     cima. Antes de 05/10/2026 a restauração gravava direto, sem conferir
     nada. Devolve promessa, para a tela saber se voltou. */
  function restaurarExcecao(regraId, data) {
    var r = porId(estado.recorrencias, regraId);
    if (!r) return global.Promise.resolve({ ok: false });
    var antes = r.excecoes.slice();
    r.excecoes = r.excecoes.filter(function (e) { return e.data !== data; });
    commit();
    return persistir(gravarOcupacaoNaNuvem(r, {
      fixo: true,
      mensagem: function (res) {
        return 'O encontro de ' + C.fmtDia(data) + ' não pode voltar: depois do cancelamento, ' +
          (res.presas && res.presas.length
            ? (res.presas.length === 1 ? 'a cadeira ' + res.presas[0] + ' foi reservada'
              : 'as cadeiras ' + C.faixasNumeros(res.presas) + ' foram reservadas')
            : 'as cadeiras dela foram reservadas') + ' por outra ocupação nesse horário.';
      }
    }), function () { r.excecoes = antes; });
  }

  /* ── Mutações: nome na cadeira ────────────────────────────────────────
     `atribuicoes` deixou de medir ocupação em 05/10/2026: a cadeira alocada
     JÁ é a cadeira ocupada, marcada pelo sistema. O que sobrou do registro
     antigo é o NOME de quem está na cadeira naquele encontro — opcional, e
     só uma anotação do professor. A coleção e o formato são os mesmos, então
     o nome registrado antes da mudança continua aparecendo. */
  function atribuicoesDa(chave) {
    return estado.atribuicoes.filter(function (a) { return a.chave === chave; });
  }
  function atribuicaoDaCadeira(chave, numero) {
    var l = atribuicoesDa(chave);
    for (var i = 0; i < l.length; i++) if (l[i].cadeira === numero) return l[i];
    return null;
  }
  /* Quem está na cadeira: aluno cadastrado (registro antigo), nome escrito à
     mão, ou nada — marcar a cadeira como ocupada sem dizer quem é um uso
     legítimo, então a ausência de nome não é falta de dado. */
  function nomeNaCadeira(a) {
    if (!a) return '—';
    var al = a.alunoId ? aluno(a.alunoId) : null;
    if (al) return al.nome;
    return a.nome || 'sem identificação';
  }

  function limparAtribuicoes(chave) {
    var alvo = atribuicoesDa(chave);
    if (!alvo.length) return;
    estado.atribuicoes = estado.atribuicoes.filter(function (a) { return a.chave !== chave; });
    commit();
    persistir(N.apagarVarios('atribuicoes', alvo.map(function (a) { return a.id; })));
  }

  /* Escreve, troca ou apaga o nome numa cadeira de uma OCORRÊNCIA (`o` tem
     `chave`). Nome vazio apaga a anotação.
     A clínica sai do número DENTRO DO ESCOPO DA OCUPAÇÃO, nunca do polo
     inteiro: a cadeira 5 de uma ocupação na Pré-clínica maior é a 5 dela, e
     não a 5 da Clínica 1 — dentro de um escopo o número é único, porque duas
     clínicas do mesmo agrupamento nunca repetem faixa. */
  function registrarNomeNaCadeira(o, numero, nome) {
    var texto = String(nome || '').trim();
    var atual = atribuicaoDaCadeira(o.chave, numero);
    if (atual) {
      if (!texto) {
        estado.atribuicoes = estado.atribuicoes.filter(function (a) { return a.id !== atual.id; });
        commit();
        return persistir(N.apagar('atribuicoes', atual.id), function () { estado.atribuicoes.push(atual); });
      }
      var antes = { nome: atual.nome, alunoId: atual.alunoId };
      atual.nome = texto;
      atual.alunoId = null;
      commit();
      return persistir(N.gravar('atribuicoes', atual.id, { nome: texto, alunoId: null }), function () {
        atual.nome = antes.nome; atual.alunoId = antes.alunoId;
      });
    }
    if (!texto) return global.Promise.resolve({ ok: true });
    var c = clinicaDaCadeira(numero, clinicasDoEscopo(o.agrupamentoId, o.escopo));
    var registro = {
      id: N.novoId('atribuicoes'), chave: o.chave, clinicaId: c ? c.id : null,
      cadeira: numero,
      /* `alunoId` sobrevive por causa dos registros antigos; `null` o
         Firestore aceita, `undefined` não. */
      alunoId: null, nome: texto, data: o.data,
      registradoPor: euId(), registradoEm: C.carimbo()
    };
    estado.atribuicoes.push(registro);
    commit();
    return persistir(N.gravar('atribuicoes', registro.id, registro), function () {
      estado.atribuicoes = estado.atribuicoes.filter(function (a) { return a.id !== registro.id; });
    });
  }

  /* ── Mutações: manutenção ─────────────────────────────────────────── */
  function proximoProtocolo() {
    var ano = String(C.parseISO(C.hojeISO()).getFullYear()).slice(2);
    var n = 1000 + estado.manutencoes.length + 1;
    return 'MNT-' + ano + '-' + n;
  }

  /* Levantamento automático do impacto: quais ocorrências dos próximos 14
     dias ficam sem cadeira com esta cadeira fora de operação. */
  function calcularImpacto(clinicaId, cadeira) {
    var hoje = C.hojeISO(), fim = C.addDays(hoje, 14);
    var jaInterditada = !!cadeiraEmManutencao(clinicaId, cadeira);
    var operantesDepois = cadeirasOperantes(clinicaId) - (jaInterditada ? 0 : 1);
    /* Com a alocação, afetada é a ocupação que TEM esta cadeira: é ela que
       precisa trocar de cadeira. A reserva integral, anterior a 05/10/2026,
       segura todas — medir por ela faria QUALQUER interdição marcar todas
       como afetadas, e aviso que grita sempre é aviso que ninguém lê. Nela
       vale a regra antiga: afetada é a que tem mais nomes registrados do que
       restará de operante. Uma ocupação de escopo duplo dispõe das cadeiras
       das duas clínicas, e o desconto é sobre as duas. */
    var afetadas = ocorrenciasIntervalo(hoje, fim, clinicaId).filter(function (o) {
      if (!o.integral) return o.cadeirasLista.indexOf(cadeira) !== -1;
      var disponiveis = cadeirasOperantesEscopo(o.agrupamentoId, o.escopo) - (jaInterditada ? 0 : 1);
      return atribuicoesDa(o.chave).length > disponiveis;
    });
    /* O campo continua `turmasAfetadas` porque está gravado assim em cada
       chamado já aberto; desde 05/10/2026 ele guarda o título da ocupação. */
    var turmasAfetadas = [];
    afetadas.forEach(function (o) {
      if (turmasAfetadas.indexOf(o.titulo) === -1) turmasAfetadas.push(o.titulo);
    });
    return {
      cadeirasOperantesDepois: operantesDepois,
      ocorrenciasAfetadas: afetadas.length,
      proximaAfetada: afetadas.length ? afetadas[0].data + ' ' + afetadas[0].inicio : null,
      turmasAfetadas: turmasAfetadas,
      janelaDias: 14,
      apuradoEm: C.carimbo()
    };
  }

  function abrirManutencao(dados) {
    var cat = null;
    D.CATEGORIAS_MANUTENCAO.forEach(function (c) { if (c.id === dados.categoria) cat = c; });
    if (!cat) return null;
    var motivo = String(dados.motivo || '').trim();
    if (estado.parametros.exigirMotivoManutencao && !motivo) return null;
    var m = {
      id: N.novoId('manutencoes'), protocolo: proximoProtocolo(),
      clinicaId: dados.clinicaId, cadeira: dados.cadeira,
      categoria: dados.categoria, criticidade: dados.criticidade || cat.criticidade,
      motivo: motivo,
      abertoPor: euId(), abertoEm: C.carimbo(),
      previsaoRetorno: dados.previsaoRetorno || C.addDays(C.hojeISO(), cat.prazoDias),
      status: 'aberta',
      fechadoPor: null, fechadoEm: null, laudo: null,
      impacto: calcularImpacto(dados.clinicaId, dados.cadeira)
    };
    estado.manutencoes.push(m);
    commit();
    persistir(N.gravar('manutencoes', m.id, m), function () {
      estado.manutencoes = estado.manutencoes.filter(function (x) { return x.id !== m.id; });
    });
    return m;
  }

  function encerrarManutencao(id, laudo) {
    var m = porId(estado.manutencoes, id);
    if (!m) return;
    var antes = { status: m.status, fechadoPor: m.fechadoPor, fechadoEm: m.fechadoEm, laudo: m.laudo };
    m.status = 'encerrada';
    m.fechadoPor = euId();
    m.fechadoEm = C.carimbo();
    m.laudo = laudo;
    commit();
    persistir(N.gravar('manutencoes', id, {
      status: m.status, fechadoPor: m.fechadoPor, fechadoEm: m.fechadoEm, laudo: m.laudo
    }), function () { Object.keys(antes).forEach(function (k) { m[k] = antes[k]; }); });
  }

  function historicoCadeira(numero) {
    return estado.manutencoes.filter(function (m) {
      return m.cadeira === numero;
    }).sort(function (a, b) { return String(b.abertoEm).localeCompare(String(a.abertoEm)); });
  }

  /* ── Mutações: disciplinas ────────────────────────────────────────────
     Turma e aluno saíram em 05/10/2026 (`salvarTurma`, `excluirTurma`,
     `vincularAluno`, `desvincularAluno`): disciplina é só disciplina, e o
     professor é ligado a ela pela tela Acessos. */
  function salvarDisciplina(id, dados) {
    var d = id ? disciplina(id) : null;
    var novo = !d;
    if (!d) { d = { id: N.novoId('disciplinas') }; estado.disciplinas.push(d); }
    var antes = JSON.parse(JSON.stringify(d));
    ['codigo', 'nome', 'nivel'].forEach(function (k) {
      if (dados[k] !== undefined) d[k] = dados[k];
    });
    commit();
    /* Payload explícito — não o objeto `d` inteiro, que carrega `id` e, nas
       disciplinas criadas antes de 14/09/2026, os campos extintos que a
       hidratação copia crus do Firestore. Sem `professores` também: quem
       grava o vínculo é `vincularDisciplinas`, e o merge preserva o campo.
       O que isto NÃO faz: N.gravar é set(dados, { merge: true }), então
       `especialidade` e `cargaHoraria` continuam gravados nos documentos
       antigos — deixar de enviá-los não os apaga. São lixo inerte, que nada
       lê. Purgar de verdade exigiria FieldValue.delete() ou faxina manual. */
    persistir(N.gravar('disciplinas', d.id, {
      codigo: d.codigo, nome: d.nome,
      /* `nivel` separa a disciplina da graduação da especialização da pós.
         Vai explícito mesmo na graduação para o campo existir em todo
         documento novo; a ausência continua valendo como graduação, que é o
         estado de tudo que foi gravado antes disto. */
      nivel: d.nivel === 'pos' ? 'pos' : 'graduacao'
    }), function () {
      if (novo) estado.disciplinas = estado.disciplinas.filter(function (x) { return x.id !== d.id; });
      else Object.keys(antes).forEach(function (k) { d[k] = antes[k]; });
    });
    return d;
  }

  /* ── Mutações: especialização da pós ──────────────────────────────────
     Só o nome: a turma interna que esta função criava até 05/10/2026 saiu,
     e o professor responsável é vinculado em Acessos, como o de qualquer
     disciplina. */
  function salvarEspecializacao(id, dados) {
    var nome = String(dados.nome || '').trim();
    if (!nome) return null;
    var atual = id ? disciplina(id) : null;
    if (id && !atual) return null;
    return salvarDisciplina(id, {
      codigo: (atual && atual.codigo) || proximoCodigoPos(),
      nome: nome, nivel: 'pos'
    });
  }

  /* Reservas que apontam para a disciplina, pelo `disciplinaId` ou pela
     turma antiga. As excluídas só entram a pedido: a limpeza precisa movê-
     las também, senão a recuperação devolveria uma reserva de disciplina
     apagada. */
  function reservasDaDisciplina(id, incluirExcluidas) {
    return estado.recorrencias.concat(estado.pontuais).filter(function (o) {
      if (!incluirExcluidas && estaExcluida(o)) return false;
      return disciplinaIdDe(o) === id;
    });
  }

  /* Sem cascata: disciplina com reserva não é removível — quem chama
     precisa checar antes por `reservasDaDisciplina` (a view bloqueia com um
     toast). Excluir sem essa checagem deixaria reservas apontando para uma
     disciplina que não existe, que a agenda mostra como "Disciplina
     removida". Vale para a pós também: a cascata que a especialização tinha
     tirava as reservas da agenda sem volta, e a exclusão de reserva hoje é
     reversível — quem quiser tirá-las faz isso pela agenda. */
  function excluirDisciplina(id) {
    var d = porId(estado.disciplinas, id);
    if (!d) return;
    estado.disciplinas = estado.disciplinas.filter(function (x) { return x.id !== id; });
    commit();
    persistir(N.apagar('disciplinas', id), function () {
      estado.disciplinas.push(d);
    });
  }

  /* ── Vínculo professor ↔ disciplina ───────────────────────────────────
     Feito pela tela Acessos, pessoa por pessoa: `ids` é a lista COMPLETA de
     disciplinas de `email`. Grava só as disciplinas que mudaram — e a que
     ainda herda o vínculo das turmas ganha a lista explícita, já com a
     mudança. */
  function vincularDisciplinas(email, ids) {
    var mudadas = [];
    estado.disciplinas.forEach(function (d) {
      var atual = professoresDaDisciplina(d);
      var tem = atual.indexOf(email) !== -1, quer = ids.indexOf(d.id) !== -1;
      if (tem === quer) return;
      mudadas.push({
        d: d, antes: d.professores,
        novo: quer ? atual.concat([email]) : atual.filter(function (x) { return x !== email; })
      });
    });
    if (!mudadas.length) return global.Promise.resolve({ ok: true });
    mudadas.forEach(function (m) { m.d.professores = m.novo; });
    commit();
    return persistir(global.Promise.all(mudadas.map(function (m) {
      return N.gravar('disciplinas', m.d.id, { professores: m.novo });
    })), function () {
      mudadas.forEach(function (m) {
        if (m.antes === undefined) delete m.d.professores; else m.d.professores = m.antes;
      });
    });
  }

  /* ── Limpeza do cadastro ──────────────────────────────────────────────
     A turma saiu do modelo em 05/10/2026, mas o banco de produção ainda a
     carrega de três jeitos. A limpeza resolve os três de uma vez, com
     prévia e a pedido da coordenação — nunca sozinha, no boot:
       1. reserva antiga que aponta para TURMA ganha `disciplinaId`, o
          `responsavelId` que herdava dela e a turma escrita na descrição;
       2. disciplinas com a turma no NOME ("Implantodontia T1", "… T2") —
          que era como a pós distinguia turmas, sem ter turma — viram UMA
          disciplina com o nome-base, e as reservas de cada uma passam para
          ela com o "T1"/"T2" na descrição;
       3. disciplina cujo vínculo de professor ainda vem das turmas ganha a
          lista gravada em `professores`.
     É idempotente: o plano é recalculado do estado atual, então rodar de
     novo depois de uma falha parcial termina o que faltou. A coleção
     `turmas` não é apagada — fica inerte, e nada mais depende dela. */
  var RE_TURMA_FIM = /^(.*\S)[\s\-–—·:,(]+(?:turma|t)\s*\.?\s*-?\s*(\d{1,2}|[a-z])\)?\s*$/i;
  var RE_TURMA_INICIO = /^(?:turma|t)\s*\.?\s*-?\s*(\d{1,2}|[a-z])\s*[\-–—·:]+\s*(.+)$/i;

  /* "Implantodontia T1" → { base: "Implantodontia", turma: "T1" }. Também
     "Implantodontia - Turma 2", "Implantodontia (T3)" e "T1 - Implantodontia".
     Nome sem turma devolve null — "Prótese Total" não é a turma "o" da
     Prótese: o identificador precisa fechar o nome. */
  function separarTurmaDoNome(nome) {
    var s = String(nome || '').replace(/\s+/g, ' ').trim(), m;
    if ((m = RE_TURMA_FIM.exec(s))) {
      return { base: m[1].replace(/[\s\-–—·:,(]+$/, ''), turma: 'T' + m[2].toUpperCase() };
    }
    if ((m = RE_TURMA_INICIO.exec(s))) return { base: m[2].trim(), turma: 'T' + m[1].toUpperCase() };
    return null;
  }
  function chaveDeNome(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  function planoDeLimpeza() {
    var reservas = estado.recorrencias.concat(estado.pontuais);
    var migrar = reservas.filter(function (o) {
      var t = turmaLegada(o);
      return !o.disciplinaId && !!t && !!t.disciplinaId;
    });

    var grupos = {}, ordem = [];
    estado.disciplinas.forEach(function (d) {
      var s = separarTurmaDoNome(d.nome);
      if (!s || !s.base) return;
      var k = nivelDaDisciplina(d) + '|' + chaveDeNome(s.base);
      if (!grupos[k]) { grupos[k] = { nivel: nivelDaDisciplina(d), base: s.base, membros: [] }; ordem.push(k); }
      grupos[k].membros.push({ disciplina: d, turma: s.turma });
    });
    var unificar = ordem.map(function (k) {
      var g = grupos[k];
      /* O destino é a disciplina que JÁ tem o nome-base, quando existe; senão
         o primeiro membro, renomeado. */
      var existente = null;
      estado.disciplinas.forEach(function (d) {
        if (!existente && nivelDaDisciplina(d) === g.nivel && chaveDeNome(d.nome) === chaveDeNome(g.base)) existente = d;
      });
      var n = 0;
      g.membros.forEach(function (m) { n += reservasDaDisciplina(m.disciplina.id, true).length; });
      return {
        chave: k, nivel: g.nivel, base: g.base, membros: g.membros, reservas: n,
        destino: existente || g.membros[0].disciplina, renomear: !existente
      };
    });

    var professores = estado.disciplinas.filter(function (d) {
      return !Array.isArray(d.professores) && professoresDaDisciplina(d).length > 0;
    });
    return {
      migrar: migrar, unificar: unificar, professores: professores,
      vazio: !migrar.length && !unificar.length && !professores.length
    };
  }

  /* Executa o plano. `chaves` restringe os grupos de unificação aos que a
     coordenação deixou marcados na prévia; migração e vínculo de professor
     vão sempre — não há o que decidir neles. */
  function executarLimpeza(plano, chaves) {
    var reservasMudadas = {}, discMudadas = {}, apagar = [];
    function mudar(alvo, mapa, campos) {
      var reg = mapa[alvo.id] || (mapa[alvo.id] = {});
      Object.keys(campos).forEach(function (k) { alvo[k] = campos[k]; reg[k] = campos[k]; });
    }

    /* 3 antes de tudo: é o único que ainda lê turma para decidir. */
    plano.professores.forEach(function (d) {
      mudar(d, discMudadas, { professores: professoresDaDisciplina(d) });
    });

    /* 1. Os campos são calculados ANTES de aplicados: com `disciplinaId`
       gravado, `descricaoDe` deixa de trazer a turma antiga. */
    plano.migrar.forEach(function (o) {
      var t = turmaLegada(o);
      if (!t) return;
      var campos = { disciplinaId: t.disciplinaId, descricao: descricaoDe(o) };
      if (!o.responsavelId && t.professorCoordenadorId) campos.responsavelId = t.professorCoordenadorId;
      mudar(o, reservasMudadas, campos);
    });

    /* 2. */
    var reservas = estado.recorrencias.concat(estado.pontuais);
    plano.unificar.forEach(function (g) {
      if (chaves && chaves.indexOf(g.chave) === -1) return;
      var profs = professoresDaDisciplina(g.destino);
      g.membros.forEach(function (m) {
        var d = m.disciplina;
        reservas.forEach(function (o) {
          if (disciplinaIdDe(o) !== d.id) return;
          var desc = descricaoDe(o);
          if (desc.indexOf(m.turma) === -1) desc = m.turma + (desc ? ' · ' + desc : '');
          mudar(o, reservasMudadas, { disciplinaId: g.destino.id, descricao: desc });
        });
        professoresDaDisciplina(d).forEach(function (p) { if (profs.indexOf(p) === -1) profs.push(p); });
        if (d.id !== g.destino.id) apagar.push(d);
      });
      var campos = { professores: profs };
      if (g.renomear) campos.nome = g.base;
      mudar(g.destino, discMudadas, campos);
    });

    var idsApagados = apagar.map(function (d) { return d.id; });
    estado.disciplinas = estado.disciplinas.filter(function (d) { return idsApagados.indexOf(d.id) === -1; });
    commit();

    var passos = [];
    Object.keys(reservasMudadas).forEach(function (id) {
      passos.push(N.gravar('ocupacoes', id, reservasMudadas[id]));
    });
    Object.keys(discMudadas).forEach(function (id) {
      if (idsApagados.indexOf(id) === -1) passos.push(N.gravar('disciplinas', id, discMudadas[id]));
    });
    idsApagados.forEach(function (id) { passos.push(N.apagar('disciplinas', id)); });
    var contagem = {
      reservas: Object.keys(reservasMudadas).length,
      disciplinas: Object.keys(discMudadas).length, apagadas: idsApagados.length
    };
    /* Sem desfazer peça por peça: a falha pode ter sido parcial. Relê o
       acervo do servidor, que é a verdade — e a limpeza pode rodar de novo. */
    return persistir(global.Promise.all(passos), function () {
      carregar().then(function () { commit(); });
    }).then(function (r) { r.contagem = contagem; return r; });
  }

  /* ── Mutações: acessos ────────────────────────────────────────────────
     Com a lista no Firestore, conceder acesso pela tela voltou a ser
     verdade: vale para todo mundo, não só para o navegador de quem clicou.
     São as Security Rules que garantem que só o coordenador escreve aqui —
     a interface esconde o botão, o servidor é quem recusa. */
  function salvarAutorizado(email, dados) {
    var chave = String(email || '').trim().toLowerCase();
    if (!chave) return global.Promise.resolve({ ok: false, mensagem: 'Informe o e-mail.' });
    return persistir(N.gravar('autorizados', chave, {
      nome: dados.nome || chave.split('@')[0],
      nivel: dados.nivel || dados.perfil,
      ativo: dados.ativo !== false
    }));
  }

  function removerAutorizado(email) {
    var chave = String(email || '').trim().toLowerCase();
    if (chave === euId()) {
      return global.Promise.resolve({ ok: false, mensagem: 'Você não pode remover o próprio acesso.' });
    }
    return persistir(N.apagar('autorizados', chave));
  }

  /* ── Mutações: clínicas e parâmetros ─────────────────────────────── */
  function atualizarClinica(id, dados) {
    var c = clinica(id); if (!c) return;
    var antes = JSON.parse(JSON.stringify(c));
    /* 'cadeiras' fica de fora de propósito. Não é mais porque 14 seja
       invariante — as pré-clínicas têm 70 e 20 —, e sim porque a numeração
       das cadeiras é GLOBAL e contínua: mudar o tamanho de uma clínica
       deslocaria a primeira cadeira de todas as seguintes, e com ela cada
       manutenção e cada atribuição já gravada, que guardam o número global.
       Trocar o tamanho exige remapear esses registros — não é um campo de
       formulário. */
    ['nome', 'abertura', 'fechamento'].forEach(function (k) {
      if (dados[k] !== undefined) c[k] = dados[k];
    });
    commit();
    persistir(N.gravar('clinicas', id, {
      nome: c.nome, abertura: c.abertura, fechamento: c.fechamento
    }), function () { Object.keys(antes).forEach(function (k) { c[k] = antes[k]; }); });
  }

  function atualizarParametros(dados) {
    var antes = JSON.parse(JSON.stringify(estado.parametros));
    Object.keys(dados).forEach(function (k) { estado.parametros[k] = dados[k]; });
    commit();
    persistir(N.gravar('config', 'sistema', { parametros: estado.parametros }), function () {
      estado.parametros = antes;
    });
  }

  function atualizarSemestre(inicio, fim) {
    var antes = { inicio: estado.semestre.inicio, fim: estado.semestre.fim };
    estado.semestre = { inicio: inicio, fim: fim };
    commit();
    persistir(N.gravar('config', 'sistema', { semestre: estado.semestre }), function () {
      estado.semestre = antes;
    });
  }

  /* ── Provisionamento ──────────────────────────────────────────────────
     O Firestore nasce vazio, e sem agrupamentos e clínicas nenhuma tela tem
     o que mostrar. Isto grava a estrutura física uma única vez, a partir de
     Dados.semente(). Não toca em pessoas nem em atividade: só a estrutura e
     a configuração inicial do semestre. */
  function estruturaPendente() {
    return !!estado && !estado.agrupamentos.length;
  }

  function provisionarEstrutura() {
    var base = D.semente();
    var passos = [];
    base.agrupamentos.forEach(function (g) {
      passos.push(N.gravar('agrupamentos', g.id, { nome: g.nome, clinicas: g.clinicas }));
    });
    base.clinicas.forEach(function (c) {
      passos.push(N.gravar('clinicas', c.id, {
        nome: c.nome, agrupamentoId: c.agrupamentoId, especialidade: c.especialidade,
        cadeiras: c.cadeiras, primeiraCadeira: c.primeiraCadeira,
        abertura: c.abertura, fechamento: c.fechamento
      }));
    });
    passos.push(N.gravar('config', 'sistema', {
      versao: VERSAO, periodoLetivo: base.periodoLetivo,
      semestre: base.semestre, parametros: base.parametros
    }));
    return persistir(global.Promise.all(passos).then(function () { return carregar(); })
      .then(function () { commit(); return true; }));
  }

  /* ── Métricas ─────────────────────────────────────────────────────────
     A semana letiva é segunda a sábado. Antes o painel somava 7 dias e os
     relatórios 6, e as duas telas discordavam sobre a mesma semana. */
  function fimDaSemana(ini) { return C.addDays(ini, 5); }

  /* Horas de USO de uma clínica num dia: a UNIÃO dos intervalos das
     ocupações dela. Desde 05/10/2026 duas reservas podem dividir a clínica no
     mesmo horário, cada uma com as suas cadeiras — somar as durações
     contaria a mesma hora duas vezes e a clínica passaria de 100%. */
  function horasDeUso(lista) {
    var faixas = lista.map(function (o) { return [C.toMin(o.inicio), C.toMin(o.fim)]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var total = 0, ini = null, fim = null;
    faixas.forEach(function (f) {
      if (ini === null || f[0] > fim) {
        if (ini !== null) total += fim - ini;
        ini = f[0]; fim = f[1];
      } else if (f[1] > fim) {
        fim = f[1];
      }
    });
    if (ini !== null) total += fim - ini;
    return total / 60;
  }
  function horasDaClinica(clinicaId, ini, fim) {
    var h = 0, d = ini, guarda = 0;
    while (d <= fim && guarda++ < 400) {
      h += horasDeUso(ocorrenciasDoDia(d, clinicaId));
      d = C.addDays(d, 1);
    }
    return h;
  }
  /* Cadeiras de uma ocorrência que caem DENTRO de uma clínica: a ocupação
     das duas clínicas tem parte das cadeiras em cada uma. */
  function cadeirasNaClinica(o, clinicaId) {
    var f = faixaCadeiras(clinicaId);
    return o.cadeirasLista.filter(function (n) { return n >= f[0] && n <= f[1]; }).length;
  }

  /* Horas de clínica, e não horas de relógio: uma ocupação das duas
     clínicas consome hora nas duas. */
  function horasPorClinica(ini) {
    var fim = fimDaSemana(ini);
    return estado.clinicas.map(function (c) {
      return { clinica: c, horas: horasDaClinica(c.id, ini, fim) };
    });
  }
  function horasSemana(ini) {
    return horasPorClinica(ini).reduce(function (s, x) { return s + x.horas; }, 0);
  }
  function horasPorAgrupamento(ini) {
    var fim = fimDaSemana(ini);
    return estado.agrupamentos.map(function (g) {
      var h = 0;
      clinicasDoAgrupamento(g.id).forEach(function (c) { h += horasDaClinica(c.id, ini, fim); });
      return { agrupamento: g, horas: h };
    });
  }
  /* Cadeira·hora: a medida de ocupação que a reserva por quantidade pede.
     Uma clínica de 14 cadeiras com uma turma de 7 a manhã inteira está em
     uso a manhã inteira, mas só meio ocupada — e é a outra metade que fica
     livre para reserva. */
  function cadeirasHoraPorClinica(ini) {
    var fim = fimDaSemana(ini);
    return estado.clinicas.map(function (c) {
      var ch = 0;
      ocorrenciasIntervalo(ini, fim, c.id).forEach(function (o) {
        ch += C.duracaoH(o.inicio, o.fim) * cadeirasNaClinica(o, c.id);
      });
      return { clinica: c, cadeirasHora: ch };
    });
  }
  function horasPorDisciplina(ini) {
    var fim = fimDaSemana(ini), mapa = {};
    ocorrenciasIntervalo(ini, fim).forEach(function (o) {
      if (!o.disciplinaId) return;
      mapa[o.disciplinaId] = (mapa[o.disciplinaId] || 0) + C.duracaoH(o.inicio, o.fim);
    });
    return estado.disciplinas.map(function (d) {
      return { disciplina: d, horas: mapa[d.id] || 0 };
    }).sort(function (a, b) { return b.horas - a.horas; });
  }
  function emAndamento() {
    return ocorrenciasDoDia(C.hojeISO()).filter(function (o) {
      return statusOcorrencia(o) === 'em_andamento';
    });
  }
  /* Cadeira EM USO é cadeira alocada a uma ocupação em andamento — desde
     05/10/2026 a alocação já é a marcação de uso, sem o professor registrar
     cadeira por cadeira. A reserva integral antiga conta o escopo inteiro,
     que é o que ela segura. */
  function cadeirasEmUsoAgora() {
    var n = 0;
    emAndamento().forEach(function (o) { n += o.cadeiras; });
    return n;
  }

  /* ── Permissão sobre as cadeiras de uma reserva ───────────────────────
     Coordenação troca as cadeiras de qualquer reserva; o professor, as da
     reserva pela qual responde e as das disciplinas a que está vinculado —
     "o professor responsável por cada disciplina que está ocupando".
     Aceita documento ou ocorrência: as duas formas passam pelos mesmos
     resolvedores. */
  function podeGerirCadeiras(o) {
    if (!o || !usuarioAtual || !pode('cadeira.ocupar')) return false;
    if (usuarioAtual.perfil === 'coordenador') return true;
    var doc = o.origemId ? reservaPorId(o.origemId) : o;
    if (!doc) return false;
    if (responsavelDe(doc) === usuarioAtual.id) return true;
    var did = disciplinaIdDe(doc);
    return !!did && professoresDaDisciplina(disciplina(did)).indexOf(usuarioAtual.id) !== -1;
  }
  /* Com a aprovação ligada, o professor TROCA cadeiras e pode devolver
     algumas, mas não cresce a reserva além do que a coordenação aprovou —
     senão pedir 5 e depois marcar 14 passaria por fora da fila. */
  function limiteDeCadeiras(o) {
    var doc = o && o.origemId ? reservaPorId(o.origemId) : o;
    if (!doc) return 0;
    var cap = capacidadeEscopo(doc.agrupamentoId, doc.escopo);
    if (!usuarioAtual || usuarioAtual.perfil === 'coordenador' || !exigirAprovacao()) return cap;
    return Math.min(cap, quantidadeDe(doc));
  }
  function totalCadeiras() {
    return estado.clinicas.reduce(function (s, c) { return s + c.cadeiras; }, 0);
  }

  /* Consulta os tipos vigentes E os legados: sem os legados, uma atividade
     gravada antes de 17/09/2026 apareceria com o id cru ("reposicao").
     'aula' é o tipo das recorrentes gravadas antes de 05/10/2026, que não
     tinham campo de tipo; quem precisa distinguir graduação de pós nelas usa
     `nivelDe`, que olha a disciplina. */
  function rotuloTipoAtividade(id) {
    var r = id;
    D.TIPOS_ATIVIDADE.concat(D.TIPOS_LEGADOS).forEach(function (t) {
      if (t.id === id) r = t.rotulo;
    });
    return id === 'aula' ? 'Graduação' : r;
  }
  function rotuloCategoriaManutencao(id) {
    var r = id;
    D.CATEGORIAS_MANUTENCAO.forEach(function (c) { if (c.id === id) r = c.rotulo; });
    return r;
  }

  global.Store = {
    get estado() { return estado; },
    carregar: carregar, assinar: assinar, emitir: emitir,
    entrar: entrar, conferir: conferir,
    salvarAutorizado: salvarAutorizado, removerAutorizado: removerAutorizado,
    usuario: usuario, sair: sair, pode: pode,
    clinica: clinica, nomeClinica: nomeClinica,
    agrupamento: agrupamento, nomeAgrupamento: nomeAgrupamento,
    clinicasDoAgrupamento: clinicasDoAgrupamento, agrupamentoDaClinica: agrupamentoDaClinica,
    clinicasDoEscopo: clinicasDoEscopo, idsDoEscopo: idsDoEscopo,
    escopoCobre: escopoCobre, escoposColidem: escoposColidem,
    faixaCadeiras: faixaCadeiras, faixaEscopo: faixaEscopo, clinicaDaCadeira: clinicaDaCadeira,
    rotuloEscopo: rotuloEscopo, localCadeira: localCadeira,
    capacidadeEscopo: capacidadeEscopo, cadeirasOperantesEscopo: cadeirasOperantesEscopo,
    cadeirasInterditadas: cadeirasInterditadas,
    poolDoEscopo: poolDoEscopo, rotuloEscopoCurto: rotuloEscopoCurto,
    ehPreClinica: ehPreClinica, ambienteDe: ambienteDe,
    disciplina: disciplina,
    aluno: aluno, pessoa: pessoa, nomePessoa: nomePessoa,
    subtituloAgrupamento: subtituloAgrupamento,
    ehEspecializacao: ehEspecializacao, especializacoes: especializacoes,
    disciplinasDeGraduacao: disciplinasDeGraduacao, disciplinasDoNivel: disciplinasDoNivel,
    nivelDaDisciplina: nivelDaDisciplina,
    rotuloDisciplina: rotuloDisciplina, rotuloDisciplinaLongo: rotuloDisciplinaLongo,
    subtituloDisciplina: subtituloDisciplina,
    professoresDaDisciplina: professoresDaDisciplina, disciplinasDoProfessor: disciplinasDoProfessor,
    disciplinaIdDe: disciplinaIdDe, disciplinaDe: disciplinaDe, responsavelDe: responsavelDe,
    descricaoDe: descricaoDe, nivelDe: nivelDe,
    salvarEspecializacao: salvarEspecializacao, reservasDaDisciplina: reservasDaDisciplina,
    vincularDisciplinas: vincularDisciplinas,
    separarTurmaDoNome: separarTurmaDoNome,
    planoDeLimpeza: planoDeLimpeza, executarLimpeza: executarLimpeza,
    manutencoesAbertas: manutencoesAbertas, cadeiraEmManutencao: cadeiraEmManutencao,
    cadeirasOperantes: cadeirasOperantes, historicoCadeira: historicoCadeira,
    ocorrenciasDoDia: ocorrenciasDoDia, ocorrenciasIntervalo: ocorrenciasIntervalo,
    datasDaRegra: datasDaRegra, statusOcorrencia: statusOcorrencia,
    janelaHoras: janelaHoras,
    ehIntegral: ehIntegral, quantidadeDe: quantidadeDe, cadeirasDe: cadeirasDe,
    textoCadeiras: textoCadeiras,
    disponibilidade: disponibilidade, mapaDeCadeiras: mapaDeCadeiras,
    podeGerirCadeiras: podeGerirCadeiras, limiteDeCadeiras: limiteDeCadeiras,
    alterarCadeiras: alterarCadeiras,
    nomeNaCadeira: nomeNaCadeira, registrarNomeNaCadeira: registrarNomeNaCadeira,
    criarRecorrencia: criarRecorrencia, criarPontual: criarPontual,
    exigirAprovacao: exigirAprovacao, situacaoDe: situacaoDe,
    rotuloPedido: rotuloPedido,
    pedidosPendentes: pedidosPendentes, meusPedidos: meusPedidos,
    aprovarPedido: aprovarPedido, recusarPedido: recusarPedido,
    retirarPedido: retirarPedido,
    cancelarOcorrencia: cancelarOcorrencia, encerrarRecorrencia: encerrarRecorrencia,
    restaurarExcecao: restaurarExcecao,
    estaExcluida: estaExcluida, rotuloReserva: rotuloReserva, reservaPorId: reservaPorId,
    recorrenciasAtivas: recorrenciasAtivas, pontuaisAtivas: pontuaisAtivas,
    reservasExcluidas: reservasExcluidas,
    excluirReserva: excluirReserva, recuperarReserva: recuperarReserva,
    atribuicoesDa: atribuicoesDa, atribuicaoDaCadeira: atribuicaoDaCadeira,
    abrirManutencao: abrirManutencao, encerrarManutencao: encerrarManutencao,
    calcularImpacto: calcularImpacto,
    salvarDisciplina: salvarDisciplina, excluirDisciplina: excluirDisciplina,
    atualizarClinica: atualizarClinica, atualizarParametros: atualizarParametros,
    atualizarSemestre: atualizarSemestre,
    estruturaPendente: estruturaPendente, provisionarEstrutura: provisionarEstrutura,
    horasSemana: horasSemana, horasPorClinica: horasPorClinica,
    horasPorAgrupamento: horasPorAgrupamento, horasPorDisciplina: horasPorDisciplina,
    cadeirasHoraPorClinica: cadeirasHoraPorClinica, horasDeUso: horasDeUso,
    fimDaSemana: fimDaSemana,
    emAndamento: emAndamento, cadeirasEmUsoAgora: cadeirasEmUsoAgora, totalCadeiras: totalCadeiras,
    rotuloTipoAtividade: rotuloTipoAtividade, rotuloCategoriaManutencao: rotuloCategoriaManutencao
  };
})(window);
