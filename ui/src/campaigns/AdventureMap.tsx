import { useContext, useEffect, useRef, useState } from 'react';
import type { AdventureObject, AdventureState, AtlasSprite, CampaignRequest, QuestDialog } from '../engine';
import { useT } from '../i18n';
import { cardImage } from '../images';
import { CardZoom } from '../table/CardZoom';

const FULL = 0b111_111_111;
// Forge's BiomeTexture autotiles: a 3×4 block of 16 px tiles. Neighbour bits run 8..0 from the top-left to the
// bottom-right of the 3×3 around a tile; whole-tile shapes first, otherwise one 8 px quarter per corner.
const WHOLE: Record<number, number> = { [FULL]: 7, 0b111_111_000: 10, 0b000_111_111: 4, 0b011_011_011: 6, 0b110_110_110: 8, 0b010_111_010: 2, 0b001_011_111: 3, 0b100_110_111: 5, 0b111_011_001: 9, 0b111_110_100: 11 };
const QUARTERS: [number, Record<number, number>, number, number][] = [
  [0b110_100_000, { 0: 12, 0b100_000_000: 12, 0b010_000_000: 24, 0b110_000_000: 24, 0b000_100_000: 14, 0b100_100_000: 14, 0b010_100_000: 4, 0b110_100_000: 26 }, 0, 0],
  [0b011_001_000, { 0: 17, 0b001_000_000: 17, 0b011_000_000: 29, 0b010_000_000: 29, 0b001_001_000: 15, 0b000_001_000: 15, 0b010_001_000: 5, 0b011_001_000: 27 }, 0.5, 0],
  [0b000_100_110, { 0: 42, 0b000_000_100: 42, 0b000_100_100: 44, 0b000_100_000: 44, 0b000_000_110: 30, 0b000_000_010: 30, 0b000_100_010: 10, 0b000_100_110: 32 }, 0, 0.5],
  [0b000_001_011, { 0: 47, 0b000_000_001: 47, 0b000_001_001: 45, 0b000_001_000: 45, 0b000_000_011: 35, 0b000_000_010: 35, 0b000_001_010: 11, 0b000_001_011: 33 }, 0.5, 0.5],
];
function autotile(ctx: CanvasRenderingContext2D, img: HTMLImageElement, [rx, ry, rw]: number[], neighbours: number, x: number, y: number) {
  const s = rw / 3, whole = WHOLE[neighbours];
  if (whole !== undefined) { ctx.drawImage(img, rx + whole % 3 * s, ry + Math.floor(whole / 3) * s, s, s, x, y, 1.01, 1.01); return; }
  for (const [mask, table, qx, qy] of QUARTERS) {
    const i = table[neighbours & mask];
    ctx.drawImage(img, rx + i % 6 * s / 2, ry + Math.floor(i / 6) * s / 2, s / 2, s / 2, x + qx, y + qy, 0.51, 0.51);
  }
}
/** Deterministic [0, 1) per integer point; decorations only need to be stable, not to match Forge's own random. */
function hash(seed: number, x: number, y: number) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(seed: number, x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), sx = x - xi, sy = y - yi, fx = sx * sx * (3 - 2 * sx), fy = sy * sy * (3 - 2 * sy);
  const a = hash(seed, xi, yi), b = hash(seed, xi + 1, yi), c = hash(seed, xi, yi + 1), d = hash(seed, xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function AdventureMap({ state, send }: { state: AdventureState; send: (request: CampaignRequest) => void }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const direction = useRef<[number, number] | null>(null);
  const frame = useRef<() => void>(() => {});
  const current = useRef(state);
  const move = (dx: number, dy: number) => send({ type: 'campaign', action: 'move', dx, dy });
  useEffect(() => {
    const timer = setInterval(() => { if (direction.current) send({ type: 'campaign', action: 'move', dx: direction.current[0], dy: direction.current[1] }); }, 125);
    const clear = () => { direction.current = null; };
    window.addEventListener('keyup', clear); window.addEventListener('blur', clear); document.addEventListener('visibilitychange', clear);
    return () => { clearInterval(timer); clear(); window.removeEventListener('keyup', clear); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear); };
  }, [send]);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    let active = true;
    const draw = () => {
      if (!active) return;
      const c = current.current, map = c.map, world = c.world, ctx = element.getContext('2d'); if (!map && !world || !ctx) return;
      const bounds = element.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      element.width = Math.round(bounds.width * dpr); element.height = Math.round(bounds.height * dpr);
      const style = getComputedStyle(element);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = style.getPropertyValue('--table'); ctx.fillRect(0, 0, bounds.width, bounds.height);
      ctx.imageSmoothingEnabled = false;
      const image = (path: string) => {
        const url = c.assetBase + encodeURIComponent(path);
        let loaded = images.current.get(url);
        if (!loaded) { loaded = new Image(); loaded.onload = draw; loaded.src = url; images.current.set(url, loaded); }
        return loaded.complete && loaded.naturalWidth ? loaded : null;
      };
      // Forge's atlas animations, centred on (x, y); `perPixel` map units per sprite pixel, never larger than `fit`.
      const sprite = (key: string | undefined, x: number, y: number, perPixel: number, fit = Infinity) => {
        const s = key ? c.sprites?.[key] : undefined, img = s && image(s.image);
        if (!s || !img || !s.frames.length) return false;
        const [fx, fy, fw, fh] = s.frames[Math.floor(performance.now() / 150) % s.frames.length], k = Math.min(perPixel, fit / Math.max(fw, fh));
        ctx.drawImage(img, fx, fy, fw, fh, x - fw * k / 2, y - fh * k / 2, fw * k, fh * k);
        return true;
      };
      if (!map && world) {
        // One unit = one original 16 px tile; biomes and terrain are stored per cell of `world.tiles` tiles.
        const T = bounds.width < 600 ? 24 : 32, px = (c.x ?? 0) + 0.5, py = (c.y ?? 0) + 0.5, n = world.size * world.tiles;
        ctx.fillStyle = world.biomes[0].color; ctx.fillRect(0, 0, bounds.width, bounds.height);
        ctx.translate(bounds.width / 2, bounds.height / 2); ctx.scale(T, T); ctx.translate(-px, -py);
        const rx = Math.ceil(bounds.width / T / 2) + 1, ry = Math.ceil(bounds.height / T / 2) + 1;
        const cellAt = (x: number, y: number) => Math.min(world.size - 1, Math.max(0, Math.floor(y / world.tiles))) * world.size + Math.min(world.size - 1, Math.max(0, Math.floor(x / world.tiles)));
        const biomeAt = (x: number, y: number) => world.cells.charCodeAt(cellAt(x, y)) - 48;
        // Terrain variants per tile as in World.generateNew, cleared on cells with a building (World.clearTerrain).
        const built = new Set((c.objects ?? []).filter(o => o.kind !== 'enemy').map(o => cellAt(o.x, o.y)));
        const groundAt = (x: number, y: number) => {
          const b = biomeAt(x, y); let g = 0;
          if (!b || built.has(cellAt(x, y))) return 0;
          world.biomes[b].terrain.forEach((t, k) => {
            const s = world.zoom * (t.resolution ?? 1) / n, v = noise(world.seed + 1 + k, x * s, y * s);
            if (v >= (t.min ?? 0) && v <= (t.max ?? 1)) g = k + 1;
          });
          return g;
        };
        const x0 = Math.max(0, Math.floor(px) - rx), x1 = Math.min(n, px + rx), y0 = Math.max(0, Math.floor(py) - ry), y1 = Math.min(n, py + ry);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const b = biomeAt(x, y), g = groundAt(x, y);
          const mask = (same: (x: number, y: number) => boolean) => { let m = 0, bit = 8; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++, bit--) if (same(x + dx, y + dy)) m |= 1 << bit; return m; };
          // shortcut: only the top biome per cell is stored, so land is assumed to lie on the first land biome (the wastes),
          // the way Forge's colour biomes sit inside it.
          const layers: [AtlasSprite | null | undefined, number][] = [[world.biomes[0].tiles, FULL]];
          if (b) layers.push([world.biomes[1].tiles, mask((xx, yy) => biomeAt(xx, yy) > 0)]);
          if (b > 1) layers.push([world.biomes[b].tiles, mask((xx, yy) => biomeAt(xx, yy) === b)]);
          if (b && g) layers.push([world.biomes[b].terrain[g - 1]?.tiles, mask((xx, yy) => biomeAt(xx, yy) === b && groundAt(xx, yy) === g)]);
          let first = 0; layers.forEach(([, m], i) => { if (m === FULL) first = i; });
          for (const [region, m] of layers.slice(first)) { const img = region && image(region.image); if (img && region) autotile(ctx, img, region.frames[0], m, x, y); }
        }
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const decorations = world.biomes[biomeAt(x, y)].decorations;
          for (let k = 0; k < decorations.length; k++) {
            const d = decorations[k], scale = world.zoom * d.resolution / n, v = noise(world.seed + k, x * scale, y * scale);
            if (v < d.startArea || v > d.endArea || hash(world.seed ^ 0x5bd1e995, x, y * 31 + k) > d.density) continue;
            const img = image(d.sprite.image), f = d.sprite.frames[Math.floor(hash(world.seed, x, y) * d.sprite.frames.length)];
            if (img && f) ctx.drawImage(img, f[0], f[1], f[2], f[3], x + 0.5 - f[2] / 32, y + 0.5 - f[3] / 32, f[2] / 16, f[3] / 16);
            break;
          }
        }
        ctx.lineWidth = 1.5 / T; ctx.strokeStyle = style.getPropertyValue('--panel-ink');
        for (const o of c.objects ?? []) {
          if (Math.abs(o.x - px) > rx + 4 || Math.abs(o.y - py) > ry + 4 || sprite(o.sprite, o.x + 0.5, o.y + 0.5, 1 / 16)) continue;
          ctx.fillStyle = style.getPropertyValue(o.kind === 'enemy' ? '--danger' : o.kind === 'town' ? '--panel' : '--c-M');
          ctx.beginPath(); ctx.arc(o.x + 0.5, o.y + 0.5, 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        if (!sprite(c.player, px, py, 1 / 16)) {
          ctx.fillStyle = style.getPropertyValue('--accent');
          ctx.beginPath(); ctx.arc(px, py, 0.45, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        // Quest targets: a pulsing ring when in view, otherwise an arrow at the edge pointing the way.
        const pulse = 1 + Math.sin(performance.now() / 250) * 0.12, hx = bounds.width / T / 2 - 1, hy = bounds.height / T / 2 - 1;
        ctx.strokeStyle = ctx.fillStyle = style.getPropertyValue('--select'); ctx.lineWidth = 3 / T;
        for (const [qx, qy] of (c.quests ?? []).flatMap(q => q.targets)) {
          const dx = qx + 0.5 - px, dy = qy + 0.5 - py;
          if (Math.abs(dx) <= hx && Math.abs(dy) <= hy) { ctx.beginPath(); ctx.arc(qx + 0.5, qy + 0.5, 1.3 * pulse, 0, Math.PI * 2); ctx.stroke(); continue; }
          const k = Math.min(hx / Math.abs(dx || 1e-6), hy / Math.abs(dy || 1e-6)), ax = px + dx * k, ay = py + dy * k, a = Math.atan2(dy, dx);
          ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
          ctx.beginPath(); ctx.moveTo(0.7, 0); ctx.lineTo(-0.5, -0.5); ctx.lineTo(-0.5, 0.5); ctx.closePath(); ctx.fill(); ctx.restore();
        }
        return;
      }
      if (!map) return;
      const scale = bounds.width < 600 ? 2 : 3;
      const cx = Math.max(bounds.width / scale / 2, Math.min(c.x ?? 0, map.width * map.tile - bounds.width / scale / 2));
      const cy = Math.max(bounds.height / scale / 2, Math.min(c.y ?? 0, map.height * map.tile - bounds.height / scale / 2));
      ctx.translate(bounds.width / 2, bounds.height / 2); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
      const sets = [...map.tilesets].sort((a, b) => b.first - a.first);
      // One Tiled gid (with its flip bits) into the box (x, y, w, h).
      const drawGid = (gid: number, x: number, y: number, w: number, h: number) => {
        const clean = gid & 0x1fffffff; if (!clean) return;
        const set = sets.find(s => s.first <= clean); if (!set) return;
        const tiles = image(set.image); if (!tiles) return;
        const id = clean - set.first;
        ctx.save(); ctx.translate(x + w / 2, y + h / 2);
        ctx.scale(gid & 0x80000000 ? -1 : 1, gid & 0x40000000 ? -1 : 1);
        if (gid & 0x20000000) ctx.transform(0, 1, 1, 0, 0, 0);
        ctx.drawImage(tiles, id % set.columns * set.size, Math.floor(id / set.columns) * set.size, set.size, set.size, -w / 2, -h / 2, w, h); ctx.restore();
      };
      for (const layer of map.layers) {
        ctx.globalAlpha = layer.opacity;
        layer.gids.forEach((gid, index) => {
          const x = index % map.width * map.tile, y = Math.floor(index / map.width) * map.tile;
          if (Math.abs(x - cx) > bounds.width / scale / 2 + map.tile || Math.abs(y - cy) > bounds.height / scale / 2 + map.tile) return;
          drawGid(gid, x, y, map.tile, map.tile);
        });
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = style.getPropertyValue('--panel-ink'); ctx.lineWidth = 1;
      // A sign hangs from the object's bottom-left with Forge's offsets (libGDX y points up).
      const sign = (key: string, left: number, bottom: number) => {
        const s = c.sprites?.[key], img = s && image(s.image), f = s?.frames[Math.floor(performance.now() / 150) % s.frames.length];
        if (img && f) ctx.drawImage(img, f[0], f[1], f[2], f[3], left, bottom - f[3], f[2], f[3]);
      };
      // Entries are invisible in Forge too; the exit button covers them.
      for (const object of c.objects ?? []) {
        if (object.kind === 'entry') continue;
        const left = object.x - (object.w ?? 0) / 2, bottom = object.y + (object.h ?? 0) / 2;
        const ownTile = !!object.gid && object.kind !== 'enemy' && !object.sprite;
        if (ownTile) drawGid(object.gid!, left, bottom - object.h!, object.w!, object.h!);
        if (object.sign) for (const key of [object.sign, object.overlay]) if (key) sign(key, left + (object.signX ?? 0), bottom - (object.signY ?? 0));
        if (ownTile || sprite(object.sprite, object.x, object.y, 1)) continue;
        ctx.fillStyle = style.getPropertyValue(object.kind === 'enemy' ? '--danger' : '--c-M');
        ctx.beginPath(); ctx.arc(object.x, object.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (!sprite(c.player, c.x ?? 0, c.y ?? 0, 1)) {
        ctx.fillStyle = style.getPropertyValue('--accent');
        ctx.beginPath(); ctx.arc(c.x ?? 0, c.y ?? 0, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    };
    frame.current = draw;
    const resize = new ResizeObserver(draw); resize.observe(element); draw();
    const animation = setInterval(draw, 150);
    return () => { active = false; resize.disconnect(); clearInterval(animation); };
  }, [state.id, state.region, state.assetBase]);
  useEffect(() => { current.current = state; frame.current(); }, [state]);
  const directions: Record<string, [number, number]> = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
  const x = state.x ?? 0, y = state.y ?? 0;
  const nearby = (state.objects ?? []).filter(o => o.kind !== 'entry').filter(o => state.map ? Math.hypot(o.x - x, o.y - y) <= 30 : Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) <= (state.world?.tiles ?? 1));
  const quests = state.quests ?? [];
  // Forge's quest giver: one active quest per town, at most three at once.
  const canAsk = quests.length < 3 && !quests.some(q => q.source === state.region);
  const label = (o: AdventureObject) => o.kind === 'enemy' ? `${t('fight')}: ${o.name}` : o.kind === 'town' || o.kind === 'dungeon' ? t('enterPlace', { name: o.name })
    : o.kind === 'inn' ? t('innRest') : o.kind === 'quest' ? t('askQuest') : o.kind === 'shop' ? t('shopNamed', { name: o.name })
    : o.kind === 'entry' ? t('campaignExit') : t('campaignLoot');
  return (
    <section className="adventure-region">
      <canvas ref={canvas} className="adventure-map" tabIndex={0} role="application" aria-label={t('adventureMap')} title={t('adventureControls')} onKeyDown={e => { const d = directions[e.key]; if (d && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); direction.current = d; if (!e.repeat) move(...d); } }} onBlur={() => { direction.current = null; }} />
      <div className="adventure-region__controls">
        <div className="adventure-pad" aria-label={t('adventureControls')}>
          {([{ dir: [0, -1], label: 'moveUpMap', symbol: '↑' }, { dir: [-1, 0], label: 'moveLeftMap', symbol: '←' }, { dir: [0, 1], label: 'moveDownMap', symbol: '↓' }, { dir: [1, 0], label: 'moveRightMap', symbol: '→' }] as const).map(({ dir, label, symbol }) => (
            <button type="button" className="btn btn--ghost" key={label} aria-label={t(label)} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); direction.current = [dir[0], dir[1]]; move(dir[0], dir[1]); }} onPointerUp={() => { direction.current = null; }} onPointerCancel={() => { direction.current = null; }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') move(dir[0], dir[1]); }}>{symbol}</button>
          ))}
        </div>
        <div className="adventure-region__encounters">
          {nearby.filter(o => o.kind !== 'quest' || canAsk).map(o => <button key={o.id} type="button" className="btn btn--primary" title={o.title}
            onClick={() => { direction.current = null; send({ type: 'campaign', action: o.kind === 'enemy' ? 'duel' : 'interact', target: o.id }); }}>{label(o)}</button>)}
        </div>
        {state.map && <button type="button" className="btn btn--ghost" onClick={() => send({ type: 'campaign', action: 'leave' })}>{t('campaignExit')}</button>}
      </div>
      {quests.length > 0 && <section className="adventure-quests" aria-label={t('quests')}>
        <h2>{t('quests')}</h2>
        {quests.map(q => <article key={q.id} className="adventure-quests__quest">
          <div><h3>{q.name}</h3><p>{q.stage.description || q.stage.name}</p></div>
          {q.stage.count > 1 && <span className="adventure-quests__progress">{t('questProgress', { n: q.stage.progress, total: q.stage.count })}</span>}
          <button type="button" className="btn btn--ghost" aria-label={t('abandonQuestNamed', { name: q.name })}
            onClick={() => { if (window.confirm(t('confirmAbandon', { name: q.name }))) send({ type: 'campaign', action: 'abandonQuest', id: q.id }); }}>{t('abandonQuest')}</button>
        </article>)}
      </section>}
      {state.offer && <QuestOffer key={state.offer.name} offer={state.offer} send={send} />}
      {state.shop && <TownShop shop={state.shop} gold={state.gold} send={send} />}
    </section>
  );
}

/** A town shop's stock from Forge's shops.json, bought with gold. */
function TownShop({ shop, gold, send }: { shop: NonNullable<AdventureState['shop']>; gold: number; send: (request: CampaignRequest) => void }) {
  const t = useT();
  const zoom = useContext(CardZoom);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  const close = () => send({ type: 'campaign', action: 'closeShop' });
  return (
    <dialog ref={ref} className="choice town-shop" aria-label={shop.name} onCancel={e => { e.preventDefault(); close(); }}>
      <header className="town-shop__head">
        <h2 className="choice__title" title={shop.description}>{shop.name}</h2>
        <span>{t('campaignGold', { n: gold })}</span>
        <button type="button" className="btn btn--ghost" onClick={close} autoFocus>{t('close')}</button>
      </header>
      <div className="campaign__shop">
        {shop.items.map(card => <article className="campaign__shop-card" key={card.key} onContextMenu={e => { e.preventDefault(); zoom({ id: -1, name: card.name, imageKey: card.imageKey }); }}>
          <img src={cardImage(card.imageKey, 'full') ?? undefined} alt={card.name} loading="lazy" />
          <strong>{card.name}</strong>
          <button type="button" className="btn btn--primary" disabled={card.sold || card.price > gold} aria-label={t('buyFor', { name: card.name, n: card.price })}
            onClick={() => send({ type: 'campaign', action: 'buy', key: card.key })}>{card.sold ? t('sold') : t('campaignGold', { n: card.price })}</button>
        </article>)}
      </div>
    </dialog>
  );
}

/** A town quest giver's dialog from Forge's data: choices lead deeper; one of them accepts. */
function QuestOffer({ offer, send }: { offer: NonNullable<AdventureState['offer']>; send: (request: CampaignRequest) => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [node, setNode] = useState<QuestDialog>(offer.dialog);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  const decline = () => send({ type: 'campaign', action: 'declineQuest' });
  return (
    <dialog ref={ref} className="choice quest-offer" aria-label={offer.name} onCancel={e => { e.preventDefault(); decline(); }}>
      <h2 className="choice__title">{offer.name}</h2>
      <p className="quest-offer__text">{node.text || offer.description}</p>
      <div className="quest-offer__options">
        {node.options.map((o, i) => <button key={i} type="button" className={`btn ${o.accept ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => o.accept ? send({ type: 'campaign', action: 'acceptQuest' }) : o.next ? setNode(o.next) : decline()}>{o.name || t('close')}</button>)}
        {node.options.length === 0 && <button type="button" className="btn btn--ghost" onClick={decline}>{t('close')}</button>}
      </div>
    </dialog>
  );
}

