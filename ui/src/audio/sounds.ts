import type { SoundEffect } from './gameSounds';

export type SoundSettings = { enabled: boolean; volume: number };
const STORAGE = 'reforge.sound';
const DEFAULT: SoundSettings = { enabled: true, volume: 0.4 };
function load(): SoundSettings {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
    return {
      enabled: typeof value?.enabled === 'boolean' ? value.enabled : DEFAULT.enabled,
      volume: typeof value?.volume === 'number' && Number.isFinite(value.volume)
        ? Math.max(0, Math.min(1, value.volume)) : DEFAULT.volume,
    };
  } catch { return DEFAULT; }
}
let settings = load();
const listeners = new Set<() => void>();
export const getSoundSettings = () => settings;
export const subscribeSoundSettings = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function setSoundSettings(change: Partial<SoundSettings>) {
  settings = { ...settings, ...change };
  settings.volume = Number.isFinite(settings.volume) ? Math.max(0, Math.min(1, settings.volume)) : DEFAULT.volume;
  try { localStorage.setItem(STORAGE, JSON.stringify(settings)); } catch { /* session only */ }
  if (master && context) master.gain.setTargetAtTime(settings.enabled ? settings.volume : 0, context.currentTime, 0.015);
  listeners.forEach(listener => listener());
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<SoundEffect, AudioBuffer>();
const lastPlayed = new Map<SoundEffect, number>();
const voices = new Set<AudioBufferSourceNode>();
let unlocked = false;

/** Audio is created/resumed only from a trusted gesture; no queued sounds on resume. */
export function unlockSounds() {
  if (!settings.enabled || settings.volume === 0) return;
  try {
    if (!context || context.state === 'closed') {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = settings.volume;
      master.connect(context.destination);
      buffers.clear();
      lastPlayed.clear();
      voices.clear();
    }
    unlocked = true;
    if (context.state === 'suspended') void context.resume().catch(() => {});
  } catch { /* Audio is optional, including on devices without an output. */ }
}

// Original, short synthesized effects: paper, soft impact and restrained musical cues.
// A fixed noise seed keeps each effect consistent without shipping media or making network requests.
function makeBuffer(kind: SoundEffect, ctx: AudioContext): AudioBuffer {
  const length = { click: 0.035, card: 0.17, attack: 0.24, turn: 0.42, phase: 0.09 }[kind];
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 2471, filtered = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / ctx.sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = seed / 2147483648;
    filtered += 0.15 * (noise - filtered);
    const fade = Math.min(1, t / 0.004) * Math.min(1, (length - t) / 0.012);
    let value = 0;
    if (kind === 'click') value = (Math.sin(2 * Math.PI * 780 * t) * 0.12 + filtered * 0.22) * Math.exp(-100 * t);
    if (kind === 'card') value = filtered * 0.65 * Math.sin(Math.PI * t / length) + Math.sin(2 * Math.PI * 140 * t) * 0.12 * Math.exp(-35 * t);
    if (kind === 'attack') value = filtered * 0.55 * Math.sin(Math.PI * t / length) + Math.sin(2 * Math.PI * (130 * t - 130 * t * t)) * 0.28 * Math.exp(-15 * t);
    if (kind === 'turn') {
      value = Math.sin(2 * Math.PI * 440 * t) * 0.15 * Math.exp(-9 * t);
      if (t >= 0.11) value += Math.sin(2 * Math.PI * 660 * (t - 0.11)) * 0.13 * Math.min(1, (t - 0.11) / 0.008) * Math.exp(-10 * (t - 0.11));
    }
    if (kind === 'phase') value = Math.sin(2 * Math.PI * 540 * t) * 0.09 * Math.exp(-40 * t);
    samples[i] = value * fade;
  }
  return buffer;
}

export function playSound(kind: SoundEffect) {
  if (!settings.enabled || settings.volume === 0 || !unlocked || !context || context.state !== 'running' || !master || document.hidden) return;
  const now = context.currentTime;
  if (now - (lastPlayed.get(kind) ?? -Infinity) < 0.075 || voices.size >= 12) return;
  try {
    let buffer = buffers.get(kind);
    if (!buffer) { buffer = makeBuffer(kind, context); buffers.set(kind, buffer); }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.onended = () => { voices.delete(source); source.disconnect(); };
    voices.add(source);
    lastPlayed.set(kind, now);
    source.start();
  } catch { /* A failed audio device must never interrupt input or a game. */ }
}

export function installClickSounds() {
  const unlock = (event: Event) => { if (event.isTrusted) unlockSounds(); };
  const click = (event: MouseEvent) => {
    if (!event.isTrusted || event.defaultPrevented || !(event.target instanceof Element)) return;
    const target = event.target.closest('button, a[href], input[type="checkbox"], input[type="radio"], summary');
    if (!target || target.matches(':disabled, [aria-disabled="true"]')) return;
    unlockSounds();
    playSound('click');
  };
  const hide = () => {
    if (document.hidden) {
      voices.forEach(source => { try { source.stop(); } catch { /* already ended */ } });
    }
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  document.addEventListener('click', click);
  document.addEventListener('visibilitychange', hide);
  return () => {
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    document.removeEventListener('click', click);
    document.removeEventListener('visibilitychange', hide);
  };
}
