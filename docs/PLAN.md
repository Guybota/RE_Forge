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

Ramo `feat/packaging` (`3bca02e`, **não juntado**): instalador Windows em curso — ver passo 6.

---

## Passo 1 — Combate (em curso, ramo `feat/combat`, por fazer commit)

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

Por fazer:
1. Distribuir dano entre vários bloqueadores (`assignCombatDamage` → diálogo `amounts`): verificar numa partida
   (não aconteceu nos testes).
2. O bot `smoke-combat` raramente vê a IA atacar enquanto tem criaturas; os bloqueios ficam cobertos pelo teste manual.

Critério de feito: atacar, escolher alvo em 4 jogadores, bloquear e distribuir dano funcionam no browser; os três testes de fumo passam.

## Passo 2 — Importar decks

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

Riscos: `ProtocolGuiGame`/`NetworkGuiGame` (lado cliente) chamam métodos que o `WebGuiGame` não sobrepõe (ex.:
`applyDelta`, `setGameView(view, seq)`); verificar cedo com dois clientes e acrescentar o que faltar. Reconexão.

Critério de feito: duas máquinas na mesma rede jogam uma partida de Commander completa; uma terceira entra como espectador ou IA.

## Passo 4 — Completar a mesa (fase 1 da lista de ecrãs)

- **Menu durante a partida**: mudar skin, idioma (só fora de partida), conceder, opções. A skin pode mudar a meio (`setSkin`).
- **Opções de jogo**: paragens por fase (hoje fixas em `WebGuiGame.isUiSetToSkipPhase` → passar a `Settings`), velocidade e
  perfil da IA (`AiProfileUtil`), tempo limite da IA.
- **Auditoria dos diálogos**: percorrer todos os métodos de escolha do `IGuiGame` e garantir que cada `kind` tem boa UI:
  mulligan, alvos, escolher cartas de uma lista (procurar no grimório, scry/surveil com `order`), escolher número, modos,
  pagar mana (clicar terrenos acionáveis), ordenar gatilhos, revelar. Usar `smoke-combat` + partidas no browser.
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
