import { test, expect } from "@playwright/test";
import { cardNamesMatch, type CardVisual } from "../src/lib/scryfall";
import { parseImportPaste } from "../src/lib/import-formats";
import { emptyLibrary, importLibraryJson } from "../src/lib/storage";
import { backupState, libraryFingerprint } from "../src/lib/backup";
import { checkCommanderDeck } from "../src/lib/commander-check";
import { readDeckRoles } from "../src/lib/deck-roles";
import type { Deck } from "../src/lib/types";

const deck = (id: string, name: string): Deck => ({
  id,
  name,
  commanders: [{ name: "Giada, Font of Hope", quantity: 1, zone: "command" }],
  cards: [{ name: "Sol Ring", quantity: 1 }],
  format: "commander",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

test("card name matching accepts faces and rejects substrings", () => {
  expect(cardNamesMatch("Sol Ring", "Sol Ring")).toBe(true);
  expect(cardNamesMatch("Delver of Secrets", "Delver of Secrets // Insectile Aberration")).toBe(
    true,
  );
  expect(cardNamesMatch("Insectile Aberration", "Delver of Secrets // Insectile Aberration")).toBe(
    true,
  );
  expect(cardNamesMatch("Sol Ring", "Sol Ring of the Ancients")).toBe(false);
  expect(cardNamesMatch("Island", "Island Sanctuary")).toBe(false);
});

test("import keeps commander, mainboard, and sideboard apart", () => {
  const parsed = parseImportPaste(`Commander
1 Giada, Font of Hope

Deck
1 Sol Ring (LTC) 12
1 Plains

Sideboard
1 Path to Exile
SB: 1 Swords to Plowshares

Maybeboard
1 Mana Crypt`);

  expect(parsed.commanders.map((c) => c.name)).toEqual(["Giada, Font of Hope"]);
  expect(parsed.cards.map((c) => c.name)).toEqual(["Plains", "Sol Ring"]);
  expect(parsed.sideboard.map((c) => c.name).sort()).toEqual([
    "Path to Exile",
    "Swords to Plowshares",
  ]);
});

test("archidekt sideboard category and comment headers", () => {
  const parsed = parseImportPaste(`// Commander
1 Bruna, the Fading Light

1x Sol Ring {Ramp}
1x Path to Exile {Sideboard}`);

  expect(parsed.detected).toBe("archidekt");
  expect(parsed.commanders.map((c) => c.name)).toEqual(["Bruna, the Fading Light"]);
  expect(parsed.cards.map((c) => c.name)).toEqual(["Sol Ring"]);
  expect(parsed.sideboard.map((c) => c.name)).toEqual(["Path to Exile"]);
});

test("json import merges by id", () => {
  const current = emptyLibrary();
  current.decks = [deck("a", "Old")];
  const raw = JSON.stringify({
    version: 1,
    decks: [deck("a", "Updated"), deck("b", "New")],
  });
  const result = importLibraryJson(current, raw);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.added).toBe(1);
  expect(result.updated).toBe(1);
  expect(result.library.decks.map((d) => d.name)).toEqual(["New", "Updated"]);
});

const visual = (partial: Partial<CardVisual> & { name: string }): CardVisual => ({
  commanderLegality: "legal",
  ...partial,
});

const list = (commanders: string[], cards: { name: string; quantity?: number }[] = [], sideboard: string[] = []): Deck => ({
  id: "t",
  name: "Test",
  commanders: commanders.map((name) => ({ name, quantity: 1, zone: "command" as const })),
  cards: cards.map((card) => ({ name: card.name, quantity: card.quantity ?? 1 })),
  sideboard: sideboard.map((name) => ({ name, quantity: 1, zone: "sideboard" as const })),
  format: "commander",
  colorIdentity: ["W"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

test("backup fingerprint changes when a deck is saved", () => {
  const first = libraryFingerprint([deck("a", "Old")]);
  const saved = deck("a", "Old");
  saved.updatedAt = "2026-02-01T00:00:00.000Z";
  expect(backupState([deck("a", "Old")], { at: "2026-01-02T00:00:00.000Z", fingerprint: first })).toBe("current");
  expect(backupState([saved], { at: "2026-01-02T00:00:00.000Z", fingerprint: first })).toBe("stale");
  expect(backupState([deck("a", "Old")], null)).toBe("missing");
});

test("command zone accepts a real pair and rejects two unrelated legends", () => {
  const cards = new Map<string, CardVisual>([
    ["giada, font of hope", visual({ name: "Giada, Font of Hope", typeLine: "Legendary Creature — Angel", oracleText: "Flying" })],
    ["bruna, the fading light", visual({ name: "Bruna, the Fading Light", typeLine: "Legendary Creature — Angel", oracleText: "Flying" })],
    ["tymna the weaver", visual({ name: "Tymna the Weaver", typeLine: "Legendary Creature — Human Cleric", oracleText: "Partner" })],
    ["thrasios, triton hero", visual({ name: "Thrasios, Triton Hero", typeLine: "Legendary Creature — Merfolk Wizard", oracleText: "Partner" })],
    ["othelm, sigardian outcast", visual({ name: "Othelm, Sigardian Outcast", typeLine: "Legendary Creature — Human Cleric", oracleText: "Partner with Timin, Youthful Geist" })],
    ["timin, youthful geist", visual({ name: "Timin, Youthful Geist", typeLine: "Legendary Creature — Spirit", oracleText: "Partner with Othelm, Sigardian Outcast" })],
    ["wilson, refined grizzly", visual({ name: "Wilson, Refined Grizzly", typeLine: "Legendary Creature — Bear Warrior", oracleText: "Choose a Background" })],
    ["raised by giants", visual({ name: "Raised by Giants", typeLine: "Legendary Enchantment — Background", oracleText: "Commander creatures you own have trample." })],
    ["the fourth doctor", visual({ name: "The Fourth Doctor", typeLine: "Legendary Creature — Time Lord Doctor", oracleText: "Whenever you draw a card, you gain 1 life." })],
    ["sarah jane smith", visual({ name: "Sarah Jane Smith", typeLine: "Legendary Creature — Human Scientist", oracleText: "Doctor's companion" })],
    ["lurrus of the dream-den", visual({ name: "Lurrus of the Dream-Den", typeLine: "Legendary Creature — Cat Nightmare", oracleText: "Companion — Each permanent card in your starting deck has mana value 2 or less." })],
  ]);
  const get = (name: string) => cards.get(name.toLowerCase());

  expect(checkCommanderDeck(list(["Giada, Font of Hope", "Bruna, the Fading Light"]), get).issues.some((issue) => issue.kind === "command-zone")).toBe(true);
  expect(checkCommanderDeck(list(["Tymna the Weaver", "Thrasios, Triton Hero"]), get).issues.some((issue) => issue.kind === "command-zone")).toBe(false);
  expect(checkCommanderDeck(list(["Othelm, Sigardian Outcast", "Timin, Youthful Geist"]), get).issues.some((issue) => issue.kind === "command-zone")).toBe(false);
  expect(checkCommanderDeck(list(["Othelm, Sigardian Outcast", "Giada, Font of Hope"]), get).issues.some((issue) => issue.kind === "command-zone")).toBe(true);
  expect(checkCommanderDeck(list(["Wilson, Refined Grizzly", "Raised by Giants"]), get).issues.some((issue) => issue.kind === "command-zone")).toBe(false);
  expect(checkCommanderDeck(list(["Raised by Giants"]), get).issues.some((issue) => issue.kind === "command-zone")).toBe(true);
  expect(checkCommanderDeck(list(["The Fourth Doctor", "Sarah Jane Smith"]), get).issues.some((issue) => issue.kind === "command-zone")).toBe(false);

  const withCompanion = checkCommanderDeck(list(["Giada, Font of Hope"], [], ["Lurrus of the Dream-Den"]), get);
  expect(withCompanion.issues.some((issue) => issue.kind === "companion")).toBe(false);
  expect(withCompanion.notes.some((note) => note.includes("Lurrus"))).toBe(true);
  const twoCompanions = checkCommanderDeck(
    list(["Giada, Font of Hope"], [], ["Lurrus of the Dream-Den", "Lurrus of the Dream-Den"]),
    get,
  );
  expect(twoCompanions.issues.some((issue) => issue.kind === "companion")).toBe(true);
});

test("deck jobs count lands, ramp, draw, and wipes from card text", () => {
  const cards = new Map<string, CardVisual>([
    ["giada, font of hope", visual({ name: "Giada, Font of Hope", typeLine: "Legendary Creature — Angel", manaCost: "{1}{W}", oracleText: "Flying" })],
    ["plains", visual({ name: "Plains", typeLine: "Basic Land — Plains", oracleText: "({T}: Add {W}.)" })],
    ["sol ring", visual({ name: "Sol Ring", typeLine: "Artifact", manaCost: "{1}", oracleText: "{T}: Add {C}{C}." })],
    ["swords to plowshares", visual({ name: "Swords to Plowshares", typeLine: "Instant", manaCost: "{W}", oracleText: "Exile target creature. Its controller gains life equal to its power." })],
    ["wrath of god", visual({ name: "Wrath of God", typeLine: "Sorcery", manaCost: "{2}{W}{W}", oracleText: "Destroy all creatures. They can't be regenerated." })],
    ["rhystic study", visual({ name: "Rhystic Study", typeLine: "Enchantment", manaCost: "{2}{U}", oracleText: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}." })],
  ]);
  const get = (name: string) => cards.get(name.toLowerCase());
  const roles = readDeckRoles(
    list(
      ["Giada, Font of Hope"],
      [
        { name: "Plains", quantity: 10 },
        { name: "Sol Ring" },
        { name: "Swords to Plowshares" },
        { name: "Wrath of God" },
        { name: "Rhystic Study" },
      ],
    ),
    get,
  );
  const count = (key: string) => roles.roles.find((role) => role.key === key)?.count ?? 0;
  expect(count("lands")).toBe(10);
  expect(count("ramp")).toBe(1);
  expect(count("draw")).toBe(1);
  expect(count("removal")).toBe(1);
  expect(count("wipes")).toBe(1);
  const white = roles.pips.find((pip) => pip.color === "W");
  expect(white?.sources).toBe(10);
  expect((white?.pips ?? 0) > 0).toBe(true);
});
