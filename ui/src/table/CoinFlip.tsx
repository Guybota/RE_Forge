import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OpeningCoin } from '../engine';
import { useT } from '../i18n';
import { getAnimationSettings } from './animationPrefs';
import { CrownIcon } from './icons';
import { coinTiming } from './openingCoin';

/** The native opening toss, before the winner chooses play/draw. The modal traps pointer and keyboard input. */
export function CoinFlip({ toss, onDone }: { toss: OpeningCoin; onDone: (gameId: number) => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [timing] = useState(() => coinTiming(getAnimationSettings().speed));
  const [landed, setLanded] = useState(false);
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    const finish = () => onDone(toss.gameId);
    const landing = window.setTimeout(() => setLanded(true), timing.spin);
    const timer = window.setTimeout(finish, timing.total);
    const onVisibility = () => { if (document.hidden) finish(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(landing); window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [toss.gameId, timing, onDone]);
  return <dialog ref={ref} className="coin-flip" aria-labelledby="coin-title" onCancel={e => e.preventDefault()}>
    <h2 id="coin-title" className="coin-flip__title">{t('coinToss')}</h2>
    <div className="coin-flip__coin" style={{ animationDuration: `${timing.spin}ms` }} aria-hidden="true"><CrownIcon /></div>
    <p className="coin-flip__text" role="status" aria-live="polite">{landed ? t('coinWinner', { name: toss.winnerName }) : t('coinTossing')}</p>
  </dialog>;
}
