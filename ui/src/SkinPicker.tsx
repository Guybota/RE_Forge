import type { CardState } from './engine';
import { useT } from './i18n';
import { SKINS } from './skins';
import { Card } from './table/Card';
import type { Engine } from './useEngine';


/** First-run step 2 (after the language), and reachable from the home screen. */
export function SkinPicker({ engine, onDone, onBack }: { engine: Engine; onDone?: () => void; onBack?: () => void }) {
  const t = useT();
  const current = engine.info?.skin;
  // What each tile draws: a life total, a creature and the OK button, in that tile's own skin.
  const sample: CardState = { id: -1, name: t('sampleCardName'), cost: '{G}', type: t('sampleCardType'), typeEn: 'Creature — Elf Druid',
    imageKey: 'c:Llanowar Elves|M11', power: 1, toughness: 1 };

  return (
    <main className="home">
      <ul className="skins" aria-label={t('skin')}>
        {SKINS.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              data-skin={s.id}
              className={`skin-tile ${s.id === current ? 'is-on' : ''}`}
              aria-pressed={s.id === current}
              onClick={() => {
                engine.send({ type: 'setSkin', skin: s.id });
                onDone?.();
              }}
            >
              <span className="skin-tile__table" aria-hidden="true">
                <span className="life">40</span>
                <Card card={sample} size="field" />
                <span className="btn btn--primary skin-tile__ok">OK</span>
              </span>
              <span className="skin-tile__name">{t(s.name)}</span>
            </button>
          </li>
        ))}
      </ul>
      {onBack && <button type="button" className="btn btn--ghost" onClick={onBack}>{t('language')}</button>}
    </main>
  );
}
