import assert from 'node:assert/strict';
import { markerForQuest, trackedQuest, questWaypoint } from '../ui/src/campaigns/adventureGuidance.ts';

const quests = ['one', 'two', 'three'].map(id => ({ id }));
assert.equal(trackedQuest([], 'one'), undefined);
assert.equal(trackedQuest(quests, null).id, 'one');
assert.equal(trackedQuest(quests, 'two').id, 'two');
assert.equal(trackedQuest(quests, 'removed').id, 'one');
assert.equal(trackedQuest(quests.slice(1), 'one').id, 'two');
assert.deepEqual(quests.map(q => markerForQuest(quests, q.id)), ['circle', 'diamond', 'square']);
assert.deepEqual(questWaypoint(0, 0, 5, 4), { x: 0, y: 0, offscreen: false, angle: 0 });
assert.equal(questWaypoint(5, 4, 5, 4).offscreen, false);
for (const [dx, dy] of [[0, 100], [100, 0], [-100, 0], [0, -100], [100, 100], [-100, -100]]) {
  const points = [-1, 0, 1].map(lane => questWaypoint(dx, dy, 5, 4, lane));
  for (const p of points) {
    assert.equal(p.offscreen, true);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.angle));
    assert.ok(Math.abs(p.x) <= 5 && Math.abs(p.y) <= 4);
  }
  assert.ok(new Set(points.map(p => `${p.x}:${p.y}`)).size > 1, 'simultaneous quest arrows have separate lanes');
}
assert.ok(Number.isFinite(questWaypoint(10, 10, 0, -1).x), 'tiny map stays finite');
console.log('OK: empty/current/removed quest selections, three distinct shapes and bounded off-screen waypoint lanes');
