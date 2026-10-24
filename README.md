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

## Tests

```bash
npm run engine:smoke          # engine loads the card database
npm run engine:smoke-match    # plays a passive Commander game through the socket and concedes
npm run engine:smoke-combat   # plays an active game (lands, spells, targets, attacks, blocks); a few minutes
npm run engine:smoke-import   # imports scripts/fixtures/riders-of-rohan-arena.txt, plays it, deletes it
npm run engine:smoke-online   # two engines: lobby, chat, private hands, remote turns and concession
```

`SMOKE_OPPONENTS=3` plays a 4-player game; `SMOKE_DEBUG=1` prints every message.
`SMOKE_ONLINE_AI=1` adds an AI to the online smoke test. All smoke tests use temporary data folders.

## Online Commander

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

## Data

The engine keeps Forge's preferences, decks and caches in `%APPDATA%\RE-Forge` (`~/.re-forge` elsewhere, or `--data <dir>`),
never in the `%APPDATA%\Forge` folder an installed Forge uses. It does this by writing `forge/forge-gui/forge.profile.properties`
(ignored by Forge's git) on every start.

Card pictures are served by the engine at `<imageBase>?key=<imageKey>&format=crop|full` (`imageBase` comes in `engineInfo`,
`imageKey` on each card). The first request downloads from Scryfall through Forge's rate limiter; after that it is read
from `cache/reforge-art/`. Tokens have no picture yet.

## Engine protocol

JSON messages over `ws://127.0.0.1:<port>`, each with a `type`. Shapes are typed in `ui/src/engine.ts`.

| Direction | `type` | What |
|---|---|---|
| UI → engine | `hello`, `listDecks` | Engine info (incl. `language`, missing on first run, and `languages`); `decks` with `mine` (imported) and `commander` (precons) |
| UI → engine | `previewDeck` / `saveDeck` / `deleteDeck` | Decklist `text` (+ `name`) → `deckPreview` (lines with status, cards, commanders, legality `problem`); save/delete answer `decks` |
| UI → engine | `setLanguage` | `language` (Forge code, e.g. `pt-BR`); not during a match. Saved in `reforge.properties` |
| UI → engine | `setSkin` | `skin` id (`mesa`, `editorial`, `retro`, `terminal`; defined in `ui/src/skins.ts` and `index.css`). Saved too |
| UI → engine | `startMatch` | `deck` (name or null for random), `opponents` 1–3 |
| UI → engine | `hostGame` / `joinGame` | Player `name`; host: `port` (1024–65535), optional `upnp`; join: `address` (`host:port`) |
| UI → engine | `setSlot` | `index`, optional `slotType` (`ai` or `open`, host only), optional `deck` (own/AI slot only) |
| UI → engine | `setReady`, `addSlot`, `removeSlot`, `startOnlineMatch`, `leaveLobby` | `ready` boolean; remove: `index`. Host controls seats/start; one online session per engine |
| UI → engine | `chat` | `text` (up to 2000 characters) |
| UI → engine | `action` | `ok`, `cancel`, `card` + `id`, `player` + `id`, `undo`, `attackAll`, `concede`, `leave` |
| UI → engine | `answer` | Reply to a `choice`: `picked` indices, `amounts`, or `value` |
| engine → UI | `state` | Full board snapshot (players, zones, stack, combat, log, prompt), at most every 40 ms |
| engine → UI | `choice` | A question the game waits on: `choose`, `reveal`, `confirm`, `order`, `amounts`, `text` |
| engine → UI | `notice` | `incorrectAction`, `alert`, `message`, `error` |
| engine → UI | `lobby` | Full lobby snapshot: `host`, `localSlot`, `port`, `addresses`, `slots` (kind, name, deck, ready, editable, controllable) |
| engine → UI | `chatMessage`, `lobbyClosed` | Chat `source`, `text`, `kind`; lobby closure also clears the game/choice in the UI |

Hidden cards are sent as `{id, hidden: true}`. Card, player and stack ids are separate number spaces.
Card `name`, `type` and `text` are in the chosen language; `typeEn` is the English type line for UI logic.
Our own UI strings live in `ui/src/i18n.ts` (Portuguese and English; other languages fall back to English).

## Design rule

No subtitles or descriptions that repeat what is visible. Explanations go in a tooltip (hover on desktop, long-press on mobile).
