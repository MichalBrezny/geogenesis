import { t, type MessageKey } from '../i18n/i18n';
import type { DisasterSettings } from '../sim/core/planet';
import { DISASTER_ICONS } from './icons';

const DISASTER_KINDS = [
  'earthquakes',
  'tsunamis',
  'cyclones',
  'droughts',
  'dustStorms',
  'impacts',
  'supervolcanoes',
] as const satisfies readonly (keyof DisasterSettings)[];

/** Saved switches for natural hazards; player-created disaster tools remain available. */
export function DisasterPanel({
  disasters,
  onChange,
}: {
  disasters: DisasterSettings;
  onChange: (settings: Partial<DisasterSettings>) => void;
}) {
  return (
    <div className="disaster-toggles" role="group" aria-label={t('disasters.title')}>
      {DISASTER_KINDS.map((kind) => (
        <label key={kind} title={t(`disasterHelp.${kind}` as MessageKey)}>
          <input
            type="checkbox"
            checked={disasters[kind]}
            onChange={(event) => onChange({ [kind]: event.target.checked })}
          />
          {DISASTER_ICONS[kind]}
          <span>{t(`disaster.${kind}` as MessageKey)}</span>
        </label>
      ))}
    </div>
  );
}
