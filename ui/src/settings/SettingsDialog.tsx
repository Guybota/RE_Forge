import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Engine } from '../useEngine';
import { useT } from '../i18n';
import { DEFAULT_SKIN, SKINS } from '../skins';
import { SoundSettings } from '../audio/SoundSettings';
import { AnimationSettings } from '../table/AnimationPanel';
import { GameplaySettings } from './GameplaySettings';
import { AccessibilitySettings } from './AccessibilitySettings';
import './settings.css';

const SECTIONS = ['appearance', 'audio', 'gameplay', 'accessibility'] as const;
type Section = typeof SECTIONS[number];

/** The same settings and order before and during a match; only the body scrolls. */
export function SettingsDialog({ engine, onClose, footer, inGame = false }: {
  engine: Engine; onClose: () => void; footer?: ReactNode; inGame?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<Section>(inGame ? 'gameplay' : 'appearance');
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return (
    <dialog ref={ref} className="choice settings-dialog" aria-labelledby="settings-title"
      onCancel={e => { e.preventDefault(); onClose(); }}>
      <header className="settings-dialog__head">
        <h2 className="choice__title" id="settings-title">{t(inGame ? 'gameMenu' : 'settings')}</h2>
        <button type="button" className="btn btn--ghost" onClick={onClose} autoFocus>{t('close')}</button>
      </header>
      <nav className="settings-dialog__nav" aria-label={t('settings')}>
        {SECTIONS.map(id => <button type="button" className="btn btn--ghost" key={id}
          aria-pressed={section === id} aria-controls={`settings-${id}`} onClick={() => setSection(id)}>{t(id)}</button>)}
      </nav>
      <select className="input settings-dialog__section-picker" aria-label={t('settingsSection')}
        value={section} aria-controls={`settings-${section}`} onChange={e => setSection(e.target.value as Section)}>
        {SECTIONS.map(id => <option key={id} value={id}>{t(id)}</option>)}
      </select>
      <div className="settings-dialog__body">
        <section id="settings-appearance" hidden={section !== 'appearance'} aria-label={t('appearance')}>
          <label className="settings-dialog__field"><span>{t('skin')}</span>
            <select className="input" value={engine.info?.skin ?? DEFAULT_SKIN}
              onChange={e => engine.send({ type: 'setSkin', skin: e.target.value })}>
              {SKINS.map(s => <option value={s.id} key={s.id}>{t(s.name)}</option>)}
            </select>
          </label>
          <label className="settings-dialog__field" title={inGame ? t('languageOutsideMatch') : undefined}>
            <span>{t('language')}</span>
            <select className="input" disabled={inGame} value={engine.info?.language ?? ''}
              onChange={e => engine.send({ type: 'setLanguage', language: e.target.value })}>
              {engine.info?.languages.map(l => <option value={l.code} key={l.code}>{l.name}</option>)}
            </select>
          </label>
        </section>
        <section id="settings-audio" hidden={section !== 'audio'} aria-label={t('audio')}><SoundSettings /></section>
        <section id="settings-gameplay" hidden={section !== 'gameplay'} aria-label={t('gameplay')}><GameplaySettings engine={engine} /></section>
        <section id="settings-accessibility" hidden={section !== 'accessibility'} aria-label={t('accessibility')}><AccessibilitySettings /><AnimationSettings /></section>
      </div>
      {engine.error && <p className="error" role="alert">{engine.error}</p>}
      {footer && <footer className="settings-dialog__footer">{footer}</footer>}
    </dialog>
  );
}
