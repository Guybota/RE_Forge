// Plays a real Commander game through the engine socket as a passive player: keeps the opening
// hand, presses OK whenever it can, answers every question with the smallest legal choice, and
// concedes after a few turns. Checks the state messages along the way.
// Run with: npm run engine:smoke-match   (after npm run engine:build)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TURNS_BEFORE_CONCEDE = 4;
const OPPONENTS = Number(process.env.SMOKE_OPPONENTS ?? 1);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const engine = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'),
  '--port', '0', '--assets', path.join(root, 'forge/forge-gui'), '--exit-with-parent']);
engine.stderr.on('data', (d) => process.stderr.write(d));
engine.on('exit', (code, signal) => console.error(`engine exited: code ${code} signal ${signal}`));

const timeout = setTimeout(() => fail('no game over within 5 minutes'), 300_000);
function fail(message) {
  engine.kill();
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

let out = '';
engine.stdout.on('data', (chunk) => {
  out += chunk;
  const match = out.match(/^READY (\d+)$/m);
  if (!match) return;
  engine.stdout.removeAllListeners('data');
  play(Number(match[1]));
});

function play(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const send = (o) => ws.send(JSON.stringify(o));
  let conceded = false;
  let sawOpeningHand = false;
  let choices = 0;

  let left = false;
  ws.onopen = () => send({ type: 'startMatch', opponents: OPPONENTS });
  let finished = false;
  // Report how the socket closed (code/reason) rather than a bare error, so failures can be diagnosed.
  // The delay lets an engine crash report its exit code first.
  ws.onclose = (e) => { if (!finished) setTimeout(() => fail(`socket closed: code ${e.code} reason "${e.reason}"`), 1000); };
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (process.env.SMOKE_DEBUG) {
      console.log(msg.type, msg.type === 'state'
        ? `t${msg.turn} ${msg.phase} prompt="${msg.prompt.message}" ok=${msg.prompt.ok.enabled}:${msg.prompt.ok.label}`
        : JSON.stringify(msg).slice(0, 300));
    }
    if (msg.type === 'error') fail(`engine error: ${msg.message}`);

    if (msg.type === 'choice') {
      choices++;
      const n = msg.options?.length ?? 0;
      if (msg.kind === 'amounts') {
        send({ type: 'answer', id: msg.id, amounts: [msg.total, ...Array(n - 1).fill(0)] });
      } else if (msg.kind === 'text') {
        send({ type: 'answer', id: msg.id, value: msg.initial ?? '' });
      } else {
        const count = Math.max(0, msg.min ?? 0);
        send({ type: 'answer', id: msg.id, picked: [...Array(Math.min(count, n)).keys()] });
      }
      return;
    }

    if (msg.type !== 'state') return;
    assert.equal(msg.players.length, OPPONENTS + 1, 'player count');
    const me = msg.players.find((p) => p.isLocal);
    const opp = msg.players.find((p) => !p.isLocal);
    assert.ok(me && opp, 'a local player and AI players');

    if (me.zones.hand.length > 0) {
      sawOpeningHand = true;
      assert.ok(me.zones.hand.every((c) => c.name), 'own hand cards have names');
    }
    // Later, effects may legitimately reveal an opponent's hand, so only check before anything has been played.
    if (msg.turn <= 1) assert.ok(opp.zones.hand.every((c) => c.hidden), 'opponent hand is hidden');

    if (msg.gameOver) {
      clearTimeout(timeout);
      finished = true;
      assert.ok(sawOpeningHand, 'saw an opening hand');
      assert.ok(msg.turn >= TURNS_BEFORE_CONCEDE, `reached turn ${TURNS_BEFORE_CONCEDE}`);
      console.log(`OK: game over on turn ${msg.turn}, winner ${msg.winner}, ${choices} choices answered, ` +
        `log has ${msg.log.length} lines, life ${me.life} vs ${opp.life}`);
      ws.close();
      engine.kill();
      return;
    }

    // With several opponents the AIs keep playing after we concede; leaving ends it for them.
    if (me.hasLost && !left) {
      left = true;
      send({ type: 'action', action: 'leave' });
      return;
    }

    if (msg.turn >= TURNS_BEFORE_CONCEDE && !conceded) {
      conceded = true;
      send({ type: 'action', action: 'concede' });
      return;
    }

    latest = msg;
    latestSeq++;
  };

  // Act on the newest state once; if nothing new arrives within 2 s, act on it again (an OK can
  // land while the engine is busy). Prompt texts can repeat or be empty, so don't key on them.
  let latest = null, latestSeq = 0, actedSeq = -1, actedAt = 0;
  const tick = setInterval(() => {
    if (finished) return clearInterval(tick);
    if (!latest || latest.gameOver || conceded) return;
    if (latestSeq === actedSeq && Date.now() - actedAt < 2000) return;
    actedSeq = latestSeq;
    actedAt = Date.now();
    const { ok, selectable, chosen } = latest.prompt;
    if (ok.enabled) {
      send({ type: 'action', action: 'ok' });
    } else {
      // e.g. discarding to hand size: OK stays off until enough cards are picked
      const card = selectable.cards.find((id) => !chosen.cards.includes(id));
      if (card !== undefined) send({ type: 'action', action: 'card', id: card });
    }
  }, 150);
}
