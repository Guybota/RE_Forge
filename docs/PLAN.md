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

Integração da Central de decks (27/10/2026, `feat/central-integration`, sobre `central/deck-tools`):
- A mesa duplicada foi removida. O Play usa a build atual do RE:Forge num iframe isolado, com o protocolo,
  skins, escolhas, pesquisa na biblioteca e restantes modos existentes.
- As listas externas são verificadas pelo Forge e jogadas em memória (`startDeckMatch`), sem escrever na
  coleção de decks. Nomes iguais não substituem dados; cartas desconhecidas impedem iniciar uma lista incompleta.
- Arranque partilhado durante a inicialização, reutilização do motor do Electron, Java correto no Windows e
  nova tentativa após falha. Central abre pelo menu do desktop, com origem local estável para manter a biblioteca.
- Workspace e build conjunta, recursos standalone incluídos no empacotamento e workflow de validação.
  O commit mais recente do colaborador também tinha imports de pesquisa em falta; foram completados.
- Verificação nativa: duas listas diferentes com o mesmo nome jogaram e concederam sem alterar o deck guardado;
  correlação de previews e rejeição de cartas desconhecidas passaram. Testes UI existentes e do launcher passaram.
  Build conjunta e TypeScript passaram, tal como os 15 testes do Central em produção. Browser a 844×390 e
  texto a 200% sem overflow horizontal; ordenação, pesquisa na biblioteca, listas inválidas e repetição após falha.
  Servidor standalone e subprocesso real do Electron a partir de ASAR passaram com perfis temporários.
  O percurso de seleção nativo existente também passou, incluindo decks próprios/pré-construídos com o mesmo nome.
  Verificação adicional no browser com o JAR real: Central → mesa atual → partida Commander com Giada;
  o deck guardado com o mesmo nome manteve a lista original com Ezuri. Todos os dados foram temporários.
  Commit, integração por fast-forward na main e instaladores Windows/macOS 0.1.7 autorizados pelo utilizador.
  Desktop e motor alinhados em 0.1.7; distribuição em validação.
  A inspeção do ASAR final encontrou o servidor Central em extraResources; o caminho de arranque foi corrigido
  e o teste de regressão passou a executar o IPC real do main em modo de desenvolvimento e distribuição.

Design e acessibilidade: plano aprovado com os 12 pontos da auditoria em [DESIGN_PLAN.md](DESIGN_PLAN.md).
Primeira entrega implementada num worktree dedicado, ramo `feat/design-accessibility`: navegação,
definições partilhadas, contraste, estados das cartas, instruções/confirmações da mesa, texto até 200%,
inspeção universal e orientação em Adventure. Build e sete testes UI passam; testes visuais em landscape.
O início passou a biblioteca lateral com os modos mais jogados, no ramo `feat/library-home`.
O seletor de decks passou a lista com pré-visualização no ramo `feat/deck-picker` (27/10/2026).
Falta arte nos seletores de campanhas. Ver progresso e limites nesse plano.

Trabalho atual (27/10/2026, `feat/deck-picker`):
- Lista de decks com pesquisa por nome/comandante em português e inglês, filtros de origem/identidade e favoritos locais.
  Pré-visualização com arte real e inspeção, contagem de cartas e escolha de cada parceiro. Os resumos vêm do Forge;
  chegam num único catálogo, sem números ou comandantes inventados. Aleatório mantém a escolha nativa.
- Origem explícita no início da partida, para escolher corretamente entre deck próprio e pré-construído com o mesmo nome.
  Testes UI e teste nativo cobrem traduções, parceiros, duplicados, remoção e armazenamento indisponível.
- Aviso de imagens indisponíveis no idioma escolhido, com percentagem ponderada pelas cópias do deck e comandantes.
  Verifica as edições exatas em segundo plano, deteta placeholders e distingue falhas de rede de imagens em falta.
  Cache em memória, cancelamento ao trocar de seleção/idioma e opção de repetir verificações incompletas.
  `engine:smoke-deck-language` valida cópias, parceiros, edições, placeholders, HTTP e cancelamento.
  Browser: 100% real e 1/100 com 99 terrenos Alpha; 1280×720 e 844×390, texto a 200% sem overflow horizontal.
- Mesa: turno/fases/espera no topo, Menu/Registo no canto superior direito, ações nativas no canto inferior direito e
  campos encostados. A mão partilha o rodapé com as ações; a stack ocupa só a altura dos campos. O foco não desloca o cabeçalho.
  Verificados no browser os botões Manter, Cancelar, pagamento automático e Resolver, incluindo stack aberta.
  Mesa de dois/quatro jogadores: distância entre os campos = 0. As setas foram mantidas no referencial da janela
  e acompanham a abertura da stack; erro medido de 0 px na origem e no alvo após o reflow.
- Entrega Windows 0.1.6 (27/10/2026): versão do desktop e do motor alinhada. Builds passaram e os recursos finais
  passaram `package:smoke` com Java incluído, 33.591 cartas, 180 pré-construídos, resumos/comandantes do seletor,
  importação e persistência de decks/definições/campanhas, e início de partida com origem explícita do deck.

Trabalho atual (26/10/2026, entrega 0.1.5 no ramo `feat/library-home`):
- Biblioteca lateral: seis modos, Decks/Online/Definições estáveis, destaque e até três modos mais jogados.
  Histórico local conta partidas/sessões confirmadas pelo motor; navegar, falhar ou repetir snapshots não conta.
- Moeda inicial ligada ao evento real do Forge, antes de mulligans e turno 1; modal e bloqueio síncrono de ações/respostas.
- Topo da biblioteca visível e jogável quando o Forge permite, incluindo custo em vida da Citadel. Cartas desconhecidas
  não atravessam a ponte. Verificados Future Sight, Oracle, Courser, Mystic Forge, Vizier e Reality Chip com/sem ligação.
- Scry, Surveil (uma/várias cartas), Explore e ordenação do topo usam o mesmo componente com destinos explícitos.
  Mantêm os contratos nativos: permutação completa no Scry, subconjunto ordenado no Surveil e OK/Cancelar no Explore.
- Arranque Electron com barra de progresso ligada à leitura real de cartas e ligação da UI com indicador de carregamento.
- Build UI/motor e testes `ui:smoke-home`, `ui:smoke-animations`, `ui:smoke-library-choice`,
  `desktop:smoke-startup`, `engine:smoke-library` (11 cenários) e `engine:smoke-look` (pt/en) passaram.
  Todos os testes usam perfis temporários. Não há alterações ao Forge upstream.
- Distribuição Windows 0.1.5 pedida pelo utilizador, com commit e push do ramo autorizados.
  Recursos finais passaram `package:smoke`: Java incluído, 33.591 cartas, 180 pré-construídos, catálogo,
  importação, persistência de decks/definições/campanhas e início de partida. A barra de arranque está no ASAR
  e a versão do motor coincide com o desktop. Esta entrega não recompila os DMG de macOS.

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
4. **Feito (`feat/deck-import-plus`)**: links públicos do Archidekt e do Moxfield (API não oficial
   `api2.moxfield.com/v3/decks/all/<id>`, pode mudar sem aviso: erro traduzido e colar o texto continua a funcionar),
   ficheiros MTGO `.dek`/Forge `.dck`/texto (botão ou largar sobre a lista), comandante implícito (parceiros no
   sideboard, 1–2 comandantes depois da última linha em branco) ou escolhido na lista, e sugestões para cartas
   desconhecidas (erros de escrita, nomes parciais ou em português).

Critério de feito: colar uma exportação do Moxfield de 100 cartas, guardar e jogar com ela.

## Passo 3 — Multijogador online

Salas por código implementadas localmente no ramo `feat/online-relay`: Worker Cloudflare com Durable Objects SQLite,
ponte Java TCP/WebSocket sobre o protocolo Forge, códigos de oito caracteres e escolha entre código e ligação direta.
Configuração e limites em [ONLINE_RELAY.md](ONLINE_RELAY.md). Publicado em `reforge-relay.tempo-portugal.workers.dev` (0.1.1).
Quedas (`fix/online-resilience`, após o jogo de 25/10 em que o anfitrião "perdeu" quando a ligação ao relay caiu):
uma ligação que cai já não acaba o jogo; o relay guarda a sala e a reconexão nativa do Forge retoma os jogadores.
Registo do motor em ficheiro na app instalada.
Lobby (`feat/online-kick`): o anfitrião expulsa jogadores; sair, fechar a janela ou o anfitrião fechar a sala nunca
deixam a sessão presa (antes, em ligação direta, o convidado ficava 2 min à espera da reconexão do Forge).
Validação: UI e motor compilam; testes do Worker, partida com quatro humanos e partida com dois humanos + IA pelo
relay local passam. Cobrem privacidade, paragens remotas, cancelar/conceder e criar outra sala. `OnlineController`
liberta o input do humano remoto depois de uma concessão individual, sem alterar o Forge nem enviar outro RPC.
A regressão direta com dois motores também passou. Verificado no browser: criação/entrada por código, erro de sala
inexistente em português, copiar o código e sair. Publicação e ligação entre redes reais continuam por validar.

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
5. **Internet**: por código, os jogadores ligam-se de saída ao relay e o anfitrião executa o Forge. Em ligação direta,
   o anfitrião precisa de porta acessível; o Forge pode tentar UPnP (`FServerManager`). O endereço externo descoberto
   não garante acesso. Ver configuração e limites do serviço em [ONLINE_RELAY.md](ONLINE_RELAY.md).
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

Mesa ao estilo Arena (`feat/arena-table`): "Passar nos turnos dos adversários" no menu da partida (a preferência nativa
`YIELD_AUTO_PASS_NO_ACTIONS` do Forge, ligada só no turno de um adversário, também para jogadores remotos; bloqueios e
escolhas obrigatórias continuam a ser pedidos), equipamentos/auras/fortificações desenhados por trás do permanente a que
estão anexados (também no campo de outro jogador) e zoom com marcadores e keywords explicadas (21 keywords comuns
traduzidas; as outras com o texto de lembrete do Forge, só em inglês). Testes: `engine:smoke-autopass`, cenário
`attachments` do `DialogHarness`. Limite conhecido: num convidado remoto a troca de turno chega com atraso de rede, por isso
a primeira prioridade do próprio turno pode ainda ser passada se não houver nada para jogar.

Ajustes da mesa (`feat/stack-hover-fast-forward`, 26/10/2026): o zoom flutuante ancora-se na carta sob o ponteiro,
incluindo cartas e habilidades na stack; inspeção da stack usa os mesmos gestos da mão e do campo. Removida a dica
visual de clique direito/tecla I, mantendo a descrição e atalhos para leitores de ecrã. Botão de avanço rápido na barra:
usa um marcador nativo do Forge até à próxima manutenção do jogador, passa respostas aos adversários mesmo havendo
cartas jogáveis e interrompe quando o jogador é atacado. Bloqueios e escolhas continuam manuais; o botão permite
cancelar e não altera preferências guardadas. Sobrescritas de interrupções vivem só no controlador e são repostas no fim.
UI e motor compilam; `engine:smoke-fastforward`, `engine:smoke-autopass` e `ui:smoke-design` passaram.
Zoom e inspeção da stack e ativação do botão até ao regresso ao turno próprio verificados no browser em landscape.
Incluído na atualização da mesma versão 0.1.4 solicitada pelo utilizador. O pacote Windows final passou
`package:smoke`; o Java/JAR distribuído passou também `engine:smoke-fastforward`.

Feedback da mesa ao estilo Arena (`feat/table-feedback`, levantamento em [TABLE_FEEDBACK.md](TABLE_FEEDBACK.md)): quem tem
a prioridade ("Decides tu" / "A pensar"), "À espera de {nome}" com segundos, botão Resolver/Passar que pulsa quando
podes responder, item da stack que resolve a seguir, setas da stack para os alvos (cartas e jogadores), aviso do teu
turno, vida a subir/descer, permanentes a sair do campo e sons de prioridade, resolução, dano, vitória e derrota.
A ponte envia `priorityPlayerId` e `prompt.priority`. Propostas por aprovar: vida baixa, dano da fonte ao alvo, relógio
online, seta ao escolher alvos, emotes.

Passo 4 concluído.

Passo 5 (`feat/deck-builder`): construtor com catálogo e filtros, comandante e identidade de cor, curva de mana,
validação do Forge, impressões e novo deck. Estatísticas, artes e parceiros (`feat/deck-builder-stats`). Falta: coleção e filtros avançados (texto, raridade, edição). Sideboard entre jogos e escolhas de modos futuros
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

### Melhorias do builder (`feat/deck-builder-stats`)

- Seletor visual de artes/edições com pesquisa por edição ou número, identificação da versão atual e metadados
  de cada arte. A impressão mantém-se ao guardar, reabrir e exportar; terrenos básicos com artes diferentes
  continuam independentes, e escolher a mesma impressão agrega as quantidades.
- Separador Estatísticas: curva empilhada (permanentes / instantâneas e feitiços), média com e sem terrenos,
  mediana, mana total, percentagens das cores das cartas sem terrenos, símbolos nos custos e fontes potenciais
  dos terrenos. Clicar num custo ou cor filtra a lista; comandantes são opcionais nas estatísticas.
- Calculador hipergeométrico de compras: terrenos por omissão, ou as cartas selecionadas no gráfico; usa só o
  grimório, sem comandantes. A produção de mana usa subtipos básicos e habilidades nativas da face principal,
  incluindo Torre de Comando pela identidade conjunta. Não estima fetchlands, fontes refletidas ou produção
  variável; custos/condições não são simulados. Estes limites estão nos tooltips.
- Adicionar parceiro abre só candidatos compatíveis segundo `CardRules.canBePartnerCommanders`: Partner,
  Partner with, Friends forever, Choose a Background e Doctor’s companion. Até dois comandantes; mudar o
  comandante principal devolve os anteriores ao deck. A identidade de cor combina os dois. Pedidos do catálogo
  têm identificação para ignorar respostas antigas quando mudam os filtros ou o comandante.
- Verificação: UI e motor compilam; `ui:smoke-builder` cobre quantidades, curva, híbridos, fontes, médias,
  probabilidades e preservação de artes. `engine:smoke-builder` cobre as cinco famílias de parceiros,
  combinações inválidas, identidade conjunta, save/reload dos parceiros e da impressão e exportação.
  Fluxos reais verificados no browser com dados temporários: Tymna + Thrasios, Ulamog CMM #670, filtros de
  custo e seletor de artes, incluindo a 390 px. O Forge upstream não foi alterado.

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
  Evita copiar cerca de 35 mil ficheiros individuais na instalação. Adventure inclui os recursos comuns usados pela
  ponte (configuração, mapas, mundo, decks e sprites) e `Shandalar/world`; outros mundos e música ficam excluídos.
- `npm run package:smoke` usa exclusivamente o runtime/JAR/recursos distribuídos e dados temporários: primeiro arranque,
  catálogo, pré-construídos, importação de 100 cartas, persistência após reiniciar e início de partida local.
  Cobre também os starters de Quest e a criação de Adventure, retratos, sprites, terrenos, mapa de caverna e
  persistência da campanha. O perfil do Forge é isolado numa pasta temporária, mesmo ao testar a instalação.
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

Correção de recursos de Adventure (`feat/campaign-package-assets`, 26/10/2026): o pacote anterior só incluía parte de
`common`, sem `Shandalar/world` nem `common/sprites`; abrir campanhas falhava com o caminho de `shops.json`.
O teste do pacote reproduziu o erro antes da correção e passou após gerar a pasta da aplicação corrigida, incluindo
campanhas e imagens. As duas pastas em falta foram acrescentadas à instalação local e verificadas por hash;
o mesmo teste passou nessa instalação, com dados temporários.
Verificação no browser com o JAR, Java e recursos instalados: menu sem erro, criação e mapa de Shandalar com herói visível.
Distribuição retomada a pedido do utilizador: instalador `dist-app/RE-Forge-Setup-0.1.4.exe`, com a versão do motor,
Electron e lockfile alinhadas. UI e motor compilam; `package:smoke` passou nos recursos finais da versão 0.1.4.

macOS solicitado pelo utilizador (26/10/2026): empacotamento nativo em DMG para Apple Silicon e Intel, cada um com
Java 21 da mesma arquitetura, pelo workflow `package-macos.yml`. Assinatura ad-hoc de teste, sem notarização Apple.
O perfil gravável do Forge fica fora do `.app`, com um link para os recursos incluídos; mover a app atualiza esse link.
O workflow verifica e monta cada DMG em modo de leitura e executa os testes do pacote e avanço rápido no Java incluído.
Apple Silicon e Intel passaram build, verificação do DMG, testes do pacote e de avanço rápido na execução
[40367894938](https://github.com/Guybota/RE_Forge/actions/runs/40367894938). Os testes usam dados temporários.
Não houve verificação visual manual do `.app` num Mac físico; os pacotes continuam versões de teste sem notarização.

## Passo 7 — Modos (fases 3–4)

Draft e Sealed (`forge-gui/.../gamemodes/limited`), torneio, puzzles, Quest, Adventure. Cada modo reaproveita a mesa.

Opções da IA (perfil por omissão e tempo para pensar) nas definições, e melhor de 3 no Draft/Sealed com sideboard
entre jogos (`feat/ai-tokens-bo3`). As fichas no idioma não são possíveis com imagens reais: o Scryfall não tem
fichas em português (0; 2 em espanhol, 39 em japonês) e o Forge não traduz os nomes das fichas.

Draft, Sealed e Puzzles (`feat/limited-puzzles`): menu principal com seis modos. Sealed abre 6 pacotes da edição
escolhida (195 edições com boosters) e gera 3 adversários com pools próprias; Draft com 7 IA do Forge (3 pacotes).
Construção do deck a partir da pool com terrenos básicos grátis, mínimo de 40 (`DeckFormat.Limited`), eventos
guardados no armazenamento draft/sealed do Forge e resultado por adversário. Puzzles: os 376 do Forge, por
dificuldade, com objetivo e limite de turnos na mesa; resolvidos marcados. `engine:smoke-limited` cobre tudo;
verificado no browser (incluindo 375 px). Fora: torneio/gauntlet com progressão, draft guardado a
meio (fecha com a ligação), cubos/edições personalizadas e descrições dos puzzles traduzidas.

Adventure e Quest têm uma primeira integração na interface RE:Forge: campanhas guardadas, coleção/deck e duelos;
Quest usa os controladores nativos de economia/loja e Adventure permite explorar três cavernas dos recursos originais.
O utilizador testou o ciclo básico e indicou que parece funcionar (25/10/2026). A distribuição foi retomada a seu pedido
na versão 0.1.4 (26/10/2026) para incluir todos os recursos necessários às campanhas de Adventure.

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
