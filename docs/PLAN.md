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

Instalador retomado no ramo `feat/windows-installer`, sobre a `main` atual, sem commits nem merges.
O ramo antigo `feat/packaging` (`3bca02e`) está preservado — ver passo 6.

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

Imagens concluídas no ramo `feat/card-images`:
- Fichas (`t:`) resolvidas pelos dados de edição do Forge (`CardEdition.getTokens`, `getTokensCode`), incluindo verso.
- Imagens no idioma escolhido (`lang` no pedido, códigos do Scryfall); se a tradução não existe (404/422), usa o inglês e
  guarda-o para esse idioma. Falhas temporárias (rede, 5xx, resposta que não é JPEG) não ficam em cache e voltam a ser
  tentadas; o browser não guarda essas respostas (`no-store`). Cache separada por idioma; a cache antiga (só inglês) continua
  válida. Pedidos iguais em simultâneo partilham um download.
- Imagens provisórias do Scryfall ("Localized Image Not Available", `image_status: placeholder`) contam como tradução em falta.
- `engine:smoke-images` (`ImageHarness`, Scryfall simulado) e verificação real: carta em português, ficha e cache por idioma.

Zonas (`feat/zones`): os contadores de cemitério e exílio abrem `ZoneViewer` com as cartas; o contador fica destacado
quando há uma carta jogável (flashback) e essa carta é lançada dali. Cartas viradas para baixo continuam escondidas.
Verificado no browser com `DialogHarness --scenario zones`.

Opções de IA (`feat/ai-options`): no início, um perfil de IA do Forge por adversário (Normal, Cautelosa, Imprudente, Difícil,
Muito difícil, Experimental ou Aleatório), lembrado no browser/Electron (`localStorage`). `smoke-match` recusa um perfil
desconhecido e joga com perfis escolhidos. Os lugares de IA do lobby online continuam com o perfil padrão.

Mesa multiplayer (`feat/multiplayer-layout`): permanentes iguais agrupadas (×N), campos dos adversários compactos numa só
fila, ampliar um adversário pelo nome (os outros ficam só com o cabeçalho), maximizar o campo de um adversário sobre a mesa,
painel lateral que abre e fecha e regras para janelas baixas. Verificado em
1440×900 e 1280×720 com `DialogHarness --scenario table`.

Auditoria visual (`fix/visual-audit`): mesa em telemóvel (painel em gaveta, adversários em linhas), cabeçalhos compactos numa
linha em todas as skins, custo escondido nas cartas pequenas, pré-visualização ao lado da carta, painel com a última carta
vista, imposto de comandante, sair para o início pelo menu, gramática portuguesa do Forge (ordinais e possessivos),
importação agrupada por tipo com imagem e impressões originais, ecrã online alinhado com a importação, nome lembrado.

Decks e zoom (`feat/decks-zoom`): ecrã Decks (ver agrupado, mudar nome, editar, exportar, apagar, jogar) e zoom de qualquer
carta com clique direito ou toque prolongado.

Passo 4 concluído.

Passo 5 (`feat/deck-builder`): construtor com catálogo e filtros, comandante e identidade de cor, curva de mana,
validação do Forge, impressões e novo deck. Falta: coleção, filtros avançados (texto, raridade, edição), estatísticas. Sideboard entre jogos e escolhas de modos futuros
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

## Passo 6 — Instalador Windows (ramo `feat/windows-installer`)

Trabalho retomado a partir da `main` com o construtor de decks, preservando o ramo antigo. Ainda sem commit.

- `npm run package`: UI + motor + runtime Java 21 com `jlink` + instalador NSIS x64 por utilizador.
  Executáveis chamados diretamente, incluindo o JDK num caminho com espaços; cache do runtime invalidada quando
  muda o JDK ou a lista de módulos. A build não publica releases.
- `scripts/mvn.mjs` fixa a raiz do reactor: evita a procura de `.mvn` até à raiz do disco que, numa shell restrita,
  podia imprimir `Access is denied` e terminar com sucesso sem uma build válida.
- Electron usa o Java e os recursos incluídos, mostra uma janela durante o carregamento e limita a app a uma instância.
  Inclui ícone próprio (fonte em `scripts/icon.ps1`), licença do Forge e diagnóstico de falhas do motor.
- Scripts de cartas e fichas empacotados no formato `cardsfolder.zip` já suportado pelo Forge, sem alterar upstream.
  Evita copiar cerca de 35 mil ficheiros individuais na instalação. `adventure/` e `music/` continuam excluídos.
- `npm run package:smoke` usa exclusivamente o runtime/JAR/recursos distribuídos e dados temporários: primeiro arranque,
  catálogo, pré-construídos, importação de 100 cartas, persistência após reiniciar e início de partida local.
  `SMOKE_PACKAGE_IMAGES=1` acrescenta uma imagem real do Scryfall e a cache após reiniciar.

Validação executada:

- UI e motor compilam; arranque e catálogo passam. Maven verificado também num caminho com espaços.
- Com o runtime Java reduzido: imagens (servidor simulado), partida até ao turno 4, diálogos/combate determinísticos
  e online entre dois motores locais passam, incluindo privacidade, paragens remotas e reutilização da porta.
- Instalador final `dist-app/RE-Forge-Setup-0.1.0.exe`: 248 277 350 bytes (cerca de 248 MB). Recursos do Forge reduzidos
  de 50 070 para 15 100 ficheiros com os arquivos nativos; instalação silenciosa numa pasta com espaços passou em 146 s.
- O teste do pacote com ZIP passou também diretamente nos recursos instalados: 33 591 cartas, 180 pré-construídos,
  importação de 100 cartas, definições/deck após reiniciar e início de partida. Uma imagem real do Scryfall foi
  descarregada e reutilizada da cache após reiniciar, sem reescrever o ficheiro. Todos os dados de teste são temporários.
- Desinstalador de teste terminou com sucesso, sem pedir remoção de dados da aplicação.

O Electron empacotado arrancou com `JAVA_HOME` inválido, PATH sem Java e APPDATA/perfil Chromium de teste. A janela
carregou a UI, mas um pedido de acesso do Windows Firewall bloqueou a verificação visual dos fluxos. O utilizador
está a comunicar remotamente e não consegue responder ao aviso; nenhuma opção de segurança foi alterada.

Por fechar: verificação visual completa e teste numa máquina limpa; validação LAN em duas máquinas continua no passo 3.
O recurso `forge-gui` tem de ser gravável porque o motor escreve lá `forge.profile.properties`; a instalação é por utilizador.

## Passo 7 — Modos (fases 3–4)

Draft e Sealed (`forge-gui/.../gamemodes/limited`), torneio, puzzles, Quest, Adventure. Cada modo reaproveita a mesa.

Adventure e Quest têm uma primeira integração na interface RE:Forge: campanhas guardadas, coleção/deck e duelos;
Quest usa os controladores nativos de economia/loja e Adventure permite explorar três cavernas dos recursos originais.
O utilizador testou o ciclo básico e indicou que parece funcionar (25/10/2026). Quer aprofundar funcionalidades e melhorar
a experiência antes de criar outro instalador; a nova distribuição fica adiada.

Mundo aberto de Adventure (`AdventureWorld`): Shandalar gerado por campanha a partir de uma semente guardada, com os
biomas, pontos de interesse e nomes de cidades originais numa grelha 175×175 (uma célula = 4×4 tiles). O jogador anda
tile a tile; a UI desenha os autotiles originais (`BiomeTexture`), variantes de terreno e decorações por tile a partir da
semente. Faltam as estruturas por wave-function collapse (florestas, ruínas) e as fronteiras de bioma seguem as células. As 197 cavernas/masmorras usadas abrem os mapas Tiled; cidades só restauram a vida (sem lojas);
160 inimigos errantes dos biomas, só os que têm deck `.dck`. Herói, inimigos, edifícios e tesouros usam os sprites
animados dos atlas libGDX originais (`AdventureSprites`); o herói é sempre o humano masculino (falta a escolha). Mapas com inimigos de deck gerado (78) dão erro ao combater.

Criação com escolha de herói (raças e sexo de `heroes.json`, retrato do avatar original); campanhas de Adventure e Quest
podem ser apagadas (a Quest apaga também o `.dat` nativo e o backup).

Animações da mesa: feitiços sobem ao centro e voam para a stack (também os do adversário, com a carta do item da stack),
permanentes entram a levantar/segurar/pousar, anel em lendárias e míticas (`rarity` no estado), marcadores e lealdade
pulsam, equipamento voa para o portador, cartas descartadas/moídas saem da mão/biblioteca para o cemitério ou exílio e
uma moeda mostra quem começa. Velocidade 0,5–2× e cada tipo desligável nas definições. Verificado no browser com o
cenário `animations` do `DialogHarness` (trajetórias medidas por JavaScript; as capturas são lentas demais).

Cidades exploráveis: entrar numa cidade abre o seu mapa Tiled (como as masmorras); estalagem (descanso grátis — no Forge
custa ouro), quem dá missões e lojas. Cada loja escolhe um tipo do `shops.json` como o `MapStage` (raridade da lista, sem
repetir na cidade), com tabuleta, stock gerado por semente com os filtros do Forge (`AdventureCards`: cores, tipos,
texto/regex, raridade, edições, uniões) e preços por raridade (`CardUtil.getCardPrice` sem lista de preços); compras
guardadas. Os objetos dos mapas desenham o seu próprio tile. Fora: comerciante de fragmentos, spellsmith, arena, lojas
de itens/boosters e reabastecer.

Missões secundárias (`AdventureQuests`): cada cidade dá uma missão do `quests.json` adequada ao seu tipo (diálogo de
oferta original, com escolhas), no máximo três ativas e uma por cidade. Etapas Derrotar/Caçar (inimigos da missão
aparecem perto da cidade), Viajar (concluída ao chegar), Limpar (masmorra com todos os inimigos jogáveis) e Sair;
recompensas e epílogo vindos dos diálogos do Forge. Alvos marcados no mapa (anel, ou seta na borda) e registo com
progresso e abandonar. Fora: missões da história e objetivos de arena, flags, itens e reputação. Textos das missões em
inglês (dados do Forge). `engine:smoke-quests` cobre ofertas em todas as cidades de 3 mundos até à recompensa.

Próximo bloco: lojas/estalagens, Quest (loja e
gestão da coleção) ou melhorias da mesa.

## Ideias / mais tarde

Sons implementados no trabalho atual: cliques, jogar cartas/terrenos, atacar, início de turno e passagem de fases.
Efeitos curtos sintetizados na UI, sem downloads; volume inicial de 40%, opção para desligar e preferências locais.
Controlos no menu principal e no menu da partida. As atualizações repetidas da mesa são silenciosas; habilidades
na stack distinguem-se de feitiços. Não toca enquanto a janela está oculta nem acumula sons antes da primeira interação.
`ui:smoke-sounds` valida os eventos, as cinco formas de onda, mute/volume, persistência e falhas do dispositivo de áudio.
Validação: UI e motor compilam; cenário `SMOKE_SOUND_FIXTURE=1` joga até ao turno 4 com cartas e ataques reais e confirma
os quatro efeitos do jogo. Controlos verificados no browser no menu principal e durante a partida, nas skins Mesa e
Terminal, incluindo preferências após recarregar. O instalador anterior ainda não inclui este trabalho.

Android (mesma UI num WebView com o motor Java no dispositivo), animações (cartas a entrar, dano), estatísticas,
replays (o Forge já grava; desligado por agora).
