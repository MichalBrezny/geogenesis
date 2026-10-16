import { t, type MessageKey } from '../i18n/i18n';
import { TECH_AGES } from '../sim/data/civilization';
import { LIFE_CLASSES } from '../sim/data/lifeClasses';
import type { Frame } from '../worker/protocol';
import { formatGyr, formatYear } from './format';

/** Status of the sentient species: tech age, progress towards the next, population. */
export function CivilizationPanel({ civilization }: { civilization: Frame['civilization'] }) {
  const { species, age, progress, population, exodusYear } = civilization;
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
    </section>
  );
}

function formatPopulation(billions: number): string {
  if (billions >= 1) return t('civ.billions', { value: billions.toFixed(2) });
  return t('civ.millions', { value: (billions * 1000).toFixed(billions < 0.01 ? 2 : 0) });
}

/** The most recent notable events, newest first. */
export function EventLog({ events }: { events: Frame['events'] }) {
  if (events.length === 0) return null;
  return (
    <section aria-label={t('events.title')}>
      <h3>{t('events.title')}</h3>
      <ol className="event-log">
        {[...events].reverse().map((event, k) => (
          <li key={`${event.year}-${k}`}>
            <span className="muted">{formatYear(event.year)}</span> {describe(event)}
          </li>
        ))}
      </ol>
    </section>
  );
}

function describe(event: Frame['events'][number]): string {
  const subject = event.subject ?? '';
  const name =
    event.key === 'ageReached'
      ? t(`age.${subject}` as MessageKey)
      : subject
        ? t(`lifeClass.${subject}` as MessageKey)
        : '';
  return t(`event.${event.key}`, { name });
}
