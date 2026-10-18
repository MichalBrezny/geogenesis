import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n/i18n';
import type { MapLayer, TemperatureMonth } from '../render/mapRenderer';
import type { Frame, WorkerRequest, WorkerResponse } from '../worker/protocol';
import type { ScenarioId } from '../sim/scenarios';
import type { LifeClassKey } from '../sim/data/lifeClasses';
import type { CellLife } from '../sim/models/biosphere/diversity';
import type { ToolId } from '../sim/tools/tools';
import { HistoryCharts, type ChartSeries } from './charts/HistoryCharts';
import { CivilizationPanel, EventLog } from './CivilizationPanel';
import { ControlsPanel } from './ControlsPanel';
import { LayerBar } from './LayerBar';
import { LifePanel } from './LifePanel';
import { MapLegend } from './MapLegend';
import { PlanetView, type Overlay, type View } from './PlanetView';
import { Collapsible, TabbedPanel, type Tab } from './SidePanel';
import { useShortcuts, type Shortcuts } from './shortcuts';
import { ToolPalette } from './ToolPalette';
import { RESOLUTIONS, SPEEDS, TopBar, type Speed } from './TopBar';
import type { PlanetStart } from '../sim/world';
import type { PlanetParameters } from '../sim/core/planet';
import { PlanetPanel } from './PlanetPanel';

/** How long a tool notice stays on screen, ms. */
const NOTICE_DURATION = 3000;

/** Charts, map layers and the initial layer that suit each scenario. */
const SCENARIO_VIEW: Record<
  ScenarioId,
  { charts: ChartSeries[]; layers: MapLayer[]; layer: MapLayer }
> = {
  random: {
    charts: [
      'meanTemperature',
      'co2',
      'surfacePressure',
      'water',
      'o2',
      'livingClasses',
      'biodiversity',
      'iceFraction',
      'forestFraction',
      'desertFraction',
      'landFraction',
      'seaLevel',
      'solarInput',
    ],
    layers: [
      'terrain',
      'plates',
      'volcanism',
      'airTemperature',
      'seasons',
      'pressure',
      'precipitation',
      'clouds',
      'wind',
      'oceanCurrents',
      'biomes',
      'life',
      'diversity',
      'civilization',
    ],
    layer: 'terrain',
  },
  daisyworld: {
    charts: ['meanTemperature', 'whiteDaisies', 'blackDaisies', 'solarInput'],
    layers: ['daisies', 'airTemperature', 'seasons', 'terrain'],
    layer: 'daisies',
  },
  aquarium: {
    charts: [
      'meanTemperature',
      'co2',
      'surfacePressure',
      'water',
      'o2',
      'livingClasses',
      'biodiversity',
      'landFraction',
      'seaLevel',
      'solarInput',
    ],
    layers: [
      'life',
      'terrain',
      'plates',
      'volcanism',
      'airTemperature',
      'seasons',
      'pressure',
      'precipitation',
      'clouds',
      'wind',
      'oceanCurrents',
      'biomes',
      'diversity',
      'civilization',
    ],
    layer: 'life',
  },
  mars: {
    charts: [
      'meanTemperature',
      'co2',
      'co2Ice',
      'surfacePressure',
      'water',
      'iceFraction',
      'solarInput',
    ],
    layers: [
      'terrain',
      'airTemperature',
      'pressure',
      'wind',
      'precipitation',
      'clouds',
      'volcanism',
    ],
    layer: 'airTemperature',
  },
  venus: {
    charts: ['meanTemperature', 'co2', 'surfacePressure', 'water', 'solarInput'],
    layers: ['airTemperature', 'pressure', 'clouds', 'wind', 'terrain', 'volcanism'],
    layer: 'clouds',
  },
};

/** Keys listed in the shortcut help, with their descriptions. */
const SHORTCUT_HELP = [
  ['Space', 'help.keyPlay'],
  ['S', 'help.keyStep'],
  ['1–9 / 0', 'help.keyLayer'],
  ['G', 'help.keyView'],
  ['W / C / P', 'help.keyOverlay'],
  ['Esc', 'help.keyEscape'],
  ['?', 'help.keyHelp'],
] as const;

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
  const workerRef = useRef<Worker | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<MapLayer>('terrain');
  const [view, setView] = useState<View>('map');
  const [temperatureMonth, setTemperatureMonth] = useState<TemperatureMonth>('annual');
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const toggleOverlay = (overlay: Overlay) =>
    setOverlays((current) =>
      current.includes(overlay) ? current.filter((o) => o !== overlay) : [...current, overlay],
    );
  /** Picking a flow or pressure layer also shows its matching overlay. */
  const chooseLayer = (next: MapLayer) => {
    setLayer(next);
    const overlay: Overlay | null =
      next === 'wind'
        ? 'wind'
        : next === 'oceanCurrents'
          ? 'currents'
          : next === 'pressure'
            ? 'isobars'
            : null;
    if (overlay)
      setOverlays((current) => (current.includes(overlay) ? current : [...current, overlay]));
  };
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<Speed>('fast');
  const [tool, setTool] = useState<ToolId | null>(null);
  const [lifeClass, setLifeClass] = useState<LifeClassKey>('prokaryotes');
  const [cellLife, setCellLife] = useState<CellLife | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const noticeTimer = useRef<number | undefined>(undefined);

  const send = useCallback((request: WorkerRequest) => workerRef.current?.postMessage(request), []);

  const inspectCell = useCallback((cell: number) => send({ type: 'inspect', cell }), [send]);

  const createPlanet = useCallback(
    (
      scenario: ScenarioId,
      resolutionIndex: number,
      start: PlanetStart = 'young',
      planetParams?: Partial<PlanetParameters>,
    ) => {
      const [width, height] = RESOLUTIONS[resolutionIndex]!;
      send({ type: 'create', scenario, seed: randomSeed(), width, height, start, planetParams });
    },
    [send],
  );
  const newPlanet = (
    scenario: ScenarioId,
    resolutionIndex: number,
    start: PlanetStart,
    planetParams?: Partial<PlanetParameters>,
  ) => {
    createPlanet(scenario, resolutionIndex, start, planetParams);
    setLayer(SCENARIO_VIEW[scenario].layer);
    setError(null);
  };

  useEffect(() => {
    const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'frame') setFrame(message.frame);
      else if (message.type === 'cellLife') setCellLife(message.life);
      else if (message.type === 'error') setError(message.message);
      else if (message.type === 'saved') download(message.bytes, message.fileName);
      else {
        setNotice(t(message.reason === 'energy' ? 'tools.noEnergy' : 'tools.notAllowed'));
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_DURATION);
      }
    };
    workerRef.current = worker;
    createPlanet('random', 1);
    return () => worker.terminate();
  }, [createPlanet]);

  const scenarioView = SCENARIO_VIEW[frame?.scenario ?? 'random'];
  // A loaded game may be another scenario than the layer was chosen for.
  const shownLayer = scenarioView.layers.includes(layer) ? layer : scenarioView.layer;

  const toggleRunning = () => {
    if (!frame) return;
    send({ type: 'run', running: !running });
    setRunning(!running);
  };
  const step = () => {
    if (frame && !running) send({ type: 'step' });
  };
  const changeSpeed = (value: Speed) => {
    setSpeed(value);
    send({ type: 'speed', delayMs: SPEEDS[value] });
  };
  const load = async (file: File) => {
    setError(null);
    const bytes = await file.arrayBuffer();
    workerRef.current?.postMessage({ type: 'load', bytes } satisfies WorkerRequest, [bytes]);
  };

  const shortcuts: Shortcuts = {
    ' ': toggleRunning,
    s: step,
    g: () => setView(view === 'map' ? 'globe' : 'map'),
    w: () => toggleOverlay('wind'),
    c: () => toggleOverlay('currents'),
    p: () => toggleOverlay('isobars'),
    Escape: () => {
      setTool(null);
      setHelpOpen(false);
    },
    '?': () => setHelpOpen(!helpOpen),
  };
  scenarioView.layers.forEach((id, index) => {
    shortcuts[index === 9 ? '0' : String(index + 1)] = () => chooseLayer(id);
  });
  useShortcuts(shortcuts);

  const tabs: Tab[] = frame
    ? [
        {
          id: 'charts',
          label: 'panel.charts',
          content: <HistoryCharts history={frame.history} series={scenarioView.charts} />,
        },
      ]
    : [];
  if (frame && frame.scenario !== 'daisyworld') {
    tabs.push(
      { id: 'life', label: 'panel.life', content: <LifePanel life={frame.life} /> },
      {
        id: 'civilization',
        label: 'panel.civilization',
        content: (
          <>
            <CivilizationPanel civilization={frame.civilization} />
            <EventLog events={frame.events} />
          </>
        ),
      },
    );
  }

  return (
    <div className="app">
      <TopBar
        frame={frame}
        running={running}
        onToggleRunning={toggleRunning}
        onStep={step}
        speed={speed}
        onSpeedChange={changeSpeed}
        onNewPlanet={newPlanet}
        onSave={() => send({ type: 'save' })}
        onLoad={(file) => void load(file)}
        onShowHelp={() => setHelpOpen(true)}
      />
      {frame && (
        <aside className="sidebar left">
          <Collapsible
            title={
              <>
                {t('tools.title')}{' '}
                <span className="energy">
                  {frame.unlimitedEnergy
                    ? t('tools.unlimited')
                    : t('tools.energy', { value: Math.floor(frame.energy) })}
                </span>
              </>
            }
          >
            <ToolPalette
              frame={frame}
              tool={tool}
              onToolChange={setTool}
              lifeClass={lifeClass}
              onLifeClassChange={setLifeClass}
              onUnlimitedEnergyChange={(enabled) => send({ type: 'unlimitedEnergy', enabled })}
            />
          </Collapsible>
          <Collapsible title={t('controlsPanel.title')}>
            <ControlsPanel
              controls={frame.controls}
              onChange={(controls) => send({ type: 'controls', controls })}
            />
          </Collapsible>
          <Collapsible title={t('planet.title')}>
            <PlanetPanel frame={frame} />
          </Collapsible>
        </aside>
      )}
      <main className="stage">
        {error && <p className="error">{error}</p>}
        {!frame && !error && <p className="loading">{t('app.creating')}</p>}
        {frame && (
          <>
            <LayerBar
              layers={scenarioView.layers}
              layer={shownLayer}
              onLayerChange={chooseLayer}
              overlays={overlays}
              onToggleOverlay={toggleOverlay}
              view={view}
              onViewChange={setView}
              temperatureMonth={temperatureMonth}
              onTemperatureMonthChange={setTemperatureMonth}
            />
            <div className="planet">
              <figure>
                <PlanetView
                  frame={frame}
                  layer={shownLayer}
                  view={view}
                  toolActive={tool !== null}
                  overlays={frame.scenario === 'daisyworld' ? [] : overlays}
                  temperatureMonth={temperatureMonth}
                  cellLife={cellLife}
                  onInspect={inspectCell}
                  onCellClick={(x, y) => {
                    if (tool) send({ type: 'tool', use: { tool, x, y, lifeClass } });
                  }}
                />
                <MapLegend layer={shownLayer} />
              </figure>
              {notice && (
                <p className="notice" role="status">
                  {notice}
                </p>
              )}
            </div>
          </>
        )}
      </main>
      {frame && (
        <aside className="sidebar right">
          <TabbedPanel tabs={tabs} label="panel.label" />
        </aside>
      )}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <section
        className="help"
        role="dialog"
        aria-modal="true"
        aria-label={t('help.shortcuts')}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{t('help.shortcuts')}</h2>
        <dl>
          {SHORTCUT_HELP.map(([key, label]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{t(label)}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">{t('help.mouse')}</p>
        <button className="primary" onClick={onClose} autoFocus>
          {t('help.close')}
        </button>
      </section>
    </div>
  );
}
