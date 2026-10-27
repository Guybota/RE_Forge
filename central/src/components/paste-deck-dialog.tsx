"use client";

import { useState } from "react";
import { resolveCommanderColors } from "@/lib/color-identity";
import { parseImportPaste } from "@/lib/import-formats";
import type { Deck, DeckCard } from "@/lib/types";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PasteDeckDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (deck: Omit<Deck, "id" | "createdAt" | "updatedAt" | "format">) => void;
}) {
  const [name, setName] = useState("");
  const [commander, setCommander] = useState("");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paste a list</DialogTitle>
          <DialogDescription>
            Best-effort import from Moxfield, Archidekt, MTG Arena, or plain{" "}
            <code className="text-xs">1 Sol Ring</code> lines. Commander and sideboard
            sections stay out of the 99. Color identity comes from the commander on Scryfall.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="paste-name">Deck name</Label>
            <Input
              id="paste-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Angels"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paste-cmd">Commander</Label>
            <Input
              id="paste-cmd"
              value={commander}
              onChange={(e) => setCommander(e.target.value)}
              placeholder="Giada, Font of Hope - or leave blank if the paste has a Commander section"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paste-list">Decklist</Label>
            <Textarea
              id="paste-list"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder={"Commander\n1 Giada, Font of Hope\n\nDeck\n1 Sol Ring\n\nSideboard\n1 Path to Exile"}
              className="font-mono text-sm"
            />
          </div>
          {errors.length > 0 && (
            <ul className="space-y-1 text-sm text-destructive">
              {errors.map((e) => (
                <li key={e.line}>
                  Line {e.line}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={saving}
            onClick={() => {
              void (async () => {
                const parsed = parseImportPaste(text, "auto");
                const typed = commander
                  .split("/")
                  .map((s) => s.trim())
                  .filter(Boolean);
                const commanderNames = typed.length
                  ? typed
                  : parsed.commanders.map((c) => c.name);
                if (
                  parsed.errors.length &&
                  parsed.cards.length === 0 &&
                  commanderNames.length === 0 &&
                  parsed.sideboard.length === 0
                ) {
                  setErrors(parsed.errors.map((e) => ({ line: e.line, message: e.message })));
                  return;
                }
                if (parsed.errors.length && parsed.cards.length === 0 && parsed.sideboard.length === 0) {
                  setErrors(parsed.errors.map((e) => ({ line: e.line, message: e.message })));
                  return;
                }
                setErrors([]);
                setSaving(true);
                const skip = new Set(commanderNames.map((n) => n.toLowerCase()));
                const cards: DeckCard[] = parsed.cards
                  .filter((c) => !skip.has(c.name.toLowerCase()))
                  .map((c) => ({
                    name: c.name,
                    quantity: c.quantity,
                    zone: "main",
                  }));
                const sideboard: DeckCard[] = parsed.sideboard
                  .filter((c) => !skip.has(c.name.toLowerCase()))
                  .map((c) => ({
                    name: c.name,
                    quantity: c.quantity,
                    zone: "sideboard",
                  }));
                const colorIdentity = await resolveCommanderColors(commanderNames);
                onCreate({
                  name: name.trim() || "Pasted deck",
                  commanders: commanderNames.map((n) => ({
                    name: n,
                    quantity: 1,
                    zone: "command" as const,
                  })),
                  cards,
                  sideboard,
                  colorIdentity,
                  source: "paste",
                });
                setSaving(false);
                setName("");
                setCommander("");
                setText("");
              })();
            }}
          >
            {saving ? "Saving…" : "Save deck"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
