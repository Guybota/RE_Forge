"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Bookmark, ChevronDown } from "lucide-react";
import { CardHoverPreview } from "@/components/card-hover-preview";
import { CardImage } from "@/components/card-image";
import { useCardImages } from "@/hooks/use-card-images";
import { deckCardCount } from "@/lib/compare";
import {
  applySuggestionsToDeck,
  suggestionAdds,
  suggestionCuts,
  suggestionKeeps,
  suggestionsFromReference,
} from "@/lib/improve-diff";
import { deckPlans } from "@/lib/improve-adapt";
import { BRACKET_LABELS, estimateBracket } from "@/lib/bracket";
import { bracketAdjustments, buildGamePlans, roomCutSuggestions, type GamePlan } from "@/lib/improve-plans";
import { SIGNAL_LABELS } from "@/lib/improve-fixtures";
import { parseImportPaste } from "@/lib/import-formats";
import { canonicalizeName } from "@/lib/parse-decklist";
import type { Deck, Suggestion } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function ImproveWorkshop({
  deck,
  onPrint,
}: {
  deck: Deck;
  onPrint: (draft: Omit<Deck, "id" | "createdAt" | "updatedAt" | "format">) => boolean;
}) {
  const built = useMemo(() => buildGamePlans(deck), [deck]);
  const gamePlans = useMemo(() => deckPlans(deck), [deck]);
  const currentBracket = useMemo(() => estimateBracket(deck).bracket, [deck]);
  const [panel, setPanel] = useState<"switches" | "bracket">("switches");
  const [target, setTarget] = useState<1 | 2 | 3 | 4 | 5>(currentBracket);
  const [planId, setPlanId] = useState(gamePlans[0]?.id ?? "");
  const adjustment = useMemo(
    () => bracketAdjustments(deck, planId, target),
    [deck, planId, target],
  );
  const [refText, setRefText] = useState("");
  const [refSuggestions, setRefSuggestions] = useState<Suggestion[]>([]);
  const [refNote, setRefNote] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(built.plans[0]?.id ?? null);
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const seen = useRef(new Map<string, Suggestion>());
  const [leaveQuery, setLeaveQuery] = useState("");
  const [copyName, setCopyName] = useState(`${deck.name} - a look`);
  const [printNote, setPrintNote] = useState<string | null>(null);

  const plans = useMemo(() => {
    if (!refSuggestions.length) return built.plans;
    return [
      ...built.plans,
      {
        id: "reference",
        title: "Beside another list",
        summary: "Cards that list plays and this one does not, and the other way around.",
        play: "This is a comparison, not a rebuild. Save any difference you want to remember. Leave the rest.",
        suggestions: refSuggestions,
      } satisfies GamePlan,
    ];
  }, [built.plans, refSuggestions]);

  const planItems = useMemo(() => {
    const items = [
      ...plans.flatMap((plan) => plan.suggestions),
      ...adjustment.toward,
      ...adjustment.plan,
    ];
    for (const item of items) seen.current.set(item.id, item);
    return items;
  }, [plans, adjustment]);
  const savedIdeas = useMemo(() => {
    const out: Suggestion[] = [];
    for (const id of saved) {
      const item = seen.current.get(id);
      if (item) out.push(item);
    }
    return out;
  }, [saved, planItems]);
  const cutting = useMemo(() => {
    const names = new Set<string>();
    for (const item of savedIdeas) {
      for (const cut of suggestionCuts(item)) names.add(canonicalizeName(cut.name));
    }
    return names;
  }, [savedIdeas]);
  const leaves = useMemo(() => roomCutSuggestions(deck, cutting), [deck, cutting]);
  const chosen = useMemo(() => {
    const extra = leaves.filter((item) => saved.has(item.id));
    return [...savedIdeas, ...extra];
  }, [savedIdeas, leaves, saved]);
  const projectedCount = deckCardCount(applySuggestionsToDeck(deck, chosen));
  const taken = useMemo(() => namesInUse(chosen), [chosen]);

  const artNames = useMemo(() => {
    const names = [...deck.commanders, ...deck.cards].map((card) => card.name);
    for (const item of planItems) {
      for (const cut of suggestionCuts(item)) names.push(cut.name);
      for (const add of suggestionAdds(item)) names.push(add.name);
      for (const keep of suggestionKeeps(item)) names.push(keep.name);
    }
    return names;
  }, [deck, planItems]);
  const { get } = useCardImages(artNames);

  const remember = (item: Suggestion) => {
    setPrintNote(null);
    setSaved((current) => {
      const next = new Set(current);
      if (next.has(item.id)) {
        next.delete(item.id);
        return next;
      }
      const lookup = byIdFrom(planItems, leaves);
      for (const [id, known] of seen.current) lookup.set(id, known);
      if (conflictsWith(item, current, lookup)) return current;
      next.add(item.id);
      return next;
    });
  };

  const compareList = () => {
    const parsed = parseImportPaste(refText, "auto");
    if (parsed.errors.length && !parsed.cards.length) {
      setRefNote(parsed.errors[0]?.message ?? "Could not read that list.");
      setRefSuggestions([]);
      return;
    }
    const suggestions = suggestionsFromReference(deck, parsed.cards);
    setRefSuggestions(suggestions);
    setRefNote(
      suggestions.length
        ? "Those differences are below, under Beside another list. Save only the ones you care about."
        : "That list did not turn up any new differences.",
    );
    if (suggestions.length) setOpenId("reference");
  };

  const printCopy = () => {
    if (!chosen.length) return;
    if (projectedCount !== 100) {
      setPrintNote(
        projectedCount > 100
          ? `A copy would be ${projectedCount} cards. A Commander list is 100. Let an idea go, or search for a card to set aside.`
          : `A copy would be ${projectedCount} cards. A Commander list is 100. Save an idea that adds a card, or let a cut go.`,
      );
      return;
    }
    const titles = plans
      .filter((plan) => plan.suggestions.some((item) => saved.has(item.id)))
      .map((plan) => plan.title);
    const lines = chosen.map((item) => `Try ${ideaTitle(item)}`);
    const notes = [
      deck.notes?.trim(),
      `A copy of ${deck.name}, from ideas you chose to try.`,
      titles.length ? `Directions: ${titles.join(", ")}.` : "",
      lines.join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n");
    const ok = onPrint({
      name: copyName.trim() || `${deck.name} - a look`,
      commanders: applySuggestionsToDeck(deck, chosen).commanders,
      cards: applySuggestionsToDeck(deck, chosen).cards,
      sideboard: deck.sideboard,
      colorIdentity: deck.colorIdentity,
      bracketIntent: deck.bracketIntent,
      tags: Array.from(new Set([...(deck.tags ?? []), "idea"])),
      notes,
      source: "manual",
    });
    if (!ok) setPrintNote("Could not save the copy.");
  };

  const leaveQueryNorm = leaveQuery.trim().toLowerCase();
  const visibleLeaves =
    leaveQueryNorm.length < 2
      ? []
      : leaves
          .filter((item) => suggestionCuts(item).some((cut) => cut.name.toLowerCase().includes(leaveQueryNorm)))
          .slice(0, 8);

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={panel === "switches" ? "default" : "outline"}
            onClick={() => setPanel("switches")}
          >
            Switches
          </Button>
          <Button
            variant={panel === "bracket" ? "default" : "outline"}
            onClick={() => setPanel("bracket")}
          >
            Bracket adjustment
          </Button>
        </div>
        {panel === "switches" ? (
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            These follow the reading above. Each idea trades a card already in{" "}
            {deck.commanders[0]?.name ?? "this deck"}&apos;s list, or a small set of them, for
            cards that push a synergy or a loop. Save an idea if you want it on a copy.
            The deck you opened stays as it is.
          </p>
        ) : (
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Pick the bracket you want to aim at, and the game plan you want the new cards
            to serve. Every idea is optional. Saving one does not change this deck, and it
            does not change Meant as.
          </p>
        )}
        {!built.identityKnown && panel === "switches" && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            This deck has no saved color identity, so the ideas below are colorless cards
            any commander can play.
          </p>
        )}
      </section>

      {panel === "switches" ? (
        plans.length === 0 ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            No switch stands out from the synergies this list already has. You can still
            paste another list below and look at the differences.
          </p>
        ) : (
          <ul className="space-y-3">
            {plans.map((plan) => (
              <Direction
                key={plan.id}
                plan={plan}
                open={openId === plan.id}
                saved={saved}
                taken={taken}
                get={get}
                onOpen={() => setOpenId((current) => (current === plan.id ? null : plan.id))}
                onRemember={remember}
              />
            ))}
          </ul>
        )
      ) : (
        <BracketAdjustment
          tags={gamePlans}
          planId={planId}
          onPlanId={setPlanId}
          currentBracket={currentBracket}
          target={target}
          onTarget={setTarget}
          toward={adjustment.toward}
          planIdeas={adjustment.plan}
          saved={saved}
          taken={taken}
          get={get}
          onRemember={remember}
        />
      )}

      {savedIdeas.length > 0 && (
        <section className="panel p-5 sm:p-6">
          <h2 className="font-display text-lg font-semibold">Ideas you are holding</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Notes only. {deck.name} has not changed. A separate copy would be {projectedCount}{" "}
            cards.
            {projectedCount === 100
              ? " That is a full Commander list, if you ever want to try it."
              : " A Commander list is 100, so a copy can wait until this feels right."}
          </p>
          <ul className="mt-4 space-y-2">
            {chosen.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/40 px-3 py-2"
              >
                <span className="text-sm">{ideaTitle(item)}</span>
                <Button size="sm" variant="ghost" onClick={() => remember(item)}>
                  Let go
                </Button>
              </li>
            ))}
          </ul>

          {projectedCount > 100 && (
            <div className="mt-4 max-w-2xl">
              <p className="text-sm leading-relaxed text-muted-foreground">
                This is {projectedCount - 100}{" "}
                {projectedCount - 100 === 1 ? "card" : "cards"} over a Commander list. Search
                for a card to set aside on the copy, or let an idea go. Nothing is chosen
                for you.
              </p>
              <label className="mt-3 block text-xs text-muted-foreground" htmlFor="set-aside">
                Search this deck
              </label>
              <Input
                id="set-aside"
                value={leaveQuery}
                onChange={(event) => setLeaveQuery(event.target.value)}
                placeholder="A card already in the list"
                className="mt-1.5 h-9 max-w-xs"
              />
              {leaveQueryNorm.length >= 2 && visibleLeaves.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">No card in this deck matches that.</p>
              )}
              {visibleLeaves.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {visibleLeaves.map((item) => (
                    <IdeaRow
                      key={item.id}
                      item={item}
                      saved={saved.has(item.id)}
                      blocked={false}
                      get={get}
                      onRemember={() => remember(item)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-col gap-3 border-t border-border/40 pt-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <label className="text-xs text-muted-foreground" htmlFor="copy-name">
                Name for a copy, if you want one
              </label>
              <Input
                id="copy-name"
                value={copyName}
                onChange={(event) => setCopyName(event.target.value)}
                className="h-9"
              />
              {printNote && (
                <p className="text-sm leading-relaxed text-muted-foreground">{printNote}</p>
              )}
            </div>
            <Button
              variant="outline"
              onClick={printCopy}
              disabled={projectedCount !== 100}
              className="shrink-0"
            >
              Print a copy
            </Button>
          </div>
        </section>
      )}

      <section className="panel p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold">Another list, if you have one</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Paste a list from Moxfield, Archidekt, Arena, or plain text. The differences show
          up as another direction you can read. You do not have to use any of them.
        </p>
        <Textarea
          className="mt-4 font-mono text-xs"
          rows={5}
          placeholder={"1 Sol Ring\n1 Swords to Plowshares"}
          value={refText}
          onChange={(event) => {
            setRefText(event.target.value);
            setRefNote(null);
          }}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={compareList} disabled={!refText.trim()}>
            Show the differences
          </Button>
          {refSuggestions.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSaved((current) => {
                  const next = new Set(current);
                  for (const item of refSuggestions) next.delete(item.id);
                  return next;
                });
                setRefSuggestions([]);
                setRefNote(null);
              }}
            >
              Clear that list
            </Button>
          )}
        </div>
        {refNote && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{refNote}</p>}
      </section>
    </div>
  );
}

function listNames(cards: { name: string }[]): string {
  const names = cards.map((card) => card.name);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function swapLine(item: Suggestion): string {
  const adds = suggestionAdds(item);
  const cuts = suggestionCuts(item);
  if (adds.length && cuts.length) return `${listNames(adds)} instead of ${listNames(cuts)}`;
  if (adds.length) return listNames(adds);
  if (cuts.length) return `Set aside ${listNames(cuts)}`;
  return item.reason;
}

function ideaTitle(item: Suggestion): string {
  const swap = swapLine(item);
  return item.title ? `${item.title}: ${swap}` : swap;
}

function isSet(item: Suggestion): boolean {
  return suggestionAdds(item).length > 1 || suggestionCuts(item).length > 1;
}

function namesInUse(items: Suggestion[]): Set<string> {
  const names = new Set<string>();
  for (const item of items) {
    for (const cut of suggestionCuts(item)) names.add(canonicalizeName(cut.name));
    for (const add of suggestionAdds(item)) names.add(canonicalizeName(add.name));
    for (const keep of suggestionKeeps(item)) names.add(canonicalizeName(keep.name));
  }
  return names;
}

function byIdFrom(planItems: Suggestion[], leaves: Suggestion[]): Map<string, Suggestion> {
  const map = new Map<string, Suggestion>();
  for (const item of planItems) map.set(item.id, item);
  for (const item of leaves) map.set(item.id, item);
  return map;
}

function conflictsWith(
  item: Suggestion,
  selected: Set<string>,
  lookup: Map<string, Suggestion>,
): boolean {
  const names = [...suggestionCuts(item), ...suggestionAdds(item), ...suggestionKeeps(item)].map(
    (card) => canonicalizeName(card.name),
  );
  for (const id of selected) {
    if (id === item.id) continue;
    const other = lookup.get(id);
    if (!other) continue;
    const otherNames = [
      ...suggestionCuts(other),
      ...suggestionAdds(other),
      ...suggestionKeeps(other),
    ].map((card) => canonicalizeName(card.name));
    if (names.some((name) => otherNames.includes(name))) return true;
  }
  return false;
}

function BracketAdjustment({
  tags,
  planId,
  onPlanId,
  currentBracket,
  target,
  onTarget,
  toward,
  planIdeas,
  saved,
  taken,
  get,
  onRemember,
}: {
  tags: { id: string; tag: string; title: string }[];
  planId: string;
  onPlanId: (id: string) => void;
  currentBracket: 1 | 2 | 3 | 4 | 5;
  target: 1 | 2 | 3 | 4 | 5;
  onTarget: (bracket: 1 | 2 | 3 | 4 | 5) => void;
  toward: Suggestion[];
  planIdeas: Suggestion[];
  saved: Set<string>;
  taken: Set<string>;
  get: ReturnType<typeof useCardImages>["get"];
  onRemember: (item: Suggestion) => void;
}) {
  const active = tags.find((plan) => plan.id === planId);
  const capLine =
    target <= 2
      ? "Bracket 1 and 2 usually keep Game Changers out."
      : target === 3
        ? "Bracket 3 usually stops around 3 Game Changers. Saving more than that gap reads higher."
        : "Bracket 4 and 5 are where Game Changers belong. Each one below is still optional.";

  const row = (item: Suggestion) => {
    const names = [...suggestionCuts(item), ...suggestionAdds(item), ...suggestionKeeps(item)].map(
      (card) => canonicalizeName(card.name),
    );
    return (
      <IdeaRow
        key={item.id}
        item={item}
        saved={saved.has(item.id)}
        blocked={!saved.has(item.id) && names.some((name) => taken.has(name))}
        get={get}
        onRemember={() => onRemember(item)}
      />
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs text-muted-foreground">
          This list reads as Bracket {currentBracket} · {BRACKET_LABELS[currentBracket]}.
        </p>
        <p className="mt-3 text-sm font-medium">Aim at</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {([1, 2, 3, 4, 5] as const).map((bracket) => (
            <Button
              key={bracket}
              size="sm"
              variant={target === bracket ? "default" : "outline"}
              onClick={() => onTarget(bracket)}
            >
              {bracket} · {BRACKET_LABELS[bracket]}
              {bracket === currentBracket ? " · now" : ""}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium">Game plan</p>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          These come from how the list already plays. If a plan tag was missing, it is saved
          on the deck. Pick the one you want the new cards to help.
        </p>
        {tags.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            This list does not lean on a plan yet, so the ideas below only move the bracket.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {tags.map((plan) => (
              <Button
                key={plan.id}
                size="sm"
                variant={planId === plan.id ? "default" : "outline"}
                onClick={() => onPlanId(plan.id)}
              >
                {plan.tag}
              </Button>
            ))}
          </div>
        )}
      </div>

      <section className="space-y-3">
        <h3 className="font-display text-lg font-semibold">
          For {active?.title ?? "the game plan"}
        </h3>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          These follow the tag you picked. They fit the colors, and they are optional.
        </p>
        {planIdeas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No further card for this plan fits the list without taking out a card that already
            serves it.
          </p>
        ) : (
          <ul className="space-y-2">{planIdeas.map(row)}</ul>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-lg font-semibold">
          Toward Bracket {target} · {BRACKET_LABELS[target]}
        </h3>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {capLine} This list follows the bracket, and a Game Changer is only offered when the
          card it replaces is already in the deck. Save any of these, or leave them all.
        </p>
        {toward.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The Game Changer count already fits that bracket.
          </p>
        ) : (
          <ul className="space-y-2">{toward.map(row)}</ul>
        )}
      </section>
    </div>
  );
}

function Direction({
  plan,
  open,
  saved,
  taken,
  get,
  onOpen,
  onRemember,
}: {
  plan: GamePlan;
  open: boolean;
  saved: Set<string>;
  taken: Set<string>;
  get: ReturnType<typeof useCardImages>["get"];
  onOpen: () => void;
  onRemember: (item: Suggestion) => void;
}) {
  const held = plan.suggestions.filter((item) => saved.has(item.id)).length;

  return (
    <li className="panel-strong overflow-hidden">
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-4 text-left sm:px-5"
        aria-expanded={open}
        onClick={onOpen}
      >
        <ChevronDown
          className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition", open && "rotate-180")}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-display text-lg font-semibold">{plan.title}</span>
            <span className="text-xs text-muted-foreground">
              {plan.suggestions.length === 1 && isSet(plan.suggestions[0])
                ? "a set"
                : `${plan.suggestions.length} ${plan.suggestions.length === 1 ? "idea" : "ideas"}`}
              {held > 0 ? ` · ${held} saved` : ""}
            </span>
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{plan.summary}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-border/50 px-4 py-4 sm:px-5">
          <p className="max-w-2xl text-sm leading-relaxed text-foreground/90">{plan.play}</p>
          <ul className="mt-4 space-y-2">
            {plan.suggestions.map((item) => {
              const names = [
                ...suggestionCuts(item),
                ...suggestionAdds(item),
                ...suggestionKeeps(item),
              ].map((card) => canonicalizeName(card.name));
              const blocked = !saved.has(item.id) && names.some((name) => taken.has(name));
              return (
                <IdeaRow
                  key={item.id}
                  item={item}
                  saved={saved.has(item.id)}
                  blocked={blocked}
                  get={get}
                  onRemember={() => onRemember(item)}
                />
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

function IdeaRow({
  item,
  saved,
  blocked,
  get,
  onRemember,
}: {
  item: Suggestion;
  saved: boolean;
  blocked: boolean;
  get: ReturnType<typeof useCardImages>["get"];
  onRemember: () => void;
}) {
  const cuts = suggestionCuts(item);
  const adds = suggestionAdds(item);
  const keeps = suggestionKeeps(item);
  const heading = item.title ?? (cuts.length && adds.length ? "Switch" : swapLine(item));

  return (
    <li
      className={cn(
        "rounded-xl border px-3 py-3 sm:px-4",
        saved ? "border-primary/40 bg-primary/10" : "border-border/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{heading}</span>
          {item.signals.slice(0, 3).map((signal) => (
            <Badge key={signal} variant="secondary" className="text-[10px]">
              {SIGNAL_LABELS[signal] ?? signal}
            </Badge>
          ))}
        </p>
        <Button
          size="sm"
          variant={saved ? "secondary" : "ghost"}
          disabled={blocked}
          onClick={onRemember}
          className="shrink-0"
        >
          <Bookmark className="size-3.5" />
          {saved ? "Saved" : isSet(item) ? "Save set" : "Save idea"}
        </Button>
      </div>

      <div className="mt-3 space-y-4">
        {keeps.length > 0 && (
          <div>
            <SwitchSide label="Already in this deck" cards={keeps} get={get} stays />
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {keeps.length === 1 ? "This card stays." : "These cards stay."} This idea does not add{" "}
              {keeps.length === 1 ? "it" : "them"}, and nothing is cut to make room for{" "}
              {keeps.length === 1 ? "it" : "them"}.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {cuts.length > 0 && (
            <SwitchSide label="Leaving" cards={cuts} get={get} />
          )}
          {cuts.length > 0 && adds.length > 0 && (
            <div className="flex shrink-0 items-center justify-center text-primary sm:mt-7" aria-hidden>
              <ArrowDown className="size-4 sm:hidden" />
              <ArrowRight className="hidden size-4 sm:block" />
            </div>
          )}
          {adds.length > 0 && (
            <SwitchSide label="Coming in" cards={adds} get={get} />
          )}
        </div>
      </div>

      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">
        {blocked ? "Already part of another idea you saved. " : ""}
        {item.reason}
      </p>
    </li>
  );
}

function SwitchSide({
  label,
  cards,
  get,
  stays = false,
}: {
  label: string;
  cards: { name: string }[];
  get: ReturnType<typeof useCardImages>["get"];
  stays?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className={cn("text-xs", stays ? "font-medium text-primary" : "text-muted-foreground")}>
        {label}
      </p>
      <ul className="mt-2 flex flex-wrap gap-3">
        {cards.map((card) => (
          <li key={card.name} className="w-[92px] sm:w-[112px]">
            <CardHoverPreview name={card.name} visual={get(card.name)} className="block">
              <CardImage
                name={card.name}
                visual={get(card.name)}
                size="tile"
                prefer="normal"
                rounded="md"
                className={cn("w-full", stays && "ring-2 ring-primary/60")}
              />
            </CardHoverPreview>
            <p className="mt-1.5 text-center text-[11px] leading-snug text-foreground/90">
              {card.name}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
