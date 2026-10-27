import { test, expect, type Page } from '@playwright/test';

const deck = {
  id: 'central-regression-deck', name: 'Shared deck name',
  commanders: [{ name: 'Giada, Font of Hope', quantity: 1, zone: 'command' }],
  cards: [{ name: 'Plains', quantity: 99 }],
  format: 'commander', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const engineInfo = {
  type: 'engineInfo', version: 'central-integration-test', cards: 100, editions: 1,
  language: 'en-US', languages: [{ code: 'en-US', name: 'English' }], skin: 'mesa', relayAvailable: false,
  phaseStops: { mine: [], opponents: [], autoPass: false }, phaseOptions: [], aiProfiles: ['Default'],
};
const ids = () => ({ cards: [] as number[], players: [] as number[], stack: [] as number[] });
const target = { id: 999, name: 'Library target regression', type: 'Land', typeEn: 'Land', actionable: true };
function state(librarySearch = false) {
  return {
    type: 'state', gameId: 701, turn: 1, phase: 'MAIN1', activePlayerId: 1, priorityPlayerId: 1,
    gameOver: false, winner: null, stack: [], combat: [], log: [],
    players: [1, 2].map(id => ({
      id, name: id === 1 ? 'You' : 'Opponent', life: 40, poison: 0, isLocal: id === 1, isAi: id === 2,
      hasLost: false, handSize: 0, librarySize: 99, commanderDamage: [],
      zones: { hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
    })),
    prompt: {
      message: librarySearch ? 'Choose a card from your library' : '', priority: false,
      ok: { label: '', enabled: false }, cancel: { label: '', enabled: false },
      selectable: { ...ids(), cards: librarySearch ? [target.id] : [] }, chosen: ids(),
      cards: librarySearch ? [target] : [],
    },
  };
}

async function setup(page: Page, unknown = false) {
  const requests: Record<string, unknown>[] = [];
  await page.addInitScript(value => {
    localStorage.setItem('mtg-central-deck-library:v1', JSON.stringify({ version: 1, decks: [value] }));
    localStorage.setItem('reforge.animations', JSON.stringify({ enabled: false }));
  }, deck);
  await page.route('**/api/play/engine', route => route.fulfill({ json: { port: 54321 } }));
  await page.routeWebSocket(/ws:\/\/127\.0\.0\.1:54321\/?$/, socket => {
    const send = (message: unknown) => socket.send(JSON.stringify(message));
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      requests.push(message);
      if (message.type === 'hello') send(engineInfo);
      if (message.type === 'listDecks') send({ type: 'decks', mine: [deck.name], commander: ['Opponent'] });
      if (message.type === 'previewDeck') send({
        type: 'deckPreview', requestId: message.requestId, name: message.name, cards: 100,
        unknown: unknown ? 1 : 0, commanders: ['Giada, Font of Hope'], identity: 1,
        lines: [
          { status: 'ok', text: '1 Giada, Font of Hope', name: 'Giada, Font of Hope', nameEn: 'Giada, Font of Hope', group: 'commander', qty: 1 },
          { status: 'ok', text: '99 Plains', name: 'Plains', nameEn: 'Plains', group: 'land', qty: 99 },
        ],
      });
      if (message.type === 'startDeckMatch') {
        send(state());
        send({
          type: 'choice', id: 501, kind: 'arrange', title: 'Arrange regression', movable: [0, 1],
          toTop: true, toBottom: true, toAnywhere: false,
          options: [{ label: 'Plains' }, { label: 'Sol Ring' }],
        });
      }
      if (message.type === 'answer' && message.id === 501) send(state(true));
      if (message.type === 'action' && message.action === 'card' && message.id === target.id) send(state());
    });
  });
  return requests;
}

test('Central plays through the current table without replacing a saved deck', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => localStorage.setItem('reforge.appearance', JSON.stringify({ textScale: 200, density: 'compact' })));
  const requests = await setup(page);
  await page.goto(`/play?deck=${deck.id}`);
  const frame = page.frameLocator('iframe[title="RE:Forge"]');
  await expect(frame.getByRole('heading', { name: deck.name, exact: true })).toBeVisible();
  const play = frame.getByRole('button', { name: 'Play Commander', exact: true });
  await expect(play).toBeEnabled();
  await expect(frame.locator('html')).toHaveAttribute('data-text-scale', '200');
  expect(await frame.locator('html').evaluate(el => el.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('central-preview-landscape.png') });
  await play.click();
  await expect(frame.getByRole('dialog', { name: 'Arrange regression' })).toBeVisible();
  await frame.getByRole('button', { name: 'Confirm destinations', exact: true }).click();
  await expect(frame.getByRole('dialog', { name: 'Choose a card from your library' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('central-library-landscape.png') });
  await frame.getByRole('button', { name: /Library target regression/ }).click();
  expect(await frame.locator('html').evaluate(el => el.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect.poll(() => requests.some(message => message.type === 'action' && message.id === target.id)).toBe(true);
  const starts = requests.filter(message => message.type === 'startDeckMatch');
  expect(starts).toHaveLength(1);
  expect(starts[0].name).toBe(deck.name);
  expect(starts[0].text).toContain('99 Plains');
  expect(requests.some(message => ['saveDeck', 'deleteDeck', 'renameDeck'].includes(String(message.type)))).toBe(false);
  expect(requests.find(message => message.type === 'answer' && message.id === 501)?.picked).toEqual([0, 1]);
});

test('unknown card lines block starting an incomplete Central deck', async ({ page }) => {
  const requests = await setup(page, true);
  await page.goto(`/play?deck=${deck.id}`);
  const frame = page.frameLocator('iframe[title="RE:Forge"]');
  await expect(frame.getByRole('heading', { name: deck.name, exact: true })).toBeVisible();
  await expect.poll(() => requests.some(message => message.type === 'previewDeck')).toBe(true);
  await expect(frame.getByRole('button', { name: 'Play Commander', exact: true })).toBeDisabled();
  expect(requests.some(message => message.type === 'startDeckMatch' || message.type === 'saveDeck')).toBe(false);
});

test('an unavailable requested deck is reported instead of silently starting another list', async ({ page }) => {
  const requests = await setup(page);
  await page.goto('/play?deck=deleted-deck');
  await expect(page.locator('p[role="alert"]')).toContainText('This deck is no longer in your library.');
  expect(requests.some(message => message.type === 'startDeckMatch' || message.type === 'saveDeck')).toBe(false);
});

test('a failed engine connection can be retried', async ({ page }) => {
  await setup(page);
  let available = false;
  await page.route('**/api/play/engine', route => route.fulfill(available
    ? { json: { port: 54321 } }
    : { status: 503, json: { error: 'Temporarily unavailable' } }));
  await page.goto('/play');
  await expect(page.locator('p[role="alert"]')).toContainText('The table did not start.');
  available = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  const frame = page.frameLocator('iframe[title="RE:Forge"]');
  await expect(frame.getByRole('heading', { name: 'RE:Forge', exact: true })).toBeVisible();
});
