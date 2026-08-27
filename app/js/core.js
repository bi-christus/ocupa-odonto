/* core.js — utilitários de DOM, datas e formatação. Sem dependências. */
(function (global) {
  'use strict';

  /* ── DOM ─────────────────────────────────────────────────────────── */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        /* 'html' já existiu aqui como innerHTML e era um caminho de XSS
           armazenado: título de atividade escrito por um usuário chegava
           cru ao DOM de outro. Agora é tratado como texto. Para markup,
           monte nós com C.el e passe em children. */
        else if (k === 'html') node.textContent = String(v).replace(/<[^>]*>/g, '');
        else if (k === 'style') node.setAttribute('style', v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) { children.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(typeof children === 'object' ? children : document.createTextNode(String(children)));
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  /* ── Datas ───────────────────────────────────────────────────────────
     Datas trafegam como 'YYYY-MM-DD' e são sempre construídas em horário
     local para evitar o deslocamento de fuso do construtor ISO.          */
  function parseISO(iso) {
    var p = String(iso).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function toISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function addDays(iso, n) {
    var d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d);
  }
  function weekday(iso) { return parseISO(iso).getDay(); }        // 0=dom … 6=sáb
  function startOfWeek(iso) { return addDays(iso, -((weekday(iso) + 6) % 7)); } // segunda

  var DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  var DIAS_LONGO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function fmtDia(iso) { var d = parseISO(iso); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); }
  function fmtDiaAno(iso) { var d = parseISO(iso); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function fmtExtenso(iso) { var d = parseISO(iso); return d.getDate() + ' de ' + MESES[d.getMonth()]; }
  function fmtCabecalho(iso) {
    var d = parseISO(iso);
    return DIAS_CURTO[d.getDay()].toLowerCase() + '., ' + d.getDate() + ' de ' + MESES[d.getMonth()].slice(0, 3) + '.';
  }
  function nomeDia(dow, longo) { return longo ? DIAS_LONGO[dow] : DIAS_CURTO[dow]; }

  /* Lista de dias da semana em texto: [1,3] → "seg e qua"; [1,3,5] → "seg, qua e sex" */
  function listaDias(dows) {
    var nomes = dows.slice().sort().map(function (d) { return DIAS_CURTO[d].toLowerCase(); });
    if (nomes.length === 0) return '—';
    if (nomes.length === 1) return nomes[0];
    return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
  }

  /* ── Horas ───────────────────────────────────────────────────────── */
  function toMin(hhmm) {
    var p = String(hhmm).split(':');
    return Number(p[0]) * 60 + Number(p[1] || 0);
  }
  function fromMin(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  function duracaoH(ini, fim) { return (toMin(fim) - toMin(ini)) / 60; }
  function fmtHoras(h) {
    var arred = Math.round(h * 10) / 10;
    return (arred % 1 === 0 ? String(arred) : arred.toFixed(1).replace('.', ',')) + ' h';
  }
  /* Faixas [a1,a2) e [b1,b2) se cruzam? */
  function sobrepoe(a1, a2, b1, b2) { return toMin(a1) < toMin(b2) && toMin(b1) < toMin(a2); }

  function agoraHHMM() {
    var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function hojeISO() { return toISO(new Date()); }

  /* Carimbo de data/hora completo para registros automáticos */
  function carimbo(date) {
    var d = date || new Date();
    return toISO(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtCarimbo(stamp) {
    if (!stamp) return '—';
    var p = String(stamp).split(' ');
    return fmtDiaAno(p[0]) + (p[1] ? ' às ' + p[1] : '');
  }
  /* Tempo decorrido desde um carimbo, em linguagem natural */
  function decorrido(stamp) {
    if (!stamp) return '—';
    var p = String(stamp).split(' ');
    var hm = (p[1] || '00:00').split(':');
    var d = parseISO(p[0]); d.setHours(Number(hm[0]), Number(hm[1]));
    var min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60);
    if (h < 24) return h + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '');
    var dias = Math.floor(h / 24);
    return dias + (dias === 1 ? ' dia' : ' dias') + (h % 24 ? ' ' + (h % 24) + ' h' : '');
  }

  /* Data ISO 'YYYY-MM-DD' válida de verdade — inclusive rejeitando 31/02,
     que o construtor Date aceitaria virando 03/03. */
  function dataValida(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return false;
    var p = String(iso).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.getFullYear() === Number(p[0]) &&
      d.getMonth() === Number(p[1]) - 1 &&
      d.getDate() === Number(p[2]);
  }

  /* "1 cadeira" / "2 cadeiras". O plural irregular vai no terceiro
     argumento: plural(n, 'ocupação', 'ocupações'). */
  function plural(n, singular, plural_) {
    var s = n === 1 ? singular : (plural_ || singular + 's');
    return n + ' ' + s;
  }

  /* ── Diversos ────────────────────────────────────────────────────── */
  function uid(prefixo) {
    return (prefixo || 'id') + '_' + Math.random().toString(36).slice(2, 9);
  }
  function iniciais(nome) {
    var p = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    var a = p[0][0] || '';
    var b = p.length > 1 ? p[p.length - 1][0] : (p[0][1] || '');
    return (a + b).toUpperCase();
  }
  function primeiroNome(nome) { return String(nome).split(/\s+/)[0]; }

  function toast(msg) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var t = el('div', { class: 'toast', text: msg });
    box.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s'; t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 3600);
  }

  function baixarCSV(nomeArquivo, linhas) {
    var csv = linhas.map(function (linha) {
      return linha.map(function (c) {
        var s = c === null || c === undefined ? '' : String(c);
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';');
    }).join('\r\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: nomeArquivo });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 800);
  }

  global.Core = {
    el: el, clear: clear, append: append,
    parseISO: parseISO, toISO: toISO, addDays: addDays, weekday: weekday, startOfWeek: startOfWeek,
    fmtDia: fmtDia, fmtDiaAno: fmtDiaAno, fmtExtenso: fmtExtenso, fmtCabecalho: fmtCabecalho,
    nomeDia: nomeDia, listaDias: listaDias,
    DIAS_CURTO: DIAS_CURTO, DIAS_LONGO: DIAS_LONGO, MESES: MESES,
    toMin: toMin, fromMin: fromMin, duracaoH: duracaoH, fmtHoras: fmtHoras, sobrepoe: sobrepoe,
    agoraHHMM: agoraHHMM, hojeISO: hojeISO, pad: pad,
    dataValida: dataValida, plural: plural,
    carimbo: carimbo, fmtCarimbo: fmtCarimbo, decorrido: decorrido,
    uid: uid, iniciais: iniciais, primeiroNome: primeiroNome,
    toast: toast, baixarCSV: baixarCSV
  };
})(window);
