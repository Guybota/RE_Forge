import { useEffect, useRef, useState } from 'react';
import type { CardState, Choice, GameState } from '../engine';
import type { Engine } from '../useEngine';
import { useT } from '../i18n';
import { cardImage } from '../images';

type Props = {
  choice: Choice;
  answer: Engine['answer'];
  onHover: (card: CardState | null) => void;
  cards: GameState;
};

/** Every question Forge asks mid-game: pick from a list, yes/no, order, split an amount, type text. */
export function ChoiceDialog({ choice, answer, onHover, cards }: Props) {
  const t = useT();
  const title = choice.title || (choice.kind === 'reveal' ? t('revealedCards') : '');
  const ref = useRef<HTMLDialogElement>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { d?.close(); onHover(null); };
  }, []);

  const options = (choice.options ?? []).map((o) => ({ ...o, label: o.card?.hidden ? t('hiddenCard') : o.label }));
  const presented = { ...choice, options };
  const byId = new Map(cards.players.flatMap((p) => Object.values(p.zones).flat()).map((c) => [c.id, c]));
  const cardAt = (i: number) => options[i]?.card ?? byId.get(options[i]?.cardId ?? -1) ?? null;
  const hover = (i: number) => { setPreviewIndex(i); onHover(cardAt(i)); };
  const preview = cardAt(previewIndex);
  const hasCards = options.some((_, i) => cardAt(i) && !cardAt(i)?.hidden);

  return (
    // Escape can't dismiss: Forge is waiting for an answer.
    <dialog ref={ref} className={`choice ${hasCards ? 'choice--cards' : ''}`} onCancel={(e) => e.preventDefault()} aria-label={title}>
      <h2 className="choice__title">{title}</h2>
      {choice.invalid && <p className="choice__error" role="alert">{t('invalidChoice')}</p>}
      <div className="choice__layout">
      <div className="choice__question">
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
      {(choice.kind === 'choose' || choice.kind === 'order') && <Pick choice={presented} answer={answer} hover={hover} />}
      {choice.kind === 'arrange' && <Arrange choice={presented} answer={answer} hover={hover} />}
      {choice.kind === 'amounts' && <Amounts choice={presented} answer={answer} hover={hover} />}
      {choice.kind === 'text' && <TextInput choice={choice} answer={answer} />}
      {choice.kind === 'sideboard' && <Sideboard choice={choice} answer={answer} />}
      </div>
      {hasCards && <aside className="choice__preview">{preview && !preview.hidden && <ChoicePreview key={preview.id} card={preview} />}</aside>}
      </div>
    </dialog>
  );
}

function ChoicePreview({ card }: { card: CardState }) {
  const [failed, setFailed] = useState<string | null>(null);
  const image = cardImage(card.imageKey, 'full');
  if (image && failed !== image) return <img src={image} alt={card.name ?? ''} onError={() => setFailed(image)} />;
  return <><h3>{card.name}</h3><p>{card.type}</p><p>{card.text}</p></>;
}

function Reveal({ labels, onDone, hover }: { labels: string[]; onDone: () => void; hover: (i: number) => void }) {
  const t = useT();
  return (
    <>
      <ul className="choice__list">
        {labels.map((l, i) => <li key={i} tabIndex={0} onMouseEnter={() => hover(i)} onFocus={() => hover(i)}>{l}</li>)}
      </ul>
      <div className="choice__buttons">
        <button type="button" className="btn btn--primary" onClick={onDone} autoFocus>{t('ok')}</button>
      </div>
    </>
  );
}

/** Pick between min and max options; for "order" the click order is the answer. */
function Pick({ choice, answer, hover }: { choice: Choice; answer: Engine['answer']; hover: (i: number) => void }) {
  const options = choice.options ?? [];
  const min = Math.max(0, choice.min ?? 1);
  const max = choice.max === undefined || choice.max < 0 ? options.length : choice.max;
  const ordered = choice.kind === 'order';
  const [query, setQuery] = useState('');
  // When every item must be ordered, start from the order given: usually it doesn't matter and
  // Confirm is one click; clicking items still lets the player reorder them.
  const [picked, setPicked] = useState<number[]>(
    choice.preselected?.length ? choice.preselected : ordered && min >= options.length ? options.map((_, i) => i) : [],
  );
  const t = useT();

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
  const indices = ordered ? [...picked, ...options.map((_, i) => i).filter((i) => !picked.includes(i))] : options.map((_, i) => i);
  const move = (index: number, delta: number) => setPicked((current) => {
    const result = [...current];
    const at = result.indexOf(index);
    [result[at], result[at + delta]] = [result[at + delta], result[at]];
    return result;
  });
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

  return (
    <>
      {!ordered && options.length >= 8 && <input className="input choice__search" type="search" aria-label={t('searchChoices')} value={query} onChange={(e) => setQuery(e.target.value)} />}
      <ul className="choice__list">
        {indices.filter((i) => normalize(options[i].label).includes(normalize(query))).map((i) => {
          const o = options[i];
          const at = picked.indexOf(i);
          return (
            <li key={i} className="choice__ordered-row">
              <button type="button" className={`choice__option ${at >= 0 ? 'is-picked' : ''}`} onClick={() => toggle(i)} onMouseEnter={() => hover(i)} onFocus={() => hover(i)} aria-pressed={at >= 0}>
                {ordered && at >= 0 && <span className="choice__order">{at + 1}</span>}
                {o.label}
              </button>
              {ordered && at >= 0 && <>
                <button type="button" className="btn btn--ghost" disabled={at === 0} aria-label={t('moveUp', { name: o.label })} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn btn--ghost" disabled={at === picked.length - 1} aria-label={t('moveDown', { name: o.label })} onClick={() => move(i, 1)}>↓</button>
              </>}
            </li>
          );
        })}
      </ul>
      <div className="choice__buttons">
        {!instant && <span className="choice__constraint">{min === max ? t('chooseExactly', { n: min }) : t('chooseBetween', { min, max })}</span>}
        {instant && min === 0 && <button type="button" className="btn btn--ghost" onClick={() => answer({ picked: [] })}>{t('none')}</button>}
        {!instant && (
          <button type="button" className="btn btn--primary" disabled={!valid} onClick={() => answer({ picked })}>
            {t(ordered ? 'confirmOrderCount' : 'confirmChoiceCount', { n: picked.length })}
          </button>
        )}
      </div>
    </>
  );
}

function Arrange({ choice, answer, hover }: { choice: Choice; answer: Engine['answer']; hover: (i: number) => void }) {
  const t = useT();
  const options = choice.options ?? [];
  const [order, setOrder] = useState(options.map((_, i) => i));
  const movable = new Set(choice.movable ?? []);
  const move = (id: number, destination: number) => setOrder((current) => {
    const result = current.filter((i) => i !== id);
    result.splice(destination, 0, id);
    return result;
  });
  return <>
    <ol className="choice__list">
      {order.map((id, position) => {
        if (!choice.toAnywhere && !movable.has(id)) {
          if (position > 0 && !movable.has(order[position - 1])) return null;
          let count = 1;
          while (position + count < order.length && !movable.has(order[position + count])) count++;
          return <li key={id} className="choice__fixed">{t('otherCards', { n: count })}</li>;
        }
        const label = options[id].label;
        return <li key={id} className="choice__arrange-row" onMouseEnter={() => hover(id)} onFocus={() => hover(id)}>
          <span>{label}</span>
          {movable.has(id) && <div>
            {(choice.toTop || choice.toAnywhere) && <button type="button" className="btn btn--ghost" disabled={position === 0} title={t('toTop')} onClick={() => move(id, 0)}>{t('toTop')}</button>}
            {(choice.toBottom || choice.toAnywhere) && <button type="button" className="btn btn--ghost" disabled={position === order.length - 1} title={t('toBottom')} onClick={() => move(id, order.length - 1)}>{t('toBottom')}</button>}
            {choice.toAnywhere && <>
              <button type="button" className="btn btn--ghost" disabled={position === 0} aria-label={t('moveUp', { name: label })} onClick={() => move(id, position - 1)}>↑</button>
              <button type="button" className="btn btn--ghost" disabled={position === order.length - 1} aria-label={t('moveDown', { name: label })} onClick={() => move(id, position + 1)}>↓</button>
            </>}
          </div>}
        </li>;
      })}
    </ol>
    <div className="choice__buttons"><button type="button" className="btn btn--primary" onClick={() => answer({ picked: order })}>{t('confirmOrderCount', { n: order.length })}</button></div>
  </>;
}

/**
 * Between games of a match: click a card in the deck to move one copy to the sideboard, or the other way round.
 * Answers how many copies of each printing go in the deck; Forge asks again if the deck size is wrong.
 */
function Sideboard({ choice, answer }: { choice: Choice; answer: Engine['answer'] }) {
  const t = useT();
  const cards = choice.cards ?? [];
  const [deck, setDeck] = useState(() => cards.map((c) => c.main));
  const move = (i: number, delta: number) => setDeck((d) => d.map((n, j) => (j === i ? n + delta : n)));
  const order = cards.map((_, i) => i).sort((a, b) => cards[a].cmc - cards[b].cmc || cards[a].name.localeCompare(cards[b].name));
  const inDeck = deck.reduce((n, q) => n + q, 0);
  const inSide = cards.reduce((n, c, i) => n + c.main + c.side - deck[i], 0);
  const line = (i: number, qty: number, toDeck: boolean) => (
    <li key={i} className="modes__line">
      <button type="button" aria-label={t(toDeck ? 'moveToDeck' : 'moveToSide', { name: cards[i].name })} onClick={() => move(i, toDeck ? 1 : -1)}>
        <span className="import__qty">{qty}</span><span className="modes__line-name">{cards[i].name}</span>
      </button>
    </li>
  );
  return (
    <div className="choice__sideboard">
      <section>
        <h3>{t('sideboardDeck', { n: inDeck, target: choice.deckSize ?? inDeck })}</h3>
        <ul className="modes__lines">{order.filter((i) => deck[i] > 0).map((i) => line(i, deck[i], false))}</ul>
      </section>
      <section>
        <h3>{t('sideboardSide', { n: inSide })}</h3>
        <ul className="modes__lines">{order.filter((i) => cards[i].main + cards[i].side - deck[i] > 0).map((i) => line(i, cards[i].main + cards[i].side - deck[i], true))}</ul>
      </section>
      <button type="button" className="btn btn--primary" onClick={() => answer({ amounts: deck })}>{t('confirmDeck')}</button>
    </div>
  );
}

function Amounts({ choice, answer, hover }: { choice: Choice; answer: Engine['answer']; hover: (i: number) => void }) {
  const options = choice.options ?? [];
  const total = choice.total ?? 0;
  const initial = choice.initialAmounts ?? options.map((_, i) => i === 0 ? total : 0);
  const [amounts, setAmounts] = useState<number[]>(initial);
  const left = total - amounts.reduce((a, b) => a + b, 0);
  const t = useT();
  const change = (i: number, delta: number) =>
    setAmounts((a) => a.map((v, j) => (j === i ? Math.max(choice.minimums?.[i] ?? 0, Math.min(v + delta, v + left, choice.maximums?.[i] ?? total)) : v)));
  let earlierHasLethal = true;
  const legal = amounts.every((amount, i) => {
    const allowed = amount >= (choice.minimums?.[i] ?? 0) && amount <= (choice.maximums?.[i] ?? total)
      && (choice.divideFreely || amount === 0 || !choice.ordered && i !== choice.defenderIndex || earlierHasLethal);
    if (choice.lethal && i !== choice.defenderIndex) earlierHasLethal &&= amount >= choice.lethal[i];
    return allowed;
  });

  return (
    <>
      <ul className="choice__list">
        {options.map((o, i) => (
          <li key={i} className="choice__amount" onMouseEnter={() => hover(i)} onFocus={() => hover(i)}>
            <span>{o.label}{choice.lethal && i !== choice.defenderIndex && <small>{t('lethalDamage', { n: choice.lethal[i] })}</small>}</span>
            <button type="button" className="btn btn--ghost" onClick={() => change(i, -1)} aria-label={t('less', { name: o.label })} disabled={amounts[i] <= (choice.minimums?.[i] ?? 0)}>−</button>
            <output>{amounts[i]}</output>
            <button type="button" className="btn btn--ghost" onClick={() => change(i, 1)} aria-label={t('more', { name: o.label })} disabled={left === 0 || amounts[i] >= (choice.maximums?.[i] ?? total)}>+</button>
          </li>
        ))}
      </ul>
      <div className="choice__buttons">
        <span className="muted">{left > 0 ? t('left', { n: left }) : ''}</span>
        <button type="button" className="btn btn--ghost" onClick={() => setAmounts([...initial])}>{t('autoAssign')}</button>
        {choice.maySkip && <button type="button" className="btn btn--ghost" onClick={() => answer({ skip: true })}>{t('skipDamage')}</button>}
        <button type="button" className="btn btn--primary" disabled={left !== 0 || !legal} title={!legal ? t(choice.ordered ? 'damageOrderHint' : 'trampleHint') : undefined} onClick={() => answer({ amounts })}>{t('confirmDistribution', { n: total - left })}</button>
      </div>
    </>
  );
}

function TextInput({ choice, answer }: { choice: Choice; answer: Engine['answer'] }) {
  const [value, setValue] = useState(choice.initial ?? '');
  const t = useT();
  return (
    <form className="choice__buttons" onSubmit={(e) => { e.preventDefault(); answer({ value: choice.numeric ? String(Number(value)) : value }); }}>
      <input className="input" aria-label={choice.title} type={choice.numeric ? 'number' : 'text'} step={choice.numeric ? 1 : undefined}
        min={choice.numeric ? choice.numberMin ?? -2147483648 : undefined} max={choice.numeric ? choice.numberMax ?? 2147483647 : undefined}
        required={choice.numeric} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <button type="button" className="btn btn--ghost" onClick={() => answer({ value: null })}>{t('cancel')}</button>
      <button type="submit" className="btn btn--primary">{t('ok')}</button>
    </form>
  );
}
