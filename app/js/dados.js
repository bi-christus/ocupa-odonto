/* dados.js — estado inicial do sistema.

   O sistema nasce VAZIO de pessoas e de atividade: não há usuários, alunos,
   disciplinas, turmas, ocupações nem manutenções de exemplo. Quem entra é
   criado no primeiro login pelo Google, com o nível vindo da coleção
   `autorizados` no Firestore, aplicada pelas Security Rules.

   O que a semente traz é apenas o que é fato físico do curso — a estrutura
   das clínicas, incluindo a especialidade de cada uma — e o vocabulário de
   domínio exportado em global.Dados (categorias de manutenção, tipos de
   atividade, turnos). Tudo o mais é cadastrado pela coordenação dentro do
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

  /* Tipo da ocupação: o curso trabalha com dois, e só. */
  var TIPOS_ATIVIDADE = [
    { id: 'graduacao', rotulo: 'Graduação' },
    { id: 'pos', rotulo: 'Pós-graduação' }
  ];

  /* Os sete tipos que existiam antes de 17/09/2026. Saíram do formulário mas
     continuam aqui porque ocupação já gravada NÃO muda de tipo: sem esta
     lista, uma atividade antiga apareceria na agenda como "reposicao", em
     minúsculo e sem acento, que é o id cru. Não acrescente nada aqui — a
     lista é histórico fechado. */
  var TIPOS_LEGADOS = [
    { id: 'reposicao', rotulo: 'Reposição de aula' },
    { id: 'atendimento', rotulo: 'Atendimento extraordinário' },
    { id: 'avaliacao', rotulo: 'Avaliação prática' },
    { id: 'capacitacao', rotulo: 'Capacitação / calibração' },
    { id: 'extensao', rotulo: 'Projeto de extensão' },
    { id: 'evento', rotulo: 'Evento acadêmico' },
    { id: 'bloqueio', rotulo: 'Bloqueio administrativo' }
  ];

  /* Turnos fixos do curso. São ATALHO do formulário de ocupação: preenchem
     início e término de uma vez. A digitação livre do horário continua
     valendo — turno é conveniência, não restrição, e nada no sistema obriga
     uma ocupação a começar ou terminar nestes horários. */
  var TURNOS = [
    { id: 'manha', rotulo: 'Manhã', inicio: '07:40', fim: '11:20' },
    { id: 'tarde', rotulo: 'Tarde', inicio: '13:40', fim: '17:20' },
    { id: 'noite', rotulo: 'Noite', inicio: '18:20', fim: '22:00' }
  ];

  /* Especialidade de cada CLÍNICA, na ordem das clínicas 1 a 8. Nada a ver com
     disciplina: disciplina tem só código e nome. Consumida apenas aqui, na
     semente — por isso não é exportada em global.Dados. */
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
       Estrutura física real do curso: quatro agrupamentos de duas clínicas de
       atendimento, 14 cadeiras cada, mais as duas PRÉ-CLÍNICAS, que são de
       laboratório, têm tamanhos próprios — 70 e 20 cadeiras — e funcionam
       SOZINHAS. São 10 clínicas e 202 cadeiras, numeradas globalmente de 1 a
       202, contínuas.

       Cada pré-clínica é um agrupamento de UMA clínica só, e é isso que as
       faz individuais: a opção "as duas" só existe onde o agrupamento tem
       duas (`cls.length > 1`, em opcoesEscopo), então elas nunca aparecem
       como reserva conjunta — nem entre si, nem com clínica de atendimento.
       Cada uma também ganha o próprio `indices/{agrupamentoId}`, então uma
       não disputa horário com a outra.

       14 por clínica DEIXOU DE SER INVARIANTE em 22/09/2026, quando as
       pré-clínicas entraram: quem precisar do tamanho leia `c.cadeiras`, e da
       faixa, `S.faixaCadeiras` — nada no sistema pode voltar a multiplicar
       por 14. O agrupamento é nomeado pelas clínicas que contém; a palavra
       "sala" não é usada em lugar nenhum do sistema. */
    var agrupamentos = [
      { id: 'ag1', nome: 'Clínicas 1 e 2', clinicas: ['cl1', 'cl2'] },
      { id: 'ag2', nome: 'Clínicas 3 e 4', clinicas: ['cl3', 'cl4'] },
      { id: 'ag3', nome: 'Clínicas 5 e 6', clinicas: ['cl5', 'cl6'] },
      { id: 'ag4', nome: 'Clínicas 7 e 8', clinicas: ['cl7', 'cl8'] },
      { id: 'ag5', nome: 'Pré-clínica maior', clinicas: ['cl9'] },
      { id: 'ag6', nome: 'Pré-clínica menor', clinicas: ['cl10'] }
    ];
    var clinicas = [];
    agrupamentos.slice(0, 4).forEach(function (g, gi) {
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
    /* A numeração das pré-clínicas continua de onde as clínicas de
       atendimento pararam — derivada, não escrita à mão: cadeira 113 é a
       primeira da pré-clínica maior porque as oito anteriores somam 112. */
    var proxima = clinicas.reduce(function (s, c) { return s + c.cadeiras; }, 0) + 1;
    [{ id: 'cl9', ag: 'ag5', nome: 'Pré-clínica maior', cadeiras: 70 },
     { id: 'cl10', ag: 'ag6', nome: 'Pré-clínica menor', cadeiras: 20 }].forEach(function (p) {
      clinicas.push({
        id: p.id, nome: p.nome, agrupamentoId: p.ag,
        especialidade: 'Pré-clínica',
        cadeiras: p.cadeiras, primeiraCadeira: proxima,
        abertura: '07:00', fechamento: '22:00'
      });
      proxima += p.cadeiras;
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
        /* Ligado por padrão: a coordenação desliga pela tela de Estrutura se
           quiser que o professor registre direto. Em banco que já existe o
           campo não está gravado, e a ausência também vale como ligado
           (store.exigirAprovacao) — o pedido da coordenação foi exigir. */
        exigirAprovacaoProfessor: true,
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
    TIPOS_LEGADOS: TIPOS_LEGADOS,
    TURNOS: TURNOS
  };
})(window);
