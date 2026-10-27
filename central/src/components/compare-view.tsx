"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CardImage } from "@/components/card-image";
import { CardHoverPreview } from "@/components/card-hover-preview";
import { GameChangerBadge } from "@/components/game-changer-badge";
import { useCardImages } from "@/hooks/use-card-images";
import { useDeckLibrary } from "@/hooks/use-deck-library";
import { compareDecks } from "@/lib/compare";
import { isGameChanger } from "@/lib/game-changers";
import { formatEur, summarizeDeckEur } from "@/lib/prices";
import type { CompareRow, Deck } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type FilterMode = "all" | "cuts" | "adds" | "mana";

function isLandVisual(
  name: string,
  get: ReturnType<typeof useCardImages>["get"],
): boolean {
  const t = get(name)?.typeLine?.toLowerCase() ?? "";
  return t.includes("land");
}

export function CompareView() {
  const { state, decks } = useDeckLibrary();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [deckAId, setDeckAId] = useState(params.get("a") ?? "");
  const [deckBId, setDeckBId] = useState(params.get("b") ?? "");
  const [filter, setFilter] = useState<FilterMode>("all");

  useEffect(() => {
    const next = new URLSearchParams();
    if (deckAId) next.set("a", deckAId);
    if (deckBId) next.set("b", deckBId);
    const qs = next.toString();
    if (qs === params.toString()) return;
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [deckAId, deckBId, params, pathname, router]);

  const deckA = decks.find((d) => d.id === deckAId) ?? null;
  const deckB = decks.find((d) => d.id === deckBId) ?? null;

  const result = useMemo(() => {
    if (!deckA || !deckB) return null;
    return compareDecks(deckA, deckB);
  }, [deckA, deckB]);

  const artNames = useMemo(() => {
    if (!result || !deckA || !deckB) {
      return [
        ...(deckA?.commanders.map((c) => c.name) ?? []),
        ...(deckB?.commanders.map((c) => c.name) ?? []),
      ];
    }
    return [
      ...deckA.commanders.map((c) => c.name),
      ...deckB.commanders.map((c) => c.name),
      ...result.rows.map((r) => r.name),
    ];
  }, [result, deckA, deckB]);

  const { get, loading: artLoading } = useCardImages(artNames);

  const pricesA = useMemo(
    () => (deckA ? summarizeDeckEur(deckA, get, artLoading) : null),
    [deckA, get, artLoading],
  );
  const pricesB = useMemo(
    () => (deckB ? summarizeDeckEur(deckB, get, artLoading) : null),
    [deckB, get, artLoading],
  );
  const euroDelta = useMemo(() => {
    if (!pricesA || !pricesB) return null;
    if (pricesA.totalEur == null || pricesB.totalEur == null) return null;
    return pricesB.totalEur - pricesA.totalEur;
  }, [pricesA, pricesB]);

  const overlapPct = useMemo(() => {
    if (!result || !deckA || !deckB) return null;
    const uniq =
      result.summary.sharedCount +
      result.summary.onlyACount +
      result.summary.onlyBCount +
      result.summary.qtyDiffCount;
    if (uniq === 0) return 0;
    // Shared unique names / union of unique names
    return Math.round((result.summary.sharedCount / uniq) * 100);
  }, [result, deckA, deckB]);

  const filteredRows = useMemo(() => {
    if (!result) return [];
    let rows = result.rows;
    if (filter === "cuts") {
      rows = rows.filter(
        (r) =>
          r.kind === "onlyA" || (r.kind === "qtyDiff" && r.delta < 0),
      );
    } else if (filter === "adds") {
      rows = rows.filter(
        (r) =>
          r.kind === "onlyB" || (r.kind === "qtyDiff" && r.delta > 0),
      );
    } else if (filter === "mana") {
      rows = rows.filter((r) => isLandVisual(r.name, get));
    }
    return rows;
  }, [result, filter, get]);

  if (state.status === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading decks…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="animate-fade-in">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Compare Decks
        </h1>
        <p className="mt-1 text-muted-foreground">
          Shared, only-A, only-B, and quantity diffs, with overlap %, a mana-base filter, and
          full-card hover.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <DeckPicker
          label="Choose left deck (A)"
          value={deckAId}
          decks={decks}
          onChange={setDeckAId}
          excludeId={deckBId}
          art={deckA?.commanders[0] ? get(deckA.commanders[0].name) : undefined}
          commanderName={deckA?.commanders[0]?.name}
        />
        <DeckPicker
          label="Choose right deck (B)"
          value={deckBId}
          decks={decks}
          onChange={setDeckBId}
          excludeId={deckAId}
          art={deckB?.commanders[0] ? get(deckB.commanders[0].name) : undefined}
          commanderName={deckB?.commanders[0]?.name}
        />
      </div>

      {!deckA || !deckB ? (
        <div className="panel mt-16 px-6 py-14 text-center text-muted-foreground">
          <p className="font-display text-xl text-foreground">Pick two decks to diff</p>
          <p className="mt-2 text-sm">
            Seed decks are ready: Giada Angels (Precon) vs Bruna Angels (Upgraded).
          </p>
        </div>
      ) : result ? (
        <div className="mt-8 animate-rise space-y-6">
          <div className="flex flex-wrap gap-2">
            <Badge className="border-primary/40 bg-primary/15 text-primary" variant="outline">
              Overlap {overlapPct}%
            </Badge>
            <Badge className="border-teal/40 bg-teal/20 text-teal" variant="outline">
              Shared {result.summary.sharedCount}
            </Badge>
            <Badge className="border-rose/40 bg-rose/20 text-rose" variant="outline">
              Only A {result.summary.onlyACount}
            </Badge>
            <Badge className="border-sky/40 bg-sky/20 text-sky" variant="outline">
              Only B {result.summary.onlyBCount}
            </Badge>
            <Badge variant="outline">Qty diffs {result.summary.qtyDiffCount}</Badge>
            <Badge variant="secondary">
              {result.summary.cardsCut} cut · {result.summary.cardsAdded} added
            </Badge>
          </div>

          <section className="panel space-y-2 p-4 sm:p-5">
            <h2 className="font-display text-lg font-semibold">Cardmarket EUR totals</h2>
            <p className="text-xs text-muted-foreground">
              Cached Scryfall <code className="text-[10px]">prices.eur</code> only — never invented.
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {deckA.name}
                </p>
                <p className="font-medium tabular-nums">
                  {pricesA?.loading
                    ? "…"
                    : pricesA?.totalEur != null
                      ? formatEur(pricesA.totalEur)
                      : "No priced cards"}
                </p>
                {(pricesA?.unpricedCards ?? 0) > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {pricesA!.unpricedCards} without price
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {deckB.name}
                </p>
                <p className="font-medium tabular-nums">
                  {pricesB?.loading
                    ? "…"
                    : pricesB?.totalEur != null
                      ? formatEur(pricesB.totalEur)
                      : "No priced cards"}
                </p>
                {(pricesB?.unpricedCards ?? 0) > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {pricesB!.unpricedCards} without price
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  B − A
                </p>
                <p
                  className={cn(
                    "font-medium tabular-nums",
                    euroDelta != null && euroDelta < 0 && "text-teal",
                    euroDelta != null && euroDelta > 0 && "text-primary",
                  )}
                >
                  {euroDelta == null
                    ? "—"
                    : `${euroDelta > 0 ? "+" : ""}${formatEur(euroDelta)}`}
                </p>
              </div>
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "All cards"],
                ["cuts", "Only cuts (A→B)"],
                ["adds", "Only adds (A→B)"],
                ["mana", "Mana base only"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                size="sm"
                variant={filter === id ? "default" : "outline"}
                onClick={() => setFilter(id)}
              >
                {label}
              </Button>
            ))}
          </div>

          {result.commanderRows.length > 0 && filter === "all" && (
            <section className="panel p-4">
              <h2 className="font-display text-lg font-semibold">Commanders</h2>
              <div className="mt-3 flex flex-wrap gap-3">
                {result.commanderRows.map((row) => (
                  <div
                    key={`cmd-${row.kind}-${row.name}`}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border border-border/50 px-3 py-2 transition hover:bg-white/5",
                      row.kind === "shared" && "diff-shared",
                      row.kind === "onlyA" && "diff-only-a",
                      row.kind === "onlyB" && "diff-only-b",
                    )}
                  >
                    <CardHoverPreview name={row.name} visual={get(row.name)}>
                      <CardImage
                        name={row.name}
                        visual={get(row.name)}
                        size="hero"
                        prefer="normal"
                        rounded="lg"
                        className="w-[72px]"
                      />
                    </CardHoverPreview>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{row.name}</span>
                        {isGameChanger(row.name) ? <GameChangerBadge /> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.kind === "shared" && "Both decks · hover the art"}
                        {row.kind === "onlyA" && "Only A · hover the art"}
                        {row.kind === "onlyB" && "Only B · hover the art"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {filter !== "all" ? (
            <RowList rows={filteredRows} deckA={deckA} deckB={deckB} get={get} />
          ) : (
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="shared">Shared</TabsTrigger>
                <TabsTrigger value="onlyA">Only A</TabsTrigger>
                <TabsTrigger value="onlyB">Only B</TabsTrigger>
                <TabsTrigger value="qty">Qty diffs</TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="mt-4">
                <SplitColumns rows={result.rows} deckA={deckA} deckB={deckB} get={get} />
              </TabsContent>
              <TabsContent value="shared" className="mt-4">
                <RowList
                  rows={result.rows.filter((r) => r.kind === "shared")}
                  deckA={deckA}
                  deckB={deckB}
                  get={get}
                />
              </TabsContent>
              <TabsContent value="onlyA" className="mt-4">
                <RowList
                  rows={result.rows.filter((r) => r.kind === "onlyA")}
                  deckA={deckA}
                  deckB={deckB}
                  get={get}
                />
              </TabsContent>
              <TabsContent value="onlyB" className="mt-4">
                <RowList
                  rows={result.rows.filter((r) => r.kind === "onlyB")}
                  deckA={deckA}
                  deckB={deckB}
                  get={get}
                />
              </TabsContent>
              <TabsContent value="qty" className="mt-4">
                <RowList
                  rows={result.rows.filter((r) => r.kind === "qtyDiff")}
                  deckA={deckA}
                  deckB={deckB}
                  get={get}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DeckPicker({
  label,
  value,
  decks,
  onChange,
  excludeId,
  art,
  commanderName,
}: {
  label: string;
  value: string;
  decks: Deck[];
  onChange: (id: string) => void;
  excludeId?: string;
  art?: ReturnType<ReturnType<typeof useCardImages>["get"]>;
  commanderName?: string;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="relative h-28 bg-secondary/40">
        {(art?.artCrop || art?.normal) && commanderName ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={art.artCrop ?? art.normal}
            alt=""
            className="h-full w-full object-cover object-top opacity-90"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
      </div>
      <div className="space-y-1.5 p-4">
        <Label>{label}</Label>
        <Select
          value={value || undefined}
          onValueChange={(v) => {
            if (v) onChange(v);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a saved deck">
              {decks.find((d) => d.id === value)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {decks
              .filter((d) => d.id !== excludeId)
              .map((d) => (
                <SelectItem key={d.id} value={d.id} label={d.name}>
                  {d.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function SplitColumns({
  rows,
  deckA,
  deckB,
  get,
}: {
  rows: CompareRow[];
  deckA: Deck;
  deckB: Deck;
  get: ReturnType<typeof useCardImages>["get"];
}) {
  const left = rows.filter(
    (r) => r.kind === "onlyA" || r.kind === "qtyDiff" || r.kind === "shared",
  );
  const right = rows.filter(
    (r) => r.kind === "onlyB" || r.kind === "qtyDiff" || r.kind === "shared",
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">{deckA.name}</h3>
        <RowList rows={left} deckA={deckA} deckB={deckB} get={get} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">{deckB.name}</h3>
        <RowList rows={right} deckA={deckA} deckB={deckB} get={get} />
      </div>
    </div>
  );
}

function RowList({
  rows,
  deckA,
  deckB,
  get,
}: {
  rows: CompareRow[];
  deckA: Deck;
  deckB: Deck;
  get: ReturnType<typeof useCardImages>["get"];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No cards in this view.</p>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={`${row.kind}-${row.name}`}>
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border border-border/40 px-3 py-2 transition hover:bg-white/5",
              row.kind === "shared" && "diff-shared",
              row.kind === "onlyA" && "diff-only-a",
              row.kind === "onlyB" && "diff-only-b",
              row.kind === "qtyDiff" && "diff-qty",
            )}
          >
            <CardHoverPreview name={row.name} visual={get(row.name)}>
              <CardImage
                name={row.name}
                visual={get(row.name)}
                size="tile"
                prefer="small"
                rounded="md"
                className="w-12 shrink-0"
              />
            </CardHoverPreview>
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-medium">{row.name}</span>
                {isGameChanger(row.name) ? <GameChangerBadge className="shrink-0" /> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {row.kind === "shared" && `${row.quantity}× shared`}
                {row.kind === "onlyA" && `${row.quantity}× only in ${deckA.name}`}
                {row.kind === "onlyB" && `${row.quantity}× only in ${deckB.name}`}
                {row.kind === "qtyDiff" &&
                  `${row.qtyA} → ${row.qtyB} (${row.delta > 0 ? "+" : ""}${row.delta})`}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
