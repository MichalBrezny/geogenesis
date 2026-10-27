import { useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n/i18n';
import { SCENARIO_IDS, type ScenarioId } from '../sim/scenarios';
import type { Frame } from '../worker/protocol';
import { PLANET_STARTS, type PlanetStart } from '../sim/world';
import { formatGyr, formatPpm, formatStep } from './format';
import type { PlanetParameters, StarType } from '../sim/core/planet';

/** Pause between simulation steps for each speed setting, ms. */
export const SPEEDS = { slow: 500, normal: 120, fast: 0 } as const;
export type Speed = keyof typeof SPEEDS;

/** Grid resolutions offered for a new planet, as [width, height]. */
export const RESOLUTIONS = [
  [128, 64],
  [256, 128],
  [512, 256],
] as const;

interface Props {
  frame: Frame | null;
  running: boolean;
  onToggleRunning: () => void;
  onStep: () => void;
  speed: Speed;
  onSpeedChange: (speed: Speed) => void;
  onNewPlanet: (
    scenario: ScenarioId,
    resolutionIndex: number,
    start: PlanetStart,
    planetParams?: Partial<PlanetParameters>,
    continentalFraction?: number,
  ) => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  onShowHelp: () => void;
  /** Incremented when another part of the UI asks to open the new-planet menu. */
  newPlanetRequest: number;
}

/** Time controls, the planet's vital signs and the planet menu. */
export function TopBar(props: Props) {
  const { frame, running } = props;
  return (
    <header className="topbar">
      <h1>
        <img className="logo" src={`${import.meta.env.BASE_URL}icon-180.png`} alt="" />
        {t('app.title')} <span className="subtitle">{t('app.subtitle')}</span>
      </h1>
      <div className="group" role="group" aria-label={t('controls.time')}>
        <button
          className="primary"
          onClick={props.onToggleRunning}
          disabled={!frame}
          title={t(running ? 'controls.pauseHint' : 'controls.playHint')}
        >
          {running ? t('controls.pause') : t('controls.play')}
        </button>
        <button onClick={props.onStep} disabled={running || !frame} title={t('controls.stepHint')}>
          {t('controls.step')}
        </button>
        <div className="segmented" role="radiogroup" aria-label={t('controls.speed')}>
          {(Object.keys(SPEEDS) as Speed[]).map((id) => (
            <button
              key={id}
              role="radio"
              aria-checked={props.speed === id}
              className={props.speed === id ? 'selected' : undefined}
              onClick={() => props.onSpeedChange(id)}
              title={t('controls.speedHint')}
            >
              {t(`speed.${id}`)}
            </button>
          ))}
        </div>
      </div>
      {frame && <Vitals frame={frame} />}
      <div className="group menu" role="group" aria-label={t('controls.planet')}>
        <NewPlanetMenu
          key={props.newPlanetRequest}
          onCreate={props.onNewPlanet}
          initiallyOpen={props.newPlanetRequest > 0}
        />
        <button onClick={props.onSave} disabled={!frame} title={t('controls.saveHint')}>
          {t('controls.save')}
        </button>
        <LoadButton onLoad={props.onLoad} />
        <button
          onClick={props.onShowHelp}
          title={t('help.shortcutsHint')}
          aria-label={t('help.shortcuts')}
        >
          ?
        </button>
      </div>
    </header>
  );
}

/** The planet's vital signs; each explains itself on hover. */
function Vitals({ frame }: { frame: Frame }) {
  const stepTime = Object.values(frame.timings).reduce((sum, ms) => sum + ms, 0);
  // Geological time reads best in Gyr; once steps are years long, the calendar year does.
  const age =
    frame.stepYears >= 1e5 ? formatGyr(frame.year) : Math.round(frame.year).toLocaleString('en');
  const items: [MessageKey, MessageKey, string, boolean?][] = [
    ...(frame.era
      ? [
          ['stat.era', 'stat.eraHint', t(`eraName.${frame.era}`)] as [
            MessageKey,
            MessageKey,
            string,
          ],
        ]
      : []),
    ['stat.age', 'stat.ageHint', age],
    ['stat.step', 'stat.stepHint', formatStep(frame.stepYears)],
    ['stat.temperature', 'stat.temperatureHint', `${frame.meanTemperature.toFixed(1)} °C`],
    ['stat.co2', 'stat.co2Hint', `${formatPpm(frame.co2)} ppm`],
    ['stat.pressure', 'stat.pressureHint', `${frame.surfacePressure.toFixed(2)} bar`],
    [
      'stat.o2',
      'stat.o2Hint',
      `${(frame.o2 * 100).toFixed(1)}% / ${frame.o2Pressure.toFixed(2)} bar`,
    ],
    ['stat.life', 'stat.lifeHint', t(`biosignature.${frame.biosignature}`)],
    ['stat.ice', 'stat.iceHint', `${(frame.iceFraction * 100).toFixed(0)}%`],
    ['stat.seaLevel', 'stat.seaLevelHint', `${frame.seaLevel.toFixed(0)} m`],
    ['stat.sun', 'stat.sunHint', `${(frame.solarInput * 100).toFixed(1)}%`],
    ...(frame.civilization.species !== null || frame.fossilCarbon > 0
      ? [
          [
            'stat.fossilCarbon',
            'stat.fossilCarbonHint',
            `${frame.fossilCarbon.toFixed(0)} Gt C`,
          ] as [MessageKey, MessageKey, string],
          [
            'stat.pollution',
            'stat.pollutionHint',
            frame.pollution.toFixed(2),
            frame.pollution >= 1,
          ] as [MessageKey, MessageKey, string, boolean],
        ]
      : []),
    [
      'stat.runawayMargin',
      'stat.runawayMarginHint',
      `${frame.runawayMargin.toFixed(0)} W/m2`,
      frame.runawayMargin < 15,
    ],
    [
      'stat.energy',
      'stat.energyHint',
      frame.unlimitedEnergy ? '∞' : Math.floor(frame.energy).toLocaleString('en'),
    ],
  ];
  return (
    <dl className="vitals">
      {items.map(([label, hint, value, warning]) => (
        <div key={label} title={t(hint)} className={warning ? 'warning' : undefined}>
          <dt>{t(label)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      <div className="muted" title={t('stat.computeHint')}>
        <dt>{t('stat.compute')}</dt>
        <dd>{stepTime.toFixed(0)} ms</dd>
      </div>
    </dl>
  );
}

/** "New planet" button with a small form for the scenario and the grid resolution. */
function NewPlanetMenu({
  onCreate,
  initiallyOpen,
}: {
  onCreate: Props['onNewPlanet'];
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [scenario, setScenario] = useState<ScenarioId>('random');
  const [resolution, setResolution] = useState(1);
  const [start, setStart] = useState<PlanetStart>('young');
  const [radiusKm, setRadiusKm] = useState(6371);
  const [distanceAu, setDistanceAu] = useState(1);
  const [starType, setStarType] = useState<StarType>('G');
  const [rotationHours, setRotationHours] = useState(24);
  const [hasMoon, setHasMoon] = useState(true);
  const [initialWater, setInitialWater] = useState('');
  const [landTargetPercent, setLandTargetPercent] = useState(28);
  const anchor = useRef<HTMLDivElement>(null);

  // A press anywhere outside the menu closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className="popover-anchor" ref={anchor}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={t('controls.newPlanetHint')}
      >
        {t('controls.newPlanet')}
      </button>
      {open && (
        <form
          className="popover"
          onSubmit={(event) => {
            event.preventDefault();
            const planetParams =
              scenario === 'random'
                ? {
                    radius: radiusKm * 1000,
                    orbitalDistanceAu: distanceAu,
                    starType,
                    rotationPeriodHours: rotationHours,
                    hasMoon,
                    ...(initialWater === '' ? {} : { initialWaterGel: Number(initialWater) }),
                  }
                : undefined;
            onCreate(
              scenario,
              resolution,
              start,
              planetParams,
              scenario === 'random' ? landTargetPercent / 100 : undefined,
            );
            setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <label>
            {t('controls.scenario')}
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as ScenarioId)}
              autoFocus
            >
              {SCENARIO_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`scenario.${id}`)}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">{t(`scenarioHelp.${scenario}`)}</p>
          {(scenario === 'random' || scenario === 'aquarium') && (
            <>
              <label title={t('controls.startHint')}>
                {t('controls.start')}
                <select
                  value={start}
                  onChange={(e) => setStart(e.target.value as PlanetStart)}
                  title={t('controls.startHint')}
                >
                  {PLANET_STARTS.map((id) => (
                    <option key={id} value={id} title={t(`startHelp.${id}`)}>
                      {t(`start.${id}`)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">{t(`startHelp.${start}`)}</p>
            </>
          )}
          {scenario === 'random' && (
            <fieldset>
              <legend>{t('planet.custom')}</legend>
              <label title={t('planet.radiusHint')}>
                {t('planet.radius')} (km)
                <input
                  type="number"
                  min="1000"
                  max="20000"
                  step="1"
                  value={radiusKm}
                  onChange={(event) => setRadiusKm(Number(event.target.value))}
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
                  value={distanceAu}
                  onChange={(event) => setDistanceAu(Number(event.target.value))}
                  title={t('planet.distanceHint')}
                />
              </label>
              <label title={t('planet.starTypeHint')}>
                {t('planet.starType')}
                <select
                  value={starType}
                  onChange={(event) => setStarType(event.target.value as StarType)}
                  title={t('planet.starTypeHint')}
                >
                  {(['F', 'G', 'K', 'M'] as const).map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
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
                  value={rotationHours}
                  onChange={(event) => setRotationHours(Number(event.target.value))}
                  title={t('planet.rotationHint')}
                />
              </label>
              <label title={t('planet.moonHint')}>
                <input
                  type="checkbox"
                  checked={hasMoon}
                  onChange={(event) => setHasMoon(event.target.checked)}
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
                  value={initialWater}
                  placeholder="auto"
                  onChange={(event) => setInitialWater(event.target.value)}
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
                  value={landTargetPercent}
                  onChange={(event) => setLandTargetPercent(Number(event.target.value))}
                  title={t('planet.landTargetHint')}
                />
              </label>
            </fieldset>
          )}
          <label>
            {t('controls.resolution')}
            <select value={resolution} onChange={(e) => setResolution(Number(e.target.value))}>
              {RESOLUTIONS.map(([w, h], index) => (
                <option key={index} value={index}>
                  {w} × {h}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">{t('controls.resolutionHint')}</p>
          <div className="actions">
            <button type="button" onClick={() => setOpen(false)}>
              {t('controls.cancel')}
            </button>
            <button type="submit" className="primary">
              {t('controls.create')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function LoadButton({ onLoad }: { onLoad: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button onClick={() => input.current?.click()} title={t('controls.loadHint')}>
        {t('controls.load')}
      </button>
      <input
        ref={input}
        type="file"
        accept=".geogenesis,.simearth"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onLoad(file);
        }}
      />
    </>
  );
}
