import { Fragment, type ReactNode } from 'react';
import { manaSymbols } from './table/cards';

/** Map a Forge/Scryfall brace code (e.g. T, W/U, 2/W) to a Mana font class suffix. */
export function manaClassOf(symbol: string): string {
  const s = symbol.trim();
  if (!s) return 'c';
  const special: Record<string, string> = {
    T: 'tap', Q: 'untap', E: 'e', S: 's', CHAOS: 'chaos',
    PW: 'loyalty-up', D: 'd', H: 'h', L: 'l',
    INFINITY: 'infinity', '∞': 'infinity',
  };
  if (special[s.toUpperCase()]) return special[s.toUpperCase()];
  if (special[s]) return special[s];
  // Half mana: HW, HR, …
  if (/^H[WUBRG]$/i.test(s)) return `${s.slice(1).toLowerCase()} ms-half`;
  // Hybrid / phyrexian / two-brid: W/U, 2/W, W/P, P/W, …
  if (s.includes('/')) return s.toLowerCase().replace(/\//g, '');
  return s.toLowerCase();
}

/** One mana or ability symbol as a Mana font glyph. */
export function ManaSymbol({ symbol, cost = false, className = '' }: {
  symbol: string;
  /** Casting-cost circle (and shadow). Off for tap/untap in running text unless asked. */
  cost?: boolean;
  className?: string;
}) {
  const code = manaClassOf(symbol);
  const asCost = cost || !/^(tap|untap|loyalty-|chaos|e|ticket)$/.test(code.split(' ')[0]);
  const classes = [
    'ms',
    ...code.split(/\s+/).map((c) => (c.startsWith('ms-') ? c : `ms-${c}`)),
    asCost ? 'ms-cost' : '',
    asCost ? 'ms-shadow' : '',
    className,
  ].filter(Boolean).join(' ');
  return <i className={classes} aria-hidden="true" title={`{${symbol}}`} />;
}

/** A mana cost row from Forge's "{2}{R}{R}" (or "2 R R") form. */
export function ManaCost({ cost, className = 'mana-cost' }: { cost?: string; className?: string }) {
  const symbols = manaSymbols(cost);
  if (!symbols.length) return null;
  return (
    <span className={className} aria-label={cost}>
      {symbols.map((s, i) => <ManaSymbol key={`${s}:${i}`} symbol={s} cost />)}
    </span>
  );
}

/** Replace `{T}`, `{W}`, … inside running rules text with Mana glyphs; keep line breaks. */
export function SymbolText({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        const m = /^\{([^}]+)\}$/.exec(part);
        if (m) return <ManaSymbol key={i} symbol={m[1]} />;
        return <TextChunk key={i} text={part} />;
      })}
    </span>
  );
}

function TextChunk({ text }: { text: string }): ReactNode {
  const lines = text.split('\n');
  if (lines.length === 1) return text;
  return lines.map((line, i) => (
    <Fragment key={i}>{i > 0 && <br />}{line}</Fragment>
  ));
}
