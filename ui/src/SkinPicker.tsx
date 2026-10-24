import type { CardState } from './engine';
import { useT } from './i18n';
import { SKINS } from './skins';
import { Card } from './table/Card';
import type { Engine } from './useEngine';

// What each tile draws: a life total, a creature and the OK button, in that tile's own skin.
const SAMPLE: CardState = { id: -1, name: 'Llanowar Elves', cost: '{G}', type: 'Creature — Elf Druid', typeEn: 'Creature — Elf Druid', power: 1, toughness: 1 };

/** First-run step 2 (after the language), and reachable from the home screen. */
export function SkinPicker({ engine, onDone }: { engine: Engine; onDone?: () => void }) {
  const t = useT();
  const current = engine.info?.skin;

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
                <Card card={SAMPLE} size="field" />
                <span className="btn btn--primary skin-tile__ok">OK</span>
              </span>
              <span className="skin-tile__name">{t(s.name)}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
