"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Home } from "@/components/reforge/Home";
import { ImportDeck } from "@/components/reforge/ImportDeck";
import { I18n, translator } from "@/components/reforge/i18n";
import { LanguagePicker } from "@/components/reforge/LanguagePicker";
import { Lobby } from "@/components/reforge/Lobby";
import { DEFAULT_SKIN } from "@/components/reforge/skins";
import { SkinPicker } from "@/components/reforge/SkinPicker";
import { Table } from "@/components/reforge/table/Table";
import { useEngine } from "@/components/reforge/useEngine";
import { useDeckLibrary } from "@/hooks/use-deck-library";
import { exportDecklistText } from "@/lib/import-formats";
import "@/components/reforge/reforge.css";

const FORGE_NAME_UNSAFE = /[\\/:*?"<>|]/g;

function forgeDeckName(name: string): string {
  const cleaned = name.replace(FORGE_NAME_UNSAFE, " ").replace(/\s+/g, " ").trim();
  return cleaned || "My deck";
}

export function PlayView({ initialDeckId = "" }: { initialDeckId?: string }) {
  const params = useSearchParams();
  const queryDeck = params.get("deck") ?? "";
  const deckId = queryDeck || initialDeckId;
  const [port, setPort] = useState<number | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/play/engine", { method: "POST" });
        const raw = await res.text();
        const body = JSON.parse(raw) as { port?: number; error?: string };
        if (cancelled) return;
        if (!res.ok || typeof body.port !== "number") {
          setBootError(body.error || "The table did not start.");
          return;
        }
        setPort(body.port);
      } catch {
        if (!cancelled) setBootError("The table did not start.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!port) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground sm:px-6">
        {bootError ?? "Opening the table…"}
      </div>
    );
  }

  return <ForgeScreen port={port} initialDeckId={deckId} />;
}

function ForgeScreen({ port, initialDeckId }: { port: number; initialDeckId: string }) {
  const engine = useEngine(port);
  const { decks } = useDeckLibrary();
  const { status, info, game, send, decks: engineDecks, decksVersion, deckPreview } = engine;
  const [picking, setPicking] = useState<"language" | "skin" | "import" | "online" | null>(null);
  const [lastImported, setLastImported] = useState<string | undefined>();
  const [libraryRequest, setLibraryRequest] = useState<{ id: string; opponents: number; nonce: number } | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const step = useRef<"idle" | "preview" | "save" | "start">("idle");
  const savedAt = useRef(0);
  const language = info?.language ?? "en-US";
  const skin = info?.skin ?? DEFAULT_SKIN;
  const libraryDecks = useMemo(
    () => [...decks].sort((a, b) => a.name.localeCompare(b.name)).map((deck) => ({ id: deck.id, name: deck.name })),
    [decks],
  );
  const requested = decks.find((deck) => deck.id === libraryRequest?.id);
  const listText = useMemo(
    () => (requested ? exportDecklistText(requested.commanders, requested.cards, "arena", requested.sideboard ?? []) : ""),
    [requested],
  );
  const listName = requested ? forgeDeckName(requested.name) : "";
  const initialDeck = libraryDecks.some((deck) => deck.id === initialDeckId) ? `library:${initialDeckId}` : lastImported;

  useEffect(() => {
    step.current = "idle";
    savedAt.current = 0;
    setStatusNote(null);
  }, [libraryRequest?.nonce]);

  useEffect(() => {
    if (!libraryRequest || !requested || status !== "ready") return;
    if (step.current === "idle") {
      step.current = "preview";
      send({ type: "previewDeck", text: listText, name: listName });
      return;
    }
    if (step.current === "preview" && deckPreview) {
      const bits: string[] = [];
      if (deckPreview.unknown > 0) {
        const cards = deckPreview.unknown === 1 ? "card was" : "cards were";
        bits.push(`${deckPreview.unknown} ${cards} not recognized. The match can still start.`);
      }
      if (deckPreview.problem) bits.push(deckPreview.problem);
      setStatusNote(bits.join(" ") || null);
      step.current = "save";
      savedAt.current = decksVersion;
      send({ type: "saveDeck", text: listText, name: listName });
      return;
    }
    if (step.current === "save" && decksVersion > savedAt.current && engineDecks.mine.includes(listName)) {
      step.current = "start";
      send({
        type: "startMatch",
        deck: listName,
        deckSource: "mine",
        opponents: libraryRequest.opponents,
        aiProfiles: [],
      });
    }
  }, [libraryRequest, requested, status, deckPreview, decksVersion, engineDecks, listText, listName, send]);

  useEffect(() => {
    if (!game) return;
    step.current = "idle";
  }, [game]);

  let screen;
  if (status !== "ready") {
    screen = (
      <main className="home">
        <h1>RE:Forge</h1>
        {status === "connecting" ? <p className="muted">Connecting to the engine…</p> : <p className="error">Lost the connection to the engine.</p>}
      </main>
    );
  } else if (game) {
    screen = <Table engine={engine} game={game} />;
  } else if (engine.lobby || picking === "online") {
    screen = <Lobby engine={engine} onBack={() => setPicking(null)} />;
  } else if (!info?.language || picking === "language") {
    screen = <LanguagePicker engine={engine} onDone={() => setPicking(null)} />;
  } else if (!info?.skin || picking === "skin") {
    screen = <SkinPicker engine={engine} onDone={() => setPicking(null)} />;
  } else if (picking === "import") {
    screen = (
      <ImportDeck
        engine={engine}
        onDone={(saved) => {
          if (saved) setLastImported(saved);
          setPicking(null);
        }}
      />
    );
  } else {
    screen = (
      <Home
        key={initialDeck || "home"}
        engine={engine}
        onPick={setPicking}
        initialDeck={initialDeck}
        libraryDecks={libraryDecks}
        statusNote={statusNote}
        onPlayLibrary={(id, opponents) => setLibraryRequest({ id, opponents, nonce: Date.now() })}
      />
    );
  }

  return (
    <I18n.Provider value={translator(language)}>
      <div className={`reforge-root${game ? " fixed inset-0 z-50" : " play-screen"}`} data-skin={skin}>
        {screen}
      </div>
    </I18n.Provider>
  );
}
