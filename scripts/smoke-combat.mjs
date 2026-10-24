// Plays an active Commander game through the engine socket: plays lands and castable spells,
// picks targets, attacks with everything and blocks when attacked. Checks that combat shows up in
// the state messages (attackers, the defender, blockers), then concedes.
// Run with: npm run engine:smoke-combat   (after npm run engine:build). SMOKE_DEBUG=1 prints each state.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONCEDE_AT_TURN = Number(process.env.SMOKE_TURNS ?? 12);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const engine = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'),
  '--port', '0', '--assets', path.join(root, 'forge/forge-gui'), '--exit-with-parent']);
engine.stderr.on('data', (d) => { if (process.env.SMOKE_DEBUG) process.stderr.write(d); });

// AI turns take a while; a 12-turn game can need several minutes.
const timeout = setTimeout(() => fail('no game over within 15 minutes'), 900_000);
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
  const seen = { myAttacks: 0, attackDefenderSet: 0, blocks: 0, myCreaturesMax: 0, actionableSeen: false, choices: 0 };
  let finished = false, conceded = false, latest = null, latestSeq = 0, actedSeq = -1, actedAt = 0;
  const tried = new Set(); // card ids clicked this turn, so a card that can't be used isn't clicked forever
  let triedTurn = -1, alphaTurn = -1;

  ws.onopen = () => send({ type: 'startMatch', opponents: 1 });
  ws.onclose = (e) => { if (!finished) setTimeout(() => fail(`socket closed: code ${e.code}`), 1000); };
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'error') fail(`engine error: ${msg.message}`);
    if (msg.type === 'choice') {
      seen.choices++;
      const n = msg.options?.length ?? 0;
      if (msg.kind === 'amounts') send({ type: 'answer', id: msg.id, amounts: [msg.total, ...Array(n - 1).fill(0)] });
      else if (msg.kind === 'text') send({ type: 'answer', id: msg.id, value: msg.initial ?? '' });
      // Take optional things too (first option), so spells actually get cast.
      else send({ type: 'answer', id: msg.id, picked: [...Array(Math.min(Math.max(1, msg.min ?? 0), n)).keys()].slice(0, Math.max(0, msg.max ?? 1) || n) });
      return;
    }
    if (msg.type !== 'state') return;
    const me = msg.players.find((p) => p.isLocal);
    seen.myCreaturesMax = Math.max(seen.myCreaturesMax, me.zones.battlefield.filter((c) => c.typeEn?.includes('Creature')).length);
    if ([...me.zones.hand, ...me.zones.battlefield].some((c) => c.actionable)) seen.actionableSeen = true;
    const mine = new Set(me.zones.battlefield.map((c) => c.id));
    for (const a of msg.combat) {
      if (mine.has(a.attackerId)) {
        seen.myAttacks++;
        if (a.defenderPlayerId !== undefined || a.defenderCardId !== undefined) seen.attackDefenderSet++;
      }
      if (a.blockerIds.some((b) => mine.has(b))) seen.blocks++;
    }
    if (process.env.SMOKE_DEBUG) {
      console.log(`t${msg.turn} ${msg.phase} ${msg.activePlayerId === me.id ? 'me' : 'ai'} prompt="${msg.prompt.message.replace(/\n/g, ' ')}" ok=${msg.prompt.ok.enabled} cancel=${msg.prompt.cancel.label} combat=${JSON.stringify(msg.combat)}`);
    }

    if (msg.gameOver) {
      finished = true;
      clearTimeout(timeout);
      console.log(`stats: ${JSON.stringify(seen)}`);
      assert.ok(seen.actionableSeen, 'some card was marked actionable');
      assert.ok(seen.myCreaturesMax > 0, 'cast at least one creature');
      assert.ok(seen.myAttacks > 0, 'attacked at least once');
      assert.equal(seen.attackDefenderSet, seen.myAttacks, 'every attack has a defender');
      console.log(`OK: game over on turn ${msg.turn}, winner ${msg.winner}${seen.blocks ? '' : ' (no block happened)'}`);
      ws.close();
      engine.kill();
      return;
    }
    if (me.hasLost) { finished = true; fail('lost before conceding (fine, but rerun for combat coverage)'); }
    if (msg.turn >= CONCEDE_AT_TURN && !conceded) {
      conceded = true;
      send({ type: 'action', action: 'concede' });
    }
    latest = msg;
    latestSeq++;
  };

  // One action per new state (retried after 2 s if nothing changes).
  const tick = setInterval(() => {
    if (finished) return clearInterval(tick);
    if (!latest || latest.gameOver || conceded) return;
    if (latestSeq === actedSeq && Date.now() - actedAt < 2000) return;
    actedSeq = latestSeq;
    actedAt = Date.now();

    const s = latest;
    const me = s.players.find((p) => p.isLocal);
    const myTurn = s.activePlayerId === me.id;
    const { ok, cancel, selectable, chosen } = s.prompt;
    if (s.turn !== triedTurn) { tried.clear(); triedTurn = s.turn; }
    const click = (id) => { tried.add(id); send({ type: 'action', action: 'card', id }); };

    // 1. A prompt asking for cards (targets, discard) or a player (target player): pick one.
    const pick = selectable.cards.find((id) => !chosen.cards.includes(id) && !tried.has(id));
    if (pick !== undefined && !ok.enabled) return click(pick);
    const player = selectable.players.find((id) => id !== me.id) ?? selectable.players[0];
    if (player !== undefined && !ok.enabled) return send({ type: 'action', action: 'player', id: player });

    // Paying mana that "Auto" can't cover: tap highlighted sources by hand, or give up on the spell.
    if (!ok.enabled && cancel.enabled && pick === undefined && player === undefined) {
      const source = me.zones.battlefield.find((c) => c.actionable && !c.tapped && !tried.has(c.id));
      if (source) return click(source.id);
      return send({ type: 'action', action: 'cancel' });
    }

    // 2. Attack with everything once per turn (Forge's cancel button is "Alpha Strike" here).
    if (myTurn && s.phase === 'COMBAT_DECLARE_ATTACKERS' && ok.enabled && cancel.enabled && s.combat.length === 0 && alphaTurn !== s.turn) {
      alphaTurn = s.turn;
      return send({ type: 'action', action: 'cancel' });
    }

    // 3. Being attacked: block the chosen attacker with a creature that can.
    if (!myTurn && s.phase === 'COMBAT_DECLARE_BLOCKERS' && ok.enabled) {
      const blocker = me.zones.battlefield.find((c) => c.actionable && !tried.has(c.id));
      if (blocker) return click(blocker.id);
    }

    // 4. Own main phase: play what can be played (lands, castable spells).
    if (myTurn && (s.phase === 'MAIN1' || s.phase === 'MAIN2') && ok.enabled) {
      const playable = me.zones.hand.find((c) => c.actionable && !tried.has(c.id));
      if (playable) return click(playable.id);
    }

    if (ok.enabled) send({ type: 'action', action: 'ok' });
    else if (pick !== undefined) click(pick);
  }, 150);
}
