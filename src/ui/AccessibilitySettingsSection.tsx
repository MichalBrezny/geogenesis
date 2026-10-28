import { useId, useSyncExternalStore } from 'react';
import { t } from '../i18n/i18n';
import {
  getAccessibilitySettings,
  setAccessibilitySettings,
  subscribeAccessibilitySettings,
} from '../render/accessibilitySettings';

export function useAccessibilitySettings() {
  return useSyncExternalStore(
    subscribeAccessibilitySettings,
    getAccessibilitySettings,
    getAccessibilitySettings,
  );
}

/** Preferences that can be embedded in Help now and in a Settings dialog later. */
export function AccessibilitySettingsSection() {
  const settings = useAccessibilitySettings();
  const titleId = useId();
  const paletteGroup = useId();
  return (
    <section className="accessibility-settings" aria-labelledby={titleId}>
      <h3 id={titleId}>{t('accessibility.title')}</h3>
      <fieldset>
        <legend>{t('accessibility.palette')}</legend>
        <label title={t('accessibility.paletteDefaultHint')}>
          <input
            type="radio"
            name={paletteGroup}
            title={t('accessibility.paletteDefaultHint')}
            checked={settings.palette === 'default'}
            onChange={() => setAccessibilitySettings({ ...settings, palette: 'default' })}
          />
          {t('accessibility.paletteDefault')}
        </label>
        <label title={t('accessibility.paletteColourBlindHint')}>
          <input
            type="radio"
            name={paletteGroup}
            title={t('accessibility.paletteColourBlindHint')}
            checked={settings.palette === 'colourBlind'}
            onChange={() => setAccessibilitySettings({ ...settings, palette: 'colourBlind' })}
          />
          {t('accessibility.paletteColourBlind')}
        </label>
      </fieldset>
      <label title={t('accessibility.highContrastHint')}>
        <input
          type="checkbox"
          title={t('accessibility.highContrastHint')}
          checked={settings.highContrast}
          onChange={(event) =>
            setAccessibilitySettings({ ...settings, highContrast: event.target.checked })
          }
        />
        {t('accessibility.highContrast')}
      </label>
    </section>
  );
}
