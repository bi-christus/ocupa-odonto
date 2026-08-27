/* dados.js — estado inicial do sistema.

   O sistema nasce VAZIO de pessoas e de atividade: não há usuários, alunos,
   disciplinas, turmas, ocupações nem manutenções de exemplo. Quem entra é
   criado no primeiro login pelo Google, com o nível vindo de autorizados.js.

   O que a semente traz é apenas o que é fato físico do curso — a estrutura
   das clínicas — e a configuração de domínio (especialidades, categorias de
   manutenção, tipos de atividade), que são vocabulário do negócio e não
   dados de teste. Tudo o mais é cadastrado pela coordenação dentro do
   sistema.                                                                 */
(function (global) {
  'use strict';
  var C = global.Core;

  var CATEGORIAS_MANUTENCAO = [
    { id: 'equipamento', rotulo: 'Falha de equipamento', prazoDias: 3, criticidade: 'alta' },
    { id: 'hidraulica', rotulo: 'Hidráulica / sucção', prazoDias: 2, criticidade: 'alta' },
    { id: 'eletrica', rotulo: 'Elétrica', prazoDias: 2, criticidade: 'alta' },
    { id: 'biosseguranca', rotulo: 'Biossegurança / contaminação', prazoDias: 1, criticidade: 'crítica' },
    { id: 'mobiliario', rotulo: 'Mobiliário / cadeira odontológica', prazoDias: 5, criticidade: 'média' },
    { id: 'preventiva', rotulo: 'Manutenção preventiva', prazoDias: 1, criticidade: 'baixa' },
    { id: 'insumo', rotulo: 'Falta de insumo essencial', prazoDias: 2, criticidade: 'média' }
  ];

  var TIPOS_ATIVIDADE = [
    { id: 'reposicao', rotulo: 'Reposição de aula' },
    { id: 'atendimento', rotulo: 'Atendimento extraordinário' },
    { id: 'avaliacao', rotulo: 'Avaliação prática' },
    { id: 'capacitacao', rotulo: 'Capacitação / calibração' },
    { id: 'extensao', rotulo: 'Projeto de extensão' },
    { id: 'evento', rotulo: 'Evento acadêmico' },
    { id: 'bloqueio', rotulo: 'Bloqueio administrativo' }
  ];

  /* Na ordem das clínicas 1 a 8. */
  var ESPECIALIDADES = ['Dentística', 'Periodontia', 'Endodontia', 'Prótese',
    'Odontopediatria', 'Cirurgia', 'Ortodontia', 'Clínica Integrada'];

  function semente() {
    var hoje = C.hojeISO();
    /* Semestre provisório: começa na segunda desta semana e corre 18 semanas
       letivas. A coordenação ajusta as datas reais na aba Estrutura. */
    var inicioSemestre = C.startOfWeek(hoje);
    var fimSemestre = C.addDays(inicioSemestre, 18 * 7 - 3);
    var ano = C.parseISO(hoje).getFullYear();
    var periodoLetivo = ano + '.' + (C.parseISO(hoje).getMonth() < 6 ? '1' : '2');

    /* ── Agrupamentos e clínicas ──
       Estrutura física real do curso: quatro agrupamentos de duas clínicas,
       14 cadeiras cada — 8 clínicas e 112 cadeiras, numeradas globalmente de
       1 a 112. O agrupamento é nomeado pelas clínicas que contém; a palavra
       "sala" não é usada em lugar nenhum do sistema. */
    var agrupamentos = [
      { id: 'ag1', nome: 'Clínicas 1 e 2', clinicas: ['cl1', 'cl2'] },
      { id: 'ag2', nome: 'Clínicas 3 e 4', clinicas: ['cl3', 'cl4'] },
      { id: 'ag3', nome: 'Clínicas 5 e 6', clinicas: ['cl5', 'cl6'] },
      { id: 'ag4', nome: 'Clínicas 7 e 8', clinicas: ['cl7', 'cl8'] }
    ];
    var clinicas = [];
    agrupamentos.forEach(function (g, gi) {
      g.clinicas.forEach(function (id, j) {
        var k = gi * 2 + j;
        clinicas.push({
          id: id, nome: 'Clínica ' + (k + 1), agrupamentoId: g.id,
          especialidade: ESPECIALIDADES[k],
          cadeiras: 14, primeiraCadeira: k * 14 + 1,
          abertura: '07:00', fechamento: '22:00'
        });
      });
    });

    return {
      versao: 5,
      periodoLetivo: periodoLetivo,
      semestre: { inicio: inicioSemestre, fim: fimSemestre },
      parametros: {
        faixaMinimaMin: 120,
        capacidadeSemanalH: 60,
        bloquearSobreposicao: true,
        exigirMotivoManutencao: true,
        aberturaPadrao: '07:00',
        fechamentoPadrao: '22:00'
      },
      agrupamentos: agrupamentos,
      clinicas: clinicas,
      /* Tudo abaixo é preenchido pelo uso do sistema. */
      usuarios: [],
      alunos: [],
      disciplinas: [],
      turmas: [],
      recorrencias: [],
      pontuais: [],
      manutencoes: [],
      atribuicoes: []
    };
  }

  global.Dados = {
    semente: semente,
    CATEGORIAS_MANUTENCAO: CATEGORIAS_MANUTENCAO,
    TIPOS_ATIVIDADE: TIPOS_ATIVIDADE,
    ESPECIALIDADES: ESPECIALIDADES
  };
})(window);
