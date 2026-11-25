/* ocupa.js — o store.js do navegador, rodando aqui.

   Quem responde pela reserva, de que disciplina ela é, que cadeiras segura,
   quem pode cancelar o quê: essas regras moram em store.js e acesso.js, com
   o legado embutido (turma, reserva integral). Reescrevê-las no servidor
   seria a segunda cópia que este projeto já aprendeu a não ter. Então a
   função carrega os MESMOS arquivos, trocando só a `Nuvem` por uma que
   entrega o que veio da REST — o mesmo truque do _auditoria/harness.html.

   Cada pedido ganha a própria instância (`window` próprio): o store guarda
   estado, e duas pessoas atendidas pela mesma instância da Vercel não podem
   se enxergar. Nenhuma escrita sai daqui: todo método de gravação da Nuvem
   de mentira devolve uma promessa vazia.

   Os caminhos são literais, um por um, para o empacotador da Vercel ver
   quais arquivos a função precisa (o vercel.json repete em includeFiles). */
'use strict';
const fs = require('fs');
const path = require('path');

const FONTES = [
  fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'core.js'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'acesso.js'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dados.js'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'store.js'), 'utf8')
].map((fonte) => new Function('window', fonte));

/* `acervo` tem a forma de Nuvem.carregarTudo. Devolve { aceito, S, C, A }. */
async function montar(conta, acervo) {
  const nada = () => Promise.resolve();
  const window = { Promise: Promise };
  window.Nuvem = {
    lerAutorizado: (email) => Promise.resolve(
      acervo.autorizados.find((a) => a.id === email) || null),
    carregarTudo: () => Promise.resolve(acervo),
    assinarVivas: () => {}, encerrarAssinaturas: () => {},
    sair: nada, gravar: nada, apagar: nada, apagarVarios: nada,
    gravarOcupacao: nada, removerOcupacao: nada, desindexarOcupacao: nada, atualizarIndice: nada,
    novoId: () => 'nao-grava'
  };
  FONTES.forEach((f) => f(window));
  window.Core.toast = () => {};
  const r = await window.Store.conferir({ email: conta.email, displayName: conta.nome });
  return { aceito: !!(r && r.ok), S: window.Store, C: window.Core, A: window.Acesso };
}

module.exports = { montar: montar };
