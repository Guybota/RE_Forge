import { useEffect, useRef, useState } from 'react';
import type { CardState, Choice, GameState } from '../engine';
import type { Engine } from '../useEngine';

type Props = {
  choice: Choice;
  answer: Engine['answer'];
  onHover: (card: CardState | null) => void;
  cards: GameState;
};

/** Every question Forge asks mid-game: pick from a list, yes/no, order, split an amount, type text. */
export function ChoiceDialog({ choice, answer, onHover, cards }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const options = choice.options ?? [];
  const byId = new Map(cards.players.flatMap((p) => Object.values(p.zones).flat()).map((c) => [c.id, c]));
  const hover = (i: number) => onHover(byId.get(options[i]?.cardId ?? -1) ?? null);

  return (
    // Escape can't dismiss: Forge is waiting for an answer.
    <dialog ref={ref} className="choice" onCancel={(e) => e.preventDefault()} aria-label={choice.title}>
      <h2 className="choice__title">{choice.title}</h2>
      {choice.kind === 'reveal' && <Reveal labels={options.map((o) => o.label)} onDone={() => answer({ picked: [] })} hover={hover} />}
      {choice.kind === 'confirm' && (
        <div className="choice__buttons">
          {options.map((o, i) => (
            <button key={i} type="button" className={`btn ${i === 0 ? 'btn--primary' : 'btn--ghost'}`} onClick={() => answer({ picked: [i] })}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      {(choice.kind === 'choose' || choice.kind === 'order') && <Pick choice={choice} answer={answer} hover={hover} />}
      {choice.kind === 'amounts' && <Amounts choice={choice} answer={answer} />}
      {choice.kind === 'text' && <TextInput choice={choice} answer={answer} />}
    </dialog>
  );
}

function Reveal({ labels, onDone, hover }: { labels: string[]; onDone: () => void; hover: (i: number) => void }) {
  return (
    <>
      <ul className="choice__list">
        {labels.map((l, i) => <li key={i} onMouseEnter={() => hover(i)}>{l}</li>)}
      </ul>
      <div className="choice__buttons">
        <button type="button" className="btn btn--primary" onClick={onDone} autoFocus>OK</button>
      </div>
    </>
  );
}

/** Pick between min and max options; for "order" the click order is the answer. */
function Pick({ choice, answer, hover }: { choice: Choice; answer: Engine['answer']; hover: (i: number) => void }) {
  const options = choice.options ?? [];
  const min = Math.max(0, choice.min ?? 1);
  const max = choice.max === undefined || choice.max < 0 ? options.length : choice.max;
  const [picked, setPicked] = useState<number[]>(choice.preselected ?? []);
  const ordered = choice.kind === 'order';

  // A single required pick answers on click; anything else needs a confirm.
  const instant = max === 1 && !ordered;
  const toggle = (i: number) => {
    if (instant) {
      answer({ picked: [i] });
      return;
    }
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < max ? [...p, i] : p));
  };
  const valid = picked.length >= min && picked.length <= max;

  return (
    <>
      <ul className="choice__list">
        {options.map((o, i) => {
          const at = picked.indexOf(i);
          return (
            <li key={i}>
              <button type="button" className={`choice__option ${at >= 0 ? 'is-picked' : ''}`} onClick={() => toggle(i)} onMouseEnter={() => hover(i)} aria-pressed={at >= 0}>
                {ordered && at >= 0 && <span className="choice__order">{at + 1}</span>}
                {o.label}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="choice__buttons">
        {instant && min === 0 && <button type="button" className="btn btn--ghost" onClick={() => answer({ picked: [] })}>Nenhum</button>}
        {!instant && (
          <button type="button" className="btn btn--primary" disabled={!valid} onClick={() => answer({ picked })}>
            Confirmar{max > 1 ? ` · ${picked.length}` : ''}
          </button>
        )}
      </div>
    </>
  );
}

function Amounts({ choice, answer }: { choice: Choice; answer: Engine['answer'] }) {
  const options = choice.options ?? [];
  const total = choice.total ?? 0;
  const [amounts, setAmounts] = useState<number[]>(() => options.map((_, i) => (i === 0 ? total : 0)));
  const left = total - amounts.reduce((a, b) => a + b, 0);
  const change = (i: number, delta: number) =>
    setAmounts((a) => a.map((v, j) => (j === i ? Math.max(0, Math.min(v + delta, v + left)) : v)));

  return (
    <>
      <ul className="choice__list">
        {options.map((o, i) => (
          <li key={i} className="choice__amount">
            <span>{o.label}</span>
            <button type="button" className="btn btn--ghost" onClick={() => change(i, -1)} aria-label={`Menos para ${o.label}`} disabled={amounts[i] === 0}>−</button>
            <output>{amounts[i]}</output>
            <button type="button" className="btn btn--ghost" onClick={() => change(i, 1)} aria-label={`Mais para ${o.label}`} disabled={left === 0}>+</button>
          </li>
        ))}
      </ul>
      <div className="choice__buttons">
        <span className="muted">{left > 0 ? `Faltam ${left}` : ''}</span>
        <button type="button" className="btn btn--primary" disabled={left !== 0} onClick={() => answer({ amounts })}>Confirmar</button>
      </div>
    </>
  );
}

function TextInput({ choice, answer }: { choice: Choice; answer: Engine['answer'] }) {
  const [value, setValue] = useState(choice.initial ?? '');
  return (
    <form className="choice__buttons" onSubmit={(e) => { e.preventDefault(); answer({ value }); }}>
      <input className="input" aria-label={choice.title} inputMode={choice.numeric ? 'numeric' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <button type="button" className="btn btn--ghost" onClick={() => answer({ value: null })}>Cancelar</button>
      <button type="submit" className="btn btn--primary">OK</button>
    </form>
  );
}
