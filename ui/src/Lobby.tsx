import { useEffect, useRef, useState } from 'react';
import { useT } from './i18n';
import type { Engine } from './useEngine';

const NAME_STORAGE = 'reforge.playerName';
const RELAY_ERRORS = ['relayUnavailable', 'relayInvalidCode', 'relayRoomMissing', 'relayRoomFull', 'relayRateLimited', 'relayDisconnected'] as const;

export function Lobby({ engine, onBack }: { engine: Engine; onBack: () => void }) {
  const t = useT();
  const { lobby, send } = engine;
  const errorKey = RELAY_ERRORS.find(key => key === engine.error);
  const errorText = errorKey ? t(errorKey) : engine.error;
  const [mode, setMode] = useState<'host' | 'join'>('host');
  const [transport, setTransport] = useState<'relay' | 'direct'>(() => engine.info?.relayAvailable ? 'relay' : 'direct');
  const [code, setCode] = useState('');
  const [name, setName] = useState(() => {
    try { return localStorage.getItem(NAME_STORAGE) ?? ''; } catch { return ''; }
  });
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
    <main className="import">
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={back} disabled={busy}>{t('back')}</button>
        <h1>{t('online')}</h1>
      </header>
      <form className="home__form online__form" onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        try { localStorage.setItem(NAME_STORAGE, name.trim()); } catch { /* typed again next time */ }
        if (transport === 'relay') send(mode === 'host' ? { type: 'hostGame', name, transport } : { type: 'joinGame', name, transport, code });
        else send(mode === 'host' ? { type: 'hostGame', name, port, upnp } : { type: 'joinGame', name, address });
      }}>
        <fieldset className="segmented" disabled={busy}>
          {(['host', 'join'] as const).map((m) => (
            <label key={m} className={mode === m ? 'is-on' : ''}>
              <input type="radio" name="online-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
              {t(m === 'host' ? 'hostGame' : 'joinGame')}
            </label>
          ))}
        </fieldset>
        <fieldset className="segmented" disabled={busy} aria-label={t('connectionMethod')}>
          <label className={transport === 'relay' ? 'is-on' : ''} title={engine.info?.relayAvailable ? t('roomHint') : t('roomsUnavailable')}>
            <input type="radio" name="online-transport" checked={transport === 'relay'} disabled={!engine.info?.relayAvailable} onChange={() => setTransport('relay')} />{t('byCode')}
          </label>
          <label className={transport === 'direct' ? 'is-on' : ''} title={t('portHint')}>
            <input type="radio" name="online-transport" checked={transport === 'direct'} onChange={() => setTransport('direct')} />{t('directConnection')}
          </label>
        </fieldset>
        <label className="field-label">{t('playerName')}<input className="input" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} autoComplete="nickname" /></label>
        {transport === 'relay' ? (mode === 'join' && <label className="field-label">{t('roomCode')}<input className="input" required minLength={8} maxLength={9} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[ -]/g, ''))} disabled={busy} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="ABCD2345" /></label>) : mode === 'host' ? <>
          <label className="field-label" title={t('portHint')}>{t('port')}<input className="input" type="number" min={1024} max={65535} required value={port} onChange={(e) => setPort(Number(e.target.value))} disabled={busy} /></label>
          <label className="online__check" title={t('portHint')}><input type="checkbox" checked={upnp} onChange={(e) => setUpnp(e.target.checked)} disabled={busy} />{t('autoPort')}</label>
        </> : <label className="field-label">{t('address')}<input className="input" required value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} placeholder="192.168.1.10:36743" /></label>}
        <button type="submit" className="btn btn--primary" disabled={busy || !name.trim() || transport === 'relay' && mode === 'join' && !/^[A-HJ-NP-Z2-9]{8}$/.test(code)}>{busy ? t('connectingOnline') : t(mode === 'host' ? 'hostGame' : 'joinGame')}</button>
        {errorText && <p className="error" role="alert">{errorText}</p>}
      </form>
    </main>
  );

  const me = lobby.slots.find((slot) => slot.index === lobby.localSlot);
  const active = lobby.slots.filter((slot) => slot.kind !== 'open');
  const canStart = active.length >= 2 && active.every((slot) => slot.ready && slot.deck);
  return (
    <main className="online">
      <header className="online__head"><h1>{t('lobby')}</h1><button type="button" className="btn btn--ghost" onClick={back}>{t('leaveLobby')}</button></header>
      {(lobby.host || lobby.roomCode) && <div className="online__addresses" title={t(lobby.roomCode ? 'roomHint' : 'portHint')}>
        <span className="muted">{t(lobby.roomCode ? 'roomCode' : 'shareAddress')}</span>
        {(lobby.roomCode ? [lobby.roomCode] : lobby.addresses).map((url) => <div className="online__address" key={url}>
          <input className="input" aria-label={t(lobby.roomCode ? 'roomCode' : 'shareAddress')} readOnly value={url} onFocus={(e) => e.target.select()} />
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
          {errorText && <p className="error" role="alert">{errorText}</p>}
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
