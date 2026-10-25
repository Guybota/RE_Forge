import { useState } from 'react';
import { deckStatistics, drawProbability, matchesDeckFilter, type DeckEntry, type DeckFilter } from './deckAnalysis';
import { useT, type MessageKey } from './i18n';

const COLOR_LABELS: MessageKey[] = ['colorW', 'colorU', 'colorB', 'colorR', 'colorG', 'colorC'];
export function DeckStatistics({ entries, filter, onFilter, includeCommanders, onIncludeCommanders }: { entries: DeckEntry[]; filter: DeckFilter; onFilter: (filter: DeckFilter) => void; includeCommanders: boolean; onIncludeCommanders: (include: boolean) => void }) {
  const t = useT();
  const [draws, setDraws] = useState(7);
  const [minimum, setMinimum] = useState(1);
  const stats = deckStatistics(entries, includeCommanders);
  const main = entries.filter(c => !c.commander);
  const population = main.reduce((n, c) => n + c.qty, 0);
  const successes = main.filter(c => filter ? matchesDeckFilter(c, filter) : c.group === 'land').reduce((n, c) => n + c.qty, 0);
  const tallest = Math.max(1, ...stats.curve.map(b => b.total));
  const number = (n: number) => new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 2 }).format(n);
  const percent = (a: number, b: number) => `${number(b ? a / b * 100 : 0)}%`;
  return <section className="deck-stats" aria-label={t('deckStatistics')}>
    <header className="deck-stats__head"><h2>{t('manaCurve')}</h2>
      <label className="online__check"><input type="checkbox" checked={includeCommanders} onChange={e => onIncludeCommanders(e.target.checked)} />{t('includeCommanders')}</label>
    </header>
    <div className="deck-stats__curve" aria-label={t('manaCurve')}>
      {stats.curve.map(b => <button type="button" key={b.value} className="deck-stats__column"
        aria-pressed={filter?.kind === 'cost' && filter.value === b.value}
        aria-label={t('curveBucket', { value: b.value === 7 ? '7+' : b.value, n: b.total })}
        onClick={() => onFilter(filter?.kind === 'cost' && filter.value === b.value ? null : { kind: 'cost', value: b.value })}>
        <span className="deck-stats__plot"><span className="deck-stats__stack" style={{ height: `${b.total / tallest * 100}%` }}>
          <strong>{b.total}</strong><span className="deck-stats__spells" style={{ flex: b.spells }} /><span className="deck-stats__permanents" style={{ flex: b.permanents }} />
        </span></span><span>{b.value === 7 ? '7+' : b.value}</span>
      </button>)}
    </div>
    <div className="deck-stats__legend"><span><i className="deck-stats__permanents" />{t('permanents')}</span><span><i className="deck-stats__spells" />{t('nonPermanentSpells')}</span></div>
    <dl className="deck-stats__metrics">
      {([['averageMana', stats.average], ['averageWithLands', stats.averageWithLands], ['medianMana', stats.median], ['totalMana', stats.totalMana]] as const).map(([key, n]) => <div key={key}><dt>{t(key)}</dt><dd>{number(n)}</dd></div>)}
    </dl>
    <section className="deck-stats__mana" aria-label={t('manaDistribution')}><h2>{t('manaDistribution')}</h2>
      <div className="deck-stats__colors">{stats.colors.map((c, i) => <div key={c.key} className="deck-stats__color" style={{ '--mana-color': `var(--c-${c.key})` } as React.CSSProperties}>
        <button type="button" className="deck-stats__color-pick" title={t('colorCardsHint')} aria-label={t(COLOR_LABELS[i])} aria-pressed={filter?.kind === 'color' && filter.value === c.bit}
          onClick={() => onFilter(filter?.kind === 'color' && filter.value === c.bit ? null : { kind: 'color', value: c.bit })}>
          <span className={`pip pip--${c.key === 'C' ? 'n' : c.key}`} aria-hidden="true">{c.key === 'C' ? '◇' : ''}</span>
          <strong>{percent(c.cards, stats.spellCount)}</strong><span>{t(COLOR_LABELS[i])}</span>
        </button>
        <span title={t('symbolsHint')}>{t('manaSymbolsShare', { n: c.symbols, percent: percent(c.symbols, stats.symbolCount) })}</span>
        <div className="deck-stats__track" role="meter" aria-label={t('landSourcesColor', { color: t(COLOR_LABELS[i]) })} aria-valuemin={0} aria-valuemax={Math.max(1, stats.landCount)} aria-valuenow={c.sources}><span style={{ width: `${stats.landCount ? c.sources / stats.landCount * 100 : 0}%` }} /></div>
        <span title={t('landSourcesHint')}>{t('landSources', { n: c.sources, total: stats.landCount })}</span>
      </div>)}</div>
      <p className="muted deck-stats__note">{t('multicolorStatsHint')}</p>
    </section>
    <details className="deck-stats__probability"><summary>{t('drawCalculator')}</summary><div className="deck-stats__draws">
      <span>{t(filter ? 'selectedCardsCount' : 'landCardsCount', { n: successes, total: population })}</span>
      <label>{t('cardsDrawn')}<input className="input" type="number" min={0} max={population} value={draws} onChange={e => setDraws(Math.max(0, Math.trunc(Number(e.target.value))))} /></label>
      <label>{t('atLeast')}<input className="input" type="number" min={0} max={draws} value={minimum} onChange={e => setMinimum(Math.max(0, Math.trunc(Number(e.target.value))))} /></label>
      <output>{draws > population || minimum > draws ? t('invalidDrawSample') : percent(drawProbability(population, successes, draws, minimum), 1)}</output>
    </div></details>
  </section>;
}
