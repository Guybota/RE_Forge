"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Download, Dices, Gauge, Trash2, Undo2, Wallet } from "lucide-react";
import { BracketResultPanel } from "@/components/bracket-result-panel";
import { ComboAddDialog, ComboCardZoom } from "@/components/combo-add-dialog";
import { CardHoverPreview } from "@/components/card-hover-preview";
import { CardImage } from "@/components/card-image";
import { ColorPips } from "@/components/color-pips";
import { DeckCardMenu, type DeckCardMenuActions } from "@/components/deck-card-menu";
import { GameChangerBadge } from "@/components/game-changer-badge";
import { DeckStatsPanel } from "@/components/deck-stats-panel";
import { useCardImages } from "@/hooks/use-card-images";
import { useDeckLibrary } from "@/hooks/use-deck-library";
import { BRACKET_LABELS, estimateBracket, type BracketEstimate } from "@/lib/bracket";
import { checkCommanderDeck, type CommanderIssueKind } from "@/lib/commander-check";
import { isGameChanger } from "@/lib/game-changers";
import { groupDeckCards } from "@/lib/card-groups";
import { deckCardCount } from "@/lib/compare";
import { exportDecklistText, parseImportPaste } from "@/lib/import-formats";
import { canonicalizeName, toDecklistText } from "@/lib/parse-decklist";
import { resolveCommanderColors } from "@/lib/color-identity";
import { formatEur, summarizeDeckEur } from "@/lib/prices";
import { drawSampleHand } from "@/lib/sample-hand";
import {
  EDHREC_COMBO_PAGE,
  findEdhrecComboExplanation,
  findEdhrecCombos,
  type EdhrecCombo,
  type EdhrecComboExplanation,
  type EdhrecCommanderCombos,
} from "@/lib/edhrec-combos";
import {
  getCachedVisual,
  getCachedVisualById,
  applyPrintingVisual,
  findCheaperPrintings,
  resolvePrintingById,
  type CheaperPrinting,
} from "@/lib/scryfall";
import type { Deck, DeckCard } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

function ComboExplanation({
  href,
  pieces,
}: {
  href: string;
  pieces: { label: string }[];
}) {
  const [detail, setDetail] = useState<EdhrecComboExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void findEdhrecComboExplanation(href).then((result) => {
      if (cancel) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDetail(result);
    });
    return () => {
      cancel = true;
    };
  }, [href]);

  if (error) return <p className="mt-3 text-sm text-rose">{error}</p>;
  if (!detail) return <p className="mt-3 text-sm text-muted-foreground">Loading the explanation…</p>;

  return (
    <div className="mt-3 space-y-3 border-t border-border/50 pt-3 text-sm">
      {pieces.length > 0 ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Also needs
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/90">
            {pieces.map((piece) => (
              <li key={piece.label}>{piece.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {detail.prerequisites.length > 0 ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Prerequisites
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/90">
            {detail.prerequisites.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {detail.steps.length > 0 ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Steps</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-foreground/90">
            {detail.steps.map((step, index) => (
              <li key={`${index}-${step}`}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

export function DeckDetailPage({ deckId }: { deckId: string }) {
  const router = useRouter();
  const { state, decks, saveDeck, createDeck, deleteDeck, markOpened } = useDeckLibrary();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deck = decks.find((item) => item.id === deckId) ?? null;

  useEffect(() => {
    if (!deck) return;
    markOpened(deck.id);
    document.title = `${deck.name} · MTG Central`;
  }, [deck, markOpened]);

  if (state.status === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted-foreground">Restoring deck…</p>
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
        <Link href="/decks" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to My Decks
        </Link>
      </div>
    );
  }

  if (!deck) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl font-bold">Deck not found</h1>
        <p className="text-sm text-muted-foreground">
          This list is not in the library saved in this browser.
        </p>
        <Link href="/decks" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to My Decks
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link
        href="/decks"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        My Decks
      </Link>
      <DeckDetailForm
        key={deck.id}
        deck={deck}
        onSave={saveDeck}
        onDelete={() => setConfirmDelete(true)}
        onDuplicate={() => {
          const created = createDeck({
            name: `${deck.name} copy`,
            commanders: deck.commanders,
            cards: deck.cards,
            sideboard: deck.sideboard,
            colorIdentity: deck.colorIdentity,
            bracketIntent: deck.bracketIntent,
            calculatedBracket: deck.calculatedBracket,
            notes: deck.notes,
            tags: deck.tags,
            source: "manual",
          });
          if (created) router.push(`/decks/${created.id}`);
        }}
      />
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this deck?</DialogTitle>
            <DialogDescription>
              This removes it from local storage. Export first if you need a backup.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteDeck(deck.id);
                setConfirmDelete(false);
                router.push("/decks");
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeckDetailForm({
  deck,
  onSave,
  onDelete,
  onDuplicate,
}: {
  deck: Deck;
  onSave: (deck: Deck) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [name, setName] = useState(deck.name);
  const [commander, setCommander] = useState(
    deck.commanders.map((c) => c.name).join(" / "),
  );
  const [listText, setListText] = useState(
    toDecklistText(deck.commanders, deck.cards, deck.sideboard ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
  const [tab, setTab] = useState<"gallery" | "edit">("gallery");
  const [filterName, setFilterName] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterMv, setFilterMv] = useState<string>("any");
  const [filterPrice, setFilterPrice] = useState<string>("any");
  const [bracketResult, setBracketResult] = useState<BracketEstimate | null>(null);
  const [sampleHand, setSampleHand] = useState<string[] | null>(null);
  const [cheapestBusy, setCheapestBusy] = useState(false);
  const [cheapestProgress, setCheapestProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [printSwaps, setPrintSwaps] = useState<CheaperPrinting[] | null>(null);
  const [pickedSwaps, setPickedSwaps] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [notes, setNotes] = useState(deck.notes ?? "");
  const undoStack = useRef<Deck[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    setNotes(deck.notes ?? "");
  }, [deck.notes]);

  const commit = (next: Deck) => {
    const stamped =
      next.calculatedBracket == null
        ? next
        : { ...next, calculatedBracket: estimateBracket(next).bracket };
    undoStack.current = [...undoStack.current, deck].slice(-20);
    setCanUndo(undoStack.current.length > 0);
    onSave(stamped);
  };
  const undo = () => {
    const prev = undoStack.current[undoStack.current.length - 1];
    if (!prev) return;
    undoStack.current = undoStack.current.slice(0, -1);
    setCanUndo(undoStack.current.length > 0);
    onSave(prev);
  };
  const [combos, setCombos] = useState<EdhrecCommanderCombos[] | null>(null);
  const [comboVisible, setComboVisible] = useState<Record<string, number>>({});
  const [openExplanation, setOpenExplanation] = useState<string | null>(null);
  const [comboZoom, setComboZoom] = useState<string | null>(null);
  const [comboAdd, setComboAdd] = useState<EdhrecCombo | null>(null);
  const [comboError, setComboError] = useState<string | null>(null);
  const [comboLoading, setComboLoading] = useState(false);
  const [cheapestTick, setCheapestTick] = useState(0);

  const previewNames = useMemo(
    () => [
      ...deck.commanders.map((c) => c.name),
      ...deck.cards.map((c) => c.name),
      ...(deck.sideboard ?? []).map((c) => c.name),
      ...(sampleHand ?? []),
      ...(combos ?? []).flatMap((group) =>
        group.combos
          .slice(0, comboVisible[group.name] ?? EDHREC_COMBO_PAGE)
          .flatMap((combo) => combo.cardNames),
      ),
    ],
    [deck, sampleHand, combos, comboVisible],
  );

  const { get: getBase, loading: artLoading } = useCardImages(previewNames);
  // Merge live Scryfall cache so cheapest-printing passes paint without remount.
  const get = useMemo(() => {
    void cheapestTick;
    return (name: string) => {
      const line = [...deck.commanders, ...deck.cards].find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      );
      const byId = line?.scryfallId ? getCachedVisualById(line.scryfallId) : undefined;
      const base = getBase(name);
      const cached = getCachedVisual(name);
      const merged = {
        ...(base ?? {}),
        ...(cached ?? {}),
        ...(byId ?? {}),
        name: byId?.name ?? cached?.name ?? base?.name ?? name,
        cheapestEur:
          cached?.cheapestEur !== undefined
            ? cached.cheapestEur
            : base?.cheapestEur,
        cheapestSet:
          cached?.cheapestSet !== undefined
            ? cached.cheapestSet
            : base?.cheapestSet,
      };
      if (!base && !cached && !byId) return undefined;
      return merged;
    };
  }, [getBase, cheapestTick, deck.commanders, deck.cards]);

  // Restore preferred printings from saved scryfallId.
  useEffect(() => {
    let cancelled = false;
    const ids = [...deck.commanders, ...deck.cards].filter((c) => c.scryfallId);
    if (!ids.length) return;
    (async () => {
      for (const c of ids) {
        if (cancelled || !c.scryfallId) continue;
        await resolvePrintingById(c.scryfallId, c.name);
      }
      if (!cancelled) setCheapestTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [deck.id, deck.updatedAt, deck.commanders, deck.cards]);

  const cmdName = deck.commanders[0]?.name ?? "Commander";
  const passiveBracket = useMemo(() => estimateBracket(deck), [deck]);
  const prices = useMemo(
    () => summarizeDeckEur(deck, get, artLoading),
    [deck, get, artLoading],
  );
  const check = useMemo(() => checkCommanderDeck(deck, get), [deck, get]);
  const cardFlags = useMemo(() => {
    const labels: Partial<Record<CommanderIssueKind, string>> = {
      "color-identity": "Outside color identity",
      banned: "Banned",
      "not-legal": "Not legal",
      singleton: "Too many copies",
      "command-zone": "Illegal commander",
    };
    const map = new Map<string, string>();
    for (const issue of check.issues) {
      const label = labels[issue.kind];
      if (!label) continue;
      for (const raw of issue.names) {
        const name = raw.replace(/\s*\(×\d+\)$/, "");
        map.set(canonicalizeName(name), label);
      }
    }
    return map;
  }, [check]);
  const saveNotes = () => {
    const next = notes.trim();
    if (next === (deck.notes ?? "").trim()) return;
    commit({ ...deck, notes: next });
  };
  const setIntent = (value: string) => {
    const bracketIntent = value ? (Number(value) as 1 | 2 | 3 | 4 | 5) : undefined;
    if (bracketIntent === deck.bracketIntent) return;
    commit({ ...deck, bracketIntent });
  };

  const cardMenuActions: DeckCardMenuActions = {
    onChangePrinting: (card, printing) => {
      const patch = (c: DeckCard) =>
        c.name === card.name
          ? { ...c, scryfallId: printing.scryfallId, setCode: printing.setCode }
          : c;
      commit({
        ...deck,
        commanders: deck.commanders.map(patch),
        cards: deck.cards.map(patch),
        sideboard: (deck.sideboard ?? []).map(patch),
      });
      setCheapestTick((t) => t + 1);
    },
    onRemove: (card) => {
      if (card.zone === "command" || deck.commanders.some((c) => c.name === card.name)) {
        // Remove commander entirely (not demote).
        commit({
          ...deck,
          commanders: deck.commanders.filter((c) => c.name !== card.name),
        });
        return;
      }
      if (card.zone === "sideboard") {
        commit({
          ...deck,
          sideboard: (deck.sideboard ?? []).filter((c) => c.name !== card.name),
        });
        return;
      }
      commit({
        ...deck,
        cards: deck.cards.filter((c) => c.name !== card.name),
      });
    },
    onRemoveAsCommander: (card) => {
      const rest = deck.commanders.filter((c) => c.name !== card.name);
      const alreadyMain = deck.cards.some(
        (c) => c.name.toLowerCase() === card.name.toLowerCase(),
      );
      commit({
        ...deck,
        commanders: rest,
        cards: alreadyMain
          ? deck.cards
          : [
              ...deck.cards,
              {
                name: card.name,
                quantity: 1,
                zone: "main" as const,
                scryfallId: card.scryfallId,
                setCode: card.setCode,
              },
            ],
      });
    },
    onAddOne: (card) => {
      commit({
        ...deck,
        cards: deck.cards.map((c) =>
          c.name === card.name ? { ...c, quantity: c.quantity + 1 } : c,
        ),
      });
    },
    onAddMore: (card, qty) => {
      commit({
        ...deck,
        cards: deck.cards.map((c) =>
          c.name === card.name ? { ...c, quantity: c.quantity + qty } : c,
        ),
      });
    },
    onMoveToSideboard: (card) => {
      const remaining = deck.cards.filter((c) => c.name !== card.name);
      const side = [...(deck.sideboard ?? [])];
      const hit = side.find((c) => c.name.toLowerCase() === card.name.toLowerCase());
      if (hit) {
        hit.quantity += card.quantity;
      } else {
        side.push({ ...card, zone: "sideboard", quantity: card.quantity });
      }
      commit({ ...deck, cards: remaining, sideboard: side });
    },
    onReplaceCommander: (card) => {
      const prev = deck.commanders[0];
      let nextMain = deck.cards.filter((c) => c.name !== card.name);
      if (prev) {
        const already = nextMain.some(
          (c) => c.name.toLowerCase() === prev.name.toLowerCase(),
        );
        if (!already) {
          nextMain = [
            ...nextMain,
            {
              name: prev.name,
              quantity: 1,
              zone: "main",
              scryfallId: prev.scryfallId,
              setCode: prev.setCode,
            },
          ];
        }
      }
      const partners = deck.commanders.slice(1);
      commit({
        ...deck,
        commanders: [
          {
            name: card.name,
            quantity: 1,
            zone: "command",
            scryfallId: card.scryfallId,
            setCode: card.setCode,
          },
          ...partners,
        ],
        cards: nextMain,
      });
    },
    onSetPartnerCommander: (card) => {
      if (deck.commanders.some((c) => c.name === card.name)) return;
      const nextMain = deck.cards.filter((c) => c.name !== card.name);
      const primary = deck.commanders[0];
      const commanders: DeckCard[] = primary
        ? [
            primary,
            {
              name: card.name,
              quantity: 1,
              zone: "command",
              scryfallId: card.scryfallId,
              setCode: card.setCode,
            },
          ]
        : [
            {
              name: card.name,
              quantity: 1,
              zone: "command",
              scryfallId: card.scryfallId,
              setCode: card.setCode,
            },
          ];
      commit({ ...deck, commanders, cards: nextMain });
    },
  };

  const triggerNames = useMemo(
    () => (bracketResult ? bracketResult.triggers.map((t) => t.name) : []),
    [bracketResult],
  );
  useCardImages(triggerNames);

  const filteredCards = useMemo(() => {
    void cheapestTick;
    return deck.cards.filter((card) => {
      const v = get(card.name);
      if (filterName && !card.name.toLowerCase().includes(filterName.toLowerCase())) {
        return false;
      }
      if (filterType && !(v?.typeLine ?? "").toLowerCase().includes(filterType.toLowerCase())) {
        return false;
      }
      if (filterMv !== "any") {
        const cmc = v?.cmc;
        if (cmc == null) return false;
        if (filterMv === "7+") {
          if (cmc < 7) return false;
        } else if (Math.floor(cmc) !== Number(filterMv)) {
          return false;
        }
      }
      if (filterPrice !== "any") {
        const eur = v?.eur;
        if (filterPrice === "missing") {
          if (eur != null) return false;
        } else if (eur == null) {
          return false;
        } else if (filterPrice === "under1" && !(eur < 1)) {
          return false;
        } else if (filterPrice === "1to5" && !(eur >= 1 && eur < 5)) {
          return false;
        } else if (filterPrice === "5plus" && !(eur >= 5)) {
          return false;
        }
      }
      return true;
    });
  }, [deck.cards, get, filterName, filterType, filterMv, filterPrice, cheapestTick]);

  const runCheapestPass = async () => {
    setCheapestBusy(true);
    setPrintSwaps(null);
    setPickedSwaps([]);
    setCheapestProgress({ done: 0, total: 0 });
    const lines = [...deck.commanders, ...deck.cards, ...(deck.sideboard ?? [])].map((card) => {
      const visual = get(card.name);
      return {
        name: card.name,
        scryfallId: card.scryfallId ?? visual?.scryfallId,
        setCode: card.setCode ?? visual?.setCode,
        eur: visual?.eur ?? null,
      };
    });
    const offers = await findCheaperPrintings(lines, (done, total) => {
      setCheapestProgress({ done, total });
    });
    setPrintSwaps(offers);
    setCheapestTick((t) => t + 1);
    setCheapestBusy(false);
  };
  const toggleSwap = (name: string) => {
    const key = canonicalizeName(name);
    setPickedSwaps((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  };
  const addComboCards = (names: string[]) => {
    const have = new Set(
      [...deck.commanders, ...deck.cards, ...(deck.sideboard ?? [])].map((card) =>
        canonicalizeName(card.name),
      ),
    );
    const additions = names
      .filter((name) => !have.has(canonicalizeName(name)))
      .map((name) => {
        const visual = get(name);
        return {
          name,
          quantity: 1,
          zone: "main" as const,
          scryfallId: visual?.scryfallId,
          setCode: visual?.setCode,
        };
      });
    if (additions.length === 0) {
      setComboAdd(null);
      return;
    }
    commit({ ...deck, cards: [...deck.cards, ...additions] });
    setComboAdd(null);
  };
  const replaceForCombo = (add: string[], cut: string[]) => {
    const cutKeys = new Set(cut.map((name) => canonicalizeName(name)));
    let removed = 0;
    const cards = deck.cards.flatMap((card) => {
      if (removed >= cut.length || !cutKeys.has(canonicalizeName(card.name))) return [card];
      removed += 1;
      if (card.quantity > 1) return [{ ...card, quantity: card.quantity - 1 }];
      return [];
    });
    addComboCardsInto(cards, add);
  };
  const addComboCardsInto = (cards: DeckCard[], names: string[]) => {
    const have = new Set(
      [...deck.commanders, ...cards, ...(deck.sideboard ?? [])].map((card) =>
        canonicalizeName(card.name),
      ),
    );
    const additions = names
      .filter((name) => !have.has(canonicalizeName(name)))
      .map((name) => {
        const visual = get(name);
        return {
          name,
          quantity: 1,
          zone: "main" as const,
          scryfallId: visual?.scryfallId,
          setCode: visual?.setCode,
        };
      });
    commit({ ...deck, cards: [...cards, ...additions] });
    setComboAdd(null);
  };
  const applyPickedSwaps = () => {
    if (!printSwaps) return;
    const chosen = printSwaps.filter((offer) =>
      pickedSwaps.includes(canonicalizeName(offer.name)),
    );
    if (chosen.length === 0) return;
    const byName = new Map(chosen.map((offer) => [canonicalizeName(offer.name), offer]));
    const patch = (card: DeckCard) => {
      const offer = byName.get(canonicalizeName(card.name));
      if (!offer) return card;
      return { ...card, scryfallId: offer.nextId, setCode: offer.nextSet };
    };
    for (const offer of chosen) applyPrintingVisual(offer.name, offer.nextVisual);
    commit({
      ...deck,
      commanders: deck.commanders.map(patch),
      cards: deck.cards.map(patch),
      sideboard: (deck.sideboard ?? []).map(patch),
    });
    setPrintSwaps(null);
    setPickedSwaps([]);
    setCheapestTick((t) => t + 1);
  };

  const runCombos = async () => {
    setComboLoading(true);
    setComboError(null);
    setCombos(null);
    setComboVisible({});
    setOpenExplanation(null);
    const result = await findEdhrecCombos(deck.commanders.map((card) => card.name));
    if (!result.ok) {
      setComboError(result.error);
      setCombos(null);
    } else {
      setCombos(result.commanders);
    }
    setComboLoading(false);
  };

  const addTag = () => {
    const t = tagDraft.trim().toLowerCase();
    if (!t) return;
    const tags = Array.from(new Set([...(deck.tags ?? []), t]));
    commit({ ...deck, tags });
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    commit({ ...deck, tags: (deck.tags ?? []).filter((x) => x !== tag) });
  };

  const groups = useMemo(
    () => groupDeckCards(filteredCards, get, deck.commanders),
    [filteredCards, get, deck.commanders],
  );
  const listNames = useMemo(
    () =>
      new Set(
        [...deck.commanders, ...deck.cards, ...(deck.sideboard ?? [])].map((card) =>
          canonicalizeName(card.name),
        ),
      ),
    [deck],
  );

  const exportText = () => {
    const body = exportDecklistText(deck.commanders, deck.cards, "plain", deck.sideboard ?? []);
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deck.name.replace(/\s+/g, "-").toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="relative mb-6 overflow-hidden rounded-2xl ring-1 ring-white/10">
        <div className="relative h-52 sm:h-64">
          {(get(cmdName)?.artCrop || get(cmdName)?.normal) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={get(cmdName)?.artCrop ?? get(cmdName)?.normal}
              alt=""
              className="h-full w-full object-cover object-top"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/75 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex items-end gap-4 sm:left-6 sm:right-6">
            <CardImage
              name={cmdName}
              visual={get(cmdName)}
              size="hero"
              prefer="large"
              rounded="xl"
              eager
              className="hidden w-[120px] shadow-xl sm:block"
            />
            <div className="min-w-0 flex-1 pb-1">
              <div className="text-left">
                <h1 className="font-display text-2xl font-bold sm:text-3xl">{deck.name}</h1>
                <p className="text-sm text-foreground/80">
                  {cmdName} · {deckCardCount(deck)} cards · updated{" "}
                  {formatUpdated(deck.updatedAt)}
                  {artLoading ? " · loading art & prices…" : ""}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ColorPips colors={deck.colorIdentity} />
                {prices.loading ? (
                  <Badge variant="outline">EUR…</Badge>
                ) : prices.totalEur != null ? (
                  <Badge variant="outline" className="border-primary/40 text-primary">
                    €{prices.totalEur.toFixed(2)} Cardmarket
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    EUR unavailable
                  </Badge>
                )}
                {(deck.tags ?? []).map((t) => (
                  <Badge key={t} variant="secondary" className="capitalize">
                    {t}
                  </Badge>
                ))}
                {deck.calculatedBracket ? (
                  <Badge
                    variant="outline"
                    className="border-primary/40 text-primary"
                    title={passiveBracket.rule}
                  >
                    Bracket {deck.calculatedBracket} · {BRACKET_LABELS[deck.calculatedBracket]}
                  </Badge>
                ) : (
                  !bracketResult && (
                    <Badge
                      variant="outline"
                      className="text-muted-foreground"
                      title={passiveBracket.disclaimer}
                    >
                      Peek {passiveBracket.bracket} · {passiveBracket.label}
                    </Badge>
                  )
                )}
                <Button
                  size="sm"
                  className="gap-1.5 shadow-md shadow-primary/20"
                  onClick={() => {
                    const result = estimateBracket(deck);
                    setBracketResult(result);
                    if (deck.calculatedBracket !== result.bracket) {
                      commit({ ...deck, calculatedBracket: result.bracket });
                    }
                  }}
                >
                  <Gauge className="size-4" />
                  Calculate bracket
                </Button>
                {deck.bracketIntent && deck.bracketIntent !== passiveBracket.bracket && (
                  <p className="w-full text-xs text-muted-foreground">
                    You marked this Bracket {deck.bracketIntent}, {BRACKET_LABELS[deck.bracketIntent]}. The list reads as Bracket {passiveBracket.bracket}, {passiveBracket.label}.
                  </p>
                )}
                {deck.bracketIntent && deck.bracketIntent === passiveBracket.bracket && (
                  <p className="w-full text-xs text-muted-foreground">
                    Marked Bracket {deck.bracketIntent}, {BRACKET_LABELS[deck.bracketIntent]}, and the list reads the same.
                  </p>
                )}
              </div>
              {!prices.loading && prices.unpricedCards > 0 && prices.totalEur != null && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Total excludes {prices.unpricedCards} cards without Scryfall Cardmarket EUR
                  (often basic lands).
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="space-y-1.5">
          <Label htmlFor="deck-notes">Notes</Label>
          <Textarea
            id="deck-notes"
            value={notes}
            rows={2}
            placeholder="Why this deck exists, or the table it is for."
            onChange={(event) => setNotes(event.target.value)}
            onBlur={saveNotes}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deck-intent">Meant as</Label>
          <select
            id="deck-intent"
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            value={deck.bracketIntent ?? ""}
            onChange={(event) => setIntent(event.target.value)}
          >
            <option value="">No intent yet</option>
            {([1, 2, 3, 4, 5] as const).map((bracket) => (
              <option key={bracket} value={bracket}>
                Bracket {bracket} · {BRACKET_LABELS[bracket]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(check.issues.length > 0 || check.notes.length > 0) && (
        <div className="mb-4 space-y-1 text-sm">
          {check.issues.map((issue) => (
            <p key={issue.kind} className="text-rose">
              {issue.message}
              {issue.names.filter((name) => !issue.message.includes(name)).length > 0
                ? ` ${issue.names.filter((name) => !issue.message.includes(name)).slice(0, 8).join(", ")}.`
                : ""}
            </p>
          ))}
          {check.notes.map((note) => (
            <p key={note} className="text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      )}

      {bracketResult && (
        <BracketResultPanel
          result={bracketResult}
          get={get}
          onClose={() => setBracketResult(null)}
        />
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={tab === "gallery" ? "default" : "outline"}
          onClick={() => setTab("gallery")}
        >
          Card gallery
        </Button>
        <Button
          size="sm"
          variant={tab === "edit" ? "default" : "outline"}
          onClick={() => setTab("edit")}
        >
          Edit list
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSampleHand(drawSampleHand(deck))}
        >
          <Dices className="size-4" />
          Sample hand
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={cheapestBusy}
          onClick={() => void runCheapestPass()}
        >
          <Wallet className="size-4" />
          {cheapestBusy
            ? `Checking printings${
                cheapestProgress && cheapestProgress.total > 0
                  ? ` ${cheapestProgress.done}/${cheapestProgress.total}`
                  : "…"
              }`
            : "Cheapest printings"}
        </Button>
        <Button size="sm" variant="outline" disabled={comboLoading} onClick={() => void runCombos()}>
          {comboLoading ? "Finding combos…" : "Find combos"}
        </Button>
        <Link
          href={`/play?deck=${deck.id}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")}
        >
          Play
        </Link>
        <Link
          href={`/compare?a=${deck.id}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Compare
        </Link>
        <Link
          href={`/improve?deck=${deck.id}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Improve
        </Link>
        <Button size="sm" variant="outline" onClick={exportText}>
          <Download className="size-4" />
          Export list
        </Button>
        <Button size="sm" variant="outline" onClick={onDuplicate}>
          <Copy className="size-4" />
          Duplicate
        </Button>
        {canUndo && (
          <Button size="sm" variant="outline" onClick={undo}>
            <Undo2 className="size-4" />
            Undo
          </Button>
        )}
      </div>

      {sampleHand && (
        <section className="panel mb-4 space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-semibold">Sample hand</h3>
            <p className="text-xs text-muted-foreground">
              7 from the 99 · commander stays in the command zone · list not saved
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={() => setSampleHand(drawSampleHand(deck))}
            >
              Redraw
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSampleHand(null)}>
              Close
            </Button>
          </div>
          {sampleHand.length === 0 ? (
            <p className="text-sm text-muted-foreground">Mainboard is empty.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7">
              {sampleHand.map((cardName, i) => (
                <li key={`${cardName}-${i}`}>
                  <CardImage
                    name={cardName}
                    visual={get(cardName)}
                    size="tile"
                    prefer="normal"
                    rounded="lg"
                    className="w-full"
                  />
                  <p className="mt-1 line-clamp-2 text-[10px]">{cardName}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {printSwaps && !cheapestBusy && (
        <section className="panel mb-4 space-y-3 p-4">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-lg font-semibold">Cheaper printings</h3>
              <p className="text-xs text-muted-foreground">
                {printSwaps.length === 0
                  ? "No cheaper non-foil printing turned up. This list stays as it is."
                  : "Pick the printings to switch. Nothing changes until you apply, and you can leave them all."}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPrintSwaps(null);
                setPickedSwaps([]);
              }}
            >
              Close
            </Button>
          </div>
          {printSwaps.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPickedSwaps(printSwaps.map((offer) => canonicalizeName(offer.name)))
                  }
                >
                  Select all
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPickedSwaps([])}>
                  Select none
                </Button>
                <Button
                  size="sm"
                  disabled={pickedSwaps.length === 0}
                  onClick={applyPickedSwaps}
                >
                  Apply selected ({pickedSwaps.length})
                </Button>
              </div>
              <ul className="max-h-[70vh] space-y-3 overflow-y-auto">
                {printSwaps.map((offer) => {
                  const key = canonicalizeName(offer.name);
                  const picked = pickedSwaps.includes(key);
                  const saved = offer.currentEur - offer.nextEur;
                  return (
                    <li key={key} className="rounded-xl border border-border/50 p-3">
                      <label className="flex cursor-pointer flex-wrap items-center gap-4">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={picked}
                          onChange={() => toggleSwap(offer.name)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{offer.name}</p>
                          <p className="text-[11px] text-primary">
                            Saves {formatEur(saved)}
                          </p>
                        </div>
                        <div className="w-24 text-center">
                          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Change this
                          </p>
                          <CardImage
                            name={offer.name}
                            visual={get(offer.name)}
                            size="tile"
                            prefer="normal"
                            rounded="md"
                            className="w-full"
                          />
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {offer.currentSet ? `${offer.currentSet} · ` : ""}
                            {formatEur(offer.currentEur)}
                          </p>
                        </div>
                        <div className="w-24 text-center">
                          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            With this
                          </p>
                          <CardImage
                            name={offer.name}
                            visual={offer.nextVisual}
                            size="tile"
                            prefer="normal"
                            rounded="md"
                            className="w-full"
                          />
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {offer.nextSet} · {formatEur(offer.nextEur)}
                          </p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {(combos || comboError) && (
        <section className="panel mb-4 space-y-4 p-4">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-lg font-semibold">Combos</h3>
              <p className="text-xs text-muted-foreground">
                From the EDHREC combo tab for{" "}
                {deck.commanders.map((card) => card.name).join(" / ") || "this commander"}.
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCombos(null);
                setComboError(null);
                setComboVisible({});
                setOpenExplanation(null);
              }}
            >
              Close
            </Button>
          </div>
          {comboError && <p className="text-sm text-rose">{comboError}</p>}
          {combos && combos.every((group) => group.combos.length === 0) && !comboError && (
            <p className="text-sm text-muted-foreground">
              EDHREC lists no combos for this commander.
            </p>
          )}
          {combos?.map((group) =>
            group.combos.length === 0 ? null : (
              <div key={group.name} className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {group.total.toLocaleString()} combos played with {group.name}. Showing{" "}
                  {Math.min(comboVisible[group.name] ?? EDHREC_COMBO_PAGE, group.combos.length)} of{" "}
                  {group.combos.length} from this tab.{" "}
                  <a
                    className="text-primary underline-offset-2 hover:underline"
                    href={group.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open on EDHREC
                  </a>
                </p>
                <ul className="space-y-3">
                  {group.combos.slice(0, comboVisible[group.name] ?? EDHREC_COMBO_PAGE).map((combo) => {
                    const missing = combo.cardNames.filter(
                      (name) => !listNames.has(canonicalizeName(name)),
                    );
                    const inDeck = missing.length === 0;
                    const explainKey = `${group.name}-${combo.id}`;
                    const explaining = openExplanation === explainKey;
                    return (
                    <li
                      key={explainKey}
                      className={cn(
                        "rounded-xl border p-3",
                        inDeck ? "border-primary/40" : "border-border/50",
                      )}
                    >
                      <div className="mb-2 flex flex-wrap items-start gap-2">
                        <p className="min-w-0 flex-1 text-sm font-medium">
                          {combo.results.length > 0
                            ? combo.results.join(" · ")
                            : combo.cardNames.join(" + ")}
                        </p>
                        {inDeck ? (
                          <Badge variant="outline" className="border-primary/40 text-primary">
                            Already in deck
                          </Badge>
                        ) : null}
                        <Button
                          size="sm"
                          variant={explaining ? "default" : "outline"}
                          aria-expanded={explaining}
                          onClick={() =>
                            setOpenExplanation((current) => (current === explainKey ? null : explainKey))
                          }
                        >
                          Explanation
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={inDeck}
                          onClick={() => setComboAdd(combo)}
                        >
                          {inDeck ? "Already in deck" : "Add combo"}
                        </Button>
                      </div>
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        {combo.cardNames.join(" + ")}
                        {combo.decks > 0 ? ` · ${combo.decks.toLocaleString()} decks` : ""}
                      </p>
                      <ul className="flex flex-wrap gap-2">
                        {combo.cardNames.map((name) => {
                          const inList = listNames.has(canonicalizeName(name));
                          return (
                            <li key={name} className="w-20 text-center">
                              <button
                                type="button"
                                className="w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                                aria-label={`View ${name}`}
                                onClick={() => setComboZoom(name)}
                              >
                                <CardImage
                                  name={name}
                                  visual={get(name)}
                                  size="tile"
                                  prefer="normal"
                                  rounded="md"
                                  className="w-full"
                                />
                              </button>
                              <p className="mt-1 line-clamp-2 text-[10px]">{name}</p>
                              {inList ? (
                                <p className="text-[10px] font-medium leading-tight text-primary">
                                  Already in deck
                                </p>
                              ) : null}
                            </li>
                          );
                        })}
                        {combo.pieces.map((piece) => (
                          <li key={piece.label} className="w-20 text-center">
                            <div className="flex aspect-[5/7] w-full items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/15 px-1.5 text-center">
                              <p className="text-[10px] font-semibold leading-tight text-primary">
                                {piece.label}
                              </p>
                            </div>
                            <p className="mt-1 text-[10px] font-medium leading-tight text-primary">
                              Needed
                            </p>
                          </li>
                        ))}
                      </ul>
                      {explaining ? (
                        <ComboExplanation href={combo.href} pieces={combo.pieces} />
                      ) : null}
                    </li>
                    );
                  })}
                </ul>
                {(comboVisible[group.name] ?? EDHREC_COMBO_PAGE) < group.combos.length ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setComboVisible((current) => ({
                        ...current,
                        [group.name]: (current[group.name] ?? EDHREC_COMBO_PAGE) + EDHREC_COMBO_PAGE,
                      }))
                    }
                  >
                    See more
                  </Button>
                ) : group.total > group.combos.length ? (
                  <p className="text-xs text-muted-foreground">
                    These are the {group.combos.length} combos included in this tab. EDHREC lists{" "}
                    {group.total.toLocaleString()} on the full page.
                  </p>
                ) : null}
              </div>
            ),
          )}
        </section>
      )}

      {comboAdd ? (
        <ComboAddDialog
          combo={comboAdd}
          deck={deck}
          get={get}
          inList={(name) => listNames.has(canonicalizeName(name))}
          onClose={() => setComboAdd(null)}
          onJustAdd={addComboCards}
          onReplace={replaceForCombo}
        />
      ) : null}
      {comboZoom ? (
        <ComboCardZoom
          name={comboZoom}
          visual={get(comboZoom)}
          onClose={() => setComboZoom(null)}
        />
      ) : null}

      {tab === "gallery" ? (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <DeckStatsPanel
            deck={deck}
            get={get}
            curveFilter={filterMv === "any" ? null : filterMv}
            onCurveFilterChange={(next) => setFilterMv(next ?? "any")}
          />
          <div className="space-y-6">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  placeholder="Search name…"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Input
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  placeholder="creature, land…"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mana value</Label>
                <select
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={filterMv}
                  onChange={(e) => setFilterMv(e.target.value)}
                >
                  <option value="any">Any</option>
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                  <option value="7+">7+</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Price (EUR)</Label>
                <select
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={filterPrice}
                  onChange={(e) => setFilterPrice(e.target.value)}
                >
                  <option value="any">Any</option>
                  <option value="under1">Under €1</option>
                  <option value="1to5">€1–€5</option>
                  <option value="5plus">€5+</option>
                  <option value="missing">Price unavailable</option>
                </select>
              </div>
            </div>
            <div className="space-y-8">
              {groups.map((group) => (
                <section key={group.key}>
                  <div className="mb-3 flex items-baseline gap-2 border-b border-border/50 pb-2">
                    <h3 className="font-display text-lg font-semibold">{group.label}</h3>
                    <span className="text-xs text-muted-foreground">
                      {group.cards.reduce((s, c) => s + c.quantity, 0)} cards
                    </span>
                  </div>
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {group.cards.map((card) => (
                      <GalleryCard
                        key={`${group.key}-${card.name}`}
                        card={card}
                        groupKey={group.key}
                        visual={get(card.name)}
                        actions={cardMenuActions}
                        flag={cardFlags.get(canonicalizeName(card.name))}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {groups.length === 0 && (
                <p className="text-sm text-muted-foreground">No cards match these filters.</p>
              )}
              {artLoading && (
                <p className="text-xs text-muted-foreground">Fetching Scryfall card faces…</p>
              )}

              {(deck.sideboard?.length ?? 0) > 0 && (
                <section>
                  <div className="mb-3 flex items-baseline gap-2 border-b border-border/50 pb-2">
                    <h3 className="font-display text-lg font-semibold">Sideboard</h3>
                    <span className="text-xs text-muted-foreground">
                      {(deck.sideboard ?? []).reduce((s, c) => s + c.quantity, 0)} cards
                    </span>
                  </div>
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {(deck.sideboard ?? []).map((card) => (
                      <GalleryCard
                        key={`sb-${card.name}`}
                        card={{ ...card, zone: "sideboard" }}
                        groupKey="sideboard"
                        visual={get(card.name)}
                        actions={cardMenuActions}
                        flag={cardFlags.get(canonicalizeName(card.name))}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-cmd">Commander</Label>
            <Input
              id="edit-cmd"
              value={commander}
              onChange={(e) => setCommander(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-2">
              {(deck.tags ?? []).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => removeTag(t)}
                  className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-0.5 text-xs capitalize hover:border-rose/50 hover:text-rose"
                  title="Remove tag"
                >
                  {t} ×
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                placeholder="Add tag…"
                className="h-9"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button type="button" size="sm" variant="outline" onClick={addTag}>
                Add tag
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-list">List</Label>
            <Textarea
              id="edit-list"
              value={listText}
              onChange={(e) => setListText(e.target.value)}
              rows={14}
              className="font-mono text-xs"
            />
          </div>
          {parseErrors.length > 0 && (
            <ul className="space-y-1 text-sm text-destructive">
              {parseErrors.map((e) => (
                <li key={e.line}>
                  Line {e.line}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-4">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 className="size-4" />
          Delete
        </Button>
        {tab === "edit" && (
          <Button
            disabled={saving}
            onClick={() => {
              void (async () => {
                const parsed = parseImportPaste(listText, "auto");
                if (parsed.errors.length) {
                  setParseErrors(
                    parsed.errors.map((e) => ({ line: e.line, message: e.message })),
                  );
                  return;
                }
                setSaving(true);
                const fieldNames = commander
                  .split("/")
                  .map((s) => s.trim())
                  .filter(Boolean);
                const commanderNames = fieldNames.length
                  ? fieldNames
                  : parsed.commanders.map((c) => c.name);
                const commanders = commanderNames.map((n) => ({
                  name: n,
                  quantity: 1,
                  zone: "command" as const,
                }));
                const skip = new Set(commanderNames.map((n) => n.toLowerCase()));
                const extras = parsed.commanders.filter((c) => !skip.has(c.name.toLowerCase()));
                const cards = [...parsed.cards, ...extras]
                  .filter((c) => !skip.has(c.name.toLowerCase()))
                  .map((c) => ({
                    name: c.name,
                    quantity: c.quantity,
                    zone: "main" as const,
                  }));
                const sideboard = parsed.sideboard
                  .filter((c) => !skip.has(c.name.toLowerCase()))
                  .map((c) => ({
                    name: c.name,
                    quantity: c.quantity,
                    zone: "sideboard" as const,
                  }));
                const colorIdentity = await resolveCommanderColors(commanderNames);
                commit({
                  ...deck,
                  name: name.trim() || deck.name,
                  commanders,
                  cards,
                  sideboard,
                  colorIdentity: colorIdentity ?? deck.colorIdentity,
                });
                setSaving(false);
                setTab("gallery");
              })();
            }}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        )}
      </div>
    </>
  );
}

function GalleryCard({
  card,
  groupKey,
  visual,
  actions,
  flag,
}: {
  card: DeckCard;
  groupKey: string;
  visual: ReturnType<ReturnType<typeof useCardImages>["get"]>;
  actions: DeckCardMenuActions;
  flag?: string;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const isCommander = groupKey === "commander";

  return (
    <li className="group">
      <div
        ref={surfaceRef}
        className={cn(
          "relative overflow-hidden rounded-xl ring-1 ring-white/10 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-black/50",
          flag
            ? "ring-2 ring-rose group-hover:ring-rose"
            : "group-hover:ring-primary/40",
        )}
      >
        <CardHoverPreview name={card.name} visual={visual}>
          <CardImage
            name={card.name}
            visual={visual}
            size="tile"
            prefer="normal"
            rounded="xl"
            className="w-full"
          />
        </CardHoverPreview>
        {card.quantity > 1 ? (
          <span className="pointer-events-none absolute left-1.5 top-1.5 z-20 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary">
            {card.quantity}×
          </span>
        ) : null}
        {isGameChanger(card.name) ? (
          <GameChangerBadge className="pointer-events-none absolute left-1.5 top-9 z-20" />
        ) : null}
        {flag ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-rose px-1.5 py-1 text-center text-[10px] font-semibold leading-tight text-white">
            {flag}
          </p>
        ) : null}
        <DeckCardMenu
          card={card}
          visual={visual}
          isCommander={isCommander}
          actions={actions}
          surfaceRef={surfaceRef}
        />
        <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 z-20 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="w-fit max-w-full rounded-md bg-black/75 px-1.5 py-1 text-[10px] leading-tight shadow-sm backdrop-blur-sm">
            <CardEurLabel
              eur={visual?.eur}
              setCode={card.setCode ?? visual?.setCode}
              pending={!visual || visual.eur === undefined}
              qty={card.quantity}
            />
            <CheapestBadge
              currentEur={visual?.eur}
              cheapestEur={visual?.cheapestEur}
              cheapestSet={visual?.cheapestSet}
              loaded={visual?.cheapestEur !== undefined}
            />
          </div>
        </div>
      </div>
    </li>
  );
}

function CardEurLabel({
  eur,
  setCode,
  pending,
  qty,
}: {
  eur: number | null | undefined;
  setCode?: string;
  pending: boolean;
  qty: number;
}) {
  if (pending) {
    return <span className="text-white/70">€…</span>;
  }
  if (eur == null) {
    return <span className="italic text-white/70">{formatEur(null, { unavailable: "no price" })}</span>;
  }
  const line = qty > 1 ? eur * qty : eur;
  return (
    <span className="tabular-nums text-white">
      {setCode ? `${setCode} · ` : ""}
      {qty > 1 ? `${formatEur(eur)} · ${formatEur(line)}` : formatEur(eur)}
    </span>
  );
}

function CheapestBadge({
  currentEur,
  cheapestEur,
  cheapestSet,
  loaded,
}: {
  currentEur: number | null | undefined;
  cheapestEur: number | null | undefined;
  cheapestSet: string | null | undefined;
  loaded: boolean;
}) {
  if (!loaded) return null;
  if (cheapestEur == null) return null;
  const isCheaper = currentEur != null && cheapestEur < currentEur - 0.0001;
  if (!isCheaper) return null;
  return (
    <p className="mt-0.5 tabular-nums text-teal" title="Cheapest non-foil EUR across Scryfall printings">
      Best {cheapestSet ?? "?"} · {formatEur(cheapestEur)}
    </p>
  );
}
