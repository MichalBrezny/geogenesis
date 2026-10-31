import { t, type LanguageChoice } from '../i18n/i18n';

/** Auto / English / Czech picker shared by Settings and the welcome dialog. */
export function LanguageSelect(props: {
  value: LanguageChoice;
  onChange: (language: LanguageChoice) => void;
}) {
  return (
    <label title={t('settings.languageHint')}>
      {t('settings.language')}
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as LanguageChoice)}
        title={t('settings.languageHint')}
      >
        <option value="auto" title={t('settings.languageAutoHint')}>
          {t('settings.languageAuto')}
        </option>
        <option value="en" title={t('settings.languageEnglishHint')}>
          English
        </option>
        <option value="cs" title={t('settings.languageCzechHint')}>
          Čeština
        </option>
      </select>
    </label>
  );
}
