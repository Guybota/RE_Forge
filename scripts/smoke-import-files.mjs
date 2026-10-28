// Decklist files (MTGO .dek, Forge .dck, text) and suggestion line fixes. Pure, no engine needed.
// Run with: npm run ui:smoke-import
import assert from 'node:assert/strict';
import { fileToDecklist, isCentralLibrary, replaceUnknownLine } from '../ui/src/decklistFiles.ts';

const dek = `<?xml version="1.0" encoding="utf-8"?>
<Deck xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <NetDeckID>0</NetDeckID>
  <Cards CatID="1" Quantity="1" Sideboard="false" Name="Sol Ring" Annotation="0" />
  <Cards CatID="2" Quantity="30" Sideboard="false" Name="Plains" Annotation="0" />
  <Cards CatID="3" Quantity="1" Sideboard="false" Name="Kaya&apos;s Guile" Annotation="0" />
  <Cards CatID="4" Quantity="1" Sideboard="true" Name="Atraxa, Praetors&apos; Voice" Annotation="0" />
</Deck>`;
assert.deepEqual(fileToDecklist('Atraxa.dek', dek), {
  text: "Deck\n1 Sol Ring\n30 Plains\n1 Kaya's Guile\n\nSideboard\n1 Atraxa, Praetors' Voice\n", name: 'Atraxa',
});

const dck = `[metadata]
Name=Superfriends
[Avatar]
1 Some Avatar|VAN
[Commander]
1 Atraxa, Praetors' Voice|C16|1
[Main]
1 Sol Ring|C21
30 Plains
[Sideboard]
1 Swords to Plowshares|EMA|2
[Maybeboard]
1 Counterspell|MH2|67
`;
assert.deepEqual(fileToDecklist('x.dck', dck), {
  text: "Commander\n1 Atraxa, Praetors' Voice (C16)\n\nDeck\n1 Sol Ring (C21)\n30 Plains\n\nSideboard\n1 Swords to Plowshares (EMA)\n\nMaybeboard\n1 Counterspell (MH2)\n",
  name: 'Superfriends',
});
assert.deepEqual(fileToDecklist('list.txt', '1 Sol Ring\n'), { text: '1 Sol Ring\n', name: 'list' });
assert.equal(fileToDecklist('odd.dek', '1 Sol Ring').text, '1 Sol Ring', 'a text .dek stays text');

const list = 'Commander\n1 Atraxa\n\nDeck\n2x Lightnig Bolt (M11) 149\nSB: 1 swords to plowshare\n';
assert.equal(replaceUnknownLine(list, 'Lightnig Bolt', 'Lightning Bolt'), 'Commander\n1 Atraxa\n\nDeck\n2 Lightning Bolt\nSB: 1 swords to plowshare\n');
assert.equal(replaceUnknownLine(list, 'Swords to Plowshare', 'Swords to Plowshares'), 'Commander\n1 Atraxa\n\nDeck\n2x Lightnig Bolt (M11) 149\nSB: 1 Swords to Plowshares\n');
assert.equal(replaceUnknownLine('Atraxa\r\n', 'Atraxa', "Atraxa, Praetors' Voice"), "1 Atraxa, Praetors' Voice\r\n", 'no count means one, CRLF kept');
assert.equal(replaceUnknownLine(list, 'Missing', 'X'), list, 'unmatched text unchanged');

// Central library exports (JSON): the whole library, a list of decks or one deck; anything else is not one.
const deck = { id: 'a', name: 'A', commanders: [], cards: [{ name: 'Sol Ring', quantity: 1 }] };
assert.ok(isCentralLibrary(JSON.stringify({ version: 1, decks: [deck] })));
assert.ok(isCentralLibrary(JSON.stringify([deck, deck])));
assert.ok(isCentralLibrary(JSON.stringify(deck)));
assert.ok(!isCentralLibrary('1 Sol Ring'));
assert.ok(!isCentralLibrary('[]'), 'an empty list is not a library');
assert.ok(!isCentralLibrary(JSON.stringify({ decks: [{ name: 'no cards' }] })));

console.log('OK: MTGO .dek, Forge .dck, text files, Central library JSON and suggestion line fixes');
