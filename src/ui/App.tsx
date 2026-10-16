import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/i18n';
import {
  buildGlobeLookup,
  dragGlobe,
  globeCell,
  projectGlobe,
  type GlobeView,
} from '../render/globe';
import { layerPixels, MAP_LAYERS, renderLayer, type MapLayer } from '../render/mapRenderer';
import type { Frame, WorkerRequest, WorkerResponse } from '../worker/protocol';
import { SCENARIO_IDS, type ScenarioId } from '../sim/scenarios';
import { HistoryCharts, type ChartSeries } from './charts/HistoryCharts';
import { formatPpm, formatStep } from './format';
import { CivilizationPanel, EventLog } from './CivilizationPanel';
import { LifePanel } from './LifePanel';
import { CellInspector, type HoveredCell } from './CellInspector';
import { ControlsPanel } from './ControlsPanel';
import { MapLegend } from './MapLegend';
import { ToolPalette } from './ToolPalette';
import type { LifeClassKey } from '../sim/data/lifeClasses';
import type { ToolId } from '../sim/tools/tools';

/** Pause between simulation steps for each speed setting, ms. */
const SPEEDS = { slow: 500, normal: 120, fast: 0 } as const;
type Speed = keyof typeof SPEEDS;

/** Ways to look at the planet. */
const VIEWS = ['map', 'globe'] as const;
type View = (typeof VIEWS)[number];
/** Side of the globe image, pixels. */
const GLOBE_SIZE = 512;
/** Pointer travel, px, below which a press on the globe counts as a click, not a drag. */
const CLICK_SLOP = 4;

/** How long a tool notice stays on screen, ms. */
const NOTICE_DURATION = 3000;

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
  aquarium: {
    charts: ['meanTemperature', 'co2', 'o2', 'livingClasses', 'landFraction', 'solarInput'],
    layer: 'life',
  },
};

/** Offers bytes from the worker as a file download. */
function download(bytes: ArrayBuffer, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

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
  const [tool, setTool] = useState<ToolId | null>(null);
  const [lifeClass, setLifeClass] = useState<LifeClassKey>('prokaryotes');
  const [notice, setNotice] = useState<string | null>(null);
  const [hovered, setHovered] = useState<HoveredCell | null>(null);
  const [speed, setSpeed] = useState<Speed>('fast');
  const [view, setView] = useState<View>('map');
  const [globeView, setGlobeView] = useState<GlobeView>({ longitude: 180, latitude: 20 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

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
      const message = event.data;
      if (message.type === 'frame') setFrame(message.frame);
      else if (message.type === 'error') setError(message.message);
      else if (message.type === 'saved') download(message.bytes, message.fileName);
      else {
        setNotice(t(message.reason === 'energy' ? 'tools.noEnergy' : 'tools.notAllowed'));
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_DURATION);
      }
    };
    workerRef.current = worker;
    newPlanet('random', 1);
    return () => worker.terminate();
  }, [newPlanet]);

  const gridWidth = frame?.grid.width ?? 0;
  const gridHeight = frame?.grid.height ?? 0;
  const globeLookup = useMemo(
    () =>
      view === 'globe' && gridWidth > 0
        ? buildGlobeLookup(GLOBE_SIZE, globeView, gridWidth, gridHeight)
        : null,
    [view, globeView, gridWidth, gridHeight],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
    if (!globeLookup) {
      renderLayer(canvas, frame, layer);
      return;
    }
    canvas.width = GLOBE_SIZE;
    canvas.height = GLOBE_SIZE;
    const pixels = projectGlobe(layerPixels(frame, layer), globeLookup);
    canvas.getContext('2d')?.putImageData(new ImageData(pixels, GLOBE_SIZE, GLOBE_SIZE), 0, 0);
  }, [frame, layer, globeLookup]);

  const toggleRunning = () => {
    send({ type: 'run', running: !running });
    setRunning(!running);
  };

  const fileInput = useRef<HTMLInputElement>(null);
  const loadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    const bytes = await file.arrayBuffer();
    workerRef.current?.postMessage({ type: 'load', bytes } satisfies WorkerRequest, [bytes]);
  };

  const stepTime = frame ? Object.values(frame.timings).reduce((sum, ms) => sum + ms, 0) : 0;

  /** Grid cell under the pointer on the map or the globe, or −1 off the planet. */
  const cellAt = (event: React.MouseEvent<HTMLCanvasElement>): number => {
    if (!frame) return -1;
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const { width, height } = frame.grid;
    if (view === 'globe') return globeCell(2 * fx - 1, 1 - 2 * fy, globeView, width, height);
    const x = Math.min(width - 1, Math.floor(fx * width));
    const y = Math.min(height - 1, Math.floor(fy * height));
    return y * width + x;
  };

  /** Shows the inspector for the cell under the pointer; on the globe, a pressed button turns it. */
  const onPointerMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!frame) return;
    const start = drag.current;
    if (view === 'globe' && start && event.buttons & 1) {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (start.moved || Math.hypot(dx, dy) > CLICK_SLOP) {
        const radius = event.currentTarget.getBoundingClientRect().width / 2;
        setGlobeView((current) => dragGlobe(current, dx / radius, dy / radius));
        drag.current = { x: event.clientX, y: event.clientY, moved: true };
        setHovered(null);
        return;
      }
    }
    const index = cellAt(event);
    if (index < 0) {
      setHovered(null);
      return;
    }
    const { width, height } = frame.grid;
    const x = index % width;
    const y = Math.floor(index / width);
    setHovered({
      index,
      latitude: 90 - ((y + 0.5) * 180) / height,
      longitude: ((x + 0.5) * 360) / width,
      left: event.clientX + 16,
      top: event.clientY + 16,
    });
  };

  /** Applies the selected tool to the grid cell under the click (not at the end of a drag). */
  const applyToolAt = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const dragged = drag.current?.moved;
    drag.current = null;
    if (!tool || !frame || dragged) return;
    const index = cellAt(event);
    if (index < 0) return;
    const { width } = frame.grid;
    send({
      type: 'tool',
      use: { tool, x: index % width, y: Math.floor(index / width), lifeClass },
    });
  };

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
        <label>
          {t('controls.speed')}{' '}
          <select
            value={speed}
            onChange={(e) => {
              const value = e.target.value as Speed;
              setSpeed(value);
              send({ type: 'speed', delayMs: SPEEDS[value] });
            }}
          >
            {(Object.keys(SPEEDS) as Speed[]).map((id) => (
              <option key={id} value={id}>
                {t(`speed.${id}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            newPlanet(scenario, resolution);
            setLayer(SCENARIO_VIEW[scenario].layer);
          }}
        >
          {t('controls.newPlanet')}
        </button>
        <button onClick={() => send({ type: 'save' })} disabled={!frame}>
          {t('controls.save')}
        </button>
        <button onClick={() => fileInput.current?.click()}>{t('controls.load')}</button>
        <input
          ref={fileInput}
          type="file"
          accept=".simearth"
          hidden
          onChange={(event) => void loadFile(event)}
        />
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
        <label>
          {t('view.label')}{' '}
          <select value={view} onChange={(e) => setView(e.target.value as View)}>
            {VIEWS.map((id) => (
              <option key={id} value={id}>
                {t(`view.${id}`)}
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
      <canvas
        ref={canvasRef}
        className={[view, tool ? 'tool-active' : ''].join(' ')}
        onMouseDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, moved: false };
        }}
        onClick={applyToolAt}
        onMouseMove={onPointerMove}
        onMouseLeave={() => {
          drag.current = null;
          setHovered(null);
        }}
        aria-label={t(view === 'globe' ? 'map.globeLabel' : 'map.label')}
      />
      {frame && hovered && <CellInspector frame={frame} cell={hovered} />}
      <MapLegend layer={layer} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {frame && (
        <div className="panels">
          <ToolPalette
            frame={frame}
            tool={tool}
            onToolChange={setTool}
            lifeClass={lifeClass}
            onLifeClassChange={setLifeClass}
            onUnlimitedEnergyChange={(enabled) => send({ type: 'unlimitedEnergy', enabled })}
          />
          <ControlsPanel
            controls={frame.controls}
            onChange={(controls) => send({ type: 'controls', controls })}
          />
        </div>
      )}
      {frame && (
        <HistoryCharts history={frame.history} series={SCENARIO_VIEW[frame.scenario].charts} />
      )}
      {frame && frame.scenario !== 'daisyworld' && (
        <div className="panels">
          <CivilizationPanel civilization={frame.civilization} />
          <EventLog events={frame.events} />
        </div>
      )}
      {frame && frame.scenario !== 'daisyworld' && <LifePanel life={frame.life} />}
    </main>
  );
}
