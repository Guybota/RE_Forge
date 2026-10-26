# RE:Forge — guide for AI assistants and new contributors

A new desktop interface for [Forge](https://github.com/Card-Forge/forge), the open-source Magic: The Gathering
rules engine. Forge runs unchanged in Java; our UI is React inside Electron. **The roadmap and the next tasks are
in [docs/PLAN.md](docs/PLAN.md)** — read it before starting work. The wire protocol is in [README.md](README.md).

The project owner writes in Portuguese (Portugal). Reply in Portuguese unless asked otherwise.

## Layout

```
forge/      Forge source, git submodule. Treat as upstream: do not edit it.
engine/     Java bridge (package reforge.engine). Loads Forge headless, serves the UI over a local WebSocket.
ui/         React + TypeScript + Vite. Everything the player sees.
desktop/    Electron shell: starts the engine, opens the UI (main.cjs).
relay/      Cloudflare Worker + SQLite Durable Object rooms; tunnels Forge netplay over outbound WebSockets.
scripts/    mvn.mjs (Maven launcher), smoke tests, Windows package script.
pom.xml     Maven reactor: builds forge-core/game/ai/gui + engine together (Forge's ${revision} needs this).
docs/       PLAN.md (roadmap).
```

### Engine (engine/src/main/java/reforge/engine)

| File | Job |
|---|---|
| `Main` | Args (`--assets`, `--data`, `--port`, `--exit-with-parent`), writes `forge.profile.properties`, starts Forge, prints `READY <port>`. |
| `HeadlessGui` | Forge's `IGuiBase` with no windows. `invokeInEdt*` run inline. `getNewGuiGame()` creates a `WebGuiGame` for the active online session. |
| `EngineServer` | WebSocket server. Routes `hello`, `listDecks`, `setLanguage`, `setSkin`, `startMatch`, `action`, `answer`. UI actions run on a per-connection `ui-actions` executor. |
| `Session` | One UI connection: `send()` and blocking `ask()` (question → answer by id). |
| `WebGuiGame` | Forge's `IGuiGame` for the local human (extends `NetworkGuiGame`, including remote delta sync). Pushes `state` snapshots (debounced 40 ms) and turns every Forge question into a `choice`. Phase stops live in `isUiSetToSkipPhase`. `syncAutoPass` turns Forge's `YIELD_AUTO_PASS_NO_ACTIONS` on only during opponents' turns (local controller via the pref, remote via `setYieldPref`). |
| `OnlineLobby` | Forge netplay adapter: host/join, seats, ready, decks, chat, addresses, kick and cleanup. One online session per process; `close()` always releases it, step by step. A guest whose host vanishes outside a running game closes at once (`WebGuiGame.onReconnectStateChanged`) instead of waiting for Forge's 2-minute reconnect. Kick = a private system notice, then the host closes that guest's channel (Forge has no kick; the channel is read by reflection). |
| `RelayTunnel` | Native Forge TCP streams over a multiplexed WebSocket; outbound-only rooms configured by `RE_FORGE_RELAY_URL`. Separate bounded queues per guest (a full queue holds the relay back, never cuts the stream); local UI stays in loopback. A dropped link never ends the game: its streams close and Forge's netplay reconnection resumes the players — the host retries the room for ~3 min (the relay keeps it, the token replaces a stale link), each guest connection from Forge opens a fresh stream. Only a deliberate close (`Host left`) or a closed room ends it. Logs `Relay:` lines to stderr. |
| `OnlineController` | Adapts the remote wire controller to release its pending input after an individual concession; delegates rules and all other input to Forge's real human controller. |
| `GameSnapshot` | `GameView` → JSON `state`. Hides cards the player may not see. `priorityPlayerId` (Forge's `PlayerView.getHasPriority`, stale during non-priority decisions) and `prompt.priority` (the input is passing priority, from Forge's button labels). Translated names/types/text plus `typeEn`; `keywords` (Forge's enum name, title, detail and English reminder text). |
| `AmountAssignment` | Forge's damage/amount constraints: exact total, per-target bounds, lethal damage, ordering and trample. Shared validation and prompt metadata. |
| `MatchStarter` | Commander vs 1–3 AIs from Forge's precons, each with its chosen Forge AI profile (`res/ai`); sets the Forge prefs we rely on. |
| `ImageServer` | `http://127.0.0.1:<port>/card?key=&format=crop|full`. Downloads from Scryfall once (Forge's rate limiter), caches under `<data>/cache/reforge-art`. |
| `Settings` | `<data>/reforge.properties`: chosen `language`, `skin`, separate phase stops for own/opponents' turns and `autoPass` (sent with the stops), and the AI's default profile ("" = random; Limited, Puzzles) and thinking time (Forge's `MATCH_AI_TIMEOUT` choices), applied by `MatchStarter.preparePreferences`, which also makes the AI sideboard itself between games. Atomic writes; missing language/skin = first run. |
| `CardCatalog` | Deck builder catalog: `search` (Commander-legal, no Arena `A-` or Un-only cards, exact names first, 60 per page) and `printings`. `card()` fields are shared with decklist lines. |
| `Limited` | Best of 1 or 3 (`bestOf`); between games `WebGuiGame.sideboard` asks a `sideboard` choice (copies in deck/sideboard → `amounts`), the snapshot carries `match` (games, played, over, wins — counted by the bridge, since the game-over snapshot precedes Forge's outcome) and the UI's "Next game" sends `nextGame`. Draft and Sealed with Forge's own boosters (`CardBlock.getBooster`, no Forge dialogs), `BoosterDraft` (7 AI drafters) and `SealedDeckBuilder` (3 AI pools). A finished pool is an event: Forge's `DeckGroup` in its draft/sealed storage (player's deck: main + sideboard = pool; basic lands are free; results as `reforge-won/lost-N` deck tags). The draft in progress lives only in the connection. |
| `Puzzles` | Forge's `res/puzzle/*.pzl`: list (metadata read with `FileSection`, easiest first, solved = Forge's `.complete` marker) and start like the desktop puzzle screen. Uses the real GUI player (`getGuiPlayer(…, true)`) so the goal finds the human. The goal card never reaches the views, so the snapshot carries `puzzle`. |
| `Campaigns` | One open campaign per engine: routes `campaign` actions to `QuestCampaign` (Forge's native Quest) or `AdventureCampaign`; saves through `CampaignStore` (`<data>/user/reforge-campaigns`). |
| `AdventureCampaign` | Adventure character, deck and battles on `AdventureWorld` (seeded Shandalar: biomes, POIs, wandering enemies), `AdventureMap` (Forge's Tiled maps without libGDX), `AdventureSprites` (libGDX atlases as text) and `AdventureQuests` (side quests from `quests.json`: town offers, Defeat/Hunt/Travel/Clear/Leave stages, rewards from the epilogues). Towns are entered like dungeons: inn, quest giver and `AdventureShops` (shops.json, stock from `AdventureCards`, Forge's reward filters). |
| `DeckImporter` | Decklist text → Commander deck via Forge's `DeckImportController`; saves to the user's Commander decks. `detail` exports a deck back to text (`qty Name (SET) number`), `rename` copies then deletes. Without a Commander section, two sideboard partners or 1–2 commanders after the last blank line (MTGO/Moxfield text) lead; `chooseCommander` rewrites the text (a compatible partner joins, others replace). Unknown lines carry `CardCatalog.similar` suggestions (typos, partial and translated names). |
| `DeckLinks` | Public Archidekt/Moxfield deck → decklist text through their JSON APIs; any other host is refused before a request. A printing goes along only if Forge knows that set and number (promos, Secret Lair flavour names otherwise fail). |

### UI (ui/src)

- `App.tsx` — screen routing: connecting → language picker (first run) → skin picker (first run) → `Home` (→ `Decks` → `ImportDeck`) → `Table`.
  After a match the screen it was started from comes back (`picking`).
- `modes/LimitedScreen.tsx` — Draft/Sealed: saved events, the draft (pack, picks), deck building from the pool with free basic
  lands, AI opponents with the last result. `modes/PuzzleScreen.tsx` — puzzles by difficulty, situation, goal, start.
  Starting a puzzle or a limited game must reset `useEngine`'s "left the match" guard like any new match.
- `Decks.tsx` — the player's own decks: grouped list (`DeckCards`), rename, edit or new (opens `DeckBuilder`), import,
  export to the clipboard, delete, play. `DeckCards.tsx` is shared with the import.
- `ImportDeck.tsx` — paste, open/drop a file (`decklistFiles.ts`: MTGO `.dek` XML, Forge `.dck`, text) or fetch a link;
  `DeckCards` there offers "Commander" on possible commanders and suggested cards on unknown lines.
- `DeckBuilder.tsx` — catalog search (name in any language, colours, type, mana value, commanders only, commander's
  identity) and the deck as entries with exact printings; serialised to a decklist for `previewDeck`/`saveDeck`.
  Singleton enforced on add (basics excepted); searchable art/printing picker; compatible partner search through Forge;
  `DeckStatistics.tsx` + `deckAnalysis.ts` show interactive mana/color/source statistics and draw probabilities.
  A new name replaces the opened deck.
- `table/CardZoom.tsx` — right click (long press on touch) on any card or deck line shows it big, in a modal `<dialog>`
  so it sits above other dialogs, with its counters and keywords (`kw_*`/`kwHelp_*` in `i18n.ts`, else Forge's English
  reminder text); also exports the shared `Preview`.
- `Lobby.tsx` — host/join form and online lobby, up to four mixed human/AI seats, deck selection and chat.
- `useEngine.ts` / `engine.ts` — the socket and every message type (keep in sync with the engine).
- `audio/` — offline Web Audio effects, local volume/mute settings and consecutive-snapshot game cues.
  `App` installs trusted click/keyboard activation once; `useEngine` compares each incoming state before React batches it.
  First snapshots are silent, turns replace simultaneous phase cues, and stack `isSpell` excludes abilities.
- `settings/SettingsDialog.tsx` — shared main/match settings: appearance, audio, gameplay and accessibility.
  Only its body scrolls. `GameplaySettings` owns phase-stop saving; language stays disabled during a match.
  `appearancePrefs.ts` persists text-only scale (100–200%) and density locally; `appearance.css` keeps the
  existing typographic hierarchy and reflows controls without scaling card art or the viewport.
- `table/useCardInspection.ts` + `CardInspection.tsx` — shared right-click, long-press and I/Shift+F10
  inspection for cards, lists, catalogs and shops; touch release never executes the primary action.
- `campaigns/adventureGuidance.ts` — tracked quest fallback, marker shapes and offscreen waypoint placement.
  Adventure stores tracking and known place names per campaign locally; map motion follows reduced motion and animation settings.
- `Home.tsx` / `home.css` — library-style home: six modes in the side rail, Decks/Online/Settings in the header,
  feature and up to three actual most-played modes. `modeUsage.ts` counts confirmed play sessions, never navigation;
  local storage, bounded validated records, stable ranking and no invented history. Artwork reuses cards seen in play.
- `i18n.ts` — **all** our UI strings, Portuguese and English (`useT()`). Forge's own texts come translated from the engine.
- `skins.ts` + `index.css` — skins are `[data-skin]` blocks of CSS tokens. `table/table.css` and `App.css` must use tokens only.
- `table/` — `Table` (bar, side panel, hand, dialogs), `PlayerArea`, `Card`, `ChoiceDialog`, `CombatArrows`, `cards.ts` (mana parsing, phases).
- `table/GameMenu.tsx` — in-game skin, saved phase stops, reset and concede. Escape closes it; a Forge choice takes precedence. Live phase changes use Forge's `YieldUpdate` path for local/remote controllers.
- The table's fast-forward button uses a transient native yield marker until the next local upkeep. Opponent spells
  are yielded even with playable responses; an attack against the local player interrupts it. Blocks and choices stay
  manual. Interrupt overrides are controller-local and restored on cancellation, interruption or game end.
- Packaged macOS uses `desktop/engine-assets.cjs` for a writable profile under Electron's userData, linked to the
  bundled `res`. Never write inside the `.app` or mounted DMG. The engine's own data still defaults to `~/.re-forge`.
- Multiplayer table: identical permanents fold into a pile with a count (`groupCards` in `table/cards.ts`; cards in combat,
  targeted or with attachments stay apart). With 2–3 opponents their boards are compact and flow in one row; clicking an
  opponent's name enlarges that board and collapses the others (not during combat). Short windows (≤ 820 px) flow every board. The icon next to an opponent's life maximizes that board with large cards;
  your board shrinks to its header and your hand stays, so spells can target it (Escape or the same icon returns; not
  during combat). The side panel (log, last card looked at) is a drawer over the table, closed at the start of every game:
  "Registo" in the bar opens it, Escape or a click outside closes it. With it closed the hovered card floats beside it
  (`FloatPreview`); a preview whose card left under the pointer closes (`:hover` check after each state). A puzzle's goal
  sits in the bar. The stack has its own column (`table/StackColumn.tsx`, `.table` grid `1fr auto`): zero wide while
  empty, it opens pushing the boards aside, next item first and larger, abilities as source art + text; casts fly to
  it. The "stack" animation kind slides the column and its items in and out (a resolved item stays ~280 ms to leave).
  A narrow table column shows only the current phase in the bar (container query).
  Declaring blockers: clicking a creature that blocks another attacker moves it to the attacker Forge marks as chosen
  (four ordinary clicks in `Table` → `onCard`), as Forge alone refuses the second block. Phones (≤ 760 px): opponents are header rows
  (maximize to see a board), the bar wraps. Compact headers keep one line: hand/library move to the name's tooltip.
  Commander tax shows as a badge on the command-zone card (`commanderCasts` in the state).
  Equipment, auras and fortifications are drawn behind their host (`attachmentsByHost` in `cards.ts`, `ctx.attachments`),
  on the host's board even when another player controls them; hosts never fold into piles.
- `table/animationPlan.ts` (pure snapshot diff, like the sound cues) → `animationRunner.ts` (Web Animations on the real
  cards plus loose "ghost" cards in `.anim-layer`), run from `Table`'s layout effect with the previous render's card
  rects. Forge takes a spell out of the hand while costs are paid, so `rememberLocations` keeps each card's last place.
  Preferences (on/off, speed, per kind) are local (`animationPrefs.ts`), off by default under reduced motion; the panel
  sits in the main-menu settings and the game menu. The opening coin is the native `GameEventFlipCoin` before play/draw,
  forwarded as `openingCoin`; `CoinFlip` is modal and `openingCoin.ts` gates actions and answers until it ends.
  Snapshots never recreate a coin; puzzles and later games without a native toss do not show one.
- Leaving a match from the menu concedes (Forge confirms) and goes home; `useEngine` ignores the old match's late
  states and questions after `leaveGame` until a new match starts.
- Whose move it is (`Table`): your input = a choice, an enabled button or selectable cards/players; otherwise the
  player with priority is "thinking" and the bar says who we wait for, with seconds after 5 s. With `prompt.priority`
  the OK button reads Resolve (stack) or Pass and pulses when someone else's object waits on your answer. The stack
  marks the item that resolves next, names controllers in multiplayer, previews on hover; `CombatArrows` also draws
  arrows from the top item (or its ability's permanent) to its targets, in a window-fixed SVG. Sounds add priority,
  resolve, damage, victory and defeat; animations add life deltas, permanents leaving the battlefield and "your turn".
  Survey and proposals: `docs/TABLE_FEEDBACK.md`.
- `table/ZoneViewer.tsx` — a player's graveyard or exile (the counters in `PlayerArea` open it). Usable cards, e.g. flashback,
  are cast from here; face-down cards stay hidden. It also shows the cards a prompt offers off the table
  (`prompt.cards`: a library search, an opponent's hand), with the prompt's buttons, until the prompt moves on.
- `table/ChoiceDialog.tsx` — card previews, searchable picks, explicit ordering, top/bottom library arrangement, bounded numbers and constrained amount assignment. Invalid answers are asked again with a fresh id.

`engine/src/test/java/reforge/engine/DialogHarness.java` is a test-only launcher using a native Forge `GameState`
fixture (`--scenario suite|combat|images|zones|table|sounds|animations|autopass|attachments|tutor|blocks`, `table` = busy four-player board, `sounds` = known spells and attacker,
`animations` = legendary mythic, equipment, counters, mill and discard,
`autopass` = AI turn with nothing to play, `attachments` = equipment/auras on both boards with counters and keywords,
`blocks` = two AI attackers, your two possible blockers and burn in hand (switch blocks, stack),
`tutor` = Wishclaw Talisman library search,
fixtures in `scripts/fixtures`). It exercises choices and real multi-block combat through the same WebSocket/UI; it is not packaged in the engine jar.

## Environment (Windows dev machine)

- JDK 21 (Temurin) at `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`. Old shells may still have Java 8 first on
  PATH: set `JAVA_HOME` to the JDK 21 path when running Maven or the engine.
- Maven: `.tools/maven` (git-ignored), used automatically by `scripts/mvn.mjs`; falls back to `mvn` on PATH.
- Node 24. `npm install` at the root (workspaces `ui`, `desktop`, `relay`). npm blocks install scripts: Electron is allowed in
  `package.json` → `allowScripts`.

## Commands

```bash
npm run engine:build          # Forge modules + bridge → engine/target/re-forge-engine.jar (1–2 min)
npm run build                 # UI type-check + build → ui/dist
npm run ui:smoke-builder      # deterministic deck statistics: quantities, curve, colours, sources, draw odds, printings
npm run ui:smoke-import       # decklist files (.dek, .dck, text) and suggestion line fixes
npm run ui:smoke-sounds       # deterministic cue routing, waveform bounds, mute/volume, autoplay and audio failures
npm run ui:smoke-animations   # deterministic animation plans: cast, enter/ring, counters, equip, discard, mill, coin
npm run engine:smoke-quests   # Adventure side quests (an offer in every town of 3 worlds, each driven to its reward), town maps and shop stock
npm run package               # native Windows x64 installer or macOS DMG with bundled Java → dist-app
npm run package:smoke         # shipped JRE/assets, import, persistence and match startup; temporary data
npm run dev                   # Vite + Electron; Electron starts the engine
npm run engine:smoke          # engine loads the card DB (~15 s)
npm run engine:smoke-match    # passive game through the socket, concedes on turn 4 (SMOKE_OPPONENTS=3 for 4 players)
npm run engine:smoke-combat   # active game: lands, spells, targets, attacks, blocks (several minutes)
npm run engine:smoke-import   # import a decklist fixture, play it, export, rename, delete it
npm run engine:smoke-import-fixes # implied/chosen commanders, suggestions, Archidekt/Moxfield links (SMOKE_OFFLINE=1 skips links)
npm run engine:smoke-online   # two separate engines, lobby/chat, private hands and remote game (SMOKE_ONLINE_AI=1 adds AI)
npm run relay:smoke          # actual local Cloudflare Worker: room auth, isolation, ordering, limits and cleanup
npm run engine:smoke-relay   # netplay through local Worker (SMOKE_ONLINE_HUMANS=4 for four humans)
npm run engine:smoke-relay-drop # TCP proxy cuts the guest's, then the host's relay connection mid-game; both resume
npm run engine:smoke-online-lobby # leave/rejoin, closed window, host closes room, kick (--relay; RE_FORGE_RELAY_URL tests the published relay)
npm run engine:smoke-settings # persist across restart; change phase stops live, skin and language guard
npm run engine:smoke-autopass # opponent's turn passes by itself once auto-pass is switched on live; own turn stops again
npm run engine:smoke-fastforward # playable responses, a real opponent spell, cancellation, own turn and manual blockers
npm run engine:smoke-dialogs  # deterministic choice validation, native scry/surveil and real double-block combat
npm run engine:smoke-limited  # puzzles (list, start), sealed (pool, deck rules, game, result), full draft, events after restart
npm run engine:smoke-tutor    # Wishclaw Talisman in pt-BR: library search from the table and its prompt, card to hand, shuffle, opponent gains control
npm run engine:smoke-builder  # catalog search in two languages, filters, identity, pages, printings
npm run engine:smoke-images   # image URLs (cards, tokens), per-language cache, English fallback, retries
```

### Checking the UI in a browser

Start an engine on a fixed port with a throw-away data folder, then open Vite with `?enginePort=`:

```bash
D=$(mktemp -d); printf "language=pt-BR\nskin=mesa\n" > "$D/reforge.properties"
"$JAVA_HOME/bin/java" -jar engine/target/re-forge-engine.jar --port 7777 --assets forge/forge-gui --data "$D"
npm run dev -w ui    # then http://localhost:5173/?enginePort=7777
```

Leave `reforge.properties` out to see the first-run screens. Never test against the real data folder
(`%APPDATA%\RE-Forge`) unless asked: it holds the owner's choices.

## Rules that matter

- **Design:** no subtitles or descriptions that repeat what is visible. Explanations go in a tooltip (hover on desktop,
  long-press on mobile). No emoji in the UI. Accessibility: real buttons, labels, 44 px targets, visible focus.
  The app targets **landscape** on every device; validate short landscape windows rather than portrait (owner, 26/10/2026).
- **Text:** every new UI string goes in `i18n.ts` in both `pt` and `en`. Card logic must use `typeEn`, never `type`.
- **Skins:** never hard-code a colour, font or radius in component CSS; add or reuse a token and define it in all four skins.
- **Ids:** card, player and stack ids are separate number spaces. Keep them in separate fields/lists.
- **Threads (engine):** never block the WebSocket thread — actions go through the `ui-actions` executor because Forge may ask
  a question back. Things that mutate game state from outside the game thread (e.g. concede) go through
  `WebGuiGame.runWhenAwaitingInput`. `ask()` blocks the game thread until the UI answers; a closed session answers `null`.
- **State:** the UI receives full snapshots, not deltas. Reading Forge's views from another thread is expected (Forge's own
  desktop UI does it); `pushStateNow` retries on a concurrent-modification failure.
- **Data:** the engine must never write to `%APPDATA%\Forge` (an installed Forge's folder). `Main.writeProfile` points Forge
  at our data dir; keep it that way.
- **Forge prefs we set** (in `MatchStarter`/`Settings`): `PLAYER_NAME`, `UI_RECORD_REPLAYS=false`,
  `UI_SHOW_ACTIONABLE_HIGHLIGHTS=true`, `UI_LANGUAGE`. Rules: `warnAboutAICards=false`, `gamesPerMatch=1`.
- **Git:** work on a `feat/...` branch; the owner approves commits and merges (fast-forward into `main`). Remote `origin`: `https://github.com/Guybota/RE_Forge.git`.

## Gotchas already paid for

- Forge's poms use `${revision}`; they only resolve inside a reactor → root `pom.xml`. Don't `mvn install` Forge separately.
- `forge/.mvn/maven.config` points at a settings file relative to `forge/`; the root reactor build avoids it.
- Java-WebSocket's ping timeout closed idle local connections (code 1006) → `setConnectionLostTimeout(0)`.
- Forge's priority prompt starts with Priority/Turn/Phase/Stack lines; `WebGuiGame` strips them in any language.
- Forge's `UI_SELECT_FROM_CARD_DISPLAYS` (on) makes searches click cards "in their zone", library included, instead of
  asking a choice: `GameSnapshot` sends those off-table selectables in `prompt.cards` and `ZoneViewer` shows them.
- Forge only marks playable/attacking/blocking cards (`actionable`) when `UI_SHOW_ACTIONABLE_HIGHLIGHTS` is on.
- `ImageFetcher` asserts it runs on the GUI thread, so `ImageServer` builds Scryfall URLs itself (`ImageUtil`;
  tokens via `CardEdition.getTokens`). Collector numbers differ between printings: check real ones (e.g. Bolt M11 = 149).
- Scryfall answers a translated printing without a scan with the English picture stamped "Localized Image Not
  Available"; only the card JSON's `image_status` (`placeholder`) tells. `ImageServer` checks it before non-English downloads.
- Forge has no Portuguese `Lang` (ordinals, possessives) and fell back to English ("2nd", "X's Upkeep"):
  `LangPortuguese` is registered for pt-BR before `FModel.initialize`.
  Forge's pt-BR zone prompts put the possessive first ("de {0} {1}" → "de de você grimório"); `LangPortuguese.fixMessages`
  overrides those seven keys after Forge loads its messages (start and language change).
- `UI_PREFERRED_ART` is `ORIGINAL_ART_CORE_EXPANSIONS_REPRINT_ONLY`: "latest" picked promos and sets Forge lists before
  release (no picture on Scryfall).
- Smoke-test bots must act on the latest state, not on prompt text (prompts can be empty or repeat).
- Choice bots should start `amounts` from `initialAmounts`, honor the prompt's constraints, and return a full permutation
  for `arrange`. Hidden choice cards have no label/details; explicit reveals authorize only the listed cards.
- Relay setup and deployment: `docs/ONLINE_RELAY.md`. Published on the owner's Cloudflare account (Free plan) at
  `https://reforge-relay.tempo-portugal.workers.dev`; deploy only with the owner's approval. Never publish the UI
  WebSocket through the relay; only the Forge netplay byte streams. `desktop/package.json` → `config.relayUrl` supplies a
  packaged default, overridden by `RE_FORGE_RELAY_URL`. Keep Cloudflare on its Free plan unless the owner requests otherwise.
- In netplay, an individual concession must release that player's pending input even when the whole game has not ended.
  `OnlineController` adapts the server's remote wire controllers and releases their shared input queue after concession.
  Never send a separate OK RPC to do this: Forge dispatches those RPCs on independent threads. Cover four humans and mixed AI.
