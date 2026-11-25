/* limite.js — teto de volume, em memória.

   Vale por instância da Vercel, e não para o projeto inteiro: um contador
   exato pediria um banco, e as Security Rules fecham qualquer coleção nova.
   O teto de verdade vem de outro lugar — cada e-mail exige uma gravação
   recente e confirmada no banco, feita por quem tem a permissão —, e a cota
   da conta de envio fica por cima de tudo. Isto segura o laço descontrolado
   e a repetição do mesmo aviso. */
'use strict';

function criar(agora) {
  const janelas = new Map();
  const vistos = new Map();

  function limpar(t) {
    if (janelas.size > 2000) janelas.forEach((v, k) => { if (!v.length || t - v[v.length - 1] > 86400000) janelas.delete(k); });
    if (vistos.size > 5000) vistos.forEach((v, k) => { if (t - v > 3600000) vistos.delete(k); });
  }
  /* Conta mais `n` em `chave` e diz se ainda cabe em `max` por `periodo`. */
  function cabe(chave, n, max, periodo) {
    const t = agora();
    limpar(t);
    const l = (janelas.get(chave) || []).filter((x) => t - x < periodo);
    if (l.length + n > max) { janelas.set(chave, l); return false; }
    for (let i = 0; i < n; i++) l.push(t);
    janelas.set(chave, l);
    return true;
  }
  function jaFoi(chave) {
    const t = vistos.get(chave);
    return t !== undefined && agora() - t < 3600000;
  }
  function marcar(chave) { vistos.set(chave, agora()); }

  return { cabe: cabe, jaFoi: jaFoi, marcar: marcar };
}

module.exports = { criar: criar };
