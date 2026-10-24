import { useEffect, useRef, useState } from 'react';
import type { PhaseStops } from '../engine';
import { useT } from '../i18n';
import { DEFAULT_SKIN, SKINS } from '../skins';
import type { Engine } from '../useEngine';
import { phaseKey } from './cards';

export function GameMenu({ engine, onClose, onLeave }: { engine: Engine; onClose: () => void; onLeave: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [stops, setStops] = useState<PhaseStops>(engine.info?.phaseStops ?? { mine: [], opponents: [] });
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    if (engine.info) setStops(engine.info.phaseStops);
    setBusy(false);
  }, [engine.info]);
  useEffect(() => {
    if (engine.error) {
      if (engine.info) setStops(engine.info.phaseStops);
      setBusy(false);
    }
  }, [engine.error, engine.info]);

  const changeStop = (row: keyof PhaseStops, phase: string, checked: boolean) => {
    const next = { ...stops, [row]: checked ? [...stops[row], phase] : stops[row].filter((p) => p !== phase) };
    setStops(next);
    setBusy(true);
    engine.send({ type: 'setPhaseStops', stops: next });
  };

  return (
    <dialog ref={ref} className="choice game-menu" aria-labelledby="game-menu-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="game-menu__head">
        <h2 id="game-menu-title" className="choice__title">{t('gameMenu')}</h2>
        <button type="button" className="btn btn--ghost" onClick={onClose} autoFocus>{t('close')}</button>
      </header>
      <div className="game-menu__body" aria-busy={busy}>
        <label className="game-menu__skin">
          <span>{t('skin')}</span>
          <select className="input" value={engine.info?.skin ?? DEFAULT_SKIN} disabled={busy} onChange={(e) => {
            setBusy(true);
            engine.send({ type: 'setSkin', skin: e.target.value });
          }}>
            {SKINS.map((skin) => <option value={skin.id} key={skin.id}>{t(skin.name)}</option>)}
          </select>
        </label>
        <h3 className="game-menu__section" title={t('phaseStopsHint')}>{t('phaseStops')}</h3>
        <table className="game-menu__phases">
          <thead><tr><th scope="col">{t('phase')}</th><th scope="col">{t('yourTurn')}</th><th scope="col">{t('opponentsTurn')}</th></tr></thead>
          <tbody>
            {engine.info?.phaseOptions.map((phase) => {
              const key = phaseKey(phase);
              if (!key) return null;
              return <tr key={phase}>
                <th scope="row">{t(key)}</th>
                {(['mine', 'opponents'] as const).map((row) => <td key={row}>
                  <label className="game-menu__check">
                    <input type="checkbox" aria-label={t('phaseStopFor', { phase: t(key), turn: t(row === 'mine' ? 'yourTurn' : 'opponentsTurn') })}
                      checked={stops[row].includes(phase)} disabled={busy} onChange={(e) => changeStop(row, phase, e.target.checked)} />
                  </label>
                </td>)}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {engine.error && <p className="error" role="alert">{engine.error}</p>}
      <footer className="game-menu__footer">
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setBusy(true); engine.send({ type: 'setPhaseStops', stops: null }); }}>{t('resetPhaseStops')}</button>
        <span className="muted" role="status">{busy ? t('saving') : ''}</span>
        <span className="game-menu__exit">
          <button type="button" className="btn btn--ghost" title={t('leaveGameHint')} onClick={() => { onClose(); onLeave(); }}>{t('leaveGame')}</button>
          <button type="button" className="btn btn--ghost game-menu__concede" onClick={() => { onClose(); engine.send({ type: 'action', action: 'concede' }); }}>{t('concede')}</button>
        </span>
      </footer>
    </dialog>
  );
}
