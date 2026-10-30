import { t } from '../i18n/i18n';
import type { AudioSettings } from '../audio/audioSettings';
import { MUSIC_ENABLED } from '../audio/audioEngine';
import { useId } from 'react';

interface Props {
  settings: AudioSettings;
  onChange: (settings: AudioSettings) => void;
}

const VOLUMES: readonly {
  key: 'master' | 'music' | 'effects';
  label: 'sound.master' | 'sound.music' | 'sound.effects';
  hint: 'sound.masterHint' | 'sound.musicHint' | 'sound.effectsHint';
}[] = [
  { key: 'master', label: 'sound.master', hint: 'sound.masterHint' },
  { key: 'music', label: 'sound.music', hint: 'sound.musicHint' },
  { key: 'effects', label: 'sound.effects', hint: 'sound.effectsHint' },
];

/** Reusable sound controls; persistence and engine synchronization stay with the owner. */
export function SoundSettingsSection({ settings, onChange }: Props) {
  const titleId = useId();
  return (
    <section className="sound-settings" aria-labelledby={titleId}>
      <h2 id={titleId}>{t('sound.title')}</h2>
      <p>{t('sound.description')}</p>
      <label title={t('sound.muteHint')}>
        <input
          type="checkbox"
          checked={settings.muted}
          onChange={(event) => onChange({ ...settings, muted: event.target.checked })}
          title={t('sound.muteHint')}
        />
        {t('sound.mute')}
      </label>
      {VOLUMES.filter(({ key }) => MUSIC_ENABLED || key !== 'music').map(({ key, label, hint }) => (
        <label key={key} title={t(hint)}>
          <span>
            {t(label)} <output>{Math.round(settings[key] * 100)}%</output>
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={settings[key]}
            onChange={(event) => onChange({ ...settings, [key]: event.target.valueAsNumber })}
            title={t(hint)}
          />
        </label>
      ))}
    </section>
  );
}
