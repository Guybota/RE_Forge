# MTG Central

Commander toolkit for saving decks in the browser, comparing two lists side-by-side, and diffing a list against a reference paste. **Cardmarket EUR** comes live from Scryfall `prices.eur`. Installable as a **Progressive Web App**.

This npm workspace provides the deck library, compare, improve, precons, card search and Sage tools. Play embeds the current built RE:Forge interface from `ui/`; there is no separate gameplay implementation. Electron reuses its running engine. Browser development starts one local engine and shares pending startup requests. External lists are checked and played in memory, without replacing saved Forge decks.

## Features

1. **My Decks** - create, paste, edit, delete, import, and export decks in `localStorage` (`mtg-central-deck-library:v1`). Seeds Giada (precon) and Bruna (upgraded) Angels lists. The list shows commander art; the full gallery and EUR total load when a deck is opened. Paste keeps commander and sideboard sections out of the 99, and color identity comes from the commander's Scryfall color identity.
2. **Compare Decks** - shared / only-A / only-B plus quantity diffs, with hover/tap full-card previews. The `?a=&b=` link stays in sync with the pickers.
3. **Improve Decks** - paste a reference list to diff cuts, adds, and swaps for any commander. Giada and Bruna also have a hand-written Angel demo pack (collapsed). Swap EUR is live from Scryfall.
4. **Magic Sage** - card lookup, Scryfall rulings, Commander legality, and Spellbook combos. Not an AI judge.
5. **PWA** - install to home screen / desktop for a standalone app shell.
6. **Card Search** - query card names, rules, types, colors, legality and prices, then inspect results and navigate the loaded cards.

## Run locally

```bash
npm ci                  # from the repository root
npm run build:ui
npm run central:dev
```

Dev server defaults to **http://127.0.0.1:4317**. The desktop uses the same fixed origin so localStorage survives app restarts; a port conflict fails explicitly. `RE_FORGE_CENTRAL_PORT` changes the desktop port and therefore its storage origin. Install and build this workspace from the repository root; the root lockfile covers all workspaces.

```bash
npm run build           # from the repository root: both interfaces and standalone staging
npm run start -w mtg-central
npm run central:test
```

Service worker (`public/sw.js`) registers in production builds (`npm run build` + `npm start`). It is not registered during `next dev` so hot reload stays simple.

### Icons

Icons in `public/icons` are already generated. To rebuild them from `public/icons/icon.svg`:

```bash
npm run icons
```

## Install the app

### Desktop (Chrome / Edge / Chromium)

1. Open the site over HTTPS (or localhost).
2. Use the **Install app** control in the header, or the browser install icon in the address bar.
3. Confirm - MTG Central opens in its own window (`display: standalone`).

### Android (Chrome)

1. Open the site.
2. Tap **Install app**, or Chrome menu → **Install app** / **Add to Home screen**.

### iPhone / iPad (Safari)

iOS does not show an automatic install banner for PWAs:

1. Open the site in **Safari**.
2. Tap **Share**.
3. Choose **Add to Home Screen**.
4. Confirm the name **MTG Central**.

Decks remain in that browser profile's `localStorage` (same origin).

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · custom PWA service worker

## Notes

- The library stays in this browser profile. Export downloads JSON; Play sends the selected list to the local Forge engine without saving it there. Import merges a library export, a deck array, or one deck by id.
- Card art and **Cardmarket EUR** (`prices.eur`) load from **Scryfall** (batched `/cards/collection`, cached in `localStorage` + SW). A requested name is stored only when it matches the printing or a face of a double-faced card. Missing EUR shows "price unavailable" - never a fake number.
- Improve suggestions are a diff against a list you paste. The Angel demo pack is hand-written for Giada and Bruna. Not an EDHREC or Cardmarket partner API.
- Offline: cached app shell + `/offline` fallback; Scryfall needs network the first time (then CacheFirst for images).
