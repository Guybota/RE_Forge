import type { CardVisual } from "./scryfall";
import { canonicalizeName } from "./parse-decklist";

export type PartnerEligibility =
  | { ok: true }
  | { ok: false; reason: string };

export type CommanderFlags = {
  loaded: boolean;
  failed: boolean;
  legendaryCreature: boolean;
  canBeCommander: boolean;
  background: boolean;
  chooseBackground: boolean;
  /** Standalone Partner. "Partner with Name" is partnerWith, not this. */
  partner: boolean;
  partnerWith: string | null;
  friendsForever: boolean;
  doctorsCompanion: boolean;
  /** Creature type Doctor, the Time Lord side of Doctor's companion. */
  doctor: boolean;
  /** Ikoria companion keyword. This card belongs outside the 100. */
  companion: boolean;
};

const EMPTY: CommanderFlags = {
  loaded: false,
  failed: false,
  legendaryCreature: false,
  canBeCommander: false,
  background: false,
  chooseBackground: false,
  partner: false,
  partnerWith: null,
  friendsForever: false,
  doctorsCompanion: false,
  doctor: false,
  companion: false,
};

/** Oracle and type line, one place, so the menu and the legality check agree. */
export function commanderFlags(visual: CardVisual | undefined): CommanderFlags {
  if (!visual || visual.failed || (!visual.oracleText && !visual.typeLine)) {
    return { ...EMPTY, failed: Boolean(visual?.failed) };
  }
  const oracle = (visual.oracleText ?? "").toLowerCase();
  const type = (visual.typeLine ?? "").toLowerCase();
  const partnerWith = oracle.match(/partner with ([^.\n]+)/);
  const genericPartner = /\bpartner\b/.test(oracle) && !/partner with\b/.test(oracle);
  return {
    loaded: true,
    failed: false,
    legendaryCreature: type.includes("legendary") && type.includes("creature"),
    canBeCommander: /can be your commander/.test(oracle),
    background: /\bbackground\b/.test(type),
    chooseBackground: /choose a background/.test(oracle),
    partner: genericPartner,
    partnerWith: partnerWith ? partnerWith[1].trim() : null,
    friendsForever: /friends forever/.test(oracle),
    doctorsCompanion: /doctor'?s companion/.test(oracle),
    doctor: /\bdoctor\b/.test(type),
    companion: /^companion\b/im.test(visual.oracleText ?? ""),
  };
}

export function canLeadAlone(flags: CommanderFlags): boolean {
  if (flags.background && !flags.legendaryCreature && !flags.canBeCommander) return false;
  return (
    flags.legendaryCreature ||
    flags.canBeCommander ||
    flags.chooseBackground ||
    flags.partner ||
    flags.partnerWith != null ||
    flags.friendsForever ||
    flags.doctor
  );
}

export function namesPartnerWith(flags: CommanderFlags, otherName: string): boolean {
  if (!flags.partnerWith) return false;
  return canonicalizeName(flags.partnerWith) === canonicalizeName(otherName);
}

/**
 * Whether this card can share a command zone with the right other card.
 * The legality check decides whether the actual pair is legal.
 */
export function partnerEligibility(visual: CardVisual | undefined): PartnerEligibility {
  const flags = commanderFlags(visual);
  if (!flags.loaded) {
    return { ok: false, reason: flags.failed ? "Card text did not load." : "Card data not loaded yet." };
  }
  if (
    flags.partner ||
    flags.partnerWith ||
    flags.friendsForever ||
    flags.chooseBackground ||
    flags.background ||
    flags.doctorsCompanion ||
    flags.doctor
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "No Partner, Friends forever, Background, or Doctor's companion.",
  };
}
