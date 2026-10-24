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
scripts/    mvn.mjs (Maven launcher), smoke tests, package script (on feat/packaging).
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
| `WebGuiGame` | Forge's `IGuiGame` for the local human (extends `NetworkGuiGame`, including remote delta sync). Pushes `state` snapshots (debounced 40 ms) and turns every Forge question into a `choice`. Phase stops live in `isUiSetToSkipPhase`. |
| `OnlineLobby` | Forge netplay adapter: host/join, seats, ready, decks, chat, addresses and cleanup. One online session per process. |
| `GameSnapshot` | `GameView` → JSON `state`. Hides cards the player may not see. Translated names/types/text plus `typeEn`. |
| `AmountAssignment` | Forge's damage/amount constraints: exact total, per-target bounds, lethal damage, ordering and trample. Shared validation and prompt metadata. |
| `MatchStarter` | Commander vs 1–3 AIs from Forge's precons, each with its chosen Forge AI profile (`res/ai`); sets the Forge prefs we rely on. |
| `ImageServer` | `http://127.0.0.1:<port>/card?key=&format=crop|full`. Downloads from Scryfall once (Forge's rate limiter), caches under `<data>/cache/reforge-art`. |
| `Settings` | `<data>/reforge.properties`: chosen `language`, `skin` and separate phase stops for own/opponents' turns. Atomic writes; missing language/skin = first run. |
| `DeckImporter` | Decklist text → Commander deck via Forge's `DeckImportController`; saves to the user's Commander decks. |

### UI (ui/src)

- `App.tsx` — screen routing: connecting → language picker (first run) → skin picker (first run) → `Home` (→ `ImportDeck`) → `Table`.
- `Lobby.tsx` — host/join form and online lobby, up to four mixed human/AI seats, deck selection and chat.
- `useEngine.ts` / `engine.ts` — the socket and every message type (keep in sync with the engine).
- `i18n.ts` — **all** our UI strings, Portuguese and English (`useT()`). Forge's own texts come translated from the engine.
- `skins.ts` + `index.css` — skins are `[data-skin]` blocks of CSS tokens. `table/table.css` and `App.css` must use tokens only.
- `table/` — `Table` (bar, side panel, hand, dialogs), `PlayerArea`, `Card`, `ChoiceDialog`, `CombatArrows`, `cards.ts` (mana parsing, phases).
- `table/GameMenu.tsx` — in-game skin, saved phase stops, reset and concede. Escape closes it; a Forge choice takes precedence. Live phase changes use Forge's `YieldUpdate` path for local/remote controllers.
- Multiplayer table: identical permanents fold into a pile with a count (`groupCards` in `table/cards.ts`; cards in combat,
  targeted or with attachments stay apart). With 2–3 opponents their boards are compact and flow in one row; clicking an
  opponent's name enlarges that board and collapses the others (not during combat). Short windows (≤ 820 px) flow every board. The icon next to an opponent's life maximizes that board with large cards;
  your board shrinks to its header and your hand stays, so spells can target it (Escape or the same icon returns; not
  during combat). The side panel can be hidden (remembered in `localStorage`); then Menu and the panel toggle sit in the
  bar, the hovered card floats beside it (`FloatPreview`) and the stack floats bottom-left. The stack only shows while it
  has items; the panel keeps the last card looked at. Phones (≤ 760 px): the panel is a drawer, opponents are header rows
  (maximize to see a board), the bar wraps. Compact headers keep one line: hand/library move to the name's tooltip.
  Commander tax shows as a badge on the command-zone card (`commanderCasts` in the state).
- Leaving a match from the menu concedes (Forge confirms) and goes home; `useEngine` ignores the old match's late
  states and questions after `leaveGame` until a new match starts.
- `table/ZoneViewer.tsx` — a player's graveyard or exile (the counters in `PlayerArea` open it). Usable cards, e.g. flashback,
  are cast from here; face-down cards stay hidden.
- `table/ChoiceDialog.tsx` — card previews, searchable picks, explicit ordering, top/bottom library arrangement, bounded numbers and constrained amount assignment. Invalid answers are asked again with a fresh id.

`engine/src/test/java/reforge/engine/DialogHarness.java` is a test-only launcher using a native Forge `GameState`
fixture (`--scenario suite|combat|images|zones|table`, `table` = busy four-player board, fixtures in `scripts/fixtures`). It exercises choices and real multi-block combat through the same WebSocket/UI; it is not packaged in the engine jar.

## Environment (Windows dev machine)

- JDK 21 (Temurin) at `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`. Old shells may still have Java 8 first on
  PATH: set `JAVA_HOME` to the JDK 21 path when running Maven or the engine.
- Maven: `.tools/maven` (git-ignored), used automatically by `scripts/mvn.mjs`; falls back to `mvn` on PATH.
- Node 24. `npm install` at the root (workspaces `ui`, `desktop`). npm blocks install scripts: Electron is allowed in
  `package.json` → `allowScripts`.

## Commands

```bash
npm run engine:build          # Forge modules + bridge → engine/target/re-forge-engine.jar (1–2 min)
npm run build                 # UI type-check + build → ui/dist
npm run dev                   # Vite + Electron; Electron starts the engine
npm run engine:smoke          # engine loads the card DB (~15 s)
npm run engine:smoke-match    # passive game through the socket, concedes on turn 4 (SMOKE_OPPONENTS=3 for 4 players)
npm run engine:smoke-combat   # active game: lands, spells, targets, attacks, blocks (several minutes)
npm run engine:smoke-import   # import a decklist fixture, play it, delete it
npm run engine:smoke-online   # two separate engines, lobby/chat, private hands and remote game (SMOKE_ONLINE_AI=1 adds AI)
npm run engine:smoke-settings # persist across restart; change phase stops live, skin and language guard
npm run engine:smoke-dialogs  # deterministic choice validation, native scry/surveil and real double-block combat
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
- Forge only marks playable/attacking/blocking cards (`actionable`) when `UI_SHOW_ACTIONABLE_HIGHLIGHTS` is on.
- `ImageFetcher` asserts it runs on the GUI thread, so `ImageServer` builds Scryfall URLs itself (`ImageUtil`;
  tokens via `CardEdition.getTokens`). Collector numbers differ between printings: check real ones (e.g. Bolt M11 = 149).
- Scryfall answers a translated printing without a scan with the English picture stamped "Localized Image Not
  Available"; only the card JSON's `image_status` (`placeholder`) tells. `ImageServer` checks it before non-English downloads.
- Forge has no Portuguese `Lang` (ordinals, possessives) and fell back to English ("2nd", "X's Upkeep"):
  `LangPortuguese` is registered for pt-BR before `FModel.initialize`.
- `UI_PREFERRED_ART` is `ORIGINAL_ART_CORE_EXPANSIONS_REPRINT_ONLY`: "latest" picked promos and sets Forge lists before
  release (no picture on Scryfall).
- Smoke-test bots must act on the latest state, not on prompt text (prompts can be empty or repeat).
- Choice bots should start `amounts` from `initialAmounts`, honor the prompt's constraints, and return a full permutation
  for `arrange`. Hidden choice cards have no label/details; explicit reveals authorize only the listed cards.
