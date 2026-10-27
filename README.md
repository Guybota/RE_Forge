# RE:Forge

A new interface for [Forge](https://github.com/Card-Forge/forge), the open-source Magic: The Gathering rules engine.
Forge's engine runs unchanged in Java; the interface is a web app (React) inside Electron.

```
forge/     Forge source (git submodule). The rules engine, AI and card database.
engine/    Java bridge: loads Forge without windows and talks to the UI over a local WebSocket.
ui/        React + TypeScript interface (Vite).
desktop/   Electron shell: starts the engine, opens the UI.
pom.xml    Builds Forge's engine modules and the bridge in one Maven reactor.
```

## Setup

Needs JDK 17+ (21 recommended), Maven 3.9+ and Node 22+.

```bash
git submodule update --init --depth 1
npm install
npm run engine:build
npm run engine:smoke
```

`engine:build` uses `.tools/maven` if present, otherwise `mvn` from your PATH.

## Run

```bash
npm run dev
```

Starts Vite and Electron; Electron launches the engine and passes its port to the UI.
For a production-style run: `npm run build` then `npm start`.

## Deck Central

`central/` is the deck library, comparison, improvements, card search and Sage application.
It is an npm workspace: install dependencies from the repository root. `npm run build` builds
both interfaces and stages the Central production server in `build/central`.

After that build, **Deck Central** in the Electron home menu opens it using the engine already
running in Electron. The game runs in the current RE:Forge interface, including its settings,
skins, dialogs and game modes. Starting a Central list plays it in memory: it never saves over
an existing Forge deck, including one with an identical name. Forge checks the complete list
before play; unrecognized cards block starting until the list is corrected.

For browser development, run `npm run build:ui` and `npm run central:dev`, then open
`http://127.0.0.1:4317`. The desktop uses that same fixed loopback port so its browser deck
library keeps the same origin across restarts. If the port is occupied, startup fails explicitly.
`RE_FORGE_CENTRAL_PORT` overrides the desktop port; changing it changes the browser storage origin.
`RE_FORGE_ROOT`, `JAVA_HOME` and optionally `RE_FORGE_DATA` configure a browser-launched engine;
Electron supplies its existing engine directly. Test profiles must always be temporary.

```bash
npm run central:smoke         # process reuse, startup failure/retry and trusted deck handoff
npm run engine:smoke-central  # native games with same-name lists; saved decks stay unchanged
npm run central:smoke-package # staged production server, current game UI and engine reuse
npm run desktop:smoke-central # real Electron utility process from ASAR, with a temporary profile
npm run central:test          # library, search, import/compare and game integration in Chromium
```

Windows and macOS packaging include the staged Central server and the shared game interface.
The Central integration workflow checks builds, browser behavior and native deck isolation.

## Windows and macOS installers

On Windows x64, with JDK 21 (`JAVA_HOME`), Node and Maven available:

```bash
npm install
npm run package
```

This builds the UI and engine, creates a Java runtime with `jlink`, and writes
`dist-app/RE-Forge-Setup-0.1.7.exe`. The installer runs per user; players do not need
Java, Node or Maven installed. `dist-app/win-unpacked/` contains the same application
before installation. Includes Adventure's shared maps, decks, world data and sprites plus
Shandalar's world data. Other Adventure worlds and music are excluded. Card and token
scripts use Forge's native ZIP format to avoid installing thousands of individual files.

The Java runtime is reused when its JDK and module list are unchanged. Use
`npm run package -- --fresh` to recreate it explicitly. Packaging never publishes a release.

```bash
npm run package:smoke
npm run package:smoke -- "C:/path/to/installed/RE-Forge/resources"
```

This checks the shipped Java, card database, precons, catalog, import, settings/deck
persistence across a restart, Quest starters, Adventure creation/maps/images and campaign
persistence, and local match startup, using temporary data and an isolated Forge profile. It does not
open the desktop UI.
On Windows, the installed resource folder must be writable: Forge writes its data-directory profile
next to `res/` at startup. The per-user installation provides that access.
Set `SMOKE_PACKAGE_IMAGES=1` to also download a real Scryfall image and verify the cache
after restart; this optional check needs Internet access.

On macOS, the same `npm run package` command builds a DMG for the Mac's native architecture,
including its Java 21 runtime. Outputs are `RE-Forge-<version>-macOS-arm64.dmg` (Apple Silicon)
and `RE-Forge-<version>-macOS-x64.dmg` (Intel). Open the DMG and drag RE-Forge to Applications.
The macOS test builds are ad-hoc signed and are not notarized by Apple.

The macOS workflow builds on native Apple Silicon and Intel runners, verifies and mounts each
DMG read-only, and runs `package:smoke` and `engine:smoke-fastforward` using its bundled Java
and resources. Forge's writable profile is kept outside the `.app`; game data stays in `~/.re-forge`.
`npm run desktop:smoke-assets` checks the profile/resource link and relocating the application.

## Tests

```bash
npm run engine:smoke          # engine loads the card database
npm run engine:smoke-match    # plays a passive Commander game through the socket and concedes
npm run engine:smoke-combat   # plays an active game (lands, spells, targets, attacks, blocks); a few minutes
npm run engine:smoke-import   # imports scripts/fixtures/riders-of-rohan-arena.txt, plays it, exports, renames, deletes it
npm run engine:smoke-online   # two engines: lobby, chat, private hands, remote turns and concession
npm run engine:smoke-settings # settings survive restart; phase stops change live priority
npm run engine:smoke-fastforward # native fast-forward: legal responses, cancellation, own turn and blockers
npm run engine:smoke-dialogs  # deterministic choices, invalid answers, scry/surveil and a real double block
npm run engine:smoke-images   # card/token image URLs, per-language cache, English fallback, retries (simulated Scryfall)
npm run engine:smoke-deck-language # native printings, weighted language coverage, placeholders, HTTP failures and cancellation
npm run engine:smoke-builder  # deck builder catalog: names in two languages, filters, identity, pages, printings
npm run ui:smoke-sounds       # sound cues, duplicate suppression, generated audio, volume/mute and autoplay
```

`SMOKE_OPPONENTS=3` plays a 4-player game; `SMOKE_DEBUG=1` prints every message.
`SMOKE_ONLINE_AI=1` adds an AI to the online smoke test. All smoke tests use temporary data folders.
`SMOKE_SOUND_FIXTURE=1` uses a known board/deck for `engine:smoke-combat`, verifying real spell, attack, turn and phase sound cues.
Build the engine first: the dialog smoke test also uses compiled test classes from `engine/target/test-classes`.
Its test launcher and native Forge fixture are excluded from the production engine jar.

## Online Commander

Room-code hosting is available when a relay is configured: select **Room code**, create a room,
and share its eight-character code. All players connect outwards over WebSocket; no router port
forwarding is needed. The host still runs Forge and must keep the app open. A Cloudflare Worker
with one Durable Object per room forwards the native Forge protocol, with up to three guests.
The local UI WebSocket is never exposed. Setup, local tests, limits and deployment are in
[docs/ONLINE_RELAY.md](docs/ONLINE_RELAY.md). No public relay is deployed or configured by default.

For direct connections:

Choose **Play online**, enter a player name, then **Host game** or **Join game**. Each human chooses
their own deck and marks themselves ready; the host may add AI or open seats (up to four players)
and starts the match. Imported decks and precons use the same Forge netplay protocol.

On a LAN, share the host's LAN address and game port (default TCP 36743). For Internet games,
forward that TCP port on the host's router, or select the optional UPnP checkbox to ask Forge to
map it. The discovered external address does not verify that port forwarding succeeded.
The UI WebSocket and card-image server remain bound to 127.0.0.1.

Two instances on one computer need separate engine ports and `--data` folders. Start the first
engine and wait for `READY` before starting the second: Forge reads a profile next to the shared
assets during startup. `engine:smoke-online` handles this automatically.

## Match menu

Open **Menu** in the side panel during a match to change skin, configure phase stops, restore the
default stops or concede (with Forge's confirmation). Escape closes the menu without answering the
game's prompt. A new mandatory choice closes the menu so it can be answered.

**Sound effects** on the main menu and match menu controls clicks, playing cards, attacks, turn starts
and phase changes. Sound starts at 40% volume and can be muted; both settings are remembered locally
on this device. Effects are synthesized offline, start after the first interaction and stay silent
while the window is hidden. Game cues follow engine state, so invalid card clicks only play the UI click.

Phase stops are separate for your turn and opponents' turns, saved automatically in
`reforge.properties`, and take effect during the current game, including online games. The defaults
remain main phases and the blockers step on your turn, and the blockers step and end step on other
turns. Forge still decides when priority and mandatory choices are required; untap is not selectable.
Language remains available from Home, outside a running match.

## Data

The engine keeps Forge's preferences, decks and caches in `%APPDATA%\RE-Forge` (`~/.re-forge` elsewhere, or `--data <dir>`),
never in the `%APPDATA%\Forge` folder an installed Forge uses. It does this by writing `forge/forge-gui/forge.profile.properties`
(ignored by Forge's git) on every start.

Card and token pictures are served by the engine at `<imageBase>?key=<imageKey>&format=crop|full&lang=<language>`
(`imageBase` comes in `engineInfo`, `imageKey` on each card). The first request downloads from Scryfall through Forge's
rate limiter, in the chosen language when Scryfall has it (English otherwise); after that it is read from
`cache/reforge-art/`, one file per language.

## Engine protocol

JSON messages over `ws://127.0.0.1:<port>`, each with a `type`. Shapes are typed in `ui/src/engine.ts`.

| Direction | `type` | What |
|---|---|---|
| UI → engine | `hello`, `listDecks` | Engine info (incl. `language`, missing on first run, and `languages`); `decks` with `mine` (imported), `commander` (precons), and `summaries` (name, source, native commanders, combined identity and main + commander count) |
| UI → engine | `deckLanguage` / `cancelDeckLanguage` | `requestId`, `name`, `source` → progressive `deckLanguage` replies echoing these and the selected `language`, plus `total`, `checked`, `available`, `missing`, `unknown`, `done`. Counts include main + commanders with copies; exact printing scans are checked asynchronously, cached for 12 hours in memory. Network failures are unknown, never missing. Cancel on selection/language change or exit. |
| UI → engine | `searchCards` / `getPrintings` | `query`, `colors` (mask W1 U2 B4 R8 G16, 32 colourless), `identity`, `cardType`, `cmc` (7 = 7+), `commanders`, `partnerOf` (English commander name, native Forge compatibility), `requestId`, `offset` → `cardResults` (echoes `requestId`) (`total`, 60 `cards`); `name` → `printings` (set, collector number, art index and image key) |
| UI → engine | `getDeck` / `renameDeck` | `name` → `deckDetail` (same fields as `deckPreview` plus `name` and the exported `text`); `name`, `to` → `decks` |
| UI → engine | `previewDeck` / `saveDeck` / `deleteDeck` | Decklist `text` (+ `name`) → `deckPreview` (lines with status — card lines also `name`, `qty`, type `group`, `imageKey`; unknown lines `requested` and up to 3 `suggestions` `{nameEn, name}` — cards, commanders, legality `problem`); save/delete answer `decks` |
| UI → engine | `chooseCommander` / `fetchDeck` | `text`, `name` (English) → `deckText` with the list rewritten around that commander; `url` (Archidekt/Moxfield deck) → `deckText` (`text`, `name`), or `error` with `code` `linkUnsupported` / `linkNotFound` / `linkUnavailable` |
| UI → engine | `setLanguage` | `language` (Forge code, e.g. `pt-BR`); not during a match. Saved in `reforge.properties` |
| UI → engine | `setSkin` | `skin` id (`mesa`, `editorial`, `retro`, `terminal`; defined in `ui/src/skins.ts` and `index.css`). Saved too |
| UI → engine | `setPhaseStops` | `stops: {mine: [phase names], opponents: [phase names]}`, or `stops: null` to restore defaults. Both rows are validated before saving; applies live |
| UI → engine | `startMatch` | `deck` (name or null for random), optional `deckSource` (`mine` / `precon`, omitted keeps own-deck-first compatibility), `opponents` 1–3, `aiProfiles` (one Forge AI profile per opponent; `""` = random, missing = `Default`) |
| UI → engine | `startDeckMatch` | External `text` and display `name`, `opponents` 1–3, optional `aiProfiles`. Resolves the full list with Forge and plays it without writing a saved deck; unknown cards, missing commander and empty main decks are rejected. |
| UI → engine | `hostGame` / `joinGame` | Player `name`; direct host: `port` (1024–65535), optional `upnp`; direct join: `address` (`host:port`). Room host: `transport: "relay"`; room join: `transport: "relay"`, `code` (8 characters). Relay origin is engine configuration, never a UI-supplied URL |
| UI → engine | `setSlot` | `index`, optional `slotType` (`ai` or `open`, host only), optional `deck` (own/AI slot only) |
| UI → engine | `setReady`, `addSlot`, `removeSlot`, `kickPlayer`, `startOnlineMatch`, `leaveLobby` | `ready` boolean; remove/kick: `index` (kick: host only, slots with `kickable`). Host controls seats/start; one online session per engine. A closed lobby sends `lobbyClosed`, with an `error` `code` `kicked`, `hostDisconnected` or `relayDisconnected` when it wasn't the player's choice |
| UI → engine | `limited` | `action`: `sets` → `limitedSets`; `events` / `delete` (`id`) → `limitedEvents`; `newSealed` (`set`), `open` / `saveDeck` (`id`, `main` entries `nameEn`, `set`, `number`, `qty`) → `limitedEvent` (`pool`, `main`, `lands`, `opponents` with `colors`/`result`, `problem`); `newDraft` (`set`), `pick` (`index`), `draft` → `draft` (`round`, `rounds`, `picks`, `pack`, `picked`) or `draftClosed`, the last pick answers `limitedEvent`; `play` (`id`, `opponent`, `bestOf` 1 or 3) starts a match and answers `limitedEvent` with the result when it ends |
| UI → engine | `puzzles` / `startPuzzle` | → `puzzles` (`id`, `name`, `difficulty`, `goal`, `turns`, `description`, `solved`); `id` starts that puzzle (its `state` carries `puzzle`) |
| UI → engine | `setAiOptions` | `profile` ("" = random) and/or `timeout` (seconds, one of `engineInfo.ai.timeouts`) → `engineInfo` with `ai` |
| UI → engine | `chat` | `text` (up to 2000 characters) |
| UI → engine | `action` | `ok`, `cancel`, `card` + `id`, `player` + `id`, `undo`, `attackAll`, `concede`, `leave`; `fastForward` + boolean `enabled` yields until the next local turn or an attack against the local player. The state carries transient `fastForward`; blocks and choices remain manual |
| UI → engine | `answer` | Reply to a `choice` by `id`: `picked` indices, `amounts`, `value`, or `skip: true` when allowed |
| engine → UI | `state` | Full board snapshot (players, zones, stack, combat, log, prompt), at most every 40 ms |
| engine → UI | `openingCoin` | Native opening toss before play/draw: `gameId`, `winnerId`, `winnerName`. The UI blocks game input until its animation ends; winning the toss does not necessarily mean playing first |
| engine → UI | `choice` | A question the game waits on: `choose`, `reveal`, `confirm`, `order`, `arrange`, `amounts`, `text` |
| engine → UI | `notice` | `incorrectAction`, `alert`, `message`, `error` |
| engine → UI | `lobby` | Full lobby snapshot: `host`, `localSlot`, `port`, `addresses`, `transport` (`direct`/`relay`), optional `roomCode`, `slots` (kind, name, deck, ready, editable, controllable). Relay lobbies do not publish IP addresses |
| engine → UI | `chatMessage`, `lobbyClosed` | Chat `source`, `text`, `kind`; lobby closure also clears the game/choice in the UI |

Hidden cards are sent as `{id, hidden: true}`. Card, player and stack ids are separate number spaces.
Each player may carry `libraryTop`, only when Forge permits this viewer to see the current top card.
Snapshots also carry `gameId`, so late states from a previous game cannot interrupt an opening toss.
Its native `actionable` flag and card id use the same play/inspect path as cards on the board; no other library cards are exposed.
Scry, Surveil and Explore use a shared destination picker. Native one-card prompts may carry
`placement: {card, destination, moveAction}`; list choices use `placement: bottom|graveyard|top`.
Answers keep Forge's original contracts: a complete permutation for Scry's `arrange`, an ordered subset for Surveil,
and the original OK/Cancel action for one-card confirmations.
Stack entries include `isSpell`, distinguishing casts from activated and triggered abilities for sound cues.
Choice options may include `card` metadata for previews; hidden options have an empty label and no card details.
An explicit reveal exposes only the listed cards. Invalid answers repeat the choice with a fresh `id` and `invalid: true`.

`choose`/`order` validate unique, in-range `picked` indices and the `min`/`max` count. `arrange` expects every option
index exactly once, preserving the relative order of fixed cards; `movable`, `toTop`, `toBottom` and `toAnywhere`
describe the permitted moves. `amounts` supplies `total`, `minimums`, `maximums`, `initialAmounts`, optional `lethal`,
`ordered`, `divideFreely`, `defenderIndex` and `maySkip`. Amounts must be integers, meet the bounds and total, and
respect the lethal/order constraints supplied by Forge. `skip` is accepted only when `maySkip` is true.
Numeric `text` prompts include `numeric`, `numberMin` and `numberMax`; `value: null` cancels the input.

`engineInfo` also includes `phaseOptions` (supported Forge phase names), `phaseStops` (current two rows) and `aiProfiles`
(Forge's AI profiles, easiest first).
`relayAvailable` indicates whether the engine has a configured relay origin. The room-code option is disabled otherwise.
Relay `error` messages also carry an optional `code` for translated room/connection errors; `message` retains the diagnostic text.
Card `name`, `type` and `text` are in the chosen language; `typeEn` is the English type line for UI logic.
Our own UI strings live in `ui/src/i18n.ts` (Portuguese and English; other languages fall back to English).

The main menu uses a side library of modes and up to three most-played shortcuts. Usage is local to this device,
starts with the next confirmed play sessions and survives restarts. Visiting menus, failed starts and repeated
snapshots do not count; opening a campaign/event is one session, including its duels, picks and best-of-three games.
Before the WebSocket is available, the desktop shell displays `PROGRESS <0..95>` from Forge's real card loading;
`READY <port>` hands off to the UI's connection progress bar.

## Design rule

No subtitles or descriptions that repeat what is visible. Explanations go in a tooltip (hover on desktop, long-press on mobile).

### Deck builder statistics and partners

The builder has Cards and Statistics views. Statistics include a stacked nonland mana curve, averages, median,
color distribution, mana symbols, potential front-face land sources and a hypergeometric draw calculator. Click a
mana-value bucket or color to filter the deck list. Commanders are excluded by default and can be included explicitly;
the draw calculator always uses the library. Potential sources include activation costs/conditions but exclude
fetchlands, reflected sources and variable production.

Use **Add partner** beside an eligible commander to search only compatible candidates. Forge checks Partner,
Partner with, Friends forever, Backgrounds and Doctor's companion, with the combined color identity. The art picker
shows each version's set, collector number and art index; saved and exported lists retain the chosen printing.
Catalog/deck cards also carry `typeEn`, `colors`, `manaSymbols` (WUBRGC counts), `manaProduction` (WUBRGC bits),
`commanderMana` and `canPartner` for these features. Run `npm run ui:smoke-builder` for calculation and printing
checks and `npm run engine:smoke-builder` for catalog, partnership and persistence checks.
