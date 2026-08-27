# PLANO DE RECONSTRUÇÃO — Sistema de controle de ocupação de clínicas

Base verificada nesta sessão: `dados.js:52-55` tem só `cl1`/`cl2`; `dados.js:234` `versao: 3`; `store.js:7` `CHAVE='ocupa.odonto.v3'`; `store.js:19` `s.versao === 3`; `store.js:127/132` filtram por igualdade de `clinicaId`; `store.js:82-85` `cadeirasOperantes`; `store.js:188-190` `excedeCapacidade`; `ui.js:78-84` `opcoesHora` de 30 em 30; `app/styles.css:1` importa Barlow 600 e Condensed 700 (o DS, linha 2, não importa nenhum dos dois); mockup `SALAS` em `.dc.html:653-658`. Raiz real: `C:/Users/LON7/Desktop/Sistema de controle de clínicas` (com í).

---

## FASE 0 — Decisões do usuário (bloqueiam trabalho; resolver ANTES de escrever código)

Nenhuma delas é achado técnico; todas travam uma fase inteira.

| # | Decisão | O que trava | Opções |
|---|---|---|---|
| D1 | **Como o app será servido.** Google Identity Services recusa origem `null`; `file://` é incompatível com SSO. | Toda a FASE 5 (SSO). Determina se `dist/` continua existindo. | (a) http(s) — `python -m http.server` em dev + host estático no domínio institucional em prod; (b) abrir mão do SSO e manter login local. Sem (a), o requisito 9 não é implementável. |
| D2 | **Destino de `dist/index.html`** (52 KB, bundle gzip+base64, sem script gerador versionado no repo). | FASE 6. | (a) apagar agora e regerar só quando existir `tools/build.js`; (b) manter e reescrever o bundler. Recomendado: (a). O `.zip` na Desktop está FORA da raiz — é backup do usuário, **não apagar**. |
| D3 | **Faixa mínima de ocupação: 60 min (app) ou 2 h (mockup)?** | `dados.js:238`, validação `registro.js:219-221`, painel de parâmetros. | Mockup exige 2 h (`.dc.html:807`). O seletor de `estrutura.js:193` já oferece 30/60/90/120 — muda só o default. |
| D4 | **Histórico de atribuições aluno×cadeira: relatório ou lixo?** | Poda do `estado.atribuicoes` (cresce sem limite; hoje ninguém exporta). | É o dado mais valioso para prestação de contas. Se virar relatório, não podar; se não, podar para chave `.hist`. |
| D5 | **Edição de ocupação já registrada existe?** | `atualizarRecorrencia`/`atualizarPontual` (hoje sem chamador). | (a) criar tela de edição; (b) remover as duas do export. Sem decisão, ficam código morto com superfície de escalonamento. |
| D6 | **Cores semânticas** `--warn/--danger/--ok` (3 hex fora de qualquer rampa do DS). | `styles.css:15-16`; badges de estrutura/painel. | (a) eliminar e usar os papéis do mockup (fill-strong/fill-soft/line-soft); (b) manter e documentar como extensão no readme do DS. |
| D7 | **Domínio institucional real** e onde mora a lista de e-mails autorizados. | FASE 5 inteira. `odonto.edu.br` e `unipolo.edu.br` são ambos fictícios. | Se a lista ficar em `localStorage`, a autorização continua adulterável — decidir se aceita isso ou se haverá `app/js/autorizados.js` servido à parte. |
| D8 | **Vínculo aluno↔cadeira fixa** (coluna "Cadeira" na tabela de alunos do mockup) entra no escopo? | `disciplinas.js:160-183`. | Requisito não pedido explicitamente pelo usuário; existe no mockup. |
| D9 | **"Encerrar semestre"** e **sino de notificações** entram no escopo? | `disciplinas.js:19-31`, `app.js:138-173`. | Ambos existem no mockup e não constam dos 9 requisitos. |

---

## FASE 1 — Modelo de dados (RAIZ; quase tudo depende)

> Sem esta fase, **nada** das fases 2, 3 e 4 pode ser aplicado. Aplicar em um único commit: `dados.js` + `store.js`, com o app quebrado no meio (as views só voltam a funcionar na FASE 3).

### 1.1 `app/js/dados.js`

**M1 — Reconstruir a estrutura do mockup (4 agrupamentos / 8 clínicas / 112 cadeiras).**
Substituir `dados.js:51-55`. Nomenclatura: agrupamento = `"Clínicas N e M"` (a palavra *sala* não pode aparecer em lugar nenhum).

```js
var agrupamentos = [
  { id:'ag1', nome:'Clínicas 1 e 2', clinicas:['cl1','cl2'] },
  { id:'ag2', nome:'Clínicas 3 e 4', clinicas:['cl3','cl4'] },
  { id:'ag3', nome:'Clínicas 5 e 6', clinicas:['cl5','cl6'] },
  { id:'ag4', nome:'Clínicas 7 e 8', clinicas:['cl7','cl8'] }
];
// clínicas: id cl1..cl8, nome 'Clínica N', agrupamentoId, especialidade,
// cadeiras:14, primeiraCadeira: k*14+1 (k = 0..7), abertura/fechamento.
```
Especialidades na ordem exata do mockup (`.dc.html:654-657`), que é a mesma de `ESPECIALIDADES` em `dados.js:28-29`: Dentística, Periodontia, Endodontia, Prótese, Odontopediatria, Cirurgia, Ortodontia, Clínica Integrada. `primeiraCadeira` é derivado de `cadeirasDe(idx)=[idx*14+1, idx*14+14]` (`.dc.html:677`), com idx GLOBAL 0..7.

**M2 — Expor `agrupamentos` no estado.** Acrescentar a chave ao `return` de `semente()` (`dados.js:244`, ao lado de `clinicas`).

**M3 — Bump de versão.** `dados.js:234` → `versao: 4`. Sem isso, quem já abriu o app continua com 2 clínicas e o app estoura ao ler `estado.agrupamentos`. Par obrigatório com M14.

**M4 — Redistribuir o plano de recorrências** (`dados.js:134-145`, hoje só `cl1`/`cl2`). Usar `agrupamentoId` + `escopo` (`'a'|'b'|'ambas'`). Incluir **pelo menos uma regra com `escopo:'ambas'`**, que hoje não é exercitada.
⚠️ `dados.js:160` faz `recorrencias[8].excecoes.push(...)` — índice fixo. Ao reordenar o plano, trocar por busca pela regra (filtrar por `turmaId` de ODO-490 T2), senão a exceção cai na regra errada ou estoura.

**M5 — Redistribuir as pontuais** (`dados.js:166-199`, `clinicaId` em `:168, :176, :184, :192`). Respeitar a coerência de especialidade: p0 (ODO-490, Clínica Integrada) → Clínica 8 → `ag4`, e é o exemplo natural de escopo `ambas`; p2 (ODO-433, Endodontia) → Clínica 3 → `ag2`.

**M6 — Manutenções em numeração GLOBAL** (`dados.js:202-212`). `m0` Clínica 1 cadeira 3 → **3**; `m1` Clínica 2 cadeira 7 → **21**; `m2` Clínica 2 cadeira 11 → **25**. Espalhar mais 2-3 pelas clínicas 4-8 (ex.: 57 na Clínica 5, 104 na Clínica 8). **Contrato novo, válido em todo o app:** `m.cadeira` é sempre global; posição local = `m.cadeira - clinica.primeiraCadeira + 1`.

**M7 — Faixa mínima:** aplicar D3 em `dados.js:238`.

**M8 — Parâmetro morto:** `exigirMotivoManutencao` (`dados.js:240`) nunca é lido. Ou passa a ser lido em `abrirManutencao` (ver Q6), ou é removido — mas `estrutura.js:166` exibe "obrigatório" fixo e mente hoje.

### 1.2 `app/js/store.js`

**M9 — Seletores canônicos** (inserir junto de `clinica()`/`nomeClinica()`, `store.js:48-49`; exportar todos em `global.Store`, `store.js:511-541`):
```
agrupamento(id) · nomeAgrupamento(id) · clinicasDoAgrupamento(id)
agrupamentoDaClinica(clinicaId) · faixaCadeiras(clinicaId) · faixaAgrupamento(id)
clinicaDaCadeira(numeroGlobal) · clinicasDoEscopo(agId, escopo)
rotuloEscopo(agId, escopo)  → "Clínica 3" | "Clínicas 5 e 6 (28 cadeiras)"
localCadeira(numeroGlobal)  → "Clínicas 3 e 4 · Clínica 4 · cadeira 51"
capacidadeEscopo(agId, escopo) · cadeirasOperantesEscopo(agId, escopo)
posicaoNoEscopo(occ, numeroGlobal)  → índice 0-based, ou -1
```
`rotuloEscopo` e `localCadeira` são os dois helpers que eliminam ~15 concatenações espalhadas pelas views.

**M10 — Ocupação passa a ter `agrupamentoId` + `escopo`** no lugar de `clinicaId` escalar. Tocar: `ocorrenciaDeRegra` (`store.js:88-102`), `ocorrenciaDePontual` (`:103-117`), `criarRecorrencia` (`:196`), `criarPontual` (`:213`). Equivale ao `{sala, metades}` do mockup (`.dc.html:735`), com `metades` `[0]|[1]|[0,1]`.
⚠️ `atualizarRecorrencia` (`store.js:228`) tem `'clinicaId'` na lista branca → trocar por `'agrupamentoId','escopo'`, senão a edição grava campo morto. `atualizarPontual` (`:234-239`) copia qualquer chave — ver P7.

**M11 — `ocorrenciasDoDia` filtra por escopo, não por igualdade.** `store.js:127` e `:132` viram um teste de interseção; a ordenação de `store.js:136` (`a.clinicaId.localeCompare`) usa campo que deixa de existir. Propagar a nova assinatura de filtro (`{clinicaId} | {agrupamentoId}`) para `ocorrenciasIntervalo` (`:140-148`) e `calcularImpacto` (`:312`), que repassam o argumento sem tratar.

**M12 — `conflitos` por interseção de escopo.** `store.js:175-185`. Equivalente do mockup: `r.metades.some(m => metades.includes(m))` (`.dc.html:807`). Único chamador: `registro.js:241`. Hoje, registrar 28 cadeiras por cima de uma aula existente não gera choque.

**M13 — `excedeCapacidade(agrupamentoId, escopo, cadeiras)`** usando `cadeirasOperantesEscopo` (`store.js:188-190`). Sem isso o requisito 8 é impossível: qualquer pedido acima de 14 é rejeitado.

**M14 — Chave e versão do localStorage.** `store.js:7` → `'ocupa.odonto.v4'`; `store.js:19` → `s.versao === 4`. Par obrigatório com M3. Sem migração — a semente reconstruída roda na primeira abertura.

**M15 — `cadeirasOperantes`: deduplicar por cadeira.** `store.js:82-85` faz `c.cadeiras - manutencoesAbertas(clinicaId).length`; dois registros abertos na mesma cadeira descontam duas cadeiras. Contar cadeiras **distintas**. (A função não está errada quanto à numeração — filtra por `m.clinicaId` e independe dela.)

**M16 — `cadeiraEmManutencao(clinicaId, numero)` recebe SEMPRE número global.** Fixar por contrato; chamadores a ajustar na FASE 3: `agora.js:33`, `:120`, `:186`; `estrutura.js:64`, `:85`, `:111`.

**M17 — `historicoCadeira(numeroGlobal)`**, filtrando só por `m.cadeira` (`store.js:360-364`; o `clinicaId` vira redundante, a faixa determina a clínica). Ajustar `agora.js:247` e `manutencao.js:78`.

**M18 — Atribuição de cadeira em número global.** `ocuparCadeira` (`store.js:284-292`) e `atribuicaoDaCadeira` (`:279-283`). Colisão real hoje: cadeira 7 da Clínica 1 e cadeira 7 da Clínica 2 gravam ambas `cadeira=7` sob a mesma chave numa ocupação conjunta. Equivalente do mockup: `vagas.push(m*14+n)` (`.dc.html:682`). Ajustar chamadores `agora.js:35, :209, :226, :282`.

**M19 — `horasSemana` pondera pelo nº de clínicas ocupadas.** `store.js:460-464`; mockup: `(r.fim - r.inicio) * r.metades.length` (`.dc.html:940`). Exibido no KPI `painel.js:33`.

**M20 — `horasPorClinica`** (`store.js:465-472`) passa a somar corretamente **de graça** depois de M11 (a ocorrência `ambas` aparece nas duas clínicas). Acrescentar `horasPorAgrupamento(ini)` para o painel poder mostrar as 4 barras de agrupamento.
⚠️ `cadeirasEmUsoAgora` (`store.js:488-495`) contará duas vezes a ocupação de escopo duplo se não dividir as cadeiras entre as duas clínicas.

**M21 — Bloquear alteração do nº de cadeiras.** Remover `'cadeiras'` da lista branca de `atualizarClinica` (`store.js:439`); a linha `m.cadeira > c.cadeiras` (`:444`) só faz sentido em numeração local — reescrever como `m.cadeira > faixaCadeiras(id)[1]` ou eliminar. 14 cadeiras por clínica é invariante do modelo (mockup: `cadeirasDe` é função fixa). Par com V10.

**M22 — Capacidade por faixa de horário.** `excedeCapacidade` compara com o total da clínica, não com o que já está comprometido no mesmo horário. Com `bloquearSobreposicao:false` (`estrutura.js:196-198`) dá para gravar duas ocupações de 14 cadeiras na mesma clínica de 14. Criar `cadeirasComprometidas(agId, escopo, data, ini, fim)` varrendo os **pontos de corte** (inícios e fins) e checando o pico — não somando ocorrências inteiras. **Rodar sempre**, não só quando a sobreposição está liberada: com escopo duplo o cálculo passa a ser necessário nos dois modos. Pré-requisito do requisito 8.

**M23 — Cadeiras interditadas dentro da faixa reservada.** Com a cadeira 3 da Clínica 1 em manutenção e aula de 10 cadeiras, a grade pinta 9 vagas para 10 alunos e o cabeçalho anuncia capacidade cheia. **Não deslocar a faixa** (quebraria a numeração global do requisito 1) — mostrar o déficit em `agora.js:84-90` e usar a mesma contagem em `excedeCapacidade`, para avisar já no formulário.

**M24 — Vigência limitada ao semestre.** `criarRecorrencia`/`atualizarRecorrencia` devem clampar `vigenciaFim` a `estado.semestre.fim` e `vigenciaInicio` a `.inicio`. Hoje a agenda gera encontros depois do fim do semestre enquanto a prévia (`registro.js:255`) e o CSV (`relatorios.js:135`) mostram um total menor, cortado pela guarda de 400 iterações de `datasDaRegra` (`store.js:151-161`) e `ocorrenciasIntervalo` (`:143`). A guarda é blindagem (semestre = 123 dias), o clamp é o conserto.

**M25 — `atualizarSemestre` reajusta as recorrências.** `store.js:455-457` não toca em nada. Esticar o semestre deixa as turmas sem encontros no trecho novo; encurtar deixa encontros fantasmas — o oposto do requisito 2. Ao gravar: recorrências não encerradas cuja `vigenciaFim` casava com o fim anterior acompanham o novo fim; clampar as demais. Confirmar no modal (`estrutura.js:203-208`) dizendo quantas serão reajustadas.

**M26 — Encerramento de recorrência: semântica.** `store.js:125` filtra `data > r.encerradaEm` (estritamente maior), então o encontro do próprio dia sobrevive, contrariando o texto "de hoje em diante" (`agenda.js:262-266`). Trocar para `data >= r.encerradaEm` (`encerradaEm` = primeiro dia inválido).
Efeitos colaterais obrigatórios no mesmo commit: `agenda.js:196-198` e `disciplinas.js:127` passam a exibir um dia a mais → usar `C.addDays(r.encerradaEm,-1)`; e a exceção de `agenda.js:373` vira redundante → remover.

**M27 — `encontrosRestantes(r, deISO)`.** `datasDaRegra` não consulta `r.excecoes`, então a coluna "Restantes" (`agenda.js:197`) conta encontros cancelados; `relatorios.js:135` erra no outro sentido com a subtração ingênua `- r.excecoes.length`. Criar o seletor usando `fimEfetivo` (menor entre `encerradaEm` e `vigenciaFim`) — `encerradaEm` pode ser maior que `vigenciaFim` e estender a contagem.

**M28 — `carregar()` valida o formato.** `store.js:16-21` aceita qualquer objeto com a versão certa. Checar presença de `clinicas`, `agrupamentos`, `recorrencias`, `pontuais`, `usuarios`, `parametros`; se faltar, guardar o bruto em `ocupa.odonto.v4.corrompido` e semear.

**M29 — `salvar()` retorna boolean e distingue `QuotaExceededError`.** `store.js:26-28` engole tudo, e `commit()→emitir()` segue exibindo o toast de sucesso com nada persistido. Reverter o `push` de `ocuparCadeira` quando falhar.

**M30 — Semana de 7 dias vs 6.** `store.js:461` e `:466` usam `addDays(ini,6)` (7 dias, inclui domingo) enquanto `relatorios.js:103/112` usam `addDays(seg,5)` (6 dias) — o CSV mistura horas de 7 dias com contagem de 6 na mesma linha, e `painel.js:33` conflita com o rótulo de `painel.js:156`. Padronizar em seg–sáb.

**M31 — `assinar`/`emitir`/`ouvintes` mortos** (`store.js:10, 34-35`). São **34** chamadas manuais de `global.App.recarregar()` nas views (acessos 4, agenda 9, agora 6, disciplinas 6, estrutura 7, painel 2). **Não** ligar `S.assinar(desenhar)`: `commit()` é chamado dentro de handlers que ainda mexem no DOM depois (ex.: `agenda.js:370-377` fecha o modal DEPOIS de gravar) e um redesenho síncrono derruba o modal. Remover o mecanismo e manter as chamadas explícitas.

**M32 — Poda de `estado.atribuicoes`** — só depois de D4.

---

## FASE 2 — Núcleo transversal (`core.js`, `ui.js`, `styles.css`)

Independente da FASE 1 na maior parte; pode rodar em paralelo. Precisa estar pronta antes da FASE 3.

### 2.1 `app/ui.js` — requisito 7 (hora e minuto de verdade)

**U1 — Matar `opcoesHora`.** `ui.js:78-84` gera de 30 em 30, então 07:45 é impossível. Trocar os seis consumidores por `<input type="time" step="300">`: `registro.js:128` (início rec.), `:129` (término rec.), `:172` (início pontual), `:173` (término pontual), `estrutura.js:132` (abertura), `:133` (fechamento). ⚠️ Os dois de `estrutura.js` usam faixas próprias (`06:00`–`12:00` e `12:00`–`23:30`) — `min`/`max` diferentes dos de registro.

**U2 — `ajustarFim()` e o valor 23:30 fantasma.** `registro.js:203` produz `23:30`, que não existe no dropdown (teto 23:00); `ui.js:72` faz `s.value = valor` sem conferir, o select vai a `selectedIndex -1` e fica **em branco** enquanto `form.fim` continua `'23:30'`. Pior desfecho real: mudando o início, o erro de faixa mínima some e o registro é **gravado** com fim inválido e campo vazio. Reprodução: início 23:00 (com faixa 60) ou 22:30 (com faixa 90). Correção: derivar o teto do `fechamento` da clínica escolhida; e, defensivamente, `U.selecao` (`ui.js:67-75`) deve inserir uma `<option>` para o valor atual quando nenhuma casar.

**U3 — Modal acessível.** `ui.js:14-33`: sem `role="dialog"`, `aria-modal`, `aria-labelledby` para o `<h4>` de `:21`; foco não entra, Tab escapa pelo scrim, `fecharModal` (`:35-39`) não devolve o foco. É o componente de TODOS os fluxos destrutivos.
⚠️ Guardar a `caixa` corrente em variável de módulo (junto de `scrimAtual`), **não** em closure: `acessos.js:157-160` e `disciplinas.js:273-277` abrem modal de dentro de modal e prenderiam o Tab na caixa antiga. Restaurar `focoAnterior` só se o nó ainda estiver no documento (as ações chamam `App.recarregar()`, que reconstrói a página).

**U4 — XSS armazenado (`html:`).** `core.js:14` faz `node.innerHTML = v`. Eliminar `opts.texto`/`html:` de `U.confirmar` (`ui.js:46`) e passar `opts.conteudo` com nós DOM — manter `html:` "só para markup literal" deixa a porta aberta para a próxima concatenação. Vetores: `registro.js:286-292` (**`o.titulo` de atividade pontual — o mais fácil de explorar**), `acessos.js:110-112` (`u.nome`), `agenda.js:263-264` (`nomeClinica`), `acessos.js:92-94`.

**U5 — `U.barra` com escala absoluta.** `ui.js:128-131` normaliza pelo maior valor, então a clínica mais ocupada sempre aparece 100% cheia. Criar `parametros.capacidadeSemanalH` (60 h/clínica, coerente com o mockup) e usar em `painel.js:160` e `relatorios.js:60`.

**U6 — `C.plural(n, sing, plur)`** em `core.js`. Casos alcançáveis com valor 1: `painel.js:124`, `agora.js:236`, `registro.js:262`/`:275`, `disciplinas.js:49`. Tratar plural irregular (ocupação/ocupações — `agenda.js:215` já faz à mão). Trocar os atalhos `' registro(s) '`/`' ocupação(ões) '` de `manutencao.js:92, 96, 102, 207`.

**U7 — `C.fmtHoras` nos três pontos que imprimem ponto decimal:** `estrutura.js:161`, `:193-194` (só o ramo `h`), `registro.js:220`. Com faixa 90 min hoje sai `1.5 h`. ⚠️ `C.fmtHoras` já devolve o sufixo ` h` — remover o `+ ' h'`.

**U8 — `C.dataValida(iso)`** e uso em `estrutura.js:205` (hoje `'2026-12-01' <= ''` é falso e a string vazia é gravada, gerando `NaN/NaN/NaN` em `estrutura.js:160`) e em `registro.js:215-236`. ⚠️ Prever o estado JÁ corrompido: se `semestre.inicio === ''`, o formulário precisa cair para `C.hojeISO()`, senão a nova validação tranca o usuário para sempre.

**U9 — `#toasts` com `aria-live="polite"` / `role="status"`** (`index.html:14`). **Não** dar `tabindex="-1"` ao toast — provoca anúncio duplicado e rouba o foco. Preservar `document.activeElement` por atributo estável antes de `C.clear(raiz)` em `app.js:30-40`.

**U10 — Revalidação periódica de status.** `app.js:24-27` só atualiza o relógio; `S.statusOcorrencia`, os badges, a barra `.tl-now` e `C.decorrido` congelam. ⚠️ Ligar o timer **só na rota `agora`** (sem formulário) ou, antes, dar `value:` aos textareas de `registro.js` (ver R4), senão o redesenho apaga o que o usuário está digitando.

### 2.2 `app/styles.css`

**T1 — Trocar o `@import` da linha 1 pelo do DS, literalmente:**
`family=Barlow:wght@400;500;700&family=Barlow+Condensed:wght@400;600`.
Não acrescentar 600 a Barlow nem 700 a Condensed. Os `font-weight:600` do CSS/JS passam a resolver para 700, como no mockup. **É a causa mais provável do "as fontes carregam mas não batem".**

**T2 — `body`** (`:39`): `font-size:15px; line-height:1.55; font-weight:400`. Depois revisar os `font-size:13.5px` dos views, calibrados contra 14px.

**T3 — Headings** (`:40`): acrescentar `line-height:1.12; letter-spacing:-0.015em`, mantendo `margin:0` (o mockup também zera — **não** aplicar `margin:0 0 var(--space-2)`, quebraria os h5 em flex `align-items:baseline`). Não criar `h6` (nem app nem mockup usam). O `line-height:1.05` do h1 é inócuo (`.login h1` já sobrescreve).

**T4 — `.nav button`** (`:56`): `font:600 12.5px var(--font-heading); letter-spacing:.06em; padding:7px 13px`. Cinco divergências no elemento mais visível do cabeçalho.

**T5 — `.btn`** (`:72`): `font-family:var(--font-heading); font-weight:600; font-size:13.5px; line-height:1.2`. **Não** usar os 14px do DS — o mockup sobrescreve todos os botões para 12.5/13/13.5px. Se precisar da altura 38px do mockup, criar `.btn-lg{height:38px;padding:0 20px}`.

**T6 — `.btn-ghost` / `.btn-danger`** (`:80-83`): remover `font:500 13px var(--font-body)` (herdam de `.btn`) e trocar `text-decoration:underline` por fundo tingido (`color-mix(... 10%)` no hover, 18% no active). `.btn-danger` não existe no DS — é extensão do app; corrigir só família/peso/hover, a cor depende de D6.

**T7 — Títulos de página a 30px.** Trocar `C.el('h1',…)` por `h2` em `acessos.js:20`, `agenda.js:30`, `disciplinas.js:19`, `estrutura.js:14`, `relatorios.js:12`. `agora.js:87` já usa h2. Reservar h1 para o login.

**T8 — `h5` de 17px → 20px** (`:42`), e 22px nos três blocos que o mockup mostra maiores: `painel.js:50`, `:86`, `:154`. Alternativa limpa: classes `.sec-title` / `.sec-title-lg`.

**T9 — Tokens ausentes.** Copiar do DS a rampa `--color-accent-2-100..900` (DS `:34-42`) e as bases `--color-accent:#5980a6` / `--color-accent-2:#728fab` (DS `:8-9`). Em `[data-tema]` (`:18`) acrescentar `--fill-tint:var(--color-accent-2-200); --on-tint:var(--color-accent-2-800); --on-line:var(--color-neutral-800); --muted-2:var(--color-neutral-700)`; em `[data-tema="escuro"]` (`:26`) os inversos (accent-2-800/200, neutral-200/400). **`--fill-tint`/`--on-tint` são a faixa de ocupação conjunta do requisito 8** (`.dc.html:212-215`), não decoração.

**T10 — `--fill-deep` volta a ser "conjunta".** `:167` `.tl-blk.agora` gastou o tom mais escuro com "em curso". Corrigir: `.tl-blk.conjunta{background:var(--fill-deep);color:var(--color-accent-100)}`; `.tl-blk.agora` vira `outline:1px solid var(--color-accent-300); outline-offset:-3px` sobre `--fill-strong` (como o mockup); o toast (`:125`) usa `--color-neutral-900`.

**T11 — Foco e seleção.** Acrescentar após `:44`: `:focus{outline:none}`, `:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px}`, `::selection{color-mix(... 30%)}`. Trocar `.input:focus` (`:89`) por `.input:focus-visible` sem o `box-shadow` inset. Depende de T9.

**T12 — `--line-soft`** (`:22`): `neutral-300` → `neutral-200`. Afeta borda de toda cadeira livre, legenda e cadeiras em manutenção. `.bar` (`:113`) → `height:8px; background:var(--line-soft)` e remover a sobrescrita escura de `:114`.

**T13 — Filetes internos.** `--color-divider` (16%) → `--line-soft` **apenas** em `.kv` (`:195`) e `.list-btn` (`:188`). **NÃO** mexer em `.table td` (`:110`): o mockup (`.dc.html:23`) força `--color-divider` deliberadamente — nesse ponto o app já está certo.

**T14 — `.badge`** (`:99`): `font:600 10.5px; letter-spacing:.06em; padding:3px 8px`. Acrescentar `.badge.conjunta{background:var(--fill-deep);color:var(--color-accent-100)}` (requisito 8).

**T15 — `.chip-btn`** (`:61`): peso 600, `.06em`, `color:var(--muted)` (mantendo o hover). `.role-tag` (`:65`) alinha-se ao `.badge` corrigido — **não** ao `perfilStyle` do mockup, que é outro componente (seletor de perfil com estado on/off).

**T16 — `.table`** (`:108`): `letter-spacing` `.09em` → `.08em`; acrescentar `.table tbody tr:hover{background:color-mix(in srgb,var(--color-text) 4%,transparent)}`. **Não** subir `td` para 14px — o mockup sobrescreve cada célula para 13.5/13px inline.

**T17 — `label.fld > span`** (`:86`): `.09em` → `.07em`.

**T18 — Títulos de item perderam o Condensed.** Trocar `var(--font-body)` por `var(--font-heading)` + letter-spacing: `.list-btn b` (`:192`, 13.5px/.04em), `.tl-lbl` (`:161`, 13px/.04em), `.wk-hd` (`:173`, 13px/.05em), `.ev b` (`:179`, 12px/.03em, declarando a família), `disciplinas.js:46` (13.5px/.04em). São os títulos curtos que dão o caráter "Industry".

**T19 — Espaçamentos.** `.card` 18px 20px → **22px 24px**; `.kpi` 15px 17px → **16px 18px**; `.hdr` 11px 26px → **12px 28px**; `main` → `24px 28px 56px`; `.split` gap 34 → **36px**. ⚠️ `max-width`: o mockup varia por tela (1400 painel/estrutura, 1460 ocupações, 1440 disciplinas, 1280 relatórios) — **não** trocar cegamente o 1460 global para 1400; ou mantém global, ou passa por tela.

**T20 — Grade de cadeiras: duas variantes, ambas de 7 colunas fixas** (é o que produz 7×2 = 14 por clínica).
- `.chairs` (ocupação): `repeat(7,minmax(28px,1fr)); gap:5px`, `.chair` 42px, `font:600 13px`. Cadeira livre em `var(--muted)`; `.chair.manut` = `background:var(--line-soft); color:var(--muted); border-color:transparent`.
- `.chairs.compacta` (estrutura): `repeat(7,minmax(0,1fr)); gap:4px`, altura 34px, `font:600 12px`. Cadeira livre mantém `var(--color-text)`; `.manut` **conserva** `border:1px solid var(--line)`.
- `.chair.sel` → `outline:2px solid var(--color-accent)` (depende de T9). Remover a sobrescrita escura de `:152`.

**T21 — `.modal`** (`:132`): `box-shadow:var(--shadow-lg)` depois de importar o token. **Manter `background:var(--color-bg)`** — o `.dialog` do DS termina transparente (DS `:282` anula o `--color-surface` de `:270`) e um modal transparente sobre o scrim fica ilegível. O mockup não tem modal, logo não é evidência aqui.

**T22 — `.login h1`** (`:216`): `clamp(38px,4.4vw,60px)`.

**T23 — `.btn-perigo`** para confirmações destrutivas (hoje `ui.js:49-52` usa o mesmo azul para "Remover do sistema", "Excluir turma", "Suspender"). ⚠️ No tema escuro `--danger` é `#e39a94`; com texto branco fica muito abaixo de AA — usar texto escuro sobre esse fundo.

**T24 — Contrastes WCAG AA** (razões calculadas sobre os próprios tokens):
- `.tl-blk.pontual` (`:166`) 2,62:1 → usar `var(--color-accent-600)` **localmente**; **não** alterar `--color-accent-500` no `:root`, que também serve ao hover do `.btn-primary` escuro (`:76`) e à borda do toast (`:126`).
- `--fill-strong` escuro (`:29`) 3,90:1 → `accent-700`. Atinge `.btn-primary`, `.nav button.on`, `.seg button.on`, `.badge.strong`.
- `.dot-no` (`:210`) 2,57:1 → `neutral-700`; **e** texto alternativo (o `—` é a única forma de dizer "bloqueado").
- `.alert` (`:117`) 4,08:1 → `--warn` para `#8a4f13` (sujeito a D6).
- `.chair.manut` escuro (`:152`) 3,49:1 → `neutral-800/300`.

**T25 — Larguras fixas inline estouram telas estreitas** (media queries não alcançam `style=`): `disciplinas.js:31` (`300px`), `:195` (`1fr 130px 130px auto`); tabelas de 8 colunas em `agenda.js:187-190` e `estrutura.js:245-248`; `painel.js:116/117/126/131/132` (~580px de colunas fixas). Envolver em `overflow-x:auto`; para a do painel, **remover** as larguras fixas ou colapsar em cartões abaixo de 640px. A `.form-vincular` precisa de `1fr` no mesmo breakpoint.

---

## FASE 3 — Telas, arquivo a arquivo (depende de 1 e 2)

Ordem sugerida: `registro.js` → `agora.js` → `estrutura.js` → `agenda.js` → `painel.js` → `relatorios.js` → `disciplinas.js`.

### 3.1 `app/js/registro.js` — requisitos 2, 4, 8

**R1 — Campo de escopo** substituindo `clinicaId` (`registro.js:36-52` e `opcoesClinica` em `:90-94`, usada em `:117` e `:167`). Lista única, como o mockup (`.dc.html:999-1002`): para cada agrupamento, as duas clínicas (`"Clínica N · Especialidade"`) + a opção conjunta (`"Clínicas N e M · duas clínicas"`). Rótulo do campo: `"Clínica"` (do mockup) ou `"Onde"` — desde que a palavra proibida não apareça. ES5 puro: concatenação, sem template literals.

**R2 — Campo "Cadeiras" com teto dinâmico.** `registro.js:130-133` e `:174-177` têm `max:'60'`, que não corresponde a nada (o teto real é 14 ou 28). Usar `S.capacidadeEscopo(...)`, redesenhar ao trocar o escopo e **cortar `form.cadeiras` ao novo teto** antes de revalidar. Validar em JS (o `max` do input, fora de `<form>`, é decorativo — `5000` passa e cria 5000 botões, travando a aba). Rejeitar não-inteiro, `1e5`, `NaN`, `''`.

**R3 — Propagar `(agrupamentoId, escopo)` nos cinco pontos:** `S.excedeCapacidade` (`:223-226`), `S.conflitos` (`:241`), a mensagem de choque (`:290`), `S.criarRecorrencia` (`:302`) e `S.criarPontual` (`:313`). Nas prévias (`:262`, `:274`) trocar `S.nomeClinica` por `S.rotuloEscopo` → *"Clínicas 7 e 8 (28 cadeiras) · 24 cadeiras · Clínica Integrada · professor coordenador: …"*.

**R4 — Textareas perdem o texto ao redesenhar.** Acrescentar `value: form.observacao` (`:148`) e `value: form.descricao` (`:190`) — `C.el` trata `value` como atributo (`core.js:18`). Gatilho principal é `trocar()` (`:81-87`). *(A tese de "vazamento entre modos" da auditoria é falsa: são campos distintos e `:313` grava `descricao: form.descricao`.)* Limpar em `trocar()` continua sendo higiene: evita gravar texto invisível de uma tentativa anterior.

**R5 — Limites de data.** Pontual (`:168-171`): `min`/`max` do semestre (já disponível como `e.semestre.*` em `:27`) e checagem em `validar()` (`:231-234`) — hoje uma data no passado nasce "encerrada" e não pode ser cancelada (`agenda.js:277`). Vigência recorrente (`:137-144`): idem. Domingo: bloquear no `validar()` — a grade da semana (`agenda.js:77`) e o gantt (`:120`) só cobrem seg–sáb, e uma pontual de domingo fica invisível para sempre.

**R6 — "Criar pulando as N datas em conflito".** Hoje `:294` desabilita o botão com um único choque em qualquer data do semestre, e a única válvula é o parâmetro global `bloquearSobreposicao`. A opção deve gravar as datas conflitantes como `excecoes` no próprio `criarRecorrencia` (`store.js:193`, que hoje sempre inicializa `excecoes: []`).

**R7 — `responsavelId: u.id`** em `:50`, apagando a linha `:53`. O literal `'u_coord'` é id da semente (Camila Vieira): uma segunda coordenadora vê o nome dela pré-selecionado e pode gravar a atividade em nome de outra pessoa — e é `responsavelId` que governa quem pode cancelar depois. O coordenador continua reatribuindo pelo select de `:184-186`.

**R8 — Fallback de turmas.** Remover `:34` (`if (!turmasVisiveis.length) turmasVisiveis = e.turmas;`). ⚠️ O vazamento real aqui **não** é o modo recorrente (professor não tem `agenda.criarRecorrente`) e sim o seletor "Turma vinculada" da atividade **pontual** (`:181`) — `opcoesTurma(…, true)` já oferece "— sem turma vinculada —", então lista vazia deixa de ser problema.
⚠️ **Bloqueio obrigatório no mesmo commit:** desabilitar "Registrar" quando `modo==='recorrente' && !form.turmaId`, e recusar `turmaId` vazio em `criarRecorrencia` — senão `ocorrenciaDeRegra` (`store.js:88-89`) estoura em `d.codigo` e **derruba o app inteiro**, não só a tela.

### 3.2 `app/js/views/agora.js` — a tela mais afetada

**A1 — Coluna esquerda lista AGRUPAMENTOS** (`:40-57`): nome + pct sobre 28 + subtítulo com o par de clínicas (`.dc.html:1085-1093`). `sel.clinicaId` → `sel.agrupamentoId` (`:6`); ajustar o roteamento de entrada (`:11-12`, que lê `params.clinicaId` com fallback `e.clinicas[0].id`) e os dois chamadores de navegação: `painel.js:135` e `agenda.js:305`.

**A2 — Cabeçalho** (`:84-90`): título = `g.nome` ("Clínicas 1 e 2"); resumo = `emUsoNoAgrupamento + ' de 28 cadeiras em uso · ' + faixaAgrupamento(g.id).join('–')` → *"14 de 28 cadeiras em uso · 1–28"*. **Nunca literais** — a faixa vem do helper. Hoje imprime `1–14` sempre.

**A3 — Duas grades lado a lado** (`:110-113`): `grid-template-columns:repeat(2,minmax(0,1fr))`, uma por clínica, separadas por `border-left:1px dashed var(--line)` na segunda (`padding-right:30px` / `padding-left:30px`), cada uma com cabeçalho "Clínica N + especialidade" e a linha de estado da ocupação daquela clínica. Em `cadeiraBtn`, iterar em coordenadas globais (`c.primeiraCadeira + i`) e rotular com `C.pad(g)` — Clínica 2 mostra 15..28, Clínica 8 mostra 99..112. `sel.cadeira` passa a ser global.

**A4 — `statusCadeira`** (`:32-37`): a regra `numero <= occ.cadeiras` só existe em numeração local — com número global a Clínica 8 inteira apareceria "livre". Trocar por posição no escopo: `pos = posicaoNoEscopo(occ, numero); return (pos !== -1 && pos < occ.cadeiras) ? 'vaga' : 'livre'`.

**A5 — Faixa de ocupação conjunta.** Manter `ocupacaoVigente(clinicaId)` por coluna e acrescentar `ocupacaoConjunta(agrupamentoId, hoje)`. Quando existir, faixa acima das duas grades com `background:var(--fill-tint);color:var(--on-tint)` (T9), badge "Conjunta" e o texto *"{titulo} nas duas clínicas até {fim}"*.

**A6 — Linha do dia por agrupamento** (`:130-159`): uma pista por agrupamento com **duas faixas de 32px** e rótulos das duas clínicas à esquerda; bloco posicionado pelo escopo (`top = escopo==='ambas' ? 0 : indice*32`, `height = ambas ? 64-6 : 32-6`), classe `.tl-blk.conjunta` para o duplo (T10).

**A7 — Painel lateral da cadeira** (`:188-196`): título `'Cadeira ' + numeroGlobal` (**sem padding** — o mockup usa o número cru aqui) e subtítulo `S.localCadeira(n)` → *"Clínicas 1 e 2 · Clínica 2 · Periodontia"*. Título da lista de alunos (`:297-298`): *"Turma nas 28 cadeiras"* no escopo duplo, *"Alunos na Clínica N"* no simples.

**A8 — Rótulo do responsável** (`:218`): espelhar `agenda.js:287` — `o.origem === 'recorrente' ? 'Professor coordenador' : 'Responsável'`. É o **único** ponto do sistema onde o requisito 3 ainda diverge.

**A9 — Uma só definição de "cadeiras em uso".** Hoje: `store.js:488-495` usa `atrib || o.cadeiras`; `agora.js:44-46` idem; `agora.js:82` sem o fallback. Com a semente, o painel mostra "20 cadeiras em uso" (duas recorrências simultâneas), a lista da esquerda "71%" e o cabeçalho da mesma coluna "0 de 13". Criar `cadeirasEmUso(o)` e `cadeirasReservadas(o)` no Store e **proibir o fallback `||`**.

**A10 — `ocuparForm` sem escopo de dono** (`:262-272`): a única guarda é `S.pode('cadeira.ocupar')`, pergunta sobre o perfil, não sobre a ocupação. E `:268` cai em `S.estado.alunos` (base inteira) quando a ocorrência não tem turma. Ver P5. Ao remover o fallback, corrigir também a mensagem de `:271-272`, que diria algo falso.

**A11 — Janela horária derivada dos dados** (`:132`, `agenda.js:118`). `abertura`/`fechamento` das clínicas e `aberturaPadrao`/`fechamentoPadrao` **nunca são lidos** em lugar nenhum. Caso silencioso alcançável: uma ocupação 06:00–07:00 (duração mínima, aceita pelo formulário) dá `b <= a` (`:141-142`) e **desaparece por completo** do gantt. Derivar a janela com clamp contra os parâmetros, arredondar para hora cheia, e derivar no mesmo commit os laços de marcas (`:136`, `agenda.js:132`) e o rótulo `:164` ("07h–22h") — senão a régua descola dos blocos.

**A12 — Numeração global nos textos:** `:123` (botão), `:189` (título), `:227`, `:283` (toasts), `:280` (rótulo "Ocupar"), `:307` (lista de alunos), `:247` (`historicoCadeira`). Padding de 2 dígitos **só** nos botões da grade e na lista de alunos.

### 3.3 `app/js/views/estrutura.js` — requisito 6

**E1 — Um cartão por AGRUPAMENTO** (`:24-27`): cabeçalho `g.nome` + faixa global (`"Clínicas 3 e 4 · cadeiras 29–56"`) e, dentro, `grid-template-columns:repeat(2,minmax(0,1fr));gap:22px` com as duas clínicas. Cada coluna: nome da clínica em `font:600 14px var(--font-heading);letter-spacing:.03em` + especialidade a 11.5px em `--accent-ink` + `"14 cadeiras (29–42)"`, e entre o info e a grade uma linha `display:flex;justify-content:space-between;margin:14px 0 8px` com o eyebrow "MANUTENÇÃO" à esquerda e `"N em manutenção"`/`"todas operando"` à direita. Título do cartão a `font:600 20px var(--font-heading)`.
Isto também corrige a **hierarquia tipográfica invertida**: hoje `:41` dá `h4` (20px) ao nome da CLÍNICA, degrau que pertence ao agrupamento.
⚠️ `shots/estrutura.png` está **desatualizado** em relação ao `.dc.html` (mostra faixa 1–28 repetida e 5 parâmetros). Usar o `.dc.html` como referência de numeração.

**E2 — Faixa correta no cartão** (`:42-43`): o `'1–'` é literal e imprime "(1–14)" nas oito clínicas. Usar `S.faixaCadeiras(c.id)`.

**E3 — Grade em coordenadas globais** (`:35-36`, `botaoCadeira` `:63-74`): `text: C.pad(c.primeiraCadeira + i)`, `S.cadeiraEmManutencao(c.id, g)`, e passar `g` para `M.abrir` (`:71`). Aplicar `.chairs.compacta` (T20).

**E4 — Modal "Registrar manutenção"** (`:77-119`): três campos encadeados — Agrupamento → Clínica (rótulo com especialidade) → Cadeira, com rótulo `'Cadeira ' + C.pad(g) + ' (posição ' + (i+1) + ' na ' + c.nome + ')'`. `f.cadeira` guarda o número **global**, e é ele que vai para `M.abrir` e `cadeiraEmManutencao` (`:111-114`).

**E5 — Remover o campo "Cadeiras" da edição de clínica** (`:130-131`, com o aviso de `:136`). Par com M21. Trocar o aviso por texto informativo: *"Esta clínica ocupa as cadeiras {f[0]}–{f[1]} da numeração do polo (1–112). A quantidade é fixa em 14."*

**E6 — Painel de Parâmetros completo** (`:157-171`), com valor em pill à direita e todos **derivados**, nunca literais:
`Numeração das cadeiras · 1–{totalCadeiras()}` | `Cancelamento · coordenação` | `Vínculo aluno–cadeira · fixo na graduação` (D8) | `Pós-graduação · cadeira rotativa` | `Ocupação nas duas clínicas · permitida` | `Sobreposição na clínica · bloqueada` | `Faixa mínima · {fmtHoras}` | `Vínculos · {semestre}` | `Motivo na manutenção · {valor real de exigirMotivoManutencao}`.
Trocar "Cadeiras totais" (`:167`) por `"4 agrupamentos · 8 clínicas · 112 cadeiras"` derivado, e atualizar o subtítulo da página (`:16-17`). ⚠️ Para casar com o mockup, `:24` precisa **mudar** de `class:'split'` (`1.35fr / 1fr`) para `minmax(0,1fr) 290px`.
⚠️ O seletor de faixa mínima está em `:193` (o de `:196` é "Sobreposição") e já oferece 30/60/90/120 — não precisa mudar, só o default (D3).

**E7 — `S.localCadeira()` nos seis pontos** que hoje concatenam "Clínica · NN" local: `:255`, `:287-288`, `manutencao.js:65-66`, `:83`, `:155`, `:199`.

**E8 — Validação do semestre** (`:205`) — ver U8.

### 3.4 `app/js/views/agenda.js`

**G1 — Calendário da semana com eixo de horas** (`:76-104`). Hoje é uma lista por coluna de dia, sem referência de horário. Mockup (`.dc.html:317-347`): `grid-template-columns:58px repeat(6,minmax(104px,1fr));gap:0 8px` dentro de `max-height:600px;overflow:auto`, 15 linhas (07–21), rótulo de hora a 11.5px em `--muted-2`, células `min-height:42px;padding:6px 0;border-top:1px solid var(--line-soft)`, bloco na linha em que `r.inicio >= h && r.inicio < h+1`. Cabeçalhos de dia `position:sticky;top:0;z-index:2`, e a primeira célula do cabeçalho é um `<div>` vazio sticky de `height:30px`. Ajustar `.wk` em `styles.css:171`.

**G2 — Rótulo e cor dos eventos** (`:88-97`): `S.rotuloEscopo(o.agrupamentoId, o.escopo)` no lugar de `nomeClinica`; `.ev.conjunta` com `--fill-deep`/`--color-accent-100` contra `--fill-soft`/`--on-soft`. Ampliar a legenda (`:103-112`) com "Ocupação nas duas clínicas".

**G3 — Gantt por agrupamento** (`:134-153`): 4 pistas de altura fixa `ROW*2 = 64px` com três guias horizontais (top 0/32/64), rótulo em duas linhas (nome do agrupamento 13px/600 + as duas clínicas 11px muted) em coluna de 108px, `padding:10px 0` no wrapper, e bloco posicionado pelo escopo (mesma regra de A6). Rótulo do bloco: `CÓDIGO TURMA · primeiro nome do professor`; `title` = rótulo do escopo + faixa horária. O empilhamento por nível (`:158-165`) só vale **dentro** da mesma faixa.

**G4 — Detalhe da ocorrência** (`:279-291`): `U.kv('Agrupamento', …)` + `U.kv('Escopo', …)` no lugar de "Clínica"; denominador de Cadeiras (`:288`) → `cadeirasOperantesEscopo`; acrescentar `U.kv('Faixa de cadeiras', …)`.

**G5 — Tabela de recorrências** (`:186-192`, `:204`): coluna "Clínica" → **"Onde"** com `S.rotuloEscopo`. Mesma função nos três textos de confirmação: `:264`, `:319`, `:337`.

**G6 — Título e aba.** `app.js:11` `rotulo:'Agenda'` → **"Ocupações"**; `:28-35` vira `h2` 30px com *"Ocupações · {semana}"*, removendo o subtítulo duplicado, e *"Recorrências do semestre X"* quando `vista==='recorrencias'`. **A terceira aba "Recorrências" NÃO é defeito** — é exigida pelo requisito 2; a ordem atual já está correta.

**G7 — `Agenda.cancelar` sem permissão** — ver P3.

**G8 — Coluna "Restantes"** (`:197`) usa `encontrosRestantes` (M27); `fimEfetivo` (`:196`) e `disciplinas.js:127` ajustam-se a M26.

### 3.5 `app/js/views/painel.js`

**P1v — Rótulo da agenda de hoje** (`:115-117`): `S.rotuloEscopo`, coluna a ~170px, e badge **"Conjunta"** ao lado do Recorrente/Pontual (`:126-130`).

**P2v — Layout de linhas em vez de tabela** (`:100-104`): mockup usa flex `padding:13px 0;border-bottom:1px solid var(--line-soft)` com `opacity:.6` nas encerradas; título (min-width 104px), faixa em accent-ink (min-width 96px), detalhe `CÓDIGO TURMA · professor · N alunos` em muted e pill de situação com **quatro** valores, incluindo "conjunta". Título do bloco: **"Ocupações de hoje"** (`:86`, hoje "Agenda de hoje"); card de registro: **"Nova ocupação"** (`:50`, hoje "Registrar ocupação"). O botão da esquerda continua "Cadeiras"/"Ver cadeiras" (o mockup chama de "Sala" — palavra proibida).

**P3v — Coluna direita** só com "Horas por clínica" (mockup); "Manutenções abertas" (`:19-20`) sai ou muda de lugar. Barras com escala absoluta (U5). Considerar as 4 barras de agrupamento via `horasPorAgrupamento` (M20).

**P4v — Larguras fixas** (`:116/117/126/131/132`) — ver T25.

### 3.6 `app/js/views/relatorios.js`

**L1 — Bloco "Semanal · ocupação e manutenção"** (a matriz clínica × dia, ausente). Colunas: Clínica (nome + especialidade a 11.5px muted na 2ª linha), 6 dias alinhados à direita (`—` em muted quando zero), **Total** em negrito, **Ocup.** = `Math.round(total/CAP*100)+'%'` em `--accent-ink` (é **percentual**, não horas), **Manut.** com os números **globais** de 2 dígitos separados por vírgula. Linha final "Polo" com `Math.round(totalGeral/(CAP*8)*100)+'%'`. Abaixo: botão "Exportar CSV semanal" + nota *"Horas por dia · capacidade de {CAP} h por clínica na semana (07h–22h, seg a sáb)"*.

**L2 — CSV por clínica** (`:97-107`): `['Agrupamento','Clínica','Especialidade','Faixa de cadeiras','Cadeiras','Operantes','Em manutenção','Números em manutenção','Horas na semana','Ocupações na semana']` + linha de totais do polo.

**L3 — CSV da agenda** (`:110-120`): coluna "Clínica" → duas colunas, **"Agrupamento"** e **"Escopo"**. Idem no CSV de recorrências (`:126-137`, coluna em `:133`). ⚠️ **Não** acrescentar "Especialidade" ao CSV da agenda — o do mockup não tem.

**L4 — CSV de manutenção** (`:157-169`): `['Protocolo','Agrupamento','Clínica','Especialidade','Cadeira (1–112)','Posição na clínica', …]`, com `Posição = m.cadeira - clinicaDaCadeira(m.cadeira).primeiraCadeira + 1`. Acrescentar "Impacto apurado em" e "Tempo de interdição".

**L5 — Fichas filtradas por permissão** (`:17-30`). O `fichas.pop()` de `:25` só remove o último item; o técnico de manutenção continua exportando `csvAlunos` (`:143-154`), com **nome, matrícula e período de todo o corpo discente**. Acrescentar um 4º elemento (permissão) a cada ficha e trocar `pop()` por `filter`. Ver P6.

**L6 — Semana de 6 dias** coerente com o Store (M30) e escala absoluta na barra (`:60`, U5).

### 3.7 `app/js/views/disciplinas.js`

**S1 — Fallback de turmas** (`:13-14`): remover a segunda linha. Um professor recém-cadastrado vê as 9 turmas semeadas **e**, com `alunos.vincular` (concedida ao perfil), ganha o formulário de vínculo (`:157`, `:204`) e o botão Remover (`:175-181`) em todas elas. Renderizar `U.vazio('Nenhuma turma sob sua coordenação.')` **no lugar do split inteiro**, não só da seção de alunos. `:21` passa a dizer "0 turmas", o que é correto.

**S2 — `turmaSel` sobrevive ao logout** (`:7`, `:15`): a validação só confere se a turma ainda existe, nunca se pertence a `lista`. Coordenador seleciona a turma X → Sair → professor entra → vê a turma X com alunos e horários. **Corrigir a pertinência em `:15`** — é a única correção realmente necessária dos módulos-globais (`agenda.js:6-8`, `agora.js:6`, `estrutura.js:6`, `acessos.js:8` guardam só vista/filtro e não vazam dados).

**S3 — Cabeçalho** (`:19-31`): `h2` com *"Disciplinas · {semestre}"* e três botões na ordem do mockup — "Encerrar semestre" (ghost, D9), "Nova turma" (ghost), **"Nova disciplina" (primary)**. A ênfase hoje está invertida. "Encerrar semestre" no app precisa também encerrar as recorrências vigentes (o mockup só esvazia `reservas`, porque não tem recorrência) e ficar atrás de `disciplinas.editar`.

**S4 — Código da disciplina** (`:46`): `font:600 13.5px var(--font-heading);letter-spacing:.04em` (T18).

**S5 — Coluna "Cadeira"** (`:160-183`) — só se D8 for sim.

**S6 — `vincularAluno` troca a pessoa silenciosamente** (`store.js:388-398`): matrícula existente descarta `dados.nome`/`periodo` e vincula o aluno preexistente, enquanto o toast (`:206`) exibe o nome **digitado**. Retornar `{aluno, reaproveitado}` (chamador único, `:205`); comparar nome normalizado (trim + case-insensitive) para não confirmar à toa; usar `a.nome` sempre no toast. Concordância: o sistema não guarda gênero — usar impessoal ("Vínculo criado." / "Vínculo removido.").

### 3.8 `app/js/manutencao.js` — requisito 6

**N1 — Motivo obrigatório no Store.** `abrirManutencao` (`store.js:330-348`) grava o que vier, inclusive `undefined`; a exigência só existe na UI (`:111`, `:128`). Validar no Store e ler o mínimo do parâmetro em vez do literal 10.

**N2 — Impacto congelado.** `calcularImpacto` roda uma vez na abertura (`store.js:333`) com janela fixa de 14 dias, e a ficha (`:205-207`) exibe o número semanas depois sem dizer que é do dia da abertura, sem imprimir `apuradoEm`. O modal de **abertura** já recalcula ao vivo (`:77`) — a mudança se concentra em `:205`. Acrescentar "Impacto apurado em …", "Tempo de interdição" e (depois da FASE 1) "Agrupamento".

**N3 — "dias úteis" que são corridos** (`:87` vs `store.js:340` / `C.addDays`). Abrindo "Falha de equipamento" (3 dias) numa sexta, a tela promete quarta e grava segunda. **Corrigir o texto** para "dia(s) corrido(s)" — o campo é editável pelo técnico (`:57-60`), é palpite e não compromisso; contagem em dias úteis exigiria calendário de feriados acadêmicos para não mentir de novo.

**N4 — `S.localCadeira()`** em `:65-66`, `:83`, `:155`, `:199`; número global em `:135` e `:184`.

---

## FASE 4 — Controle de acesso real (requisito 5)

Independente da FASE 1; pode rodar em paralelo. Precisa vir **antes** da FASE 5.

**P1 — Guardas no Store.** `store.js:511-541` exporta ~25 mutações e **nenhuma** chama `pode()`. Escalonamento a partir de qualquer sessão de professor:
`Store.salvarUsuario(<meu id>, {perfil:'coordenador'})` → `:412` copia `perfil` sem verificação → `commit()` persiste → recarrega com o menu completo.
Criar `exigir(perm)` e aplicar a todas: `criarRecorrencia`, `criarPontual`, `atualizar*`, `cancelarOcorrencia`, `encerrarRecorrencia`, `excluirRecorrencia`, `restaurarExcecao`, `ocuparCadeira`, `liberarCadeira`, `abrirManutencao`, `encerrarManutencao`, `salvarDisciplina`, `salvarTurma`, `excluirTurma`, `vincularAluno`, `desvincularAluno`, `salvarUsuario`, `alternarAtivo`, `removerUsuario`, `atualizarClinica`, `atualizarParametros`, `atualizarSemestre`.
⚠️ Retornar `{ok:false, erro}` — **não `throw`**: o try/catch de `app.js:181-188` cobre só `view.render`, e um throw dentro de um onclick vira erro silencioso no console com o modal aberto. `manutencao.js:17` já é o padrão certo. Não chamar `exigir` no escopo do módulo (acesso.js e store.js são IIFEs independentes).
Nota de honestidade no README: com estado 100% no cliente, a guarda protege o uso da interface, não o localStorage.

**P2 — `Store.entrar` valida** (`store.js:39`): grava a sessão antes de saber se o id existe e nunca checa `u.ativo`. `Store.entrar('u_tec2')` (técnica suspensa) cria sessão válida e **carimba `ultimoAcesso` de quem não tem acesso**. Retornar `{ok,erro}`; e em `app.js:34` revalidar: `var u = S.usuario(); if (!u || u.ativo === false) { S.sair(); …login… }` — o caso `ativo===false` não é coberto hoje.

**P3 — `Agenda.cancelar` sem guarda.** `agenda.js:383` publica `cancelar` em `window`; a função (`:313`) não chama `S.pode` em nenhum caminho de gravação. As duas únicas checagens são de **renderização** (`painel.js:113-114` e `agenda.js:276-277`). Um professor executa `Agenda.cancelar(...)` no console e cancela a aula de outro professor. Corrigir em quatro camadas: guarda na primeira linha de `cancelar` (`:312`); reconferência de `agenda.criarRecorrente` dentro de `gravar()` (`:367-380`, ramo `escopo==='regra'`); guarda dura em `Store.cancelarOcorrencia` (P1); e as duas cópias substituídas por `S.podeCancelarOcorrencia(o)` — mantendo na tela a condição `st !== 'encerrada'`, que é de apresentação.

**P4 — `coordenaTurma(uid, turmaId)`** exigida em `vincularAluno`/`desvincularAluno` (que hoje aceitam qualquer `turmaId`) e espelhada em `disciplinas.js:149`. Par com S1/R8.

**P5 — `podeOperarOcorrencia(o)`** para `ocuparCadeira`/`liberarCadeira`: `u.perfil === 'coordenador' || o.responsavelId === u.id` **E** `exigir('cadeira.ocupar')` — as duas condições, não uma ou outra (o técnico não tem a permissão). ⚠️ `liberarCadeira` recebe só `(chave, numero)` e não consegue aplicar a regra — mudar a assinatura (chamador único: `agora.js:226`) ou resolver pela chave (`'r:<id>:<data>'` / `'p:<id>'`).

**P6 — Quebrar `relatorios.ver`** em `relatorios.ver` + `relatorios.pessoas`. Acrescentar a nova ao array `PERMISSOES` (`acesso.js:27-45`) e à lista literal do professor (`:49-53`); a matriz do coordenador (`:48`) é derivada e absorve sozinha. Ver L5. *(As funções `csvAlunos` etc. não estão em `window` — repeti-las internamente é defesa em profundidade, não fechamento de superfície.)*

**P7 — `atualizarPontual` sem lista branca** (`store.js:234-239`): copia qualquer chave, inclusive `id`, `criadoPor` e `responsavelId` — o campo que define quem pode cancelar. A irmã `atualizarRecorrencia` (`:225-232`) já tem lista branca. Nenhuma das duas tem chamador → resolver junto de **D5**: se não houver edição, remover do export; se houver, lista branca sem `id`/`tipo`/`criadoPor`/`criadoEm`, e `responsavelId` só sob `agenda.cancelarQualquer`.

**P8 — Botões só-ícone sem nome acessível.** `agenda.js:38`/`:42` (`‹`/`›` com `title`); matriz de permissões `acessos.js:216-219` (símbolo + cor + `title` num `<span>` não focalizável). O padrão certo já existe em `ui.js:24` (`aria-label`). Nos `.seg` (`agenda.js:52-57`, `acessos.js:37-42`, `painel.js:69-80`) e no `seletorDias` (`ui.js:86-103`): usar **`aria-pressed`**, não `role="tablist"` — o padrão tab exigiria navegação por setas e `role="tabpanel"`, e o conteúdo é substituído por re-render completo, sem painel estável.

---

## FASE 5 — SSO e remoção da demonstração (requisito 9)

**Bloqueada por D1 e D7.** Depende da FASE 1 (os números do login) e da FASE 4.

**X1 — Campo `dominioInstitucional`** em `estado.parametros` (`dados.js:237-243`). `atualizarParametros` (`store.js:451-454`) copia qualquer chave, então não muda schema — mas o modal `editarParametros` (`estrutura.js:178-212`) grava por objeto literal em `:205`: **acrescentar a chave lá**, senão o campo não é salvo mesmo com o input na tela. Nascer **vazio** (não com placeholder fictício) e a interface tratar vazio como "SSO não configurado", em vez de aceitar qualquer conta Google.

**X2 — Substituir `login()` inteiro** (`app.js:56-135`). Hoje autentica por clique: `S.entrar(u.id)` direto, sem senha nem token (`:72-79`), com segmentado de perfis (`:86-97`). Remover `disponiveis`, `porPerfil`, `perfilSel`, `listaPessoas`, `desenharPessoas`, `seletor`, e a regra `.who` de `styles.css:217-221`.
Fluxo GIS: carregar `https://accounts.google.com/gsi/client` em `index.html` **antes** de `js/app.js` (`:30`); `google.accounts.id.initialize({client_id, callback})` + **`renderButton`** (não `prompt()` — One Tap pode ser suprimido e os callbacks de notificação foram descontinuados no FedCM); botão de 44px/14px como o do mockup. `Sair` (`app.js:170`) chama também `disableAutoSelect()`.
⚠️ **Não chamar de "validar o JWT"**: sem verificar a assinatura contra a JWKS do Google, qualquer um forja um `credential` no console. Deixar em comentário que é conveniência, não segurança. Usar o claim **`hd`** (não só o sufixo do e-mail) quando a instituição for Workspace; para contas fora do Workspace, `hd` não vem e o sufixo é o único critério.

**X3 — Coluna direita do login** (`:125-133`): 300px, `h4 "Entrar"` a 30px/`margin-bottom:22px`, um único botão, e rodapé `'@' + dominioInstitucional + ' · semestre ' + e.periodoLetivo`. Remover "Escolha o nível de acesso e a pessoa." (`:127-128`) e **"os dados ficam neste navegador"** (`:131-132`). ⚠️ O rodapé só funciona depois de X1 — sem ele imprime `undefined`.

**X4 — Números do login** (`:100-105`): depois da FASE 1, `e.clinicas.length` e `totalCadeiras()` valem **8** e **112** — são propriedades da estrutura e podem continuar derivados. Saem os dois que variam com o uso e denunciam base semeada: `e.turmas.length` e `e.recorrencias.length`, substituídos por **"4 agrupamentos"** e **"1–112 numeração"** (o mockup diz "salas em par" — palavra proibida).

**X5 — Validação de e-mail em `salvarUsuario`** (`store.js:406-416`, hoje copia cru; `acessos.js:170` só checa string não vazia). Normalizar (`trim().toLowerCase()`), validar formato, validar domínio **condicionalmente** (enquanto `dominioInstitucional` estiver vazio, não rejeitar — senão o painel de acessos trava em bases antigas), e checar unicidade sobre e-mails **já normalizados** (`'A@x'` vs `'a@x'`). Mudar o retorno para `{ok,erro}` é seguro: o único chamador (`acessos.js:176`) ignora o retorno hoje — tratar no onclick de `:172-177`. O cuidado já existe para aluno (`vincularAluno` deduplica por matrícula) e não existe para usuário.

**X6 — Placeholder** (`acessos.js:144-146`): `'nome.sobrenome@' + (S.estado.parametros.dominioInstitucional || 'dominio-da-instituicao')`. Ordem: X1 → X6.

**X7 — Sessão fora do blob de dados.** Hoje `sessaoUsuarioId` é campo do mesmo objeto gravado em `ocupa.odonto.v4` — trocar de identidade é editar um campo. Mover para `ocupa.sessao`.
⚠️ Ser honesto sobre o ganho: **a chave nova também é editável**. O ganho é que a sessão para de viajar com o dado (export/import/reset), `sair()` limpa só a sessão e há um único ponto de resolução de identidade. Garantia real só com servidor revalidando o token a cada gravação — nota no README.
⚠️ **Não decodificar o JWT dentro de `usuario()`**: é chamada em todo `pode()` e em todo render (`app.js:34`, `:139`, `store.js:41`). Resolver uma vez em `entrar()`/`carregar()`, guardar em variável de módulo, revalidar `exp` no máximo uma vez por carga.

**X8 — Remover `App.resetar`** (`app.js:205-211`): código órfão (nenhum chamador em nenhuma view), mas as strings "Restaurar dados de demonstração" e "Dados restaurados." vão no bundle entregue. Remover `resetar` do export de `store.js:513` e a função de `:29-32`. Se a coordenação precisar reinicializar, que seja ação distinta, com rótulo honesto ("Limpar todos os registros do semestre"), permissão nova (`sistema.reiniciar`, só coordenador) verificada **dentro do Store**, e nunca chamada "demonstração".

**X9 — Esvaziar a semente.** Sai de `dados.js`: 40 nomes de alunos (`:31-40`), 8 professores (`:58-63`), a coordenadora `u_coord` (`:64-68`), 2 técnicos incluindo o inativo "para demonstrar" (`:77-86`), 8 disciplinas + 9 turmas (`:99-123`), 10 recorrências (`:134-157`), a exceção decorativa com o comentário "para demonstrar" (`:158-162`), 4 pontuais com narrativa (`:166-199`) e 3 manutenções com laudos (`:202-212`).
**Permanecem** (não são demonstração): `ESPECIALIDADES` (consumida em `disciplinas.js:215` e `:225` — e **só** nessas duas, não em `:285`), `CATEGORIAS_MANUTENCAO`, `TIPOS_ATIVIDADE`, e a estrutura de agrupamentos/clínicas/cadeiras, que é o modelo do polo.
⚠️ **Estados vazios a proteger antes**: `registro.js:37` (`e.clinicas[0].id`), `agora.js:12` (idem), `agora.js:274` (`candidatos[0].id`), `app.js:62-64` (`porPerfil[0].perfil.id` — cai com X2 de qualquer forma). `registro.js:38` **já** está protegido. Com clínicas preservadas pela estrutura, o risco concentra-se em `usuarios`, `turmas` e `alunos` vazios.
⚠️ `desenhar()` precisa de try/catch com tela de recuperação: `app.js:34` chama `login()`, que executa `S.totalCadeiras()` e `e.clinicas.length` **fora de qualquer try/catch** — um estado sem `clinicas` deixa a página em branco antes de existir botão de reset.

**X10 — Varredura final de ids da semente** em `app/js` fora de `dados.js`: `'u_coord'`, `'u_prof*'`, `'u_tec*'`, `'cl1'`, `'cl2'`, `'d0'`, `'t0'`. Hoje o único em código de aplicação é `'u_coord'` em `registro.js:50` (R7).

---

## FASE 6 — Entregável

**B1 — `dist/index.html`** conforme D2. Se for recriado: `tools/build.js` versionado, formato conhecido — CSS + `/*__SPLIT__*/` + JS concatenado **na ordem de `app/index.html:16-30`**, gzip, base64, dentro de `<script id="pacote" type="text/plain">` (carregador em `dist/index.html:19-43`).
⚠️ `DecompressionStream` não existe em Firefox < 113 nem Safari < 16.4 — testar `typeof DecompressionStream === 'undefined'` e trocar o catch (hoje despeja mensagem técnica) por texto em português.
⚠️ O empacotamento single-file para `file://` é **incompatível com o SSO** (D1). Como a FASE 1 toca quase todos os fontes, apagar o `dist` agora e regerar depois é o caminho mais seguro. **Não** usar "já divergente" como argumento: os timestamps provam o oposto (o dist é mais novo que o fonte).

**B2 — Higiene da raiz.** `doc-page.js`, `support.js`, `.thumbnail`, `shots/`, `uploads/` são artefatos do mockup e não pertencem ao entregável. O `.zip` está fora da raiz — apenas avisar.

---

## Grafo de dependências (resumo)

```
D1,D7 ─────────────────────────────► FASE 5 (SSO)
D2 ────────────────────────────────► FASE 6
D3 ──► M7 ──► registro.js validação
D4 ──► M32
D5 ──► P7
D6 ──► T6, T24(.alert)
D8 ──► S5      D9 ──► S3, sino do cabeçalho

M1,M2 ─► M9 ─► M10 ─► M11 ─► M12,M13,M20,M22
M3 ══ M14 (par obrigatório — sem ele o app quebra na 1ª abertura)
M6 ─► M16,M17,M18 ─► A3,A4,A12,E3,E4,E7,L4,N4
M9(rotuloEscopo) ─► A2,A7,G2,G4,G5,P1v,L3
M10,M13 ─► R1,R2,R3   (requisito 8 fecha aqui)
M11 ─► A1,A5,A6,G1,G3 (requisito 1 fecha aqui)
M22,M23 ─► pré-requisito do requisito 8 em produção
M26 ══ G8 + disciplinas.js:127 (mesmo commit)
T9 ─► T10,T11,T14,T20,A5   (requisito 8 visual)
U1,U2 ─► R2,R5  (requisito 7 fecha aqui)
P1 ─► P2,P3,P4,P5,P6,P7  (requisito 5 fecha aqui)
X1 ─► X3,X5,X6           (requisito 9 fecha aqui)
R8/S1 ══ bloqueio de turmaId nulo (senão derruba o app inteiro)
```

## Testes de regressão que fecham cada requisito

1. Estrutura: login mostra 8 / 4 / 112 / 1–112; Estrutura mostra 4 cartões; Clínica 4 diz "14 cadeiras (43–56)"; Clínica 8 mostra cadeiras 99–112; `grep -rni sala app/` volta vazio.
2. Recorrência: criada uma vez, aparece em todas as semanas até o fim do semestre; esticar o semestre reajusta; "Restantes" desconta exceções; encerrar hoje remove o encontro de hoje.
3. `grep -rn "responsável" app/js` não retorna nenhum rótulo de professor; `agora.js:218` diz "Responsável" para pontual.
4. Registro cria recorrência e pontual; textarea preserva o texto ao redesenhar; data fora do semestre e domingo são recusados.
5. Com sessão de professor: `Store.salvarUsuario(meuId,{perfil:'coordenador'})` e `Agenda.cancelar(...)` no console são **recusados**.
6. Manutenção sem motivo é recusada **pelo Store**; a ficha mostra "impacto apurado em".
7. Registrar 07:45–09:15 e recarregar: os dois horários persistem e aparecem no gantt. Ocupação 06:00–07:00 aparece no gantt.
8. Ocupação `ambas` em ag4: rótulo "Clínicas 7 e 8 (28 cadeiras)", faixa tint na tela de ocupação, bloco de altura dupla no gantt, e uma nova ocupação simples na Clínica 7 no mesmo horário **acusa choque**.
9. Login só com Google; e-mail fora da lista é recusado; nenhum nome fictício em `grep -rn "Camila\|Adriano\|Nara\|odonto.edu.br" app/ dist/`.
