# Ocupa — Controle de ocupação das clínicas de Odontologia

Sistema interno da Universidade Christus para planejar a ocupação das clínicas e
cadeiras, organizar turmas e disciplinas do período letivo e registrar chamados
de manutenção.

**Está em produção e em uso.** `main` publica direto. Leia a seção "Regras de
trabalho" antes de empurrar qualquer coisa.

---

## Topologia

| Peça | Onde |
|---|---|
| Repositório | `github.com/bi-christus/ocupa-odonto`, branch `main` (público) |
| Publish root | `app/` — é o Root Directory configurado na Vercel |
| Produção | https://controle-de-clinicas-odonto.vercel.app |
| Vercel | projeto `controle-de-clinicas-odonto`, plano Hobby, conta `setorbiunichristus-4527` |
| Firebase / GCP | projeto `ocupa-odonto` (o mesmo para Auth, Firestore e OAuth) |
| Firestore | banco `(default)`, região `southamerica-east1` (São Paulo), modo produção |

`bi-christus` é uma **conta pessoal** do GitHub (SETOR BI), não uma organização.
Existe um Deploy Hook chamado `deploy-main` para o caso de a Vercel bloquear um
deploy por autoria de commit — o token está no painel, nunca no repositório.

Branch antiga a remover quando der: `feat/lista-de-acessos`.

---

## Arquitetura — o que não pode mudar

**ES5 estrito, sem bundler.** IIFEs penduradas em `window`, dependências
resolvidas pela ordem dos `<script>` em `index.html`. Não existe build step.
Não introduza Vite, webpack, npm scripts nem módulos ES sem conversar antes.

**SDK Firebase em builds `compat`**, não o modular. O modular pressupõe ESM e
não encaixa no padrão acima.

Ordem dos scripts em produção (é a ordem real, conferida):

```
firebase-app-compat.js
firebase-auth-compat.js
firebase-firestore-compat.js
core.js  config.js  nuvem.js  acesso.js  dados.js  store.js  ui.js
registro.js  manutencao.js  cadeiras.js  impressao.js  painel.js  agora.js
agenda.js  disciplinas.js  relatorios.js  estrutura.js  acessos.js  app.js
```

`impressao.js` vem antes das views porque Agenda e Relatórios chamam as duas.
`cadeiras.js` (o seletor de cadeiras da reserva, 05/10/2026) também: Agenda e
Ocupação agora chamam `Cadeiras.escolher`.

Também na raiz de `app/`: `privacidade.html` e `termos.html` — páginas estáticas,
sem script algum, exigidas pelo Google. Não as transforme em rota do app.

### Config do Firebase

A `apiKey` é identificador público, não segredo. Quem protege são as Security Rules.

```js
apiKey: "AIzaSyCz_yKNT4grtM2fj8OKEZASqjdDQFwaPhA"
authDomain: "ocupa-odonto.firebaseapp.com"
projectId: "ocupa-odonto"
storageBucket: "ocupa-odonto.firebasestorage.app"
messagingSenderId: "771816455765"
appId: "1:771816455765:web:42339758c221bea6ee1edc"
```

---

## Persistência — cache hidratado

Decisão central, tomada para não reescrever as sete telas:

- No boot, depois do login, **todo o acervo vai para memória**.
- As **leituras do Store continuam síncronas**, servidas desse cache.
- Só as **escritas são assíncronas**, e cada uma **aplica a mudança no cache
  antes de persistir**. Isso é o que permite que os ~40 pontos de chamada nas
  views continuem chamando sem `await`.
- Se a gravação falha, o cache é desfeito e a pessoa é avisada por toast — nunca
  um sucesso que não aconteceu.
- `onSnapshot` ligado em `ocupacoes`, `manutencoes`, `autorizados`,
  `atribuicoes` e `disciplinas` (esta desde 05/10/2026: é nela que mora o
  vínculo do professor). `matriculas` saiu da leitura junto com a turma.

Efeito colateral desejado: perder o acesso durante a sessão derruba a pessoa na
hora, pelo snapshot de `autorizados`.

**Não transforme as leituras em promessas.** O volume é minúsculo (10 clínicas,
202 cadeiras, um semestre) e o custo do refactor seria o app inteiro.

---

## Modelo de dados

| Coleção | Id do documento | Campos |
|---|---|---|
| `config` | `sistema` (doc único) | `versao`, `periodoLetivo`, `semestre{inicio,fim}`, `parametros{faixaMinimaMin, capacidadeSemanalH, bloquearSobreposicao, exigirMotivoManutencao, exigirAprovacaoProfessor, aberturaPadrao, fechamentoPadrao}` |
| `autorizados` | e-mail em minúsculas | `nome`, `nivel`, `ativo`, `ultimoAcesso` |
| `agrupamentos` | `ag1`–`ag6` | `nome`, `clinicas[]` |
| `clinicas` | `cl1`–`cl10` | `nome`, `agrupamentoId`, `especialidade`, `cadeiras`, `primeiraCadeira`, `abertura`, `fechamento` |
| `disciplinas` | auto | `codigo`, `nome`, `nivel` (`graduacao` \| `pos`), `professores[]` (e-mails; desde 05/10/2026) |
| `turmas` | auto | **legado, sem tela desde 05/10/2026** — `disciplinaId`, `codigo`, `professorCoordenadorId`, `periodoLetivo`; lida só para as reservas antigas acharem disciplina e professor |
| `alunos` | auto | **legado, sem tela** — `nome`, `matricula`, `periodo`; lida só para o nome das atribuições antigas |
| `matriculas` | `{turmaId}__{alunoId}` | **não é mais lida** (o vínculo de alunos saiu com a turma) |
| `ocupacoes` | auto | `tipo`, `agrupamentoId`, `escopo`, `inicio`, `fim`, `disciplinaId`, `responsavelId`, `tipoAtividade`, `descricao`, `cadeirasPedidas`, `cadeirasAlocadas[]`, `criadoPor`, `criadoEm`, `excecoes[]`, `excluidaEm`, `excluidaPor`, `motivoExclusao` · recorrente: `dias[]`, `vigenciaInicio`, `vigenciaFim`, `periodoLetivo`, `encerradaEm` · pontual: `data`, `situacao`, `motivoRecusa`, `decididoPor`, `decididoEm` · **legado**: `turmaId` e `observacao` (antes de 05/10/2026), `titulo` (antes de 17/09/2026), `cadeiras` (antes de 17/09/2026, ignorado) |
| `manutencoes` | auto | `protocolo`, `clinicaId`, `cadeira`, `categoria`, `criticidade`, `motivo`, `abertoPor`, `abertoEm`, `previsaoRetorno`, `status`, `fechadoPor`, `fechadoEm`, `laudo`, `impacto{}` |
| `atribuicoes` | auto | `chave`, `clinicaId`, `cadeira`, `nome`, `alunoId` (nulo nos registros novos), `data`, `registradoPor`, `registradoEm` — desde 05/10/2026 é só o NOME anotado na cadeira |
| `indices` | `ag1`–`ag6` | `agrupamentoId`, `itens[]` — cada item com `cadeiras[]` (ou `null`/ausente = integral) |

**Não existe coleção `cadeiras`.** Cadeira é derivada de `primeiraCadeira` +
`cadeiras` da clínica. O estado de uma cadeira vive em `manutencoes` e
`atribuicoes`.

### Reserva por QUANTIDADE de cadeiras (05/10/2026)

**Reverteu a "reserva integral" de 17/09/2026.** A reserva diz QUANTAS
cadeiras usa (`cadeirasPedidas`, obrigatório no formulário) e o sistema
escolhe QUAIS (`cadeirasAlocadas`), **da menor para a maior** entre as que
nenhuma outra reserva segura naquele horário — e elas já nascem marcadas
como ocupadas. O resto da clínica continua livre para outras reservas no
mesmo horário até as cadeiras acabarem. Várias reservas dividem a clínica;
o que não pode é dividir a CADEIRA.

Três estados de documento (`S.ehIntegral`, `S.quantidadeDe`, `S.cadeirasDe`):

- com `cadeirasAlocadas` — reserva nova ou ajustada: segura aquelas;
- só com `cadeirasPedidas` — **pedido** de professor ainda não aprovado: não
  segura cadeira (como não segura horário); a aprovação escolhe;
- sem nenhum dos dois — reserva **anterior a 05/10/2026**: continua
  INTEGRAL (o escopo inteiro), porque não há como adivinhar quantas ela
  usaria. Deixa de ser integral quando alguém ajusta as cadeiras dela.

`cadeiras` sem sufixo é o nome antigo (antes de 17/09/2026) e segue ignorado —
**não leia `r.cadeiras` do documento cru**; a ocorrência já vem com
`cadeiras` (quantidade), `cadeirasLista` e `integral` resolvidos.

**A alocação é UMA para todas as datas da reserva**: a recorrente usa as
mesmas cadeiras toda semana. Uma cadeira só é livre para ela se estiver livre
em TODAS as datas em que ela cai. Cadeira em manutenção AGORA vai para o fim
da fila de escolha, mas não impede a reserva (a regra de antes já era essa).

**A escolha acontece dentro da transação** (`gravarOcupacaoNaNuvem` →
`alocar`), contra o índice relido: a escolha do cache (`alocarLocal`) entra
como preferência; se alguém tomou uma delas no meio-tempo, a transação
escolhe outras e só recusa quando falta quantidade. O seletor de cadeiras
grava com `fixo`: não troca nada, recusa se uma das escolhidas foi tomada.
`alocar` é a MESMA função no formulário (`S.disponibilidade`, sobre o cache)
e na transação (sobre o índice) — não crie uma segunda cópia da regra.

**`atribuicoes` deixou de medir ocupação.** A cadeira alocada já é a cadeira
ocupada. O que sobrou é o NOME de quem está na cadeira naquele encontro —
anotação opcional do professor (`S.registrarNomeNaCadeira`); use
`S.nomeNaCadeira(atrib)`, que resolve aluno cadastrado (registro antigo), nome
livre ou "sem identificação".

`calcularImpacto`: afetada é a ocupação que TEM a cadeira interditada (precisa
trocá-la). Na reserva integral vale a regra antiga (mais nomes registrados do
que restará de operante) — senão toda interdição marcaria todas as integrais.

**Trocar cadeiras** (item "podendo ser alterado pelo professor responsável"):
`S.alterarCadeiras(id, lista)`, pelo seletor (`Cadeiras.escolher`, na Agenda e
em Ocupação agora) ou pelos atalhos de Ocupação agora (devolver uma cadeira,
pôr uma cadeira livre na reserva). Quem pode: `S.podeGerirCadeiras` —
coordenação, o responsável da reserva e os professores vinculados à
disciplina dela. Com `exigirAprovacaoProfessor` ligado, o professor troca e
devolve, mas **não cresce** a reserva além do aprovado (`S.limiteDeCadeiras`)
— senão pedir 5 e marcar 14 passaria por fora da fila. A troca vale para
todas as datas da reserva.

`bloquearSobreposicao` (Estrutura) agora significa "mesma cadeira em duas
reservas": desligado, a alocação ainda prefere as livres, mas não recusa.

**Métricas**: horas de USO de uma clínica são a união dos intervalos do dia
(`S.horasDeUso`) — somar durações contaria a mesma hora duas vezes. A
ocupação dos relatórios é cadeira·hora sobre a capacidade
(`S.cadeirasHoraPorClinica`). "Cadeiras em uso agora" é a soma das cadeiras
alocadas das ocorrências em andamento.

O store traduz `autorizados.nivel` para `perfil` na hidratação; as views não
sabem da diferença.

### As pré-clínicas — individuais, e clínica não tem mais tamanho fixo

Desde 22/09/2026 existem duas clínicas de laboratório: `cl9` **Pré-clínica
maior** (70 cadeiras) e `cl10` **Pré-clínica menor** (20 cadeiras). São 10
clínicas e 202 cadeiras.

**Cada pré-clínica numera as suas cadeiras do 1** — a maior de 1 a 70, a menor
de 1 a 20, como estão marcadas no laboratório. Elas ficam FORA da numeração
contínua do polo, que segue valendo entre as oito de atendimento (1 a 112),
onde já há manutenção e atribuição gravadas com o número global.

> ⚠️ **O número da cadeira não identifica mais a clínica.** A cadeira 5 existe
> na Clínica 1, na Pré-clínica maior e na menor. Quem procura cadeira por
> número passa a lista onde procurar — `S.clinicaDaCadeira(n, entre)` —, e quem
> exibe local passa a clínica — `S.localCadeira(n, clinica)`.
> `registrarNomeNaCadeira` resolve a clínica dentro do escopo da ocupação, e
> manutenção resolve por `m.clinicaId`, não pela faixa (era o contrário até
> 22/09/2026). Dentro de um AGRUPAMENTO o número continua único, porque duas
> clínicas dele nunca repetem faixa — e é isso que deixa `cadeirasAlocadas` e
> o índice guardarem só o número.

A hidratação ordena as clínicas por agrupamento e depois por
`primeiraCadeira`: só por `primeiraCadeira` três empatavam no 1 e a ordem
passava a depender do que o Firestore devolvesse.

**Cada uma é um agrupamento de UMA clínica só** — `ag5` "Pré-clínica maior" e
`ag6` "Pré-clínica menor" —, e é isso que as faz funcionar individualmente,
diferente das oito de atendimento. A opção "as duas" só é montada onde o
agrupamento tem duas (`cls.length > 1`, em `opcoesEscopo`), então elas nunca
aparecem como reserva conjunta; `primeiroEscopoLivre` e o clique na pista do
dia já eram guardados do mesmo jeito (`i >= cls.length`, `clinicas.length > 1`),
então o formato de agrupamento com uma clínica só não exigiu código novo.
Cada uma tem o próprio `indices/{agrupamentoId}`, então uma não disputa
cadeira com a outra. Desde 05/10/2026 a MESMA pré-clínica também aceita várias
reservas no mesmo horário enquanto houver cadeira — o acervo do harness tem
duas na maior (30 e 20 cadeiras), e uma terceira de 25 é recusada por falta.

Na pista do dia (Agenda e Ocupação agora) o agrupamento de uma clínica só não
repete o nome na linha de baixo: `S.subtituloAgrupamento` devolve vazio quando
o nome da única clínica é o do agrupamento.

**14 cadeiras por clínica deixou de ser invariante.** Quem precisar do tamanho
lê `c.cadeiras`; da faixa, `S.faixaCadeiras`; da capacidade de um escopo,
`S.capacidadeEscopo`. Nada pode voltar a multiplicar por 14 nem escrever 112 —
todas as contas do sistema já eram derivadas, e foi só por isso que as duas
entraram sem tocar em store, agenda, relatórios ou impressão.

Também não existe mais UMA faixa do polo para exibir: o painel de Parâmetros
diz "por clínica", a linha "Polo" dos CSV vai sem faixa, e a coluna do CSV de
manutenção deixou de se chamar "Cadeira (1–112)".

Os números da capa e da tela de provisionamento saem de `Dados.semente()`
(`numerosDaEstrutura`, em `app.js`), e não de literais: eles ficaram presos em
"8 clínicas · 112 cadeiras" até esse dia.

**`S.atualizarClinica` continua sem aceitar `cadeiras`**, e agora por outro
motivo: a numeração é global e contínua, então mudar o tamanho de uma clínica
deslocaria a primeira cadeira de todas as seguintes — e com ela cada
`manutencoes.cadeira` e cada `atribuicoes.cadeira` já gravados, que guardam o
número global. Trocar tamanho exige remapear esses registros; não é campo de
formulário. Clínica nova entra pela semente (provisionamento) ou, num banco já
provisionado, gravando `agrupamentos` e `clinicas` direto — foi assim que as
duas pré-clínicas entraram em produção.

### Disciplina sem turma (05/10/2026)

**Turma deixou de existir como cadastro.** Saíram o cadastro de turma, o código
de turma e o vínculo de alunos (que era por turma). Disciplina é só
disciplina: `codigo` + `nome` na graduação, `nome` na pós (`nivel: 'pos'`). A
reserva aponta direto para a disciplina (`disciplinaId`) e grava o próprio
`responsavelId` — que a recorrente antes herdava de
`turma.professorCoordenadorId`. **A turma de cada ocupação é escrita no
campo "Descrição/Turma"** do formulário, nos dois modos e nos dois tipos.

**O professor é vinculado às disciplinas na tela ACESSOS** (editar a pessoa →
lista marcável com busca). O vínculo mora na DISCIPLINA, em `professores` (lista
de e-mails), e não em `autorizados`: a regra de `disciplinas` já é "escrita só
de coordenador", sem restrição de campo; a de `autorizados` restringe campo,
e um campo novo ali só funcionaria depois de alguém mexer no console.
`S.vincularDisciplinas(email, ids)` grava só as disciplinas que mudaram.
Professor vê no formulário só as disciplinas dele (+ "Outros" na pontual).

**Legado embutido — nunca leia `disciplinaId`/`responsavelId` cru de um
documento de reserva.** Use `S.disciplinaIdDe`, `S.disciplinaDe`,
`S.responsavelDe`, `S.descricaoDe` e `S.nivelDe`: eles resolvem a reserva
antiga pela turma (disciplina, professor, e a turma escrita na descrição como
"T1 · …"). `S.professoresDaDisciplina` herda o vínculo das turmas enquanto a
disciplina não tiver `professores`. A ocorrência já vem resolvida.

**Limpeza do cadastro** (aba Disciplinas, coordenação, com prévia):
`S.planoDeLimpeza` + `S.executarLimpeza` resolvem de uma vez as três formas em
que a turma ainda vive no banco — (1) reserva antiga apontando para turma
ganha `disciplinaId`, `responsavelId` e a turma na descrição; (2) disciplinas
com a turma no NOME ("Implantodontia T1", "… T2" — era como a pós distinguia
turmas) viram UMA com o nome-base, e as reservas de cada uma passam para ela
com o "T1"/"T2" na descrição (`S.separarTurmaDoNome`); (3) vínculo de
professor herdado vira `professores` gravado. É idempotente (rodar de novo
termina o que faltou) e a coleção `turmas` NÃO é apagada — fica inerte.
**Ainda não foi rodada em produção**: é a coordenação que dispara.

Consequências para quem mexer aqui:

- **Use os seletores.** `S.especializacoes()`, `S.disciplinasDeGraduacao()`,
  `S.disciplinasDoNivel(nivel)`, `S.disciplinasDoProfessor(uid)`.
- **Rotule pelo Store.** `S.rotuloDisciplina` (código na graduação, nome na
  pós), `S.rotuloDisciplinaLongo`, `S.subtituloDisciplina`. Montar rótulo na mão
  estoura quando a disciplina foi apagada por fora.
- `codigo` da especialização é gerado (`POS-01`, `POS-02`…) só porque o
  documento e as colunas de CSV contam com ele.
- Excluir disciplina (graduação ou pós) com reserva é bloqueado — tire as
  reservas pela Agenda (exclusão reversível). A cascata antiga da pós tirava
  as reservas sem volta.
- Disciplina **sem** `nivel` é da graduação — é o estado de tudo que foi
  gravado antes de 18/09/2026.
- `tipoAtividade` agora é gravado também na recorrente (`graduacao`/`pos`);
  na antiga ele é `aula`, e `S.nivelDe` decide pela disciplina.

### O formulário de ocupação

| Campo | Recorrente | Pontual |
|---|---|---|
| Tipo | Graduação / Pós (filtra a lista) | idem |
| Disciplina / Especialização | obrigatória | obrigatória, com **Outros** |
| Professor coordenador | coordenação escolhe (vinculados primeiro); professor = ele mesmo | idem |
| Clínica + **Cadeiras** | uma linha | **várias linhas** |
| Turnos | **vários** | vários, por linha |
| Descrição/Turma | sim | sim (vale para todas as linhas) |

- **Cadeiras é obrigatório e nasce vazio**; vazio só trava o botão (a dica do
  campo diz "obrigatório"), não vira alerta vermelho no formulário recém-aberto.
  A dica mostra quantas estão livres e quais ficariam ("ficariam as 51–65").
- O seletor de clínica mostra só o NOME da clínica (a especialidade saiu de
  todos os seletores: ao lado do nome ela passava por disciplina) e as
  cadeiras livres no horário de cada linha.
- **Turnos múltiplos**: manhã + tarde dão 07:40–17:20 (início do primeiro,
  término do último). A marcação continua DERIVADA do horário, então os
  marcados são sempre uma faixa contínua: manhã e noite cobrem a tarde, e o
  clique na tarde do meio é recusado com aviso (para usar manhã e noite sem a
  tarde, duas ocupações). Clique de fora estende; da ponta, recolhe.
- **Várias ocupações pontuais num envio** ("+ Adicionar ocupação"): cada linha
  com clínica, cadeiras, data e horário; a nova nasce igual à última. Cada
  linha disputa cadeira com as reservas gravadas E com as linhas anteriores do
  mesmo formulário (entram como itens virtuais em `S.disponibilidade`). Na
  gravação, uma por vez e em ordem — cada uma entra no cache antes da seguinte
  escolher as cadeiras dela. Com aprovação ligada, cada linha vira um pedido.
- `SEM_VINCULO` (`'outros'`) **nunca chega ao Firestore**: vira `null`.
- `C.el` agora seta a PROPRIEDADE `value` de `<textarea>`: o atributo é
  ignorado pelo navegador, e todo redesenho devolvia a descrição em branco na
  tela (com o texto ainda guardado e indo para a gravação sem ninguém ver).

**Disciplina da graduação tem só `codigo` e `nome`** (mais `professores`). `especialidade` é da CLÍNICA e não tem
relação nenhuma com disciplina. O arquivo com mais ocorrências da palavra é
`relatorios.js` — três colunas "Especialidade" em CSV, todas de clínica e
nenhuma delas precisa mudar: nunca faça busca-e-substitui global lá.
Disciplinas criadas antes de 14/09/2026 ainda carregam `especialidade` e
`cargaHoraria` no documento do Firestore. `salvarDisciplina` deixou de enviá-los,
mas como a gravação é `set(..., {merge:true})` isso **não os apaga** — são lixo
inerte, que nada lê. Limpar de verdade exigiria `FieldValue.delete()`.

**`responsavelId` aparece na tela como "Professor coordenador".** O campo guarda
quem responde pela ocupação, e desde 05/10/2026 é gravado nas DUAS formas
(recorrente e pontual): o professor que pede é ele mesmo; a coordenação escolhe,
com os vinculados à disciplina primeiro. Na recorrente antiga ele saía de
`turma.professorCoordenadorId` — por isso `S.responsavelDe`. O rótulo é único
em todas as telas desde 14/09/2026 — não volte a alternar para "Responsável",
e não renomeie o campo, que governa quem pode cancelar (`agenda.js`,
`agora.js`, `painel.js`).
Cuidado: `acesso.js` descreve o perfil Técnico como "Responsável pelas cadeiras"
— ali é adjetivo comum, não este campo.

---

## Aprovação de pedidos

Com `parametros.exigirAprovacaoProfessor` ligado (o padrão — **ausência do
campo também vale como ligado**), ocupação criada por professor nasce
`situacao: 'pendente'`: é pedido, não reserva. A coordenação aprova ou recusa
pela fila no Painel; `agenda.aprovar` é a permissão, só do coordenador. O
próprio autor pode retirar o pedido enquanto ninguém decidiu.

**Pedido não segura cadeira.** Ele não entra em `indices/{agrupamentoId}`
e só tem `cadeirasPedidas` (a quantidade), então vários professores podem
pedir as mesmas. É a **aprovação** que passa pela transação, ESCOLHE as
cadeiras e pode falhar por falta — e aí a coordenação vê a mensagem. Por isso
o formulário avisa, com todas as letras, que pedir não reserva. Pedido
anterior a 05/10/2026 não tem quantidade e é aprovado como foi pedido: a
clínica inteira.

O filtro que sustenta tudo isso é uma linha em `ocorrenciasDoDia`: pontual com
`situacao` diferente de `'aprovada'` é descartada ali. Como essa função é o
funil único de Agenda, Agora, Painel e relatórios — e a disputa de cadeiras do
formulário (`itensLocais`) lê pelo mesmo seletor `pontuaisAtivas` —, filtrar
ali cobre o sistema inteiro. A fila lê `estado.pontuais` direto, por fora do
funil.

Ocupação gravada antes de 17/09/2026 não tem `situacao`, e `situacaoDe` trata a
ausência como aprovada — o contrário faria a agenda inteira desaparecer da tela
no dia do deploy.

> ⚠️ **Esta barreira é só de interface hoje.** A Security Rule de `ocupacoes`
> ainda permite `professor` gravar direto, então o servidor aceita registro que
> não passou pela fila. Enquanto a regra não for ajustada no console, isto é
> convenção de tela, não controle — o mesmo erro que a tela Acessos já cometeu
> aqui. A regra precisa exigir `situacao == 'pendente'` no `create` de
> professor e proibi-lo de alterar `situacao` no `update`.

---

## Exclusão de reservas — reversível

`agenda.excluir`, só do coordenador. Excluir **não apaga o documento**: grava
`excluidaEm`/`excluidaPor`/`motivoExclusao` e tira a entrada do
`indices/{agrupamentoId}` — `N.desindexarOcupacao` faz as duas coisas na mesma
transação. Nenhuma das duas é dispensável: sem a marca não há o que recuperar;
sem sair do índice a reserva sumiria de todas as telas e continuaria bloqueando
o horário, que é o fantasma que o comentário de `removerOcupacao` já descrevia.

A lixeira é a aba **Excluídas** da Agenda, com contagem no rótulo, e só aparece
para quem pode recuperar. **Recuperar passa pela transação**: se as cadeiras
dela foram tomadas enquanto estava excluída, ela volta com OUTRAS na mesma
quantidade (`valor.realocada` avisa, e o toast diz quais); só falha quando
não sobra a quantidade. Pedido ainda não aprovado volta sem indexar, como
nasceu.

Nem as cadeiras alocadas nem os nomes anotados são limpos na exclusão: é isso
que faz a recuperação devolver a reserva como ela era.

**Restaurar uma exceção** (devolver um encontro cancelado da recorrente)
também passa pela transação desde 05/10/2026, com as cadeiras que a regra já
tem (`fixo`): naquela data alguém pode ter reservado as mesmas cadeiras depois
do cancelamento. Antes a restauração gravava direto, sem conferir nada.

**Use os seletores `S.recorrenciasAtivas()` e `S.pontuaisAtivas()`**, nunca
`estado.recorrencias`/`estado.pontuais` direto numa tela. Os seletores já
descontam excluídas e pedidos não aprovados; eu esqueci esse filtro duas vezes
em telas que liam as coleções cruas, e o sintoma é sutil — reserva excluída
reaparecendo na tela de disciplinas, pedido pendente passando por aula
confirmada.

Distinção que o vocabulário precisa manter:
- **Cancelar ocupação** — tira UM encontro da recorrência (vira exceção, com
  motivo); numa pontual, remove o documento. Professor cancela o que é dele.
- **Encerrar recorrência** — para de hoje em diante, preserva o histórico.
- **Excluir reserva** — tira a reserva inteira da agenda, reversível, só
  coordenação.

`excluirRecorrencia` (apagava de vez, nunca teve botão) foi substituída por
`excluirReserva`, que serve recorrência e pontual.

---

## A grade da semana é proporcional

O bloco de cada ocupação é **posicionado pelo horário de início e dimensionado
pela duração** — `ALTURA_HORA` (46px) é a escala, e o bloco é absoluto dentro
da coluna do dia. Antes ele caía no balde da hora em que começava, todos do
mesmo tamanho: uma reserva de 07:40 às 11:20 parecia durar o mesmo que uma de
duas horas, e a coluna não dizia nada sobre ocupação real da clínica.

- Ocupações que se cruzam no tempo **dividem a largura** entre si
  (`disporEmColunas`), por cacho de sobreposição — um bloco solto no fim do
  dia não fica espremido por causa de dois que se cruzaram de manhã.
- **A largura da coluna sai do dia, não de uma fatia igual para todos.**
  `gradeSemana` resolve a disposição dos seis dias ANTES de montar o grid e
  escreve uma trilha por dia: `minmax(15px + pico × 104px, pico fr)`. O piso
  reserva `LARGURA_MIN_CARTAO` (104px) para cada bloco sobreposto mais o
  gutter de clique; o peso em `fr` dá a maior parte da sobra ao dia mais
  cheio. Com seis colunas iguais, cinco ocupações cruzadas numa segunda
  deixavam cada cartão com ~35px — o texto virava uma coluna de letras —
  enquanto os outros cinco dias ficavam vazios ocupando o mesmo espaço
  (relatado em 21/09/2026, com captura de tela).
- **Quando nem os pisos cabem, a grade rola na horizontal.** É por isso que
  `.wk-regua` é `position:sticky;left:0` com fundo opaco: sem isso as horas
  saem de cena junto e o bloco deixa de dizer a que horário pertence. O canto
  do cabeçalho fica preso nos dois eixos (`z-index:5`) para tapar a régua.
  Encolher o cartão para caber tudo na tela seria desfazer o conserto.
- A vista **Dia** (gantt) já era proporcional, no eixo X. Não mudou.
- A folha impressa da semana tem forma própria (gantt por dia) — ver
  "Impressão e PDF". Só a régua de horas é compartilhada.
- A primeira linha do bloco diz quantas cadeiras a reserva toma ("Clínica 1 ·
  8 cad.") — com várias reservas por clínica é o número que distingue uma da
  outra — e a descrição (onde a turma é escrita) vem numa terceira linha.

## Marcadores e filtros da agenda (05/10/2026)

Cada bloco diz, sem texto, o **tipo de ambiente** e o **tipo de reserva**:

- **Ambiente → preenchimento** (`amb-clinica`, `amb-dupla`, `amb-pre`, de
  `S.ambienteDe`): aço na clínica de atendimento; tom de agrupamento com um
  traço também na DIREITA (como chave abrangendo as duas) na reserva das duas
  clínicas; cinza neutro na pré-clínica (`--pre-*`). Sem cor nova — o Industry
  é monocromático.
- **Tipo de reserva → desenho**: ícone de traço fino (Lucide, `U.icone`) ↻
  recorrente, calendário-1 pontual, capelo na pós; a pontual mantém a borda
  tracejada (e listras por cima do tom no gantt).

Os **botões do filtro são os próprios marcadores** e fazem as vezes de legenda:
clicar esconde ou mostra aquele tipo (riscado = escondido). Junto deles,
disciplina e professor coordenador por lista. O filtro vale para Semana, Dia,
Recorrências e para a folha impressa — que diz no subtítulo que é filtrada.
`casaFiltros` recebe OCORRÊNCIA; `casaFiltrosRegra` é a mesma regra sobre o
documento da recorrência. No gantt, a pista de um agrupamento cujo ambiente o
filtro esconde inteiro some.

**Aba "Por disciplina"**: todas as reservas de UMA disciplina no semestre, numa
grade de semanas × dias (seg–sáb), com encontros, horas, cadeiras por encontro
e clínicas; embaixo a lista dos documentos (recorrências com os dias, pontuais
com a situação — pedido pendente aparece só aqui, porque não reserva). Entra
também pelo "Ver no semestre" da tela Disciplinas (`App.ir('agenda',
{ disciplinaId })`), e imprime pela folha `Impressao.disciplina`.

## Movimento — a camada que o design system não trazia

O Industry não define movimento nenhum: é um desenho técnico — canto vivo,
traço de 1px, marca de registro, e o botão primário como única peça sólida. A
camada de animação (`styles.css`, no fim) sai desse caráter, e não de um kit
genérico: **mecanismo, não bolha** — uma prancheta que recebe a folha, um
plotter que traça, um painel que acende fileira por fileira.

- **Eixo reto, e o que cresce cresce de uma BORDA.** `translateY` no toque e
  na entrada; `scaleY` do topo no bloco da agenda, `scaleX` da esquerda na
  barra do gantt e na de horas — traço saindo da caneta, nunca inflando do
  meio. Nada de rotação, elástico ou salto: a peça assenta e para, que é o que
  `--mov-encaixe` (`cubic-bezier(.2,0,0,1)`) faz.
- **A troca de tela é ENCADEADA**, e é daí que vem a evidência sem lentidão:
  uma varredura de 2px (o plotter) corre o topo do conteúdo em 420ms enquanto
  as peças entram em degraus de `--mov-passo` (55ms) — da quarta em diante
  todas juntas, porque encadear vinte cartões seria fila, não movimento.
  Tokens: `--mov-toque` 90ms, `--mov-base` 140ms, `--mov-tela` 260ms,
  `--mov-longo` 420ms.
- **O painel de cadeiras acende em varredura.** A grade tem 7 colunas fixas,
  então o degrau vai no resto da divisão por 7 (`:nth-child(7n+N)`) e o efeito
  se repete fileira a fileira. As 70 cadeiras da pré-clínica maior saem de
  graça: são 6 regras, não 70 atrasos.
- **A propriedade é sempre NOMEADA.** `transition:all` aqui pegaria `top` e
  `height` dos blocos da agenda — que são horário de início e duração — e a
  grade inteira passaria a escorregar a cada redesenho.
- **Só na TROCA, nunca em cada redesenho.** `App.ir` levanta `trocouDeTela` e
  `desenhar()` põe a classe `.troca-tela` na CASCA (`.app`), que cobre o
  cabeçalho e o `main`; `recarregar()` não. Sem isso, cada gravação — que
  remonta tudo para mostrar o toast — reanimaria a tela, e o app viraria um
  piscar constante. Ir para a rota em que já se está também não anima, e por
  isso trocar de aba dentro da Agenda (Semana/Dia) não reanima a grade.
- **O que de propósito não tem movimento**: o fantasma do arraste na agenda
  (tem de grudar no cursor; transição ali é atraso visível), a posição dos
  blocos na grade, e a folha de impressão.
- **`prefers-reduced-motion: reduce` zera tudo** — 1ms em toda animação e
  transição, atrasos zerados, o `translateY` do toque desligado e as duas
  varreduras em `display:none`, porque são decorativas e não podem nem
  piscar. É regra de acessibilidade, não preferência. Conferido com
  `chrome --headless --force-prefers-reduced-motion`.

## Lançar pelo clique na grade

A Agenda cria ocupação como um calendário: clicar no vazio abre o formulário
já preenchido. `Registro.montar(alvo, { inicial })` é o caminho — `inicial`
aceita `{ data, inicio, fim, agrupamentoId, escopo }` e **confere tudo** antes
de entrar no formulário, porque clique devolve coordenada de tela, não
garantia de que o agrupamento existe ou de que a data cabe no semestre.

- **Semana: pressiona, arrasta e solta**, como numa agenda de calendário. O
  eixo Y da coluna vira horário, encaixado em meia hora, e o **fantasma**
  mostra a faixa escolhida com os horários escritos dentro. Ele some sobre um
  bloco existente, porque ali o gesto pertence ao detalhe da ocupação.
- **Não existe mais ouvinte de `click` na coluna, e isso é de propósito.**
  Clicar sem arrastar é o arraste de comprimento zero, que a mesma conta
  resolve (vira a faixa mínima). Manter os dois abria o formulário duas vezes
  no mesmo gesto.
- A faixa arrastada é **inclusiva** do slot sob o cursor (daí o `+30`), nunca
  menor que a faixa mínima, e arrastar **para cima** vale igual — o topo é o
  menor dos dois pontos. Passar do fechamento encosta no fim e puxa o começo
  para trás, em vez de gerar uma faixa que a validação recusaria.
- Os ouvintes de `mousemove`/`mouseup` do arraste vão no **documento**, não na
  coluna: o cursor sai dela o tempo todo durante o gesto, e soltar o botão lá
  fora não pode deixar o arraste pela metade. `arrastando` é um só, de módulo,
  para as outras cinco colunas se calarem enquanto ele existe.
- `mousedown` chama `preventDefault()` e `<html>` ganha `.arrastando-agenda`
  (que desliga `user-select`): sem isso o navegador entende o gesto como
  seleção de texto e pinta meia tela de azul.
- O que **não** existe: rolagem automática quando o arraste passa do fim da
  área visível da grade. A faixa fica presa no limite, e a pessoa rola e
  ajusta o horário no formulário.
- **A faixa de 15px à direita de cada coluna é reservada e nenhum bloco a
  ocupa.** Não é margem: é o que garante alvo de clique em QUALQUER horário,
  por mais cheia que a coluna esteja. Sem ela, duas ocupações lado a lado
  tomam a largura inteira e lançar uma terceira turma naquele horário fica
  impossível — foi exatamente o que a coordenação relatou em 18/09/2026
  ("não consegui clicar na agenda e marcar").
- **O clique na semana não sabe de clínica, então o formulário escolhe a
  primeira com cadeira LIVRE naquele horário** (`primeiroEscopoLivre`,
  registro.js). Cair sempre na Clínica 1 fazia o formulário abrir já
  bloqueado sempre que ela estivesse cheia, com as outras vazias ao lado — e
  na tela isso se lê como "a agenda não deixa lançar", não como "troque de
  clínica". A quantidade ainda não foi informada nesse momento: o seletor de
  clínica mostra quantas sobram em cada uma, e é ali que a pessoa acerta.
  O pré-preenchimento vai para a PRIMEIRA linha do formulário.
- **Dia:** a pista do agrupamento dá mais: o eixo X vira horário (encaixado em
  meia hora) e o eixo Y diz qual das duas clínicas foi apontada — faixa de
  cima é escopo `a`, a de baixo é `b`. As guias horizontais levam
  `pointer-events:none`, senão o clique na linha de 1px não chega à trilha.
- **Onde não dá para criar não há affordance nenhuma.** `podeCriarEm(data)`
  cobre a mesma faixa que o formulário aceita — de hoje (ou da abertura do
  semestre) ao fim do semestre. **Hoje aceita lançamento**; o que não existe é
  cadastro retroativo, e isso é regra antiga da validação do formulário, não
  da tela.
- **Dia passado se anuncia sozinho, sem texto.** Classe `.passado` nas células
  da semana, na pista do dia e no chip do seletor: hachura diagonal de baixo
  contraste (`repeating-linear-gradient` sobre `--line-soft`, funciona nos dois
  temas) mais o cabeçalho da coluna apagado. A hachura fica ATRÁS dos blocos,
  que são opacos e seguem legíveis. Pedido explícito da coordenação: indicar
  "de forma simples e intuitiva, sem descrições" — então nada de legenda, nada
  de tooltip explicando a regra.
- O modo padrão do clique é **pontual**: dia e hora concretos descrevem uma
  atividade única. Trocar para recorrente preserva horário, dia da semana
  (vira o único dia marcado) e começo da vigência.
- A duração de partida do clique simples é a **faixa mínima**, não o turno.
  Turno é atalho do formulário, e aplicá-lo por conta própria sobrescreveria o
  horário que a pessoa acabou de apontar — mais ainda agora, que ela pode
  arrastar a duração exata que quer.

## Impressão e PDF

**Não há biblioteca de PDF, e não vai haver** — o projeto é ES5 sem bundler.
`js/impressao.js` monta um documento limpo, anexa ao `<body>` **fora de
`#raiz`** e chama `window.print()`; o CSS de impressão esconde `#raiz` e
mostra só ele. O PDF sai pelo destino "Salvar como PDF" do navegador, e
`document.title` é trocado na hora para o arquivo não sair chamado "Ocupa ·
Controle de clínicas…".

Não use `window.open`: o bloqueador de pop-up derruba sem avisar e sem deixar
a pessoa entender por que nada aconteceu.

- Quatro folhas: semana (paisagem, **gantt de uma linha por dia**), dia
  (retrato, uma tabela por agrupamento, com a coluna das cadeiras),
  recorrências (retrato) e **disciplina no semestre** (retrato, lista por mês;
  05/10/2026). O botão da Agenda imprime **a vista aberta, com o filtro
  aplicado** e dito no subtítulo; Relatórios traz semana e recorrências como
  cartão.
- **A semana impressa NÃO é a grade da tela**, e isso é decisão, não
  esquecimento. A grade reserva a altura de todas as horas do dia nas seis
  colunas: uma semana com três ocupações gastaria a folha inteira em espaço
  vazio e ainda quebraria a página no meio de uma coluna. No papel o eixo X é
  o horário e cada **linha é um dia** — o contrário do gantt diário, onde as
  linhas são os agrupamentos. A linha cresce só o quanto as faixas empilhadas
  exigirem (`faixasDoDia`), dia vazio ocupa 22pt, e `.g-linha` é indivisível
  na quebra de página. Uma semana cheia cabe numa folha; foi verificado
  gerando o PDF de verdade com Chrome headless.
- `S.janelaHoras` é a mesma da tela — o papel e a tela precisam abrir e fechar
  o dia na mesma hora. `S.baldesPorHora` **deixou de existir** em 21/09/2026:
  nem a tela nem o papel trabalham mais por hora cheia.
- **A folha se apoia em BORDA, não em fundo.** O navegador imprime sem cor de
  fundo por padrão: traço contínuo é aula recorrente, tracejado é atividade
  pontual, e "2 clínicas" vai por escrito.
- A orientação do papel entra como `<style>` com `@page` criado e descartado
  junto do documento — `@page` não aceita seletor de classe.
- A limpeza é do evento `afterprint`; o prazo de 120 s é só rede de segurança
  para o navegador que não dispara o evento, senão o título da página ficaria
  trocado para sempre.

### "Criar pulando as datas sem cadeira" — o que estava quebrado

(Até 05/10/2026 o botão se chamava "pulando as datas em conflito". Hoje ele
aparece quando faltam cadeiras em algumas datas da recorrência e, sem elas, a
MESMA alocação cabe em todas as outras — a recorrente usa as mesmas cadeiras
toda semana. Quando a falta vem de cadeiras livres em datas diferentes, que
nenhuma alocação única cobre, o botão não aparece e o aviso manda ajustar
quantidade, horário ou clínica.)

Até 18/09/2026 esse botão **nunca funcionou, e ainda derrubava o sistema**. Ele
criava a recorrência e só então chamava `cancelarOcorrencia` para cada data
pulada. Duas consequências, as duas graves:

- o resumo que vai para o índice é congelado dentro de `gravarOcupacaoNaNuvem`
  com as exceções que a regra tiver **naquele instante** — lista vazia. A
  transação revalidava contra as mesmas datas em choque que motivaram o botão
  e **sempre recusava**;
- o `cancelarOcorrencia` disparado em seguida grava
  `set({excecoes}, {merge:true})` no mesmo documento, correndo com a transação.
  Chegando primeiro, criava em `ocupacoes` um documento **só com `excecoes`** —
  sem `dias`, sem horário. Esse órfão voltava pelo onSnapshot e estourava
  TypeError em `r.dias.indexOf`, derrubando Agenda, Agora, Painel e Relatórios
  de todo mundo.

Agora as datas puladas entram **na criação**, por `dados.pular`, antes da
transação. E `ocupacaoUtil()` põe em quarentena, na entrada do estado, todo
documento de ocupação que a agenda não consegue montar — os órfãos que já
estiverem gravados somem da tela em vez de levar o resto junto.

## Sobreposição — a transação

Com duas pessoas gravando ao mesmo tempo, validar-e-gravar é condição de corrida,
e o Firestore não tem constraint de exclusão como o Postgres.

**O SDK web não aceita `transaction.get()` de consulta, só de documento.** Reler
"as ocupações da clínica naquela data" dentro da transação é impossível no
browser — isso só existe no Admin SDK.

Por isso existe `indices/{agrupamentoId}`: um documento com a forma compacta de
tudo que ocupa aquele agrupamento. A transação lê esse único documento, revalida
a sobreposição contra ele e grava índice e ocupação atomicamente. Cabe folgado
em 1 MiB.

A revalidação compara escopo (interseção de clínicas), horário e datas
concretas — expandindo recorrências e descontando exceções e encerramento.
Cobre recorrente×recorrente, pontual×pontual e recorrente×pontual. Desde
05/10/2026 o que ela protege é a CADEIRA: cada item do índice leva as
`cadeiras` que segura (ausente = o escopo inteiro, que é o item antigo), e a
transação escolhe as da reserva nova entre as que sobram — ver "Reserva por
QUANTIDADE de cadeiras".

Custo: quatro documentos quentes, um por agrupamento. Se um dia virar gargalo,
o índice se divide por mês.

---

## Acesso

Três níveis — `coordenador`, `professor`, `tecnico` — e **18 permissões** em
`acesso.js` (eram 19 até 05/10/2026: `alunos.vincular` saiu junto com a turma,
e `cadeira.ocupar` passou a significar trocar as cadeiras das próprias
reservas). "Técnico de manutenção" é só rótulo de tela. Não existe perfil
"administrador"; coordenador cumpre esse papel.

A tela Acessos também vincula o professor às disciplinas (gravado em
`disciplinas.professores`, por `acessos.editar`).

O único portão é a coleção `autorizados`, aplicada **no servidor** pelas Security
Rules. Concessão e suspensão acontecem pela tela Acessos, dentro do app.

O antigo `app/js/autorizados.js` **foi removido de propósito**. Se você sentir
vontade de recriar uma lista no código, não faça: duas fontes de verdade foi
exatamente o bug que custou caro aqui.

### Security Rules — o que está publicado

- Nada é legível ou gravável sem estar em `autorizados` com `ativo == true`.
- O nível vem sempre do banco, nunca do cliente.
- `autorizados`: criar, remover e mudar `nivel`/`ativo` → só coordenador.
  Cada pessoa atualiza o **próprio** documento, mas só os campos
  `ultimoAcesso` e `nome` (`diff().affectedKeys().hasOnly([...])`).
  Sem essa restrição de campos, um professor se promoveria a coordenador.
- `config`, `agrupamentos`, `clinicas`, `disciplinas`, `turmas`, `alunos`,
  `matriculas` → escrita só de coordenador. (É por isso que o vínculo
  professor ↔ disciplina mora em `disciplinas`: funciona sem mexer no console.)
- `manutencoes` → coordenador ou técnico.
- `ocupacoes`, `indices`, `atribuicoes` → coordenador ou professor.
  (`ocupacoes` e `indices` são gravados na mesma transação: quem escreve um
  precisa poder escrever o outro.)
- `match /{document=**}` fecha o resto.

Se uma operação legítima falhar por permissão, **ajuste a regra, não contorne
pelo código.** As regras são a única barreira real.

### Consent screen

Externo, **em produção** (publicado em 28/08/2026). Não exige verificação do
Google porque o app usa só escopos básicos, tem dois domínios autorizados e
nenhum logo. Se alguém subir um logo ou pedir escopo sensível, isso muda e cai
no processo de verificação.

Domínios autorizados no Auth: `localhost`, `ocupa-odonto.firebaseapp.com`,
`ocupa-odonto.web.app`, `controle-de-clinicas-odonto.vercel.app`.

---

## Regras de negócio a preservar

- Faixa mínima de 120 minutos
- Turnos (manhã 07:40–11:20, tarde 13:40–17:20, noite 18:20–22:00) são
  **atalho do formulário, não restrição**: preenchem início e término de uma
  vez, e a digitação livre do horário continua valendo. Vivem em
  `Dados.TURNOS`. **Vários podem ser marcados** (05/10/2026): o início é o do
  primeiro e o término o do último. A marcação do botão é derivada do horário
  no formulário, não um estado à parte — não transforme turno em campo gravado
  na ocupação
- **Toda reserva informa quantas cadeiras usa**; o sistema escolhe quais, da
  menor para a maior, e o resto da clínica segue reservável
- **Tipo da ocupação é só `graduacao` ou `pos`.** Os sete tipos antigos
  (reposicao, avaliacao, evento…) vivem em `Dados.TIPOS_LEGADOS`, fora do
  formulário: servem só para `rotuloTipoAtividade` conseguir exibir ocupação
  já gravada. Não acrescente nada lá. `aula` é o tipo fixo das recorrentes,
  que não têm campo de tipo
- **O título da ocupação é DERIVADO, não digitado**: `tipo · disciplina`, ou
  `tipo · nome de quem pediu` quando a pontual é "Outros"
  (`tituloPontual` em `store.js`); na recorrente, só a disciplina. Não recrie o
  campo de título — cada pessoa escrevia num formato diferente. O texto antigo
  sobrevive em `tituloOriginal` e aparece no detalhe da ocorrência só quando
  existe. A turma vai na descrição, nunca no título
- **Manutenção não é do professor.** Abrir chamado é coordenação ou técnico;
  encerrar, idem. O professor mantém `estrutura.ver` para saber qual cadeira
  está interditada, mas não abre registro
- Bloqueio da mesma CADEIRA em duas reservas no mesmo horário (a clínica pode
  ter várias reservas ao mesmo tempo)
- Ocupação das duas clínicas do mesmo agrupamento — **menos nas pré-clínicas**,
  que são agrupamentos de uma clínica só e por isso só se reservam sozinhas
- Numeração contínua de cadeiras nas clínicas de atendimento, 1 a 112; cada
  pré-clínica numera as suas do 1 (1–70 e 1–20)
- Cancelamento segue a matriz de `acesso.js`: professor cancela o que é dele
- Manutenção exige motivo; o impacto na capacidade é calculado automaticamente
- Com o banco vazio, o coordenador vê a tela de provisionamento; professor e
  técnico veem mensagem de espera

---

## Regras de trabalho

1. **`main` publica em produção.** Um push quebrado derruba o sistema no ar.
2. Teste em `http://localhost:3000`, que já é domínio autorizado.
3. **Valide no navegador antes de empurrar.** Checagem estática não basta:
   um `sed` já apagou uma chamada de `S.sair()` e deixou meio comentário,
   quebrando o parse do app inteiro — o balanceamento de chaves passou limpo e
   só o navegador pegou.
   `_auditoria/harness.html` existe para isso: carrega o app inteiro trocando
   só o `nuvem.js` por um dublê com acervo de mentira, e `?perfil=` entra como
   coordenador, professor ou técnico sem login e sem tocar em produção. Fora
   de `app/`, então não é publicado.
   Para conferir folha impressa, `?imprimir=semana|dia|recorrencias` monta o
   documento e o deixa no DOM. Com ele dá para gerar o PDF de verdade e ver
   quebra de página e altura real:
   `chrome --headless --print-to-pdf=saida.pdf --no-pdf-header-footer
   "http://localhost:3000/_auditoria/harness.html?imprimir=semana"`.
   O botão "ver folha impressa" promove as regras `@media print` para screen,
   para inspecionar a folha na tela com o CSS de impressão de verdade.
   `?tela=agenda&vista=semana` abre a vista pedida assim que o acervo carrega —
   o Chrome headless só sabe carregar uma URL e fotografar, e sem isso toda
   captura sai do Painel. `?denso=1` (botão "semana cheia") enche a segunda de
   ocupações cruzadas: é o único jeito de ver a largura das colunas da semana
   sob pressão, porque o acervo magro do dublê nunca faz duas disputarem espaço.
   Desde 05/10/2026 o acervo MISTURA os dois modelos, como produção: reservas
   antigas por turma e integrais, reservas novas com disciplina e cadeiras
   contadas (duas na mesma pré-clínica, no mesmo horário), e as especializações
   "Implantodontia T1/T2" para a limpeza do cadastro ter o que juntar. O
   índice da transação de mentira nasce SEMEADO com o acervo — vazio, ela não
   via choque nenhum e escondia a classe de defeito que existe para pegar.
   `?imprimir=disciplina` monta a folha da disciplina `d1`.
4. Nunca reescreva um arquivo digitando conteúdo vindo de saída de ferramenta
   (pode estar truncada). Edite in place.
5. Não semeie nem edite dados de produção pelo console do Firebase sem avisar.
   Dados de teste criados durante verificação devem ser limpos depois.
6. Segredos (token do Deploy Hook, client secret) ficam nos painéis. Não vão
   para o repositório nem para o chat.

---

## Estado atual (28/08/2026)

Funcionando e verificado ponta a ponta pela tela real: login, provisionamento,
concessão de acesso, ocupação recorrente, ocupação pontual, recusa de
sobreposição (inclusive escopo duplo) e ciclo de manutenção.

Banco no estado limpo de produção: 4 agrupamentos, 8 clínicas, `config` e dois
coordenadores — `setorbiunichristus@gmail.com` e `napa21@christus.com.br`.

Em 18/09/2026 entraram, verificados em navegador nos três perfis: lançamento
pelo clique na grade, folha de impressão/PDF e cadastro de especialização da
pós. A verificação rodou contra um `window.Nuvem` de mentira — o código de
produção inteiro, com o Firestore trocado —, e não contra o banco real: nenhum
dado de produção foi criado ou alterado.

Em 05/10/2026 entraram, verificados no harness nos três perfis (sem tocar em
produção): reserva por quantidade de cadeiras com alocação automática e troca
pelo professor; turnos múltiplos; várias ocupações pontuais num envio;
disciplina sem turma, com a turma na "Descrição/Turma"; vínculo professor ↔
disciplina pela tela Acessos; limpeza do cadastro; marcadores e filtros da
agenda; aba "Por disciplina"; e a especialidade fora dos seletores de clínica.

### Pendências

- **Rodar a limpeza do cadastro em produção** (Disciplinas → "Revisar e
  limpar", coordenação): junta "… T1/T2" no nome, grava disciplina/professor
  nas reservas antigas e o vínculo dos professores. Até lá tudo funciona pelo
  legado embutido (`S.disciplinaIdDe` etc.), mas as disciplinas com "T" no nome
  continuam separadas
- **Vincular os professores às disciplinas em Acessos**: só os que eram
  coordenadores de turma herdam o vínculo; os demais veem só "Outros" no
  formulário até a coordenação vincular
- As reservas anteriores a 05/10/2026 seguem INTEGRAIS (clínica inteira) até
  alguém ajustar as cadeiras delas em "Alterar cadeiras"
- Trocar o e-mail de contato de `privacidade.html`, `termos.html` e do consent
  screen por um endereço institucional, quando houver
- Revisão jurídica das duas páginas pela Christus
- E-mail de anúncio para a coordenação (Andréa Galvão, Filipe Frota, Murilo)
- Remover a branch `feat/lista-de-acessos`
