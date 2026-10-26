import { useEffect, useMemo, useState } from 'react';
import type { PuzzleInfo } from '../engine';
import { useT, type MessageKey } from '../i18n';
import type { Engine } from '../useEngine';
import './modes.css';

const DIFFICULTIES: { id: string; label: MessageKey }[] = [
  { id: 'Common', label: 'rarityCommon' }, { id: 'Uncommon', label: 'rarityUncommon' }, { id: 'Rare', label: 'rarityRare' },
  { id: 'Mythic', label: 'rarityMythic' }, { id: 'Special', label: 'raritySpecial' },
];
const GOALS: Record<string, MessageKey> = { win: 'goalWin', survive: 'goalSurvive' };

/** Forge's puzzles: pick one by difficulty, read its situation and goal, play it against the AI. */
export function PuzzleScreen({ engine, onBack }: { engine: Engine; onBack: () => void }) {
  const t = useT();
  const { send } = engine;
  const puzzles = engine.modes.puzzles;
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Also refreshes the solved marks when coming back from a puzzle.
  useEffect(() => { send({ type: 'puzzles' }); }, [send]);
  const shown = useMemo(() => (puzzles ?? []).filter((p) => !difficulty || p.difficulty === difficulty), [puzzles, difficulty]);
  const puzzle = puzzles?.find((p) => p.id === selected) ?? shown[0];
  const label = (p: PuzzleInfo) => {
    const d = DIFFICULTIES.find((x) => x.id === p.difficulty);
    return d ? t(d.label) : p.difficulty;
  };

  return (
    <main className="campaign">
      <header className="campaign__head">
        <button className="btn btn--ghost" type="button" onClick={onBack}>{t('mainMenu')}</button>
        <div><h1>{t('puzzlesMode')}</h1></div>
      </header>
      {engine.error && <p className="error" role="alert">{engine.error}</p>}
      <div className="modes__split">
        <section className="modes__list" aria-label={t('puzzlesMode')}>
          <div className="modes__filters" role="group" aria-label={t('puzzleDifficulty')}>
            <button type="button" className="btn btn--ghost" aria-pressed={!difficulty} onClick={() => setDifficulty(null)}>{t('allDifficulties')}</button>
            {DIFFICULTIES.map((d) => <button key={d.id} type="button" className="btn btn--ghost" aria-pressed={difficulty === d.id} onClick={() => setDifficulty(d.id)}>{t(d.label)}</button>)}
          </div>
          <ul className="modes__items">
            {shown.map((p) => <li key={p.id}>
              <button type="button" className={`modes__item ${p.id === puzzle?.id ? 'is-on' : ''}`} aria-current={p.id === puzzle?.id} onClick={() => setSelected(p.id)}>
                <span className="modes__item-name">{p.name}</span>
                <span className="muted">{label(p)}{p.solved ? ` · ${t('puzzleSolved')}` : ''}</span>
              </button>
            </li>)}
          </ul>
        </section>
        {puzzle && <article className="modes__detail" aria-live="polite">
          <h2>{puzzle.name}</h2>
          <p className="muted">{label(puzzle)}{puzzle.solved ? ` · ${t('puzzleSolved')}` : ''}</p>
          <p><strong>{t('puzzleGoal')}:</strong> {GOALS[puzzle.goal.toLowerCase()] ? t(GOALS[puzzle.goal.toLowerCase()]) : puzzle.goal}
            {puzzle.turns && ` · ${t('turnsLimit', { n: puzzle.turns })}`}</p>
          {puzzle.description && <p className="modes__description">{puzzle.description}</p>}
          <button type="button" className="btn btn--primary" onClick={() => send({ type: 'startPuzzle', id: puzzle.id })}>{t('startPuzzle')}</button>
        </article>}
      </div>
    </main>
  );
}
