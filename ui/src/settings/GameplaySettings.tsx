import { useState } from 'react';
import type { PhaseStops } from '../engine';
import type { Engine } from '../useEngine';
import { useT } from '../i18n';
import { phaseKey } from '../table/cards';

export function GameplaySettings({ engine }: { engine: Engine }) {
  const t = useT();
  const [pending, setPending] = useState<{ info: Engine['info']; stops: PhaseStops } | null>(null);
  // A fresh info snapshot is the engine's acknowledgement; errors revert to its saved values.
  const busy = pending !== null && pending.info === engine.info && !engine.error;
  const stops = busy ? pending.stops : engine.info?.phaseStops ?? { mine: [], opponents: [], autoPass: false };
  const save = (next: PhaseStops | null) => {
    setPending({ info: engine.info, stops: next ?? stops });
    engine.send({ type: 'setPhaseStops', stops: next });
  };
  return <div aria-busy={busy}>
    <h3 className="game-menu__section" title={t('phaseStopsHint')}>{t('phaseStops')}</h3>
    <label className="game-menu__toggle" title={t('autoPassHint')}>
      <input type="checkbox" checked={stops.autoPass} disabled={busy} onChange={e => save({ ...stops, autoPass: e.target.checked })} />
      <span>{t('autoPass')}</span>
    </label>
    <table className="game-menu__phases">
      <thead><tr><th scope="col">{t('phase')}</th><th scope="col">{t('yourTurn')}</th><th scope="col">{t('opponentsTurn')}</th></tr></thead>
      <tbody>{engine.info?.phaseOptions.map(phase => {
        const key = phaseKey(phase);
        return key && <tr key={phase}><th scope="row">{t(key)}</th>
          {(['mine', 'opponents'] as const).map(row => <td key={row}><label className="game-menu__check">
            <input type="checkbox" disabled={busy} checked={stops[row].includes(phase)}
              aria-label={t('phaseStopFor', { phase: t(key), turn: t(row === 'mine' ? 'yourTurn' : 'opponentsTurn') })}
              onChange={e => save({ ...stops, [row]: e.target.checked ? [...stops[row], phase] : stops[row].filter(p => p !== phase) })} />
          </label></td>)}
        </tr>;
      })}</tbody>
    </table>
    <div className="settings-dialog__reset">
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => save(null)}>{t('resetPhaseStops')}</button>
      <span role="status">{busy ? t('saving') : ''}</span>
    </div>
  </div>;
}
