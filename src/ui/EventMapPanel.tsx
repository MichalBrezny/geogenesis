import { t, type MessageKey } from '../i18n/i18n';
import type { PlanetEvent } from '../sim/events';
import { EVENT_CATEGORIES, type EventCategory } from './eventMap';
import { describeEvent } from './CivilizationPanel';
import { formatYear } from './format';
import { EventIcon } from './icons';

export function EventMapPanel({
  enabled,
  onToggle,
  selected,
  onClear,
}: {
  enabled: ReadonlySet<EventCategory>;
  onToggle: (category: EventCategory) => void;
  selected: PlanetEvent | null;
  onClear: () => void;
}) {
  return (
    <aside className="event-map-panel" aria-label={t('eventMap.title')}>
      <strong>{t('eventMap.title')}</strong>
      <div className="event-map-filters">
        {EVENT_CATEGORIES.map((category) => (
          <label key={category} title={t(`eventMap.${category}Hint` as MessageKey)}>
            <input
              type="checkbox"
              checked={enabled.has(category)}
              onChange={() => onToggle(category)}
            />
            {t(`eventMap.${category}` as MessageKey)}
          </label>
        ))}
      </div>
      {selected && (
        <button
          type="button"
          className="event-map-selected"
          onClick={onClear}
          title={t('eventMap.clearHint')}
        >
          <EventIcon eventKey={selected.key} />
          <span>
            <span className="muted">{formatYear(selected.year)}</span> {describeEvent(selected)}
          </span>
        </button>
      )}
    </aside>
  );
}
