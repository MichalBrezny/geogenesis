import { useCallback, useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n/i18n';
import type { MapLayer, TemperatureMonth } from '../render/mapRenderer';
import type { Frame, WorkerRequest, WorkerResponse } from '../worker/protocol';
import type { ScenarioId } from '../sim/scenarios';
import type { LifeClassKey } from '../sim/data/lifeClasses';
import type { CellLife } from '../sim/models/biosphere/diversity';
import type { MonthlyClimate } from '../sim/models/atmosphere/climateDiagram';
import type { ToolId } from '../sim/tools/tools';
import { HistoryCharts, type ChartSeries } from './charts/HistoryCharts';
import { CivilizationPanel, EventLog } from './CivilizationPanel';
import { CONTROL_GROUPS, ControlsPanel, type ControlGroupId } from './ControlsPanel';
import { FloatingWindow } from './FloatingWindow';
import { WINDOW_ICONS, type FloatingWindowId } from './icons';
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
import { DEFAULT_CONTROLS } from '../sim/core/planet';
import { PlanetPanel } from './PlanetPanel';
import { GoalOutcome, GoalPanel } from './GoalPanel';
import type { VisibleMapIcons } from '../render/mapIcons';
import { DisasterPanel } from './DisasterPanel';
import { CivilizationControlsPanel } from './CivilizationControlsPanel';

/** How long a tool notice stays on screen, ms. */
const NOTICE_DURATION = 3000;

const FLOATING_WINDOWS: readonly FloatingWindowId[] = [
  'geosphere',
  'atmosphere',
  'biosphere',
  'civilization',
  'planet',
];

type WindowOpenState = Record<FloatingWindowId, boolean>;

function loadWindowOpenState(): WindowOpenState {
  return Object.fromEntries(
    FLOATING_WINDOWS.map((id) => {
      try {
        return [id, localStorage.getItem(`geogenesis.floatingWindow.${id}.open`) === 'true'];
      } catch {
        return [id, false];
      }
    }),
  ) as WindowOpenState;
}

/** Charts, map layers and the initial layer that suit each scenario. */
const SCENARIO_VIEW: Record<
  ScenarioId,
  { charts: ChartSeries[]; layers: MapLayer[]; layer: MapLayer; overlays?: Overlay[] }
> = {
  random: {
    overlays: ['icons'],
    charts: [
      'meanTemperature',
      'runawayMargin',
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
      'dust',
      'oceanAcidity',
      'meanOceanOxygen',
      'clathrateMethane',
      'fossilCarbon',
      'population',
      'pollution',
    ],
    layers: [
      'terrain',
      'seafloor',
      'plates',
      'volcanism',
      'airTemperature',
      'seasons',
      'pressure',
      'precipitation',
      'clouds',
      'wind',
      'oceanCurrents',
      'oceanOxygen',
      'nutrients',
      'clathrates',
      'biomes',
      'life',
      'diversity',
      'civilization',
      'hazard',
    ],
    layer: 'terrain',
  },
  daisyworld: {
    charts: ['meanTemperature', 'whiteDaisies', 'blackDaisies', 'solarInput'],
    layers: ['daisies', 'airTemperature', 'seasons', 'terrain'],
    layer: 'daisies',
  },
  aquarium: {
    overlays: ['icons'],
    charts: [
      'meanTemperature',
      'runawayMargin',
      'co2',
      'surfacePressure',
      'water',
      'o2',
      'livingClasses',
      'biodiversity',
      'landFraction',
      'seaLevel',
      'solarInput',
      'dust',
      'oceanAcidity',
      'meanOceanOxygen',
      'clathrateMethane',
    ],
    layers: [
      'life',
      'terrain',
      'seafloor',
      'plates',
      'volcanism',
      'airTemperature',
      'seasons',
      'pressure',
      'precipitation',
      'clouds',
      'wind',
      'oceanCurrents',
      'oceanOxygen',
      'nutrients',
      'clathrates',
      'biomes',
      'diversity',
      'civilization',
      'hazard',
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
      'seafloor',
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
    layers: ['airTemperature', 'pressure', 'clouds', 'wind', 'terrain', 'seafloor', 'volcanism'],
    layer: 'clouds',
  },
  terraformMars: {
    charts: ['meanTemperature', 'surfacePressure', 'co2', 'o2', 'water', 'iceFraction'],
    layers: ['terrain', 'seafloor', 'airTemperature', 'biomes', 'life', 'clouds', 'precipitation'],
    layer: 'terrain',
  },
  stoneAge: {
    overlays: ['icons'],
    charts: [
      'meanTemperature',
      'co2',
      'fossilCarbon',
      'population',
      'pollution',
      'o2',
      'biodiversity',
      'iceFraction',
      'seaLevel',
    ],
    layers: [
      'civilization',
      'hazard',
      'terrain',
      'seafloor',
      'life',
      'biomes',
      'airTemperature',
      'diversity',
    ],
    layer: 'civilization',
  },
  cambrian: {
    overlays: ['icons'],
    charts: ['livingClasses', 'biodiversity', 'o2', 'meanTemperature', 'co2', 'iceFraction'],
    layers: [
      'life',
      'diversity',
      'hazard',
      'terrain',
      'seafloor',
      'biomes',
      'airTemperature',
      'nutrients',
    ],
    layer: 'life',
  },
  brighteningSun: {
    overlays: ['icons'],
    charts: [
      'meanTemperature',
      'runawayMargin',
      'co2',
      'water',
      'biodiversity',
      'iceFraction',
      'seaLevel',
      'solarInput',
    ],
    layers: [
      'life',
      'terrain',
      'seafloor',
      'airTemperature',
      'clouds',
      'biomes',
      'diversity',
      'civilization',
      'hazard',
    ],
    layer: 'life',
  },
  snowball: {
    overlays: ['icons'],
    charts: [
      'meanTemperature',
      'runawayMargin',
      'co2',
      'iceFraction',
      'water',
      'seaLevel',
      'solarInput',
    ],
    layers: [
      'airTemperature',
      'terrain',
      'seafloor',
      'clouds',
      'precipitation',
      'biomes',
      'life',
      'hazard',
    ],
    layer: 'airTemperature',
  },
  cradle: {
    overlays: ['icons'],
    charts: [
      'livingClasses',
      'biodiversity',
      'o2',
      'meanTemperature',
      'co2',
      'iceFraction',
      'solarInput',
    ],
    layers: [
      'life',
      'diversity',
      'biomes',
      'terrain',
      'seafloor',
      'airTemperature',
      'civilization',
      'hazard',
    ],
    layer: 'life',
  },
};

/** Keys listed in the shortcut help, with their descriptions. */
const SHORTCUT_HELP = [
  ['Space', 'help.keyPlay'],
  ['S', 'help.keyStep'],
  ['1–9 / 0', 'help.keyLayer'],
  ['G', 'help.keyView'],
  ['W / C / P / T / N / I / V', 'help.keyOverlay'],
  ['E / A / B / D', 'help.keyWindows'],
  ['+ / −', 'help.keyZoom'],
  ['M', 'help.keyMinimap'],
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
  const stageRef = useRef<HTMLElement>(null);
  const captureObliquityDefault = useRef(true);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<MapLayer>('terrain');
  const [view, setView] = useState<View>('map');
  const [temperatureMonth, setTemperatureMonth] = useState<TemperatureMonth>('annual');
  const [overlays, setOverlays] = useState<Overlay[]>(['icons']);
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
  const [cellClimate, setCellClimate] = useState<MonthlyClimate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [windowOpen, setWindowOpen] = useState<WindowOpenState>(loadWindowOpenState);
  const [activeWindow, setActiveWindow] = useState<FloatingWindowId | null>(
    () => [...FLOATING_WINDOWS].reverse().find((id) => loadWindowOpenState()[id]) ?? null,
  );
  const [focusedWindow, setFocusedWindow] = useState<FloatingWindowId | null>(null);
  const [obliquityDefault, setObliquityDefault] = useState(DEFAULT_CONTROLS.obliquity);
  const [narrowWindows, setNarrowWindows] = useState(() => window.innerWidth < 700);
  const noticeTimer = useRef<number | undefined>(undefined);
  const lastGoalStatus = useRef<string | null>(null);
  const lastScenario = useRef<ScenarioId | null>(null);
  const [dismissedOutcome, setDismissedOutcome] = useState<string | null>(null);
  const [newPlanetRequest, setNewPlanetRequest] = useState(0);
  const [centreRequest, setCentreRequest] = useState<{ cell: number; serial: number } | null>(null);
  const [visibleMapIcons, setVisibleMapIcons] = useState<VisibleMapIcons>({
    lifeClasses: [],
    cityAge: null,
  });
  const visibleIconsChanged = useCallback((next: VisibleMapIcons) => {
    setVisibleMapIcons((current) =>
      current.cityAge === next.cityAge &&
      current.lifeClasses.length === next.lifeClasses.length &&
      current.lifeClasses.every((value, index) => value === next.lifeClasses[index])
        ? current
        : next,
    );
  }, []);

  const send = useCallback((request: WorkerRequest) => workerRef.current?.postMessage(request), []);

  const inspectCell = useCallback((cell: number) => send({ type: 'inspect', cell }), [send]);

  const createPlanet = useCallback(
    (
      scenario: ScenarioId,
      resolutionIndex: number,
      start: PlanetStart = 'young',
      planetParams?: Partial<PlanetParameters>,
      continentalFraction?: number,
    ) => {
      const [width, height] = RESOLUTIONS[resolutionIndex]!;
      captureObliquityDefault.current = true;
      lastGoalStatus.current = null;
      send({
        type: 'create',
        scenario,
        seed: randomSeed(),
        width,
        height,
        start,
        continentalFraction,
        planetParams,
      });
    },
    [send],
  );
  const newPlanet = (
    scenario: ScenarioId,
    resolutionIndex: number,
    start: PlanetStart,
    planetParams?: Partial<PlanetParameters>,
    continentalFraction?: number,
  ) => {
    send({ type: 'run', running: false });
    setRunning(false);
    setDismissedOutcome(null);
    createPlanet(scenario, resolutionIndex, start, planetParams, continentalFraction);
    setLayer(SCENARIO_VIEW[scenario].layer);
    setOverlays(SCENARIO_VIEW[scenario].overlays ?? []);
    setError(null);
  };

  useEffect(() => {
    const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'frame') {
        setFrame(message.frame);
        if (lastScenario.current !== message.frame.scenario) {
          lastScenario.current = message.frame.scenario;
          setOverlays(SCENARIO_VIEW[message.frame.scenario].overlays ?? []);
        }
        const status = message.frame.goal?.status ?? null;
        if (
          status !== null &&
          status !== 'active' &&
          (lastGoalStatus.current === 'active' || lastGoalStatus.current === null)
        ) {
          setRunning(false);
        }
        lastGoalStatus.current = status;
        if (captureObliquityDefault.current) {
          setObliquityDefault(message.frame.controls.obliquity);
          captureObliquityDefault.current = false;
        }
      } else if (message.type === 'cellLife') {
        setCellLife(message.life);
        setCellClimate(message.climate ?? null);
      } else if (message.type === 'error') setError(message.message);
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
    captureObliquityDefault.current = true;
    const bytes = await file.arrayBuffer();
    workerRef.current?.postMessage({ type: 'load', bytes } satisfies WorkerRequest, [bytes]);
  };

  useEffect(() => {
    for (const id of FLOATING_WINDOWS) {
      try {
        localStorage.setItem(`geogenesis.floatingWindow.${id}.open`, String(windowOpen[id]));
      } catch {
        // Storage can be unavailable in private or embedded browsing contexts.
      }
    }
  }, [windowOpen]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 699px)');
    const update = () => setNarrowWindows(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const closeWindow = (id: FloatingWindowId) => {
    setWindowOpen((current) => ({ ...current, [id]: false }));
    setActiveWindow((current) => (current === id ? null : current));
    setFocusedWindow((current) => (current === id ? null : current));
  };

  const toggleWindow = (id: FloatingWindowId) => {
    if (narrowWindows && windowOpen[id] && activeWindow !== id) {
      setActiveWindow(id);
      setFocusedWindow(id);
      return;
    }
    const opening = !windowOpen[id];
    setWindowOpen((current) => ({ ...current, [id]: opening }));
    setActiveWindow(opening ? id : null);
    setFocusedWindow(opening ? id : null);
  };

  const shortcuts: Shortcuts = {
    ' ': toggleRunning,
    s: step,
    g: () => setView(view === 'map' ? 'globe' : 'map'),
    w: () => toggleOverlay('wind'),
    c: () => toggleOverlay('currents'),
    p: () => toggleOverlay('isobars'),
    t: () => toggleOverlay('mantle'),
    n: () => toggleOverlay('names'),
    i: () => toggleOverlay('icons'),
    v: () => toggleOverlay('events'),
    e: () => toggleWindow('geosphere'),
    a: () => toggleWindow('atmosphere'),
    b: () => toggleWindow('biosphere'),
    d: () => toggleWindow('planet'),
    Escape: () => {
      if (helpOpen) {
        setHelpOpen(false);
        return;
      }
      if (focusedWindow && windowOpen[focusedWindow]) {
        closeWindow(focusedWindow);
        return;
      }
      setTool(null);
      setHelpOpen(false);
    },
    '?': () => setHelpOpen(!helpOpen),
  };
  scenarioView.layers.forEach((id, index) => {
    shortcuts[index === 9 ? '0' : String(index + 1)] = () => chooseLayer(id);
  });
  useShortcuts(shortcuts);

  const tabs: Tab[] = [];
  if (frame?.goal) {
    tabs.push({
      id: 'goal',
      label: 'panel.goal',
      content: <GoalPanel goal={frame.goal} year={frame.year} />,
    });
  }
  if (frame) {
    tabs.push({
      id: 'charts',
      label: 'panel.charts',
      content: (
        <HistoryCharts
          key={frame.scenario}
          history={frame.history}
          series={scenarioView.charts}
          scenario={frame.scenario}
          events={frame.events}
        />
      ),
    });
  }
  if (frame && frame.scenario !== 'daisyworld') {
    tabs.push(
      { id: 'life', label: 'panel.life', content: <LifePanel life={frame.life} /> },
      {
        id: 'civilization',
        label: 'panel.civilization',
        content: (
          <>
            <CivilizationPanel civilization={frame.civilization} />
            <EventLog
              events={frame.events}
              onCentre={(cell) =>
                setCentreRequest((current) => ({ cell, serial: (current?.serial ?? 0) + 1 }))
              }
            />
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
        newPlanetRequest={newPlanetRequest}
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
          <Collapsible title={t('disasters.title')}>
            <DisasterPanel
              disasters={frame.disasters}
              onChange={(disasters) => send({ type: 'disasters', disasters })}
            />
          </Collapsible>
          <nav className="window-launchers" aria-label={t('window.launchers')}>
            {FLOATING_WINDOWS.map((id) => {
              const disabled = id === 'civilization' && frame.civilization.species === null;
              const pressed = windowOpen[id] && (!narrowWindows || activeWindow === id);
              return (
                <button
                  key={id}
                  type="button"
                  className={pressed ? 'selected' : undefined}
                  aria-pressed={pressed}
                  disabled={disabled}
                  title={t(`window.${id}Hint` as MessageKey)}
                  onClick={() => toggleWindow(id)}
                >
                  {WINDOW_ICONS[id]}
                  <span>{t(`window.${id}` as MessageKey)}</span>
                </button>
              );
            })}
          </nav>
        </aside>
      )}
      <main className="stage" ref={stageRef}>
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
                  tool={tool}
                  overlays={frame.scenario === 'daisyworld' ? [] : overlays}
                  temperatureMonth={temperatureMonth}
                  cellLife={cellLife}
                  cellClimate={cellClimate}
                  onInspect={inspectCell}
                  centreRequest={centreRequest}
                  onVisibleIconsChange={visibleIconsChanged}
                  onCellClick={(x, y, direction) => {
                    if (tool)
                      send({
                        type: 'tool',
                        use: {
                          tool,
                          x,
                          y,
                          lifeClass,
                          ...(direction === undefined ? {} : { direction }),
                        },
                      });
                  }}
                />
                <MapLegend
                  layer={shownLayer}
                  iconsOn={overlays.includes('icons')}
                  mantleOn={overlays.includes('mantle')}
                  visibleIcons={visibleMapIcons}
                />
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
          <TabbedPanel
            key={`${frame.scenario}:${frame.goal?.startYear ?? 'sandbox'}`}
            tabs={tabs}
            label="panel.label"
          />
        </aside>
      )}
      {frame &&
        FLOATING_WINDOWS.map((id, index) => {
          if (!windowOpen[id]) return null;
          if (id === 'civilization' && frame.civilization.species === null) return null;
          if (narrowWindows && activeWindow !== id) return null;
          const activate = () => {
            setFocusedWindow(id);
            setActiveWindow(id);
          };
          const group =
            id === 'geosphere' || id === 'atmosphere' || id === 'biosphere'
              ? (id as ControlGroupId)
              : null;
          const defaults = { ...DEFAULT_CONTROLS, obliquity: obliquityDefault };
          const resetAll = group
            ? Object.fromEntries(CONTROL_GROUPS[group].map((key) => [key, defaults[key]]))
            : null;
          const hasChanges = group
            ? CONTROL_GROUPS[group].some((key) => frame.controls[key] !== defaults[key])
            : false;
          return (
            <FloatingWindow
              key={id}
              id={id}
              title={t(`window.${id}Title` as MessageKey)}
              cascadeIndex={index}
              stageRef={stageRef}
              onActivate={activate}
              onClose={() => closeWindow(id)}
              footer={
                resetAll && (
                  <button
                    type="button"
                    title={t('controlsPanel.resetAllHint')}
                    disabled={!hasChanges}
                    onClick={() => send({ type: 'controls', controls: resetAll })}
                  >
                    {t('controlsPanel.resetAll')}
                  </button>
                )
              }
            >
              {id === 'planet' ? (
                <PlanetPanel frame={frame} />
              ) : id === 'civilization' ? (
                <CivilizationControlsPanel
                  policy={frame.civPolicy}
                  age={frame.civilization.age}
                  energySupply={frame.civilization.energySupply}
                  fossilSupply={frame.civilization.fossilSupply}
                  fossilCarbon={frame.fossilCarbon}
                  pollution={frame.pollution}
                  onChange={(policy) => send({ type: 'civPolicy', policy })}
                />
              ) : (
                <ControlsPanel
                  controls={frame.controls}
                  group={id as ControlGroupId}
                  defaults={{ ...DEFAULT_CONTROLS, obliquity: obliquityDefault }}
                  controlLimits={frame.goal?.controlLimits}
                  onChange={(controls) => send({ type: 'controls', controls })}
                />
              )}
            </FloatingWindow>
          );
        })}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {frame?.goal &&
        frame.goal.status !== 'active' &&
        dismissedOutcome !== outcomeKey(frame.goal) && (
          <GoalOutcome
            goal={frame.goal}
            onKeepPlaying={() => {
              setDismissedOutcome(outcomeKey(frame.goal!));
              send({ type: 'run', running: true });
              setRunning(true);
            }}
            onNewPlanet={() => {
              setDismissedOutcome(outcomeKey(frame.goal!));
              setNewPlanetRequest((value) => value + 1);
            }}
          />
        )}
    </div>
  );
}

function outcomeKey(goal: NonNullable<Frame['goal']>): string {
  return `${goal.id}:${goal.status}:${goal.outcomeYear ?? ''}`;
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
