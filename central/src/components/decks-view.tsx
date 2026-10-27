"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Plus, Search, Tag, Trash2, Upload } from "lucide-react";
import { NewDeckDialog } from "@/components/new-deck-dialog";
import { PasteDeckDialog } from "@/components/paste-deck-dialog";
import { ColorPips } from "@/components/color-pips";
import { useCardImages } from "@/hooks/use-card-images";
import { useDeckLibrary } from "@/hooks/use-deck-library";
import { backupState, libraryFingerprint, readBackupRecord, writeBackupRecord, type BackupRecord } from "@/lib/backup";
import { BRACKET_LABELS } from "@/lib/bracket";
import { deckCardCount } from "@/lib/compare";
import { cachedDeckTotalEur } from "@/lib/prices";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatUpdated(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function deckHaystack(deck: { name: string; notes?: string; tags?: string[]; commanders: { name: string }[]; cards: { name: string }[]; sideboard?: { name: string }[] }): string {
  return [
    deck.name,
    deck.notes ?? "",
    ...(deck.tags ?? []),
    ...deck.commanders.map((card) => card.name),
    ...deck.cards.map((card) => card.name),
    ...(deck.sideboard ?? []).map((card) => card.name),
  ]
    .join("\n")
    .toLowerCase();
}

function downloadText(filename: string, body: string, type: string) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DecksView() {
  const {
    state,
    decks,
    lastOpenedDeckId,
    createDeck,
    resetLibrary,
    clearLibrary,
    exportJson,
    importJson,
  } = useDeckLibrary();
  const router = useRouter();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupRecord | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBackup(readBackupRecord());
  }, [decks]);

  const commanderNames = useMemo(
    () => decks.flatMap((deck) => deck.commanders.map((card) => card.name)),
    [decks],
  );
  const { get: getCmdArt, loading: artLoading } = useCardImages(commanderNames);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const deck of decks) for (const tag of deck.tags ?? []) set.add(tag);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [decks]);

  const visibleDecks = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return decks.filter((deck) => {
      if (tagFilter && !(deck.tags ?? []).includes(tagFilter)) return false;
      if (!terms.length) return true;
      const hay = deckHaystack(deck);
      return terms.every((term) => hay.includes(term));
    });
  }, [decks, tagFilter, query]);

  const freshness = backupState(decks, backup);
  const backupWhen = backup
    ? new Date(backup.at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const downloadBackup = () => {
    const json = exportJson();
    if (!json) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`mtg-central-library-${stamp}.json`, json, "application/json");
    const record = { at: new Date().toISOString(), fingerprint: libraryFingerprint(decks) };
    writeBackupRecord(record);
    setBackup(record);
  };

  const lastOpened = decks.find((deck) => deck.id === lastOpenedDeckId) ?? null;

  if (state.status === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted-foreground">Restoring decks…</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="animate-shimmer h-56 rounded-2xl bg-gradient-to-r from-muted via-secondary to-muted"
            />
          ))}
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-10 sm:px-6">
        <Alert variant="destructive">
          <AlertTitle>Library could not be loaded</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          {state.raw && (
            <Button
              variant="outline"
              onClick={() => downloadText("mtg-central-library-recovery.json", state.raw!, "application/json")}
            >
              Export what we can
            </Button>
          )}
          <Button variant="destructive" onClick={() => resetLibrary()}>
            Reset local library
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="animate-fade-in flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            My Decks
          </h1>
          <p className="mt-1 text-muted-foreground">
            Commander lists saved in this browser. Seed includes Giada precon and Bruna upgraded.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {lastOpened && (
            <Link
              href={`/decks/${lastOpened.id}`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              Continue {lastOpened.name}
            </Link>
          )}
          <Button variant="outline" size="sm" onClick={() => setPasteOpen(true)}>
            <Upload className="size-4" />
            Paste a list
          </Button>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" />
            New deck
          </Button>
          <Link
            href="/precons"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Official precons
          </Link>
          <Button variant="ghost" size="sm" onClick={downloadBackup}>
            <Download className="size-4" />
            Download backup
          </Button>
          <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()}>
            <Upload className="size-4" />
            Import JSON
          </Button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void file.text().then((raw) => {
                const result = importJson(raw);
                setImportNote(
                  result.ok
                    ? `Imported ${result.added} new and updated ${result.updated}.`
                    : result.error,
                );
              });
            }}
          />
          {decks.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
              <Trash2 className="size-4" />
              Clear library
            </Button>
          )}
        </div>
      </div>

      {decks.length > 0 && (
        <div className="mt-4 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-sm text-muted-foreground">
          {freshness === "missing" &&
            "These decks live only in this browser. Download a backup so a cleared site cannot take them."}
          {freshness === "current" && `Last backup ${backupWhen}. The library matches that file.`}
          {freshness === "stale" &&
            `The library has changed since the last backup${backupWhen ? ` (${backupWhen})` : ""}. Download a new copy before you clear this browser.`}
        </div>
      )}

      {importNote && (
        <Alert className="mt-4">
          <AlertTitle>Import</AlertTitle>
          <AlertDescription>{importNote}</AlertDescription>
        </Alert>
      )}

      {decks.length === 0 ? (
        <div className="panel mt-16 px-6 py-14 text-center">
          <h2 className="font-display text-2xl font-semibold">No decks yet</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">
            Save a Commander list in this browser. You can compare and improve it later.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button onClick={() => setNewOpen(true)}>New deck</Button>
            <Button variant="outline" onClick={() => setPasteOpen(true)}>
              Paste a list
            </Button>
            <Button variant="secondary" onClick={() => resetLibrary()}>
              Load seed Angels decks
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative mt-6 max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, commander, or a card"
              className="h-9 pl-8"
              aria-label="Search decks"
            />
          </div>
          {allTags.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Tag className="size-3.5 text-muted-foreground" aria-hidden />
              <Button
                size="sm"
                variant={tagFilter == null ? "default" : "outline"}
                onClick={() => setTagFilter(null)}
              >
                All tags
              </Button>
              {allTags.map((tag) => (
                <Button
                  key={tag}
                  size="sm"
                  variant={tagFilter === tag ? "default" : "outline"}
                  onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
          )}
          {visibleDecks.length === 0 ? (
            <p className="mt-10 text-sm text-muted-foreground">
              {query.trim()
                ? `No decks match “${query.trim()}”${tagFilter ? ` with tag “${tagFilter}”` : ""}.`
                : `No decks with tag “${tagFilter}”.`}
            </p>
          ) : (
            <ul className="mt-8 grid gap-5 sm:grid-cols-2">
              {visibleDecks.map((deck) => {
                const cmd = deck.commanders[0]?.name ?? "Unknown commander";
                const art = getCmdArt(cmd);
                const totalEur = cachedDeckTotalEur(deck);
                return (
                  <li key={deck.id}>
                    <Link
                      href={`/decks/${deck.id}`}
                      className="panel group block w-full overflow-hidden text-left transition hover:border-primary/50 hover:bg-card/80"
                    >
                      <div className="relative h-40 overflow-hidden sm:h-48">
                        {art?.artCrop || art?.normal ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={art.artCrop ?? art.normal}
                            alt=""
                            className="h-full w-full object-cover object-top transition duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div
                            className={cn(
                              "flex h-full items-center justify-center bg-gradient-to-br from-secondary to-muted",
                              artLoading && "animate-shimmer",
                            )}
                          >
                            <span className="text-sm text-muted-foreground">{cmd}</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
                        <div className="absolute right-3 top-3">
                          <ColorPips colors={deck.colorIdentity} />
                        </div>
                        <div className="absolute bottom-3 left-3 right-3">
                          <p className="font-display text-xl font-bold drop-shadow-md">
                            {deck.name}
                          </p>
                          <p className="text-sm text-foreground/85 drop-shadow">
                            {deck.commanders.map((c) => c.name).join(" / ") || "No commander"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                        <Badge variant="secondary">{deckCardCount(deck)} cards</Badge>
                        {totalEur != null && (
                          <Badge variant="outline" className="border-primary/30 text-primary">
                            €{totalEur.toFixed(0)}
                          </Badge>
                        )}
                        {deck.calculatedBracket && (
                          <Badge variant="outline" className="border-primary/40 text-primary">
                            Bracket {deck.calculatedBracket} · {BRACKET_LABELS[deck.calculatedBracket]}
                          </Badge>
                        )}
                        {deck.bracketIntent && (
                          <Badge variant="outline">
                            {deck.calculatedBracket
                              ? `Meant as ${deck.bracketIntent}`
                              : `Bracket ${deck.bracketIntent}`}
                          </Badge>
                        )}
                        {(deck.tags ?? []).map((t) => (
                          <Badge key={t} variant="outline" className="capitalize">
                            {t}
                          </Badge>
                        ))}
                        <span className="ml-auto">Updated {formatUpdated(deck.updatedAt)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <PasteDeckDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        onCreate={(deck) => {
          const created = createDeck(deck);
          setPasteOpen(false);
          if (created) router.push(`/decks/${created.id}`);
        }}
      />

      <NewDeckDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreate={(deck) => {
          const created = createDeck(deck);
          setNewOpen(false);
          if (created) router.push(`/decks/${created.id}`);
        }}
      />

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear the whole library?</DialogTitle>
            <DialogDescription>
              Every deck in this browser is removed. Export JSON first if you want them back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                clearLibrary();
                setConfirmClear(false);
              }}
            >
              Clear library
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
