# RE:Forge — plano de implementação

Documento vivo: atualiza o estado de cada passo quando o terminares. Antes de começar, lê o [CLAUDE.md](../CLAUDE.md)
(arquitetura, comandos, regras) e o protocolo no [README.md](../README.md).

## Visão

Uma app de desktop (e mais tarde Android) para jogar Magic contra a IA do Forge e contra outras pessoas, com uma
interface moderna e sem o ar "gerado por IA": tipografia e materiais em vez de brilhos e gradientes. O Forge continua a
ser o motor de regras, sem alterações; tudo o que é nosso vive em `engine/` (ponte) e `ui/` (interface).

Princípios:
- O Forge decide as regras; a ponte só traduz. Se o Forge já faz algo (IA, regras, importação, rede), usa-se.
- Sem texto redundante; explicações em tooltips. Todas as strings em `i18n.ts`. Todo o visual em tokens de skin.
- Cada passo termina com: compila, testes de fumo passam, verificado no browser, commit num ramo `feat/...`.

Referência visual: o estudo de design (4 estilos, mesa a 4, ecrã de escolha) está no artefacto
"Forge — Estudo de Estilos" (claude.ai/artifact/AKUCovJWgsRJsBcsC3bJ3s).

## Estado (feito)

| Commit | O quê |
|---|---|
| `5e2456c` | Ponte Java (WebSocket), mesa React, Electron, Commander contra 1–3 IAs, testes de fumo |
| `5a33ac1` | Ilustrações das cartas via Scryfall com cache local |
| `e773314` | Cartas da mão como carta impressa completa |
| `1b867b0` | Idioma escolhido no primeiro arranque; textos do Forge e das cartas traduzidos |
| `c4c64e5` | 4 skins (Mesa física, Editorial, Retro 1993, Terminal), escolha no primeiro arranque |

| `26b8732` | Combate: cartas acionáveis, alvo do ataque, setas de ataque e bloqueio, paragem após bloqueios |

Ramo `feat/packaging` (`3bca02e`, **não juntado**): instalador Windows em curso — ver passo 6.

---

## Passo 1 — Combate (feito, `26b8732`)

Feito no ramo:
- `actionable` por carta (preferência `UI_SHOW_ACTIONABLE_HIGHLIGHTS`), destacado na UI.
- Jogador alvo do ataque destacado (`prompt.chosen.players`); clicar na vida de outro jogador muda o alvo.
- `CombatArrows.tsx`: setas atacante → alvo e bloqueador → atacante (SVG sobre a mesa).
- Removido o botão "Atacar com tudo" (o Forge já dá "Alpha Strike"/"Call Back" no Cancelar) e a etiqueta "→ nome".
- No teu turno o jogo para depois dos bloqueios (`isUiSetToSkipPhase`), para veres o bloqueio antes do dano.
- `scripts/smoke-combat.mjs`: bot ativo (terrenos, feitiços, alvos de carta e de jogador, ataques, bloqueios).

- Bloqueio do lado do jogador verificado no browser (4 jogadores): atacante escolhido, criatura própria acionável, seta
  tracejada. O snapshot mostra os bloqueadores "planeados" enquanto se declaram (`getPlannedBlockers`).
- Diálogo `order` que exige ordenar tudo começa já ordenado (basta Confirmar).
- Fichas não pedem imagem (o servidor ainda não as suporta), para não aparecer o ícone de imagem partida.

- Distribuição entre vários bloqueadores validada na auditoria dos diálogos: fixture nativa do Forge com Craw Wurm
  e Lure contra dois Hill Giants. O teste determinístico e o browser confirmam 3+3, morte das três criaturas e vida
  do defensor inalterada. A ponte valida também atropelar, toque mortífero e ordem quando exigida pelo Forge.

Limitação do bot aleatório: `smoke-combat` raramente vê a IA atacar enquanto tem criaturas; o bloqueio pelo humano
continua coberto pelo teste manual, e a distribuição de dano pelo cenário determinístico.

Critério de feito: atacar, escolher alvo em 4 jogadores, bloquear e distribuir dano funcionam no browser; os três testes de fumo passam.

## Passo 2 — Importar decks (feito no ramo `feat/deck-import`)

Feito: `DeckImporter.java` (pré-visualizar, guardar, apagar; `listDecks` devolve `mine` + `commander`; `MatchStarter`
procura primeiro nos decks do utilizador), ecrã `ImportDeck.tsx` (pré-visualização linha a linha com motivo em tooltip,
legalidade, nome), `Home` com grupos "Os meus decks" / "Pré-construídos", apagar deck, e `scripts/smoke-import.mjs`.
Falta só o ponto 4 (link do Moxfield), opcional.

Plano original:

Objetivo: colar uma lista (Moxfield, Archidekt, MTG Arena, MTGO) e jogar com ela.

O Forge já tem tudo: `forge-core/.../deck/DeckRecognizer.java` (reconhece cada linha) e
`forge-gui/.../deck/DeckImportController.java` (`parseInput(text)` → tokens com estado por linha; `accept(name)` → `Deck`;
deteta o comandante; `setGameFormat(GameType.Commander)`).

1. **Motor** — mensagens novas em `EngineServer` (correr no executor `ui-actions`):
   - `previewDeck {text}` → `deckPreview {lines:[{text, status: ok|unknown|warning, message}], commander, cardCount}`.
     Usar `DeckImportController` com `GameType.Commander`; as mensagens vêm de `getTokenStatusMessage`.
   - `saveDeck {text, name}` → guarda com `FModel.getDecks().getCommander().add(deck)` (pasta de decks do utilizador, já
     dentro do nosso diretório de dados) e responde `decks`.
   - `listDecks` passa a devolver `{commander: [...], mine: [...]}` (os do utilizador primeiro).
   - `MatchStarter.startCommander`: procurar o nome primeiro nos decks do utilizador, depois nos pré-construídos.
   - Validar legalidade: `DeckFormat.Commander.getDeckConformanceProblem(deck)`; mostrar o problema, não bloquear.
2. **UI** — ecrã `ImportDeck.tsx` acessível do `Home` (botão "Importar"): caixa de texto, pré-visualização linha a linha
   (cartas desconhecidas a vermelho, com o motivo em tooltip), nome do deck, guardar. A lista de decks do `Home` separa
   "Os meus" e "Pré-construídos". Strings em `i18n.ts`.
3. **Teste**: script `scripts/smoke-import.mjs` que importa uma lista conhecida (incluir no repo em `scripts/fixtures/`), confirma
   0 desconhecidas, guarda, começa uma partida com esse deck e concede.
4. **Depois (opcional)**: importar por link do Moxfield (API não oficial `api2.moxfield.com/v3/decks/all/<id>`; pode mudar
   sem aviso — tratar falhas com elegância e sugerir colar o texto).

Critério de feito: colar uma exportação do Moxfield de 100 cartas, guardar e jogar com ela.

## Passo 3 — Multijogador online

Implementado: adaptador `OnlineLobby`, criar/entrar/sair, lugares humanos/IA até 4,
decks, pronto, chat e ecrã `Lobby.tsx`. `WebGuiGame` usa `NetworkGuiGame` para aplicar os deltas do Forge; cancela o
temporizador de espera quando chega uma decisão nova. WebSocket e imagens continuam em loopback.

Validação local: motor e UI compilam; `engine:smoke-online` executa dois motores com dados temporários, verifica
lobby/chat/decks/permissões, privacidade das mãos, avanço até ao turno 4, concessão remota e reutilização da porta.
O lobby foi verificado no browser. Falta validar em duas máquinas reais na LAN, compatibilidade com Forge desktop,
reconexão prolongada e abertura de porta por UPnP num router real. O endereço WAN descoberto não confirma acesso externo.
Também passou a variante com dois humanos + uma IA (`SMOKE_ONLINE_AI=1`), até à vitória da IA após as concessões.
Regressões: arranque, partida local, importação e combate passaram (combate na repetição; a primeira execução ficou sem
thread de jogo, sem diagnóstico guardado). Na repetição, o estado incluiu ataques e bloqueadores da IA.

Objetivo: jogar contra outras pessoas (2–4 jogadores, humanos e IAs misturados).

Abordagem: **usar o netplay do Forge**. O Forge tem servidor e cliente (Netty), lobby e sincronização:
- Anfitrião: `forge-gui/.../gamemodes/net/NetConnectUtil.host(IOnlineLobby, IOnlineChatInterface)` cria
  `ServerGameLobby` e arranca `FServerManager` na porta `FNetPref.NET_PORT`.
- Cliente: `NetConnectUtil.join(url, ...)` cria `FGameClient(nome, gui, host, porta)` com
  `gui = GuiBase.getInterface().getNewGuiGame()` e um `ClientGameLobby`.
- O cliente recebe o jogo como chamadas `IGuiGame` — exatamente a interface que o nosso `WebGuiGame` implementa. Por isso a
  mesma UI serve para jogos locais e remotos; e, em princípio, é compatível com jogadores no Forge desktop.

Passos:
1. **Motor — sessão de lobby**: classe `OnlineLobby implements IOnlineLobby, IOnlineChatInterface` por ligação UI;
   `HeadlessGui.getNewGuiGame()` passa a devolver um `WebGuiGame` ligado à sessão atual (guardar a sessão ativa num campo
   estático/thread-safe, uma sessão de cada vez).
2. **Mensagens**: `hostGame {port?}` → `lobby {...}`; `joinGame {address}`; `lobbyUpdate {slots:[{type: human|ai|open|closed,
   name, deck, ready}]}`; `setSlot {index, type, deck}`; `setReady`; `chat {text}` ↔ `chatMessage`; `leaveLobby`.
   Mapear de `GameLobby`/`LobbySlot`/`ILobbyView.update`. O anfitrião começa a partida quando todos estão prontos
   (o `ServerGameLobby` do Forge trata do arranque e chama `getNewGuiGame` para cada humano remoto).
3. **UI**: ecrã `Lobby.tsx` (slots, deck por slot, pronto, chat, endereço para partilhar com botão de copiar — usar
   `NetConnectUtil.collectHostedServerAddresses()`), e no `Home` "Criar jogo online" / "Entrar". A mesa não muda.
4. **Testar em local** com duas instâncias: motores em portas diferentes e pastas de dados diferentes (`--data`), e
   `FNetPref.NET_PORT` diferente para o servidor. Script de fumo com dois clientes WebSocket a jogar um contra o outro.
5. **Internet**: o anfitrião precisa de porta aberta. O Forge tenta UPnP (`FServerManager`); mostrar o endereço externo e
   explicar a falha em tooltip. Fase posterior: servidor intermediário (relay) para quem não pode abrir portas — projeto à parte.
6. Segurança: só aceitar eventos do protocolo do Forge; nunca expor o WebSocket da UI (continua em 127.0.0.1); a porta do
   jogo é a única aberta.

Notas do estudo que orientou a implementação:
- `NetConnectUtil.join(url, onlineLobby, chat)` chama `GuiBase.getInterface().getNewGuiGame()` → é aí que a
  `HeadlessGui` deve devolver um `WebGuiGame` da sessão; depois `FGameClient(nome, gui, host, porta).connect()`, e um
  `ClientGameLobby` recebe o estado por `ILobbyListener.update(GameLobbyData, slot)`. Se o gui for `AbstractGuiGame`,
  chama `setClientLobby(lobby)`.
- `NetConnectUtil.host(onlineLobby, chat)` cria `ServerGameLobby`, `FServerManager.startServer(NET_PORT)`; o lobby avisa
  mudanças via `IUpdateable.update(fullUpdate)` (o nosso `ILobbyView`). Mudanças de slot vão por
  `UpdateLobbyPlayerEvent` (`deckUpdate`, `isReadyUpdate`, `nameUpdate`, `create(type,...)`) e
  `GameLobby.applyToSlot(index, event)`; no cliente, `view.setPlayerChangeListener` envia o evento ao servidor.
- `GameLobby.startGame()` devolve um `Runnable` (ou null + `SOptionPane` se faltar algo: <2 jogadores, slot não pronto,
  sem deck). Para Commander, aplicar `lobby.applyVariant(GameType.Commander)`. Usa `getGui(slotIndex)` por slot humano.
- `LobbySlot`: tipo (`LOCAL`/`REMOTE`/`AI`/`OPEN`), nome, equipa, pronto, deck, perfil de IA. `GameLobbyData.slots`.
- `IOnlineLobby { setLobby(GameLobby) → ILobbyView; setClient(FGameClient); closeConn(msg) }`,
  `IOnlineChatInterface { setGameClient(IRemote); addMessage(ChatMessage) }`.

Riscos: `ProtocolGuiGame`/`NetworkGuiGame` (lado cliente) chamam métodos que o `WebGuiGame` não sobrepõe (ex.:
`applyDelta`, `setGameView(view, seq)`); verificar cedo com dois clientes e acrescentar o que faltar. Reconexão.

Critério de feito: duas máquinas na mesma rede jogam uma partida de Commander completa; uma terceira entra como espectador ou IA.

## Passo 4 — Completar a mesa (fase 1 da lista de ecrãs)

Menu e paragens integrados em `main` no commit `deaf7e6`:
- `GameMenu.tsx`: mudar skin durante a partida, configurar paragens, repor as iniciais e conceder com confirmação do Forge.
  Fecha com Escape e dá precedência a escolhas obrigatórias. Idioma continua no Home, fora da partida.
- `Settings`: paragens separadas para o teu turno e os adversários, gravadas em `reforge.properties` por escrita atómica.
  Mantêm as paragens anteriores por omissão; desvirar não é selecionável. Aplicam-se imediatamente pelo mecanismo de
  `YieldUpdate` do Forge, incluindo no anfitrião para o jogador remoto.
- `engine:smoke-settings`: validação sem alterações parciais, lista vazia, persistência após reiniciar, paragem real na
  manutenção e avanço sem OK ao removê-la; skin a meio da partida, bloqueio de idioma e reposição dos valores iniciais.
- `engine:smoke-online` verifica também uma alteração de manutenção para compra no cliente remoto durante a partida.
- UI verificada no browser nas quatro skins e a 390 px: alteração de paragens, reposição, Escape, cancelar e confirmar
  concessão. Motor e UI compilam.
- Passaram os testes de paragens, online, partida local e combate (com ataques e bloqueios presentes no estado).

Auditoria dos diálogos concluída no ramo `feat/dialog-audit`:
- Validação no motor: seleções únicas e com cardinalidade correta, permutações completas, inteiros dentro dos limites,
  mínimos/máximos por destinatário, dano letal antes de destinatários posteriores quando necessário e antes de atropelar.
  Respostas inválidas repetem a escolha com novo id; o adiamento de dano respeita `maySkip`.
- Número com limites próprios, incluindo valores negativos e acima de 100; cancelamento preserva `null`.
- Ordenação com setas, inserção de novos itens, organização no topo/fundo do grimório com cartas fixas preservadas,
  procura em listas longas e pré-visualização das cartas. Revelações adiadas são apresentadas antes da escolha.
- Privacidade: opções ocultas não enviam nomes nem detalhes; revelar cartas não revela o resto do grimório.
- `engine:smoke-dialogs`: callbacks de dano, atropelar, toque mortífero, limites por alvo, cores de mana, números,
  modos, gatilhos, inserção, organização, scry/surveil nativos, procura, revelação e alvo opcional. Rejeita dez casos
  inválidos e resolve o combate real com dois bloqueadores. O launcher vive nas fontes de teste, fora do jar distribuído.
- Verificados no browser os mesmos diálogos e o combate até à segunda fase principal, com 3+3 no registo e as mortes
  esperadas. Diálogo de dano verificado também a 390 px. Motor e UI compilam; regressões de definições, online,
  importação, partida local e combate passaram (esta execução aleatória de combate teve ataques, sem bloqueios).

Por fazer neste passo: opções de IA, imagens e consulta das zonas. Sideboard entre jogos e escolhas de modos futuros
ficam para os respetivos modos; o Commander atual tem uma partida de um jogo.

- **Menu durante a partida**: mudar skin, idioma (só fora de partida), conceder, opções. A skin pode mudar a meio (`setSkin`).
- **Opções de jogo**: paragens por fase configuráveis em `Settings` (feito); velocidade e
  perfil da IA (`AiProfileUtil`), tempo limite da IA.
- **Auditoria dos diálogos**: concluída para os callbacks usados pela mesa atual; ver validação acima. Mulligan, alvos
  e pagamento por terrenos acionáveis mantêm os caminhos de entrada do Forge cobertos pelas partidas de fumo.
- **Imagens**: fichas (chaves `t:` → `ImageUtil.getScryfallTokenDownloadUrl`), e imagens no idioma escolhido quando o Scryfall
  as tem (tentar `lang`, cair para inglês; incluir a língua no nome do ficheiro em cache).
- **Layouts por skin** (opcional): o Terminal com adversários em lista e tabela de atacantes, como no estudo de design.
- **Zonas**: ver cemitério/exílio/biblioteca completos (overlay com as cartas).

## Passo 5 — Decks e coleção (fase 2)

Lista de decks, editor (catálogo à esquerda, deck à direita, curva de mana, validação de formato), catálogo de cartas com
filtros, escolha de impressão/arte. Base: `FModel.getMagicDb()` para o catálogo, `DeckFormat` para validar,
armazenamento em `FModel.getDecks()`.

## Passo 6 — Instalador Windows (ramo `feat/packaging`)

Estado: `scripts/package.mjs` (UI + motor + runtime Java com `jlink` + `electron-builder` NSIS por utilizador),
`desktop/main.cjs` com caminhos de recursos empacotados, janela de carregamento, instância única. A primeira build parou
no `jlink` por causa de espaços no caminho; a correção (não usar shell para executáveis) está no ramo mas **não foi testada**.

Por fazer: rebase sobre `main`; correr `npm run package`; instalar e testar (arranque, imagens, dados em `%APPDATA%\RE-Forge`);
o recurso `forge-gui` tem de ser gravável (instalação por utilizador) porque o motor escreve lá `forge.profile.properties`;
ícone da app; tamanho (~200 MB sem `adventure/` e `music/`).

## Passo 7 — Modos (fases 3–4)

Draft e Sealed (`forge-gui/.../gamemodes/limited`), torneio, puzzles, Quest, Adventure. Cada modo reaproveita a mesa.

## Ideias / mais tarde

Android (mesma UI num WebView com o motor Java no dispositivo), animações (cartas a entrar, dano), sons, estatísticas,
replays (o Forge já grava; desligado por agora).
