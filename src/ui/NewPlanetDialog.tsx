import { useState } from 'react';
import { t, type MessageKey } from '../i18n/i18n';
import type { Difficulty, PlanetParameters, StarType } from '../sim/core/planet';
import { DIFFICULTIES } from '../sim/balance';
import type { ScenarioId } from '../sim/scenarios';
import { PLANET_STARTS, type PlanetStart } from '../sim/world';
import { Dialog } from './Dialog';
import { DICE_ICON, SCENARIO_ICONS, START_ICONS } from './icons';
import { RESOLUTIONS } from './menuOptions';
import { DEFAULT_SETTINGS, type Settings } from './settings';

export interface NewPlanetChoice {
  scenario: ScenarioId;
  seed: number;
  resolutionIndex: number;
  start: PlanetStart;
  difficulty: Difficulty;
  adaptivePacing: boolean;
  planetParams?: Partial<PlanetParameters>;
  continentalFraction?: number;
}

export interface NewPlanetForm {
  scenario: ScenarioId;
  seed: number;
  resolutionIndex: number;
  start: PlanetStart;
  difficulty: Difficulty;
  adaptivePacing: boolean;
  radiusKm: number;
  distanceAu: number;
  starType: StarType;
  rotationHours: number;
  hasMoon: boolean;
  initialWater: string;
  landTargetPercent: number;
}

export function newPlanetChoice(form: NewPlanetForm): NewPlanetChoice {
  return {
    scenario: form.scenario,
    seed: form.seed >>> 0,
    resolutionIndex: form.resolutionIndex,
    start: form.start,
    difficulty: form.difficulty,
    adaptivePacing: form.adaptivePacing,
    ...(form.scenario === 'random'
      ? {
          planetParams: {
            radius: form.radiusKm * 1000,
            orbitalDistanceAu: form.distanceAu,
            starType: form.starType,
            rotationPeriodHours: form.rotationHours,
            hasMoon: form.hasMoon,
            ...(form.initialWater === '' ? {} : { initialWaterGel: Number(form.initialWater) }),
          },
          continentalFraction: form.landTargetPercent / 100,
        }
      : {}),
  };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

const GOAL_SCENARIOS = new Set<ScenarioId>([
  'brighteningSun',
  'snowball',
  'cradle',
  'terraformMars',
  'stoneAge',
]);

export const SCENARIO_GROUPS: readonly {
  title: MessageKey;
  scenarios: readonly ScenarioId[];
}[] = [
  {
    title: 'newPlanet.sandbox',
    scenarios: ['random', 'aquarium', 'daisyworld', 'cambrian', 'mars', 'venus'],
  },
  {
    title: 'newPlanet.challenges',
    scenarios: ['brighteningSun', 'snowball', 'cradle', 'terraformMars', 'stoneAge'],
  },
];

export function NewPlanetDialog({
  onClose,
  onCreate,
  settings = DEFAULT_SETTINGS,
}: {
  onClose: () => void;
  onCreate: (choice: NewPlanetChoice) => void;
  settings?: Readonly<Settings>;
}) {
  const [form, setForm] = useState<NewPlanetForm>({
    scenario: 'random',
    seed: randomSeed(),
    resolutionIndex: settings.resolutionIndex,
    start: 'young',
    difficulty: 'normal',
    adaptivePacing: settings.adaptivePacing,
    radiusKm: 6371,
    distanceAu: 1,
    starType: 'G',
    rotationHours: 24,
    hasMoon: true,
    initialWater: '',
    landTargetPercent: 28,
  });
  const set = <K extends keyof NewPlanetForm>(key: K, value: NewPlanetForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const showStart = form.scenario === 'random' || form.scenario === 'aquarium';

  return (
    <Dialog title={t('newPlanet.title')} onClose={onClose} className="new-planet-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(newPlanetChoice(form));
        }}
      >
        <div className="scenario-groups" role="radiogroup" aria-label={t('controls.scenario')}>
          {SCENARIO_GROUPS.map((group) => (
            <section key={group.title} className="scenario-group">
              <h3>{t(group.title)}</h3>
              <div className="scenario-grid">
                {group.scenarios.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={form.scenario === id}
                    className={`scenario-card ${form.scenario === id ? 'selected' : ''} ${id === 'random' ? 'recommended' : ''}`}
                    onClick={() => set('scenario', id)}
                    title={t(`scenarioHelp.${id}` as MessageKey)}
                  >
                    <span className="scenario-icon">{SCENARIO_ICONS[id]}</span>
                    <strong>{t(`scenario.${id}` as MessageKey)}</strong>
                    {GOAL_SCENARIOS.has(id) && (
                      <span className="goal-badge">{t('newPlanet.goal')}</span>
                    )}
                    {id === 'random' && (
                      <span className="recommended-badge">{t('newPlanet.recommended')}</span>
                    )}
                    <small>{t(`scenarioHelp.${id}` as MessageKey)}</small>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        {showStart && (
          <fieldset>
            <legend>{t('controls.start')}</legend>
            <div className="start-grid">
              {PLANET_STARTS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={form.start === id ? 'selected' : ''}
                  aria-pressed={form.start === id}
                  onClick={() => set('start', id)}
                  title={t(`startHelp.${id}`)}
                >
                  {START_ICONS[id]}
                  <span>
                    <strong>{t(`start.${id}`)}</strong>
                    <small>{t(`startHelp.${id}`)}</small>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="dialog-form-grid">
          <label title={t('controls.difficultyHint')}>
            {t('controls.difficulty')}
            <select
              value={form.difficulty}
              onChange={(event) => set('difficulty', event.target.value as Difficulty)}
              title={t('controls.difficultyHint')}
            >
              {DIFFICULTIES.map((id) => (
                <option key={id} value={id}>
                  {t(`difficulty.${id}`)}
                </option>
              ))}
            </select>
          </label>
          <label title={t('controls.resolutionHint')}>
            {t('controls.resolution')}
            <select
              value={form.resolutionIndex}
              onChange={(event) => set('resolutionIndex', Number(event.target.value))}
              title={t('controls.resolutionHint')}
            >
              {RESOLUTIONS.map(([width, height], index) => (
                <option key={index} value={index}>
                  {width} × {height}
                </option>
              ))}
            </select>
          </label>
          <label title={t('newPlanet.seedHint')}>
            {t('newPlanet.seed')}
            <span className="seed-control">
              <input
                type="number"
                min="0"
                max="4294967295"
                value={form.seed}
                onChange={(event) => set('seed', Number(event.target.value))}
                title={t('newPlanet.seedHint')}
              />
              <button
                type="button"
                onClick={() => set('seed', randomSeed())}
                title={t('newPlanet.diceHint')}
                aria-label={t('newPlanet.diceHint')}
              >
                {DICE_ICON}
              </button>
            </span>
          </label>
          <label className="checkbox-label" title={t('controls.adaptivePacingHint')}>
            <input
              type="checkbox"
              checked={form.adaptivePacing}
              onChange={(event) => set('adaptivePacing', event.target.checked)}
              title={t('controls.adaptivePacingHint')}
            />
            {t('controls.adaptivePacing')}
          </label>
        </div>

        {form.scenario === 'random' && (
          <details className="advanced">
            <summary title={t('newPlanet.advanced')}>{t('newPlanet.advanced')}</summary>
            <div className="dialog-form-grid">
              <label title={t('planet.radiusHint')}>
                {t('planet.radius')} (km)
                <input
                  type="number"
                  min="1000"
                  max="20000"
                  step="1"
                  value={form.radiusKm}
                  onChange={(e) => set('radiusKm', Number(e.target.value))}
                  title={t('planet.radiusHint')}
                />
              </label>
              <label title={t('planet.distanceHint')}>
                {t('planet.distance')} (AU)
                <input
                  type="number"
                  min="0.02"
                  max="20"
                  step="0.001"
                  value={form.distanceAu}
                  onChange={(e) => set('distanceAu', Number(e.target.value))}
                  title={t('planet.distanceHint')}
                />
              </label>
              <label title={t('planet.starTypeHint')}>
                {t('planet.starType')}
                <select
                  value={form.starType}
                  onChange={(e) => set('starType', e.target.value as StarType)}
                  title={t('planet.starTypeHint')}
                >
                  {(['F', 'G', 'K', 'M'] as const).map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label title={t('planet.rotationHint')}>
                {t('planet.rotation')} (h)
                <input
                  type="number"
                  min="-10000"
                  max="10000"
                  step="0.1"
                  value={form.rotationHours}
                  onChange={(e) => set('rotationHours', Number(e.target.value))}
                  title={t('planet.rotationHint')}
                />
              </label>
              <label className="checkbox-label" title={t('planet.moonHint')}>
                <input
                  type="checkbox"
                  checked={form.hasMoon}
                  onChange={(e) => set('hasMoon', e.target.checked)}
                  title={t('planet.moonHint')}
                />
                {t('planet.moon')}
              </label>
              <label title={t('planet.waterHint')}>
                {t('planet.water')} (m GEL)
                <input
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  value={form.initialWater}
                  placeholder={t('newPlanet.auto')}
                  onChange={(e) => set('initialWater', e.target.value)}
                  title={t('planet.waterHint')}
                />
              </label>
              <label title={t('planet.landTargetHint')}>
                {t('planet.landTarget')} (%)
                <input
                  type="number"
                  min="0"
                  max="60"
                  step="1"
                  value={form.landTargetPercent}
                  onChange={(e) => set('landTargetPercent', Number(e.target.value))}
                  title={t('planet.landTargetHint')}
                />
              </label>
            </div>
          </details>
        )}
        <div className="actions">
          <button type="button" onClick={onClose} title={t('controls.cancel')}>
            {t('controls.cancel')}
          </button>
          <button type="submit" className="primary" title={t('controls.create')}>
            {t('controls.create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
