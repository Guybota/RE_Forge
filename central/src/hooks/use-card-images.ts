"use client";

import { useEffect, useRef, useState } from "react";
import { canonicalizeName } from "@/lib/parse-decklist";
import { resolveCardVisuals, type CardVisual } from "@/lib/scryfall";

function namesKey(names: readonly string[]): string {
  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))
    .map((name) => canonicalizeName(name))
    .sort()
    .join("|");
}

/**
 * Card art and prices. The first render is always empty so the server HTML
 * matches the client. Cache and network fill in after mount. The effect is
 * keyed by card names, not array identity, so a new array each render cannot
 * retrigger fetches forever.
 */
export function useCardImages(names: readonly string[]) {
  const key = namesKey(names);
  const namesRef = useRef(names);
  namesRef.current = names;

  const [map, setMap] = useState<Map<string, CardVisual>>(() => new Map());
  const [loading, setLoading] = useState(key.length > 0);

  useEffect(() => {
    let cancelled = false;
    const requested = Array.from(
      new Set(namesRef.current.map((name) => name.trim()).filter(Boolean)),
    );

    if (requested.length === 0) {
      setMap((prev) => (prev.size === 0 ? prev : new Map()));
      setLoading(false);
      return;
    }

    setLoading(true);
    resolveCardVisuals(requested).then((resolved) => {
      if (cancelled) return;
      setMap(resolved);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const get = (name: string): CardVisual | undefined => map.get(canonicalizeName(name));

  return { get, map, loading };
}
