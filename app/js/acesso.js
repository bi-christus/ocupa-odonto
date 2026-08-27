/* acesso.js — perfis de acesso e matriz de permissões.
   Fonte única de verdade: toda tela e todo botão consultam Acesso.pode(). */
(function (global) {
  'use strict';

  /* Os três níveis pedidos. A ordem define a hierarquia exibida no painel. */
  var PERFIS = [
    {
      id: 'coordenador',
      nome: 'Coordenador',
      descricao: 'Coordenação do curso. Acesso integral: estrutura, recorrências do semestre, disciplinas, relatórios e controle de acessos.'
    },
    {
      id: 'professor',
      nome: 'Professor',
      descricao: 'Conduz as turmas sob sua coordenação. Registra atividades pontuais, ocupa e libera cadeiras, abre chamados de manutenção.'
    },
    {
      id: 'tecnico',
      nome: 'Técnico de manutenção',
      descricao: 'Responsável pelas cadeiras. Abre e encerra manutenções, consulta a agenda para planejar intervenções.'
    }
  ];

  /* Cada permissão é uma capacidade concreta do sistema, agrupada por área
     para render da matriz no painel de acessos. */
  var PERMISSOES = [
    { id: 'painel.ver', area: 'Painel', rotulo: 'Ver o painel e indicadores' },
    { id: 'agenda.ver', area: 'Agenda', rotulo: 'Consultar a agenda das clínicas' },
    { id: 'agenda.criarRecorrente', area: 'Agenda', rotulo: 'Criar recorrência de turma no semestre' },
    { id: 'agenda.criarPontual', area: 'Agenda', rotulo: 'Registrar atividade pontual' },
    { id: 'agenda.cancelarQualquer', area: 'Agenda', rotulo: 'Cancelar qualquer registro' },
    { id: 'agenda.cancelarPropria', area: 'Agenda', rotulo: 'Cancelar os próprios registros' },
    { id: 'cadeira.ocupar', area: 'Operação', rotulo: 'Ocupar e liberar cadeiras' },
    { id: 'disciplinas.ver', area: 'Disciplinas', rotulo: 'Consultar disciplinas e turmas' },
    { id: 'disciplinas.editar', area: 'Disciplinas', rotulo: 'Criar e editar disciplinas e turmas' },
    { id: 'alunos.vincular', area: 'Disciplinas', rotulo: 'Vincular e desvincular alunos' },
    { id: 'estrutura.ver', area: 'Estrutura', rotulo: 'Ver a estrutura das clínicas' },
    { id: 'estrutura.editar', area: 'Estrutura', rotulo: 'Alterar cadeiras e parâmetros' },
    { id: 'manutencao.abrir', area: 'Estrutura', rotulo: 'Abrir registro de manutenção' },
    { id: 'manutencao.encerrar', area: 'Estrutura', rotulo: 'Encerrar registro de manutenção' },
    { id: 'relatorios.ver', area: 'Relatórios', rotulo: 'Consultar e exportar relatórios' },
    { id: 'acessos.ver', area: 'Acessos', rotulo: 'Ver o controle de acessos' },
    { id: 'acessos.editar', area: 'Acessos', rotulo: 'Conceder, alterar e revogar acesso' }
  ];

  var MATRIZ = {
    coordenador: PERMISSOES.map(function (p) { return p.id; }),
    professor: [
      'painel.ver', 'agenda.ver', 'agenda.criarPontual', 'agenda.cancelarPropria',
      'cadeira.ocupar', 'disciplinas.ver', 'alunos.vincular',
      'estrutura.ver', 'manutencao.abrir', 'relatorios.ver'
    ],
    tecnico: [
      'agenda.ver', 'estrutura.ver', 'manutencao.abrir', 'manutencao.encerrar', 'relatorios.ver'
    ]
  };

  function perfil(id) {
    for (var i = 0; i < PERFIS.length; i++) if (PERFIS[i].id === id) return PERFIS[i];
    return null;
  }
  function nomePerfil(id) { var p = perfil(id); return p ? p.nome : id; }

  /* pode(usuario, permissao) — usuário inativo não passa por nenhuma porta. */
  function pode(usuario, permissao) {
    if (!usuario || usuario.ativo === false) return false;
    var lista = MATRIZ[usuario.perfil] || [];
    return lista.indexOf(permissao) !== -1;
  }

  function permissoesDe(perfilId) { return (MATRIZ[perfilId] || []).slice(); }

  function areas() {
    var vistas = [], ordem = [];
    PERMISSOES.forEach(function (p) {
      if (vistas.indexOf(p.area) === -1) { vistas.push(p.area); ordem.push({ area: p.area, itens: [] }); }
      ordem[vistas.indexOf(p.area)].itens.push(p);
    });
    return ordem;
  }

  global.Acesso = {
    PERFIS: PERFIS, PERMISSOES: PERMISSOES,
    perfil: perfil, nomePerfil: nomePerfil,
    pode: pode, permissoesDe: permissoesDe, areas: areas
  };
})(window);
