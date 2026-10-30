// Runtime card changes stay distinguishable; face-down permanents remain interactive without revealing art.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { colorKey, groupCards } from '../ui/src/table/cards.ts';

const zombie = { id: 1, name: 'Zombie', imageKey: 't:zombie', typeEn: 'Creature — Zombie', power: 2, toughness: 2, token: true };
const copy = { ...zombie, id: 2 };
assert.equal(groupCards([zombie, copy], () => false).length, 1, 'identical tokens still fold');
for (const change of [
  { keywords: [{ id: 'FLYING', title: 'Flying', detail: '', reminder: 'Flying' }] },
  { typeEn: 'Artifact Creature — Zombie' }, { text: 'Cannot block.' }, { colors: 'R' },
  { gameText: 'Cannot block.' }, { phasedOut: true }, { chosenNumber: '2' },
]) assert.equal(groupCards([zombie, { ...copy, ...change }], () => false).length, 2,
  `permanents with different ${Object.keys(change)[0]} remain individually visible`);
assert.equal(groupCards([{ id: 1, hidden: true }, { id: 2, hidden: true }], () => false).length, 2,
  'unknown cards cannot be assumed interchangeable');
assert.equal(groupCards([{ id: 1, faceDown: true, power: 2, toughness: 2 }, { id: 2, faceDown: true, power: 2, toughness: 2 }], () => false).length, 2,
  'public face-down characteristics do not make two Morph cards interchangeable');
assert.equal(colorKey({ id: 1, cost: '{3}{R}', colors: 'C' }), 'C', 'devoid uses current color, not its mana cost');
assert.equal(colorKey({ id: 1, cost: '{2}', colors: 'WU' }), 'M', 'continuous effects can add colors');
assert.equal(colorKey({ id: 1, cost: '{2}{G}' }), 'G', 'old fixtures without colors retain a mana-cost fallback');

const server = await createServer({ root: fileURLToPath(new URL('../ui', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
try {
  const { Card } = await server.ssrLoadModule('/src/table/Card.tsx');
  const hidden = renderToStaticMarkup(createElement(Card, {
    card: { id: 91, hidden: true, tapped: true, power: 2, toughness: 2, counters: { P1P1: 1 } },
    size: 'field', onClick() {}, selectable: true, chosen: true, target: true,
  }));
  assert.match(hidden, /^<button/, 'a face-down permanent remains clickable');
  assert.match(hidden, /data-card-id="91"/, 'combat and targeting arrows can still locate it');
  for (const state of ['is-selectable', 'is-chosen', 'is-target', 'is-tapped']) assert.ok(hidden.includes(state));
  assert.match(hidden, /2\/2/, 'public face-down characteristics stay visible');
  assert.doesNotMatch(hidden, /<img/, 'interaction never reveals private art');
  const land = renderToStaticMarkup(createElement(Card, { card: {
    id: 33, name: 'Dark Depths', typeEn: 'Legendary Snow Land', counters: { ICE: 10 },
  }, size: 'land' }));
  assert.match(land, /card__counters/, 'land counters are visible without inspection');
  assert.match(land, /10/);
} finally { await server.close(); }
console.log('OK: current colors, distinct permanent states, interactive face-down cards and land counters');
