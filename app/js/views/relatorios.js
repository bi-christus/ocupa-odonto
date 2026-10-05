/* views/relatorios.js — consolidados da semana e exportação em CSV.

   A semana letiva vai de segunda a sábado; quem decide o último dia é
   S.fimDaSemana, para que esta tela e o painel nunca discordem sobre a
   mesma semana.

   Uma ocupação não pertence mais a uma clínica: ela tem agrupamento +
   escopo ('a', 'b' ou 'ambas'). Toda coluna que antes trazia a clínica
   passa a trazer o agrupamento e o escopo. Manutenção continua sendo de
   uma cadeira só — logo de uma clínica só — e o número da cadeira é
   único dentro da clínica — contínuo de 1 a 112 nas de atendimento, do 1 em
   cada pré-clínica —, então ele anda sempre junto do nome dela. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, A = global.Acesso;

  /* Dias da semana letiva: segunda a sábado, seis colunas. */
  function diasDaSemana(seg) {
    var saida = [], d = seg, fim = S.fimDaSemana(seg);
    while (d <= fim) { saida.push(d); d = C.addDays(d, 1); }
    return saida;
  }

  function capacidadeSemanal() {
    var p = S.estado.parametros || {};
    return p.capacidadeSemanalH || 60;
  }

  /* Janela de funcionamento em texto curto: "07h–22h". */
  function janelaTexto() {
    var p = S.estado.parametros || {};
    var ab = String(p.aberturaPadrao || '07:00').slice(0, 2);
    var fe = String(p.fechamentoPadrao || '22:00').slice(0, 2);
    return ab + 'h–' + fe + 'h';
  }

  /* ── Permissão de exportação ──────────────────────────────────────────
     O plano prevê quebrar 'relatorios.ver' em 'relatorios.ver' +
     'relatorios.pessoas', e reservar o consolidado do polo a quem
     coordena. Nenhuma das duas existe ainda na matriz de acesso, e este
     arquivo não pode alterá-la: por isso a resolução abaixo pergunta ao
     Store primeiro e só cai no perfil enquanto a matriz não as tiver.
     Assim que as permissões forem criadas, o fallback deixa de ser
     alcançado sozinho. */
  function podeExportar(perm) {
    if (!perm) return true;
    if (S.pode(perm)) return true;
    if (perm === 'relatorios.pessoas' || perm === 'relatorios.consolidado') {
      var u = S.usuario();
      return !!u && u.ativo !== false && u.perfil === 'coordenador';
    }
    return false;
  }

  /* Guarda repetida na entrada de cada exportação. As funções não estão em
     window, então isto é defesa em profundidade — e não fechamento de uma
     superfície aberta. */
  function barrado(perm) {
    if (podeExportar(perm)) return false;
    C.toast('Seu perfil não tem permissão para exportar este relatório.');
    return true;
  }

  function render(alvo) {
    if (!S.pode('relatorios.ver')) { alvo.appendChild(U.semPermissao()); return; }
    var seg = C.startOfWeek(C.hojeISO());
    var fim = S.fimDaSemana(seg);
    var e = S.estado;

    alvo.appendChild(C.el('div', { class: 'page-head' }, C.el('div', {}, [
      C.el('h1', { text: 'Relatórios' }),
      C.el('div', { class: 'muted', style: 'font-size:13.5px;margin-top:6px',
        text: 'semestre ' + e.periodoLetivo + ' · semana de ' + C.fmtDia(seg) + ' a ' + C.fmtDia(fim) })
    ])));

    /* Quarto elemento: a permissão exigida. O pop() antigo só removia o
       último cartão — o técnico de manutenção continuava baixando o
       cadastro nominal de todo o corpo discente. (O cadastro de alunos saiu
       com a turma em 05/10/2026; o cartão dele virou o de disciplinas.)
       Quinto, quando existe: a versão impressa. CSV é o formato de quem vai
       recalcular; PDF é o de quem vai pendurar na parede da clínica ou levar
       para a reunião — e por isso ele sai desenhado como a aba Agenda, não
       como uma planilha. Onde não há forma visual a defender, só CSV. */
    var fichas = [
      ['Semanal · ocupação e manutenção',
        C.plural(e.clinicas.length, 'clínica') + ' · ' + C.plural(diasDaSemana(seg).length, 'dia'),
        function () { csvSemanal(seg); }, 'relatorios.consolidado'],
      ['Ocupação por clínica', C.plural(e.clinicas.length, 'linha'),
        function () { csvClinicas(seg); }, 'relatorios.consolidado'],
      ['Agenda da semana', C.plural(S.ocorrenciasIntervalo(seg, fim).length, 'registro'),
        function () { csvSemana(seg); }, 'relatorios.ver',
        function () { pdfSemana(seg); }],
      ['Recorrências do semestre', C.plural(S.recorrenciasAtivas().length, 'regra'),
        csvRecorrencias, 'relatorios.ver', pdfRecorrencias],
      ['Disciplinas e professores', C.plural(e.disciplinas.length, 'disciplina'),
        csvDisciplinas, 'relatorios.ver'],
      ['Manutenção', C.plural(e.manutencoes.length, 'registro'),
        csvManutencao, 'relatorios.ver'],
      ['Controle de acessos', C.plural(e.usuarios.length, 'pessoa'),
        csvAcessos, 'acessos.ver']
    ].filter(function (f) { return podeExportar(f[3]); });

    if (fichas.length) {
      alvo.appendChild(C.el('section', {
        style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:14px'
      }, fichas.map(function (f) {
        return C.el('div', { class: 'card' }, [
          C.el('h5', { text: f[0] }),
          C.el('div', { class: 'muted', style: 'font-size:12.5px;margin:8px 0 16px', text: f[1] }),
          C.el('div', { class: 'row', style: 'gap:8px' }, [
            C.el('button', { class: 'btn btn-primary btn-sm', text: 'Exportar CSV', onclick: f[2] }),
            f[4] ? C.el('button', {
              class: 'btn btn-outline btn-sm', text: 'PDF',
              title: 'Abre a impressão do navegador — escolha "Salvar como PDF" para gerar o arquivo',
              onclick: f[4]
            }) : null
          ])
        ]);
      })));
    } else {
      alvo.appendChild(U.vazio('Seu perfil consulta os consolidados, mas não exporta nenhum deles.'));
    }

    alvo.appendChild(C.el('section', { style: 'margin-top:44px' }, semanal(seg)));
    alvo.appendChild(C.el('section', { style: 'margin-top:44px' }, horasPorDisciplina(seg)));
    alvo.appendChild(C.el('section', { style: 'margin-top:44px' }, resumoManutencao()));
  }

  /* ── Matriz clínica × dia ─────────────────────────────────────────────
     Uma ocupação de escopo duplo conta as horas nas DUAS clínicas: o
     filtro por clínica do Store já devolve a ocorrência para cada uma
     delas, porque o teste é de cobertura e não de igualdade.
     Desde 05/10/2026 a clínica pode ter várias reservas ao mesmo tempo, e
     as duas medidas se separam: HORAS de uso (a união dos horários, para a
     mesma hora não contar duas vezes) e OCUPAÇÃO, em cadeira·hora sobre a
     capacidade — uma turma de 7 numa clínica de 14 a manhã inteira usa a
     manhã toda, mas ocupa metade. */
  function matrizSemanal(seg) {
    var dias = diasDaSemana(seg), CAP = capacidadeSemanal();
    var ch = {};
    S.cadeirasHoraPorClinica(seg).forEach(function (x) { ch[x.clinica.id] = x.cadeirasHora; });
    return S.estado.clinicas.map(function (c) {
      var porDia = dias.map(function (d) { return S.horasDeUso(S.ocorrenciasDoDia(d, c.id)); });
      var total = porDia.reduce(function (a, b) { return a + b; }, 0);
      var capCh = CAP * c.cadeiras;
      return {
        clinica: c, dias: porDia, total: total, cadeirasHora: ch[c.id] || 0,
        ocupacao: capCh ? (ch[c.id] || 0) / capCh : 0,
        interditadas: numerosInterditados(c.id)
      };
    });
  }

  /* Números GLOBAIS das cadeiras interditadas de uma clínica, sem repetir
     a cadeira que tiver mais de um chamado aberto. */
  function numerosInterditados(clinicaId) {
    var f = S.faixaCadeiras(clinicaId), vistas = {}, saida = [];
    S.manutencoesAbertas(clinicaId).forEach(function (m) {
      if (m.cadeira < f[0] || m.cadeira > f[1]) return;
      if (vistas[m.cadeira]) return;
      vistas[m.cadeira] = true; saida.push(m.cadeira);
    });
    return saida.sort(function (a, b) { return a - b; });
  }

  function textoInterditadas(nums) {
    return nums.map(function (n) { return C.pad(n); }).join(', ');
  }

  /* Cadeira·hora do polo sobre a capacidade somada de todas as cadeiras. */
  function ocupacaoDoPolo(matriz, CAP) {
    var ch = 0, cap = 0;
    matriz.forEach(function (m) { ch += m.cadeirasHora; cap += CAP * m.clinica.cadeiras; });
    return cap ? ch / cap : 0;
  }

  function semanal(seg) {
    var e = S.estado, CAP = capacidadeSemanal();
    var dias = diasDaSemana(seg), matriz = matrizSemanal(seg);

    /* '.right' já zera o padding da última coluna no CSS da tabela; só o
       peso e a cor ficam inline. */
    var totTd = 'font-weight:600';

    var cabecalho = [C.el('th', { text: 'Clínica' })];
    dias.forEach(function (d) {
      cabecalho.push(C.el('th', { class: 'right', text: C.nomeDia(C.weekday(d)) }));
    });
    ['Total', 'Ocup.', 'Manut.'].forEach(function (r) {
      cabecalho.push(C.el('th', { class: 'right', text: r }));
    });

    var corpo = C.el('tbody');
    matriz.forEach(function (m) {
      var celulas = [C.el('td', {}, [
        C.el('span', { text: m.clinica.nome }),
        C.el('span', { class: 'muted', style: 'display:block;font-size:11.5px', text: m.clinica.especialidade })
      ])];
      m.dias.forEach(function (h) {
        celulas.push(C.el('td', {
          class: 'num right' + (h ? '' : ' muted'),
          text: h ? String(Math.round(h)) : '—'
        }));
      });
      celulas.push(C.el('td', { class: 'num right', style: totTd, text: Math.round(m.total) + ' h' }));
      /* 'Ocup.' é cadeira·hora sobre a capacidade da clínica, não horas. */
      celulas.push(C.el('td', {
        class: 'num right', style: 'color:var(--accent-ink)',
        text: Math.round(m.ocupacao * 100) + '%'
      }));
      celulas.push(C.el('td', {
        class: 'num right' + (m.interditadas.length ? '' : ' muted'),
        text: m.interditadas.length ? textoInterditadas(m.interditadas) : '—'
      }));
      corpo.appendChild(C.el('tr', {}, celulas));
    });

    var totaisDia = dias.map(function (_, i) {
      return matriz.reduce(function (s, m) { return s + m.dias[i]; }, 0);
    });
    var totalGeral = totaisDia.reduce(function (a, b) { return a + b; }, 0);
    var interditadasPolo = matriz.reduce(function (s, m) { return s + m.interditadas.length; }, 0);
    var ocupacaoPolo = ocupacaoDoPolo(matriz, CAP);

    var linhaPolo = [C.el('td', { style: totTd, text: 'Polo' })];
    totaisDia.forEach(function (h) {
      linhaPolo.push(C.el('td', { class: 'num right', style: totTd, text: String(Math.round(h)) }));
    });
    linhaPolo.push(C.el('td', { class: 'num right', style: totTd, text: Math.round(totalGeral) + ' h' }));
    linhaPolo.push(C.el('td', { class: 'num right', style: totTd,
      text: Math.round(ocupacaoPolo * 100) + '%' }));
    linhaPolo.push(C.el('td', { class: 'num right', style: totTd,
      text: C.plural(interditadasPolo, 'cadeira') }));
    corpo.appendChild(C.el('tr', {}, linhaPolo));

    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, cabecalho)), corpo
    ]);

    var rodape = C.el('div', { class: 'row', style: 'gap:14px;margin-top:14px;flex-wrap:wrap' }, [
      podeExportar('relatorios.consolidado')
        ? C.el('button', {
          class: 'btn btn-primary btn-sm', text: 'Exportar CSV semanal',
          onclick: function () { csvSemanal(seg); }
        })
        : null,
      C.el('span', { class: 'muted', style: 'font-size:12px',
        text: 'Horas de uso por dia · ocupação em cadeira·hora sobre ' + CAP + ' h por cadeira na semana (' +
          janelaTexto() + ', seg a sáb)' })
    ]);

    return C.el('div', {}, [
      C.el('div', {
        class: 'row',
        style: 'align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:14px;flex-wrap:wrap'
      }, [
        C.el('h5', { text: 'Semanal · ocupação e manutenção', style: 'margin:0' }),
        C.el('span', { class: 'muted', style: 'font-size:12.5px',
          text: C.fmtDia(seg) + ' a ' + C.fmtDia(S.fimDaSemana(seg)) + ' · semestre ' + e.periodoLetivo })
      ]),
      C.el('div', { class: 'rolagem-x' }, tabela),
      rodape
    ]);
  }

  /* ── Horas por disciplina ─────────────────────────────────────────── */
  function horasPorDisciplina(seg) {
    var dados = S.horasPorDisciplina(seg).filter(function (d) { return d.horas > 0; });
    /* Escala absoluta: a capacidade semanal de uma clínica. Normalizar pelo
       maior valor da série fazia a disciplina mais ocupada parecer sempre
       lotada, qualquer que fosse a carga real. */
    var CAP = capacidadeSemanal();

    var tabela = C.el('table', { class: 'table' }, [
      C.el('thead', {}, C.el('tr', {}, [
        C.el('th', { text: 'Disciplina' }), C.el('th', { text: 'Professores' }),
        C.el('th', { text: 'Horas' }), C.el('th', { text: '' })
      ]))
    ]);
    var corpo = C.el('tbody');
    dados.forEach(function (x) {
      var d = x.disciplina;
      corpo.appendChild(C.el('tr', {}, [
        C.el('td', { text: S.rotuloDisciplinaLongo(d) }),
        C.el('td', { text: S.professoresDaDisciplina(d).map(S.nomePessoa).join(', ') || '—' }),
        C.el('td', { class: 'num', style: 'width:78px', text: C.fmtHoras(x.horas) }),
        C.el('td', { style: 'width:190px' }, U.barra(x.horas, CAP))
      ]));
    });
    tabela.appendChild(corpo);

    return C.el('div', {}, [
      C.el('h5', { text: 'Horas por disciplina na semana', style: 'margin-bottom:6px' }),
      C.el('div', { class: 'muted', style: 'font-size:12.5px;margin-bottom:16px',
        text: 'barra proporcional à capacidade de ' + CAP + ' h por clínica na semana' }),
      dados.length ? C.el('div', { class: 'rolagem-x' }, tabela)
        : U.vazio('Nenhuma ocupação nesta semana.')
    ]);
  }

  /* ── Resumo de manutenção ─────────────────────────────────────────── */
  function resumoManutencao() {
    var e = S.estado;
    var porCategoria = {};
    e.manutencoes.forEach(function (m) {
      porCategoria[m.categoria] = (porCategoria[m.categoria] || 0) + 1;
    });
    var chaves = Object.keys(porCategoria).sort(function (a, b) { return porCategoria[b] - porCategoria[a]; });
    /* Escala absoluta outra vez: a barra é a fatia do total de registros,
       não a comparação com o motivo mais frequente. */
    var total = e.manutencoes.length || 1;

    return C.el('div', {}, [
      C.el('h5', { text: 'Manutenção por motivo', style: 'margin-bottom:6px' }),
      C.el('div', { class: 'muted', style: 'font-size:12.5px;margin-bottom:16px',
        text: C.plural(e.manutencoes.length, 'registro') + ' no semestre · ' +
          S.manutencoesAbertas().length + ' em aberto' }),
      chaves.length ? C.el('div', { class: 'stack', style: 'gap:12px;max-width:640px' }, chaves.map(function (k) {
        return C.el('div', { class: 'row', style: 'gap:14px' }, [
          C.el('span', { style: 'width:210px;flex:none;font-size:13px', text: S.rotuloCategoriaManutencao(k) }),
          U.barra(porCategoria[k], total),
          C.el('span', { class: 'num muted', style: 'width:28px;text-align:right;font-size:12.5px',
            text: String(porCategoria[k]) })
        ]);
      })) : U.vazio('Nenhum registro de manutenção.')
    ]);
  }

  /* ── Exportações ──────────────────────────────────────────────────── */
  function decimal(n) { return String(Math.round(n * 10) / 10).replace('.', ','); }

  /* Instante de um carimbo 'YYYY-MM-DD HH:MM', em milissegundos. */
  function instante(stamp) {
    if (!stamp) return null;
    var p = String(stamp).split(' ');
    var hm = (p[1] || '00:00').split(':');
    var d = C.parseISO(p[0]);
    d.setHours(Number(hm[0]), Number(hm[1]), 0, 0);
    return d.getTime();
  }

  /* Quanto tempo a cadeira ficou fora de operação: até o encerramento, ou
     até agora enquanto o chamado seguir aberto. */
  function tempoInterdicao(m) {
    var ini = instante(m.abertoEm);
    if (!ini) return '';
    var fim = m.status === 'aberta' ? Date.now() : instante(m.fechadoEm);
    if (!fim) return '';
    var horas = Math.max(0, Math.round((fim - ini) / 3600000));
    if (horas < 24) return C.plural(horas, 'hora');
    return C.plural(Math.round(horas / 24), 'dia');
  }

  /* Matriz clínica × dia, com os números globais das cadeiras interditadas
     e uma linha final com os totais do polo. */
  function csvSemanal(seg) {
    if (barrado('relatorios.consolidado')) return;
    var CAP = capacidadeSemanal(), dias = diasDaSemana(seg), matriz = matrizSemanal(seg);

    var cab = ['Agrupamento', 'Clínica', 'Especialidade', 'Faixa de cadeiras'];
    dias.forEach(function (d) { cab.push(C.nomeDia(C.weekday(d)) + ' ' + C.fmtDia(d)); });
    cab = cab.concat(['Horas de uso', 'Cadeiras·hora', 'Ocupação %', 'Cadeiras em manutenção', 'Números em manutenção']);

    var linhas = [cab];
    matriz.forEach(function (m) {
      var c = m.clinica;
      var linha = [S.nomeAgrupamento(c.agrupamentoId), c.nome, c.especialidade,
        S.faixaCadeiras(c.id).join('–')];
      m.dias.forEach(function (h) { linha.push(decimal(h)); });
      linha.push(decimal(m.total));
      linha.push(decimal(m.cadeirasHora));
      linha.push(Math.round(m.ocupacao * 100) + '%');
      linha.push(m.interditadas.length);
      linha.push(textoInterditadas(m.interditadas));
      linhas.push(linha);
    });

    var totaisDia = dias.map(function (_, i) {
      return matriz.reduce(function (s, m) { return s + m.dias[i]; }, 0);
    });
    var totalGeral = totaisDia.reduce(function (a, b) { return a + b; }, 0);
    /* Sem faixa na linha do polo: a numeração não é mais contínua de ponta a
       ponta — cada pré-clínica recomeça no 1. A faixa vive na linha da clínica. */
    var totais = ['Polo', '', '', ''];
    totaisDia.forEach(function (h) { totais.push(decimal(h)); });
    totais.push(decimal(totalGeral));
    totais.push(decimal(matriz.reduce(function (s, m) { return s + m.cadeirasHora; }, 0)));
    totais.push(Math.round(ocupacaoDoPolo(matriz, CAP) * 100) + '%');
    totais.push(matriz.reduce(function (s, m) { return s + m.interditadas.length; }, 0));
    totais.push('');
    linhas.push(totais);

    C.baixarCSV('semanal-ocupacao-e-manutencao.csv', linhas);
    C.toast('Relatório exportado.');
  }

  function csvClinicas(seg) {
    if (barrado('relatorios.consolidado')) return;
    var fim = S.fimDaSemana(seg);
    var CAP = capacidadeSemanal();
    var linhas = [['Agrupamento', 'Clínica', 'Especialidade', 'Faixa de cadeiras', 'Cadeiras',
      'Operantes', 'Em manutenção', 'Números em manutenção', 'Horas de uso na semana',
      'Cadeiras·hora reservadas', 'Ocupação das cadeiras %', 'Ocupações na semana']];
    var somaHoras = 0, somaOcup = 0, somaCadeiras = 0, somaOperantes = 0, somaManut = 0, somaCh = 0;
    var ch = {};
    S.cadeirasHoraPorClinica(seg).forEach(function (x) { ch[x.clinica.id] = x.cadeirasHora; });

    S.horasPorClinica(seg).forEach(function (d) {
      var c = d.clinica;
      var nums = numerosInterditados(c.id);
      var ocupacoes = S.ocorrenciasIntervalo(seg, fim, c.id).length;
      var cadh = ch[c.id] || 0;
      somaHoras += d.horas; somaOcup += ocupacoes; somaCh += cadh;
      somaCadeiras += c.cadeiras; somaOperantes += S.cadeirasOperantes(c.id); somaManut += nums.length;
      linhas.push([
        S.nomeAgrupamento(c.agrupamentoId), c.nome, c.especialidade,
        S.faixaCadeiras(c.id).join('–'), c.cadeiras, S.cadeirasOperantes(c.id),
        nums.length, textoInterditadas(nums), decimal(d.horas),
        decimal(cadh), Math.round(c.cadeiras ? cadh / (CAP * c.cadeiras) * 100 : 0) + '%', ocupacoes
      ]);
    });
    /* A soma de ocupações do polo conta a ocupação conjunta duas vezes —
       uma por clínica — porque a linha da clínica também conta. */
    linhas.push(['Polo', '', '', '',
      somaCadeiras, somaOperantes, somaManut, '', decimal(somaHoras), decimal(somaCh),
      Math.round(somaCadeiras ? somaCh / (CAP * somaCadeiras) * 100 : 0) + '%', somaOcup]);

    C.baixarCSV('ocupacao-por-clinica.csv', linhas);
    C.toast('Relatório exportado.');
  }

  function csvSemana(seg) {
    if (barrado('relatorios.ver')) return;
    /* "Cadeiras" é a quantidade que a reserva segura — desde 05/10/2026 é
       ela que mede ocupação, porque a alocação já marca as cadeiras em uso —
       e "Números" diz quais. Na reserva anterior à quantidade, a clínica
       inteira. A turma vem dentro da descrição, que é onde ela é escrita. */
    var linhas = [['Data', 'Dia', 'Agrupamento', 'Escopo', 'Ambiente', 'Início', 'Fim', 'Horas', 'Tipo',
      'Nível', 'Título', 'Disciplina', 'Descrição/Turma', 'Professor coordenador', 'Cadeiras', 'Números das cadeiras']];
    var ambientes = { clinica: 'Clínica', dupla: 'Duas clínicas', pre: 'Pré-clínica' };
    S.ocorrenciasIntervalo(seg, S.fimDaSemana(seg)).forEach(function (o) {
      var d = S.disciplina(o.disciplinaId);
      linhas.push([
        C.fmtDiaAno(o.data), C.nomeDia(C.weekday(o.data), true),
        S.nomeAgrupamento(o.agrupamentoId), S.rotuloEscopo(o.agrupamentoId, o.escopo),
        ambientes[o.ambiente] || '',
        o.inicio, o.fim, decimal(C.duracaoH(o.inicio, o.fim)),
        o.origem === 'recorrente' ? 'Recorrente' : 'Pontual',
        S.rotuloTipoAtividade(o.nivel),
        o.titulo, d ? S.rotuloDisciplinaLongo(d) : '', o.descricao,
        S.nomePessoa(o.responsavelId), o.cadeiras,
        o.integral ? 'clínica inteira' : S.textoCadeiras(o.cadeirasLista)
      ]);
    });
    C.baixarCSV('agenda-da-semana.csv', linhas);
    C.toast('Relatório exportado.');
  }

  /* As duas versões impressas passam pela mesma barreira de permissão do
     CSV correspondente: mudar de formato não muda quem pode ver. */
  function pdfSemana(seg) {
    if (barrado('relatorios.ver')) return;
    global.Impressao.semana(seg);
  }
  function pdfRecorrencias() {
    if (barrado('relatorios.ver')) return;
    global.Impressao.recorrencias();
  }

  /* `encerradaEm` é o PRIMEIRO dia inválido, e pode ser posterior à
     vigência declarada. Usar a data crua imprimia um dia a mais na coluna
     "Vigência fim" e esticava a contagem de encontros — a agenda e a tela
     de disciplinas já contam pelo dia efetivo. */
  function fimEfetivoDaRegra(r) {
    var ultimo = r.encerradaEm ? C.addDays(r.encerradaEm, -1) : null;
    return ultimo && ultimo < r.vigenciaFim ? ultimo : r.vigenciaFim;
  }

  function csvRecorrencias() {
    if (barrado('relatorios.ver')) return;
    var linhas = [['Código', 'Disciplina', 'Nível', 'Descrição/Turma', 'Professor coordenador', 'Agrupamento',
      'Escopo', 'Dias', 'Início', 'Fim', 'Cadeiras', 'Números das cadeiras', 'Vigência início',
      'Vigência fim', 'Encontros', 'Exceções']];
    S.recorrenciasAtivas().forEach(function (r) {
      var d = S.disciplinaDe(r);
      var fim = fimEfetivoDaRegra(r);
      /* Só conta a exceção que cai dentro da vigência efetiva: subtrair o
         total de exceções da contagem podia devolver negativo em regra
         encerrada antes do primeiro encontro. */
      var datas = (fim && fim >= r.vigenciaInicio)
        ? S.datasDaRegra(r.dias, r.vigenciaInicio, fim).filter(function (dia) {
          for (var i = 0; i < r.excecoes.length; i++) if (r.excecoes[i].data === dia) return false;
          return true;
        })
        : [];
      /* Pela guarda de `d`: disciplina apagada por fora não pode derrubar a
         exportação inteira. */
      linhas.push([
        d ? (d.codigo || '') : '', d ? d.nome : 'Sem disciplina', S.rotuloTipoAtividade(S.nivelDe(r)),
        S.descricaoDe(r), S.nomePessoa(S.responsavelDe(r)),
        S.nomeAgrupamento(r.agrupamentoId), S.rotuloEscopo(r.agrupamentoId, r.escopo),
        C.listaDias(r.dias), r.inicio, r.fim,
        S.quantidadeDe(r), S.ehIntegral(r) ? 'clínica inteira' : S.textoCadeiras(S.cadeirasDe(r)),
        C.fmtDiaAno(r.vigenciaInicio), C.fmtDiaAno(fim),
        datas.length,
        r.excecoes.length
      ]);
    });
    C.baixarCSV('recorrencias-do-semestre.csv', linhas);
    C.toast('Relatório exportado.');
  }

  /* Substituiu "Disciplinas e alunos" em 05/10/2026: o vínculo de alunos
     saiu com a turma. Uma linha por disciplina, com quem responde por ela e
     o quanto ela ocupa no semestre. */
  function csvDisciplinas() {
    if (barrado('relatorios.ver')) return;
    var s = S.estado.semestre || {};
    var uso = {};
    if (C.dataValida(s.inicio) && C.dataValida(s.fim)) {
      S.ocorrenciasIntervalo(s.inicio, s.fim).forEach(function (o) {
        if (!o.disciplinaId) return;
        var u = uso[o.disciplinaId] || (uso[o.disciplinaId] = { encontros: 0, horas: 0 });
        u.encontros++;
        u.horas += C.duracaoH(o.inicio, o.fim);
      });
    }
    var linhas = [['Nível', 'Código', 'Nome', 'Professores', 'Recorrências', 'Pontuais',
      'Encontros no semestre', 'Horas no semestre']];
    S.disciplinasDeGraduacao().concat(S.especializacoes()).forEach(function (d) {
      var reservas = S.reservasDaDisciplina(d.id);
      var u = uso[d.id] || { encontros: 0, horas: 0 };
      linhas.push([
        S.ehEspecializacao(d) ? 'Pós-graduação' : 'Graduação', d.codigo || '', d.nome,
        S.professoresDaDisciplina(d).map(S.nomePessoa).join(', '),
        reservas.filter(function (o) { return o.tipo === 'recorrente'; }).length,
        reservas.filter(function (o) { return o.tipo === 'pontual'; }).length,
        u.encontros, decimal(u.horas)
      ]);
    });
    C.baixarCSV('disciplinas-e-professores.csv', linhas);
    C.toast('Relatório exportado.');
  }

  function csvManutencao() {
    if (barrado('relatorios.ver')) return;
    var linhas = [['Protocolo', 'Agrupamento', 'Clínica', 'Especialidade', 'Cadeira',
      'Posição na clínica', 'Local', 'Motivo', 'Criticidade', 'Descrição',
      'Aberto por', 'Abertura', 'Previsão de retorno', 'Situação', 'Encerrado por',
      'Encerramento', 'Tempo de interdição', 'Laudo', 'Ocupações afetadas',
      'Impacto apurado em']];
    S.estado.manutencoes.forEach(function (m) {
      /* A clínica gravada no chamado é quem manda: desde que as pré-clínicas
         numeram as cadeiras do 1, o número sozinho não determina mais a
         clínica. A faixa fica de reserva, para registro antigo sem clínica. */
      var c = S.clinica(m.clinicaId) || S.clinicaDaCadeira(m.cadeira);
      linhas.push([
        m.protocolo,
        c ? S.nomeAgrupamento(c.agrupamentoId) : '',
        c ? c.nome : '', c ? c.especialidade : '',
        C.pad(m.cadeira),
        c ? m.cadeira - c.primeiraCadeira + 1 : '',
        S.localCadeira(m.cadeira, c),
        S.rotuloCategoriaManutencao(m.categoria), m.criticidade, m.motivo,
        S.nomePessoa(m.abertoPor), C.fmtCarimbo(m.abertoEm),
        m.previsaoRetorno ? C.fmtDiaAno(m.previsaoRetorno) : '',
        m.status, m.fechadoPor ? S.nomePessoa(m.fechadoPor) : '',
        m.fechadoEm ? C.fmtCarimbo(m.fechadoEm) : '',
        tempoInterdicao(m), m.laudo || '',
        m.impacto ? m.impacto.ocorrenciasAfetadas : '',
        m.impacto && m.impacto.apuradoEm ? C.fmtCarimbo(m.impacto.apuradoEm) : ''
      ]);
    });
    C.baixarCSV('registros-de-manutencao.csv', linhas);
    C.toast('Relatório exportado.');
  }

  function csvAcessos() {
    if (barrado('acessos.ver')) return;
    var linhas = [['Nome', 'E-mail', 'Nível de acesso', 'Situação', 'Disciplinas', 'Último acesso', 'Permissões']];
    S.estado.usuarios.forEach(function (u) {
      linhas.push([u.nome, u.email, A.nomePerfil(u.perfil), u.ativo ? 'ativo' : 'suspenso',
        S.disciplinasDoProfessor(u.id).map(S.rotuloDisciplina).join(', '),
        u.ultimoAcesso ? C.fmtCarimbo(u.ultimoAcesso) : '',
        A.permissoesDe(u.perfil).length]);
    });
    C.baixarCSV('controle-de-acessos.csv', linhas);
    C.toast('Relatório exportado.');
  }

  global.ViewRelatorios = { render: render };
})(window);
