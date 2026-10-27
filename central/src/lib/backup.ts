import type { Deck } from "./types";

const BACKUP_KEY = "mtg-central-library-backup:v1";

export type BackupRecord = {
  at: string;
  fingerprint: string;
};

/** Changes when a deck is added, removed, or saved. Notes and intent count, because they bump updatedAt. */
export function libraryFingerprint(decks: Pick<Deck, "id" | "updatedAt">[]): string {
  return decks
    .map((deck) => `${deck.id}@${deck.updatedAt}`)
    .sort()
    .join("|");
}

export function readBackupRecord(): BackupRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BackupRecord>;
    if (typeof parsed.at !== "string" || typeof parsed.fingerprint !== "string") return null;
    return { at: parsed.at, fingerprint: parsed.fingerprint };
  } catch {
    return null;
  }
}

export function writeBackupRecord(record: BackupRecord): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BACKUP_KEY, JSON.stringify(record));
}

export function backupState(
  decks: Pick<Deck, "id" | "updatedAt">[],
  record: BackupRecord | null,
): "missing" | "current" | "stale" {
  if (!record) return "missing";
  return record.fingerprint === libraryFingerprint(decks) ? "current" : "stale";
}
