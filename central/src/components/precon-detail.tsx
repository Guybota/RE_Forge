"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wand2 } from "lucide-react";
import { CardHoverPreview } from "@/components/card-hover-preview";
import { CardImage } from "@/components/card-image";
import { ColorPips } from "@/components/color-pips";
import { GameChangerBadge } from "@/components/game-changer-badge";
import { useCardImages } from "@/hooks/use-card-images";
import { useDeckLibrary } from "@/hooks/use-deck-library";
import { isGameChanger } from "@/lib/game-changers";
import { findPrecon, preconDeckId, preconToDeck, preconYear } from "@/lib/precons";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PreconDetail({ preconId }: { preconId: string }) {
  const precon = findPrecon(preconId);
  const router = useRouter();
  const { state, createDeck } = useDeckLibrary();
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const names = useMemo(
    () =>
      precon
        ? [...precon.commanders, ...precon.cards].map((card) => card.name)
        : [],
    [precon],
  );
  const { get } = useCardImages(names);

  if (!precon) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl font-bold">Precon not found</h1>
        <p className="text-sm text-muted-foreground">
          That deck is not in the official Commander precon list saved with the app.
        </p>
        <Link href="/precons" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to Precons
        </Link>
      </div>
    );
  }

  const deckId = preconDeckId(precon);
  const commanderLine = precon.commanders.map((card) => card.name).join(" / ");

  const saveCopy = () => {
    const deck = preconToDeck(precon);
    const created = createDeck({
      name: deck.name,
      commanders: deck.commanders,
      cards: deck.cards,
      colorIdentity: deck.colorIdentity,
      tags: deck.tags,
      notes: deck.notes,
      source: "import",
    });
    if (!created) {
      setSaveNote("The library is still loading. Try again in a moment.");
      return;
    }
    router.push(`/decks/${created.id}`);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link
        href="/precons"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Precons
      </Link>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {precon.name}
          </h1>
          <p className="mt-2 text-muted-foreground">{commanderLine}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {precon.colorIdentity.length ? (
              <ColorPips colors={precon.colorIdentity} />
            ) : (
              <span>Colorless</span>
            )}
            <span>
              {precon.setName} · {preconYear(precon)} · Official precon · 100 cards
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/improve?deck=${deckId}`} className={cn(buttonVariants(), "gap-2")}>
            <Wand2 className="size-4" />
            Improve this precon
          </Link>
          <Button
            variant="outline"
            onClick={saveCopy}
            disabled={state.status !== "ready"}
          >
            Save to My Decks
          </Button>
        </div>
      </div>
      {saveNote && <p className="mt-3 text-sm text-muted-foreground">{saveNote}</p>}
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Improving opens the suggestion list for this exact product list. Nothing is
        written into My Decks until you save a copy or print an idea.
      </p>

      <h2 className="mt-10 font-display text-xl font-semibold">Commander</h2>
      <ul className="mt-4 flex flex-wrap gap-4">
        {precon.commanders.map((card) => (
          <li key={card.name} className="w-[140px] sm:w-[168px]">
            <CardHoverPreview name={card.name} visual={get(card.name)} className="block">
              <CardImage
                name={card.name}
                visual={get(card.name)}
                size="tile"
                prefer="normal"
                rounded="lg"
                eager
                className="w-full"
              />
            </CardHoverPreview>
            <p className="mt-2 text-center text-sm">{card.name}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 font-display text-xl font-semibold">The 99</h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {precon.cards.map((card) => (
          <li key={card.name} className="min-w-0">
            <div className="relative">
              <CardHoverPreview name={card.name} visual={get(card.name)} className="block">
                <CardImage
                  name={card.name}
                  visual={get(card.name)}
                  size="tile"
                  prefer="small"
                  rounded="md"
                  className="w-full"
                />
              </CardHoverPreview>
              {card.quantity > 1 && (
                <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-black/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                  {card.quantity}
                </span>
              )}
              {isGameChanger(card.name) && (
                <GameChangerBadge className="pointer-events-none absolute left-1.5 top-8 z-10" />
              )}
            </div>
            <p className="mt-1.5 line-clamp-2 text-center text-[11px] leading-snug text-foreground/90">
              {card.name}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
