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
registro.js  manutencao.js  impressao.js  painel.js  agora.js  agenda.js
disciplinas.js  relatorios.js  estrutura.js  acessos.js  app.js
```

`impressao.js` vem antes das views porque Agenda e Relatórios chamam as duas.

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
  `atribuicoes` e `matriculas`.

Efeito colateral desejado: perder o acesso durante a sessão derruba a pessoa na
hora, pelo snapshot de `autorizados`.

**Não transforme as leituras em promessas.** O volume é minúsculo (8 clínicas,
112 cadeiras, um semestre) e o custo do refactor seria o app inteiro.

---

## Modelo de dados

| Coleção | Id do documento | Campos |
|---|---|---|
| `config` | `sistema` (doc único) | `versao`, `periodoLetivo`, `semestre{inicio,fim}`, `parametros{faixaMinimaMin, capacidadeSemanalH, bloquearSobreposicao, exigirMotivoManutencao, exigirAprovacaoProfessor, aberturaPadrao, fechamentoPadrao}` |
| `autorizados` | e-mail em minúsculas | `nome`, `nivel`, `ativo`, `ultimoAcesso` |
| `agrupamentos` | `ag1`–`ag4` | `nome`, `clinicas[]` |
| `clinicas` | `cl1`–`cl8` | `nome`, `agrupamentoId`, `especialidade`, `cadeiras`, `primeiraCadeira`, `abertura`, `fechamento` |
| `disciplinas` | auto | `codigo`, `nome`, `nivel` (`graduacao` \| `pos`) |
| `turmas` | auto | `disciplinaId`, `codigo`, `professorCoordenadorId`, `periodoLetivo` |
| `alunos` | auto | `nome`, `matricula`, `periodo` |
| `matriculas` | `{turmaId}__{alunoId}` | `turmaId`, `alunoId` |
| `ocupacoes` | auto | `tipo`, `agrupamentoId`, `escopo`, `inicio`, `fim`, `criadoPor`, `criadoEm`, `excecoes[]`, `excluidaEm`, `excluidaPor`, `motivoExclusao` · recorrente: `turmaId`, `dias[]`, `vigenciaInicio`, `vigenciaFim`, `periodoLetivo`, `encerradaEm`, `observacao` · pontual: `data`, `tipoAtividade`, `descricao`, `turmaId`, `responsavelId`, `situacao`, `motivoRecusa`, `decididoPor`, `decididoEm` (mais `titulo` só nas gravadas antes de 17/09/2026) |
| `manutencoes` | auto | `protocolo`, `clinicaId`, `cadeira`, `categoria`, `criticidade`, `motivo`, `abertoPor`, `abertoEm`, `previsaoRetorno`, `status`, `fechadoPor`, `fechadoEm`, `laudo`, `impacto{}` |
| `atribuicoes` | auto | `chave`, `clinicaId`, `cadeira`, `nome`, `alunoId` (nulo nos registros novos), `data`, `registradoPor`, `registradoEm` |
| `indices` | `ag1`–`ag4` | `agrupamentoId`, `itens[]` |

**Não existe coleção `cadeiras`.** Cadeira é derivada de `primeiraCadeira` +
`cadeiras` da clínica. O estado de uma cadeira vive em `manutencoes` e
`atribuicoes`.

**Reserva é sempre integral, e `ocupacoes.cadeiras` não existe mais.** Reservar
uma clínica reserva as 14 cadeiras dela; escopo duplo reserva as 28. O número
é DERIVADO do escopo (`capacidadeEscopo`) na montagem da ocorrência, e o valor
gravado nos documentos antigos é ignorado — ocupação que reservava 10 de 14
passa a valer como clínica inteira. Não recrie o campo de quantidade no
formulário, e não leia `r.cadeiras`/`p.cadeiras` do documento cru: vem
`undefined` nos registros novos.

Disso decorre que **não existe cadeira "livre" dentro de clínica reservada**.
`statusCadeira` só devolve `manut`, `ocupada` (uso registrado) ou `vaga`
(reservada, ninguém registrou ainda).

**Quem mede ocupação é `atribuicoes`, não a reserva.** Registrar cadeira em uso
não depende de aluno cadastrado: o professor marca a cadeira e escreve o nome
em texto livre, opcional (`nome`), como quem abre um chamado de manutenção.
`alunoId` continua no modelo por causa dos registros antigos e vem `null` nos
novos — use `S.nomeNaCadeira(atrib)`, que resolve aluno cadastrado, nome livre
ou "sem identificação". O CSV semanal tem as duas colunas separadas, e é
"Cadeiras em uso" que significa algo: "Cadeiras reservadas" é sempre 14 ou 28.
Por isso `calcularImpacto` compara o uso registrado com o que resta operante —
comparar com a reserva marcaria toda ocupação como afetada por qualquer
interdição.

O store traduz `autorizados.nivel` para `perfil` na hidratação; as views não
sabem da diferença.

### Pós-graduação — especialização sem disciplina e sem turma

A pós não trabalha com código de disciplina nem com identificador de turma:
uma **especialização** é o nome dela mais o professor responsável, e é só isso
que a aba **Pós-graduação** (em Disciplinas) pede.

Por baixo ela é gravada nas coleções que já existem — uma `disciplina` com
`nivel: 'pos'` e **uma** `turma` criada pelo sistema, com `codigo: 'PÓS'`, que
o formulário nunca mostra. Duas razões:

- a reserva **recorrente** aponta para uma turma, e é de
  `turma.professorCoordenadorId` que sai o `responsavelId` da ocupação — quem
  governa quem pode cancelar. Sem turma a especialização só conseguiria
  lançar atividade pontual, que não é o caso de uso;
- coleção nova (`especializacoes`) exigiria **publicar Security Rule nova no
  console antes de funcionar** — até lá o `match /{document=**}` recusaria
  toda gravação. Mudança que só funciona depois de alguém mexer no console
  não pode ir para `main`.

### O vínculo da atividade PONTUAL

O campo de vínculo do formulário pontual segue o campo **Tipo**, e só existe
assim no modo pontual:

| Tipo | Rótulo do campo | O que lista |
|---|---|---|
| Graduação | "Turma vinculada" | turmas da graduação + **Outros** |
| Pós-graduação | "Especialização" | especializações + **Outros** |

- Trocar o Tipo chama `desenhar()`, não `atualizar()`: é o tipo que decide a
  lista e o rótulo. `ajustarVinculo()` reencaixa a escolha anterior — turma da
  graduação selecionada não pode sobreviver à troca para pós, senão o select
  exibe um valor que a lista não contém, que é o campo em branco que se quer
  evitar.
- **O vínculo é obrigatório e "Outros" é resposta válida.** `SEM_VINCULO` vale
  `'outros'` e **nunca chega ao Firestore**: `vinculoGravavel()` o traduz para
  `null`. O padrão é a primeira opção do tipo, ou "Outros" quando não há
  nenhuma — o campo nunca nasce vazio.
- A dica do campo Tipo troca "turma" por "especialização" junto com o resto.
- **O modo recorrente não se divide**: a lista lá continua única, com
  graduação e pós juntas, porque a reserva recorrente da pós aponta para a
  turma que o sistema mantém. Separar ali deixaria a pós sem como ocupar
  clínica toda semana, e não existe "Outros" na recorrente — sem turma não há
  de quem herdar o professor coordenador que responde pela reserva.

Consequências para quem mexer aqui:

- **Use os seletores.** `S.especializacoes()`, `S.disciplinasDeGraduacao()` e
  `S.turmasDeGraduacao()` — ler `estado.disciplinas`/`estado.turmas` cru faz a
  turma interna da pós vazar para as listas da graduação, onde ela não tem
  código para exibir, não recebe aluno e não é editável.
- **Rotule pelo Store.** `S.rotuloTurma` devolve o NOME da especialização na
  pós e `d.codigo + ' ' + t.codigo` na graduação; `S.rotuloTurmaLongo` e
  `S.subtituloTurma` seguem a mesma regra. Montar rótulo com `d.codigo` na mão
  imprime `POS-01 PÓS` na agenda — e ainda estoura se a disciplina tiver sido
  apagada por fora.
- `codigo` da especialização é gerado (`POS-01`, `POS-02`…) só porque o
  documento e as colunas de CSV anteriores à pós contam com ele.
- Excluir especialização é em cascata: a turma sai primeiro, porque é
  `excluirTurma` que tira as recorrências do índice de sobreposição.
- Disciplina **sem** `nivel` é da graduação — é o estado de tudo que foi
  gravado antes de 18/09/2026.

**Disciplina da graduação tem só `codigo` e `nome`.** `especialidade` é da CLÍNICA e não tem
relação nenhuma com disciplina. O arquivo com mais ocorrências da palavra é
`relatorios.js` — três colunas "Especialidade" em CSV, todas de clínica e
nenhuma delas precisa mudar: nunca faça busca-e-substitui global lá.
Disciplinas criadas antes de 14/09/2026 ainda carregam `especialidade` e
`cargaHoraria` no documento do Firestore. `salvarDisciplina` deixou de enviá-los,
mas como a gravação é `set(..., {merge:true})` isso **não os apaga** — são lixo
inerte, que nada lê. Limpar de verdade exigiria `FieldValue.delete()`.

**`responsavelId` aparece na tela como "Professor coordenador".** O campo guarda
quem responde pela ocupação: na recorrente o store o copia de
`turma.professorCoordenadorId`; na pontual é quem registrou, que pode não ser o
coordenador da turma vinculada. O rótulo é único em todas as telas desde
14/09/2026 — não volte a alternar para "Responsável", e não renomeie o campo,
que governa quem pode cancelar (`agenda.js`, `agora.js`, `painel.js`).
Cuidado: `acesso.js` descreve o perfil Técnico como "Responsável pelas cadeiras"
— ali é adjetivo comum, não este campo.

---

## Aprovação de pedidos

Com `parametros.exigirAprovacaoProfessor` ligado (o padrão — **ausência do
campo também vale como ligado**), ocupação criada por professor nasce
`situacao: 'pendente'`: é pedido, não reserva. A coordenação aprova ou recusa
pela fila no Painel; `agenda.aprovar` é a permissão, só do coordenador. O
próprio autor pode retirar o pedido enquanto ninguém decidiu.

**Pedido não segura horário.** Ele não entra em `indices/{agrupamentoId}`,
então vários professores podem pedir o mesmo horário. É a **aprovação** que
passa pela transação e pode falhar por choque — e aí a coordenação vê a
mensagem. Por isso o formulário avisa, com todas as letras, que pedir não
reserva.

O filtro que sustenta tudo isso é uma linha em `ocorrenciasDoDia`: pontual com
`situacao` diferente de `'aprovada'` é descartada ali. Como essa função é o
funil único de Agenda, Agora, Painel, relatórios e `conflitos`, filtrar ali
cobre o sistema inteiro. A fila lê `estado.pontuais` direto, por fora do funil.

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
para quem pode recuperar. **Recuperar passa pela transação e pode falhar por
choque** — enquanto a reserva estava excluída o horário estava livre, e alguém
pode ter ocupado. Falhar aí é o comportamento correto. Pedido ainda não
aprovado volta sem indexar, como nasceu.

As atribuições de cadeira **não** são limpas na exclusão: é isso que faz a
recuperação devolver a reserva como ela era, com os registros de uso.

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
- `S.baldesPorHora` **não serve mais à tela**, só à folha impressa, que é uma
  tabela de linhas de hora. `S.janelaHoras` continua servindo às duas: a tela
  e o papel precisam abrir e fechar o dia na mesma hora.
- A vista **Dia** (gantt) já era proporcional, no eixo X. Não mudou.

## Lançar pelo clique na grade

A Agenda cria ocupação como um calendário: clicar no vazio abre o formulário
já preenchido. `Registro.montar(alvo, { inicial })` é o caminho — `inicial`
aceita `{ data, inicio, fim, agrupamentoId, escopo }` e **confere tudo** antes
de entrar no formulário, porque clique devolve coordenada de tela, não
garantia de que o agrupamento existe ou de que a data cabe no semestre.

- **Semana:** o eixo Y da coluna do dia vira horário, encaixado em meia hora.
  Um **fantasma** segue o cursor mostrando onde o bloco vai cair e que tamanho
  vai ter — é ele o convite para clicar, e ele some sobre um bloco existente,
  porque ali o clique pertence ao detalhe da ocupação.
- **A faixa de 15px à direita de cada coluna é reservada e nenhum bloco a
  ocupa.** Não é margem: é o que garante alvo de clique em QUALQUER horário,
  por mais cheia que a coluna esteja. Sem ela, duas ocupações lado a lado
  tomam a largura inteira e lançar uma terceira turma naquele horário fica
  impossível — foi exatamente o que a coordenação relatou em 18/09/2026
  ("não consegui clicar na agenda e marcar").
- **O clique na semana não sabe de clínica, então o formulário escolhe a
  primeira LIVRE naquele horário** (`primeiroEscopoLivre`, registro.js). Cair
  sempre na Clínica 1 fazia o formulário abrir já bloqueado por choque sempre
  que ela estivesse ocupada, com as outras sete vazias ao lado — e na tela
  isso se lê como "a agenda não deixa lançar", não como "troque de clínica".
  Quando todas estão ocupadas, abre na primeira mesmo e o aviso de choque é a
  resposta certa.
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
- A duração de partida é a **faixa mínima**, não o turno. Turno é atalho do
  formulário, e aplicá-lo por conta própria sobrescreveria o horário que a
  pessoa acabou de apontar.

## Impressão e PDF

**Não há biblioteca de PDF, e não vai haver** — o projeto é ES5 sem bundler.
`js/impressao.js` monta um documento limpo, anexa ao `<body>` **fora de
`#raiz`** e chama `window.print()`; o CSS de impressão esconde `#raiz` e
mostra só ele. O PDF sai pelo destino "Salvar como PDF" do navegador, e
`document.title` é trocado na hora para o arquivo não sair chamado "Ocupa ·
Controle de clínicas…".

Não use `window.open`: o bloqueador de pop-up derruba sem avisar e sem deixar
a pessoa entender por que nada aconteceu.

- Três folhas: semana (paisagem, a grade da aba Agenda), dia (retrato, uma
  tabela por agrupamento) e recorrências (retrato). O botão da Agenda imprime
  **a vista aberta**; Relatórios traz as duas primeiras como cartão.
- A grade impressa usa `S.janelaHoras` e `S.baldesPorHora` — as mesmas da
  tela. As duas moram no Store justamente por isso: cópia em cada lado
  divergiria na primeira clínica que mudasse de horário, e a folha passaria a
  mostrar uma semana que não é a que está na tela.
- **A folha se apoia em BORDA, não em fundo.** O navegador imprime sem cor de
  fundo por padrão: traço contínuo é aula recorrente, tracejado é atividade
  pontual, e "2 clínicas" vai por escrito.
- A orientação do papel entra como `<style>` com `@page` criado e descartado
  junto do documento — `@page` não aceita seletor de classe.
- A limpeza é do evento `afterprint`; o prazo de 120 s é só rede de segurança
  para o navegador que não dispara o evento, senão o título da página ficaria
  trocado para sempre.

### "Criar pulando as datas em conflito" — o que estava quebrado

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
Cobre recorrente×recorrente, pontual×pontual e recorrente×pontual.

Custo: quatro documentos quentes, um por agrupamento. Se um dia virar gargalo,
o índice se divide por mês.

---

## Acesso

Três níveis — `coordenador`, `professor`, `tecnico` — e **19 permissões** em
`acesso.js`. "Técnico de manutenção" é só rótulo de tela. Não existe perfil
"administrador"; coordenador cumpre esse papel.

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
  `matriculas` → escrita só de coordenador.
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
  `Dados.TURNOS`. A marcação do botão é derivada do horário no formulário, não
  um estado à parte — não transforme turno em campo gravado na ocupação
- **Tipo da ocupação é só `graduacao` ou `pos`.** Os sete tipos antigos
  (reposicao, avaliacao, evento…) vivem em `Dados.TIPOS_LEGADOS`, fora do
  formulário: servem só para `rotuloTipoAtividade` conseguir exibir ocupação
  já gravada. Não acrescente nada lá. `aula` é o tipo fixo das recorrentes,
  que não têm campo de tipo
- **O título da ocupação é DERIVADO, não digitado**: `tipo · turma`, ou
  `tipo · nome de quem pediu` quando não há turma vinculada
  (`tituloPontual` em `store.js`). Não recrie o campo de título — cada pessoa
  escrevia num formato diferente. O texto antigo sobrevive em `tituloOriginal`
  e aparece no detalhe da ocorrência só quando existe
- **Manutenção não é do professor.** Abrir chamado é coordenação ou técnico;
  encerrar, idem. O professor mantém `estrutura.ver` para saber qual cadeira
  está interditada, mas não abre registro
- Bloqueio de sobreposição na mesma clínica
- Ocupação das duas clínicas do mesmo agrupamento
- Numeração contínua de cadeiras, 1 a 112
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

### Pendências

- Trocar o e-mail de contato de `privacidade.html`, `termos.html` e do consent
  screen por um endereço institucional, quando houver
- Revisão jurídica das duas páginas pela Christus
- E-mail de anúncio para a coordenação (Andréa Galvão, Filipe Frota, Murilo)
- Remover a branch `feat/lista-de-acessos`
