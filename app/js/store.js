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

  /* Traduz o formato do Firestore para o formato que as telas já conhecem.
     Três traduções valem nota:
       autorizados  -> usuarios   (o campo `nivel` vira `perfil`)
       ocupacoes    -> recorrencias + pontuais, separadas por `tipo`
       matriculas   -> turma.alunos, reconstruído como array
     Assim nenhuma view precisou saber que os dados mudaram de lugar. */
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
    e.clinicas = (bruto.clinicas || []).slice().sort(function (a, b) {
      return (a.primeiraCadeira || 0) - (b.primeiraCadeira || 0);
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
    e.turmas = (bruto.turmas || []).map(function (t) {
      var copia = {};
      Object.keys(t).forEach(function (k) { copia[k] = t[k]; });
      copia.alunos = [];
      return copia;
    });
    (bruto.matriculas || []).forEach(function (m) {
      var t = porId(e.turmas, m.turmaId);
      if (t && t.alunos.indexOf(m.alunoId) === -1) t.alunos.push(m.alunoId);
    });

    (bruto.ocupacoes || []).forEach(function (o) {
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
    } else if (colecao === 'matriculas') {
      estado.turmas.forEach(function (t) { t.alunos = []; });
      documentos.forEach(function (m) {
        var t = porId(estado.turmas, m.turmaId);
        if (t && t.alunos.indexOf(m.alunoId) === -1) t.alunos.push(m.alunoId);
      });
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
     Um agrupamento reúne duas clínicas de 14 cadeiras. O escopo de uma
     ocupação diz o que ela toma: 'a' a primeira clínica, 'b' a segunda,
     'ambas' as duas (28 cadeiras). Número de cadeira é SEMPRE global,
     de 1 a 112; a posição dentro da clínica é n - primeiraCadeira + 1. */
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
  function clinicaDaCadeira(n) {
    for (var i = 0; i < estado.clinicas.length; i++) {
      var f = faixaCadeiras(estado.clinicas[i].id);
      if (n >= f[0] && n <= f[1]) return estado.clinicas[i];
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
  /* "Clínicas 3 e 4 · Clínica 4 · cadeira 51" */
  function localCadeira(n) {
    var c = clinicaDaCadeira(n);
    if (!c) return 'cadeira ' + C.pad(n);
    return nomeAgrupamento(c.agrupamentoId) + ' · ' + c.nome + ' · cadeira ' + C.pad(n);
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

  function disciplinaDaTurma(t) { return t ? disciplina(t.disciplinaId) : null; }
  /* A guarda de `d` não é zelo: o título de toda atividade pontual passa por
     aqui desde 17/09/2026, e um `d` nulo estourava TypeError dentro da
     montagem das ocorrências — o que derruba Agenda, Painel e Agora de uma
     vez, não só a linha da turma. A tela de disciplinas impede excluir
     disciplina com turma vinculada, mas nada impede alguém apagar o
     documento direto no console do Firebase. */
  function rotuloTurma(t) {
    if (!t) return '—';
    var d = disciplinaDaTurma(t);
    if (!d) return t.codigo;
    /* Na pós o nome da especialização É o rótulo. Código de disciplina e
       identificador de turma existem no documento porque o resto do sistema
       pressupõe os dois, mas ninguém da pós os conhece — imprimir
       "POS-01 PÓS" na agenda seria mostrar a plumbing. */
    if (ehEspecializacao(d)) return d.nome;
    return d.codigo + ' ' + t.codigo;
  }
  function rotuloTurmaLongo(t) {
    if (!t) return '—';
    var d = disciplinaDaTurma(t);
    if (!d) return t.codigo;
    if (ehEspecializacao(d)) return 'Pós-graduação · ' + d.nome;
    return d.codigo + ' ' + t.codigo + ' · ' + d.nome;
  }
  /* Linha de apoio do bloco na agenda: na graduação é o nome da disciplina,
     que o rótulo curto não traz; na pós o nome já está no rótulo, então
     sobra dizer de que nível é a atividade. */
  function subtituloTurma(t) {
    var d = disciplinaDaTurma(t);
    if (!d) return '';
    return ehEspecializacao(d) ? 'Pós-graduação' : d.nome;
  }
  function turmasDoProfessor(uid) {
    return estado.turmas.filter(function (t) { return t.professorCoordenadorId === uid; });
  }

  /* ── Pós-graduação ────────────────────────────────────────────────────
     A pós não tem disciplina nem turma: tem o nome da especialização e o
     professor responsável por ela. Mas a reserva recorrente aponta para uma
     TURMA — é dela que sai o `responsavelId` da ocupação, e é ele que
     governa quem pode cancelar. Sem turma, uma especialização só conseguiria
     lançar atividade pontual, que não é o caso de uso (pós ocupa clínica
     toda semana, o semestre inteiro).

     Por isso a especialização é gravada nas coleções que já existem: uma
     `disciplina` com `nivel: 'pos'` e UMA turma criada pelo sistema, que o
     formulário da pós nunca mostra. A alternativa — coleção nova
     `especializacoes` — exigiria publicar Security Rule nova no console
     antes de funcionar, e até lá toda gravação seria recusada pelo
     `match /{document=**}` que fecha o resto. Mudança de modelo que só
     funciona depois de alguém mexer no console não pode ir para `main`.

     Disciplina sem `nivel` é da graduação: é o estado de todo documento
     gravado antes desta mudança. */
  var CODIGO_TURMA_POS = 'PÓS';

  function ehEspecializacao(d) { return !!d && d.nivel === 'pos'; }
  function especializacoes() {
    return estado.disciplinas.filter(ehEspecializacao).sort(function (a, b) {
      return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
  }
  function disciplinasDeGraduacao() {
    return estado.disciplinas.filter(function (d) { return !ehEspecializacao(d); });
  }
  function turmasDeGraduacao() {
    return estado.turmas.filter(function (t) { return !ehEspecializacao(disciplinaDaTurma(t)); });
  }
  function turmaDaEspecializacao(disciplinaId) {
    var achada = null;
    estado.turmas.forEach(function (t) {
      if (!achada && t.disciplinaId === disciplinaId) achada = t;
    });
    return achada;
  }
  function professorDaEspecializacao(disciplinaId) {
    var t = turmaDaEspecializacao(disciplinaId);
    return t ? t.professorCoordenadorId : null;
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

  /* ── Expansão de recorrências ─────────────────────────────────────── */
  function ocorrenciaDeRegra(r, data) {
    var t = turma(r.turmaId);
    return {
      chave: 'r:' + r.id + ':' + data,
      origem: 'recorrente', origemId: r.id,
      agrupamentoId: r.agrupamentoId, escopo: r.escopo,
      data: data, inicio: r.inicio, fim: r.fim,
      turmaId: r.turmaId,
      /* Reserva é sempre integral: 14 cadeiras numa clínica, 28 nas duas do
         agrupamento. `cadeiras` virou DERIVADO do escopo em 17/09/2026 e o
         valor gravado no documento é ignorado — ocupação antiga que reservava
         10 de 14 passa a valer como clínica inteira, que é a regra nova. */
      cadeiras: capacidadeEscopo(r.agrupamentoId, r.escopo),
      /* Pelo rótulo, e não por `d.codigo + t.codigo`: é o único que sabe que
         a pós se chama pelo nome da especialização — e o único que não
         estoura quando a disciplina foi apagada por fora, no console. */
      titulo: rotuloTurma(t),
      subtitulo: subtituloTurma(t),
      responsavelId: t ? t.professorCoordenadorId : null,
      tipoAtividade: 'aula',
      descricao: ''
    };
  }
  /* Título DERIVADO: tipo + turma, ou tipo + quem pediu quando a atividade
     não tem turma vinculada. Deixou de ser campo digitado em 17/09/2026 —
     cada pessoa escrevia num formato diferente e a mesma atividade aparecia
     com três nomes diferentes na agenda.
     `titulo` aparece sozinho em dez lugares (bloco da agenda, gantt, CSV,
     toasts), por isso carrega o tipo junto; o nome da disciplina vai para
     `subtitulo`, como já acontece na recorrente. */
  function tituloPontual(p, t) {
    return rotuloTipoAtividade(p.tipoAtividade) + ' · ' +
      (t ? rotuloTurma(t) : nomePessoa(p.responsavelId));
  }
  function ocorrenciaDePontual(p) {
    var t = p.turmaId ? turma(p.turmaId) : null;
    var d = t ? disciplinaDaTurma(t) : null;
    return {
      chave: 'p:' + p.id,
      origem: 'pontual', origemId: p.id,
      agrupamentoId: p.agrupamentoId, escopo: p.escopo,
      data: p.data, inicio: p.inicio, fim: p.fim,
      turmaId: p.turmaId,
      cadeiras: capacidadeEscopo(p.agrupamentoId, p.escopo),
      titulo: tituloPontual(p, t),
      subtitulo: d ? d.nome : '',
      /* Só existe em ocupação gravada antes da mudança. O detalhe da agenda
         mostra quando houver, para o texto que alguém escreveu não sumir. */
      tituloOriginal: p.titulo || '',
      responsavelId: p.responsavelId,
      tipoAtividade: p.tipoAtividade,
      descricao: p.descricao || ''
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
     Mora aqui, e não na Agenda, porque a versão impressa precisa produzir
     EXATAMENTE a mesma grade da tela — é o que a impressão promete. Duas
     cópias da derivação divergiriam na primeira clínica que mudasse de
     horário, e a folha impressa passaria a mostrar uma semana que não é a
     que está na tela.

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

  /* Distribui ocorrências na linha da hora em que COMEÇAM. O que começa
     antes da abertura entra na primeira linha e o que começa depois da
     última entra na última — nada some da grade. */
  function baldesPorHora(itens, h0, h1) {
    var mapa = {};
    itens.forEach(function (o) {
      var h = Math.floor(C.toMin(o.inicio) / 60);
      if (h < h0) h = h0;
      if (h > h1) h = h1;
      if (!mapa[h]) mapa[h] = [];
      mapa[h].push(o);
    });
    return mapa;
  }

  /* ── Conflitos ────────────────────────────────────────────────────── */
  /* Verifica sobreposição de horário entre ocupações que disputam ao menos
     uma clínica. Uma ocupação de escopo duplo choca com qualquer uma das
     duas metades. `ignorar` é o id de origem a desconsiderar (edição do
     próprio registro). */
  function conflitos(agrupamentoId, escopo, datas, inicio, fim, ignorar) {
    if (!estado.parametros.bloquearSobreposicao) return [];
    var achados = [];
    datas.forEach(function (data) {
      ocorrenciasDoDia(data, { agrupamentoId: agrupamentoId }).forEach(function (o) {
        if (ignorar && o.origemId === ignorar) return;
        if (!escoposColidem(agrupamentoId, escopo, o.agrupamentoId, o.escopo)) return;
        if (C.sobrepoe(inicio, fim, o.inicio, o.fim)) achados.push(o);
      });
    });
    return achados;
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

  /* `excedeCapacidade` deixou de existir junto com a quantidade pedida no
     formulário: não há mais número a comparar com o teto, porque a reserva é
     sempre o escopo inteiro. Quem mede ocupação de verdade agora é a
     contagem de cadeiras registradas em uso (`atribuicoesDa`). */

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
     sobreposição antes de gravar — é o que impede duas pessoas de gravarem
     em cima uma da outra depois de as duas passarem na validação local. */
  function resumoDaOcupacao(o) {
    return {
      id: o.id, tipo: o.tipo, escopo: o.escopo,
      inicio: o.inicio, fim: o.fim,
      dias: o.dias || null, data: o.data || null,
      vigenciaInicio: o.vigenciaInicio || null, vigenciaFim: o.vigenciaFim || null,
      encerradaEm: o.encerradaEm || null,
      excecoes: (o.excecoes || []).map(function (x) { return x.data; })
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

  /* Dois itens disputam espaço quando compartilham clínica, se cruzam no
     horário e caem em pelo menos um mesmo dia do calendário. */
  function itensChocam(agrupamentoId, a, b) {
    if (!escoposColidem(agrupamentoId, a.escopo, agrupamentoId, b.escopo)) return false;
    if (!C.sobrepoe(a.inicio, a.fim, b.inicio, b.fim)) return false;
    var da = datasDoItem(a), db = datasDoItem(b);
    for (var i = 0; i < da.length; i++) if (db.indexOf(da[i]) !== -1) return true;
    return false;
  }

  function gravarOcupacaoNaNuvem(o, ignorarId) {
    var resumo = resumoDaOcupacao(o);
    var checar = estado.parametros.bloquearSobreposicao;
    return N.gravarOcupacao(o.agrupamentoId, o.id, o, function (itens) {
      if (!checar) return null;
      for (var i = 0; i < itens.length; i++) {
        var it = itens[i];
        if (it.id === o.id || (ignorarId && it.id === ignorarId)) continue;
        if (itensChocam(o.agrupamentoId, resumo, it)) {
          /* Cobre os dois casos: choque com algo que já estava lá, e a
             corrida em que alguém gravou enquanto o formulário era
             preenchido. Culpar "outra pessoa" sempre seria mentira na
             primeira situação, que é a mais comum. */
          return 'Este horário choca com uma ocupação já registrada neste agrupamento. ' +
            'Se a agenda parecia livre, alguém gravou enquanto você preenchia — reveja o horário.';
        }
      }
      return null;
    }, resumo);
  }

  /* ── Mutações: agenda ─────────────────────────────────────────────── */
  function criarRecorrencia(dados) {
    var r = {
      id: N.novoId('ocupacoes'), tipo: 'recorrente',
      agrupamentoId: dados.agrupamentoId, escopo: dados.escopo || 'a',
      turmaId: dados.turmaId,
      dias: dados.dias.slice().sort(), inicio: dados.inicio, fim: dados.fim,
      /* Sem `cadeiras`: a reserva é o escopo inteiro e o número é derivado na
         leitura. Gravar a chave mandaria `undefined`, que o Firestore recusa. */
      /* A vigência nunca escapa do semestre: fora dele a agenda geraria
         encontros que nenhuma tela consegue mostrar. */
      vigenciaInicio: maiorISO(dados.vigenciaInicio, estado.semestre.inicio),
      vigenciaFim: menorISO(dados.vigenciaFim, estado.semestre.fim),
      periodoLetivo: estado.periodoLetivo,
      excecoes: [], encerradaEm: null,
      criadoPor: euId(), criadoEm: C.carimbo(),
      observacao: dados.observacao || ''
    };
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
      /* Sem `titulo` nem `cadeiras`: os dois viraram derivados. Gravar a chave
         mandaria `undefined`, que o Firestore recusa — e derrubaria o registro
         inteiro no primeiro clique. */
      descricao: dados.descricao || '',
      turmaId: dados.turmaId || null, responsavelId: dados.responsavelId,
      excecoes: [],
      situacao: soPedido ? 'pendente' : 'aprovada',
      criadoPor: euId(), criadoEm: C.carimbo()
    };
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
    return tituloPontual(p, p.turmaId ? turma(p.turmaId) : null);
  }

  /* Rótulo de uma reserva CRUA (o documento), não de ocorrência: a lixeira
     lista documentos, que não passam por `ocorrenciaDeRegra`/`DePontual`.
     Serve os dois tipos. */
  function rotuloReserva(o) {
    if (!o) return '—';
    if (o.tipo === 'pontual') return rotuloPedido(o);
    return rotuloTipoAtividade('aula') + ' · ' + rotuloTurma(turma(o.turmaId));
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
     que ele entra na transação e no índice, e aqui que o choque pode barrar.
     Devolve promessa porque a coordenação precisa saber se passou — se dois
     pedidos disputam o mesmo horário, o segundo falha e o motivo aparece. */
  function aprovarPedido(id) {
    var p = porId(estado.pontuais, id);
    if (!p || !ehPendente(p)) return global.Promise.resolve({ ok: false, mensagem: 'Pedido não está pendente.' });
    var antes = { situacao: p.situacao, decididoPor: p.decididoPor, decididoEm: p.decididoEm };
    p.situacao = 'aprovada';
    p.decididoPor = euId();
    p.decididoEm = C.carimbo();
    commit();
    return persistir(gravarOcupacaoNaNuvem(p), function () {
      Object.keys(antes).forEach(function (k) { p[k] = antes[k]; });
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

  function atualizarRecorrencia(id, dados) {
    var r = porId(estado.recorrencias, id);
    if (!r) return;
    var antes = JSON.parse(JSON.stringify(r));
    /* 'cadeiras' saiu: derivado do escopo. */
    ['agrupamentoId', 'escopo', 'turmaId', 'inicio', 'fim',
      'vigenciaInicio', 'vigenciaFim', 'observacao']
      .forEach(function (k) { if (dados[k] !== undefined) r[k] = dados[k]; });
    if (dados.dias) r.dias = dados.dias.slice().sort();
    r.vigenciaInicio = maiorISO(r.vigenciaInicio, estado.semestre.inicio);
    r.vigenciaFim = menorISO(r.vigenciaFim, estado.semestre.fim);
    commit();
    persistir(gravarOcupacaoNaNuvem(r, id), function () {
      Object.keys(antes).forEach(function (k) { r[k] = antes[k]; });
    });
  }

  function atualizarPontual(id, dados) {
    var p = porId(estado.pontuais, id);
    if (!p) return;
    var antes = JSON.parse(JSON.stringify(p));
    /* 'titulo' e 'cadeiras' saíram da lista: são derivados. Deixá-los aqui
       seria convite para reintroduzir campo digitado. */
    ['agrupamentoId', 'escopo', 'data', 'inicio', 'fim',
      'tipoAtividade', 'descricao', 'turmaId', 'responsavelId']
      .forEach(function (k) { if (dados[k] !== undefined) p[k] = dados[k]; });
    commit();
    persistir(gravarOcupacaoNaNuvem(p, id), function () {
      Object.keys(antes).forEach(function (k) { p[k] = antes[k]; });
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
     As atribuições de cadeira NÃO são limpas — é isso que faz a recuperação
     devolver a reserva como ela era, com os registros de uso. */
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

  /* Recuperar reindexa pela transação, e PODE FALHAR por choque: enquanto a
     reserva estava na lixeira o horário estava livre, e alguém pode ter
     ocupado. Falhar aqui é o comportamento certo — o contrário seria criar
     duas reservas no mesmo horário pelas costas da validação.
     Pedido que ainda não foi aprovado volta sem indexar, como nasceu. */
  function recuperarReserva(id) {
    var o = porId(estado.recorrencias, id) || porId(estado.pontuais, id);
    if (!o) return global.Promise.resolve({ ok: false, mensagem: 'Reserva não encontrada.' });
    if (!estaExcluida(o)) return global.Promise.resolve({ ok: false, mensagem: 'Reserva não está excluída.' });
    var antes = {
      excluidaEm: o.excluidaEm, excluidaPor: o.excluidaPor, motivoExclusao: o.motivoExclusao
    };
    o.excluidaEm = null;
    o.excluidaPor = null;
    o.motivoExclusao = '';
    commit();
    var indexavel = !(o.tipo === 'pontual' && situacaoDe(o) !== 'aprovada');
    return persistir(
      indexavel ? gravarOcupacaoNaNuvem(o) : N.gravar('ocupacoes', o.id, o),
      function () { Object.keys(antes).forEach(function (k) { o[k] = antes[k]; }); }
    );
  }

  function restaurarExcecao(regraId, data) {
    var r = porId(estado.recorrencias, regraId);
    if (!r) return;
    var antes = r.excecoes.slice();
    r.excecoes = r.excecoes.filter(function (e) { return e.data !== data; });
    commit();
    persistir(N.gravar('ocupacoes', regraId, { excecoes: r.excecoes })
      .then(function () { return N.atualizarIndice(r.agrupamentoId, regraId, resumoDaOcupacao(r)); }),
      function () { r.excecoes = antes; });
  }

  /* ── Mutações: cadeiras ───────────────────────────────────────────── */
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

  /* `numero` é o número GLOBAL da cadeira. Guardar a clínica derivada dele
     evita a colisão antiga, em que a cadeira 7 da Clínica 1 e a 7 da
     Clínica 2 gravavam a mesma chave numa ocupação conjunta. */
  function ocuparCadeira(o, numero, alunoId, nome) {
    if (atribuicaoDaCadeira(o.chave, numero)) return false;
    var c = clinicaDaCadeira(numero);
    var registro = {
      id: N.novoId('atribuicoes'), chave: o.chave, clinicaId: c ? c.id : null,
      cadeira: numero,
      /* Registrar cadeira em uso deixou de depender de aluno cadastrado em
         17/09/2026: o professor marca a cadeira e, se quiser, escreve quem
         está nela. `null` e string vazia o Firestore aceita — undefined não.
         `alunoId` sobrevive por causa dos registros antigos. */
      alunoId: alunoId || null,
      nome: String(nome || '').trim(),
      data: o.data,
      registradoPor: euId(), registradoEm: C.carimbo()
    };
    estado.atribuicoes.push(registro);
    commit();
    persistir(N.gravar('atribuicoes', registro.id, registro), function () {
      estado.atribuicoes = estado.atribuicoes.filter(function (a) { return a.id !== registro.id; });
    });
    return true;
  }

  function liberarCadeira(chave, numero) {
    var alvo = atribuicaoDaCadeira(chave, numero);
    if (!alvo) return;
    estado.atribuicoes = estado.atribuicoes.filter(function (a) { return a.id !== alvo.id; });
    commit();
    persistir(N.apagar('atribuicoes', alvo.id), function () { estado.atribuicoes.push(alvo); });
  }

  /* ── Mutações: manutenção ─────────────────────────────────────────── */
  function proximoProtocolo() {
    var ano = String(C.parseISO(C.hojeISO()).getFullYear()).slice(2);
    var n = 1000 + estado.manutencoes.length + 1;
    return 'MNT-' + ano + '-' + n;
  }

  /* Levantamento automático do impacto: quais ocorrências dos próximos 14
     dias ficam sem cadeira suficiente com esta cadeira fora de operação. */
  function calcularImpacto(clinicaId, cadeira) {
    var hoje = C.hojeISO(), fim = C.addDays(hoje, 14);
    var jaInterditada = !!cadeiraEmManutencao(clinicaId, cadeira);
    var operantesDepois = cadeirasOperantes(clinicaId) - (jaInterditada ? 0 : 1);
    /* Uma ocupação de escopo duplo dispõe das cadeiras das duas clínicas —
       comparar com o total de uma só superestimaria o impacto. */
    /* Mede pelo USO registrado, não pela reserva. Com reserva sempre integral,
       comparar contra `o.cadeiras` (agora igual à capacidade do escopo) faria
       QUALQUER interdição marcar TODAS as ocupações como afetadas — aviso que
       grita sempre é aviso que ninguém lê. Afetada é a ocupação que já tem
       mais cadeiras em uso do que restará de operante. */
    var afetadas = ocorrenciasIntervalo(hoje, fim, clinicaId).filter(function (o) {
      var disponiveis = cadeirasOperantesEscopo(o.agrupamentoId, o.escopo) - (jaInterditada ? 0 : 1);
      return atribuicoesDa(o.chave).length > disponiveis;
    });
    var turmasAfetadas = [];
    afetadas.forEach(function (o) {
      var r = o.turmaId ? rotuloTurma(turma(o.turmaId)) : o.titulo;
      if (turmasAfetadas.indexOf(r) === -1) turmasAfetadas.push(r);
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

  /* ── Mutações: disciplinas, turmas, alunos ────────────────────────── */
  function salvarDisciplina(id, dados) {
    var d = id ? disciplina(id) : null;
    var novo = !d;
    if (!d) { d = { id: N.novoId('disciplinas') }; estado.disciplinas.push(d); }
    var antes = JSON.parse(JSON.stringify(d));
    ['codigo', 'nome', 'nivel'].forEach(function (k) {
      if (dados[k] !== undefined) d[k] = dados[k];
    });
    commit();
    /* Payload explícito, como em salvarTurma — não o objeto `d` inteiro, que
       carrega `id` e, nas disciplinas criadas antes desta mudança, os campos
       extintos que a hidratação copia crus do Firestore (linha 67).
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
     Duas gravações, cada uma com o próprio desfazer: a disciplina que guarda
     o nome e a turma que o sistema mantém por trás. Se a segunda falhar, a
     especialização fica sem turma e sem agenda possível — salvar de novo
     recria, porque `turmaDaEspecializacao` devolve null e o caminho é o
     mesmo do cadastro novo. */
  function salvarEspecializacao(id, dados) {
    var nome = String(dados.nome || '').trim();
    var prof = dados.professorResponsavelId;
    if (!nome || !prof) return null;
    var atual = id ? disciplina(id) : null;
    if (id && !atual) return null;
    var d = salvarDisciplina(id, {
      codigo: (atual && atual.codigo) || proximoCodigoPos(),
      nome: nome, nivel: 'pos'
    });
    var t = turmaDaEspecializacao(d.id);
    salvarTurma(t ? t.id : null, {
      disciplinaId: d.id, codigo: CODIGO_TURMA_POS, professorCoordenadorId: prof
    });
    return d;
  }

  /* A turma sai primeiro: é `excluirTurma` que tira as recorrências do
     índice de sobreposição. Excluir só a disciplina deixaria a reserva
     segurando horário para sempre. */
  function excluirEspecializacao(id) {
    var d = disciplina(id);
    if (!ehEspecializacao(d)) return;
    var t = turmaDaEspecializacao(id);
    if (t) excluirTurma(t.id);
    excluirDisciplina(id);
  }

  /* Sem cascata: diferente de excluirTurma, uma disciplina com turma
     vinculada não é removível — quem chama precisa checar antes (a view
     bloqueia com um toast). Excluir aqui sem essa checagem deixaria turmas
     apontando para um disciplinaId inexistente. */
  function excluirDisciplina(id) {
    var d = porId(estado.disciplinas, id);
    if (!d) return;
    estado.disciplinas = estado.disciplinas.filter(function (x) { return x.id !== id; });
    commit();
    persistir(N.apagar('disciplinas', id), function () {
      estado.disciplinas.push(d);
    });
  }

  function salvarTurma(id, dados) {
    var t = id ? turma(id) : null;
    var novo = !t;
    if (!t) {
      t = { id: N.novoId('turmas'), alunos: [], periodoLetivo: estado.periodoLetivo };
      estado.turmas.push(t);
    }
    var antes = JSON.parse(JSON.stringify(t));
    ['disciplinaId', 'codigo', 'professorCoordenadorId'].forEach(function (k) {
      if (dados[k] !== undefined) t[k] = dados[k];
    });
    commit();
    /* `alunos` é derivado da coleção matriculas — não vai no documento. */
    persistir(N.gravar('turmas', t.id, {
      disciplinaId: t.disciplinaId, codigo: t.codigo,
      professorCoordenadorId: t.professorCoordenadorId, periodoLetivo: t.periodoLetivo
    }), function () {
      if (novo) estado.turmas = estado.turmas.filter(function (x) { return x.id !== t.id; });
      else Object.keys(antes).forEach(function (k) { t[k] = antes[k]; });
    });
    return t;
  }

  function apagarMatriculasDaTurma(turmaId) {
    return N.lerColecao('matriculas').then(function (l) {
      return N.apagarVarios('matriculas', l.filter(function (m) {
        return m.turmaId === turmaId;
      }).map(function (m) { return m.id; }));
    });
  }

  function excluirTurma(id) {
    var t = porId(estado.turmas, id);
    if (!t) return;
    var regras = estado.recorrencias.filter(function (r) { return r.turmaId === id; });
    estado.turmas = estado.turmas.filter(function (x) { return x.id !== id; });
    estado.recorrencias = estado.recorrencias.filter(function (r) { return r.turmaId !== id; });
    commit();
    var passos = [N.apagar('turmas', id), apagarMatriculasDaTurma(id)];
    regras.forEach(function (r) { passos.push(N.removerOcupacao(r.agrupamentoId, r.id)); });
    persistir(global.Promise.all(passos), function () {
      estado.turmas.push(t);
      regras.forEach(function (r) { estado.recorrencias.push(r); });
    });
  }

  function vincularAluno(turmaId, dados) {
    var t = turma(turmaId); if (!t) return null;
    var a = null;
    estado.alunos.forEach(function (x) { if (x.matricula === dados.matricula) a = x; });
    var alunoNovo = !a;
    if (!a) {
      a = { id: N.novoId('alunos'), nome: dados.nome, matricula: dados.matricula, periodo: dados.periodo };
      estado.alunos.push(a);
    }
    if (t.alunos.indexOf(a.id) !== -1) return a;
    t.alunos.push(a.id);
    commit();
    /* Id determinístico: vincular duas vezes não cria matrícula duplicada. */
    var idMatricula = turmaId + '__' + a.id;
    var passos = [];
    if (alunoNovo) passos.push(N.gravar('alunos', a.id, a));
    passos.push(N.gravar('matriculas', idMatricula, { turmaId: turmaId, alunoId: a.id }));
    persistir(global.Promise.all(passos), function () {
      t.alunos = t.alunos.filter(function (x) { return x !== a.id; });
      if (alunoNovo) estado.alunos = estado.alunos.filter(function (x) { return x.id !== a.id; });
    });
    return a;
  }

  function desvincularAluno(turmaId, alunoId) {
    var t = turma(turmaId); if (!t) return;
    if (t.alunos.indexOf(alunoId) === -1) return;
    t.alunos = t.alunos.filter(function (x) { return x !== alunoId; });
    commit();
    persistir(N.apagar('matriculas', turmaId + '__' + alunoId), function () {
      t.alunos.push(alunoId);
    });
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
    /* 'cadeiras' fica de fora de propósito: 14 por clínica é invariante do
       modelo, e mexer nisso quebraria a numeração global de 1 a 112. */
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

  /* Horas de clínica, e não horas de relógio: uma ocupação das duas
     clínicas consome o dobro de horas de clínica. */
  function horasSemana(ini) {
    var total = 0;
    ocorrenciasIntervalo(ini, fimDaSemana(ini)).forEach(function (o) {
      total += C.duracaoH(o.inicio, o.fim) * clinicasDoEscopo(o.agrupamentoId, o.escopo).length;
    });
    return total;
  }
  function horasPorClinica(ini) {
    var fim = fimDaSemana(ini);
    return estado.clinicas.map(function (c) {
      var h = 0;
      ocorrenciasIntervalo(ini, fim, c.id).forEach(function (o) { h += C.duracaoH(o.inicio, o.fim); });
      return { clinica: c, horas: h };
    });
  }
  function horasPorAgrupamento(ini) {
    var fim = fimDaSemana(ini);
    return estado.agrupamentos.map(function (g) {
      var h = 0;
      ocorrenciasIntervalo(ini, fim, { agrupamentoId: g.id }).forEach(function (o) {
        h += C.duracaoH(o.inicio, o.fim) * clinicasDoEscopo(o.agrupamentoId, o.escopo).length;
      });
      return { agrupamento: g, horas: h };
    });
  }
  function horasPorTurma(ini) {
    var fim = fimDaSemana(ini), mapa = {};
    ocorrenciasIntervalo(ini, fim).forEach(function (o) {
      if (!o.turmaId) return;
      mapa[o.turmaId] = (mapa[o.turmaId] || 0) + C.duracaoH(o.inicio, o.fim);
    });
    return estado.turmas.map(function (t) {
      return { turma: t, horas: mapa[t.id] || 0 };
    }).sort(function (a, b) { return b.horas - a.horas; });
  }
  function emAndamento() {
    return ocorrenciasDoDia(C.hojeISO()).filter(function (o) {
      return statusOcorrencia(o) === 'em_andamento';
    });
  }
  /* Cadeira EM USO é cadeira com aluno registrado — nunca cadeira apenas
     reservada. O antigo fallback `atribuições || o.cadeiras` fazia o KPI do
     painel dizer "34 de 112" enquanto a tela de Ocupação, que conta só as
     atribuições, dizia "0 de 28" para os mesmos dados. */
  function cadeirasEmUsoAgora() {
    var n = 0;
    emAndamento().forEach(function (o) {
      n += atribuicoesDa(o.chave).length;
    });
    return n;
  }
  function totalCadeiras() {
    return estado.clinicas.reduce(function (s, c) { return s + c.cadeiras; }, 0);
  }

  /* Consulta os tipos vigentes E os legados: sem os legados, uma atividade
     gravada antes de 17/09/2026 apareceria com o id cru ("reposicao").
     'aula' é o tipo fixo das recorrentes — elas não têm campo de tipo, e
     turma de graduação é o que o recorrente atende hoje. */
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
    turma: turma, disciplina: disciplina,
    aluno: aluno, pessoa: pessoa, nomePessoa: nomePessoa,
    disciplinaDaTurma: disciplinaDaTurma, rotuloTurma: rotuloTurma, rotuloTurmaLongo: rotuloTurmaLongo,
    subtituloTurma: subtituloTurma, turmasDoProfessor: turmasDoProfessor,
    ehEspecializacao: ehEspecializacao, especializacoes: especializacoes,
    disciplinasDeGraduacao: disciplinasDeGraduacao, turmasDeGraduacao: turmasDeGraduacao,
    turmaDaEspecializacao: turmaDaEspecializacao,
    professorDaEspecializacao: professorDaEspecializacao,
    salvarEspecializacao: salvarEspecializacao, excluirEspecializacao: excluirEspecializacao,
    manutencoesAbertas: manutencoesAbertas, cadeiraEmManutencao: cadeiraEmManutencao,
    cadeirasOperantes: cadeirasOperantes, historicoCadeira: historicoCadeira,
    ocorrenciasDoDia: ocorrenciasDoDia, ocorrenciasIntervalo: ocorrenciasIntervalo,
    datasDaRegra: datasDaRegra, statusOcorrencia: statusOcorrencia,
    janelaHoras: janelaHoras, baldesPorHora: baldesPorHora,
    conflitos: conflitos, nomeNaCadeira: nomeNaCadeira,
    criarRecorrencia: criarRecorrencia, criarPontual: criarPontual,
    atualizarRecorrencia: atualizarRecorrencia, atualizarPontual: atualizarPontual,
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
    ocuparCadeira: ocuparCadeira, liberarCadeira: liberarCadeira,
    abrirManutencao: abrirManutencao, encerrarManutencao: encerrarManutencao,
    calcularImpacto: calcularImpacto,
    salvarDisciplina: salvarDisciplina, excluirDisciplina: excluirDisciplina,
    salvarTurma: salvarTurma, excluirTurma: excluirTurma,
    vincularAluno: vincularAluno, desvincularAluno: desvincularAluno,
    atualizarClinica: atualizarClinica, atualizarParametros: atualizarParametros,
    atualizarSemestre: atualizarSemestre,
    estruturaPendente: estruturaPendente, provisionarEstrutura: provisionarEstrutura,
    horasSemana: horasSemana, horasPorClinica: horasPorClinica,
    horasPorAgrupamento: horasPorAgrupamento, horasPorTurma: horasPorTurma,
    fimDaSemana: fimDaSemana,
    emAndamento: emAndamento, cadeirasEmUsoAgora: cadeirasEmUsoAgora, totalCadeiras: totalCadeiras,
    rotuloTipoAtividade: rotuloTipoAtividade, rotuloCategoriaManutencao: rotuloCategoriaManutencao
  };
})(window);
