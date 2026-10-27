"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDeckLibrary } from "@/hooks/use-deck-library";
import { exportDecklistText } from "@/lib/import-formats";
import { playTranslator, type PlayMessageKey } from "@/lib/i18n";

/** Hosts the same UI shipped in Electron; gameplay never has a second implementation here. */
export function PlayView({ initialDeckId = "" }: { initialDeckId?: string }) {
  const params = useSearchParams();
  const deckId = params.get("deck") ?? initialDeckId;
  const { decks, state } = useDeckLibrary();
  const selected = decks.find((deck) => deck.id === deckId);
  const [port, setPort] = useState<number | null>(null);
  const [error, setError] = useState<PlayMessageKey | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [language, setLanguage] = useState("en-US");
  const [ready, setReady] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const sent = useRef<string | null>(null);
  const t = playTranslator(language);
  const libraryError: PlayMessageKey | null = deckId && state.status === "error"
    ? "libraryFailed"
    : deckId && state.status === "ready" && !selected ? "deckMissing" : null;
  const canOpen = !deckId || state.status === "ready" && Boolean(selected);
  const request = useMemo(() => selected ? {
    id: selected.id,
    name: selected.name,
    text: exportDecklistText(selected.commanders, selected.cards, "arena", selected.sideboard ?? []),
  } : null, [selected]);

  useEffect(() => { setLanguage(navigator.language); }, []);

  useEffect(() => {
    if (!canOpen) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 130_000);
    let cancelled = false;
    setPort(null);
    setError(null);
    setReady(false);
    setGameActive(false);
    sent.current = null;
    void (async () => {
      try {
        const res = await fetch("/api/play/engine", { method: "POST", signal: controller.signal });
        const body = await res.json() as { port?: unknown };
        if (cancelled) return;
        if (!res.ok || typeof body.port !== "number" || !Number.isInteger(body.port) || body.port < 1 || body.port > 65535) {
          setError("engineFailed");
          return;
        }
        setPort(body.port);
      } catch {
        if (!cancelled) setError("engineFailed");
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [canOpen, attempt]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const message: unknown = event.data;
      if (!message || typeof message !== "object" || !("type" in message)) return;
      if (message.type === "central:ready") {
        setReady(true);
        setError(null);
        if ("language" in message && typeof message.language === "string") setLanguage(message.language);
      } else if (message.type === "central:game" && "active" in message && typeof message.active === "boolean") {
        setGameActive(message.active);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    if (!ready || !request || gameActive || !frame.current?.contentWindow) return;
    const signature = JSON.stringify(request);
    if (sent.current === signature) return;
    frame.current.contentWindow.postMessage({ type: "central:deck", deck: request }, window.location.origin);
    sent.current = signature;
  }, [ready, request, gameActive]);

  // A missing static build or a failed socket must produce a recoverable state, not a blank frame.
  useEffect(() => {
    if (!port || ready) return;
    const timeout = setTimeout(() => setError("frameFailed"), 30_000);
    return () => clearTimeout(timeout);
  }, [port, ready, attempt]);

  const problem = libraryError ?? error;
  if (problem) return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-sm sm:px-6">
      <p role="alert">{t(problem)}</p>
      {problem !== "deckMissing" && <button type="button" className="mt-4 rounded-md border border-border px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => {
        if (problem === "libraryFailed") window.location.reload();
        else setAttempt((value) => value + 1);
      }}>{t("retry")}</button>}
    </div>
  );

  if (!port || !canOpen) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground sm:px-6" role="status">{t("opening")}</div>;

  const query = new URLSearchParams({
    enginePort: String(port),
    centralUrl: window.location.origin + "/decks",
    centralBridge: "1",
  });
  return (
    <div className={gameActive ? "fixed inset-0 z-50 bg-background" : "w-full"}>
      {!ready && <p className="px-4 py-3 text-sm text-muted-foreground" role="status">{t("opening")}</p>}
      <iframe
        key={port + ":" + attempt}
        ref={frame}
        title="RE:Forge"
        src={"/reforge/index.html?" + query}
        allow="fullscreen; autoplay; clipboard-write"
        className={gameActive ? "h-dvh w-full border-0" : "h-[calc(100dvh-7rem)] min-h-[390px] w-full border-0"}
      />
    </div>
  );
}
