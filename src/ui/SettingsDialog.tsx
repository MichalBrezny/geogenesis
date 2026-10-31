import { useState, type ComponentType, type ReactNode } from 'react';
import {
  getLanguageChoice,
  saveLanguageChoice,
  t,
  type LanguageChoice,
  type MessageKey,
} from '../i18n/i18n';
import { Dialog } from './Dialog';
import { LanguageSelect } from './LanguageSelect';
import { RESOLUTIONS } from './menuOptions';
import { AUTOSAVE_INTERVALS, type DefaultSpeed, type Settings } from './settings';

interface SectionProps {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

interface SettingsSection {
  id: string;
  label: MessageKey;
  component: ComponentType<SectionProps>;
}

const SECTIONS: readonly SettingsSection[] = [
  { id: 'game', label: 'settings.game', component: GameSettings },
  { id: 'display', label: 'settings.display', component: DisplaySettings },
];

export function SettingsDialog({
  settings,
  onClose,
  onSave,
  children,
}: {
  settings: Settings;
  onClose: () => void;
  onSave: (settings: Settings) => void;
  /** Self-contained sections (sound, accessibility) that apply their changes immediately. */
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState(settings);
  const [language, setLanguage] = useState(getLanguageChoice());
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Dialog title={t('settings.title')} onClose={onClose} className="settings-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const languageChanged = language !== getLanguageChoice();
          const languageSaved = saveLanguageChoice(language);
          onSave(draft);
          onClose();
          if (languageChanged && languageSaved) window.location.reload();
        }}
      >
        {SECTIONS.map(({ id, label, component: Section }) => (
          <section key={id} className="settings-section">
            <h3>{t(label)}</h3>
            <div className="dialog-form-grid">
              <Section settings={draft} set={set} />
            </div>
          </section>
        ))}
        <LanguageSettings language={language} setLanguage={setLanguage} />
        {children}
        <div className="actions">
          <button type="button" onClick={onClose} title={t('controls.cancel')}>
            {t('controls.cancel')}
          </button>
          <button type="submit" className="primary" title={t('settings.saveHint')}>
            {t('settings.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function LanguageSettings({
  language,
  setLanguage,
}: {
  language: LanguageChoice;
  setLanguage: (language: LanguageChoice) => void;
}) {
  return (
    <section className="settings-section">
      <h3 title={t('settings.languageHint')}>{t('settings.language')}</h3>
      <div className="dialog-form-grid">
        <LanguageSelect value={language} onChange={setLanguage} />
      </div>
    </section>
  );
}

function GameSettings({ settings, set }: SectionProps) {
  return (
    <>
      <label title={t('settings.resolutionHint')}>
        {t('settings.resolution')}
        <select
          value={settings.resolutionIndex}
          onChange={(event) => set('resolutionIndex', Number(event.target.value))}
          title={t('settings.resolutionHint')}
        >
          {RESOLUTIONS.map(([width, height], index) => (
            <option key={index} value={index}>
              {width} × {height}
            </option>
          ))}
        </select>
      </label>
      <label title={t('settings.speedHint')}>
        {t('settings.speed')}
        <select
          value={settings.speed}
          onChange={(event) => set('speed', event.target.value as DefaultSpeed)}
          title={t('settings.speedHint')}
        >
          {(['slow', 'normal', 'fast'] as const).map((speed) => (
            <option key={speed} value={speed}>
              {t(`speed.${speed}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-label" title={t('controls.adaptivePacingHint')}>
        <input
          type="checkbox"
          checked={settings.adaptivePacing}
          onChange={(event) => set('adaptivePacing', event.target.checked)}
          title={t('controls.adaptivePacingHint')}
        />
        {t('controls.adaptivePacing')}
      </label>
      <label title={t('settings.autosaveHint')}>
        {t('settings.autosave')}
        <select
          value={settings.autosaveInterval}
          onChange={(event) =>
            set('autosaveInterval', Number(event.target.value) as Settings['autosaveInterval'])
          }
          title={t('settings.autosaveHint')}
        >
          {AUTOSAVE_INTERVALS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 0
                ? t('settings.autosaveOff')
                : t('settings.autosaveMinutes', { minutes })}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function DisplaySettings({ settings, set }: SectionProps) {
  return (
    <label title={t('settings.particlesHint')}>
      {t('settings.particles')}
      <select
        value={settings.particleDensity}
        onChange={(event) => set('particleDensity', Number(event.target.value))}
        title={t('settings.particlesHint')}
      >
        <option value={0.5}>{t('settings.particlesLow')}</option>
        <option value={1}>{t('settings.particlesNormal')}</option>
        <option value={1.5}>{t('settings.particlesHigh')}</option>
      </select>
    </label>
  );
}
