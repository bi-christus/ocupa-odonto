/* exemplos.js — um arquivo local com um exemplo de cada e-mail.

     node _auditoria/avisos/exemplos.js   →  dist/avisos/exemplos.html

   As mensagens saem da função publicada; só o banco, as pessoas e o envio são
   de mentira. dist/ não vai para o git. */
'use strict';
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const Atender = require('../../app/api/_avisos/atender');
const { esc } = require('../../app/api/_avisos/mensagem');
const BancoFalso = require('./banco-falso');

const COORD = 'coord@exemplo.br', PROF = 'prof@exemplo.br', OUTRA = 'outra@exemplo.br';
const faixa = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const doc = (dados, ms) => ({ dados: dados, criadoEm: Date.now() - (ms || 1000), mudadoEm: Date.now() - (ms || 1000) });

function banco() {
  return {
    config: { sistema: doc({ parametros: { enviarEmails: true } }) },
    autorizados: {
      [COORD]: doc({ nome: 'Andréa Exemplo', nivel: 'coordenador', ativo: true }),
      [PROF]: doc({ nome: 'Filipe Exemplo', nivel: 'professor', ativo: true }),
      [OUTRA]: doc({ nome: 'Marina Exemplo', nivel: 'professor', ativo: true })
    },
    agrupamentos: { ag1: doc({ nome: 'Clínicas 1 e 2', clinicas: ['cl1', 'cl2'] }), ag5: doc({ nome: 'Pré-clínica maior', clinicas: ['cl9'] }) },
    clinicas: {
      cl1: doc({ nome: 'Clínica 1', agrupamentoId: 'ag1', cadeiras: 14, primeiraCadeira: 1 }),
      cl2: doc({ nome: 'Clínica 2', agrupamentoId: 'ag1', cadeiras: 14, primeiraCadeira: 15 }),
      cl9: doc({ nome: 'Pré-clínica maior', especialidade: 'Pré-clínica', agrupamentoId: 'ag5', cadeiras: 70, primeiraCadeira: 1 })
    },
    disciplinas: {
      d1: doc({ codigo: 'ODO-301', nome: 'Clínica Integrada I', nivel: 'graduacao', professores: [PROF, OUTRA] }),
      d2: doc({ codigo: 'POS-01', nome: 'Endodontia', nivel: 'pos', professores: [PROF] })
    },
    turmas: {}, ocupacoes: {}
  };
}
const pontual = (x) => Object.assign({
  tipo: 'pontual', agrupamentoId: 'ag1', escopo: 'a', data: '2026-12-01', inicio: '07:40', fim: '11:20', disciplinaId: 'd1',
  responsavelId: PROF, tipoAtividade: 'graduacao', descricao: 'T1 · atendimento', cadeirasPedidas: 6, cadeirasAlocadas: faixa(1, 6),
  situacao: 'aprovada', excecoes: [], criadoPor: COORD, decididoPor: COORD, editadoPor: COORD
}, x);
const recorrente = (x) => Object.assign({
  tipo: 'recorrente', agrupamentoId: 'ag1', escopo: 'b', dias: [1, 3], inicio: '13:40', fim: '17:20', vigenciaInicio: '2026-08-03',
  vigenciaFim: '2026-12-18', disciplinaId: 'd1', responsavelId: PROF, tipoAtividade: 'graduacao', descricao: 'T2', cadeirasPedidas: 8,
  cadeirasAlocadas: faixa(15, 22), excecoes: [], encerradaEm: null, criadoPor: COORD, editadoPor: COORD
}, x);

/* [título, reserva antes, mudança (null apaga), itens] — a reserva fica em x1. */
const CASOS = [
  ['Pedido aprovado', pontual({ situacao: 'pendente', cadeirasAlocadas: undefined }), { situacao: 'aprovada', cadeirasAlocadas: faixa(1, 6) }, [{ evento: 'aprovada', id: 'x1' }]],
  ['Reserva criada pela coordenação (recorrente)', recorrente({ excecoes: [{ data: '2026-12-07', motivo: 'x' }] }), {}, [{ evento: 'criada', id: 'x1' }]],
  ['Várias linhas do mesmo envio, num e-mail só', pontual({}), {}, [{ evento: 'criada', id: 'x1' }, { evento: 'criada', id: 'x2' }, { evento: 'criada', id: 'x3' }],
    { x2: pontual({ data: '2026-12-03', cadeirasAlocadas: faixa(7, 12) }), x3: pontual({ agrupamentoId: 'ag5', disciplinaId: 'd2', tipoAtividade: 'pos', descricao: 'Turma da noite', inicio: '18:20', fim: '22:00', cadeirasPedidas: 70, cadeirasAlocadas: faixa(1, 70) }) }],
  ['Pedido recusado', pontual({ situacao: 'pendente' }), { situacao: 'recusada', motivoRecusa: 'A clínica estará em manutenção nessa manhã.', cadeirasAlocadas: undefined }, [{ evento: 'recusada', id: 'x1' }]],
  ['Reserva alterada', pontual({}), { data: '2026-12-02', inicio: '13:40', fim: '17:20', escopo: 'b', cadeirasPedidas: 10, cadeirasAlocadas: faixa(15, 24), descricao: 'T1 · atendimento com a T3' }, [{ evento: 'editada', id: 'x1' }]],
  ['Pedido alterado antes de aprovar', pontual({ situacao: 'pendente', cadeirasAlocadas: undefined }), { inicio: '18:20', fim: '22:00' }, [{ evento: 'editada', id: 'x1' }]],
  ['Reserva alterada: trocou de professor (quem saiu e quem entrou recebem)', recorrente({}), { responsavelId: OUTRA }, [{ evento: 'editada', id: 'x1' }]],
  ['Cadeiras trocadas por outra pessoa', recorrente({}), { cadeirasAlocadas: [15, 16, 20, 21, 22, 23, 24, 25] }, [{ evento: 'cadeiras', id: 'x1' }]],
  ['Encontro cancelado', recorrente({}), { excecoes: [{ data: '2026-12-07', motivo: 'Feriado acadêmico', registradoPor: COORD }] }, [{ evento: 'cancelada', id: 'x1', data: '2026-12-07' }]],
  ['Encontro restaurado', recorrente({ excecoes: [{ data: '2026-12-07', motivo: 'Feriado acadêmico', registradoPor: COORD }] }), { excecoes: [] }, [{ evento: 'restaurada', id: 'x1', data: '2026-12-07' }]],
  ['Reserva pontual cancelada', pontual({}), null, [{ evento: 'cancelada', id: 'x1' }]],
  ['Recorrência encerrada', recorrente({}), { encerradaEm: '2026-11-30' }, [{ evento: 'encerrada', id: 'x1' }]],
  ['Reserva excluída', recorrente({}), { excluidaEm: '2026-11-25 10:00', excluidaPor: COORD, motivoExclusao: 'Lançada em duplicidade' }, [{ evento: 'excluida', id: 'x1' }]],
  ['Reserva recuperada, com outras cadeiras', pontual({ excluidaEm: '2026-11-20 08:00', excluidaPor: COORD }), { excluidaEm: null, cadeirasAlocadas: faixa(7, 12) }, [{ evento: 'recuperada', id: 'x1' }]]
];

async function gerar() {
  const saida = [];
  for (const [titulo, antes, mudanca, itens, outras] of CASOS) {
    const b = banco(), caixa = [];
    b.ocupacoes.x1 = doc(antes, 60000);
    Object.keys(outras || {}).forEach((id) => { b.ocupacoes[id] = doc(outras[id]); });
    const atender = Atender.criar({
      env: {
        AVISOS_SMTP_HOST: 'smtp.invalid', AVISOS_SMTP_PORTA: '465', AVISOS_SMTP_USUARIO: 'x', AVISOS_SMTP_SENHA: 'x',
        AVISOS_REMETENTE: 'Ocupa <ocupa@exemplo.br>', AVISOS_SEGREDO: 'segredo-de-mentira-dos-exemplos-0123456789'
      },
      buscar: BancoFalso.criar({ banco: () => b }).buscar,
      verificar: async () => ({ uid: 'u', email: COORD, nome: '' }),
      enviar: async (c, msgs) => msgs.map((m) => { caixa.push(m); return { ok: true }; })
    });
    const chamar = async (corpo) => {
      const req = Readable.from([Buffer.from(JSON.stringify(corpo))]);
      req.method = 'POST';
      req.headers = { 'content-type': 'application/json', authorization: 'Bearer exemplo' };
      const res = { setHeader() {}, end(t) { this.corpo = JSON.parse(t); } };
      await atender(req, res);
      return res.corpo;
    };
    const bil = (await chamar({ acao: 'bilhete', id: 'x1' })).bilhete;
    if (mudanca === null) delete b.ocupacoes.x1;
    else b.ocupacoes.x1 = { dados: Object.assign({}, antes, mudanca), criadoEm: Date.now() - 2000, mudadoEm: Date.now() };
    const r = await chamar({ acao: 'avisar', itens: itens.map((i) => Object.assign({}, i, i.id === 'x1' ? { bilhete: bil } : {})) });
    if (!caixa.length) throw new Error(titulo + ' não gerou e-mail: ' + JSON.stringify(r));
    caixa.forEach((m) => saida.push({ titulo: titulo, m: m }));
  }
  return saida;
}

gerar().then((l) => {
  const pasta = path.join(__dirname, '..', '..', 'dist', 'avisos');
  fs.mkdirSync(pasta, { recursive: true });
  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Ocupa · exemplos dos e-mails</title><style>body{font:15px/1.5 Arial,sans-serif;margin:0 auto;padding:24px 16px;max-width:760px;color:#16181c}' +
    'h1{font-size:22px}h2{font-size:17px;margin:40px 0 4px}p{margin:2px 0;color:#5b6169;font-size:14px}iframe{width:100%;border:1px solid #cfd8e2;margin-top:10px}' +
    'details{margin-top:8px;font-size:14px}pre{white-space:pre-wrap;background:#f2f2f3;padding:12px;font-size:13px}</style></head><body>' +
    '<h1>Exemplos dos e-mails do Ocupa</h1><p>Pessoas, disciplinas e reservas são fictícias. Nenhuma destas mensagens foi enviada.</p>' +
    l.map((x, i) => '<h2>' + (i + 1) + '. ' + esc(x.titulo) + '</h2><p><b>Para:</b> ' + esc(x.m.para) + '</p><p><b>Assunto:</b> ' + esc(x.m.assunto) + '</p>' +
      '<iframe title="' + esc(x.titulo) + '" srcdoc="' + esc(x.m.html) + '" onload="this.style.height=this.contentDocument.documentElement.scrollHeight+\'px\'"></iframe>' +
      '<details><summary>versão em texto</summary><pre>' + esc(x.m.texto) + '</pre></details>').join('') + '</body></html>';
  const arq = path.join(pasta, 'exemplos.html');
  fs.writeFileSync(arq, html);
  console.log(l.length + ' mensagens em ' + arq);
});
