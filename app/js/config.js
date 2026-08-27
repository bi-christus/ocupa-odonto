/* config.js — configuração de implantação.

   Este é o ÚNICO arquivo que precisa ser editado para colocar o sistema no ar.

   Nada aqui é segredo. O Client ID do Google é um identificador público, feito
   para aparecer no código que roda no navegador — pode ir para o repositório
   sem problema. NUNCA coloque aqui um client secret: este fluxo de login não
   usa nenhum, e um secret exposto no navegador seria uma falha de segurança.

   Onde obter o Client ID:
     console.cloud.google.com → APIs e serviços → Credenciais
     → Criar credenciais → ID do cliente OAuth → tipo "Aplicativo da Web"
   Em "Origens JavaScript autorizadas", cadastre TODAS as origens de onde o
   sistema será aberto, por exemplo:
     http://localhost:3000        (desenvolvimento)
     https://SEU-DOMINIO          (produção)
   O Google recusa a origem file://, então abrir o index.html com dois cliques
   não faz login — é preciso servir por http/https.                            */
(function (global) {
  'use strict';

  global.Config = {

    /* Client ID OAuth desta aplicação. Identificador público: pode ficar no
       repositório. Não existe client secret neste fluxo. */
    googleClientId: '771816455765-5bj26535tqd3u88a8jsitce2qoduce9h.apps.googleusercontent.com',

    /* Vazio de propósito, por decisão de projeto: o controle de quem entra é
       feito pela lista em autorizados.js, e não pelo domínio do e-mail. Isso
       permite conceder acesso a alguém de fora do domínio institucional sem
       mexer nesta configuração.
       Preencher este campo volta a exigir que a conta seja do domínio, além
       de constar na lista — as duas checagens são cumulativas, nunca
       alternativas. */
    dominioInstitucional: '',

    /* Aparece no cabeçalho e na tela de entrada. */
    nomeInstituicao: 'Odontologia'
  };

  global.Config.configurado = function () {
    return !!(global.Config.googleClientId && global.Config.googleClientId.indexOf('.apps.googleusercontent.com') !== -1);
  };
})(window);
