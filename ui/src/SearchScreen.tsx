import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  COLOR_LETTERS, COMPARE_OPS, CRITERIA_FLAGS, FORMATS, MANA_SYMBOLS,
  buildCardSearchQuery, emptyCardSearch, hasSearchCriteria, insertSymbol,
  type CardSearchFilters, type ColorLetter, type CompareOp, type LegalityMode, type PriceCurrency, type SearchChip, type StatKind,
} from './cardSearch';
import { CardInspectDialog } from './CardInspectDialog';
import { CardBeside } from './DeckCards';
import { Unavailable } from './DeckOnline';
import type { CatalogCard, DeckServicesReply } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { ManaSymbol } from './ManaSymbol';
import { cardForInspection } from './table/useCardInspection';
import type { Engine } from './useEngine';

const COLOR_LABEL: Record<ColorLetter | 'C', MessageKey> = {
  W: 'colorW', U: 'colorU', B: 'colorB', R: 'colorR', G: 'colorG', C: 'colorC',
};
const STATS: { id: StatKind; label: MessageKey }[] = [
  { id: 'mv', label: 'searchStatMv' }, { id: 'pow', label: 'statPower' }, { id: 'tou', label: 'statToughness' }, { id: 'loy', label: 'statLoyalty' },
];
const GAMES: { id: 'paper' | 'arena' | 'mtgo'; label: MessageKey }[] = [
  { id: 'paper', label: 'searchGamePaper' }, { id: 'arena', label: 'searchGameArena' }, { id: 'mtgo', label: 'searchGameMtgo' },
];
const RARITIES: { id: 'c' | 'u' | 'r' | 'm'; label: MessageKey }[] = [
  { id: 'c', label: 'searchCommon' }, { id: 'u', label: 'searchUncommon' }, { id: 'r', label: 'searchRare' }, { id: 'm', label: 'searchMythic' },
];
const LEGALITY: { id: LegalityMode; label: MessageKey }[] = [
  { id: 'legal', label: 'searchLegal' }, { id: 'banned', label: 'searchBanned' },
  { id: 'restricted', label: 'searchRestricted' }, { id: 'notlegal', label: 'searchNotLegal' },
];
let nextSearch = 0;

function pictureOf(card: CatalogCard): string | null {
  return card.imageKey ? cardImage(card.imageKey, 'full') : card.imageUrl ?? null;
}

/** Every card Scryfall lists, shown through Forge when the engine knows the printing. */
export function SearchScreen({ engine, onBack }: { engine: Engine; onBack: () => void }) {
  const t = useT();
  const { send } = engine;
  const [filters, setFilters] = useState<CardSearchFilters>(emptyCardSearch);
  const [typeDraft, setTypeDraft] = useState('');
  const [keywordDraft, setKeywordDraft] = useState('');
  const [symbols, setSymbols] = useState<'oracle' | 'mana' | null>(null);
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [total, setTotal] = useState(0);
  const [searchId, setSearchId] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ran, setRan] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [hover, setHover] = useState<{ src: string; anchor: DOMRect } | null>(null);
  const append = useRef(false);
  const oracleRef = useRef<HTMLInputElement>(null);
  const manaRef = useRef<HTMLInputElement>(null);
  const query = buildCardSearchQuery(filters);
  const ready = hasSearchCriteria(filters);
  const patch = (partial: Partial<CardSearchFilters>) => setFilters((current) => ({ ...current, ...partial }));

  const addChip = (key: 'types' | 'criteria', text: string, kind: SearchChip['kind']) => {
    const clean = text.trim();
    if (!clean) return;
    setFilters((current) => {
      if (current[key].some((chip) => chip.text.toLowerCase() === clean.toLowerCase() && chip.kind === kind)) return current;
      return { ...current, [key]: [...current[key], { id: `${key}-${clean}-${current[key].length}`, text: clean, include: true, kind }] };
    });
  };

  useEffect(() => {
    const results = engine.cardResults;
    if (!results || results.type !== 'cardSearch' || results.requestId !== searchId) return;
    setTotal(results.total);
    setHasMore(results.hasMore === true);
    setCards((current) => append.current ? [...current, ...results.cards.filter((c) => !current.some((have) => have.nameEn === c.nameEn && have.set === c.set))] : results.cards);
    append.current = false;
    setBusy(false);
    setFailed(false);
  }, [engine.cardResults, searchId]);

  useEffect(() => {
    const error = (engine.deckServices as Record<string, DeckServicesReply | undefined>).cardSearch;
    if (!error || error.type !== 'servicesError' || error.requestId !== searchId) return;
    if (!append.current) { setCards([]); setTotal(0); setHasMore(false); setOpen(null); }
    append.current = false;
    setBusy(false);
    setFailed(true);
  }, [engine.deckServices, searchId]);

  const run = (nextPage = 1) => {
    if (!ready) return;
    append.current = nextPage > 1;
    const requestId = 2_000_000 + ++nextSearch;
    setSearchId(requestId);
    setPage(nextPage);
    setBusy(true);
    setFailed(false);
    setRan(true);
    if (nextPage === 1) { setCards([]); setTotal(0); setOpen(null); setHasMore(false); }
    send({ type: 'cardSearch', requestId, query, page: nextPage });
  };

  const picked = open != null ? cards[open] : null;

  return (
    <main className="import decks search-page">
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={onBack}>{t('back')}</button>
        <h1>{t('searchTitle')}</h1>
      </header>
      <form className="search-form" onSubmit={(e) => { e.preventDefault(); run(1); }}>
        <Row label={t('searchCardName')}>
          <input className="input" type="search" aria-label={t('searchCardName')} title={t('searchNameHint')} placeholder={t('searchNamePlaceholder')} value={filters.name} onChange={(e) => patch({ name: e.target.value })} />
        </Row>
        <Row label={t('searchOracle')}>
          <div className="search-line">
            <input ref={oracleRef} className="input" type="search" aria-label={t('searchOracle')} title={t('searchOracleHint')} placeholder={t('searchOraclePlaceholder')} value={filters.oracle} onChange={(e) => patch({ oracle: e.target.value })} />
            <button type="button" className="btn btn--ghost" aria-expanded={symbols === 'oracle'} onClick={() => setSymbols(symbols === 'oracle' ? null : 'oracle')}>{t('searchAddSymbol')}</button>
          </div>
          {symbols === 'oracle' && <SymbolPad onPick={(symbol) => patch({ oracle: insertSymbol(filters.oracle, symbol, oracleRef.current) })} />}
          <label className="search-check" title={t('searchOracleTogetherHint')}>
            <input type="checkbox" checked={filters.oracleTogether} onChange={(e) => patch({ oracleTogether: e.target.checked })} />
            {t('searchOracleTogether')}
          </label>
        </Row>
        <Row label={t('searchType')}>
          <div className="search-line">
            <input className="input" type="text" aria-label={t('searchType')} title={t('searchTypePartialHint')} placeholder={t('searchTypePlaceholder')} value={typeDraft} onChange={(e) => setTypeDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip('types', typeDraft, 'keyword'); setTypeDraft(''); } }} />
            <button type="button" className="btn btn--ghost" onClick={() => { addChip('types', typeDraft, 'keyword'); setTypeDraft(''); }}>{t('searchAdd')}</button>
          </div>
          <Chips chips={filters.types} onToggle={(id) => patch({ types: filters.types.map((chip) => chip.id === id ? { ...chip, include: !chip.include } : chip) })}
            onRemove={(id) => patch({ types: filters.types.filter((chip) => chip.id !== id) })} />
          <label className="search-check" title={t('searchTypePartialHint')}>
            <input type="checkbox" checked={filters.typePartial} onChange={(e) => patch({ typePartial: e.target.checked })} />
            {t('searchTypePartial')}
          </label>
        </Row>
        <Row label={t('searchColors')}>
          <ColorPicks colors={filters.colors} colorless={filters.colorless} label={t('searchColors')}
            onColor={(letter) => patch({ colorless: false, colors: filters.colors.includes(letter) ? filters.colors.filter((c) => c !== letter) : [...filters.colors, letter] })}
            onColorless={() => patch({ colorless: !filters.colorless, colors: !filters.colorless ? [] : filters.colors })} />
          <select className="input" aria-label={t('searchColors')} title={t('searchColorHint')} value={filters.colorMode} onChange={(e) => patch({ colorMode: e.target.value as CardSearchFilters['colorMode'] })}>
            <option value="exactly">{t('searchColorExactly')}</option>
            <option value="including">{t('searchColorIncluding')}</option>
            <option value="atmost">{t('searchColorAtMost')}</option>
          </select>
        </Row>
        <Row label={t('searchCommanderColors')}>
          <ColorPicks colors={filters.commanderColors} colorless={filters.commanderColorless} label={t('searchCommanderColors')} title={t('searchCommanderHint')}
            onColor={(letter) => patch({ commanderColorless: false, commanderColors: filters.commanderColors.includes(letter) ? filters.commanderColors.filter((c) => c !== letter) : [...filters.commanderColors, letter] })}
            onColorless={() => patch({ commanderColorless: !filters.commanderColorless, commanderColors: !filters.commanderColorless ? [] : filters.commanderColors })} />
        </Row>
        <Row label={t('searchManaCost')}>
          <div className="search-line">
            <input ref={manaRef} className="input" type="text" aria-label={t('searchManaCost')} title={t('searchManaHint')} placeholder={t('searchManaPlaceholder')} value={filters.manaCost} onChange={(e) => patch({ manaCost: e.target.value })} />
            <button type="button" className="btn btn--ghost" aria-expanded={symbols === 'mana'} onClick={() => setSymbols(symbols === 'mana' ? null : 'mana')}>{t('searchAddSymbol')}</button>
          </div>
          {symbols === 'mana' && <SymbolPad onPick={(symbol) => patch({ manaCost: insertSymbol(filters.manaCost, symbol, manaRef.current) })} />}
        </Row>
        <Row label={t('searchStats')}>
          <div className="search-line">
            <select className="input" aria-label={t('searchStats')} title={t('searchStatHint')} value={filters.stat} onChange={(e) => patch({ stat: e.target.value as StatKind })}>
              {STATS.map((s) => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
            </select>
            <select className="input" aria-label={t('statComparison')} value={filters.statOp} onChange={(e) => patch({ statOp: e.target.value as CompareOp })}>
              {COMPARE_OPS.map((op) => <option key={op.id} value={op.id}>{t(op.label)}</option>)}
            </select>
            <input className="input" inputMode="decimal" aria-label={t('statValue')} placeholder={t('statValue')} value={filters.statValue} onChange={(e) => patch({ statValue: e.target.value })} />
          </div>
        </Row>
        <Row label={t('searchGames')}>
          <div className="search-checks" title={t('searchGamesHint')}>
            {GAMES.map((game) => (
              <label key={game.id} className="search-check">
                <input type="checkbox" checked={filters.games[game.id]} onChange={(e) => patch({ games: { ...filters.games, [game.id]: e.target.checked } })} />
                {t(game.label)}
              </label>
            ))}
          </div>
        </Row>
        <Row label={t('searchFormats')}>
          <div className="search-line">
            <select className="input" aria-label={t('searchFormats')} title={t('searchFormatHint')} value={filters.legality} onChange={(e) => patch({ legality: e.target.value as LegalityMode })}>
              {LEGALITY.map((mode) => <option key={mode.id} value={mode.id}>{t(mode.label)}</option>)}
            </select>
            <select className="input" aria-label={t('searchAnyFormat')} value={filters.format} onChange={(e) => patch({ format: e.target.value })}>
              <option value="">{t('searchAnyFormat')}</option>
              {FORMATS.map((format) => <option key={format.value} value={format.value}>{t(format.label)}</option>)}
            </select>
          </div>
        </Row>
        <Row label={t('searchSets')}>
          <div className="search-line">
            <input className="input" type="text" aria-label={t('searchSetPlaceholder')} title={t('searchSetHint')} placeholder={t('searchSetPlaceholder')} value={filters.set} onChange={(e) => patch({ set: e.target.value })} />
            <input className="input" type="text" aria-label={t('searchBlockPlaceholder')} placeholder={t('searchBlockPlaceholder')} value={filters.block} onChange={(e) => patch({ block: e.target.value })} />
          </div>
        </Row>
        <Row label={t('searchRarity')}>
          <div className="search-checks" title={t('searchRarityHint')}>
            {RARITIES.map((rarity) => (
              <label key={rarity.id} className="search-check">
                <input type="checkbox" checked={filters.rarities.includes(rarity.id)} onChange={(e) => patch({ rarities: e.target.checked ? [...filters.rarities, rarity.id] : filters.rarities.filter((id) => id !== rarity.id) })} />
                {t(rarity.label)}
              </label>
            ))}
          </div>
        </Row>
        <Row label={t('searchCriteria')}>
          <div className="search-line">
            <input className="input" type="text" aria-label={t('searchKeywordPlaceholder')} title={t('searchCriteriaHint')} placeholder={t('searchKeywordPlaceholder')} value={keywordDraft} onChange={(e) => setKeywordDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip('criteria', keywordDraft, 'keyword'); setKeywordDraft(''); } }} />
            <button type="button" className="btn btn--ghost" onClick={() => { addChip('criteria', keywordDraft, 'keyword'); setKeywordDraft(''); }}>{t('searchAddKeyword')}</button>
            <select className="input" aria-label={t('searchChooseCriterion')} value="" onChange={(e) => { if (e.target.value) addChip('criteria', e.target.value, 'is'); }}>
              <option value="">{t('searchChooseCriterion')}</option>
              {CRITERIA_FLAGS.map((flag) => <option key={flag.value} value={flag.value}>{t(flag.label)}</option>)}
            </select>
          </div>
          <Chips chips={filters.criteria} labelOf={(chip) => chip.kind === 'is' ? t(CRITERIA_FLAGS.find((flag) => flag.value === chip.text)?.label ?? 'searchCriteria') : chip.text}
            onToggle={(id) => patch({ criteria: filters.criteria.map((chip) => chip.id === id ? { ...chip, include: !chip.include } : chip) })}
            onRemove={(id) => patch({ criteria: filters.criteria.filter((chip) => chip.id !== id) })} />
          <label className="search-check" title={t('searchCriteriaHint')}>
            <input type="checkbox" checked={filters.criteriaPartial} onChange={(e) => patch({ criteriaPartial: e.target.checked })} />
            {t('searchCriteriaPartial')}
          </label>
        </Row>
        <Row label={t('searchPrices')}>
          <div className="search-line">
            <select className="input" aria-label={t('searchPrices')} title={t('searchPriceHint')} value={filters.priceCurrency} onChange={(e) => patch({ priceCurrency: e.target.value as PriceCurrency })}>
              <option value="eur">EUR</option>
              <option value="usd">USD</option>
            </select>
            <select className="input" aria-label={t('statComparison')} value={filters.priceOp} onChange={(e) => patch({ priceOp: e.target.value as CompareOp })}>
              {COMPARE_OPS.map((op) => <option key={op.id} value={op.id}>{t(op.label)}</option>)}
            </select>
            <input className="input" inputMode="decimal" aria-label={t('searchPricePlaceholder')} placeholder={t('searchPricePlaceholder')} value={filters.priceValue} onChange={(e) => patch({ priceValue: e.target.value })} />
          </div>
        </Row>
        <div className="search-actions">
          <button type="submit" className="btn btn--primary" disabled={!ready || busy}>{t('searchRun')}</button>
          <button type="button" className="btn btn--ghost" onClick={() => { setFilters(emptyCardSearch()); setTypeDraft(''); setKeywordDraft(''); setCards([]); setTotal(0); setRan(false); setFailed(false); setOpen(null); }}>{t('searchClear')}</button>
          {!ready && <span className="muted">{t('searchNeedFilter')}</span>}
        </div>
      </form>
      {busy && cards.length === 0 && <p className="muted" role="status">{t('searchLoading')}</p>}
      {failed && <Unavailable onRetry={() => run(page)} />}
      {ran && !busy && !failed && cards.length === 0 && <p className="muted">{t('searchNone')}</p>}
      {(cards.length > 0 || total > 0) && <p className="muted">{t('cardOf', { n: cards.length, total })}</p>}
      <ul className="deck-faces rules__results">
        {cards.map((card, i) => {
          const src = pictureOf(card);
          return (
            <li key={`${card.nameEn}:${card.set}:${i}`}>
              <button type="button" className="deck-face" aria-label={card.name} onClick={() => setOpen(i)}
                onMouseEnter={(e) => src && setHover({ src, anchor: e.currentTarget.getBoundingClientRect() })}
                onMouseLeave={() => setHover(null)} onFocus={(e) => src && setHover({ src, anchor: e.currentTarget.getBoundingClientRect() })} onBlur={() => setHover(null)}>
                {src && <img src={src} alt="" />}
              </button>
            </li>
          );
        })}
      </ul>
      {hasMore && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => run(page + 1)}>{t('moreCards')}</button>}
      {hover && <CardBeside anchor={hover.anchor} src={hover.src} />}
      {picked && open != null && (
        <CardInspectDialog
          card={{ ...cardForInspection({ ...picked, priceExact: picked.eur != null }), nameEn: picked.nameEn }}
          engine={engine}
          index={open}
          total={cards.length}
          onClose={() => setOpen(null)}
          onStep={(delta) => setOpen((index) => index == null ? index : Math.min(cards.length - 1, Math.max(0, index + delta)))}
        />
      )}
    </main>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="search-row">
      <h2>{label}</h2>
      <div className="search-row__body">{children}</div>
    </div>
  );
}

function ColorPicks({ colors, colorless, label, title, onColor, onColorless }: {
  colors: ColorLetter[]; colorless: boolean; label: string; title?: string;
  onColor: (letter: ColorLetter) => void; onColorless: () => void;
}) {
  const t = useT();
  return (
    <div className="search-colors" role="group" aria-label={label} title={title}>
      {COLOR_LETTERS.map((letter) => (
        <button key={letter} type="button" className="mana-swatch" aria-pressed={colors.includes(letter)} aria-label={t(COLOR_LABEL[letter])} title={t(COLOR_LABEL[letter])} onClick={() => onColor(letter)}>
          <ManaSymbol symbol={letter} cost />
        </button>
      ))}
      <button type="button" className="mana-swatch" aria-pressed={colorless} aria-label={t('colorC')} title={t('colorC')} onClick={onColorless}>
        <ManaSymbol symbol="C" cost />
      </button>
    </div>
  );
}

function SymbolPad({ onPick }: { onPick: (symbol: string) => void }) {
  const t = useT();
  return (
    <div className="search-symbols" role="group" aria-label={t('searchAddSymbol')}>
      {MANA_SYMBOLS.map((symbol) => (
        <button key={symbol} type="button" className="btn btn--ghost search-symbols__btn" aria-label={symbol} title={symbol}
          onClick={() => onPick(symbol)}>
          <ManaSymbol symbol={symbol.replace(/^\{|\}$/g, '')} />
        </button>
      ))}
    </div>
  );
}

function Chips({ chips, onToggle, onRemove, labelOf }: {
  chips: SearchChip[]; onToggle: (id: string) => void; onRemove: (id: string) => void; labelOf?: (chip: SearchChip) => string;
}) {
  const t = useT();
  if (!chips.length) return null;
  return (
    <ul className="search-chips">
      {chips.map((chip) => {
        const label = labelOf?.(chip) ?? chip.text;
        return (
          <li key={chip.id} className={chip.include ? '' : 'is-out'}>
            <button type="button" aria-pressed={chip.include} title={t(chip.include ? 'searchExclude' : 'searchInclude', { name: label })} onClick={() => onToggle(chip.id)}>{label}</button>
            <button type="button" aria-label={t('removeTag', { tag: label })} onClick={() => onRemove(chip.id)}>{t('searchChipRemove')}</button>
          </li>
        );
      })}
    </ul>
  );
}
