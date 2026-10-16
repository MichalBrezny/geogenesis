import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n/i18n';
import { MAP_LAYERS, renderLayer, type MapLayer } from '../render/mapRenderer';
import type { Frame, WorkerRequest, WorkerResponse } from '../worker/protocol';
import { SCENARIO_IDS, type ScenarioId } from '../sim/scenarios';
import { HistoryCharts, type ChartSeries } from './charts/HistoryCharts';
import { formatPpm, formatStep } from './format';
import { CivilizationPanel, EventLog } from './CivilizationPanel';
import { LifePanel } from './LifePanel';
import { MapLegend } from './MapLegend';

/** Grid resolutions offered for a new planet, as [width, height]. */
const RESOLUTIONS = [
  [128, 64],
  [256, 128],
  [512, 256],
] as const;

/** Charts and the initial map layer that suit each scenario. */
const SCENARIO_VIEW: Record<ScenarioId, { charts: ChartSeries[]; layer: MapLayer }> = {
  random: {
    charts: [
      'meanTemperature',
      'co2',
      'o2',
      'livingClasses',
      'iceFraction',
      'forestFraction',
      'desertFraction',
      'landFraction',
      'solarInput',
    ],
    layer: 'terrain',
  },
  daisyworld: {
    charts: ['meanTemperature', 'whiteDaisies', 'blackDaisies', 'solarInput'],
    layer: 'daisies',
  },
};

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<MapLayer>('terrain');
  const [running, setRunning] = useState(false);
  const [resolution, setResolution] = useState(1);
  const [scenario, setScenario] = useState<ScenarioId>('random');

  const send = useCallback((request: WorkerRequest) => workerRef.current?.postMessage(request), []);

  const newPlanet = useCallback(
    (scenarioId: ScenarioId, resolutionIndex: number) => {
      const [width, height] = RESOLUTIONS[resolutionIndex]!;
      send({ type: 'create', scenario: scenarioId, seed: randomSeed(), width, height });
    },
    [send],
  );

  useEffect(() => {
    const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type === 'frame') setFrame(event.data.frame);
      else setError(event.data.message);
    };
    workerRef.current = worker;
    newPlanet('random', 1);
    return () => worker.terminate();
  }, [newPlanet]);

  useEffect(() => {
    if (canvasRef.current && frame) renderLayer(canvasRef.current, frame, layer);
  }, [frame, layer]);

  const toggleRunning = () => {
    send({ type: 'run', running: !running });
    setRunning(!running);
  };

  const stepTime = frame ? Object.values(frame.timings).reduce((sum, ms) => sum + ms, 0) : 0;

  return (
    <main className="app">
      <header className="toolbar">
        <h1>{t('app.title')}</h1>
        <button onClick={toggleRunning} disabled={!frame}>
          {running ? t('controls.pause') : t('controls.play')}
        </button>
        <button onClick={() => send({ type: 'step' })} disabled={running || !frame}>
          {t('controls.step')}
        </button>
        <button
          onClick={() => {
            newPlanet(scenario, resolution);
            setLayer(SCENARIO_VIEW[scenario].layer);
          }}
        >
          {t('controls.newPlanet')}
        </button>
        <label>
          {t('controls.scenario')}{' '}
          <select value={scenario} onChange={(e) => setScenario(e.target.value as ScenarioId)}>
            {SCENARIO_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`scenario.${id}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('controls.resolution')}{' '}
          <select value={resolution} onChange={(e) => setResolution(Number(e.target.value))}>
            {RESOLUTIONS.map(([w, h], index) => (
              <option key={index} value={index}>
                {w} × {h}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('layer.label')}{' '}
          <select value={layer} onChange={(e) => setLayer(e.target.value as MapLayer)}>
            {MAP_LAYERS.map((l) => (
              <option key={l} value={l}>
                {t(`layer.${l}`)}
              </option>
            ))}
          </select>
        </label>
        {frame && (
          <>
            <span>{t('time.year', { year: frame.year.toLocaleString('en') })}</span>
            <span>{t('stats.meanTemperature', { value: frame.meanTemperature.toFixed(1) })}</span>
            <span>{t('stats.co2', { value: formatPpm(frame.co2) })}</span>
            <span>{t('stats.o2', { value: (frame.o2 * 100).toFixed(1) })}</span>
            <span>{t('stats.ice', { value: (frame.iceFraction * 100).toFixed(0) })}</span>
            <span>{t('stats.sun', { value: (frame.solarInput * 100).toFixed(1) })}</span>
            <span>{t('time.step', { value: formatStep(frame.stepYears) })}</span>
            <span className="muted">{t('stats.stepTime', { value: stepTime.toFixed(0) })}</span>
          </>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      <canvas ref={canvasRef} className="map" />
      <MapLegend layer={layer} />
      {frame && (
        <HistoryCharts history={frame.history} series={SCENARIO_VIEW[frame.scenario].charts} />
      )}
      {frame?.scenario === 'random' && (
        <div className="panels">
          <CivilizationPanel civilization={frame.civilization} />
          <EventLog events={frame.events} />
        </div>
      )}
      {frame?.scenario === 'random' && <LifePanel life={frame.life} />}
    </main>
  );
}
