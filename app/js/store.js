/* store.js — estado, persistência e regras de negócio.
   Toda leitura de agenda passa por ocorrencias(): recorrências são
   expandidas em ocorrências concretas e mescladas às atividades pontuais. */
(function (global) {
  'use strict';
  var C = global.Core, A = global.Acesso, D = global.Dados;
  var CHAVE = 'ocupa.odonto.v5';
  var VERSAO = 5;
  /* A sessão vive fora do blob de dados: quem está logado é assunto deste
     navegador, não do acervo. Assim exportar ou restaurar dados nunca
     carrega junto a sessão de outra pessoa. */
  var CHAVE_SESSAO = 'ocupa.odonto.sessao';
  /* Chaves que um estado salvo precisa ter para ser considerado utilizável.
     Um blob com a versão certa mas incompleto quebraria as telas em silêncio. */
  var CHAVES_OBRIGATORIAS = ['agrupamentos', 'clinicas', 'usuarios', 'alunos',
    'disciplinas', 'turmas', 'recorrencias', 'pontuais', 'manutencoes', 'parametros'];

  var estado = null;
  var ouvintes = [];
  var ultimoErroPersistencia = null;

  /* ── Persistência ─────────────────────────────────────────────────── */
  function carregar() {
    var bruto = null;
    try { bruto = localStorage.getItem(CHAVE); } catch (e) { bruto = null; }
    if (bruto) {
      try {
        var s = JSON.parse(bruto);
        if (s && s.versao === VERSAO && formatoValido(s)) { estado = s; return estado; }
        /* Versão certa mas formato quebrado: guarda o bruto para diagnóstico
           em vez de descartar em silêncio, e semeia por cima. */
        if (s && s.versao === VERSAO) {
          try { localStorage.setItem(CHAVE + '.corrompido', bruto); } catch (e2) { }
        }
      } catch (e) { /* semente abaixo */ }
    }
    estado = D.semente();
    salvar();
    return estado;
  }
  /* Chamado pelo app depois de carregar(): reata a sessão deste navegador. */
  function iniciarSessao() { return carregarSessao(); }
  function formatoValido(s) {
    for (var i = 0; i < CHAVES_OBRIGATORIAS.length; i++) {
      var v = s[CHAVES_OBRIGATORIAS[i]];
      if (!v) return false;
      if (CHAVES_OBRIGATORIAS[i] !== 'parametros' && !(v instanceof Array)) return false;
    }
    return true;
  }
  /* Devolve true quando o estado realmente chegou ao disco. Quem muda dados
     precisa saber que falhou para não anunciar sucesso. */
  function salvar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(estado));
      return true;
    } catch (e) {
      ultimoErroPersistencia = (e && (e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22))
        ? 'cota' : 'indisponivel';
      return false;
    }
  }
  function assinar(fn) { ouvintes.push(fn); }
  function emitir() { ouvintes.forEach(function (f) { f(); }); }
  function commit() { salvar(); emitir(); }

  /* ── Sessão e permissões ────────────────────────────────────────────
     Não existe login por senha nem seleção de pessoa: a identidade vem do
     Google e o nível vem de autorizados.js. */
  var sessaoId = null;

  function carregarSessao() {
    try { sessaoId = localStorage.getItem(CHAVE_SESSAO) || null; } catch (e) { sessaoId = null; }
    if (sessaoId && !porId(estado.usuarios, sessaoId)) gravarSessao(null);
    return sessaoId;
  }
  function gravarSessao(id) {
    sessaoId = id || null;
    try {
      if (sessaoId) localStorage.setItem(CHAVE_SESSAO, sessaoId);
      else localStorage.removeItem(CHAVE_SESSAO);
    } catch (e) { }
  }
  function usuario() { return sessaoId ? porId(estado.usuarios, sessaoId) : null; }
  function sair() { gravarSessao(null); emitir(); }
  function pode(perm) { return A.pode(usuario(), perm); }

  function perfilValido(id) {
    for (var i = 0; i < A.PERFIS.length; i++) if (A.PERFIS[i].id === id) return true;
    return false;
  }
  function recusa(motivo, mensagem) { return { ok: false, motivo: motivo, mensagem: mensagem }; }

  /* Recebe a identidade já extraída do token do Google e decide se ela entra.
     Devolve {ok:true, usuario} ou {ok:false, motivo, mensagem}.

     Aviso honesto sobre o alcance: o token não é conferido contra o Google
     aqui — sem servidor não há onde validar a assinatura. Esta função barra
     acesso indevido casual, não um adversário com acesso à máquina. */
  function entrarComGoogle(identidade) {
    var cfg = global.Config || {};
    var email = String((identidade && identidade.email) || '').trim().toLowerCase();
    if (!email) return recusa('sem_email', 'A conta Google não informou um endereço de e-mail.');
    if (identidade.emailVerificado === false) {
      return recusa('email_nao_verificado', 'O e-mail desta conta Google não está verificado.');
    }

    if (cfg.dominioInstitucional) {
      var dom = String(cfg.dominioInstitucional).trim().toLowerCase().replace(/^@/, '');
      var domDaConta = String(identidade.hd || email.split('@')[1] || '').toLowerCase();
      if (domDaConta !== dom) {
        return recusa('fora_do_dominio', 'Entre com a sua conta institucional @' + dom + '.');
      }
    }

    var permitido = (global.Autorizados && global.Autorizados.buscar)
      ? global.Autorizados.buscar(email) : null;
    if (!permitido) {
      return recusa('nao_autorizado',
        'Este e-mail não está na lista de acesso ao sistema. Fale com a coordenação.');
    }
    if (!perfilValido(permitido.perfil)) {
      return recusa('perfil_invalido',
        'O nível de acesso configurado para este e-mail é inválido: "' + permitido.perfil + '".');
    }

    /* Primeiro acesso cria a pessoa; os seguintes só atualizam. O nível vem
       sempre da lista, para que revogar lá tenha efeito imediato. */
    var u = null;
    estado.usuarios.forEach(function (x) {
      if (String(x.email || '').trim().toLowerCase() === email) u = x;
    });
    if (!u) {
      u = {
        id: C.uid('u'), email: email,
        nome: permitido.nome || identidade.nome || email.split('@')[0],
        perfil: permitido.perfil, ativo: true,
        criadoEm: C.carimbo(), ultimoAcesso: null
      };
      estado.usuarios.push(u);
    } else {
      u.perfil = permitido.perfil;
      if (permitido.nome) u.nome = permitido.nome;
      else if (identidade.nome) u.nome = identidade.nome;
    }

    /* Suspensão feita no painel de acessos vence a lista. */
    if (!u.ativo) {
      return recusa('suspenso', 'O seu acesso está suspenso. Fale com a coordenação.');
    }

    u.ultimoAcesso = C.carimbo();
    gravarSessao(u.id);
    commit();
    return { ok: true, usuario: u };
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
  function rotuloTurma(t) {
    if (!t) return '—';
    var d = disciplinaDaTurma(t);
    return d.codigo + ' ' + t.codigo;
  }
  function rotuloTurmaLongo(t) {
    if (!t) return '—';
    var d = disciplinaDaTurma(t);
    return d.codigo + ' ' + t.codigo + ' · ' + d.nome;
  }
  function turmasDoProfessor(uid) {
    return estado.turmas.filter(function (t) { return t.professorCoordenadorId === uid; });
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
    var t = turma(r.turmaId), d = disciplinaDaTurma(t);
    return {
      chave: 'r:' + r.id + ':' + data,
      origem: 'recorrente', origemId: r.id,
      agrupamentoId: r.agrupamentoId, escopo: r.escopo,
      data: data, inicio: r.inicio, fim: r.fim,
      turmaId: r.turmaId, cadeiras: r.cadeiras,
      titulo: d.codigo + ' ' + t.codigo,
      subtitulo: d.nome,
      especialidade: d.especialidade,
      responsavelId: t.professorCoordenadorId,
      tipoAtividade: 'aula',
      descricao: ''
    };
  }
  function ocorrenciaDePontual(p) {
    var t = p.turmaId ? turma(p.turmaId) : null;
    return {
      chave: 'p:' + p.id,
      origem: 'pontual', origemId: p.id,
      agrupamentoId: p.agrupamentoId, escopo: p.escopo,
      data: p.data, inicio: p.inicio, fim: p.fim,
      turmaId: p.turmaId, cadeiras: p.cadeiras,
      titulo: p.titulo,
      subtitulo: t ? rotuloTurma(t) : rotuloTipoAtividade(p.tipoAtividade),
      especialidade: t ? disciplinaDaTurma(t).especialidade : null,
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
    estado.recorrencias.forEach(function (r) {
      if (r.dias.indexOf(dow) === -1) return;
      if (data < r.vigenciaInicio || data > r.vigenciaFim) return;
      /* encerradaEm é o primeiro dia inválido: "de hoje em diante" inclui hoje. */
      if (r.encerradaEm && data >= r.encerradaEm) return;
      for (var i = 0; i < r.excecoes.length; i++) if (r.excecoes[i].data === data) return;
      var o = ocorrenciaDeRegra(r, data);
      if (!casaFiltro(o, filtro)) return;
      saida.push(o);
    });
    estado.pontuais.forEach(function (p) {
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

  /* Capacidade: a ocorrência cabe nas cadeiras operantes do escopo?
     Escopo duplo tem o dobro de cadeiras — é o que torna possível registrar
     uma ocupação das duas clínicas. */
  function excedeCapacidade(agrupamentoId, escopo, cadeiras) {
    return cadeiras > cadeirasOperantesEscopo(agrupamentoId, escopo);
  }

  /* ── Mutações: agenda ─────────────────────────────────────────────── */
  function criarRecorrencia(dados) {
    var r = {
      id: C.uid('r'), tipo: 'recorrente',
      agrupamentoId: dados.agrupamentoId, escopo: dados.escopo || 'a',
      turmaId: dados.turmaId,
      dias: dados.dias.slice().sort(), inicio: dados.inicio, fim: dados.fim,
      cadeiras: dados.cadeiras,
      /* A vigência nunca escapa do semestre: fora dele a agenda geraria
         encontros que nenhuma tela consegue mostrar. */
      vigenciaInicio: maiorISO(dados.vigenciaInicio, estado.semestre.inicio),
      vigenciaFim: menorISO(dados.vigenciaFim, estado.semestre.fim),
      periodoLetivo: estado.periodoLetivo,
      excecoes: [], encerradaEm: null,
      criadoPor: sessaoId, criadoEm: C.carimbo(),
      observacao: dados.observacao || ''
    };
    estado.recorrencias.push(r);
    commit();
    return r;
  }

  function criarPontual(dados) {
    var p = {
      id: C.uid('p'), tipo: 'pontual',
      agrupamentoId: dados.agrupamentoId, escopo: dados.escopo || 'a',
      data: dados.data,
      inicio: dados.inicio, fim: dados.fim,
      tipoAtividade: dados.tipoAtividade, cadeiras: dados.cadeiras,
      titulo: dados.titulo, descricao: dados.descricao || '',
      turmaId: dados.turmaId || null, responsavelId: dados.responsavelId,
      criadoPor: sessaoId, criadoEm: C.carimbo()
    };
    estado.pontuais.push(p);
    commit();
    return p;
  }

  function atualizarRecorrencia(id, dados) {
    var r = porId(estado.recorrencias, id);
    if (!r) return;
    ['agrupamentoId', 'escopo', 'turmaId', 'inicio', 'fim', 'cadeiras',
      'vigenciaInicio', 'vigenciaFim', 'observacao']
      .forEach(function (k) { if (dados[k] !== undefined) r[k] = dados[k]; });
    if (dados.dias) r.dias = dados.dias.slice().sort();
    r.vigenciaInicio = maiorISO(r.vigenciaInicio, estado.semestre.inicio);
    r.vigenciaFim = menorISO(r.vigenciaFim, estado.semestre.fim);
    commit();
  }

  function atualizarPontual(id, dados) {
    var p = porId(estado.pontuais, id);
    if (!p) return;
    Object.keys(dados).forEach(function (k) { if (dados[k] !== undefined) p[k] = dados[k]; });
    commit();
  }

  /* Cancela uma única ocorrência: exceção na regra, ou remove a pontual. */
  function cancelarOcorrencia(o, motivo) {
    if (o.origem === 'recorrente') {
      var r = porId(estado.recorrencias, o.origemId);
      if (!r) return;
      r.excecoes.push({
        data: o.data, motivo: motivo || 'Sem motivo informado',
        registradoPor: sessaoId, registradoEm: C.carimbo()
      });
    } else {
      estado.pontuais = estado.pontuais.filter(function (p) { return p.id !== o.origemId; });
    }
    estado.atribuicoes = estado.atribuicoes.filter(function (a) { return a.chave !== o.chave; });
    commit();
  }

  /* Encerra a recorrência a partir de uma data (mantém o histórico). */
  function encerrarRecorrencia(id, data) {
    var r = porId(estado.recorrencias, id);
    if (!r) return;
    r.encerradaEm = data || C.hojeISO();
    commit();
  }
  function excluirRecorrencia(id) {
    estado.recorrencias = estado.recorrencias.filter(function (r) { return r.id !== id; });
    commit();
  }
  function restaurarExcecao(regraId, data) {
    var r = porId(estado.recorrencias, regraId);
    if (!r) return;
    r.excecoes = r.excecoes.filter(function (e) { return e.data !== data; });
    commit();
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
  /* `numero` é o número GLOBAL da cadeira. Guardar a clínica derivada dele
     evita a colisão antiga, em que a cadeira 7 da Clínica 1 e a 7 da
     Clínica 2 gravavam a mesma chave numa ocupação conjunta. */
  function ocuparCadeira(o, numero, alunoId) {
    if (atribuicaoDaCadeira(o.chave, numero)) return false;
    var c = clinicaDaCadeira(numero);
    var registro = {
      id: C.uid('at'), chave: o.chave, clinicaId: c ? c.id : null, cadeira: numero,
      alunoId: alunoId, data: o.data,
      registradoPor: sessaoId, registradoEm: C.carimbo()
    };
    estado.atribuicoes.push(registro);
    if (!salvar()) {
      /* Não persistiu: desfaz para o que está na tela não mentir. */
      estado.atribuicoes.pop();
      return false;
    }
    emitir();
    return true;
  }
  function liberarCadeira(chave, numero) {
    estado.atribuicoes = estado.atribuicoes.filter(function (a) {
      return !(a.chave === chave && a.cadeira === numero);
    });
    commit();
  }

  /* ── Mutações: manutenção ─────────────────────────────────────────── */
  function proximoProtocolo() {
    var ano = String(new Date().getFullYear()).slice(2);
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
    var afetadas = ocorrenciasIntervalo(hoje, fim, clinicaId).filter(function (o) {
      var disponiveis = cadeirasOperantesEscopo(o.agrupamentoId, o.escopo) - (jaInterditada ? 0 : 1);
      return o.cadeiras > disponiveis;
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
    var impacto = calcularImpacto(dados.clinicaId, dados.cadeira);
    var m = {
      id: C.uid('m'), protocolo: proximoProtocolo(),
      clinicaId: dados.clinicaId, cadeira: dados.cadeira,
      categoria: dados.categoria, criticidade: dados.criticidade || cat.criticidade,
      motivo: dados.motivo,
      abertoPor: sessaoId, abertoEm: C.carimbo(),
      previsaoRetorno: dados.previsaoRetorno || C.addDays(C.hojeISO(), cat.prazoDias),
      status: 'aberta',
      fechadoPor: null, fechadoEm: null, laudo: null,
      impacto: impacto
    };
    estado.manutencoes.push(m);
    commit();
    return m;
  }

  function encerrarManutencao(id, laudo) {
    var m = porId(estado.manutencoes, id);
    if (!m) return;
    m.status = 'encerrada';
    m.fechadoPor = sessaoId;
    m.fechadoEm = C.carimbo();
    m.laudo = laudo;
    commit();
  }

  /* O número global já determina a clínica, então filtrar por ela seria
     redundante — e perderia registros gravados antes com a clínica errada. */
  function historicoCadeira(numero) {
    return estado.manutencoes.filter(function (m) {
      return m.cadeira === numero;
    }).sort(function (a, b) { return b.abertoEm.localeCompare(a.abertoEm); });
  }

  /* ── Mutações: disciplinas, turmas, alunos ────────────────────────── */
  function salvarDisciplina(id, dados) {
    var d = id ? disciplina(id) : null;
    if (!d) { d = { id: C.uid('d') }; estado.disciplinas.push(d); }
    ['codigo', 'nome', 'especialidade', 'cargaHoraria'].forEach(function (k) {
      if (dados[k] !== undefined) d[k] = dados[k];
    });
    commit(); return d;
  }
  function salvarTurma(id, dados) {
    var t = id ? turma(id) : null;
    if (!t) { t = { id: C.uid('t'), alunos: [], periodoLetivo: estado.periodoLetivo }; estado.turmas.push(t); }
    ['disciplinaId', 'codigo', 'professorCoordenadorId'].forEach(function (k) {
      if (dados[k] !== undefined) t[k] = dados[k];
    });
    commit(); return t;
  }
  function excluirTurma(id) {
    estado.turmas = estado.turmas.filter(function (t) { return t.id !== id; });
    estado.recorrencias = estado.recorrencias.filter(function (r) { return r.turmaId !== id; });
    commit();
  }
  function vincularAluno(turmaId, dados) {
    var t = turma(turmaId); if (!t) return null;
    var a = null;
    estado.alunos.forEach(function (x) { if (x.matricula === dados.matricula) a = x; });
    if (!a) {
      a = { id: C.uid('a'), nome: dados.nome, matricula: dados.matricula, periodo: dados.periodo };
      estado.alunos.push(a);
    }
    if (t.alunos.indexOf(a.id) === -1) t.alunos.push(a.id);
    commit(); return a;
  }
  function desvincularAluno(turmaId, alunoId) {
    var t = turma(turmaId); if (!t) return;
    t.alunos = t.alunos.filter(function (x) { return x !== alunoId; });
    commit();
  }

  /* ── Mutações: clínicas e parâmetros ───────────────────────────────
     Aqui existiam salvarUsuario, alternarAtivo, podeRemoverUsuario,
     coordenadoresAtivos e removerUsuario. Foram removidas de propósito.

     Elas gravavam pessoas no localStorage, que é isolado por navegador, e
     nem assim liberavam ninguém: o portão de login é Autorizados.buscar()
     logo acima, e esses registros não participam da decisão. Deixá-las
     exportadas seria um convite para alguém religá-las na tela e recriar
     a mesma ilusão de que a coordenação pode conceder acesso pelo app.

     Conceder e revogar acesso é alterar app/js/autorizados.js e publicar.
     Quando existir servidor, isto volta — validando o token no back-end. */
  function atualizarClinica(id, dados) {
    var c = clinica(id); if (!c) return;
    /* 'cadeiras' fica de fora de propósito: 14 por clínica é invariante do
       modelo, e mexer nisso quebraria a numeração global de 1 a 112. */
    ['nome', 'abertura', 'fechamento'].forEach(function (k) {
      if (dados[k] !== undefined) c[k] = dados[k];
    });
    /* Rede de segurança para estado herdado: chamado aberto fora da faixa. */
    var faixa = faixaCadeiras(id);
    estado.manutencoes.forEach(function (m) {
      if (m.clinicaId === id && (m.cadeira < faixa[0] || m.cadeira > faixa[1]) && m.status === 'aberta') {
        m.status = 'encerrada'; m.fechadoEm = C.carimbo(); m.fechadoPor = sessaoId;
        m.laudo = 'Encerrada automaticamente: a cadeira deixou de existir na estrutura.';
      }
    });
    commit();
  }
  function atualizarParametros(dados) {
    Object.keys(dados).forEach(function (k) { estado.parametros[k] = dados[k]; });
    commit();
  }
  function atualizarSemestre(inicio, fim) {
    estado.semestre.inicio = inicio; estado.semestre.fim = fim; commit();
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

  function rotuloTipoAtividade(id) {
    var r = id;
    D.TIPOS_ATIVIDADE.forEach(function (t) { if (t.id === id) r = t.rotulo; });
    return id === 'aula' ? 'Aula de graduação' : r;
  }
  function rotuloCategoriaManutencao(id) {
    var r = id;
    D.CATEGORIAS_MANUTENCAO.forEach(function (c) { if (c.id === id) r = c.rotulo; });
    return r;
  }

  global.Store = {
    get estado() { return estado; },
    carregar: carregar, salvar: salvar, assinar: assinar, emitir: emitir,
    iniciarSessao: iniciarSessao, entrarComGoogle: entrarComGoogle,
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
    turmasDoProfessor: turmasDoProfessor,
    manutencoesAbertas: manutencoesAbertas, cadeiraEmManutencao: cadeiraEmManutencao,
    cadeirasOperantes: cadeirasOperantes, historicoCadeira: historicoCadeira,
    ocorrenciasDoDia: ocorrenciasDoDia, ocorrenciasIntervalo: ocorrenciasIntervalo,
    datasDaRegra: datasDaRegra, statusOcorrencia: statusOcorrencia,
    conflitos: conflitos, excedeCapacidade: excedeCapacidade,
    criarRecorrencia: criarRecorrencia, criarPontual: criarPontual,
    atualizarRecorrencia: atualizarRecorrencia, atualizarPontual: atualizarPontual,
    cancelarOcorrencia: cancelarOcorrencia, encerrarRecorrencia: encerrarRecorrencia,
    excluirRecorrencia: excluirRecorrencia, restaurarExcecao: restaurarExcecao,
    atribuicoesDa: atribuicoesDa, atribuicaoDaCadeira: atribuicaoDaCadeira,
    ocuparCadeira: ocuparCadeira, liberarCadeira: liberarCadeira,
    abrirManutencao: abrirManutencao, encerrarManutencao: encerrarManutencao,
    calcularImpacto: calcularImpacto,
    salvarDisciplina: salvarDisciplina, salvarTurma: salvarTurma, excluirTurma: excluirTurma,
    vincularAluno: vincularAluno, desvincularAluno: desvincularAluno,
    atualizarClinica: atualizarClinica, atualizarParametros: atualizarParametros,
    atualizarSemestre: atualizarSemestre,
    horasSemana: horasSemana, horasPorClinica: horasPorClinica,
    horasPorAgrupamento: horasPorAgrupamento, horasPorTurma: horasPorTurma,
    fimDaSemana: fimDaSemana,
    emAndamento: emAndamento, cadeirasEmUsoAgora: cadeirasEmUsoAgora, totalCadeiras: totalCadeiras,
    rotuloTipoAtividade: rotuloTipoAtividade, rotuloCategoriaManutencao: rotuloCategoriaManutencao
  };
})(window);
