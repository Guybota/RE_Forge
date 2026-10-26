// Device-local reading preferences. Text scaling never changes viewport or card geometry.
export const TEXT_SCALES = [100, 125, 150, 200] as const;
export type TextScale = typeof TEXT_SCALES[number];
export type Density = 'compact' | 'comfortable';
export type AppearanceSettings = { textScale: TextScale; density: Density };

const STORAGE = 'reforge.appearance';
const DEFAULTS: AppearanceSettings = { textScale: 100, density: 'compact' };
const validScale = (value: unknown): value is TextScale => TEXT_SCALES.some(scale => scale === value);

function load(): AppearanceSettings {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
    return {
      textScale: validScale(value?.textScale) ? value.textScale : DEFAULTS.textScale,
      density: value?.density === 'comfortable' ? 'comfortable' : 'compact',
    };
  } catch { return { ...DEFAULTS }; }
}

let settings = load();
const listeners = new Set<() => void>();
export const getAppearanceSettings = () => settings;
export const subscribeAppearanceSettings = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function setAppearanceSettings(change: Partial<AppearanceSettings>) {
  settings = {
    textScale: validScale(change.textScale) ? change.textScale : settings.textScale,
    density: change.density === 'compact' || change.density === 'comfortable' ? change.density : settings.density,
  };
  try { localStorage.setItem(STORAGE, JSON.stringify(settings)); } catch { /* session only */ }
  listeners.forEach(listener => listener());
}

/** Called by App once; subscriptions also cover changes made in the in-game menu. */
export function installAppearanceSettings() {
  const apply = () => {
    document.documentElement.style.setProperty('--text-scale', String(settings.textScale / 100));
    document.documentElement.dataset.textScale = String(settings.textScale);
    document.documentElement.dataset.density = settings.density;
  };
  apply();
  return subscribeAppearanceSettings(apply);
}
