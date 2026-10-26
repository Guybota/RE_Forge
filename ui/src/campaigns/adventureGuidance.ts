import type { AdventureQuest } from '../engine';

export const QUEST_MARKERS = ['circle', 'diamond', 'square'] as const;
export type QuestMarker = typeof QUEST_MARKERS[number];
export function markerForQuest(quests: AdventureQuest[], id: string): QuestMarker {
  return QUEST_MARKERS[Math.max(0, quests.findIndex(q => q.id === id)) % QUEST_MARKERS.length];
}

/** A removed quest or another campaign's choice must never hide the remaining active objectives. */
export function trackedQuest(quests: AdventureQuest[], storedId: string | null): AdventureQuest | undefined {
  return quests.find(q => q.id === storedId) ?? quests[0];
}

/** Position a world target or an off-screen waypoint in camera-relative tile units. */
export function questWaypoint(dx: number, dy: number, halfWidth: number, halfHeight: number, lane = 0) {
  const hx = Math.max(0.5, halfWidth), hy = Math.max(0.5, halfHeight);
  if (Math.abs(dx) <= hx && Math.abs(dy) <= hy) return { x: dx, y: dy, offscreen: false, angle: 0 };
  const k = Math.min(hx / Math.abs(dx || 1e-6), hy / Math.abs(dy || 1e-6));
  const angle = Math.atan2(dy, dx), spacing = lane * 0.7;
  return {
    x: Math.max(-hx, Math.min(hx, dx * k - Math.sin(angle) * spacing)),
    y: Math.max(-hy, Math.min(hy, dy * k + Math.cos(angle) * spacing)),
    offscreen: true, angle,
  };
}
