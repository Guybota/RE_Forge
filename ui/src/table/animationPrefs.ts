// Local, per-device animation preferences (like the sound settings). Off by default for reduced motion.

export const ANIMATION_KINDS = ['cast', 'enter', 'ring', 'counters', 'equip', 'zones', 'dies', 'life', 'turn', 'coin'] as const;
export type AnimationKind = typeof ANIMATION_KINDS[number];
/** `speed` multiplies playback rate: 0.5 is twice as slow, 2 twice as fast. */
export type AnimationSettings = { enabled: boolean; speed: number; kinds: Record<AnimationKind, boolean> };

const STORAGE = 'reforge.animations';
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const allKinds = () => Object.fromEntries(ANIMATION_KINDS.map(k => [k, true])) as Record<AnimationKind, boolean>;

function load(): AnimationSettings {
  const fallback = { enabled: !reduced(), speed: 1, kinds: allKinds() };
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
    if (!value) return fallback;
    const kinds = allKinds();
    for (const k of ANIMATION_KINDS) if (typeof value.kinds?.[k] === 'boolean') kinds[k] = value.kinds[k];
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
      speed: typeof value.speed === 'number' && Number.isFinite(value.speed) ? Math.max(0.5, Math.min(2, value.speed)) : 1,
      kinds,
    };
  } catch { return fallback; }
}

let settings = load();
const listeners = new Set<() => void>();
export const getAnimationSettings = () => settings;
export const subscribeAnimationSettings = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setAnimationSettings(change: Partial<AnimationSettings>) {
  settings = { ...settings, ...change, kinds: { ...settings.kinds, ...change.kinds } };
  settings.speed = Number.isFinite(settings.speed) ? Math.max(0.5, Math.min(2, settings.speed)) : 1;
  try { localStorage.setItem(STORAGE, JSON.stringify(settings)); } catch { /* session only */ }
  listeners.forEach(listener => listener());
}
export const animationOn = (kind: AnimationKind) => settings.enabled && settings.kinds[kind];
