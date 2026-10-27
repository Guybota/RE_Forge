"use client";

import { useState } from "react";
import type { CardVisual } from "@/lib/scryfall";
import { cn } from "@/lib/utils";

type Size = "thumb" | "row" | "tile" | "hero" | "swap" | "swapLg";

const SIZE_CLASS: Record<Size, string> = {
  thumb: "h-10 w-8",
  row: "h-12 w-[34px]",
  tile: "aspect-[5/7] w-full",
  hero: "aspect-[5/7] w-full max-w-[220px]",
  swap: "aspect-[5/7] w-[140px] sm:w-[160px]",
  swapLg: "aspect-[5/7] w-[168px] sm:w-[200px] md:w-[220px]",
};

export function CardImage({
  visual,
  name,
  size = "row",
  prefer = "small",
  className,
  rounded = "md",
  eager = false,
}: {
  visual?: CardVisual;
  name: string;
  size?: Size;
  prefer?: "artCrop" | "small" | "normal" | "large";
  className?: string;
  rounded?: "md" | "lg" | "xl" | "sm";
  eager?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const src =
    prefer === "artCrop"
      ? visual?.artCrop ?? visual?.large ?? visual?.normal ?? visual?.small
      : prefer === "large"
        ? visual?.large ?? visual?.normal ?? visual?.artCrop ?? visual?.small
        : prefer === "normal"
          ? visual?.normal ?? visual?.large ?? visual?.artCrop ?? visual?.small
          : visual?.small ?? visual?.normal ?? visual?.large ?? visual?.artCrop;

  const radius =
    rounded === "xl"
      ? "rounded-xl"
      : rounded === "lg"
        ? "rounded-lg"
        : rounded === "sm"
          ? "rounded"
          : "rounded-md";

  const loading = !src && !visual?.failed;

  if (loading) {
    return (
      <div
        className={cn(
          SIZE_CLASS[size],
          radius,
          "animate-shimmer shrink-0 bg-gradient-to-br from-muted via-secondary to-muted ring-1 ring-white/10",
          className,
        )}
        title={`Loading ${name}`}
        aria-label={`Loading ${name}`}
      />
    );
  }

  if (!src || broken || visual?.failed) {
    return (
      <div
        className={cn(
          SIZE_CLASS[size],
          radius,
          "flex shrink-0 items-center justify-center border border-border/60 bg-gradient-to-br from-secondary to-muted text-center text-[10px] leading-tight text-muted-foreground",
          className,
        )}
        title={name}
      >
        <span className="line-clamp-4 px-2">{name}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Scryfall CDN dynamic URLs
    <img
      src={src}
      alt={name}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setBroken(true)}
      className={cn(
        SIZE_CLASS[size],
        radius,
        "shrink-0 object-cover shadow-lg shadow-black/50 ring-1 ring-white/15",
        className,
      )}
    />
  );
}

export function ManaPips({ cost }: { cost?: string }) {
  if (!cost) return null;
  const symbols = cost.match(/\{[^}]+\}/g) ?? [];
  if (!symbols.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5" aria-label={`Mana ${cost}`}>
      {symbols.map((sym, i) => {
        const code = sym.slice(1, -1).replace(/\//g, "");
        return (
          <span
            key={`${sym}-${i}`}
            className="inline-flex size-4 items-center justify-center rounded-full bg-black/50 text-[8px] font-bold text-foreground/90 ring-1 ring-white/20"
            title={sym}
          >
            {code}
          </span>
        );
      })}
    </span>
  );
}
