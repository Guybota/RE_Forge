import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: fileURLToPath(new URL('../ui', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
try {
  const { CardDetails, CurrentCardText } = await server.ssrLoadModule('/src/table/CardDetails.tsx');
  const { PlayerArea } = await server.ssrLoadModule('/src/table/PlayerArea.tsx');
  const { Preview, liveInspectionCard } = await server.ssrLoadModule('/src/table/CardZoom.tsx');
  const { I18n, translator } = await server.ssrLoadModule('/src/i18n.ts');
  const render = (component, props) => renderToStaticMarkup(h(I18n.Provider, { value: translator('pt-BR') }, h(component, props)));
  const suppressed = render(CurrentCardText, { card: { id: 1, name: 'Codie', text: 'You cannot cast permanent spells.', gameText: '' } });
  assert.doesNotMatch(suppressed, /cannot cast/, 'Humility must not restore the printed abilities when runtime text is empty');
  assert.match(suppressed, /Sem texto de habilidades/);
  const changed = render(CurrentCardText, { card: { id: 1, text: 'Original rule.', gameText: 'Current granted ability.' } });
  assert.match(changed, /Current granted ability/);
  assert.doesNotMatch(changed, /Original rule/);
  assert.match(render(CurrentCardText, { card: { id: -1, text: 'Catalog oracle.' } }), /Catalog oracle/, 'catalogs retain printed text');
  assert.match(render(Preview, { card: { id: 8, text: '', gameText: 'You may cast the exiled card without paying its mana cost.' } }), /You may cast the exiled card/,
    'a generated effect without artwork still explains the permission');
  assert.doesNotMatch(render(Preview, { card: { id: 8, text: 'Old printed rule.', gameText: '' } }), /Old printed rule/,
    'hover fallback also respects removed abilities');
  const details = render(CardDetails, { card: { id: 2, namedCards: ['Codie, Vociferous Codex'], chosenType: 'Human', chosenColors: ['Blue'], chosenNumber: '0', classLevel: 0,
    chosenPlayerId: 4, phasedOut: true, shieldCount: 2, preventNextDamage: 3 }, playerNames: new Map([[4, 'Defender']]) });
  for (const text of ['Cartas nomeadas', 'Codie, Vociferous Codex', 'Human', 'Azul', 'Número escolhido', 'Nível da Classe', 'Defender', 'Fora de fase', 'regeneração: 2', 'Prevenção de dano: 3']) assert.ok(details.includes(text), text);
  assert.equal((details.match(/<dd><span>0<\/span><\/dd>/g) ?? []).length, 2, 'zero is a valid public choice and class level');
  const player = { id: 4, name: 'Human', life: 40, poison: 2, isLocal: true, isAi: false, hasLost: false, handSize: 0, librarySize: 4,
    zones: { hand: [], battlefield: [], command: [], exile: [], graveyard: [] }, commanderDamage: [], counters: { Poison: 2, Energy: 3, Experience: 4 } };
  const ctx = { selectableCards: new Set(), chosenCards: new Set(), selectablePlayers: new Set(), chosenPlayers: new Set(), combatCards: new Set(), targetCards: new Set(), targetPlayers: new Set(), attachments: new Map(), playerNames: new Map(), onCard() {}, onPlayer() {}, onHover() {}, onZone() {} };
  const revealed = { id: 90, name: 'Serra Angel', gameText: 'Flying, vigilance' };
  const hidden = { id: 90, hidden: true };
  const game = { players: [{ ...player, zones: { ...player.zones, hand: [hidden] } }], stack: [], prompt: { cards: [revealed] } };
  assert.equal(liveInspectionCard(revealed, game), revealed, 'explicit reveal overrides the hidden zone entry in the open zoom');
  assert.equal(liveInspectionCard(revealed, { ...game, prompt: { cards: [] } }), hidden, 'closing the reveal revokes live inspection');
  const updated = { ...revealed, counters: { Charge: 2 }, gameText: '' };
  assert.equal(liveInspectionCard(revealed, { ...game, prompt: { cards: [updated] } }), updated, 'inspection follows changed counters and abilities');
  const header = render(PlayerArea, { player, compact: false, active: false, attackedBy: 0, ctx });
  assert.match(header, /Energia: 3/);
  assert.match(header, /Experiência: 4/);
  assert.equal((header.match(/Veneno/g) ?? []).length, 1, 'poison is not displayed twice');
} finally {
  await server.close();
}
console.log('OK: current abilities, persistent choices, translated state and player counters');
