import { useState } from 'react';
import type { Engine } from './useEngine';

const RANDOM = '';

export function Home({ engine }: { engine: Engine }) {
  const [deck, setDeck] = useState(RANDOM);
  const [opponents, setOpponents] = useState(1);
  const [starting, setStarting] = useState(false);

  const start = () => {
    setStarting(true);
    engine.send({ type: 'startMatch', deck: deck || null, opponents });
  };

  return (
    <main className="home">
      <h1 title={engine.info ? `${engine.info.cards.toLocaleString('pt-PT')} cartas · ${engine.info.editions} edições` : undefined}>RE:Forge</h1>
      <form className="home__form" onSubmit={(e) => { e.preventDefault(); start(); }}>
        <label className="field-label">
          Deck
          <select className="input" value={deck} onChange={(e) => setDeck(e.target.value)}>
            <option value={RANDOM}>Aleatório</option>
            {engine.decks.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <fieldset className="segmented">
          <legend className="field-label">Adversários</legend>
          {[1, 2, 3].map((n) => (
            <label key={n} className={opponents === n ? 'is-on' : ''}>
              <input type="radio" name="opponents" value={n} checked={opponents === n} onChange={() => setOpponents(n)} />
              {n}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="btn btn--primary btn--big" disabled={starting && !engine.error}>{starting && !engine.error ? 'A baralhar…' : 'Jogar Commander'}</button>
        {engine.error && <p className="error">{engine.error}</p>}
      </form>
    </main>
  );
}
