// Reading preferences: validate saved data and apply text/density without changing viewport geometry.
import assert from 'node:assert/strict';

const storage = new Map([['reforge.appearance', '{broken']]);
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
const styles = new Map();
globalThis.document = { documentElement: { dataset: {}, style: { setProperty: (key, value) => styles.set(key, value) } } };

const prefs = await import('../ui/src/settings/appearancePrefs.ts');
assert.deepEqual(prefs.getAppearanceSettings(), { textScale: 100, density: 'compact' }, 'corrupt preferences use readable defaults');
const cleanup = prefs.installAppearanceSettings();
assert.equal(styles.get('--text-scale'), '1');
assert.deepEqual(document.documentElement.dataset, { textScale: '100', density: 'compact' });
let changes = 0;
const unsubscribe = prefs.subscribeAppearanceSettings(() => changes++);
for (const textScale of prefs.TEXT_SCALES) {
  prefs.setAppearanceSettings({ textScale, density: 'comfortable' });
  assert.equal(document.documentElement.dataset.textScale, String(textScale));
  assert.equal(styles.get('--text-scale'), String(textScale / 100));
  assert.equal(document.documentElement.dataset.density, 'comfortable');
}
assert.equal(changes, 4);
assert.deepEqual(JSON.parse(storage.get('reforge.appearance')), { textScale: 200, density: 'comfortable' });
prefs.setAppearanceSettings({ textScale: 999, density: 'invalid' });
assert.deepEqual(prefs.getAppearanceSettings(), { textScale: 200, density: 'comfortable' }, 'unknown values never become CSS or class names');
unsubscribe(); cleanup();
prefs.setAppearanceSettings({ textScale: 125, density: 'compact' });
assert.equal(changes, 5, 'unsubscription removes the listener');
assert.equal(document.documentElement.dataset.textScale, '200', 'unmount removes DOM writes');
const cleanupAgain = prefs.installAppearanceSettings();
assert.equal(document.documentElement.dataset.textScale, '125', 'remount applies the latest settings');
cleanupAgain();

storage.set('reforge.appearance', JSON.stringify({ textScale: 150, density: 'comfortable' }));
const restored = await import('../ui/src/settings/appearancePrefs.ts?restore');
assert.deepEqual(restored.getAppearanceSettings(), { textScale: 150, density: 'comfortable' }, 'settings restore after a reload');
storage.set('reforge.appearance', JSON.stringify({ textScale: 0.5, density: [] }));
const invalid = await import('../ui/src/settings/appearancePrefs.ts?invalid');
assert.deepEqual(invalid.getAppearanceSettings(), { textScale: 100, density: 'compact' });
globalThis.localStorage = { getItem() { throw new Error('Storage blocked'); }, setItem() { throw new Error('Storage blocked'); } };
const unavailable = await import('../ui/src/settings/appearancePrefs.ts?blocked');
assert.doesNotThrow(() => unavailable.setAppearanceSettings({ textScale: 200 }));
assert.equal(unavailable.getAppearanceSettings().textScale, 200, 'blocked storage keeps the session usable');
assert.deepEqual([...styles.keys()], ['--text-scale'], 'the DOM adapter never applies zoom or transforms');
console.log('OK: text scale choices, density, persistence, corrupt/invalid/blocked storage and remount cleanup');
