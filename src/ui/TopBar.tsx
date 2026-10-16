import { useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n/i18n';
import { SCENARIO_IDS, type ScenarioId } from '../sim/scenarios';
import type { Frame } from '../worker/protocol';
import { formatGyr, formatPpm, formatStep } from './format';

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
  onNewPlanet: (scenario: ScenarioId, resolutionIndex: number) => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  onShowHelp: () => void;
}

/** Time controls, the planet's vital signs and the planet menu. */
export function TopBar(props: Props) {
  const { frame, running } = props;
  return (
    <header className="topbar">
      <h1>
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
        <NewPlanetMenu onCreate={props.onNewPlanet} />
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
    frame.stepYears >= 1e6 ? formatGyr(frame.year) : Math.round(frame.year).toLocaleString('en');
  const items: [MessageKey, MessageKey, string][] = [
    ['stat.age', 'stat.ageHint', age],
    ['stat.step', 'stat.stepHint', formatStep(frame.stepYears)],
    ['stat.temperature', 'stat.temperatureHint', `${frame.meanTemperature.toFixed(1)} °C`],
    ['stat.co2', 'stat.co2Hint', `${formatPpm(frame.co2)} ppm`],
    ['stat.o2', 'stat.o2Hint', `${(frame.o2 * 100).toFixed(1)}%`],
    ['stat.ice', 'stat.iceHint', `${(frame.iceFraction * 100).toFixed(0)}%`],
    ['stat.sun', 'stat.sunHint', `${(frame.solarInput * 100).toFixed(1)}%`],
    [
      'stat.energy',
      'stat.energyHint',
      frame.unlimitedEnergy ? '∞' : Math.floor(frame.energy).toLocaleString('en'),
    ],
  ];
  return (
    <dl className="vitals">
      {items.map(([label, hint, value]) => (
        <div key={label} title={t(hint)}>
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
function NewPlanetMenu({ onCreate }: { onCreate: Props['onNewPlanet'] }) {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState<ScenarioId>('random');
  const [resolution, setResolution] = useState(1);
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
            onCreate(scenario, resolution);
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
