"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CardVisual } from "@/lib/scryfall";
import { cn } from "@/lib/utils";

type Pos = { x: number; y: number; width: number };

/** Preview width - MTG card aspect ~5:7. Kept full size; it flips sides instead of shrinking. */
const PREVIEW_W = 360;
const PREVIEW_H = Math.round((PREVIEW_W * 7) / 5);

/**
 * Large Scryfall face parked beside the card image.
 * Desktop: mouseenter shows, mouseleave hides (no click, does not follow the cursor).
 * Touch: tap pins, tap outside dismisses.
 * Frame is the card only - no caption or loose padding.
 */
export function CardHoverPreview({
  name,
  visual,
  children,
  className,
  disabled,
}: {
  name: string;
  visual?: CardVisual;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0, width: PREVIEW_W });
  const [isCoarse, setIsCoarse] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(hover: none), (pointer: coarse)");
    const sync = () => setIsCoarse(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open || !isCoarse) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [open, isCoarse]);

  const placeBeside = useCallback((rect: DOMRect) => {
    const pad = 12;
    const gap = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(PREVIEW_W, Math.max(1, vw - pad * 2));
    const height = (width * 7) / 5;
    const rightX = rect.right + gap;
    const fitsRight = rightX + width <= vw - pad;
    const x = fitsRight
      ? rightX
      : Math.max(pad, Math.min(rect.left - gap - width, vw - pad - width));
    let y = rect.top;
    if (y + height > vh - pad) y = vh - pad - height;
    if (y < pad) y = pad;
    setPos({ x, y, width });
  }, []);

  const src =
    visual?.large ?? visual?.normal ?? visual?.artCrop ?? visual?.small ?? null;

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      onMouseEnter={(e) => {
        if (isCoarse || disabled) return;
        const rect = e.currentTarget.getBoundingClientRect();
        placeBeside(rect);
        setOpen(true);
      }}
      onMouseLeave={() => {
        if (!isCoarse) setOpen(false);
      }}
      onClick={(e) => {
        // Touch only: pin / unpin. Desktop must not use click.
        if (!isCoarse || disabled) return;
        // Let the menu button own its click.
        if ((e.target as Element | null)?.closest?.("[data-card-menu-trigger]")) {
          return;
        }
        e.stopPropagation();
        const rect = rootRef.current?.getBoundingClientRect();
        if (rect) placeBeside(rect);
        setOpen((v) => !v);
      }}
    >
      {children}
      {open &&
        !disabled &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            aria-label={name}
            className="pointer-events-none fixed z-[90]"
            style={{
              left: pos.x,
              top: pos.y,
              width: pos.width,
            }}
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={name}
                width={PREVIEW_W}
                height={PREVIEW_H}
                className="block h-auto w-full rounded-xl shadow-2xl shadow-black/70 ring-1 ring-black/40"
                draggable={false}
              />
            ) : (
              <div
                className="aspect-[5/7] w-full animate-pulse rounded-xl bg-muted ring-1 ring-white/10"
                aria-hidden
              />
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
