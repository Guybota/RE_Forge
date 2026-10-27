"use client";

import { useMemo, useState } from "react";
import { CardImage } from "@/components/card-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { rankComboCuts } from "@/lib/combo-cuts";
import { deckCardCount } from "@/lib/compare";
import type { EdhrecCombo } from "@/lib/edhrec-combos";
import { canonicalizeName } from "@/lib/parse-decklist";
import type { CardVisual } from "@/lib/scryfall";
import type { Deck } from "@/lib/types";

export function ComboAddDialog({
  combo,
  deck,
  get,
  inList,
  onClose,
  onJustAdd,
  onReplace,
}: {
  combo: EdhrecCombo;
  deck: Deck;
  get: (name: string) => CardVisual | undefined;
  inList: (name: string) => boolean;
  onClose: () => void;
  onJustAdd: (names: string[]) => void;
  onReplace: (add: string[], cut: string[]) => void;
}) {
  const missing = combo.cardNames.filter((name) => !inList(name));
  const already = combo.cardNames.filter((name) => inList(name));
  const [mode, setMode] = useState<"choose" | "replace">("choose");
  const [query, setQuery] = useState("");
  const ranked = useMemo(
    () => rankComboCuts(deck, get, combo.cardNames),
    [deck, get, combo.cardNames],
  );
  const [picked, setPicked] = useState<string[]>(() =>
    ranked.slice(0, missing.length).map((cut) => cut.name),
  );

  const suggested = ranked.slice(0, Math.max(missing.length, 0));
  const suggestedKeys = new Set(suggested.map((cut) => canonicalizeName(cut.name)));
  const queryNorm = query.trim().toLowerCase();
  const others = ranked.filter((cut) => {
    if (suggestedKeys.has(canonicalizeName(cut.name))) return false;
    if (!queryNorm) return false;
    return cut.name.toLowerCase().includes(queryNorm);
  });

  const toggle = (name: string) => {
    setPicked((prev) => {
      const key = canonicalizeName(name);
      const has = prev.some((item) => canonicalizeName(item) === key);
      if (has) return prev.filter((item) => canonicalizeName(item) !== key);
      if (prev.length >= missing.length) return prev;
      return [...prev, name];
    });
  };

  const nextSize = deckCardCount(deck) + missing.length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add combo</DialogTitle>
          <DialogDescription>
            {combo.cardNames.join(" + ")}
            {combo.pieces.length > 0
              ? `, plus ${combo.pieces.map((piece) => piece.label.charAt(0).toLowerCase() + piece.label.slice(1)).join(" and ")}`
              : ""}
            {combo.results.length > 0 ? `. ${combo.results.join(" · ")}` : ""}
          </DialogDescription>
        </DialogHeader>
        {combo.pieces.length > 0 ? (
          <p className="text-sm text-foreground/90">
            You choose {combo.pieces.map((piece) => piece.label.charAt(0).toLowerCase() + piece.label.slice(1)).join(" and ")} yourself.
            The buttons below add only the named cards.
          </p>
        ) : null}

        {missing.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every card in this combo is already in the list.
          </p>
        ) : mode === "choose" ? (
          <div className="space-y-3">
            <p className="text-sm">
              Not in this list: {missing.join(", ")}.
              {already.length > 0 ? ` Already here: ${already.join(", ")}.` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Just adding them makes this a {nextSize}-card list. Replacing takes the same number
              of cards out, so the size stays {deckCardCount(deck)}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onJustAdd(missing)}>
                Just add the cards
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPicked(ranked.slice(0, missing.length).map((cut) => cut.name));
                  setMode("replace");
                }}
              >
                Replace cards in this deck
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Add {missing.join(", ")}. Take out {missing.length}{" "}
              {missing.length === 1 ? "card" : "cards"}. {picked.length} of {missing.length} chosen.
            </p>
            <ul className="space-y-2">
              {suggested.map((cut) => {
                const checked = picked.some(
                  (name) => canonicalizeName(name) === canonicalizeName(cut.name),
                );
                return (
                  <li key={cut.name}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/50 p-2">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-primary"
                        checked={checked}
                        onChange={() => toggle(cut.name)}
                      />
                      <span>
                        <span className="block text-sm font-medium">{cut.name}</span>
                        <span className="block text-xs text-muted-foreground">{cut.reason}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Or choose different cards to take out.
              </p>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search this deck"
              />
              {queryNorm && others.length === 0 && (
                <p className="text-xs text-muted-foreground">No other card matches.</p>
              )}
              <ul className="space-y-1">
                {others.slice(0, 8).map((cut) => {
                  const checked = picked.some(
                    (name) => canonicalizeName(name) === canonicalizeName(cut.name),
                  );
                  return (
                    <li key={cut.name}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/5">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={checked}
                          onChange={() => toggle(cut.name)}
                        />
                        <span className="text-sm">{cut.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
            <DialogFooter>
              <Button size="sm" variant="outline" onClick={() => setMode("choose")}>
                Back
              </Button>
              <Button
                size="sm"
                disabled={picked.length !== missing.length}
                onClick={() => onReplace(missing, picked)}
              >
                Replace and add
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ComboCardZoom({
  name,
  visual,
  onClose,
}: {
  name: string;
  visual?: CardVisual;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>{visual?.typeLine ?? "Card"}</DialogDescription>
        </DialogHeader>
        <CardImage
          name={name}
          visual={visual}
          size="hero"
          prefer="large"
          rounded="xl"
          eager
          className="mx-auto w-full max-w-[280px]"
        />
        {visual?.oracleText ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{visual.oracleText}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Oracle text is still loading.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
