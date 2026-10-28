# Integração da Central de decks no RE:Forge

Estado atual (0.1.7): a Central é uma aplicação Next.js à parte (`central/`), aberta pelo desktop num servidor
local na porta 4317, com biblioteca própria em `localStorage` e o RE:Forge embutido num iframe para jogar.
Objetivo: todas as funcionalidades da Central dentro da UI do RE:Forge (`ui/`), sobre os decks do Forge,
e depois apagar a aplicação Next.js.

Decisões do dono (27/10/2026):
- **Uma só biblioteca**: os decks Commander do Forge no disco. Os decks da Central são migrados uma vez.
- **A app Next.js é apagada** no fim (perde-se a PWA de browser).
- **Funcionalidades online ficam**, pedidas pelo motor Java com cache; sem rede mostram "indisponível".
- **Âmbito completo**: análise do deck, comparar, melhorar, Sage e pesquisa avançada.

## Mapa: Central → RE:Forge

| Central | Onde fica no RE:Forge | Dados |
|---|---|---|
| My Decks (lista, criar, colar, editar, apagar, export/import JSON) | `Decks.tsx` (já existe), `ImportDeck.tsx`, `DeckBuilder.tsx` | Forge (já existe) |
| Etiquetas, notas, `bracketIntent`/`calculatedBracket` | Página do deck | `Deck.getTags()` (já usado em Limited, prefixo `reforge-`), notas em `DeckBase.comment` |
| Página do deck: grupos por tipo, galeria, sideboard | Nova `DeckDetail.tsx` aberta a partir de `Decks` | `DeckImporter.detail` + `CardCatalog.card()` |
| Bracket, Game Changers, verificação Commander | Separador "Análise" da página do deck | Lógica pura portada (`bracket`, `game-changers`, `commander-check`, `partner`) |
| Funções (lands/ramp/draw/remoção/wipes/proteção), pips, slots fracos | Separador "Análise", junto de `DeckStatistics` | `deck-roles`, `card-tags.json` (embutido) |
| Mão de exemplo | Separador "Análise" | Local |
| Preços EUR, total do deck, impressões mais baratas | Separador "Preços" | **Motor**: Scryfall `/cards/collection` e `/cards/search` |
| Combos (Spellbook, EDHREC), adicionar combo, cortes por combo | Separador "Combos" | **Motor**: Spellbook `find-my-combos`, `json.edhrec.com` |
| Comparar decks | Novo ecrã a partir de `Decks` (escolher dois) | Local (`compare.ts`) |
| Melhorar deck (lista de referência, planos de jogo, cortes/adições, ajustes de bracket) | Novo ecrã a partir da página do deck | Local (`improve-*`, `combo-cuts`) |
| Sage: consulta, rulings, verificação, FAQ | Novo ecrã "Regras" (Home, cabeçalho) | Rulings pelo **motor** (Scryfall `/cards/{id}/rulings`) |
| Pesquisa avançada (texto de regras, legalidade, preço, P/T, lealdade) | Filtros extra no catálogo do `DeckBuilder` | `CardCatalog.search` estendido; filtro de preço pelo motor |
| Precons | Já existem (precons do Forge no `DeckPicker`); a página do deck passa a abrir também precons, só leitura | Forge |
| Jogar uma lista | Já existe (`startMatch`) — o deck já está no Forge | Forge |
| Instalar PWA, service worker, página offline | Apagado | — |

Não entram: os decks semente (Giada/Bruna) só chegam se já estiverem na biblioteca migrada; o "Angel demo
pack" escrito à mão (`improve-fixtures.ts`) só para esses dois comandantes — apagado, a menos que o dono o queira.

## Princípios

- A lógica da Central é TypeScript puro e já testável: **copiar** os módulos de `central/src/lib` para
  `ui/src/deckTools/`, trocando só a entrada (`Deck` da Central + `CardVisual` do Scryfall) pelos dados que o
  motor já dá (`CardCatalog.card()`: nome, custo, tipo em inglês `typeEn`, texto, valor de mana, identidade).
  Não reescrever heurísticas.
- Lógica de cartas usa `typeEn`/texto inglês, nunca o tipo traduzido (regra do projeto).
- Componentes reescritos no estilo do RE:Forge: sem Tailwind/shadcn, CSS com tokens das quatro skins,
  textos em `i18n.ts` (pt e en), botões reais, alvos de 44 px, landscape, texto a 200 %.
- Pedidos à rede só no motor, com hosts fixos (como `DeckLinks`), limite de ritmo do Scryfall, cache em
  `<data>/cache` e timeouts. Nunca bloquear a thread do WebSocket: tudo pelo executor `ui-actions`.

## Fases

Cada fase: ramo `feat/deck-tools-<fase>`, compila, testes de fumo, verificado no browser, commit aprovado pelo dono.

### 1. Base: lógica portada e dados das cartas
- `ui/src/deckTools/`: `bracket`, `game-changers`, `commander-check`, `partner`, `deck-roles`, `card-tags`
  (+ `card-tags.json`), `compare`, `combo-cuts`, `improve-plans`, `improve-adapt`, `improve-diff`, `prices`.
- Adaptador único `deckTools/cardVisual.ts` (`deckFromLines`, `visualFromCatalog`) → forma que os módulos esperam.
- Motor: sem mensagem nova — as linhas de `deckDetail`/`deckPreview` já trazem a carta do catálogo; `card()`
  ganhou `textEn` (texto de regras em inglês) e `commanderLegal` (lista de banidas do Forge), e as linhas do
  sideboard vêm marcadas.
- `npm run engine:smoke-decktools`: listas reais pelo motor → bracket, verificação Commander, funções, grupos,
  comparação, cortes e planos.
- **Feito** (27/10/2026, `feat/deck-tools-base`). Os módulos copiados não precisaram de alterações além dos imports.

### 2. Página do deck e análise
- `DeckDetail.tsx` (a partir de `Decks`): lista agrupada, galeria, sideboard; separador "Análise" com bracket,
  verificação, funções, pips, slots fracos, mão de exemplo e as estatísticas já existentes (`DeckStatistics`).
- Etiquetas e notas guardadas no deck do Forge (`saveDeck` estendido; etiquetas `reforge-*` internas escondidas).
- Ações existentes (jogar, editar, exportar, renomear, apagar) passam também para esta página.
- **Feito** (27/10/2026, `feat/deck-tools-analysis`): em vez de um ecrã novo, o ecrã de Decks ganhou as vistas
  Lista / Análise / Notas (`DeckInsights.tsx`); o sideboard aparece à parte na lista. Os módulos portados ganharam
  códigos (`ruleId`, `code`, `weakSlots`) para os textos virem do `i18n.ts`. Mensagem `setDeckMeta`; `saveDeck.from`
  mantém etiquetas/notas ao editar. Verificado no browser a 1280×720, 844×390 e texto a 200 %.

### 3. Serviços online no motor
- `DeckPrices` (Scryfall: EUR por impressão exata, impressão mais barata), `Combos` (Spellbook + EDHREC),
  `Rulings`. Cache com validade (preços 24 h), erros de rede distintos de "não existe".
- Separadores "Preços" e "Combos"; "adicionar combo" grava no deck do Forge.
- Estender `npm run engine:smoke-decktools` com `SMOKE_OFFLINE=1` para saltar a rede, como `smoke-import-fixes`.
- **Feito** (27/10/2026, `feat/deck-tools-online`): `DeckServices` no motor, separadores Preços e Combos
  (`DeckOnline.tsx`). Diferenças: os rulings passam para a fase 5 (só o Sage os usa); o "find-my-combos" do
  Spellbook não entra (a Central não o usava). Básicos incluídos nas impressões mais baratas (pesquisa própria).
  Links externos abrem no browser do sistema. Testado com serviços simulados e reais; browser a 1280×720 e 844×390
  com texto a 200 %. Textos do EDHREC (resultados, explicações) ficam em inglês.

### 4. Comparar e Melhorar
- `CompareDecks.tsx`: dois decks do Forge (próprios ou precons), partilhadas/só A/só B, diferenças de quantidade.
- `ImproveDeck.tsx`: lista de referência colada, planos de jogo, cortes/adições/trocas com preço,
  ideias guardadas; aplicar uma troca grava o deck. O texto gerado por `improve-adapt` (inglês) passa a chaves
  de `i18n.ts` com parâmetros — é a maior parte do trabalho de tradução.
- **Feito** (28/10/2026, `feat/deck-tools-improve`): vistas Melhorar e Comparar no ecrã de Decks (carregadas só
  quando abertas). Tradução completa das ~890 frases do Melhorar em `deckTools/pt.json` através de `say.ts`
  (decisão do dono: traduzir tudo; nomes de cartas e tipos de criatura ficam em inglês dentro das frases).
  As ideias guardadas geram sempre um deck novo (decisão do dono), com etiqueta "ideias" e notas.
  Motor: `deckLines` (outro deck, próprio ou pré-construído), `cardsByName`, Spellbook find-my-combos.
  Os "sinais" da Central (etiquetas por ideia) não entram.

### 5. Sage e pesquisa avançada
- Ecrã "Regras": consulta de carta (catálogo do Forge, em qualquer língua), rulings, verificação Commander de
  um deck, FAQ traduzida.
- `CardCatalog.search`: texto de regras, legalidade por formato, P/T/lealdade, operadores; filtro de preço
  aplicado aos resultados com os preços do motor.
- **Feito** (28/10/2026, `feat/deck-tools-sage`): ecrã Regras (botão no cabeçalho do início) com pesquisa em todas
  as cartas, incluindo banidas, texto traduzido do Forge, legalidade, rulings do Scryfall e FAQ (as 4 da Central + taxa
  de comandante e identidade de cor). A verificação Commander e os combos já estão nas vistas Análise/Melhorar.
  Construtor: "Mais filtros" com texto de regras e tipo (inglês ou traduzido) e valor de mana/poder/resistência/
  lealdade com operador. Ficam de fora formatos (catálogo só Commander), raridades/edições e filtro de preço
  (exigiria preços dos 32 mil cartas).

### 6. Migração da biblioteca
- Antes de apagar a Central, o desktop lê uma vez a biblioteca da origem `127.0.0.1:4317`
  (`mtg-central-deck-library:v1`) e importa cada deck pelo `DeckImporter` (nome repetido → sufixo, nunca
  substituir), com etiquetas/notas/bracket. Marca feita em `reforge.properties` para não repetir.
- Alternativa manual: `ImportDeck` aceita o JSON exportado pela Central.
- Testado só com perfis temporários, nunca com `%APPDATA%\RE-Forge`.

### 7. Remoção da Central
- Apagar `central/`, `desktop/central-launcher.cjs`, `central-server.cjs`, IPC `reforge:open-central`,
  `ui/src/centralBridge.ts`, `CentralDeckScreen.tsx`, o modo iframe em `App.tsx`, `startDeckMatch` e
  `previewDeck` se ficarem sem uso, `scripts/prepare-central-ui.mjs`, `start-central.mjs`, os smoke `central:*`,
  passos de empacotamento e workspace.
- Atualizar `CLAUDE.md`, `README.md`, `PLAN.md`; `package:smoke` sem Central.

## Riscos

- `improve-adapt.ts` (1869 linhas) assume nomes e campos do Scryfall; portar com testes de antes/depois sobre
  as mesmas listas para não mudar resultados.
- Preços/combos dependem de serviços de terceiros (EDHREC não tem API pública oficial): podem mudar sem aviso.
- A migração lê a origem antiga uma só vez; quem nunca abriu a Central não tem nada para migrar.
