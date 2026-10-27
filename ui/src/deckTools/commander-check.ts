import type { Deck } from "./types.ts";
import type { CardVisual } from "./cardVisual.ts";
import { canonicalizeName } from "./parse-decklist.ts";
import { deckCardCount } from "./compare.ts";
import {
  canLeadAlone,
  commanderFlags,
  namesPartnerWith,
  type CommanderFlags,
} from "./partner.ts";

export type CommanderIssueKind =
  | "banned"
  | "not-legal"
  | "color-identity"
  | "singleton"
  | "deck-size"
  | "command-zone"
  | "companion";

/** Which command-zone rule failed, for translated text. */
export type CommandZoneCode =
  | "none" | "too-many" | "background-alone" | "cannot-lead" | "pair-partner-with" | "pair-two-backgrounds"
  | "pair-needs-background" | "pair-doctor" | "pair-partner" | "pair-friends" | "pair";

export type CommanderIssue = {
  kind: CommanderIssueKind;
  code?: CommandZoneCode;
  message: string;
  names: string[];
};

export type CommanderCheckResult = {
  ok: boolean;
  issues: CommanderIssue[];
  /** Observations that do not fail the list, such as an Ikoria companion. */
  notes: string[];
  size: number;
};

const BASIC_LANDS = new Set(
  [
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
    "Wastes",
    "Snow-Covered Plains",
    "Snow-Covered Island",
    "Snow-Covered Swamp",
    "Snow-Covered Mountain",
    "Snow-Covered Forest",
  ].map(canonicalizeName),
);

function allowsAnyNumber(visual: CardVisual | undefined, name: string): boolean {
  if (BASIC_LANDS.has(canonicalizeName(name))) return true;
  const t = visual?.typeLine?.toLowerCase() ?? "";
  if (t.includes("basic") && t.includes("land")) return true;
  const o = visual?.oracleText?.toLowerCase() ?? "";
  return o.includes("a deck can have any number of cards named");
}

function identityAllows(
  cardIdentity: string[] | undefined,
  commanderIdentity: string[],
): boolean {
  const allowed = new Set(commanderIdentity.map((c) => c.toUpperCase()));
  for (const c of cardIdentity ?? []) {
    if (!allowed.has(c.toUpperCase())) return false;
  }
  return true;
}

function pairProblem(
  left: { name: string; flags: CommanderFlags },
  right: { name: string; flags: CommanderFlags },
): { code: CommandZoneCode; message: string } | null {
  const a = left.flags;
  const b = right.flags;
  if (a.partner && b.partner) return null;
  if (a.friendsForever && b.friendsForever) return null;
  if (namesPartnerWith(a, right.name) && namesPartnerWith(b, left.name)) return null;
  if (a.chooseBackground && b.background && !b.chooseBackground) return null;
  if (b.chooseBackground && a.background && !a.chooseBackground) return null;
  if (a.doctor && b.doctorsCompanion) return null;
  if (b.doctor && a.doctorsCompanion) return null;

  if ((a.partnerWith || b.partnerWith) && !(namesPartnerWith(a, right.name) && namesPartnerWith(b, left.name))) {
    const named = a.partnerWith ?? b.partnerWith;
    return { code: "pair-partner-with", message: `${left.name} and ${right.name} are not the Partner with pair. The text names ${named}.` };
  }
  if (a.background && b.background) {
    return { code: "pair-two-backgrounds", message: "Two Backgrounds cannot share the command zone. One card needs to say Choose a Background." };
  }
  if ((a.chooseBackground && !b.background) || (b.chooseBackground && !a.background)) {
    return { code: "pair-needs-background", message: "Choose a Background needs a Background enchantment as the second commander." };
  }
  if ((a.doctor && !b.doctorsCompanion) || (b.doctor && !a.doctorsCompanion)) {
    return { code: "pair-doctor", message: "A Doctor in the command zone needs a card with Doctor's companion, or another legal partner ability." };
  }
  if ((a.partner && !b.partner) || (b.partner && !a.partner)) {
    return { code: "pair-partner", message: "Partner only shares the command zone with another card that says Partner." };
  }
  if ((a.friendsForever && !b.friendsForever) || (b.friendsForever && !a.friendsForever)) {
    return { code: "pair-friends", message: "Friends forever only shares the command zone with another Friends forever card." };
  }
  return { code: "pair", message: `${left.name} and ${right.name} are not a legal commander pair.` };
}

function commandZoneIssue(
  deck: Deck,
  get: (name: string) => CardVisual | undefined,
  notes: string[],
): CommanderIssue | null {
  const rows = deck.commanders.map((card) => {
    const visual = get(card.name);
    return { name: card.name, flags: commanderFlags(visual) };
  });

  if (rows.length === 0) {
    return { kind: "command-zone", code: "none", message: "This list has no commander.", names: [] };
  }
  if (rows.length > 2) {
    return {
      kind: "command-zone",
      code: "too-many",
      message: "Commander allows two commanders at most.",
      names: rows.map((row) => row.name),
    };
  }
  if (rows.some((row) => !row.flags.loaded)) {
    if (rows.some((row) => row.flags.failed)) {
      notes.push("Some commander text did not load, so partner, Background, and Doctor's companion rules were not checked.");
    }
    return null;
  }

  if (rows.length === 1) {
    const only = rows[0];
    if (only.flags.background && !canLeadAlone(only.flags)) {
      return {
        kind: "command-zone",
        code: "background-alone",
        message: `${only.name} is a Background. It shares the command zone with a commander that says Choose a Background, and it cannot lead a deck alone.`,
        names: [only.name],
      };
    }
    if (!canLeadAlone(only.flags)) {
      return {
        kind: "command-zone",
        code: "cannot-lead",
        message: `${only.name} cannot be your commander.`,
        names: [only.name],
      };
    }
    return null;
  }

  const problem = pairProblem(rows[0], rows[1]);
  if (!problem) return null;
  return {
    kind: "command-zone",
    code: problem.code,
    message: problem.message,
    names: [rows[0].name, rows[1].name],
  };
}

function companionNote(
  deck: Deck,
  get: (name: string) => CardVisual | undefined,
): { issue: CommanderIssue | null; note: string | null } {
  const companions = (deck.sideboard ?? []).filter((card) => commanderFlags(get(card.name)).companion);
  if (companions.length > 1) {
    return {
      issue: {
        kind: "companion",
        message: "Only one companion is allowed, and it sits outside the 100 cards.",
        names: companions.map((card) => card.name),
      },
      note: null,
    };
  }
  if (companions.length === 1) {
    return {
      issue: null,
      note: `${companions[0].name} is a companion, so it stays outside the 100. This check does not prove the deck meets that card's restriction.`,
    };
  }
  return { issue: null, note: null };
}

/**
 * Commander list check: legality, color identity, singleton, size 100,
 * and whether the command zone is a legal pair.
 * Uses Scryfall-backed CardVisual data. It does not invent rulings.
 */
export function checkCommanderDeck(
  deck: Deck,
  get: (name: string) => CardVisual | undefined,
): CommanderCheckResult {
  const issues: CommanderIssue[] = [];
  const notes: string[] = [];
  const size = deckCardCount(deck);

  if (size !== 100) {
    issues.push({
      kind: "deck-size",
      message: `Deck is ${size} cards including commanders. Commander expects 100. A companion in the sideboard is not part of that 100.`,
      names: [],
    });
  }

  const zone = commandZoneIssue(deck, get, notes);
  if (zone) issues.push(zone);
  const companion = companionNote(deck, get);
  if (companion.issue) issues.push(companion.issue);
  if (companion.note) notes.push(companion.note);

  const cmdIdentity =
    deck.colorIdentity && deck.colorIdentity.length
      ? deck.colorIdentity
      : Array.from(
          new Set(
            deck.commanders.flatMap((c) => get(c.name)?.colorIdentity ?? []),
          ),
        );

  const banned: string[] = [];
  const notLegal: string[] = [];
  const colorBreaks: string[] = [];
  const singletonBreaks: string[] = [];

  const allLines = [...deck.commanders, ...deck.cards];

  for (const line of allLines) {
    const v = get(line.name);
    const legal = v?.commanderLegality;
    if (legal === "banned") banned.push(line.name);
    else if (legal != null && legal !== "legal" && legal !== "restricted") {
      notLegal.push(line.name);
    }

    if (cmdIdentity.length && v?.colorIdentity) {
      if (!identityAllows(v.colorIdentity, cmdIdentity)) {
        colorBreaks.push(line.name);
      }
    }

    if (line.quantity > 1 && !allowsAnyNumber(v, line.name)) {
      singletonBreaks.push(`${line.name} (×${line.quantity})`);
    }
  }

  // Also catch duplicate lines merged poorly — already quantity-based above

  if (banned.length) {
    issues.push({
      kind: "banned",
      message: "Banned in Commander (Scryfall legalities.commander).",
      names: Array.from(new Set(banned)),
    });
  }
  if (notLegal.length) {
    issues.push({
      kind: "not-legal",
      message: "Not legal in Commander (Scryfall legalities.commander).",
      names: Array.from(new Set(notLegal)),
    });
  }
  if (colorBreaks.length) {
    issues.push({
      kind: "color-identity",
      message: `Outside commander color identity (${cmdIdentity.join("") || "unknown"}): ${Array.from(new Set(colorBreaks)).join(", ")}.`,
      names: Array.from(new Set(colorBreaks)),
    });
  }
  if (singletonBreaks.length) {
    issues.push({
      kind: "singleton",
      message:
        "Singleton break — duplicates beyond basic lands / “any number” cards.",
      names: Array.from(new Set(singletonBreaks)),
    });
  }

  return { ok: issues.length === 0, issues, notes, size };
}
