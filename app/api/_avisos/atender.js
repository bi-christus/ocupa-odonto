/* atender.js — a porta da função /api/avisos.

     GET                            o que falta configurar (nomes, sem valores)
     POST { acao:'bilhete', id }    o "antes" assinado de uma reserva
     POST { acao:'avisar', itens }  itens: { evento, id, data?, bilhete? }

   Esta função não pode virar um relay de e-mail aberto, e o código dela é
   público. Por isso:
     · sem ID token válido do Firebase, nada acontece;
     · o corpo tem campos contados: qualquer outro (um "para", um "texto")
       derruba o pedido inteiro, em vez de ser ignorado em silêncio;
     · destinatário e texto saem do banco, lido com o token de quem chamou;
     · quem recebe precisa ser uma pessoa ATIVA de `autorizados`;
     · o evento precisa ter acontecido, há pouco, por quem está chamando, e
       o perfil dele precisa poder fazer aquilo (eventos.js);
     · `parametros.enviarEmails` precisa estar ligado NO BANCO.
   Nenhum endereço, nome, texto ou token vai para o log. */
'use strict';
const Config = require('./config');
const Token = require('./token');
const Firestore = require('./firestore');
const Bilhete = require('./bilhete');
const Ocupa = require('./ocupa');
const Eventos = require('./eventos');
const Mensagem = require('./mensagem');
const Smtp = require('./smtp');
const Limite = require('./limite');

const MAX_CORPO = 400000;
const MAX_ITENS = 30;
const MAX_PESSOAS = 15;
const DEZ_MIN = 10 * 60 * 1000;
const UMA_HORA = 60 * 60 * 1000;
const UM_DIA = 24 * UMA_HORA;

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

class Recusa extends Error {
  constructor(status, erro) { super(erro); this.status = status; this.erro = erro; }
}

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(corpo));
}

function soEstas(objeto, chaves) {
  return !!objeto && typeof objeto === 'object' && !Array.isArray(objeto) &&
    Object.keys(objeto).every((k) => chaves.indexOf(k) !== -1);
}

/* A Vercel entrega `req.body` pronto (e o getter lança em JSON quebrado); fora
   dela o corpo vem pelo fluxo. */
async function lerCorpo(req) {
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) throw new Recusa(415, 'tipo');
  if (Number(req.headers['content-length'] || 0) > MAX_CORPO) throw new Recusa(413, 'tamanho');
  try {
    if ('body' in req) {
      const b = req.body;
      if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
      return JSON.parse(String(b));
    }
    const partes = [];
    let total = 0;
    for await (const p of req) {
      total += p.length;
      if (total > MAX_CORPO) throw new Recusa(413, 'tamanho');
      partes.push(p);
    }
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch (e) {
    if (e instanceof Recusa) throw e;
    throw new Recusa(400, 'pedido_invalido');
  }
}

function conferirItens(itens) {
  if (!Array.isArray(itens) || !itens.length || itens.length > MAX_ITENS) throw new Recusa(400, 'pedido_invalido');
  itens.forEach((it) => {
    if (!soEstas(it, ['evento', 'id', 'data', 'bilhete'])) throw new Recusa(400, 'pedido_invalido');
    if (Eventos.EVENTOS.indexOf(it.evento) === -1) throw new Recusa(400, 'pedido_invalido');
    if (typeof it.id !== 'string' || !ID.test(it.id)) throw new Recusa(400, 'pedido_invalido');
    const regra = Eventos.COM_DATA[it.evento];
    if (it.data !== undefined) {
      if (!regra || typeof it.data !== 'string' || !DATA.test(it.data)) throw new Recusa(400, 'pedido_invalido');
    } else if (regra === 'obrigatoria') throw new Recusa(400, 'pedido_invalido');
    if (it.bilhete !== undefined && typeof it.bilhete !== 'string') throw new Recusa(400, 'pedido_invalido');
  });
}

function unicos(lista) { return Array.from(new Set(lista.filter(Boolean).map(String))); }

/* As dependências entram por aqui só para o teste trocar rede, relógio e
   SMTP. A produção chama `criar()` sem nada. */
function criar(op) {
  op = op || {};
  const agora = op.agora || Date.now;
  const buscar = op.buscar || ((url, o) => fetch(url, o));
  const enviar = op.enviar || Smtp.enviar;
  const config = () => Config.ler(op.env || process.env);
  const projeto = config().projeto;
  const verificar = op.verificar || Token.criarVerificador({ projeto: projeto, buscar: buscar, agora: agora });
  const banco = Firestore.criarLeitor({ projeto: projeto, buscar: buscar });
  const limite = Limite.criar(agora);
  const log = op.log || ((m) => console.error('avisos: ' + m));

  async function identificar(req) {
    const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(String(req.headers.authorization || ''));
    if (!m) throw new Recusa(401, 'sessao');
    try {
      return { conta: await verificar(m[1]), token: m[1] };
    } catch (e) {
      if (e instanceof Token.TokenRecusado) throw new Recusa(401, 'sessao');
      throw e;
    }
  }

  async function bilhete(corpo, quem, cfg) {
    if (!soEstas(corpo, ['acao', 'id']) || typeof corpo.id !== 'string' || !ID.test(corpo.id)) {
      throw new Recusa(400, 'pedido_invalido');
    }
    if (!limite.cabe('b:' + quem.conta.uid, 1, 200, DEZ_MIN)) throw new Recusa(429, 'limite');
    const doc = await banco.ler('ocupacoes', corpo.id, quem.token);
    if (!doc) throw new Recusa(404, 'nao_encontrada');
    const b = Bilhete.emitir(cfg.segredo, quem.conta, doc, agora());
    if (b.length > Bilhete.TAMANHO_MAXIMO) throw new Recusa(413, 'tamanho');
    return { ok: true, bilhete: b };
  }

  /* Só o que a mensagem precisa. Estrutura e reservas numa volta; disciplina,
     turma (legado) e pessoas na seguinte, porque dependem da reserva. */
  async function carregar(itens, antes, quem) {
    const t = quem.token;
    const ids = unicos(itens.map((i) => i.id));
    const r1 = await Promise.all([
      banco.ler('autorizados', quem.conta.email, t), banco.ler('config', 'sistema', t),
      banco.listar('agrupamentos', t), banco.listar('clinicas', t),
      Promise.all(ids.map((id) => banco.ler('ocupacoes', id, t)))
    ]);
    const docs = {};
    ids.forEach((id, i) => { docs[id] = r1[4][i]; });
    const reservas = r1[4].filter(Boolean).map((d) => d.dados)
      .concat(Object.keys(antes).map((k) => antes[k].dados));

    /* Na disciplina sem `professores` o vínculo ainda é herdado das turmas
       (S.professoresDaDisciplina): quem troca cadeiras sem ser coordenação
       depende disso, então a lista inteira de turmas vem junto. */
    const professor = r1[0] && r1[0].dados.nivel !== 'coordenador';
    const turmaIds = unicos(reservas.map((o) => o.turmaId)).filter((x) => ID.test(x));
    const turmas = professor
      ? await banco.listar('turmas', t)
      : (await Promise.all(turmaIds.map((id) => banco.ler('turmas', id, t)))).filter(Boolean);

    const discIds = unicos(reservas.map((o) => o.disciplinaId)
      .concat(turmas.filter((x) => turmaIds.indexOf(x.id) !== -1).map((x) => x.dados.disciplinaId))).filter((x) => ID.test(x));
    const pessoaIds = unicos(reservas.map((o) => o.responsavelId)
      .concat(turmas.filter((x) => turmaIds.indexOf(x.id) !== -1).map((x) => x.dados.professorCoordenadorId)))
      .filter((x) => x !== quem.conta.email && Config.enderecoValido(x));
    const r2 = await Promise.all([
      Promise.all(discIds.map((id) => banco.ler('disciplinas', id, t))),
      Promise.all(pessoaIds.map((id) => banco.ler('autorizados', id, t)))
    ]);

    const plano = (d) => Object.assign({}, d.dados, { id: d.id });
    return {
      docs: docs,
      acervo: {
        config: r1[1] ? r1[1].dados : null,
        agrupamentos: r1[2].map(plano), clinicas: r1[3].map(plano),
        autorizados: [r1[0]].concat(r2[1]).filter(Boolean).map(plano),
        disciplinas: r2[0].filter(Boolean).map(plano), turmas: turmas.map(plano),
        alunos: [], ocupacoes: [], manutencoes: [], atribuicoes: []
      }
    };
  }

  async function avisar(corpo, quem, cfg) {
    if (!soEstas(corpo, ['acao', 'itens'])) throw new Recusa(400, 'pedido_invalido');
    conferirItens(corpo.itens);
    if (!limite.cabe('a:' + quem.conta.uid, 1, 60, DEZ_MIN)) throw new Recusa(429, 'limite');

    const t0 = agora();
    const antes = {};
    corpo.itens.forEach((it, i) => {
      const b = it.bilhete ? Bilhete.conferir(cfg.segredo, it.bilhete, quem.conta, it.id, t0) : null;
      if (b) antes[i] = b;
    });
    const lido = await carregar(corpo.itens, antes, quem);
    const p = lido.acervo.config && lido.acervo.config.parametros;
    const vazio = { ok: true, enviados: [], falhas: [], ignorados: [] };
    if (!p || p.enviarEmails !== true) return Object.assign(vazio, { desligado: true });

    const loja = await Ocupa.montar(quem.conta, lido.acervo);
    if (!loja.aceito) throw new Recusa(403, 'acesso');
    const ctx = { S: loja.S, C: loja.C, conta: quem.conta, agora: t0 };

    /* Uma mensagem por pessoa, com todas as reservas dela deste envio. */
    const porPessoa = new Map();
    const ignorados = [];
    const ignorar = (it, motivo, nome) => ignorados.push({ evento: it.evento, id: it.id, motivo: motivo, nome: nome });
    corpo.itens.forEach((it, i) => {
      const depois = lido.docs[it.id];
      const ap = Eventos.apurar(it, ctx, depois, antes[i] || null);
      if (!ap.ok) { ignorar(it, ap.motivo); return; }
      if (!ap.para.length) { ignorar(it, 'sem_responsavel'); return; }
      ap.para.forEach((alvo) => {
        if (alvo.id === quem.conta.email) { ignorar(it, 'proprio'); return; }
        const pessoa = loja.S.pessoa(alvo.id);
        /* `ativo` cru, e não o da tela (que trata a ausência como ativo): é a
           mesma exigência das Security Rules, e endereço que não existe mais
           vira devolução na caixa de quem envia. */
        const registro = lido.acervo.autorizados.find((a) => a.id === alvo.id);
        if (!pessoa || !registro || registro.ativo !== true || !Config.enderecoValido(alvo.id)) {
          ignorar(it, 'sem_acesso', pessoa ? pessoa.nome : undefined);
          return;
        }
        const chave = [it.evento, it.id, it.data || '', depois ? depois.versao : antes[i].versao, alvo.id].join('|');
        if (limite.jaFoi(chave)) { ignorar(it, 'repetido'); return; }
        const b = Mensagem.bloco(ctx, it, ap, alvo.papel);
        if (!b) { ignorar(it, 'sem_mudanca'); return; }
        if (!porPessoa.has(alvo.id)) porPessoa.set(alvo.id, { nome: pessoa.nome, blocos: [], chaves: [] });
        const g = porPessoa.get(alvo.id);
        if (g.chaves.indexOf(chave) !== -1) { ignorar(it, 'repetido'); return; }
        g.blocos.push(b);
        g.chaves.push(chave);
      });
    });

    const pessoas = Array.from(porPessoa.keys());
    if (!pessoas.length) return Object.assign(vazio, { ignorados: ignorados });
    if (pessoas.length > MAX_PESSOAS) throw new Recusa(400, 'pedido_invalido');
    /* A cota da conta de envio é somada entre as ferramentas que a usam:
       estourá-la pararia as outras também. */
    if (!limite.cabe('e:' + quem.conta.uid, pessoas.length, 60, UMA_HORA) ||
      !limite.cabe('e:todos', pessoas.length, 100, UMA_HORA) ||
      !limite.cabe('d:todos', pessoas.length, cfg.limiteDia, UM_DIA)) throw new Recusa(429, 'limite');

    const mensagens = pessoas.map((id) => {
      const g = porPessoa.get(id);
      return Object.assign({ para: id }, Mensagem.montar(g.nome, g.blocos, cfg.url,
        cfg.responder ? cfg.responder.endereco : ''));
    });
    const res = await enviar(cfg, mensagens, { agora: agora });
    const enviados = [], falhas = [];
    pessoas.forEach((id, i) => {
      const g = porPessoa.get(id), r = res[i] || { ok: false, codigo: 'conexao' };
      if (r.ok) { enviados.push(g.nome); g.chaves.forEach(limite.marcar); }
      else falhas.push({ nome: g.nome, motivo: r.codigo });
    });
    if (falhas.length) log('falha de envio: ' + unicos(falhas.map((f) => f.motivo)).join(', '));
    return { ok: !falhas.length, enviados: enviados, falhas: falhas, ignorados: ignorados };
  }

  return async function atender(req, res) {
    try {
      const cfg = config();
      if (req.method === 'GET') {
        responder(res, 200, { servico: 'avisos', configurado: cfg.configurado, faltando: cfg.faltando, invalidas: cfg.invalidas });
        return;
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); throw new Recusa(405, 'metodo'); }
      const quem = await identificar(req);
      if (!cfg.configurado) throw new Recusa(503, 'nao_configurado');
      const corpo = await lerCorpo(req);
      if (!corpo || typeof corpo !== 'object') throw new Recusa(400, 'pedido_invalido');
      if (corpo.acao === 'bilhete') responder(res, 200, await bilhete(corpo, quem, cfg));
      else if (corpo.acao === 'avisar') responder(res, 200, await avisar(corpo, quem, cfg));
      else throw new Recusa(400, 'pedido_invalido');
    } catch (e) {
      if (e instanceof Recusa) { responder(res, e.status, { ok: false, erro: e.erro }); return; }
      if (e instanceof Firestore.LeituraNegada) { responder(res, 403, { ok: false, erro: 'acesso' }); return; }
      /* Só o nome da falha: a mensagem de um erro de rede pode trazer a URL,
         e na URL da REST vai o e-mail de quem chamou. */
      log('erro interno: ' + (e && e.name ? e.name : 'desconhecido'));
      responder(res, 500, { ok: false, erro: 'interno' });
    }
  };
}

module.exports = { criar: criar };
