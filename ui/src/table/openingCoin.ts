import type { ClientMessage, OpeningCoin } from '../engine';

/** Pin the timing once per toss; incoming snapshots never restart it. */
export function coinTiming(speed: number) {
  const rate = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1;
  return { spin: 1600 / rate, total: 2500 / rate };
}

/** Synchronous input gate: covers clicks, shortcuts and a choice arriving before React renders. */
export function createOpeningCoinGate() {
  const seen = new Set<number>();
  let current: OpeningCoin | null = null;
  return {
    receive(toss: OpeningCoin, enabled: boolean, visible: boolean) {
      if (seen.has(toss.gameId)) return null;
      seen.add(toss.gameId);
      if (!enabled || !visible) return null;
      current = toss;
      return toss;
    },
    blocks(message: ClientMessage) { return current !== null && (message.type === 'action' || message.type === 'answer'); },
    acceptsState(gameId: number | undefined) { return current === null || gameId === undefined || gameId === current.gameId; },
    finish(gameId: number) { if (current?.gameId !== gameId) return false; current = null; return true; },
    clear() { current = null; },
  };
}
