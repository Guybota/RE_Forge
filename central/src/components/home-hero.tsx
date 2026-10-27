"use client";

import Link from "next/link";
import { ArrowRight, GitCompareArrows, Layers, Library, Sparkles, Swords, Wand2 } from "lucide-react";
import { useCardImages } from "@/hooks/use-card-images";
import { CardImage } from "@/components/card-image";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FEATURED = ["Giada, Font of Hope", "Bruna, the Fading Light"] as const;

const TOOLS = [
  {
    href: "/decks",
    title: "My Decks",
    blurb: "Paste, save, and manage Commander lists in this browser.",
    icon: Library,
  },
  {
    href: "/precons",
    title: "Precons",
    blurb: "Every official Commander precon, labeled by set, year, and commander.",
    icon: Layers,
  },
  {
    href: "/compare",
    title: "Compare Decks",
    blurb: "Shared cards, cuts, adds, and quantity diffs like Plains 32 vs 27.",
    icon: GitCompareArrows,
  },
  {
    href: "/improve",
    title: "Improve Decks",
    blurb: "Switches that sharpen a list's synergies, including small sets and loops.",
    icon: Wand2,
  },
  {
    href: "/sage",
    title: "Magic Sage",
    blurb: "Rulings, Commander legality, and combo lookup. Not an AI judge.",
    icon: Sparkles,
  },
  {
    href: "/play",
    title: "Play",
    blurb: "Pick a deck from My Decks and play it against the AI.",
    icon: Swords,
  },
] as const;

export function HomeHero() {
  const { get } = useCardImages(FEATURED);

  return (
    <div className="relative overflow-hidden">
      <section className="mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-16">
        <div className="animate-rise relative z-10 max-w-xl">
          <p className="font-display text-5xl font-bold tracking-tight text-primary sm:text-6xl md:text-7xl">
            MTG Central
          </p>
          <h1 className="mt-5 text-balance text-xl font-medium leading-snug text-foreground/95 sm:text-2xl">
            Your Commander lists, compared and improved - with real card art.
          </h1>
          <p className="mt-4 text-pretty text-muted-foreground">
            Save decks locally, compare lists, and diff upgrades against a reference
            list. Cardmarket EUR comes from Scryfall.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/decks" className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
              Open My Decks
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/compare?a=seed-giada-precon&b=seed-bruna-upgraded"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              Compare Angels lists
            </Link>
          </div>
        </div>

        <div className="animate-rise-delay relative mx-auto flex w-full max-w-md justify-center lg:max-w-none">
          <div className="absolute inset-8 rounded-full bg-primary/15 blur-3xl" />
          <div className="relative flex items-end justify-center">
            <div className="relative z-10 -mr-6 -rotate-6 transition duration-500 hover:-rotate-3 hover:scale-[1.02] sm:-mr-10">
              <CardImage
                name={FEATURED[0]}
                visual={get(FEATURED[0])}
                size="hero"
                prefer="normal"
                rounded="xl"
                className="w-[160px] shadow-2xl shadow-black/60 sm:w-[200px]"
              />
              <p className="mt-2 text-center text-xs text-muted-foreground">{FEATURED[0]}</p>
            </div>
            <div className="relative z-20 mb-6 -ml-6 rotate-6 transition duration-500 hover:rotate-3 hover:scale-[1.02] sm:-ml-10">
              <CardImage
                name={FEATURED[1]}
                visual={get(FEATURED[1])}
                size="hero"
                prefer="normal"
                rounded="xl"
                className="w-[160px] shadow-2xl shadow-black/60 ring-2 ring-primary/40 sm:w-[200px]"
              />
              <p className="mt-2 text-center text-xs text-muted-foreground">{FEATURED[1]}</p>
            </div>
          </div>
        </div>
      </section>

      <ul className="mx-auto mb-16 grid max-w-6xl gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {TOOLS.map((tool) => (
          <li key={tool.href}>
            <Link
              href={tool.href}
              className="panel group block h-full p-5 transition hover:border-primary/45 hover:bg-card/80"
            >
              <tool.icon className="mb-3 size-5 text-primary transition group-hover:scale-110" />
              <p className="font-display text-base font-semibold">{tool.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{tool.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
