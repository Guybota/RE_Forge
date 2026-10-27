import { useEffect, useRef, useState } from 'react';
import { useT } from './i18n';
import type { Engine } from './useEngine';

export function Lobby({ engine, onBack }: { engine: Engine; onBack: () => void }) {
  const t = useT();
  const { lobby, send } = engine;
  const [mode, setMode] = useState<'host' | 'join'>('host');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [port, setPort] = useState(36743);
  const [upnp, setUpnp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { if (engine.error) setBusy(false); }, [engine.error]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [engine.chat]);

  const back = () => {
    if (lobby) send({ type: 'leaveLobby' });
    onBack();
  };
  if (!lobby) return (
    <main className="home">
      <h1>{t('online')}</h1>
      <form className="home__form" onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        send(mode === 'host' ? { type: 'hostGame', name, port, upnp } : { type: 'joinGame', name, address });
      }}>
        <div className="online__modes">
          <button type="button" className={`btn ${mode === 'host' ? 'btn--primary' : 'btn--ghost'}`} aria-pressed={mode === 'host'} onClick={() => setMode('host')} disabled={busy}>{t('hostGame')}</button>
          <button type="button" className={`btn ${mode === 'join' ? 'btn--primary' : 'btn--ghost'}`} aria-pressed={mode === 'join'} onClick={() => setMode('join')} disabled={busy}>{t('joinGame')}</button>
        </div>
        <label className="field-label">{t('playerName')}<input className="input" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} autoComplete="nickname" /></label>
        {mode === 'host' ? <>
          <label className="field-label" title={t('portHint')}>{t('port')}<input className="input" type="number" min={1024} max={65535} required value={port} onChange={(e) => setPort(Number(e.target.value))} disabled={busy} /></label>
          <label className="online__check" title={t('portHint')}><input type="checkbox" checked={upnp} onChange={(e) => setUpnp(e.target.checked)} disabled={busy} />{t('autoPort')}</label>
        </> : <label className="field-label">{t('address')}<input className="input" required value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} placeholder="192.168.1.10:36743" /></label>}
        <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>{busy ? t('connecting') : t(mode === 'host' ? 'hostGame' : 'joinGame')}</button>
        {engine.error && <p className="error" role="alert">{engine.error}</p>}
        <button type="button" className="btn btn--ghost" onClick={back} disabled={busy}>{t('back')}</button>
      </form>
    </main>
  );

  const me = lobby.slots.find((slot) => slot.index === lobby.localSlot);
  const active = lobby.slots.filter((slot) => slot.kind !== 'open');
  const canStart = active.length >= 2 && active.every((slot) => slot.ready && slot.deck);
  return (
    <main className="online">
      <header className="online__head"><h1>{t('lobby')}</h1><button type="button" className="btn btn--ghost" onClick={back}>{t('leaveLobby')}</button></header>
      {lobby.host && <div className="online__addresses" title={t('portHint')}>
        <span className="muted">{t('shareAddress')}</span>
        {lobby.addresses.map((url) => <div className="online__address" key={url}>
          <input className="input" aria-label={t('shareAddress')} readOnly value={url} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn--ghost" onClick={async () => {
            try { await navigator.clipboard.writeText(url); setCopied(url); setCopyError(false); }
            catch { setCopyError(true); }
          }}>{t(copied === url ? 'copied' : 'copy')}</button>
        </div>)}
        {copyError && <p role="status">{t('copyFailed')}</p>}
      </div>}
      <div className="online__body">
        <section className="online__seats" aria-label={t('lobby')}>
          {lobby.slots.map((slot) => <article className="online__seat" key={slot.index}>
            <div className="online__seat-head">
              <h2>{slot.kind === 'open' ? t('openSeat') : slot.name || t('humanSeat')}</h2>
              {slot.kind !== 'open' && <span className="muted">{t(slot.ready ? 'ready' : 'notReady')}</span>}
              {slot.controllable && <select className="input" aria-label={t('seatType', { n: slot.index + 1 })} value={slot.kind} onChange={(e) => send({ type: 'setSlot', index: slot.index, slotType: e.target.value as 'ai' | 'open' })}>
                <option value="open">{t('openSeat')}</option><option value="ai">{t('aiSeat')}</option>
              </select>}
              {slot.controllable && slot.index >= 2 && <button type="button" className="btn btn--ghost" aria-label={t('removeSeat', { n: slot.index + 1 })} onClick={() => send({ type: 'removeSlot', index: slot.index })}>×</button>}
            </div>
            {slot.kind !== 'open' && (slot.editable ? <select className="input" aria-label={t('seatDeck', { name: slot.name || t('humanSeat') })} value={slot.deck ?? ''} onChange={(e) => send({ type: 'setSlot', index: slot.index, deck: e.target.value })}>
              <option value="" disabled>{t('chooseDeck')}</option>
              {engine.decks.mine.length > 0 && <optgroup label={t('myDecks')}>{engine.decks.mine.map((deck) => <option key={deck} value={deck}>{deck}</option>)}</optgroup>}
              <optgroup label={t('precons')}>{engine.decks.precons.map((deck) => <option key={deck} value={deck}>{deck}</option>)}</optgroup>
            </select> : <p>{slot.deck || t('chooseDeck')}</p>)}
          </article>)}
          <div className="online__actions">
            {lobby.host && lobby.slots.length < 4 && <button type="button" className="btn btn--ghost" onClick={() => send({ type: 'addSlot' })}>{t('addSeat')}</button>}
            {me ? <button type="button" className={`btn ${me.ready ? 'btn--ghost' : 'btn--primary'}`} disabled={!me.deck} onClick={() => send({ type: 'setReady', ready: !me.ready })}>{t(me.ready ? 'unready' : 'ready')}</button> : <span role="status">{t('waitingSeat')}</span>}
            {lobby.host && <button type="button" className="btn btn--primary" disabled={!canStart} onClick={() => send({ type: 'startOnlineMatch' })}>{t('startOnline')}</button>}
          </div>
          {engine.error && <p className="error" role="alert">{engine.error}</p>}
        </section>
        <section className="online__chat" aria-label={t('chat')}>
          <h2>{t('chat')}</h2>
          <div className="online__messages" role="log" aria-live="polite">
            {engine.chat.map((entry, i) => <p key={i} className={entry.kind === 'player' ? '' : 'muted'}><strong>{entry.source || t('server')}</strong> {entry.text}</p>)}
            <div ref={chatEnd} />
          </div>
          <form className="online__compose" onSubmit={(event) => { event.preventDefault(); if (message.trim()) { send({ type: 'chat', text: message }); setMessage(''); } }}>
            <input className="input" aria-label={t('chatMessage')} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
            <button className="btn btn--primary" type="submit" disabled={!message.trim()}>{t('sendMessage')}</button>
          </form>
        </section>
      </div>
    </main>
  );
}
