import { t, type MessageKey } from '../i18n/i18n';
import { AUTO_PAUSE_KEYS, type AutoPauseSettings } from '../sim/autoPause';

export function AutoPausePanel({
  settings,
  onChange,
}: {
  settings: AutoPauseSettings;
  onChange: (settings: AutoPauseSettings) => void;
}) {
  return (
    <fieldset className="check-list auto-pause-settings">
      <legend className="sr-only">{t('autoPause.title')}</legend>
      {AUTO_PAUSE_KEYS.map((key) => (
        <label key={key} title={t(`autoPause.${key}Hint` as MessageKey)}>
          <input
            type="checkbox"
            checked={settings[key]}
            onChange={(event) => onChange({ ...settings, [key]: event.currentTarget.checked })}
          />
          {t(`autoPause.${key}` as MessageKey)}
        </label>
      ))}
    </fieldset>
  );
}
