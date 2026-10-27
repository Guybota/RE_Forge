import type { Deck } from "./types.ts";
import {
  isExtraTurn,
  isFastMana,
  isGameChanger,
  isMassLandDenial,
} from "./game-changers.ts";

export type BracketTriggerKind = "game-changer" | "fast-mana" | "mld" | "extra-turn";

export type BracketTrigger = {
  name: string;
  kind: BracketTriggerKind;
};

export type BracketEstimate = {
  bracket: 1 | 2 | 3 | 4 | 5;
  label: string;
  /** Short human rule that decided the bracket. */
  rule: string;
  gameChangers: string[];
  fastMana: string[];
  massLandDenial: string[];
  extraTurns: string[];
  /** Cards that raised the estimate (for faces + cut list). */
  triggers: BracketTrigger[];
  note: string;
  cutToMoveDown: string[];
  disclaimer: string;
};

export const BRACKET_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Exhibition",
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
  5: "cEDH",
};

const DISCLAIMER =
  "Game Changers follow the Commander Format Panel list (February 9, 2026). Fast mana, mass land denial, and extra turns are local signals. This is a list estimate, not an official Wizards certification. Intent (especially 1 vs 2 and 4 vs 5) cannot be fully known from a list alone.";

function uniqueNames(deck: Deck): string[] {
  const lines = [...deck.commanders, ...deck.cards];
  return Array.from(new Set(lines.map((c) => c.name))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/**
 * Heuristic Commander bracket 1–5 from the decklist.
 * Primary action for the Calculate bracket button on deck detail.
 */
export function estimateBracket(deck: Deck): BracketEstimate {
  const names = uniqueNames(deck);
  const gameChangers = names.filter(isGameChanger);
  const fastMana = names.filter(isFastMana);
  const massLandDenial = names.filter(isMassLandDenial);
  const extraTurns = names.filter(isExtraTurn);

  const gc = gameChangers.length;
  const fm = fastMana.length;
  const hasMld = massLandDenial.length > 0;
  const hasEt = extraTurns.length > 0;

  let bracket: 1 | 2 | 3 | 4 | 5;
  let rule: string;

  // 5 — very high GC + dense fast mana (“looks like cEDH”)
  if (gc >= 6 && fm >= 6) {
    bracket = 5;
    rule = `${gc} Game Changers and ${fm} fast-mana pieces — looks like cEDH from the list`;
  }
  // 4 — 4+ GC, or MLD, or extra turns alongside any GC
  else if (gc >= 4 || hasMld || (hasEt && gc >= 1)) {
    bracket = 4;
    if (gc >= 4) {
      rule = `${gc} Game Changers (≥4) → Optimized`;
    } else if (hasMld) {
      rule = `Mass land denial present (${massLandDenial.slice(0, 3).join(", ")}) → Optimized`;
    } else {
      rule = `Extra-turn spell(s) alongside Game Changers → Optimized`;
    }
  }
  // 3 — 1–3 GC, no MLD
  else if (gc >= 1 && gc <= 3 && !hasMld) {
    bracket = 3;
    rule = `${gc} Game Changer${gc === 1 ? "" : "s"}, no mass land denial → Upgraded`;
  }
  // 1 — no GC, no MLD, no extra turns, no fast mana
  else if (gc === 0 && !hasMld && !hasEt && fm === 0) {
    bracket = 1;
    rule =
      "No Game Changers, no mass land denial, no extra turns, no fast mana → Exhibition (intent can still place a jank list here)";
  }
  // 2 — no GC, no MLD, no extra turns, light/any remaining fast mana
  else if (gc === 0 && !hasMld && !hasEt) {
    bracket = 2;
    rule =
      fm > 0
        ? `No Game Changers / MLD / extra turns, ${fm} fast-mana piece${fm === 1 ? "" : "s"} → Core`
        : "No Game Changers, no mass land denial, no extra turns → Core";
  }
  // Fallback (e.g. ET without GC): treat as Core–Upgraded edge → Optimized if ET alone is scary
  else if (hasEt && gc === 0 && !hasMld) {
    bracket = 2;
    rule =
      "Extra-turn spells without Game Changers — still Core as a list estimate (intent may differ)";
  } else {
    bracket = 2;
    rule = "Default Core when no higher rule matched";
  }

  const triggers: BracketTrigger[] = [
    ...gameChangers.map((name) => ({ name, kind: "game-changer" as const })),
    ...massLandDenial.map((name) => ({ name, kind: "mld" as const })),
    ...extraTurns.map((name) => ({ name, kind: "extra-turn" as const })),
    ...fastMana
      .filter((n) => bracket >= 4 || (bracket === 5 && isFastMana(n)))
      .slice(0, bracket >= 5 ? 12 : 6)
      .map((name) => ({ name, kind: "fast-mana" as const })),
  ];

  // Deduplicate by name (GC that is also fast mana)
  const seen = new Set<string>();
  const dedupedTriggers = triggers.filter((t) => {
    const k = t.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const cutToMoveDown = Array.from(
    new Set([...gameChangers, ...massLandDenial, ...extraTurns]),
  ).slice(0, 10);

  let note = "";
  if (bracket === 1) {
    note =
      "Exhibition from the list — a truly jank pile can sit here, but table intent still matters for 1 vs 2.";
  } else if (bracket === 2) {
    note =
      "Core / precon-adjacent from the list. Intent can still push a soft list into Exhibition or a tuned one into Upgraded.";
  } else if (bracket === 3) {
    note =
      "Upgraded: a handful of Game Changers without mass land denial. Cut listed pieces to ease toward Core.";
  } else if (bracket === 4) {
    note =
      "Optimized signals: many Game Changers, mass land denial, and/or extra turns with Game Changers.";
  } else {
    note =
      "cEDH-looking density of Game Changers plus fast mana — 4 vs 5 is especially intent-sensitive.";
  }

  return {
    bracket,
    label: BRACKET_LABELS[bracket],
    rule,
    gameChangers,
    fastMana,
    massLandDenial,
    extraTurns,
    triggers: dedupedTriggers,
    note,
    cutToMoveDown,
    disclaimer: DISCLAIMER,
  };
}
