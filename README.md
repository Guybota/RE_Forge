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
```

`SMOKE_OPPONENTS=3` plays a 4-player game; `SMOKE_DEBUG=1` prints every message.

## Data

The engine keeps Forge's preferences, decks and caches in `%APPDATA%\RE-Forge` (`~/.re-forge` elsewhere, or `--data <dir>`),
never in the `%APPDATA%\Forge` folder an installed Forge uses. It does this by writing `forge/forge-gui/forge.profile.properties`
(ignored by Forge's git) on every start.

## Engine protocol

JSON messages over `ws://127.0.0.1:<port>`, each with a `type`. Shapes are typed in `ui/src/engine.ts`.

| Direction | `type` | What |
|---|---|---|
| UI → engine | `hello`, `listDecks` | Engine info; the Commander precon names |
| UI → engine | `startMatch` | `deck` (name or null for random), `opponents` 1–3 |
| UI → engine | `action` | `ok`, `cancel`, `card` + `id`, `player` + `id`, `undo`, `attackAll`, `concede`, `leave` |
| UI → engine | `answer` | Reply to a `choice`: `picked` indices, `amounts`, or `value` |
| engine → UI | `state` | Full board snapshot (players, zones, stack, combat, log, prompt), at most every 40 ms |
| engine → UI | `choice` | A question the game waits on: `choose`, `reveal`, `confirm`, `order`, `amounts`, `text` |
| engine → UI | `notice` | `incorrectAction`, `alert`, `message`, `error` |

Hidden cards are sent as `{id, hidden: true}`. Card, player and stack ids are separate number spaces.

## Design rule

No subtitles or descriptions that repeat what is visible. Explanations go in a tooltip (hover on desktop, long-press on mobile).
