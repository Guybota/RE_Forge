"use client";

import { CardImage } from "@/components/card-image";
import type { BracketEstimate, BracketTriggerKind } from "@/lib/bracket";
import type { CardVisual } from "@/lib/scryfall";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<BracketTriggerKind, string> = {
  "game-changer": "Game Changer",
  "fast-mana": "Fast mana",
  mld: "Mass land denial",
  "extra-turn": "Extra turn",
};

export function BracketResultPanel({
  result,
  get,
  onClose,
}: {
  result: BracketEstimate;
  get: (name: string) => CardVisual | undefined;
  onClose: () => void;
}) {
  return (
    <section className="panel-strong mt-4 space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Bracket result
          </p>
          <h3 className="font-display text-2xl font-bold tracking-tight">
            {result.bracket} · {result.label}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{result.rule}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-primary/40 text-primary">
            List estimate
          </Badge>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">{result.disclaimer}</p>
      <p className="text-sm text-foreground/90">{result.note}</p>

      {result.triggers.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Triggering cards
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {result.triggers.slice(0, 15).map((t) => (
              <li key={`${t.kind}-${t.name}`} className="text-center">
                <div
                  className={cn(
                    "rounded-xl p-1 ring-1",
                    t.kind === "game-changer" && "ring-primary/40",
                    t.kind === "mld" && "ring-rose/40",
                    t.kind === "extra-turn" && "ring-sky/40",
                    t.kind === "fast-mana" && "ring-teal/35",
                  )}
                >
                  <CardImage
                    name={t.name}
                    visual={get(t.name)}
                    size="tile"
                    prefer="normal"
                    rounded="lg"
                    className="w-full"
                  />
                </div>
                <p className="mt-1.5 line-clamp-2 text-[11px] font-medium leading-snug">
                  {t.name}
                </p>
                <p className="text-[10px] text-muted-foreground">{KIND_LABEL[t.kind]}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No Game Changers, mass land denial, extra turns, or listed fast mana detected.
        </p>
      )}

      {result.cutToMoveDown.length > 0 && (
        <p className="text-sm">
          <span className="font-medium text-primary">To move down, cut: </span>
          {result.cutToMoveDown.join(", ")}
        </p>
      )}
    </section>
  );
}
