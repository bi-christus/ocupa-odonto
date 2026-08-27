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

    /* Cole aqui o Client ID, algo terminado em .apps.googleusercontent.com */
    googleClientId: '',

    /* Domínio institucional aceito no login. Com isto preenchido, contas de
       fora do domínio são recusadas mesmo que o e-mail esteja na lista de
       autorizados. Deixe vazio para não restringir por domínio. */
    dominioInstitucional: '',

    /* Aparece no cabeçalho e na tela de entrada. */
    nomeInstituicao: 'Odontologia'
  };

  global.Config.configurado = function () {
    return !!(global.Config.googleClientId && global.Config.googleClientId.indexOf('.apps.googleusercontent.com') !== -1);
  };
})(window);
