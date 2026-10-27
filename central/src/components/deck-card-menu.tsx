"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
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
import { formatEur } from "@/lib/prices";
import { partnerEligibility } from "@/lib/partner";
import {
  applyPrintingVisual,
  cardmarketSearchUrl,
  fetchCardRulings,
  fetchPrintings,
  resolvePrintingById,
  type CardVisual,
  type PrintingOption,
  type ScryfallRuling,
} from "@/lib/scryfall";
import type { DeckCard } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DeckCardMenuActions = {
  onChangePrinting: (card: DeckCard, printing: { scryfallId: string; setCode: string }) => void;
  onRemove: (card: DeckCard) => void;
  onRemoveAsCommander: (card: DeckCard) => void;
  onAddOne: (card: DeckCard) => void;
  onAddMore: (card: DeckCard, qty: number) => void;
  onMoveToSideboard: (card: DeckCard) => void;
  onReplaceCommander: (card: DeckCard) => void;
  onSetPartnerCommander: (card: DeckCard) => void;
};

type MenuPos = { x: number; y: number };

export function DeckCardMenu({
  card,
  visual,
  isCommander,
  actions,
  className,
  surfaceRef,
}: {
  card: DeckCard;
  visual?: CardVisual;
  isCommander: boolean;
  actions: DeckCardMenuActions;
  className?: string;
  surfaceRef?: React.RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos>({ x: 0, y: 0 });
  const [infoOpen, setInfoOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [addMoreOpen, setAddMoreOpen] = useState(false);
  const [addMoreQty, setAddMoreQty] = useState("1");
  const [confirmClearCmd, setConfirmClearCmd] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const partner = partnerEligibility(visual);

  const openAt = (x: number, y: number) => {
    const pad = 8;
    const menuW = 280;
    const menuH = isCommander ? 280 : 420;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + menuW > vw - pad) left = vw - menuW - pad;
    if (top + menuH > vh - pad) top = vh - menuH - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ x: left, y: top });
    setOpen(true);
  };

  useEffect(() => {
    const el = surfaceRef?.current;
    if (!el) return;
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openAt(e.clientX, e.clientY);
    };
    el.addEventListener("contextmenu", onCtx);
    return () => el.removeEventListener("contextmenu", onCtx);
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setOpen(false);
        setPrintOpen(true);
      } else if (k === "n") {
        e.preventDefault();
        void navigator.clipboard?.writeText(card.name);
        setOpen(false);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        actions.onRemove(card);
        setOpen(false);
      } else if (k === "i") {
        e.preventDefault();
        setOpen(false);
        setInfoOpen(true);
      } else if (isCommander && k === "d") {
        e.preventDefault();
        setOpen(false);
        setConfirmClearCmd(true);
      } else if (!isCommander && (k === "+" || e.key === "=")) {
        e.preventDefault();
        actions.onAddOne(card);
        setOpen(false);
      } else if (!isCommander && k === "s") {
        e.preventDefault();
        actions.onMoveToSideboard(card);
        setOpen(false);
      } else if (!isCommander && k === "c") {
        e.preventDefault();
        actions.onReplaceCommander(card);
        setOpen(false);
      }
    };
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      const t = e.target as Element | null;
      if (t?.closest?.('[data-testid="deck-card-menu"], [data-testid="commander-card-menu"]')) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open, card, actions, isCommander]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "absolute right-1.5 top-1.5 z-20 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        open && "opacity-100",
        className,
      )}
      data-card-menu={isCommander ? "commander" : "main"}
    >
      <Button
        type="button"
        size="icon-sm"
        variant="secondary"
        data-card-menu-trigger="true"
        className="size-7 bg-black/55 text-foreground shadow-md backdrop-blur hover:bg-black/75"
        aria-label={`Card menu for ${card.name}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openAt(r.right - 8, r.bottom + 4);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openAt(e.clientX, e.clientY);
        }}
      >
        <MoreHorizontal className="size-4" />
      </Button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <ul
            role="menu"
            className="fixed z-[200] min-w-[260px] max-w-[300px] overflow-hidden rounded-xl border border-border/60 bg-popover py-1 text-sm text-popover-foreground shadow-2xl shadow-black/60 ring-1 ring-white/10"
            style={{ left: pos.x, top: pos.y }}
            data-testid={isCommander ? "commander-card-menu" : "deck-card-menu"}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <MenuItem
              label="Change printing"
              shortcut="P"
              onClick={() => {
                setOpen(false);
                setPrintOpen(true);
              }}
            />
            <MenuItem
              label="Copy card name"
              shortcut="N"
              onClick={() => {
                void navigator.clipboard?.writeText(card.name);
                setOpen(false);
              }}
            />

            {isCommander ? (
              <>
                <MenuItem
                  label="Remove"
                  shortcut="Del"
                  destructive
                  onClick={() => {
                    actions.onRemove(card);
                    setOpen(false);
                  }}
                />
                <MenuItem
                  label="Remove as commander"
                  shortcut="D"
                  onClick={() => {
                    setOpen(false);
                    setConfirmClearCmd(true);
                  }}
                />
              </>
            ) : (
              <>
                <MenuItem
                  label="Add one"
                  shortcut="+"
                  onClick={() => {
                    actions.onAddOne(card);
                    setOpen(false);
                  }}
                />
                <MenuItem
                  label="Add more"
                  onClick={() => {
                    setOpen(false);
                    setAddMoreQty("1");
                    setAddMoreOpen(true);
                  }}
                />
                <MenuItem
                  label="Remove"
                  shortcut="Del"
                  destructive
                  onClick={() => {
                    actions.onRemove(card);
                    setOpen(false);
                  }}
                />
                <MenuItem
                  label="Move to sideboard"
                  shortcut="S"
                  onClick={() => {
                    actions.onMoveToSideboard(card);
                    setOpen(false);
                  }}
                />
                <MenuItem
                  label="Replace commander"
                  shortcut="C"
                  onClick={() => {
                    actions.onReplaceCommander(card);
                    setOpen(false);
                  }}
                />
                <MenuItem
                  label="Set as partner commander"
                  disabled={!partner.ok}
                  hint={!partner.ok ? partner.reason : undefined}
                  onClick={() => {
                    if (!partner.ok) return;
                    actions.onSetPartnerCommander(card);
                    setOpen(false);
                  }}
                />
              </>
            )}

            <MenuItem
              label="View information"
              shortcut="I"
              onClick={() => {
                setOpen(false);
                setInfoOpen(true);
              }}
            />
            <li role="none" className="my-1 border-t border-border/50" />
            <li role="none">
              <a
                role="menuitem"
                href={cardmarketSearchUrl(card.name)}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-white/5"
                onClick={() => setOpen(false)}
              >
                <span>Buy on Cardmarket</span>
              </a>
            </li>
          </ul>,
          document.body,
        )}

      <PrintingDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        card={card}
        onPick={(p) => {
          actions.onChangePrinting(card, { scryfallId: p.scryfallId, setCode: p.setCode });
          setPrintOpen(false);
        }}
      />

      <InfoDialog open={infoOpen} onOpenChange={setInfoOpen} name={card.name} visual={visual} />

      <Dialog open={addMoreOpen} onOpenChange={setAddMoreOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add more copies</DialogTitle>
            <DialogDescription>How many {card.name} to add to the main deck?</DialogDescription>
          </DialogHeader>
          <Input
            type="number"
            min={1}
            max={99}
            value={addMoreQty}
            onChange={(e) => setAddMoreQty(e.target.value)}
          />
          <DialogFooter>
            <Button
              onClick={() => {
                const n = Math.max(1, Math.min(99, Number.parseInt(addMoreQty, 10) || 1));
                actions.onAddMore(card, n);
                setAddMoreOpen(false);
              }}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClearCmd} onOpenChange={setConfirmClearCmd}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove as commander?</DialogTitle>
            <DialogDescription>
              {card.name} moves into the 99 and the command zone clears for this slot. If this is
              the only commander, the deck will have no commander until you set another.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClearCmd(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                actions.onRemoveAsCommander(card);
                setConfirmClearCmd(false);
              }}
            >
              Remove as commander
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MenuItem({
  label,
  shortcut,
  onClick,
  destructive,
  disabled,
  hint,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        title={hint}
        className={cn(
          "flex w-full flex-col items-stretch px-3 py-2 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent",
          destructive && !disabled && "text-rose hover:bg-rose/10",
        )}
        onClick={onClick}
      >
        <span className="flex items-center justify-between gap-4">
          <span>{label}</span>
          {shortcut && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {shortcut}
            </span>
          )}
        </span>
        {disabled && hint && (
          <span className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{hint}</span>
        )}
      </button>
    </li>
  );
}

function PrintingDialog({
  open,
  onOpenChange,
  card,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  card: DeckCard;
  onPick: (p: PrintingOption) => void;
}) {
  const [rows, setRows] = useState<PrintingOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows(null);
    fetchPrintings(card.name).then((list) => {
      if (cancelled) return;
      setRows(list);
      setLoading(false);
      if (list.length === 0) setError("No printings found on Scryfall.");
    });
    return () => {
      cancelled = true;
    };
  }, [open, card.name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change printing</DialogTitle>
          <DialogDescription>
            Pick a Scryfall printing for {card.name}. Art and set update on this deck.
          </DialogDescription>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Loading printings…</p>}
        {error && <p className="text-sm text-rose">{error}</p>}
        {rows && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {rows.map((p) => (
              <li key={p.scryfallId}>
                <button
                  type="button"
                  className={cn(
                    "w-full overflow-hidden rounded-lg ring-1 ring-white/10 transition hover:ring-primary/50",
                    card.scryfallId === p.scryfallId && "ring-2 ring-primary",
                  )}
                  onClick={async () => {
                    const visual = await resolvePrintingById(p.scryfallId, card.name);
                    if (visual) applyPrintingVisual(card.name, visual);
                    onPick(p);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {(p.normal || p.large) && (
                    <img
                      src={p.normal ?? p.large}
                      alt={`${card.name} (${p.setCode})`}
                      className="aspect-[5/7] w-full object-cover"
                    />
                  )}
                  <span className="block px-1 py-1 text-[10px] font-medium">
                    {p.setCode}
                    {p.eur != null ? ` · €${p.eur.toFixed(2)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InfoDialog({
  open,
  onOpenChange,
  name,
  visual,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  name: string;
  visual?: CardVisual;
}) {
  const [rulings, setRulings] = useState<ScryfallRuling[] | null>(null);
  const [rulingsNote, setRulingsNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRulings(null);
    setRulingsNote("Loading rulings…");
    fetchCardRulings(visual?.scryfallId ?? name).then((r) => {
      if (cancelled) return;
      setRulings(r.rulings);
      setRulingsNote(r.error ?? (r.rulings.length === 0 ? "No published rulings." : null));
    });
    return () => {
      cancelled = true;
    };
  }, [open, name, visual?.scryfallId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>{visual?.typeLine ?? "Card information"}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-4">
          <CardImage
            name={name}
            visual={visual}
            size="hero"
            prefer="normal"
            rounded="lg"
            className="w-[110px] shrink-0"
          />
          <div className="min-w-0 space-y-2 text-sm">
            <p className="whitespace-pre-wrap text-muted-foreground">
              {visual?.oracleText ?? "Oracle text unavailable."}
            </p>
            <p className="text-xs">
              Cardmarket EUR:{" "}
              <span className="font-medium text-foreground">
                {visual?.eur === undefined ? "…" : formatEur(visual.eur)}
              </span>
              {visual?.setCode ? ` · ${visual.setCode}` : ""}
            </p>
          </div>
        </div>
        <div>
          <h3 className="text-sm font-medium">Published rulings</h3>
          {rulingsNote && !rulings?.length && (
            <p className="mt-1 text-xs text-muted-foreground">{rulingsNote}</p>
          )}
          {rulings && rulings.length > 0 && (
            <ul className="mt-2 space-y-2">
              {rulings.map((r, i) => (
                <li
                  key={`${r.publishedAt}-${i}`}
                  className="rounded-lg border border-border/40 p-2 text-xs"
                >
                  <p className="text-[10px] uppercase text-muted-foreground">
                    {r.publishedAt || "Undated"}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">{r.comment}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
