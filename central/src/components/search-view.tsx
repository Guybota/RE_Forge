"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BadgeEuro,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Gem,
  Layers,
  ListFilter,
  Palette,
  Scale,
  ScrollText,
  Search,
  Shield,
  Star,
  Tags,
  WholeWord,
} from "lucide-react";
import { CardHoverPreview } from "@/components/card-hover-preview";
import { CardImage, ManaPips } from "@/components/card-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  buildCardSearchQuery,
  hasSearchCriteria,
  COLOR_LETTERS,
  CRITERIA_FLAGS,
  emptyCardSearch,
  FORMATS,
  MANA_SYMBOLS,
  type CardSearchFilters,
  type ColorLetter,
  type ColorMode,
  type CompareOp,
  type LegalityMode,
  type PriceCurrency,
  type SearchChip,
  type StatKind,
} from "@/lib/card-search";
import { searchScryfallCards, type CardSearchHit, type CardVisual } from "@/lib/scryfall";
import { cn } from "@/lib/utils";

const SELECT =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const SWATCH: Record<ColorLetter | "C", string> = {
  W: "bg-[#f0ead8] text-[#1a1a1a]",
  U: "bg-[#0e68ab] text-white",
  B: "bg-[#22180f] text-[#eee] ring-1 ring-[#6a5640]",
  R: "bg-[#d3202a] text-white",
  G: "bg-[#00733e] text-white",
  C: "bg-[#c5ccd6] text-[#1a1a1a]",
};

const COLOR_LABEL: Record<ColorLetter | "C", string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

const STATS: { value: StatKind; label: string }[] = [
  { value: "mv", label: "Mana value" },
  { value: "pow", label: "Power" },
  { value: "tou", label: "Toughness" },
  { value: "loy", label: "Loyalty" },
];

const COMPARES: { value: CompareOp; label: string }[] = [
  { value: "eq", label: "equal to" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "gte", label: "greater or equal" },
  { value: "lte", label: "less or equal" },
  { value: "neq", label: "not equal" },
];

const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: "exactly", label: "Exactly these colors" },
  { value: "including", label: "Including these colors" },
  { value: "atmost", label: "At most these colors" },
];

const LEGALITY: { value: LegalityMode; label: string }[] = [
  { value: "legal", label: "Legal" },
  { value: "banned", label: "Banned" },
  { value: "restricted", label: "Restricted" },
  { value: "notlegal", label: "Not legal" },
];

const RARITIES: { value: CardSearchFilters["rarities"][number]; label: string }[] = [
  { value: "c", label: "Common" },
  { value: "u", label: "Uncommon" },
  { value: "r", label: "Rare" },
  { value: "m", label: "Mythic Rare" },
];

function insertSymbol(value: string, symbol: string, el: HTMLInputElement | null): string {
  if (!el) return value && /[A-Za-z0-9]$/.test(value) ? `${value} ${symbol}` : `${value}${symbol}`;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const prev = value.slice(0, start).slice(-1);
  const insert = prev && /[A-Za-z0-9]/.test(prev) ? ` ${symbol}` : symbol;
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  const pos = start + insert.length;
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(pos, pos);
  });
  return next;
}

function visualOf(card: CardSearchHit): CardVisual {
  return {
    name: card.name,
    small: card.small,
    normal: card.normal,
    large: card.large,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    oracleText: card.oracleText,
  };
}

function rarityLabel(rarity: string | undefined): string {
  if (rarity === "mythic") return "Mythic Rare";
  if (rarity === "rare") return "Rare";
  if (rarity === "uncommon") return "Uncommon";
  if (rarity === "common") return "Common";
  if (!rarity) return "";
  return rarity.slice(0, 1).toUpperCase() + rarity.slice(1);
}

function legalityLabel(value: string | null | undefined): string | null {
  if (value === "banned") return "Banned in Commander";
  if (value === "not_legal") return "Not legal in Commander";
  if (value === "restricted") return "Restricted in Commander";
  return null;
}

export function SearchView() {
  const [filters, setFilters] = useState<CardSearchFilters>(emptyCardSearch);
  const [typeDraft, setTypeDraft] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [symbolFor, setSymbolFor] = useState<"oracle" | "mana" | null>(null);
  const [cards, setCards] = useState<CardSearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ranQuery, setRanQuery] = useState("");
  const oracleRef = useRef<HTMLInputElement>(null);
  const manaRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const query = useMemo(() => buildCardSearchQuery(filters), [filters]);
  const ready = useMemo(() => hasSearchCriteria(filters), [filters]);
  const selectedIndex = cards.findIndex((card) => card.id === selectedId);
  const selected = selectedIndex >= 0 ? cards[selectedIndex] : null;
  const dialogOpen = selected !== null;

  const showCard = (index: number) => {
    const card = cards[index];
    if (card) setSelectedId(card.id);
  };

  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      setSelectedId((current) => {
        const index = cards.findIndex((card) => card.id === current);
        return cards[index + delta]?.id ?? current;
      });
    };
    // Capture before the dialog focus manager handles arrow keys.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cards, dialogOpen]);

  const patch = (partial: Partial<CardSearchFilters>) => {
    setFilters((current) => ({ ...current, ...partial }));
  };

  const addChip = (key: "types" | "criteria", text: string, kind: SearchChip["kind"]) => {
    const clean = text.trim();
    if (!clean) return;
    setFilters((current) => {
      if (current[key].some((chip) => chip.text.toLowerCase() === clean.toLowerCase() && chip.kind === kind)) {
        return current;
      }
      return {
        ...current,
        [key]: [
          ...current[key],
          { id: crypto.randomUUID(), text: clean, include: true, kind },
        ],
      };
    });
  };

  const run = async (pageUrl?: string | null) => {
    if ((!ready || !query) && !pageUrl) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const more = Boolean(pageUrl);
    if (more) setLoadingMore(true);
    else {
      setLoading(true);
      setLoadingMore(false);
      setError(null);
      setSearched(true);
      setRanQuery(query);
    }
    const page = await searchScryfallCards(more ? ranQuery : query, {
      pageUrl,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    if (page.error) {
      if (!more) {
        setCards([]);
        setSelectedId(null);
        setTotal(0);
        setNextPage(null);
      }
      setError(page.error);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    if (more) {
      setCards((current) => {
        const seen = new Set(current.map((card) => card.id));
        return [...current, ...page.cards.filter((card) => !seen.has(card.id))];
      });
      if (page.total) setTotal(page.total);
      setLoadingMore(false);
    } else {
      setCards(page.cards);
      setSelectedId(null);
      setTotal(page.total);
      setError(null);
      setLoading(false);
    }
    setNextPage(page.nextPage);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Search</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Filter the card pool the way an advanced search does. Rules text can match each word on its own, or the words together as one phrase.
        </p>
      </div>

      <form
        className="panel px-4 sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <FilterRow icon={WholeWord} label="Card name" hint='Any words in the name. "Fire" matches Fireball. A quoted phrase stays together.'>
          <Input
            value={filters.name}
            placeholder='Any words in the name, e.g. "Fire"'
            onChange={(event) => patch({ name: event.target.value })}
          />
        </FilterRow>

        <FilterRow
          icon={ScrollText}
          label="Text"
          hint="Text from the rules box. ~ stands for the card name. Symbols such as {T} are mana or tap symbols."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={oracleRef}
              value={filters.oracle}
              placeholder='Any text, e.g. "draw a card"'
              className="min-w-[16rem] flex-1"
              onChange={(event) => patch({ oracle: event.target.value })}
            />
            <SymbolPad
              open={symbolFor === "oracle"}
              onToggle={() => setSymbolFor((current) => (current === "oracle" ? null : "oracle"))}
              onPick={(symbol) => patch({ oracle: insertSymbol(filters.oracle, symbol, oracleRef.current) })}
            />
          </div>
          <label className="mt-3 flex items-start gap-2 rounded-lg border border-primary/35 bg-primary/10 px-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={filters.oracleTogether}
              onChange={(event) => patch({ oracleTogether: event.target.checked })}
            />
            <span className="text-sm">
              <span className="font-medium">Match these words together</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                With this off, each word is searched on its own and order does not matter. With this on, the words must appear in this order, as one phrase.
              </span>
            </span>
          </label>
        </FilterRow>

        <FilterRow
          icon={Tags}
          label="Type line"
          hint="A type, supertype, or subtype. Is keeps that type. Not removes it."
        >
          <ChipEditor
            draft={typeDraft}
            placeholder="Creature, Goblin, Legendary..."
            chips={filters.types}
            onDraft={setTypeDraft}
            onAdd={() => {
              addChip("types", typeDraft, "keyword");
              setTypeDraft("");
            }}
            onToggle={(id) =>
              patch({
                types: filters.types.map((chip) => (chip.id === id ? { ...chip, include: !chip.include } : chip)),
              })
            }
            onRemove={(id) => patch({ types: filters.types.filter((chip) => chip.id !== id) })}
          />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={filters.typePartial}
              onChange={(event) => patch({ typePartial: event.target.checked })}
            />
            Allow partial type matches
          </label>
        </FilterRow>

        <FilterRow
          icon={Palette}
          label="Colors"
          hint="Including means the card has every color you pick, and it may have others. At most means the card uses only colors you pick, and it may use fewer. Colorless is its own choice."
        >
          <ColorToggles
            colors={filters.colors}
            colorless={filters.colorless}
            onColors={(colors) => patch({ colors, colorless: false })}
            onColorless={(colorless) => patch({ colorless, colors: colorless ? [] : filters.colors })}
          />
          <select
            className={cn(SELECT, "mt-2")}
            value={filters.colorMode}
            aria-label="Color match"
            onChange={(event) => patch({ colorMode: event.target.value as ColorMode })}
          >
            {COLOR_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </FilterRow>

        <FilterRow
          icon={Shield}
          label="Commander"
          hint="Pick the commander's color identity. Only cards that can sit in that deck are returned."
        >
          <ColorToggles
            colors={filters.commanderColors}
            colorless={filters.commanderColorless}
            onColors={(commanderColors) => patch({ commanderColors, commanderColorless: false })}
            onColorless={(commanderColorless) =>
              patch({
                commanderColorless,
                commanderColors: commanderColorless ? [] : filters.commanderColors,
              })
            }
          />
        </FilterRow>

        <FilterRow icon={Gem} label="Mana cost" hint="Cards with this exact mana cost.">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={manaRef}
              value={filters.manaCost}
              placeholder="Any mana symbols, e.g. {W}{W}"
              className="min-w-[16rem] flex-1"
              onChange={(event) => patch({ manaCost: event.target.value })}
            />
            <SymbolPad
              open={symbolFor === "mana"}
              onToggle={() => setSymbolFor((current) => (current === "mana" ? null : "mana"))}
              onPick={(symbol) => patch({ manaCost: insertSymbol(filters.manaCost, symbol, manaRef.current) })}
            />
          </div>
        </FilterRow>

        <FilterRow icon={BarChart3} label="Stats" hint="Cards without that statistic are left out.">
          <div className="flex flex-wrap gap-2">
            <select
              className={SELECT}
              value={filters.stat}
              aria-label="Statistic"
              onChange={(event) => patch({ stat: event.target.value as StatKind })}
            >
              {STATS.map((stat) => (
                <option key={stat.value} value={stat.value}>
                  {stat.label}
                </option>
              ))}
            </select>
            <select
              className={SELECT}
              value={filters.statOp}
              aria-label="Statistic comparison"
              onChange={(event) => patch({ statOp: event.target.value as CompareOp })}
            >
              {COMPARES.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            <Input
              value={filters.statValue}
              placeholder='Any value, e.g. "2"'
              className="w-36"
              inputMode="decimal"
              onChange={(event) => patch({ statValue: event.target.value })}
            />
          </div>
        </FilterRow>

        <FilterRow icon={Gamepad2} label="Games" hint="Cards that appear in the games you check. Paper is on to start.">
          <div className="flex flex-wrap gap-4 text-sm">
            {(
              [
                ["paper", "Paper"],
                ["arena", "Arena"],
                ["mtgo", "Magic Online"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={filters.games[key]}
                  onChange={(event) => patch({ games: { ...filters.games, [key]: event.target.checked } })}
                />
                {label}
              </label>
            ))}
          </div>
        </FilterRow>

        <FilterRow icon={Scale} label="Formats" hint="Leave the format blank to skip this filter.">
          <div className="flex flex-wrap gap-2">
            <select
              className={SELECT}
              value={filters.legality}
              aria-label="Legality"
              onChange={(event) => patch({ legality: event.target.value as LegalityMode })}
            >
              {LEGALITY.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
            <select
              className={cn(SELECT, "min-w-44")}
              value={filters.format}
              aria-label="Format"
              onChange={(event) => patch({ format: event.target.value })}
            >
              <option value="">Any format</option>
              {FORMATS.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                </option>
              ))}
            </select>
          </div>
        </FilterRow>

        <FilterRow icon={Layers} label="Sets" hint="A set code such as eoc, or a set name. Block is the set group, such as Zendikar.">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={filters.set}
              placeholder="Set code or name"
              aria-label="Set"
              onChange={(event) => patch({ set: event.target.value })}
            />
            <Input
              value={filters.block}
              placeholder="Block name"
              aria-label="Block"
              onChange={(event) => patch({ block: event.target.value })}
            />
          </div>
        </FilterRow>

        <FilterRow icon={Star} label="Rarity" hint="Only the rarities you check. Leave them all off to allow every rarity.">
          <div className="flex flex-wrap gap-4 text-sm">
            {RARITIES.map((rarity) => (
              <label key={rarity.value} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={filters.rarities.includes(rarity.value)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...filters.rarities, rarity.value]
                      : filters.rarities.filter((value) => value !== rarity.value);
                    patch({ rarities: next });
                  }}
                />
                {rarity.label}
              </label>
            ))}
          </div>
        </FilterRow>

        <FilterRow
          icon={ListFilter}
          label="Criteria"
          hint="A keyword such as flying, or a property from the list. Is keeps it. Not removes it. Partial matches the start of a keyword."
        >
          <div className="flex flex-wrap gap-2">
            <Input
              value={keywordDraft}
              placeholder="Keyword, e.g. flying"
              className="min-w-[12rem] flex-1"
              onChange={(event) => setKeywordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addChip("criteria", keywordDraft, "keyword");
                  setKeywordDraft("");
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                addChip("criteria", keywordDraft, "keyword");
                setKeywordDraft("");
              }}
            >
              Add keyword
            </Button>
            <select
              className={cn(SELECT, "min-w-52")}
              aria-label="Choose a criterion"
              defaultValue=""
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                addChip("criteria", value, "is");
                event.target.value = "";
              }}
            >
              <option value="">Choose a criterion</option>
              {CRITERIA_FLAGS.map((flag) => (
                <option key={flag.value} value={flag.value}>
                  {flag.label}
                </option>
              ))}
            </select>
          </div>
          <ChipList
            chips={filters.criteria}
            labelFor={(chip) =>
              chip.kind === "is" ? CRITERIA_FLAGS.find((flag) => flag.value === chip.text)?.label ?? chip.text : chip.text
            }
            onToggle={(id) =>
              patch({
                criteria: filters.criteria.map((chip) =>
                  chip.id === id ? { ...chip, include: !chip.include } : chip,
                ),
              })
            }
            onRemove={(id) => patch({ criteria: filters.criteria.filter((chip) => chip.id !== id) })}
          />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={filters.criteriaPartial}
              onChange={(event) => patch({ criteriaPartial: event.target.checked })}
            />
            Allow partial keyword matches
          </label>
        </FilterRow>

        <FilterRow icon={BadgeEuro} label="Prices" hint="Cardmarket EUR, or USD. Cards with no price for that currency are left out.">
          <div className="flex flex-wrap gap-2">
            <select
              className={SELECT}
              value={filters.priceCurrency}
              aria-label="Currency"
              onChange={(event) => patch({ priceCurrency: event.target.value as PriceCurrency })}
            >
              <option value="eur">EUR</option>
              <option value="usd">USD</option>
            </select>
            <select
              className={SELECT}
              value={filters.priceOp}
              aria-label="Price comparison"
              onChange={(event) => patch({ priceOp: event.target.value as CompareOp })}
            >
              {COMPARES.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            <Input
              value={filters.priceValue}
              placeholder='Any value, e.g. "15.00"'
              className="w-36"
              inputMode="decimal"
              onChange={(event) => patch({ priceValue: event.target.value })}
            />
          </div>
        </FilterRow>

        <div className="flex flex-wrap items-center gap-3 py-4">
          <Button type="submit" disabled={!ready || !query || loading}>
            <Search className="size-4" />
            Search with these options
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              abortRef.current?.abort();
              setFilters(emptyCardSearch());
              setTypeDraft("");
              setKeywordDraft("");
              setSymbolFor(null);
              setCards([]);
              setTotal(0);
              setNextPage(null);
              setError(null);
              setSearched(false);
              setSelectedId(null);
              setRanQuery("");
              setLoading(false);
              setLoadingMore(false);
            }}
          >
            Clear
          </Button>
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {ready && query ? (
              <>
                Query <code className="text-foreground/80">{query}</code>
              </>
            ) : (
              "Add a name, rules text, or another filter."
            )}
          </p>
        </div>
      </form>

      <section className="mt-8" aria-live="polite">
        {loading && <p className="text-sm text-muted-foreground">Searching Scryfall…</p>}
        {!loading && error && <p className="text-sm text-rose">{error}</p>}
        {!loading && searched && !error && (
          <p className="text-sm text-muted-foreground">
            {total === 1 ? "1 card." : `${total} cards.`}
            {cards.length < total ? ` Showing ${cards.length}.` : ""}
          </p>
        )}

        {selected && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setSelectedId(null);
            }}
          >
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute top-1/2 left-3 z-10 -translate-y-1/2"
                disabled={selectedIndex <= 0}
                aria-label="Previous card"
                onClick={() => showCard(selectedIndex - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute top-1/2 right-3 z-10 -translate-y-1/2"
                disabled={selectedIndex >= cards.length - 1}
                aria-label="Next card"
                onClick={() => showCard(selectedIndex + 1)}
              >
                <ChevronRight />
              </Button>
              <div className="grid gap-4 px-10 sm:grid-cols-[180px_1fr]">
                <CardImage
                  name={selected.name}
                  visual={visualOf(selected)}
                  size="hero"
                  prefer="normal"
                  rounded="xl"
                  eager
                />
                <div className="min-w-0">
                  <DialogHeader>
                    <DialogTitle className="font-display text-xl font-semibold">
                      {selected.name}
                    </DialogTitle>
                    <DialogDescription className="flex flex-wrap items-center gap-2 text-sm">
                      <ManaPips cost={selected.manaCost} />
                      <span>{selected.typeLine}</span>
                    </DialogDescription>
                  </DialogHeader>
                  {selected.oracleText && (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {selected.oracleText}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    {[selected.setCode, selected.setName, rarityLabel(selected.rarity)]
                      .filter(Boolean)
                      .join(" · ")}
                    {selected.eur != null ? ` · €${selected.eur.toFixed(2)}` : ""}
                    {selected.eur == null && selected.usd != null
                      ? ` · $${selected.usd.toFixed(2)}`
                      : ""}
                  </p>
                  {legalityLabel(selected.commanderLegality) && (
                    <p className="mt-1 text-xs text-rose">
                      {legalityLabel(selected.commanderLegality)}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    {selectedIndex + 1} of {cards.length}
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {cards.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {cards.map((card) => {
              const active = card.id === selectedId;
              return (
                <li key={card.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded-xl p-1 text-left transition",
                      active ? "bg-primary/15 ring-1 ring-primary/50" : "hover:bg-secondary/60",
                    )}
                    onClick={() => setSelectedId(card.id)}
                  >
                    <CardHoverPreview name={card.name} visual={visualOf(card)} className="block">
                      <CardImage
                        name={card.name}
                        visual={visualOf(card)}
                        size="tile"
                        prefer="normal"
                        rounded="lg"
                      />
                    </CardHoverPreview>
                    <p className="mt-1 line-clamp-2 text-xs">{card.name}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {nextPage && !loading && (
          <div className="mt-4">
            <Button type="button" variant="outline" disabled={loadingMore} onClick={() => void run(nextPage)}>
              {loadingMore ? "Loading more…" : "Show more"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function FilterRow({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon: typeof Search;
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 border-b border-border/50 py-4 md:grid-cols-[9.5rem_1fr] md:gap-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 shrink-0 text-primary" />
        {label}
      </div>
      <div>
        {children}
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function ColorToggles({
  colors,
  colorless,
  onColors,
  onColorless,
}: {
  colors: ColorLetter[];
  colorless: boolean;
  onColors: (colors: ColorLetter[]) => void;
  onColorless: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLOR_LETTERS.map((color) => {
        const on = colors.includes(color);
        return (
          <button
            key={color}
            type="button"
            aria-pressed={on}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-offset-2 ring-offset-card",
              SWATCH[color],
              on ? "ring-2 ring-primary" : "opacity-55 hover:opacity-100",
            )}
            onClick={() => onColors(on ? colors.filter((item) => item !== color) : [...colors, color])}
          >
            <span className="font-bold">{color}</span>
            {COLOR_LABEL[color]}
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={colorless}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-offset-2 ring-offset-card",
          SWATCH.C,
          colorless ? "ring-2 ring-primary" : "opacity-55 hover:opacity-100",
        )}
        onClick={() => onColorless(!colorless)}
      >
        <span className="font-bold">C</span>
        Colorless
      </button>
    </div>
  );
}

function SymbolPad({
  open,
  onToggle,
  onPick,
}: {
  open: boolean;
  onToggle: () => void;
  onPick: (symbol: string) => void;
}) {
  return (
    <div className="contents">
      <Button type="button" variant="ghost" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={onToggle}>
        Add symbol
      </Button>
      {open && (
        <div className="flex basis-full flex-wrap gap-1 rounded-lg border border-border bg-popover p-2">
          {MANA_SYMBOLS.map((symbol) => (
            <button
              key={symbol}
              type="button"
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-secondary px-1.5 text-[11px] font-semibold hover:bg-accent"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(symbol)}
            >
              {symbol.slice(1, -1)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChipEditor({
  draft,
  placeholder,
  chips,
  onDraft,
  onAdd,
  onToggle,
  onRemove,
}: {
  draft: string;
  placeholder: string;
  chips: SearchChip[];
  onDraft: (value: string) => void;
  onAdd: () => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          className="min-w-[12rem] flex-1"
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={onAdd}>
          Add
        </Button>
      </div>
      <ChipList chips={chips} onToggle={onToggle} onRemove={onRemove} />
    </div>
  );
}

function ChipList({
  chips,
  labelFor,
  onToggle,
  onRemove,
}: {
  chips: SearchChip[];
  labelFor?: (chip: SearchChip) => string;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (!chips.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.id} className="inline-flex items-center overflow-hidden rounded-full border border-border text-xs">
          <button
            type="button"
            className={cn("px-2 py-1 font-semibold", chip.include ? "bg-primary/20 text-primary" : "bg-rose/20 text-rose")}
            onClick={() => onToggle(chip.id)}
          >
            {chip.include ? "Is" : "Not"}
          </button>
          <span className="px-2">{labelFor ? labelFor(chip) : chip.text}</span>
          <button type="button" className="px-2 py-1 text-muted-foreground hover:text-foreground" aria-label={`Remove ${chip.text}`} onClick={() => onRemove(chip.id)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
