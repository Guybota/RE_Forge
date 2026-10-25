import assert from 'node:assert/strict';
import { deckStatistics, drawProbability, matchesDeckFilter, replacePrinting, decklist } from '../ui/src/deckAnalysis.ts';

const card = (name, extra = {}) => ({ nameEn: name, name, cmc: 0, cost: '', group: 'land', colors: 0,
  manaProduction: 0, manaSymbols: [0, 0, 0, 0, 0, 0], qty: 1, commander: false, identity: 0, ...extra });
const cards = [
  card('Commander', { commander: true, identity: 3, colors: 3, group: 'creature', cmc: 5, manaSymbols: [1, 1, 0, 0, 0, 0] }),
  card('Plains', { qty: 3, manaProduction: 1 }),
  card('Dual', { manaProduction: 3 }),
  card('Tower', { commanderMana: true }),
  card('Wastes', { manaProduction: 32 }),
  card('Hybrid', { group: 'creature', colors: 3, cmc: 2, qty: 2, manaSymbols: [1, 1, 0, 0, 0, 0] }),
  card('Instant', { group: 'instant', colors: 2, cmc: 2, manaSymbols: [0, 1, 0, 0, 0, 0] }),
  card('Big', { group: 'artifact', colors: 0, cmc: 8, manaSymbols: [0, 0, 0, 0, 0, 1] }),
];
const stats = deckStatistics(cards);
assert.equal(stats.count, 10);
assert.equal(stats.landCount, 6);
assert.equal(stats.spellCount, 4);
assert.equal(stats.totalMana, 14);
assert.equal(stats.average, 3.5);
assert.equal(stats.averageWithLands, 1.4);
assert.equal(stats.median, 2);
assert.deepEqual(stats.curve[2], { value: 2, permanents: 2, spells: 1, total: 3 });
assert.equal(stats.curve[7].total, 1);
assert.equal(stats.colors[0].sources, 5, 'basics, dual and command tower count as white sources');
assert.equal(stats.colors[1].sources, 2);
assert.equal(stats.colors[5].sources, 1, 'colorless production differs from colorless cards');
assert.equal(stats.colors[5].cards, 1);
assert.equal(stats.colors[0].symbols, 2, 'hybrid and quantities count');
assert.equal(stats.colors[1].symbols, 3);
assert.equal(stats.symbolCount, 6);
assert.equal(deckStatistics(cards, true).count, 11);
assert.equal(deckStatistics(cards, true).totalMana, 19);
assert.equal(deckStatistics([card('Only spell', { group: 'sorcery', cmc: 2 })]).landCount, 0);
assert.equal(deckStatistics([]).average, 0);
assert.equal(deckStatistics([]).median, 0);
assert.equal(deckStatistics(cards.filter(c => !c.commander)).colors[1].sources, 1, 'tower without a commander has no assumed colors');
assert.ok(matchesDeckFilter(cards.at(-1), { kind: 'cost', value: 7 }));
assert.ok(!matchesDeckFilter(cards[1], { kind: 'cost', value: 0 }));
assert.ok(matchesDeckFilter(cards.at(-1), { kind: 'color', value: 32 }));
assert.ok(Math.abs(drawProbability(99, 36, 7, 1) - (1 - Array.from({ length: 7 }, (_, i) => (63 - i) / (99 - i)).reduce((a, b) => a * b, 1))) < 1e-10);
assert.ok(Math.abs(drawProbability(4, 2, 2, 1) - 5 / 6) < 1e-12);
assert.equal(drawProbability(99, 0, 7, 1), 0);
assert.equal(drawProbability(99, 99, 7, 1), 1);
assert.equal(drawProbability(99, 36, 7, 8), 0);
assert.equal(drawProbability(99, 36, 0, 0), 1);
assert.equal(drawProbability(0, 0, 7, 1), 0);


const artA = card('Plains', { set: 'A', number: '1', imageKey: 'c:Plains|A|1', qty: 3 });
const artB = card('Plains', { set: 'B', number: '2', imageKey: 'c:Plains|B|2', qty: 2 });
const changed = replacePrinting([artA, artB], artA, { set: 'C', number: '3', imageKey: 'c:Plains|C|3' });
assert.equal(changed[0].qty, 3);
assert.equal(changed[1].imageKey, artB.imageKey, 'other basic-land arts remain independent');
const merged = replacePrinting([artA, artB], artA, artB);
assert.equal(merged.length, 1);
assert.equal(merged[0].qty, 5, 'choosing the same printing merges copies without losing cards');
assert.equal(decklist(changed), 'Deck\n3 Plains (C) 3\n2 Plains (B) 2');
assert.equal(decklist([card('Partner A', { commander: true, set: 'X', number: '1' }), card('Partner B', { commander: true, set: 'Y', number: '2' }), artA]), 'Commander\n1 Partner A (X) 1\n1 Partner B (Y) 2\n\nDeck\n3 Plains (A) 1');

console.log('OK: deck quantities, curve, colors, hybrid symbols, sources, commander scope and draw probabilities');
