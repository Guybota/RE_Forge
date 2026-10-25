import { useSyncExternalStore } from 'react';
import { useT, type MessageKey } from '../i18n';
import { ANIMATION_KINDS, getAnimationSettings, setAnimationSettings, subscribeAnimationSettings } from './animationPrefs';
import '../audio/sounds.css';

export function AnimationSettings() {
  const t = useT();
  const settings = useSyncExternalStore(subscribeAnimationSettings, getAnimationSettings);
  return (
    <fieldset className="sound-settings">
      <legend>{t('animations')}</legend>
      <label className="sound-settings__toggle">
        <input type="checkbox" checked={settings.enabled} onChange={e => setAnimationSettings({ enabled: e.target.checked })} />
        {t('enableAnimations')}
      </label>
      <label className="sound-settings__volume">
        <span>{t('animationSpeed')}</span>
        <input type="range" min="0.5" max="2" step="0.25" value={settings.speed} disabled={!settings.enabled}
          onChange={e => setAnimationSettings({ speed: Number(e.target.value) })} />
        <output>{settings.speed}×</output>
      </label>
      {ANIMATION_KINDS.map(kind => (
        <label key={kind} className="sound-settings__toggle">
          <input type="checkbox" checked={settings.kinds[kind]} disabled={!settings.enabled}
            onChange={e => setAnimationSettings({ kinds: { ...settings.kinds, [kind]: e.target.checked } })} />
          {t(`animation_${kind}` as MessageKey)}
        </label>
      ))}
    </fieldset>
  );
}
