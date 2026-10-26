// Regressions in the actual skin colour pairs used for focus, actions and damage text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui/src/index.css', import.meta.url), 'utf8');
const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
  .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const skins = [...css.matchAll(/\[data-skin='(\w+)'\]\s*\{([^}]+)\}/g)];
assert.deepEqual(skins.map(s => s[1]), ['mesa', 'editorial', 'retro', 'terminal']);
for (const [, name, block] of skins) {
  const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map(m => [m[1], m[2]]));
  const pairs = [
    ['focus-table', 'table', 3], ['focus-panel', 'panel', 3], ['focus-panel', 'panel-raised', 3],
    ['chosen', 'table', 3], ['playable', 'table', 3], ['damage-ink', 'card-ink', 4.5],
  ];
  for (const [foreground, background, minimum] of pairs) {
    assert.ok(tokens[foreground] && tokens[background], `${name}: missing ${foreground}/${background}`);
    const measured = ratio(tokens[foreground], tokens[background]);
    assert.ok(measured >= minimum, `${name}: ${foreground}/${background} is ${measured.toFixed(2)}:1, expected ${minimum}:1`);
  }
}
console.log('OK: four skins; focus on table/paper/raised surfaces, available/selected outlines and damage text contrast');
