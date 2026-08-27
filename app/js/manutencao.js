/* manutencao.js — abertura e encerramento de registros de manutenção.
   O motivo é obrigatório porque o parâmetro "exigirMotivoManutencao" diz
   que é: quem manda na exigência é o parâmetro, não um número solto aqui —
   se ele for desligado, a tela passa a dizer "opcional" em vez de mentir.
   O restante do registro (protocolo, criticidade, previsão de retorno,
   impacto na agenda e histórico da cadeira) é apurado pelo sistema no
   momento da abertura e mostrado antes de confirmar.
   A cadeira é sempre o número global de 1 a 112; onde ela fica quem diz é
   S.localCadeira(), que devolve agrupamento · clínica · cadeira. */
(function (global) {
  'use strict';
  var C = global.Core, S = global.Store, U = global.UI, D = global.Dados, A = global.Acesso;

  /* Mínimo de caracteres usado quando o parâmetro é apenas um booleano.
     Se algum dia ele virar número, é o número que vale. */
  var MIN_MOTIVO_PADRAO = 10;
  var MIN_LAUDO = 10;

  function categoria(id) {
    var r = null;
    D.CATEGORIAS_MANUTENCAO.forEach(function (c) { if (c.id === id) r = c; });
    return r;
  }

  function parametros() {
    return (S.estado && S.estado.parametros) || {};
  }

  /* ── Motivo: a regra vem do parâmetro ─────────────────────────────── */
  function motivoExigido() {
    var v = parametros().exigirMotivoManutencao;
    return v !== false && v !== undefined && v !== null;
  }

  function minimoMotivo() {
    var v = parametros().exigirMotivoManutencao;
    if (!motivoExigido()) return 0;
    if (typeof v === 'number') return v > 0 ? Math.floor(v) : 1;
    return MIN_MOTIVO_PADRAO;
  }

  /* Valida de verdade antes de chamar o Store: vazio e só-espaços são
     recusados, e o texto devolvido já vai aparado. */
  function validarMotivo(texto) {
    var t = String(texto === null || texto === undefined ? '' : texto).trim();
    var min = minimoMotivo();
    if (!motivoExigido()) return { ok: true, texto: t };
    if (t.length === 0) {
      return { ok: false, texto: t, erro: 'Descreva o ocorrido — o motivo é obrigatório.' };
    }
    if (t.length < min) {
      return {
        ok: false, texto: t,
        erro: 'Descreva o ocorrido com pelo menos ' + C.plural(min, 'caractere', 'caracteres') + '.'
      };
    }
    return { ok: true, texto: t };
  }

  function dicaMotivoTexto() {
    return motivoExigido()
      ? 'Obrigatório — mínimo de ' + C.plural(minimoMotivo(), 'caractere', 'caracteres') + '.'
      : 'Opcional neste semestre.';
  }

  /* ── Tempo entre dois carimbos 'YYYY-MM-DD HH:MM' ─────────────────── */
  function instante(stamp) {
    var p = String(stamp || '').split(' ');
    if (!C.dataValida(p[0])) return null;
    var hm = (p[1] || '00:00').split(':');
    var d = C.parseISO(p[0]);
    d.setHours(Number(hm[0]) || 0, Number(hm[1]) || 0, 0, 0);
    return d.getTime();
  }

  function intervalo(inicio, fim) {
    var a = instante(inicio), b = instante(fim);
    if (a === null || b === null) return '—';
    var min = Math.max(0, Math.round((b - a) / 60000));
    if (min < 60) return C.plural(min, 'minuto', 'minutos');
    var h = Math.floor(min / 60);
    if (h < 24) return C.plural(h, 'hora', 'horas') + (min % 60 ? ' ' + (min % 60) + ' min' : '');
    var dias = Math.floor(h / 24);
    return C.plural(dias, 'dia', 'dias') + (h % 24 ? ' ' + C.plural(h % 24, 'hora', 'horas') : '');
  }

  function tempoInterdicao(registro) {
    if (registro.status === 'encerrada' && registro.fechadoEm) {
      return intervalo(registro.abertoEm, registro.fechadoEm);
    }
    return C.decorrido(registro.abertoEm) + ' e contando';
  }

  /* ── Abertura ─────────────────────────────────────────────────────── */
  /* "cadeira" é o número global. "clinicaId" continua na assinatura pelos
     chamadores, mas quem manda é a faixa: a clínica sai do próprio número. */
  function abrir(clinicaId, cadeira, aoConcluir) {
    if (!S.pode('manutencao.abrir')) { C.toast('Seu perfil não abre registros de manutenção.'); return; }
    var cl = S.clinicaDaCadeira(cadeira) || S.clinica(clinicaId);
    if (!cl) { C.toast('Cadeira ' + C.pad(cadeira) + ' não pertence a nenhuma clínica.'); return; }
    var clId = cl.id;

    var u = S.usuario();
    var form = {
      categoria: 'equipamento',
      motivo: '',
      previsaoRetorno: C.addDays(C.hojeISO(), categoria('equipamento').prazoDias)
    };

    var auto = C.el('div', { class: 'preview' });
    var avisos = C.el('div');
    var dicaMotivo = C.el('small', { class: 'muted', style: 'font-size:11.5px' });
    var btn = C.el('button', { class: 'btn btn-primary', text: 'Abrir manutenção', disabled: true, onclick: gravar });

    var campoMotivo = C.el('textarea', {
      class: 'input', rows: '3',
      placeholder: motivoExigido()
        ? 'Descreva o que está acontecendo com a cadeira. Obrigatório — este texto vira o registro do chamado.'
        : 'Descreva o que está acontecendo com a cadeira. Este texto vira o registro do chamado.',
      oninput: function (ev) { form.motivo = ev.target.value; atualizar(); }
    });

    var campoPrevisao = C.el('input', {
      class: 'input', type: 'date', value: form.previsaoRetorno, min: C.hojeISO(),
      oninput: function (ev) { form.previsaoRetorno = ev.target.value; atualizar(); }
    });

    var blocoMotivo = U.campo('Descrição do ocorrido', campoMotivo);
    blocoMotivo.appendChild(dicaMotivo);

    var conteudo = C.el('div', { class: 'stack' }, [
      C.el('div', { class: 'grid-fields' }, [
        U.campo('Motivo da manutenção', U.selecao(D.CATEGORIAS_MANUTENCAO.map(function (c) {
          return { valor: c.id, rotulo: c.rotulo };
        }), form.categoria, function (v) {
          form.categoria = v;
          form.previsaoRetorno = C.addDays(C.hojeISO(), categoria(v).prazoDias);
          campoPrevisao.value = form.previsaoRetorno;
          atualizar();
        })),
        U.campo('Previsão de retorno', campoPrevisao, 'sugerida pelo prazo do motivo')
      ]),
      blocoMotivo,
      C.el('div', {}, [
        C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:8px', text: 'Gerado pelo sistema' }),
        auto
      ]),
      avisos
    ]);

    var m = U.modal({
      titulo: 'Registrar manutenção',
      subtitulo: S.localCadeira(cadeira),
      largura: '720px',
      conteudo: conteudo,
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Cancelar', onclick: U.fecharModal }),
        btn
      ]
    });

    /* O impacto é caro de apurar (varre 14 dias de ocorrências) e não pode
       congelar: a chave abaixo refaz a conta quando a cadeira ou a categoria
       mudam, e só nesse caso — digitar o motivo não refaz nada. */
    var cacheImpacto = null, cacheChave = null;
    function impactoAtual() {
      var chave = clId + ':' + cadeira + ':' + form.categoria;
      if (cacheChave !== chave) {
        cacheImpacto = S.calcularImpacto(clId, cadeira);
        cacheChave = chave;
      }
      return cacheImpacto;
    }

    function atualizar() {
      var cat = categoria(form.categoria);
      var impacto = impactoAtual();
      var hist = S.historicoCadeira(cadeira);
      var reincidencia = hist.filter(function (h) { return h.categoria === form.categoria; });
      /* Busca pelo número global, sem estreitar por clínica: um registro
         antigo com a clínica errada não pode sumir do aviso. */
      var jaAberta = S.cadeiraEmManutencao(null, cadeira);
      var janela = impacto.janelaDias || 14;

      C.clear(auto);
      linha('Protocolo', proximoProtocoloPrevisto());
      linha('Local', S.localCadeira(cadeira));
      linha('Aberto por', u.nome + ' · ' + A.nomePerfil(u.perfil));
      linha('Abertura', C.fmtCarimbo(C.carimbo()));
      /* Prazo em dias corridos: C.addDays soma dias de calendário, então
         chamar de "dia útil" prometeria uma data que o sistema não grava. */
      linha('Criticidade', cat.criticidade + ' · prazo de referência ' +
        C.plural(cat.prazoDias, 'dia corrido', 'dias corridos'));
      linha('Capacidade de ' + cl.nome, S.cadeirasOperantes(clId) + ' → ' +
        C.plural(impacto.cadeirasOperantesDepois, 'cadeira operante', 'cadeiras operantes'));
      linha('Impacto na agenda', impacto.ocorrenciasAfetadas === 0
        ? 'nenhuma ocupação dos próximos ' + C.plural(janela, 'dia', 'dias') + ' fica sem cadeira'
        : C.plural(impacto.ocorrenciasAfetadas, 'ocupação', 'ocupações') + ' dos próximos ' +
          C.plural(janela, 'dia', 'dias') +
          (impacto.ocorrenciasAfetadas === 1 ? ' fica' : ' ficam') + ' sem cadeira suficiente — ' +
          impacto.turmasAfetadas.join(', '));
      linha('Histórico da cadeira', hist.length === 0
        ? 'primeira manutenção registrada'
        : C.plural(hist.length, 'registro', 'registros') + ' · última em ' + C.fmtCarimbo(hist[0].abertoEm));

      C.clear(avisos);
      if (jaAberta) {
        avisos.appendChild(C.el('div', { class: 'alert' }, [
          C.el('b', { text: 'Cadeira já interditada.' }),
          ' Existe o registro ' + jaAberta.protocolo + ' em aberto para esta cadeira, desde ' +
          C.fmtCarimbo(jaAberta.abertoEm) + '. Um novo registro não retira outra cadeira de operação.'
        ]));
      }
      if (reincidencia.length >= 1) {
        avisos.appendChild(C.el('div', { class: 'alert' }, [
          C.el('b', { text: 'Reincidência.' }),
          ' Esta cadeira já teve ' + C.plural(reincidencia.length, 'registro', 'registros') +
          ' do mesmo motivo (' + cat.rotulo.toLowerCase() + '). ' +
          'O último foi em ' + C.fmtCarimbo(reincidencia[0].abertoEm) + '.'
        ]));
      }
      var proxima = impacto.proximaAfetada ? String(impacto.proximaAfetada).split(' ') : null;
      if (impacto.ocorrenciasAfetadas > 0 && proxima && C.dataValida(proxima[0])) {
        avisos.appendChild(C.el('div', { class: 'alert danger' }, [
          C.el('b', { text: 'A agenda será afetada.' }),
          ' A primeira ocupação sem cadeira suficiente é em ' + C.fmtDiaAno(proxima[0]) +
          (proxima[1] ? ' às ' + proxima[1] : '') + '. Avise a coordenação para remanejar.'
        ]));
      }

      var v = validarMotivo(form.motivo);
      var dataOk = C.dataValida(form.previsaoRetorno);
      var errado = form.motivo.length > 0 && !v.ok;
      dicaMotivo.textContent = errado ? v.erro : dicaMotivoTexto();
      dicaMotivo.setAttribute('style', errado
        ? 'font-size:11.5px;color:var(--danger)'
        : 'font-size:11.5px');
      dicaMotivo.className = errado ? '' : 'muted';
      btn.disabled = !v.ok || !dataOk;
      btn.title = !v.ok ? v.erro : (!dataOk ? 'Informe uma previsão de retorno válida.' : '');
    }

    function linha(rotulo, valor) {
      auto.appendChild(C.el('div', { style: 'display:flex;gap:10px;padding:2px 0' }, [
        C.el('span', { class: 'muted', style: 'min-width:168px;flex:none', text: rotulo }),
        C.el('span', { text: valor })
      ]));
    }

    /* Só prévia: o protocolo definitivo é o que o Store devolver. */
    function proximoProtocoloPrevisto() {
      var ano = String(new Date().getFullYear()).slice(2);
      return 'MNT-' + ano + '-' + (1000 + S.estado.manutencoes.length + 1);
    }

    function gravar() {
      var v = validarMotivo(form.motivo);
      if (!v.ok) { C.toast(v.erro); return; }
      if (!C.dataValida(form.previsaoRetorno)) {
        C.toast('Informe uma previsão de retorno válida.');
        return;
      }
      var reg = S.abrirManutencao({
        clinicaId: clId, cadeira: cadeira,
        categoria: form.categoria, motivo: v.texto,
        previsaoRetorno: form.previsaoRetorno
      });
      /* Se o Store recusar a gravação, o retorno vazio não pode virar toast
         de sucesso nem fechar a modal com o texto perdido. */
      if (!reg) { C.toast('A manutenção não foi aberta.'); return; }
      U.fecharModal();
      C.toast('Manutenção ' + reg.protocolo + ' aberta · ' + S.localCadeira(cadeira) + ' interditada.');
      if (aoConcluir) aoConcluir(reg);
    }

    atualizar();
    return m;
  }

  /* ── Encerramento ─────────────────────────────────────────────────── */
  function encerrar(registro, aoConcluir) {
    if (!S.pode('manutencao.encerrar')) {
      C.toast('Somente o técnico de manutenção ou a coordenação encerram um registro.');
      return;
    }
    var laudo = '';
    var btn = C.el('button', { class: 'btn btn-primary', text: 'Encerrar e liberar cadeira', disabled: true, onclick: gravar });

    var conteudo = C.el('div', { class: 'stack' }, [
      C.el('div', { class: 'preview' }, [
        C.el('div', {}, [C.el('b', { text: registro.protocolo }), ' · ' + S.rotuloCategoriaManutencao(registro.categoria)]),
        C.el('div', { class: 'muted', text: S.localCadeira(registro.cadeira) +
          ' · aberta há ' + C.decorrido(registro.abertoEm) + ' por ' + S.nomePessoa(registro.abertoPor) }),
        C.el('div', { class: 'muted', style: 'margin-top:6px', text: registro.motivo })
      ]),
      U.campo('Laudo de encerramento', C.el('textarea', {
        class: 'input', rows: '3',
        placeholder: 'O que foi feito? Peças trocadas, testes realizados. Obrigatório.',
        oninput: function (ev) {
          laudo = ev.target.value;
          btn.disabled = laudo.trim().length < MIN_LAUDO;
          btn.title = btn.disabled
            ? 'Descreva o serviço com pelo menos ' + C.plural(MIN_LAUDO, 'caractere', 'caracteres') + '.'
            : '';
        }
      }), 'Obrigatório — mínimo de ' + C.plural(MIN_LAUDO, 'caractere', 'caracteres') + '.')
    ]);

    U.modal({
      titulo: 'Encerrar manutenção',
      subtitulo: registro.protocolo,
      largura: '620px',
      conteudo: conteudo,
      acoes: [
        C.el('button', { class: 'btn btn-outline', text: 'Voltar', onclick: U.fecharModal }),
        btn
      ]
    });

    function gravar() {
      if (laudo.trim().length < MIN_LAUDO) {
        C.toast('Descreva o serviço com pelo menos ' + C.plural(MIN_LAUDO, 'caractere', 'caracteres') + '.');
        return;
      }
      S.encerrarManutencao(registro.id, laudo.trim());
      U.fecharModal();
      C.toast(S.localCadeira(registro.cadeira) + ' liberada · ' + registro.protocolo + ' encerrado.');
      if (aoConcluir) aoConcluir();
    }
  }

  /* ── Ficha completa do registro ───────────────────────────────────── */
  function ficha(registro) {
    var i = registro.impacto;
    var janela = i && i.janelaDias ? i.janelaDias : 14;
    return C.el('div', { class: 'stack', style: 'gap:0' }, [
      U.kv('Protocolo', registro.protocolo),
      U.kv('Situação', registro.status === 'aberta'
        ? C.el('span', { class: 'badge warn', text: 'aberta há ' + C.decorrido(registro.abertoEm) })
        : C.el('span', { class: 'badge ok', text: 'encerrada' })),
      U.kv('Motivo', S.rotuloCategoriaManutencao(registro.categoria)),
      U.kv('Criticidade', registro.criticidade),
      /* Agrupamento, clínica e número global vêm juntos daqui. */
      U.kv('Local', S.localCadeira(registro.cadeira)),
      U.kv('Aberto por', S.nomePessoa(registro.abertoPor)),
      U.kv('Abertura', C.fmtCarimbo(registro.abertoEm)),
      U.kv('Previsão de retorno', registro.previsaoRetorno ? C.fmtDiaAno(registro.previsaoRetorno) : '—'),
      registro.status === 'encerrada' ? U.kv('Encerrado por', S.nomePessoa(registro.fechadoPor)) : null,
      registro.status === 'encerrada' ? U.kv('Encerramento', C.fmtCarimbo(registro.fechadoEm)) : null,
      U.kv('Tempo de interdição', tempoInterdicao(registro)),
      /* O impacto é a foto do dia da abertura e não se atualiza sozinho —
         a ficha diz isso em vez de apresentar o número como se fosse de hoje. */
      i ? U.kv('Impacto na abertura', i.ocorrenciasAfetadas === 0
        ? 'sem ocupações comprometidas nos ' + C.plural(janela, 'dia', 'dias') + ' seguintes'
        : C.plural(i.ocorrenciasAfetadas, 'ocupação', 'ocupações') + ' nos ' +
          C.plural(janela, 'dia', 'dias') + ' seguintes · ' + i.turmasAfetadas.join(', ')) : null,
      i && i.apuradoEm
        ? U.kv('Impacto apurado em', C.fmtCarimbo(i.apuradoEm) + ' — número da abertura, não recalculado')
        : null,
      C.el('div', { style: 'padding:14px 0 0' }, [
        C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:6px', text: 'Descrição do ocorrido' }),
        C.el('div', { style: 'font-size:13.5px;line-height:1.6', text: registro.motivo })
      ]),
      registro.laudo ? C.el('div', { style: 'padding:16px 0 0' }, [
        C.el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:6px', text: 'Laudo de encerramento' }),
        C.el('div', { style: 'font-size:13.5px;line-height:1.6', text: registro.laudo })
      ]) : null
    ]);
  }

  global.Manutencao = { abrir: abrir, encerrar: encerrar, ficha: ficha, categoria: categoria };
})(window);
