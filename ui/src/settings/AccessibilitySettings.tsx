import { useSyncExternalStore } from 'react';
import { useT } from '../i18n';
import { getAppearanceSettings, setAppearanceSettings, subscribeAppearanceSettings, TEXT_SCALES } from './appearancePrefs';

export function AccessibilitySettings() {
  const t = useT();
  const settings = useSyncExternalStore(subscribeAppearanceSettings, getAppearanceSettings);
  return <fieldset className="sound-settings reading-settings">
    <legend>{t('readingSettings')}</legend>
    <label className="settings-dialog__field"><span>{t('textScale')}</span>
      <select className="input" value={settings.textScale} onChange={e => setAppearanceSettings({ textScale: TEXT_SCALES.find(scale => scale === Number(e.target.value)) ?? 100 })}>
        {TEXT_SCALES.map(scale => <option key={scale} value={scale}>{scale}%</option>)}
      </select>
    </label>
    <label className="settings-dialog__field"><span>{t('interfaceDensity')}</span>
      <select className="input" value={settings.density} onChange={e => setAppearanceSettings({ density: e.target.value === 'comfortable' ? 'comfortable' : 'compact' })}>
        <option value="compact">{t('densityCompact')}</option>
        <option value="comfortable">{t('densityComfortable')}</option>
      </select>
    </label>
  </fieldset>;
}
