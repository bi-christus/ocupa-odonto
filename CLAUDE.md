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
registro.js  manutencao.js  painel.js  agora.js  agenda.js
disciplinas.js  relatorios.js  estrutura.js  acessos.js  app.js
```

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
| `disciplinas` | auto | `codigo`, `nome` |
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

**Disciplina tem só `codigo` e `nome`.** `especialidade` é da CLÍNICA e não tem
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

### Pendências

- Trocar o e-mail de contato de `privacidade.html`, `termos.html` e do consent
  screen por um endereço institucional, quando houver
- Revisão jurídica das duas páginas pela Christus
- E-mail de anúncio para a coordenação (Andréa Galvão, Filipe Frota, Murilo)
- Remover a branch `feat/lista-de-acessos`
