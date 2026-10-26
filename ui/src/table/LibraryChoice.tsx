import { useState } from 'react';
import type { Choice } from '../engine';
import type { Engine } from '../useEngine';
import { useT } from '../i18n';
import { cardImage } from '../images';
import { placementAnswer, placementIndices } from './libraryPlacement';

/** Shared Scry, Surveil, Explore and top-of-library ordering interface; destinations come from Forge. */
export function LibraryChoice({ choice, answer, hover }: { choice: Choice; answer: Engine['answer']; hover: (i: number) => void }) {
  const t = useT();
  const options = choice.options ?? [];
  const { movable } = placementIndices(choice);
  const [top, setTop] = useState(movable);
  const [moved, setMoved] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const destination = choice.placement === 'graveyard' ? 'toGraveyard' : 'toBottom';
  const orderOnly = choice.placement === 'top';
  const transfer = (id: number, fromTop: boolean) => {
    if (fromTop) { setTop(top.filter(i => i !== id)); setMoved([...moved, id]); }
    else { setMoved(moved.filter(i => i !== id)); setTop([...top, id]); }
  };
  const reorder = (ids: number[], index: number, delta: number, inTop: boolean) => {
    const next = [...ids]; [next[index], next[index + delta]] = [next[index + delta], next[index]];
    if (inTop) setTop(next); else setMoved(next);
  };
  const rows = (ids: number[], inTop: boolean) => <ol className="library-choice__cards">
    {ids.map((id, index) => {
      const option = options[id], src = option.card && !option.card.hidden ? cardImage(option.card.imageKey, 'crop') : null;
      return <li key={id} className="library-choice__card" onMouseEnter={() => hover(id)} onFocus={() => hover(id)}>
        {src && <img src={src} alt="" onError={e => { e.currentTarget.hidden = true; }} />}
        <span>{option.label}</span>
        <div className="library-choice__actions">
          {!orderOnly && <button type="button" className="btn btn--ghost" onClick={() => transfer(id, inTop)}>{t(inTop ? destination : 'toTop')}</button>}
          {ids.length > 1 && <>
            <button type="button" className="btn btn--ghost" disabled={index === 0} aria-label={t('moveUp', { name: option.label })} onClick={() => reorder(ids, index, -1, inTop)}>↑</button>
            <button type="button" className="btn btn--ghost" disabled={index === ids.length - 1} aria-label={t('moveDown', { name: option.label })} onClick={() => reorder(ids, index, 1, inTop)}>↓</button>
          </>}
        </div>
      </li>;
    })}
  </ol>;
  const picked = placementAnswer(choice, top, moved);
  const min = Math.max(0, choice.min ?? 0), max = choice.max === undefined || choice.max < 0 ? options.length : choice.max;
  const valid = choice.kind === 'arrange' || picked.length >= min && picked.length <= max;
  return <>
    <div className="library-choice">
      <section aria-label={t('toTop')}><h3>{t('toTop')} <span>({top.length})</span></h3>{rows(top, true)}</section>
      {!orderOnly && <section aria-label={t(destination)}><h3>{t(destination)} <span>({moved.length})</span></h3>{rows(moved, false)}</section>}
    </div>
    <div className="choice__buttons"><button type="button" className="btn btn--primary" disabled={!valid || submitted} onClick={() => { setSubmitted(true); answer({ picked }); }}>{t('confirmLibraryPlacement')}</button></div>
  </>;
}
