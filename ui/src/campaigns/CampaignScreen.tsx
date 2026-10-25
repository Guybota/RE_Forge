import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AtlasSprite, CampaignMode, CampaignRequest, CampaignState } from '../engine';
import { useT, type MessageKey } from '../i18n';
import { cardImage } from '../images';
import { CardZoom } from '../table/CardZoom';
import type { Engine } from '../useEngine';
import { AdventureMap } from './AdventureMap';
import './campaigns.css';

const difficulties: MessageKey[] = ['difficultyEasy', 'difficultyNormal', 'difficultyHard', 'difficultyExpert'];

export function CampaignScreen({ mode, engine, onBack }: { mode: CampaignMode; engine: Engine; onBack: () => void }) {
  const t = useT(); const { send: engineSend } = engine;
  const send = useCallback((request: CampaignRequest) => engineSend(request), [engineSend]);
  const [name, setName] = useState(''); const [starter, setStarter] = useState(mode === 'adventure' ? 'G' : '');
  const [difficulty, setDifficulty] = useState(0); const [tab, setTab] = useState<'play' | 'deck' | 'shop'>('play');
  const [creating, setCreating] = useState(false); const [showForm, setShowForm] = useState(false);
  const [hero, setHero] = useState('Human'); const [sex, setSex] = useState<'male' | 'female'>('male');
  const campaign = engine.campaign?.mode === mode ? engine.campaign : null;
  const list = engine.campaigns?.mode === mode ? engine.campaigns : null;
  useEffect(() => { send({ type: 'campaign', action: 'list', mode }); }, [send, mode]);
  const goBack = () => { send({ type: 'campaign', action: 'close' }); onBack(); };
  const zoom = useContext(CardZoom);
  return (
    <main className="campaign">
      <header className="campaign__head">
        <button className="btn btn--ghost" type="button" onClick={goBack}>{t('mainMenu')}</button>
        <div><span className="campaign__mode">{t(mode)}</span><h1>{campaign?.name ?? t('campaigns')}</h1></div>
        {campaign && <button type="button" className="btn btn--ghost" onClick={() => { send({ type: 'campaign', action: 'close' }); send({ type: 'campaign', action: 'list', mode }); setCreating(false); setTab('play'); }}>{t('campaigns')}</button>}
      </header>
      {engine.error && <p className="error" role="alert">{engine.error}</p>}
      {!campaign ? (
        <div className="campaign__library">
          <section className="campaign__saves" aria-label={t('campaigns')}>
            {list?.campaigns.length === 0 && <p className="muted">{t('campaignEmpty')}</p>}
            {list?.campaigns.map(c => <div className="campaign__save-row" key={c.id}>
              <button type="button" className="campaign__save" onClick={() => { setTab('play'); send({ type: 'campaign', action: 'open', id: c.id }); }}><strong>{c.name}</strong><span>{t('campaignWins', { n: c.wins ?? 0 })} · {t('campaignLosses', { n: c.losses ?? 0 })}</span><span>{t('continueCampaign')}</span></button>
              <button type="button" className="btn btn--ghost" aria-label={t('deleteCampaignNamed', { name: c.name })} onClick={() => { if (window.confirm(t('confirmDelete', { name: c.name }))) send({ type: 'campaign', action: 'delete', id: c.id }); }}>{t('deleteCampaign')}</button>
            </div>)}
            <button type="button" className="btn btn--primary" onClick={() => { setShowForm(true); setCreating(false); }}>{t('newCampaign')}</button>
          </section>
          {(showForm || list?.campaigns.length === 0) && <form className="campaign__create" onSubmit={e => { e.preventDefault(); setCreating(true); send({ type: 'campaign', action: 'create', mode, name, difficulty, starter: starter || list?.starters[0]?.id, ...(mode === 'adventure' ? { hero, sex } : {}) }); }}>
            <h2>{t('newCampaign')}</h2>
            <label className="field-label">{t('campaignName')}<input className="input" autoComplete="off" maxLength={64} required value={name} onChange={e => setName(e.target.value)} /></label>
            {mode === 'adventure' && list?.heroes && <div className="campaign__hero">
              <label className="field-label">{t('campaignHero')}<select className="input" value={hero} onChange={e => setHero(e.target.value)}>{list.heroes.map(h => <option key={h.id} value={h.id}>{t(`hero${h.id.replace(/ /g, '')}` as MessageKey)}</option>)}</select></label>
              <label className="field-label">{t('campaignHeroSex')}<select className="input" value={sex} onChange={e => setSex(e.target.value as 'male' | 'female')}><option value="male">{t('heroMale')}</option><option value="female">{t('heroFemale')}</option></select></label>
              <AtlasPortrait sprite={list.heroes.find(h => h.id === hero)?.portraits[sex]} base={list.assetBase} />
            </div>}
            <label className="field-label">{t('campaignStarter')}<select className="input" value={starter || list?.starters[0]?.id || ''} onChange={e => setStarter(e.target.value)}>{list?.starters.map(s => <option key={s.id} value={s.id}>{mode === 'adventure' ? t(`color${s.id}` as MessageKey) : s.name}</option>)}</select></label>
            <label className="field-label">{t('campaignDifficulty')}<select className="input" value={difficulty} onChange={e => setDifficulty(Number(e.target.value))}>{difficulties.map((d, i) => <option key={d} value={i}>{t(mode === 'adventure' && i === 3 ? 'difficultyInsane' : d)}</option>)}</select></label>
            <button type="submit" className="btn btn--primary" disabled={!name.trim() || !list?.starters.length || creating && !engine.error}>{creating && !engine.error ? t('shuffling') : t('createCampaign')}</button>
          </form>}
        </div>
      ) : <>
        <div className="campaign__stats">
          {campaign.mode === 'quest' ? <><span>{t('campaignCredits', { n: campaign.credits })}</span><span>{t('campaignRank', { n: campaign.rank })}</span></> : <><span>{t('campaignLife', { life: campaign.life, max: campaign.maxLife })}</span><span>{t('campaignGold', { n: campaign.gold })}</span><span>{t('campaignShards', { n: campaign.shards })}</span></>}
          <span>{t('campaignWins', { n: campaign.wins })}</span><span>{t('campaignLosses', { n: campaign.losses })}</span>
        </div>
        <nav className="campaign__tabs" aria-label={t(mode)}>
          <button className="btn btn--ghost" type="button" aria-current={tab === 'play' ? 'page' : undefined} onClick={() => setTab('play')}>{t(mode === 'quest' ? 'duels' : 'explore')}</button>
          <button className="btn btn--ghost" type="button" aria-current={tab === 'deck' ? 'page' : undefined} onClick={() => setTab('deck')}>{t('collection')}</button>
          {mode === 'quest' && <button className="btn btn--ghost" type="button" aria-current={tab === 'shop' ? 'page' : undefined} onClick={() => setTab('shop')}>{t('shop')}</button>}
        </nav>
        {tab === 'deck' ? <CampaignDeck key={campaign.id} campaign={campaign} send={send} error={engine.error} /> : tab === 'shop' && campaign.mode === 'quest' ? (
          <section className="campaign__shop" aria-label={t('shop')}>
            {campaign.shop.length === 0 && <p className="muted">{t('campaignShopEmpty')}</p>}
            {campaign.shop.map(card => <article className="campaign__shop-card" key={card.key} onContextMenu={e => { e.preventDefault(); zoom({ id: -1, name: card.name, imageKey: card.imageKey }); }}><img src={cardImage(card.imageKey, 'full') ?? undefined} alt={card.name} loading="lazy" /><strong>{card.name}</strong><button type="button" className="btn btn--primary" disabled={card.price > campaign.credits} aria-label={t('buyCard', { name: card.name, n: card.price })} onClick={() => send({ type: 'campaign', action: 'buy', key: card.key })}>{t('campaignCredits', { n: card.price })}</button></article>)}
          </section>
        ) : campaign.mode === 'quest' ? (
          <section className="campaign__duels" aria-label={t('duels')}>{campaign.duels.map(duel => <article className="campaign__duel" key={duel.id}><h2 title={duel.description}>{duel.name}</h2><span>{duel.difficulty}</span><button type="button" className="btn btn--primary" onClick={() => send({ type: 'campaign', action: 'duel', target: duel.id })}>{t('fight')}</button></article>)}</section>
        ) : <>{campaign.life < 1 && <p className="error">{t('adventureDefeated')}</p>}<AdventureMap state={campaign} send={send} /></>}
        {tab === 'play' && campaign.rewards.length > 0 && <section className="campaign__rewards" aria-label={t('campaignRewards')}><h2>{t('campaignRewards')}</h2>{campaign.rewards.map((r, i) => <article key={i}>{r.title && <h3>{r.title}</h3>}{r.message && <p>{r.message}</p>}{r.kind === 'gold' && <p>{t('campaignGold', { n: r.count ?? 0 })}</p>}{r.kind === 'shards' && <p>{t('campaignShards', { n: r.count ?? 0 })}</p>}{r.kind === 'rest' ? <p>{t('campaignRested', { name: r.name ?? '' })}</p> : r.name && <p>{r.name}</p>}{r.cards?.map(c => <p key={c.key}>{c.qty} {c.name}</p>)}</article>)}</section>}
      </>}
    </main>
  );
}

/** First frame of a Forge atlas region, scaled up without smoothing. */
function AtlasPortrait({ sprite, base }: { sprite?: AtlasSprite; base?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d'), frame = sprite?.frames[0];
    if (!ctx || !sprite || !frame || !base) return;
    const image = new Image();
    image.onload = () => { ctx.clearRect(0, 0, 64, 64); ctx.imageSmoothingEnabled = false; ctx.drawImage(image, frame[0], frame[1], frame[2], frame[3], 0, 0, 64, 64); };
    image.src = base + encodeURIComponent(sprite.image);
  }, [sprite, base]);
  return <canvas ref={canvas} className="campaign__portrait" width={64} height={64} aria-hidden="true" />;
}

function CampaignDeck({ campaign, send, error }: { campaign: CampaignState; send: (r: CampaignRequest) => void; error: string | null }) {
  const t = useT(); const zoom = useContext(CardZoom);
  const [quantities, setQuantities] = useState(() => Object.fromEntries(campaign.cards.map(c => [c.key, c.qty])));
  const [query, setQuery] = useState(''); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false);
  const atSave = useRef(campaign);
  useEffect(() => { if (saving && campaign !== atSave.current) { setSaving(false); setSaved(true); } }, [campaign, saving]);
  const count = useMemo(() => Object.values(quantities).reduce((sum, n) => sum + n, 0), [quantities]);
  return <section className="campaign-deck">
    <div className="campaign-deck__bar"><input className="input" type="search" aria-label={t('searchCards')} placeholder={t('searchCards')} value={query} onChange={e => setQuery(e.target.value)} /><strong title={t('campaignDeckMinimum')}>{t('campaignDeckSize', { n: count })}</strong><button className="btn btn--primary" type="button" disabled={count < 40 || saving && !error} onClick={() => { atSave.current = campaign; setSaving(true); setSaved(false); send({ type: 'campaign', action: 'deck', entries: campaign.cards.map(c => ({ key: c.key, qty: quantities[c.key] ?? 0 })) }); }}>{t('save')}</button>{saved && <span role="status">{t('campaignDeckSaved')}</span>}</div>
    <div className="campaign-deck__cards">{campaign.cards.filter(c => `${c.name} ${c.nameEn}`.toLowerCase().includes(query.toLowerCase())).map(c => <article className="campaign-deck__card" key={c.key} onContextMenu={e => { e.preventDefault(); zoom({ id: -1, name: c.name, imageKey: c.imageKey }); }}><img src={cardImage(c.imageKey, 'full') ?? undefined} alt={c.name} loading="lazy" /><strong>{c.name}</strong><div title={t('ownedCards', { n: c.owned })}><button type="button" className="btn btn--ghost" aria-label={t('less', { name: c.name })} disabled={!quantities[c.key]} onClick={() => { setSaved(false); setQuantities(q => ({ ...q, [c.key]: Math.max(0, (q[c.key] ?? 0) - 1) })); }}>−</button><span>{quantities[c.key] ?? 0}/{c.owned}</span><button type="button" className="btn btn--ghost" aria-label={t('more', { name: c.name })} disabled={(quantities[c.key] ?? 0) >= c.owned} onClick={() => { setSaved(false); setQuantities(q => ({ ...q, [c.key]: (q[c.key] ?? 0) + 1 })); }}>+</button></div></article>)}</div>
  </section>;
}
