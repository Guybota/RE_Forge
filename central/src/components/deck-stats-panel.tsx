"use client";

import { computeDeckStats } from "@/lib/deck-stats";
import { colorLabel, readDeckRoles, weakSlotLines } from "@/lib/deck-roles";
import type { CardVisual } from "@/lib/scryfall";
import type { Deck } from "@/lib/types";
import { ColorPips } from "@/components/color-pips";
import { cn } from "@/lib/utils";

export function DeckStatsPanel({
  deck,
  get,
  curveFilter,
  onCurveFilterChange,
}: {
  deck: Deck;
  get: (name: string) => CardVisual | undefined;
  /** Selected mana-value filter: "0"…"6" or "7+", or null when cleared. */
  curveFilter?: string | null;
  onCurveFilterChange?: (next: string | null) => void;
}) {
  const stats = computeDeckStats(deck, get);
  const roles = readDeckRoles(deck, get);
  const weak = weakSlotLines(roles);
  const maxCurve = Math.max(1, ...stats.curve.map((c) => c.count));

  return (
    <aside className="panel space-y-5 p-4 sm:p-5">
      <div>
        <h3 className="font-display text-lg font-semibold">Deck stats</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">From Scryfall cmc / type line</p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg MV</p>
          <p className="font-medium tabular-nums">
            {stats.averageCmc != null ? stats.averageCmc.toFixed(2) : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Lands</p>
          <p className="font-medium tabular-nums">{stats.landCount}</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          Color identity
        </p>
        <ColorPips
          colors={
            stats.colorIdentity.length
              ? (stats.colorIdentity as ("W" | "U" | "B" | "R" | "G")[])
              : deck.colorIdentity
          }
        />
      </div>

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          Mana curve
          {onCurveFilterChange && (
            <span className="ml-1 font-normal normal-case tracking-normal">
              · click a bar to filter
            </span>
          )}
        </p>
        <div className="flex h-24 items-end gap-1">
          {stats.curve.map((bucket) => {
            const key = bucket.mv === 7 ? "7+" : String(bucket.mv);
            const selected = curveFilter === key;
            const interactive = Boolean(onCurveFilterChange);
            const share = bucket.count === 0 ? 0 : Math.max(12, (bucket.count / maxCurve) * 100);
            return (
              <button
                key={bucket.mv}
                type="button"
                disabled={!interactive}
                onClick={() => {
                  if (!onCurveFilterChange) return;
                  onCurveFilterChange(selected ? null : key);
                }}
                className={cn(
                  "flex h-24 min-w-0 flex-1 flex-col justify-end",
                  interactive && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  !interactive && "cursor-default",
                )}
                title={`${key}: ${bucket.count} cards`}
                aria-pressed={selected}
                aria-label={`Mana value ${key}, ${bucket.count} cards`}
              >
                <span
                  className={cn(
                    "block w-full rounded-t",
                    selected ? "bg-primary" : "bg-primary/80",
                    bucket.count === 0 && "bg-muted/60",
                  )}
                  style={{ height: bucket.count === 0 ? 3 : `${share}%` }}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex gap-1">
          {stats.curve.map((bucket) => {
            const key = bucket.mv === 7 ? "7+" : String(bucket.mv);
            const selected = curveFilter === key;
            return (
              <span
                key={bucket.mv}
                className={cn(
                  "flex-1 text-center text-[9px] text-muted-foreground",
                  selected && "font-semibold text-primary",
                )}
              >
                {key}
              </span>
            );
          })}
        </div>
        {curveFilter && onCurveFilterChange && (
          <button
            type="button"
            className="mt-2 text-[11px] text-primary underline-offset-2 hover:underline"
            onClick={() => onCurveFilterChange(null)}
          >
            Clear MV filter ({curveFilter})
          </button>
        )}
      </div>

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          Type counts
        </p>
        <ul className="space-y-1 text-xs">
          {stats.typeCounts.map((t) => (
            <li key={t.key} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t.label}</span>
              <span className="tabular-nums font-medium">{t.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          Jobs
        </p>
        <ul className="space-y-1 text-xs">
          {roles.roles.map((role) => (
            <li key={role.key} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{role.label}</span>
              <span className="tabular-nums font-medium">{role.count}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          From card text. {roles.loaded} of {roles.total} cards classified. A card can count in more than one job. Lands are not counted as ramp.
        </p>
        {weak.length > 0 && (
          <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
            {weak.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>

      {roles.pips.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Pips and sources
          </p>
          <ul className="space-y-1 text-xs">
            {roles.pips.map((pip) => (
              <li key={pip.color} className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {colorLabel(pip.color)}
                  {pip.thin ? " · thin" : ""}
                </span>
                <span className="tabular-nums font-medium">
                  {pip.pips} pips · {pip.sources} sources
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
