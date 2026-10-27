"use client";

import { useState } from "react";
import { resolveCommanderColors } from "@/lib/color-identity";
import type { Deck } from "@/lib/types";
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

export function NewDeckDialog({
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
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New deck</DialogTitle>
          <DialogDescription>
            Start empty, then paste or edit the list. Color identity is read from the commander.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-name">Name</Label>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-cmd">Commander</Label>
            <Input
              id="new-cmd"
              value={commander}
              onChange={(e) => setCommander(e.target.value)}
              placeholder="Giada, Font of Hope"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={saving}
            onClick={() => {
              void (async () => {
                setSaving(true);
                const names = commander
                  .split("/")
                  .map((s) => s.trim())
                  .filter(Boolean);
                const colorIdentity = await resolveCommanderColors(names);
                onCreate({
                  name: name.trim() || "Untitled deck",
                  commanders: names.map((n) => ({
                    name: n,
                    quantity: 1,
                    zone: "command" as const,
                  })),
                  cards: [],
                  colorIdentity,
                  source: "manual",
                });
                setSaving(false);
                setName("");
                setCommander("");
              })();
            }}
          >
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
