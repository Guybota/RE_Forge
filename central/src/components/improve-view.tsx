"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CardImage } from "@/components/card-image";
import { ImproveWorkshop } from "@/components/improve-workshop";
import { useCardImages } from "@/hooks/use-card-images";
import { useDeckLibrary } from "@/hooks/use-deck-library";
import { BRACKET_LABELS, estimateBracket } from "@/lib/bracket";
import { readDeckRoles, weakSlotLines } from "@/lib/deck-roles";
import { readDeck } from "@/lib/improve-plans";
import { findCombosInDeck, type SpellbookCombo } from "@/lib/spellbook";
import { findPrecon, preconToDeck, preconYear } from "@/lib/precons";
import { summarizeDeckEur } from "@/lib/prices";
import type { Deck } from "@/lib/types";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ImproveView({ initialDeckId = "" }: { initialDeckId?: string }) {
  const { state, decks, createDeck, ensureDeckPlanTags } = useDeckLibrary();
  const router = useRouter();
  const params = useSearchParams();
  const queryDeck = params.get("deck") ?? "";
  // This page stays mounted when only ?deck= changes, so the first id we
  // read must not stick. Follow the address bar on every navigation.
  const [deckId, setDeckId] = useState(queryDeck || initialDeckId);

  useLayoutEffect(() => {
    const next = new URLSearchParams(window.location.search).get("deck") ?? "";
    setDeckId(next || queryDeck || initialDeckId);
  }, [queryDeck, initialDeckId]);

  useEffect(() => {
    ensureDeckPlanTags();
  }, [ensureDeckPlanTags]);

  const precon = deckId.startsWith("precon-") ? findPrecon(deckId) : undefined;
  const deck = decks.find((d) => d.id === deckId) ?? (precon ? preconToDeck(precon) : null);

  const cmdNames = useMemo(() => {
    const names = decks.flatMap((d) => d.commanders.map((c) => c.name));
    if (deck) names.push(...deck.commanders.map((card) => card.name));
    return names;
  }, [decks, deck]);
  const { get: getCmd } = useCardImages(cmdNames);

  if (state.status === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading decks…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="animate-fade-in relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-card/80 via-card/40 to-transparent p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Improve Decks
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Read what this deck and its commander are already doing, then look at switches
            that sharpen those synergies, including small sets and loops. Bracket changes
            live under Bracket adjustment. Ideas stay optional. The list you opened does
            not change unless you print a separate copy.
          </p>
        </div>
      </div>

      <div className="panel-strong mt-8 max-w-xl overflow-hidden">
        {deck?.commanders[0] &&
          (getCmd(deck.commanders[0].name)?.artCrop ||
            getCmd(deck.commanders[0].name)?.normal) && (
            <div className="relative h-32 sm:h-36">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  getCmd(deck.commanders[0].name)?.artCrop ??
                  getCmd(deck.commanders[0].name)?.normal
                }
                alt=""
                className="h-full w-full object-cover object-top"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent" />
              <p className="absolute bottom-3 left-4 font-display text-lg font-semibold drop-shadow">
                {deck.commanders[0].name}
              </p>
            </div>
          )}
        <div className="space-y-1.5 p-4 sm:p-5">
          <Label>Pick a deck to evaluate</Label>
          <Select
            value={deckId || undefined}
            onValueChange={(value) => {
              if (!value || value === deckId) return;
              setDeckId(value);
              router.replace(`/improve?deck=${encodeURIComponent(value)}`, { scroll: false });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a saved deck">{deck?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {deck && !decks.some((item) => item.id === deck.id) && (
                <SelectItem value={deck.id} label={deck.name}>
                  {deck.name}
                </SelectItem>
              )}
              {decks.map((d) => (
                <SelectItem key={d.id} value={d.id} label={d.name}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {precon ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Official {precon.setName} precon, {preconYear(precon)}. This product list
              is not in My Decks. Print a copy when you want to keep an idea.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Or start from an{" "}
              <Link href="/precons" className="text-primary underline-offset-2 hover:underline">
                official precon
              </Link>
              .
            </p>
          )}
        </div>
      </div>

      {!deck && (
        <div className="panel mt-16 px-6 py-14 text-center">
          <p className="font-display text-xl">Pick a deck to evaluate</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Or open an{" "}
            <Link href="/precons" className="text-primary underline-offset-2 hover:underline">
              official precon
            </Link>{" "}
            and improve that list. Nothing is applied until you ask for a copy.
          </p>
        </div>
      )}

      {deck && (
        <ImproveResults
          key={deck.id}
          deck={deck}
          onPrint={(draft) => {
            const created = createDeck(draft);
            if (!created) return false;
            router.push(`/decks/${created.id}`);
            return true;
          }}
        />
      )}
    </div>
  );
}

function ImproveResults({
  deck,
  onPrint,
}: {
  deck: Deck;
  onPrint: (draft: Omit<Deck, "id" | "createdAt" | "updatedAt" | "format">) => boolean;
}) {
  const bracket = useMemo(() => estimateBracket(deck), [deck]);
  const reading = useMemo(() => readDeck(deck), [deck]);
  const [combos, setCombos] = useState<SpellbookCombo[] | null>(null);
  const [comboNote, setComboNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCombos(null);
    setComboNote(null);
    void findCombosInDeck(deck).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setComboNote(result.error);
        setCombos([]);
        return;
      }
      setCombos(result.combos);
    });
    return () => {
      cancelled = true;
    };
  }, [deck]);
  const names = useMemo(
    () => [...deck.commanders, ...deck.cards].map((card) => card.name),
    [deck],
  );
  const { get, loading: artLoading } = useCardImages(names);
  const roles = useMemo(() => readDeckRoles(deck, get), [deck, get]);
  const weak = useMemo(() => weakSlotLines(roles), [roles]);
  const deckPrices = useMemo(
    () => summarizeDeckEur(deck, get, artLoading),
    [deck, get, artLoading],
  );
  const cmd = deck.commanders[0]?.name ?? "";

  return (
    <div className="mt-10 animate-rise space-y-10">
      <section className="panel-strong overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[200px_1fr]">
          <div className="flex items-center justify-center bg-gradient-to-b from-black/40 to-black/20 p-5">
            <CardImage
              name={cmd}
              visual={get(cmd)}
              size="hero"
              prefer="large"
              rounded="xl"
              eager
              className="w-[160px] md:w-[168px]"
            />
          </div>
          <div className="flex flex-col justify-center p-5 sm:p-6">
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {reading.headline}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/90">
              {reading.body}
            </p>
            {reading.threads.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {reading.threads.map((thread) => (
                  <span
                    key={thread}
                    className="rounded-full border border-border/60 px-2.5 py-0.5 text-xs text-muted-foreground"
                  >
                    {thread}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {deckPrices.loading
                ? "Loading Cardmarket prices."
                : deckPrices.totalEur != null
                  ? `About €${deckPrices.totalEur.toFixed(2)} on Cardmarket.`
                  : "Cardmarket total is not available yet."}{" "}
              The list reads as Bracket {bracket.bracket}, {bracket.label}.
              {deck.bracketIntent
                ? deck.bracketIntent === bracket.bracket
                  ? ` You marked it Bracket ${deck.bracketIntent}, ${BRACKET_LABELS[deck.bracketIntent]}, and the list agrees.`
                  : ` You marked it Bracket ${deck.bracketIntent}, ${BRACKET_LABELS[deck.bracketIntent]}. Those two disagree.`
                : " No bracket intent is saved on this deck."}
              {bracket.gameChangers.length > 0
                ? ` Game Changers already in the list: ${bracket.gameChangers.join(", ")}.`
                : " No Game Changers in the list."}
            </p>
            <ul className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {roles.roles.map((role) => (
                <li key={role.key} className="rounded-full border border-border/60 px-2.5 py-0.5 tabular-nums">
                  {role.label} {role.count}
                </li>
              ))}
            </ul>
            {weak.length > 0 && (
              <ul className="mt-3 max-w-2xl space-y-1 text-xs leading-relaxed text-muted-foreground">
                {weak.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 max-w-2xl">
              <p className="text-xs font-medium text-foreground/80">Combos already in the list</p>
              {combos == null ? (
                <p className="mt-1 text-xs text-muted-foreground">Asking Commander Spellbook…</p>
              ) : comboNote ? (
                <p className="mt-1 text-xs text-muted-foreground">{comboNote}</p>
              ) : combos.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">No included combo turned up.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
                  {combos.slice(0, 4).map((combo) => (
                    <li key={combo.id}>
                      {combo.cardNames.join(", ")}
                      {combo.description ? `. ${combo.description}` : ""}
                    </li>
                  ))}
                  {combos.length > 4 && <li>And {combos.length - 4} more.</li>}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      <ImproveWorkshop deck={deck} onPrint={onPrint} />
    </div>
  );
}
