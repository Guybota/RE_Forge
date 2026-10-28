// Improve (ported from Central) in Portuguese: every English sentence the modules can show has a translation with
// the same placeholders, and a real plan run in Portuguese comes out without English sentences.
// Run with: npm run ui:smoke-improve
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDeckToolsLanguage, say } from '../ui/src/deckTools/say.ts';
import { bracketAdjustments, buildGamePlans, readDeck, roomCutSuggestions } from '../ui/src/deckTools/improve-plans.ts';
import { deckPlans } from '../ui/src/deckTools/improve-adapt.ts';
import { suggestionsFromReference } from '../ui/src/deckTools/improve-diff.ts';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../ui/src/deckTools');
const pt = JSON.parse(readFileSync(path.join(dir, 'pt.json'), 'utf8'));
const cardNames = new Set(Object.keys(JSON.parse(readFileSync(path.join(dir, 'card-tags.json'), 'utf8')))
  .flatMap((n) => [n, ...n.split(' // ')]).map((n) => n.toLowerCase()));
// Card names used as titles or keys that card-tags.json does not list (banned in Commander, or titles).
const untranslated = new Set(['erebos, god of the dead', 'force of will', 'mana crypt', 'pillory of the sleepless']);
const unescape = (s) => JSON.parse(`"${s}"`);

/** The string literals passed straight to say(...), including both sides of a ternary. */
function sayArguments(source) {
  const out = [];
  for (let i = source.indexOf('say('); i >= 0; i = source.indexOf('say(', i + 4)) {
    let depth = 0;
    for (let j = i + 3; j < source.length; j++) {
      const c = source[j];
      if (c === '"') {
        let k = j + 1;
        while (source[k] !== '"') k += source[k] === '\\' ? 2 : 1;
        if (depth === 1) out.push(unescape(source.slice(j + 1, k)));
        j = k;
      } else if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') { if (--depth === 0) break; }
    }
  }
  return out;
}

const keys = new Set();
for (const f of ['improve-plans.ts', 'improve-adapt.ts', 'improve-diff.ts', 'say.ts']) {
  const source = readFileSync(path.join(dir, f), 'utf8');
  for (const m of source.matchAll(/"((?:[^"\\]|\\.)*)"/g)) if (/[A-Za-z]{2,} [a-z]{2,}/.test(m[1])) keys.add(unescape(m[1]));
  for (const m of source.matchAll(/(?:thread|title):\s*"([^"]+)"/g)) keys.add(m[1]);
  for (const m of source.matchAll(/threads\.push\("([^"]+)"\)/g)) keys.add(m[1]);
  for (const m of source.matchAll(/'(\{[a-z]+\}[^']*)'/g)) keys.add(m[1]);
  for (const k of sayArguments(source)) keys.add(k);
}
const placeholders = (s) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
const missing = [...keys].filter((k) => !(k in pt) && !cardNames.has(k.toLowerCase()) && !untranslated.has(k.toLowerCase()));
assert.deepEqual(missing, [], 'every sentence has a Portuguese translation');
for (const [en, text] of Object.entries(pt)) {
  const allowed = placeholders(en);
  for (const p of placeholders(text)) assert.ok(allowed.has(p), `{${p}} is not in "${en}"`);
}

// A real list through every Improve entry point, in Portuguese.
const deck = {
  id: 'd', name: 'Teste', format: 'commander', createdAt: '', updatedAt: '', colorIdentity: ['W'],
  commanders: [{ name: 'Giada, Font of Hope', quantity: 1 }],
  cards: [
    'Sol Ring', 'Arcane Signet', 'Mind Stone', 'Thought Vessel', 'Swords to Plowshares', 'Oblivion Ring', 'Journey to Nowhere',
    'Righteous Valkyrie', 'Resplendent Angel', 'Bishop of Wings', 'Lyra Dawnbringer', 'Serra Angel', 'Baneslayer Angel',
    'Angel of Vitality', 'Linvala, Keeper of Silence', 'Herald of Faith', 'Soul Warden', "Ajani's Pridemate", 'Rhox Faithmender',
    'Smothering Tithe', 'Rhystic Study', 'Court of Grace', 'Wrath of God', 'Path to Exile',
  ].map((name) => ({ name, quantity: 1 })).concat([{ name: 'Plains', quantity: 30 }]),
};
setDeckToolsLanguage(pt);
const texts = [];
const reading = readDeck(deck);
texts.push(reading.body, ...reading.threads);
for (const plan of buildGamePlans(deck).plans) {
  texts.push(say(plan.title), say(plan.summary), say(plan.play), ...plan.suggestions.flatMap((s) => [say(s.reason), say(s.title ?? '')]));
}
for (const target of [1, 2, 3, 4, 5]) {
  const adjust = bracketAdjustments(deck, deckPlans(deck)[0]?.id ?? '', target);
  texts.push(...[...adjust.toward, ...adjust.plan].flatMap((s) => [say(s.reason), say(s.title ?? '')]));
}
texts.push(...roomCutSuggestions(deck, new Set()).map((s) => say(s.reason)));
texts.push(...suggestionsFromReference(deck, [{ name: 'Teferi\'s Protection', quantity: 1 }]).map((s) => say(s.reason)));
texts.push(...deckPlans(deck).map((p) => say(p.title)));
setDeckToolsLanguage(null);
assert.ok(texts.length > 30, `enough text to check (${texts.length})`);
// Card names stay English; English grammar words outside them mean an untranslated sentence.
const english = texts.filter(Boolean).filter((t) => / (the|does|this|that|with|for|and|is) /.test(
  t.replace(/[A-Z][\w'’,-]*(?: (?:(?:of|the|to|and|from|in) )*[A-Z][\w'’,-]*)*/g, '')));
assert.deepEqual(english, [], 'no English sentence left in the Portuguese output');
assert.equal(say('{a} and {b}', { a: 'A', b: 'B' }), 'A and B', 'English again after switching back');
console.log(`OK: ${Object.keys(pt).length} translations, placeholders match, ${texts.length} Improve texts in Portuguese`);
