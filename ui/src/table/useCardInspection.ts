import { useContext, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { CardState } from '../engine';
import { useT } from '../i18n';
import { CardZoom } from './CardZoom';
const HOLD_MS = 450;
const MOVE_LIMIT = 10;
const textField = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"]');

/** Catalog colour identities are numeric; copy display fields (and nameEn for the rich inspect modal). */
export function cardForInspection(card: {
  name?: string; nameEn?: string; imageKey?: string; imageUrl?: string; cost?: string; type?: string; typeEn?: string;
  text?: string; textEn?: string; set?: string; number?: string; commanderLegal?: boolean; canCommand?: boolean;
  deckName?: string; deckSource?: 'mine' | 'precon';
}): CardState {
  return {
    id: -1,
    name: card.name,
    nameEn: card.nameEn,
    imageKey: card.imageKey,
    imageUrl: card.imageUrl,
    cost: card.cost,
    type: card.type,
    typeEn: card.typeEn,
    text: card.text,
    textEn: card.textEn,
    set: card.set,
    number: card.number,
    commanderLegal: card.commanderLegal,
    canCommand: card.canCommand,
    deckName: card.deckName,
    deckSource: card.deckSource,
  };
}

/** Gestures shared by the table, catalog, deck lists and shops. Never calls the card's primary action. */
export function useCardInspection(card: CardState | null | undefined) {
  const zoom = useContext(CardZoom);
  const t = useT();
  const press = useRef<{ timer: number; x: number; y: number; pointer: number } | null>(null);
  const releaseGuard = useRef<(() => void) | null>(null);
  const clearPress = () => { if (press.current) window.clearTimeout(press.current.timer); press.current = null; };
  useEffect(() => () => { clearPress(); releaseGuard.current?.(); }, []);
  // A held touch can end on the newly opened modal. Swallow its trailing click wherever it lands,
  // but remove the guard on the next intentional pointer/key gesture so closing never needs two taps.
  const guardRelease = () => {
    releaseGuard.current?.();
    let expiry: number | undefined;
    const remove = () => {
      window.clearTimeout(expiry);
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('contextmenu', swallow, true);
      window.removeEventListener('pointerdown', remove, true);
      window.removeEventListener('keydown', remove, true);
      window.removeEventListener('pointerup', released, true);
      window.removeEventListener('pointercancel', released, true);
      releaseGuard.current = null;
    };
    const swallow = (e: MouseEvent) => { e.preventDefault(); e.stopImmediatePropagation(); if (e.type === 'click') remove(); };
    const released = () => { window.clearTimeout(expiry); expiry = window.setTimeout(remove, 1500); };
    window.addEventListener('click', swallow, true);
    window.addEventListener('contextmenu', swallow, true);
    window.addEventListener('pointerdown', remove, true);
    window.addEventListener('keydown', remove, true);
    window.addEventListener('pointerup', released, true);
    window.addEventListener('pointercancel', released, true);
    releaseGuard.current = remove;
  };
  const inspect = (source: HTMLElement) => {
    if (!card || card.hidden) return;
    source.focus({ preventScroll: true });
    zoom(card);
  };
  return {
    'aria-description': t('inspectCardHint'),
    'aria-keyshortcuts': 'i Shift+F10',
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      if (!card || card.hidden || textField(e.target)) return;
      e.preventDefault(); e.stopPropagation(); clearPress(); inspect(e.currentTarget);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (!card || card.hidden || textField(e.target) || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (e.key.toLowerCase() === 'i' || e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) {
        e.preventDefault(); e.stopPropagation(); clearPress(); inspect(e.currentTarget);
      }
    },
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      clearPress();
      if (!card || card.hidden || e.pointerType !== 'touch' || !e.isPrimary || textField(e.target)) return;
      // A shop/list's own controls keep their normal behaviour; hold the art or name to inspect.
      const control = e.target instanceof Element && e.target.closest('button, a, input, select, textarea');
      if (control && control !== e.currentTarget) return;
      const source = e.currentTarget;
      press.current = { x: e.clientX, y: e.clientY, pointer: e.pointerId, timer: window.setTimeout(() => {
        press.current = null; guardRelease(); inspect(source);
      }, HOLD_MS) };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const p = press.current;
      if (p && (p.pointer !== e.pointerId || Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_LIMIT)) clearPress();
    },
    onPointerUp: clearPress,
    onPointerCancel: clearPress,
    onPointerLeave: clearPress,
  };
}
