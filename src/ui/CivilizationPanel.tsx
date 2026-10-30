import { t, type MessageKey } from '../i18n/i18n';
import { TECH_AGES } from '../sim/data/civilization';
import { LIFE_CLASSES } from '../sim/data/lifeClasses';
import type { Frame } from '../worker/protocol';
import { formatGyr, formatYear } from './format';
import { EventIcon } from './icons';

/** Status of the sentient species: tech age, progress towards the next, population. */
export function CivilizationPanel({ civilization }: { civilization: Frame['civilization'] }) {
  const { species, age, progress, population, exodusYear } = civilization;
  const largestCities = civilization.cities
    .filter((city) => city.abandonedYear === null)
    .sort((a, b) => b.population - a.population || a.id - b.id)
    .slice(0, 6);
  return (
    <section aria-label={t('civ.title')}>
      {species === null ? (
        <p className="muted">
          {exodusYear === null
            ? t('civ.none')
            : t('civ.afterExodus', { age: formatGyr(exodusYear) })}
        </p>
      ) : (
        <dl className="civ-stats">
          <dt>{t('civ.species')}</dt>
          <dd>{t(`lifeClass.${LIFE_CLASSES[species]!.key}`)}</dd>
          <dt>{t('civ.age')}</dt>
          <dd>
            {t(`age.${TECH_AGES[age]!.key}` as MessageKey)}
            <progress
              className="civ-progress"
              max={1}
              value={progress}
              aria-label={t('civ.progress')}
            />
            <span className="muted"> {(progress * 100).toFixed(0)}%</span>
          </dd>
          <dt>{t('civ.population')}</dt>
          <dd>{formatPopulation(population)}</dd>
        </dl>
      )}
      {largestCities.length > 0 && (
        <div className="city-list">
          <h3>{t('civ.largestCities')}</h3>
          <ol>
            {largestCities.map((city) => (
              <li key={city.id}>
                <span>
                  {city.name}{' '}
                  {city.capital && (
                    <span title={t('civ.capitalHint')} aria-label={t('civ.capital')}>
                      ★
                    </span>
                  )}
                </span>
                <span className="muted">{formatPopulation(city.population)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function formatPopulation(billions: number): string {
  if (billions >= 1) return t('civ.billions', { value: billions.toFixed(2) });
  return t('civ.millions', { value: (billions * 1000).toFixed(billions < 0.01 ? 2 : 0) });
}

/** The most recent notable events, newest first. */
export function EventLog({
  events,
  onCentre,
}: {
  events: Frame['events'];
  onCentre?: (cell: number) => void;
}) {
  if (events.length === 0) return null;
  return (
    <section aria-label={t('events.title')}>
      <h3>{t('events.title')}</h3>
      <ol className="event-log">
        {[...events].reverse().map((event, k) => (
          <li key={`${event.year}-${k}`}>
            {event.cell === undefined ? (
              <span className="event-entry">
                <EventIcon eventKey={event.key} />
                <span>
                  <span className="muted">{formatYear(event.year)}</span> {describeEvent(event)}
                </span>
              </span>
            ) : (
              <button
                type="button"
                className="event-entry located"
                onClick={() => onCentre?.(event.cell!)}
                title={t('events.centreHint')}
              >
                <EventIcon eventKey={event.key} />
                <span>
                  <span className="muted">{formatYear(event.year)}</span> {describeEvent(event)}
                </span>
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function describeEvent(event: Frame['events'][number]): string {
  const subject = event.subject ?? '';
  const name =
    event.key === 'largeEruption' ||
    event.key === 'largeIgneousProvince' ||
    event.key === 'impact' ||
    event.key === 'earthquake'
      ? subject
      : event.key === 'disasterWarning'
        ? t(`disasterWarning.${subject}` as MessageKey)
        : event.key === 'deviceDestroyed'
          ? t(`tool.${subject}` as MessageKey)
          : event.key === 'goalWon' || event.key === 'goalLost'
            ? t(`goal.reason.${subject}` as MessageKey)
            : event.key === 'ageReached'
              ? t(`age.${subject}` as MessageKey)
              : event.key === 'eraReached'
                ? t(`era.${subject}` as MessageKey)
                : event.key === 'massExtinction'
                  ? t(`extinctionCause.${subject}` as MessageKey)
                  : subject
                    ? t(`lifeClass.${subject}` as MessageKey)
                    : '';
  const description = t(`event.${event.key}`, { name });
  return event.detail ? description + t('event.cityLocation', { name: event.detail }) : description;
}
