import { useEffect, useRef, useState } from 'react';
import type { Printings } from './engine';
import { useT } from './i18n';
import { cardImage } from './images';
import { InspectableCard } from './table/CardInspection';

/** Every printing Forge knows for one card. Picking one replaces the art in the deck. */
export function PrintingsDialog({ title, printings, current, onClose, onPick, onRetry }: {
  title: string;
  printings: Printings['printings'] | null;
  current: string;
  onClose: () => void;
  onPick: (p: Printings['printings'][number]) => void;
  onRetry: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    if (printings !== null) return;
    const timer = setTimeout(() => setTimedOut(true), 15000);
    return () => clearTimeout(timer);
  }, [printings, attempt]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = printings?.filter(p => `${p.set} ${p.setName} ${p.number}`.toLocaleLowerCase().includes(needle));
  return (
    <dialog ref={ref} className="choice game-menu zone builder__art-dialog" aria-labelledby="printings-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="game-menu__head">
        <h2 id="printings-title" className="choice__title">{title}</h2>
        <button type="button" className="btn btn--ghost" onClick={onClose}>{t('close')}</button>
      </header>
      <div className="builder__printing-tools">
        <input autoFocus type="search" className="input" aria-label={t('printingSearch')} placeholder={t('printingSearch')} value={query} onChange={e => setQuery(e.target.value)} />
        {visible && <span className="muted" role="status">{t('printingCount', { n: visible.length })}</span>}
      </div>
      <ul className="game-menu__body builder__printings">
        {printings === null ? <li className="builder__printing-message" role="status">{t(timedOut ? 'printingLoadError' : 'connecting')}
          {timedOut && <button type="button" className="btn btn--ghost" onClick={() => { setTimedOut(false); setAttempt(n => n + 1); onRetry(); }}>{t('retryPrintings')}</button>}
        </li> : !visible?.length ? <li className="builder__printing-message" role="status">{t('noPrintings')}</li> : visible.map((p) => (
          <li key={p.imageKey}>
            <InspectableCard as="button" card={{ id: -1, name: title, imageKey: p.imageKey }} className={`builder__result ${p.imageKey === current ? 'is-on' : ''}`} aria-pressed={p.imageKey === current}
              aria-label={`${p.setName} (${p.set}) #${p.number} · ${t('printingArt', { n: p.artIndex })}`}
              title={`${p.setName} (${p.set}) #${p.number}`} onClick={() => onPick(p)}>
              <img src={cardImage(p.imageKey, 'full') ?? undefined} alt={`${title} · ${p.set} #${p.number}`} loading="lazy" decoding="async" />
              <span>{p.setName}</span>
              <span className="muted">{p.set} #{p.number} · {t('printingArt', { n: p.artIndex })}</span>
              {p.imageKey === current && <span className="builder__current-printing">{t('currentPrinting')}</span>}
            </InspectableCard>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
