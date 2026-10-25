import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useT } from '../i18n';
import { getSoundSettings, playSound, setSoundSettings, subscribeSoundSettings, unlockSounds } from './sounds';
import { AnimationSettings } from '../table/AnimationPanel';
import './sounds.css';

export function SoundSettings() {
  const t = useT();
  const settings = useSyncExternalStore(subscribeSoundSettings, getSoundSettings);
  return (
    <fieldset className="sound-settings">
      <legend>{t('soundEffects')}</legend>
      <label className="sound-settings__toggle">
        <input type="checkbox" checked={settings.enabled} onChange={e => {
          setSoundSettings({ enabled: e.target.checked });
          if (e.target.checked) { unlockSounds(); playSound('click'); }
        }} />
        {t('enableSounds')}
      </label>
      <label className="sound-settings__volume">
        <span>{t('soundVolume')}</span>
        <input type="range" min="0" max="100" step="1" value={Math.round(settings.volume * 100)} disabled={!settings.enabled}
          onChange={e => { setSoundSettings({ volume: Number(e.target.value) / 100 }); unlockSounds(); playSound('phase'); }} />
        <output>{Math.round(settings.volume * 100)}%</output>
      </label>
      <button type="button" className="btn btn--ghost" disabled={!settings.enabled || settings.volume === 0} onClick={() => { unlockSounds(); playSound('turn'); }}>{t('testSound')}</button>
    </fieldset>
  );
}

/** Main-menu settings: sound and table animations. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useT();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return (
    <dialog ref={ref} className="choice sound-dialog" aria-label={t('settings')} onCancel={e => { e.preventDefault(); onClose(); }}>
      <SoundSettings />
      <AnimationSettings />
      <button type="button" className="btn btn--ghost" onClick={onClose} autoFocus>{t('close')}</button>
    </dialog>
  );
}
