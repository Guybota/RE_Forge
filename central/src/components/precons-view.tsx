"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ColorPips } from "@/components/color-pips";
import { useCardImages } from "@/hooks/use-card-images";
import { listPrecons, preconYear, type Precon } from "@/lib/precons";
import type { ColorIdentity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const COLOR_CHOICES: { id: ColorIdentity; label: string }[] = [
  { id: "W", label: "White" },
  { id: "U", label: "Blue" },
  { id: "B", label: "Black" },
  { id: "R", label: "Red" },
  { id: "G", label: "Green" },
];

export function PreconsView() {
  const precons = listPrecons();
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("all");
  const [colors, setColors] = useState<ColorIdentity[]>([]);
  const [colorless, setColorless] = useState(false);

  const years = useMemo(() => {
    const set = new Set(precons.map(preconYear));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [precons]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return precons.filter((precon) => {
      if (year !== "all" && preconYear(precon) !== year) return false;
      if (colorless && precon.colorIdentity.length > 0) return false;
      if (colors.length && !colors.every((color) => precon.colorIdentity.includes(color))) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        precon.name,
        precon.setName,
        precon.setCode,
        ...precon.commanders.map((card) => card.name),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [precons, query, year, colors, colorless]);

  const groups = useMemo(() => groupPrecons(visible), [visible]);
  const commanderNames = useMemo(
    () => visible.flatMap((precon) => precon.commanders.map((card) => card.name)),
    [visible],
  );
  const { get, loading } = useCardImages(commanderNames);

  const toggleColor = (color: ColorIdentity) => {
    setColorless(false);
    setColors((current) =>
      current.includes(color) ? current.filter((item) => item !== color) : [...current, color],
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Precons</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Every official Commander precon, newest first. Each one is labeled with its
        set, year, and commander. Open a deck to read the list, or improve it. A
        printed idea becomes your own copy. The product list stays as Wizards printed it.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Deck, commander, or set"
          aria-label="Search precons"
          className="sm:max-w-sm"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Year
          <select
            value={year}
            onChange={(event) => setYear(event.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
          >
            <option value="all">All years</option>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {COLOR_CHOICES.map((choice) => (
          <Button
            key={choice.id}
            size="sm"
            variant={colors.includes(choice.id) ? "default" : "outline"}
            onClick={() => toggleColor(choice.id)}
            aria-pressed={colors.includes(choice.id)}
          >
            {choice.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={colorless ? "default" : "outline"}
          onClick={() => {
            setColorless((value) => !value);
            setColors([]);
          }}
          aria-pressed={colorless}
        >
          Colorless
        </Button>
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        {visible.length === precons.length
          ? `${precons.length} official Commander precons`
          : `${visible.length} of ${precons.length} official Commander precons`}
      </p>

      {visible.length === 0 ? (
        <div className="panel mt-10 px-6 py-12 text-center">
          <p className="font-display text-xl">No precon matches that</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Try a commander name, a set like Murders at Karlov Manor, or clear the
            year and color filters.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-12">
          {groups.map((group) => (
            <section key={group.year}>
              <h2 className="font-display text-2xl font-semibold">{group.year}</h2>
              <div className="mt-5 space-y-8">
                {group.sets.map((set) => (
                  <div key={set.code}>
                    <h3 className="text-sm font-medium text-foreground/90">
                      {set.name}
                      <span className="ml-2 font-normal text-muted-foreground">{set.code}</span>
                    </h3>
                    <ul className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {set.decks.map((precon) => (
                        <PreconTile
                          key={precon.id}
                          precon={precon}
                          art={get(precon.commanders[0]?.name ?? "")}
                          artLoading={loading}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PreconTile({
  precon,
  art,
  artLoading,
}: {
  precon: Precon;
  art?: { artCrop?: string; normal?: string };
  artLoading: boolean;
}) {
  const commander = precon.commanders.map((card) => card.name).join(" / ");
  return (
    <li>
      <Link
        href={`/precons/${precon.id}`}
        className="panel group block overflow-hidden transition hover:border-primary/50 hover:bg-card/80"
      >
        <div className="relative h-36 overflow-hidden sm:h-40">
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
                "flex h-full items-center justify-center bg-gradient-to-br from-secondary to-muted px-4 text-center text-sm text-muted-foreground",
                artLoading && "animate-shimmer",
              )}
            >
              {commander || precon.name}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/35 to-transparent" />
          <div className="absolute right-3 top-3">
            {precon.colorIdentity.length ? (
              <ColorPips colors={precon.colorIdentity} />
            ) : (
              <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-foreground/90">
                Colorless
              </span>
            )}
          </div>
          <div className="absolute bottom-3 left-3 right-3">
            <p className="font-display text-lg font-bold leading-tight drop-shadow-md">
              {precon.name}
            </p>
            <p className="mt-0.5 line-clamp-2 text-sm text-foreground/90 drop-shadow">{commander}</p>
          </div>
        </div>
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {precon.setName} · {preconYear(precon)} · Official precon
        </p>
      </Link>
    </li>
  );
}

function groupPrecons(precons: readonly Precon[]) {
  const years: {
    year: string;
    sets: { code: string; name: string; decks: Precon[] }[];
  }[] = [];
  for (const precon of precons) {
    const year = preconYear(precon);
    let yearGroup = years.find((group) => group.year === year);
    if (!yearGroup) {
      yearGroup = { year, sets: [] };
      years.push(yearGroup);
    }
    let setGroup = yearGroup.sets.find((set) => set.code === precon.setCode);
    if (!setGroup) {
      setGroup = { code: precon.setCode, name: precon.setName, decks: [] };
      yearGroup.sets.push(setGroup);
    }
    setGroup.decks.push(precon);
  }
  for (const year of years) {
    for (const set of year.sets) {
      set.decks.sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  return years;
}
