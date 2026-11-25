/* avisos.js — a única função de servidor do Ocupa: avisa por e-mail o
   professor coordenador de uma reserva. O trabalho está em _avisos/, que a
   Vercel não publica como função por causa do "_" no nome. */
'use strict';
module.exports = require('./_avisos/atender').criar();
