/* autorizados.js — quem pode entrar no sistema.

   O login é exclusivamente por conta Google com e-mail institucional, e só
   entra quem estiver nesta lista. Não existe cadastro aberto nem senha.

   O primeiro acesso de cada pessoa cria o registro dela no sistema a partir
   dos dados devolvidos pelo Google (nome e e-mail). O nível vem daqui.

   Perfis válidos:
     'coordenador' — acesso integral, inclusive controle de acessos
     'professor'   — registra e acompanha as ocupações das próprias turmas
     'tecnico'     — abre e encerra chamados de manutenção das cadeiras

   O campo `nome` é opcional: sem ele, usa-se o nome da conta Google.

   ┌─────────────────────────────────────────────────────────────────────┐
   │ ALCANCE DESTA LISTA, dito com todas as letras:                      │
   │ sem servidor, esta verificação acontece no navegador. Ela impede o   │
   │ acesso casual de quem não deveria entrar, mas alguém com            │
   │ conhecimento técnico contorna editando o código na própria máquina.  │
   │ Como barreira de segurança de verdade, é preciso validar o token do  │
   │ Google no servidor. Enquanto o sistema for piloto sem back-end,      │
   │ trate isto como controle de acesso administrativo, não de segurança. │
   └─────────────────────────────────────────────────────────────────────┘

   PARA COLOCAR NO AR: acrescente ao menos um coordenador abaixo, senão
   ninguém consegue entrar. A tela de entrada avisa quando a lista está vazia. */
(function (global) {
  'use strict';

  global.Autorizados = [

    /* Administradores do sistema. O nível 'coordenador' é o topo da
       hierarquia e o único com a permissão acessos.editar — são estas duas
       contas que cadastram as demais pessoas e definem o nível de cada uma,
       pelo painel Acessos, sem precisar mexer neste arquivo de novo. */
    { email: 'setorbiunichristus@gmail.com', perfil: 'coordenador' },
    { email: 'napa21@christus.com.br', perfil: 'coordenador' }

    /* Para acrescentar alguém aqui, uma linha por pessoa:
       { email: 'fulano@dominio', perfil: 'professor' },
       Perfis válidos: 'coordenador', 'professor', 'tecnico'. */

  ];

  /* Busca sem diferenciar maiúsculas e espaços em volta. */
  global.Autorizados.buscar = function (email) {
    var alvo = String(email || '').trim().toLowerCase();
    if (!alvo) return null;
    for (var i = 0; i < global.Autorizados.length; i++) {
      var a = global.Autorizados[i];
      if (String(a.email || '').trim().toLowerCase() === alvo) return a;
    }
    return null;
  };
})(window);
