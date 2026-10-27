"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Search, Sparkles, Wand2 } from "lucide-react";
import { CardImage } from "@/components/card-image";
import { useCardImages } from "@/hooks/use-card-images";
import { useDeckLibrary } from "@/hooks/use-deck-library";
import { checkCommanderDeck } from "@/lib/commander-check";
import { fetchCardRulings, suggestCardNames, type ScryfallRuling } from "@/lib/scryfall";
import { findCombosInDeck, type SpellbookCombo } from "@/lib/spellbook";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const FAQ = [
  {
    q: "What is the stack?",
    a: "Spells and abilities wait on the stack in LIFO order. The last thing put on the stack resolves first. Players can respond before anything resolves.",
  },
  {
    q: "When can I cast instants?",
    a: "Any time you have priority and the spell allows it — typically on empty stack during most steps/phases, or in response to something on the stack. Sorceries need your main phase with an empty stack (unless an effect says otherwise).",
  },
  {
    q: "What is a replacement effect?",
    a: "A continuous effect that replaces what would happen with a different event (often “instead”). They apply as the event would happen; they are not abilities that use the stack.",
  },
  {
    q: "Commander damage?",
    a: "Combat damage from a single commander to a player is tracked. 21 or more from the same commander causes that player to lose the game (even if life is above 0).",
  },
] as const;

export function SageView() {
  const { decks, state } = useDeckLibrary();
  const [cardQuery, setCardQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [lookupName, setLookupName] = useState("");
  const [deckId, setDeckId] = useState("");
  const [rulings, setRulings] = useState<ScryfallRuling[] | null>(null);
  const [rulingsError, setRulingsError] = useState<string | null>(null);
  const [rulingsLoading, setRulingsLoading] = useState(false);
  const [combos, setCombos] = useState<SpellbookCombo[] | null>(null);
  const [comboError, setComboError] = useState<string | null>(null);
  const [comboLoading, setComboLoading] = useState(false);

  const deck = decks.find((d) => d.id === deckId) ?? null;
  const deckNames = useMemo(
    () => (deck ? [...deck.commanders, ...deck.cards].map((c) => c.name) : []),
    [deck],
  );

  const comboNames = useMemo(
    () => (combos ?? []).flatMap((c) => c.cardNames),
    [combos],
  );

  const namesToLoad = useMemo(() => {
    const n = [...deckNames, ...comboNames];
    if (lookupName) n.push(lookupName);
    return n;
  }, [deckNames, comboNames, lookupName]);

  const { get, loading } = useCardImages(namesToLoad);

  const single = lookupName ? get(lookupName) : undefined;
  const check = useMemo(
    () => (deck ? checkCommanderDeck(deck, get) : null),
    [deck, get],
  );

  useEffect(() => {
    const q = cardQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void suggestCardNames(q).then((names) => {
        if (!cancelled) setSuggestions(names);
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cardQuery]);

  const runLookup = async (nameOverride?: string) => {
    const name = (nameOverride ?? cardQuery).trim();
    if (!name) return;
    setCardQuery(name);
    setSuggestions([]);
    setLookupName(name);
    setRulings(null);
    setRulingsError(null);
    setRulingsLoading(true);
    const result = await fetchCardRulings(name);
    setRulings(result.rulings);
    setRulingsError(result.error ?? null);
    setRulingsLoading(false);
  };

  const runCombos = async () => {
    if (!deck) return;
    setComboLoading(true);
    setComboError(null);
    setCombos(null);
    const result = await findCombosInDeck(deck);
    if (!result.ok) {
      setComboError(result.error);
      setCombos(null);
    } else {
      setCombos(result.combos);
    }
    setComboLoading(false);
  };

  const issueNames = useMemo(
    () => (check ? check.issues.flatMap((i) => i.names.map((n) => n.replace(/\s*\(×\d+\)$/, ""))) : []),
    [check],
  );
  useCardImages(issueNames);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="animate-fade-in panel-strong relative overflow-hidden p-8 sm:p-10">
        <div className="absolute -right-8 -top-8 size-40 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative">
          <div className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Sparkles className="size-6" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Magic Sage
          </h1>
          <p className="mt-3 max-w-lg text-muted-foreground">
            Starter tools — Commander list checks, Scryfall rulings, and Spellbook combos. Not a
            judge model and will not invent answers.
          </p>
        </div>
      </div>

      <section className="panel mt-8 space-y-4 p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold">Card lookup + rulings</h2>
        <p className="text-sm text-muted-foreground">
          Legality from Scryfall <code className="text-xs">legalities.commander</code>; rulings from
          the published rulings endpoint.
        </p>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Input
              placeholder="e.g. Black Lotus"
              value={cardQuery}
              onChange={(e) => setCardQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runLookup();
              }}
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
                {suggestions.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => void runLookup(name)}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button type="button" onClick={() => void runLookup()} disabled={!cardQuery.trim()}>
            <Search className="size-4" />
            Check
          </Button>
        </div>

        {lookupName && (
          <div className="space-y-4 rounded-xl border border-border/50 bg-black/20 p-4">
            <div className="flex flex-wrap items-center gap-4">
              <CardImage
                name={lookupName}
                visual={single}
                size="hero"
                prefer="normal"
                rounded="lg"
                className="w-[100px]"
              />
              <div>
                <p className="font-display font-semibold">{lookupName}</p>
                <Badge
                  variant="outline"
                  className={cn(
                    "mt-2",
                    single?.commanderLegality === "legal" && "border-teal/50 text-teal",
                    (single?.commanderLegality === "banned" ||
                      single?.commanderLegality === "not_legal") &&
                      "border-rose/50 text-rose",
                  )}
                >
                  {single?.commanderLegality
                    ? `Commander: ${single.commanderLegality}`
                    : loading
                      ? "Looking up…"
                      : "Legality unavailable"}
                </Badge>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium">Published rulings</h3>
              {rulingsLoading ? (
                <p className="mt-2 text-sm text-muted-foreground">Loading rulings…</p>
              ) : rulingsError ? (
                <p className="mt-2 text-sm text-rose">{rulingsError}</p>
              ) : rulings && rulings.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No published rulings for this card.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {(rulings ?? []).map((r, i) => (
                    <li key={`${r.publishedAt}-${i}`} className="rounded-lg border border-border/40 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {r.publishedAt || "Undated"}
                      </p>
                      <p className="mt-1 text-muted-foreground">{r.comment}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="panel mt-8 space-y-4 p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold">Full Commander check</h2>
        <p className="text-sm text-muted-foreground">
          Legality, color identity, singleton, a 100-card list, and whether two commanders are a legal pair. A companion stays outside that 100.
        </p>
        <div className="space-y-2">
          <Label>Saved deck</Label>
          <Select
            value={deckId || undefined}
            onValueChange={(v) => {
              if (v) {
                setDeckId(v);
                setCombos(null);
                setComboError(null);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a deck">
                {decks.find((d) => d.id === deckId)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {decks.map((d) => (
                <SelectItem key={d.id} value={d.id} label={d.name}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {state.status === "ready" && deck && check && (
          <div className="space-y-4">
            {check.ok ? (
              <p className="text-teal">
                Clean list. No legality, identity, singleton, size, or command-zone issues among answered cards
                ({check.size} cards including commanders).
              </p>
            ) : (
              <ul className="space-y-4">
                {check.issues.map((issue) => (
                  <li key={issue.kind} className="rounded-xl border border-rose/30 bg-rose/5 p-4">
                    <p className="font-medium text-rose">{issue.message}</p>
                    {issue.names.length > 0 && (
                      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {issue.names.slice(0, 12).map((raw) => {
                          const name = raw.replace(/\s*\(×\d+\)$/, "");
                          return (
                            <li key={raw} className="text-center">
                              <CardImage
                                name={name}
                                visual={get(name)}
                                size="tile"
                                prefer="normal"
                                rounded="lg"
                                className="w-full"
                              />
                              <p className="mt-1 text-[11px]">{raw}</p>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {check.notes.length > 0 && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {check.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}

            <div className="border-t border-border/40 pt-4">
              <Button size="sm" onClick={() => void runCombos()} disabled={comboLoading}>
                <Wand2 className="size-4" />
                {comboLoading ? "Finding combos…" : "Find combos"}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Uses the public Commander Spellbook API — credit{" "}
                <a
                  className="underline"
                  href="https://commanderspellbook.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  commanderspellbook.com
                </a>
                .
              </p>
              {comboError && <p className="mt-2 text-sm text-rose">{comboError}</p>}
              {combos && combos.length === 0 && !comboError && (
                <p className="mt-2 text-sm text-muted-foreground">
                  No included combos found for this list.
                </p>
              )}
              {combos && combos.length > 0 && (
                <ul className="mt-4 space-y-4">
                  {combos.map((c) => (
                    <li key={c.id} className="rounded-xl border border-border/50 p-3">
                      {c.description && (
                        <p className="mb-2 text-sm font-medium">{c.description}</p>
                      )}
                      <ul className="flex flex-wrap gap-2">
                        {c.cardNames.map((name) => (
                          <li key={name} className="w-20 text-center">
                            <CardImage
                              name={name}
                              visual={get(name)}
                              size="tile"
                              prefer="normal"
                              rounded="md"
                              className="w-full"
                            />
                            <p className="mt-1 line-clamp-2 text-[10px]">{name}</p>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="font-display text-xl font-semibold">Starter FAQ</h2>
        <p className="text-xs text-muted-foreground">
          Static primer — not a substitute for the Comprehensive Rules or a judge.
        </p>
        <ul className="space-y-3">
          {FAQ.map((item) => (
            <li key={item.q} className="panel p-4">
              <p className="flex items-start gap-2 font-medium">
                <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" />
                {item.q}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{item.a}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
