import { useCallback, useEffect, useRef, useState } from 'react';
import { formatNumber, t, type MessageKey } from '../i18n/i18n';
import {
  LAYER_FIELDS,
  type MapLayer,
  type RenderedField,
  type TemperatureMonth,
} from '../render/mapRenderer';
import { isTexturedLayer, TERRAIN_TILE_FIELDS } from '../render/terrainTiles';
import type { Frame, WorkerRequest, WorkerResponse } from '../worker/protocol';
import type { PlanetCreation } from '../worker/protocol';
import type { ScenarioId } from '../sim/scenarios';
import type { LifeClassKey } from '../sim/data/lifeClasses';
import type { CellLife } from '../sim/models/biosphere/diversity';
import type { MonthlyClimate } from '../sim/models/atmosphere/climateDiagram';
import type { ToolId } from '../sim/tools/tools';
import { ALL_CHART_SERIES, HistoryCharts, type ChartSeries } from './charts/HistoryCharts';
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
import { DEFAULT_CONTROLS, type Difficulty } from '../sim/core/planet';
import { PlanetPanel } from './PlanetPanel';
import { AtmosphereDiagnostics, BiosphereDiagnostics } from './PlanetDiagnostics';
import { GoalOutcome, GoalPanel } from './GoalPanel';
import type { VisibleMapIcons } from '../render/mapIcons';
import { DisasterPanel } from './DisasterPanel';
import { CivilizationControlsPanel } from './CivilizationControlsPanel';
import type { NewPlanetChoice } from './NewPlanetDialog';
import { HelpDialog } from './HelpDialog';
import { AutoPausePanel } from './AutoPausePanel';
import { loadAutoPauseSettings, saveAutoPauseSettings } from './autoPauseSettings';
import { CurrentTaskPanel } from './CurrentTaskPanel';
import { ToastStack } from './ToastStack';
import { eventSignature, eventsAfter, mergeToastEvents, type EventToast } from './toastQueue';
import { FirstGameTour } from './FirstGameTour';
import { rememberTourComplete, shouldStartTour, TOUR_ANCHORS, type GuidePageId } from './guide';
import { SettingsDialog } from './SettingsDialog';
import { SoundSettingsSection } from './SoundSettingsSection';
import { loadSettings, saveSettings, type Settings } from './settings';
import {
  addAutosave,
  createBrowserSaveStore,
  latestAutosave,
  listSaves,
  renameSave,
  saveManualSlot,
  type StoredSave,
} from './saveStore';
import { AudioEngine } from '../audio/audioEngine';
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from '../audio/audioSettings';
import { copyText, decodePlanetHash, encodePlanetHash } from './planetShare';
import { loadAmbientPreference, saveAmbientPreference } from '../render/ambientPreference';
import {
  AccessibilitySettingsSection,
  useAccessibilitySettings,
} from './AccessibilitySettingsSection';

/** How long a tool notice stays on screen, ms. */
const NOTICE_DURATION = 3000;

/** Fields used by the hover inspector and map-name lookup regardless of the active layer. */
const INSPECTOR_FIELDS: readonly RenderedField[] = [
  'elevation',
  'plateId',
  'volcanicActivity',
  'discharge',
  'lakeDepth',
  'lakeType',
  'windU',
  'windV',
  'pressure',
  'cloudCover',
  'airTemperature',
  'seasonalAmplitude',
  'co2Ice',
  'precipitation',
  'biome',
  'vegetation',
  'lifeTier',
  'civilization',
];

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
  const accessibilitySettings = useAccessibilitySettings();
  const workerRef = useRef<Worker | null>(null);
  const saveStore = useRef(createBrowserSaveStore());
  const pendingBrowserSaves = useRef(
    new Map<
      number,
      {
        kind: 'manual' | 'autosave';
        id: string;
        name: string;
        scenario: ScenarioId;
        planetAge: number;
        era: Frame['era'];
        savedAt: number;
      }
    >(),
  );
  const nextSaveRequest = useRef(1);
  const lastHideSave = useRef(0);
  const [soundSettings, setSoundSettings] = useState(loadAudioSettings);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  if (audioEngineRef.current === null) audioEngineRef.current = new AudioEngine(soundSettings);
  const stageRef = useRef<HTMLElement>(null);
  const captureObliquityDefault = useRef(true);
  const [frame, setFrame] = useState<Frame | null>(null);
  const startupShare = useRef<PlanetCreation | null>(decodePlanetHash(window.location.hash));
  const startupShareAccepted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<MapLayer>('terrain');
  const [view, setView] = useState<View>('map');
  const [temperatureMonth, setTemperatureMonth] = useState<TemperatureMonth>('annual');
  const [overlays, setOverlays] = useState<Overlay[]>(() =>
    loadAmbientPreference() ? ['icons', 'ambient'] : ['icons'],
  );
  const toggleOverlay = (overlay: Overlay) =>
    setOverlays((current) =>
      current.includes(overlay) ? current.filter((o) => o !== overlay) : [...current, overlay],
    );
  useEffect(() => saveAmbientPreference(overlays.includes('ambient')), [overlays]);
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
  const [settings, setSettings] = useState(loadSettings);
  const initialSettings = useRef(settings);
  const [speed, setSpeed] = useState<Speed>(settings.speed);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [browserSaves, setBrowserSaves] = useState<StoredSave[]>([]);
  const [continueSave, setContinueSave] = useState<StoredSave | null>(null);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [lifeClass, setLifeClass] = useState<LifeClassKey>('prokaryotes');
  const [cellLife, setCellLife] = useState<CellLife | null>(null);
  const [cellClimate, setCellClimate] = useState<MonthlyClimate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPage, setHelpPage] = useState<GuidePageId | undefined>();
  const [tourOpen, setTourOpen] = useState(() => {
    try {
      return shouldStartTour(window.localStorage);
    } catch {
      return true;
    }
  });
  const [selectedSideTab, setSelectedSideTab] = useState<string | undefined>();
  const [focusedChart, setFocusedChart] = useState<ChartSeries | null>(null);
  const [windowOpen, setWindowOpen] = useState<WindowOpenState>(loadWindowOpenState);
  const [activeWindow, setActiveWindow] = useState<FloatingWindowId | null>(
    () => [...FLOATING_WINDOWS].reverse().find((id) => loadWindowOpenState()[id]) ?? null,
  );
  const [focusedWindow, setFocusedWindow] = useState<FloatingWindowId | null>(null);
  const [obliquityDefault, setObliquityDefault] = useState(DEFAULT_CONTROLS.obliquity);
  const [narrowWindows, setNarrowWindows] = useState(() => window.innerWidth < 700);
  const noticeTimer = useRef<number | undefined>(undefined);
  const toolEffectTimer = useRef<number | undefined>(undefined);
  const lastGoalStatus = useRef<string | null>(null);
  const lastScenario = useRef<ScenarioId | null>(null);
  const [dismissedOutcome, setDismissedOutcome] = useState<string | null>(null);
  const [newPlanetRequest, setNewPlanetRequest] = useState(0);
  const [centreRequest, setCentreRequest] = useState<{ cell: number; serial: number } | null>(null);
  const [visibleMapIcons, setVisibleMapIcons] = useState<VisibleMapIcons>({
    lifeClasses: [],
    cityAge: null,
  });
  const [autoPauseSettings, setAutoPauseSettings] = useState(loadAutoPauseSettings);
  const initialAutoPauseSettings = useRef(autoPauseSettings);
  const [toasts, setToasts] = useState<EventToast[]>([]);
  const toastWorldRevision = useRef<number | null>(null);
  const lastToastEvent = useRef<string | undefined>(undefined);
  const [toolEffect, setToolEffect] = useState<{
    tool: ToolId;
    cell: number;
    serial: number;
  } | null>(null);
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
  const frameRef = useRef(frame);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);
  const refreshBrowserSaves = useCallback(async () => {
    const saves = await listSaves(saveStore.current);
    setBrowserSaves(saves);
    setContinueSave(await latestAutosave(saveStore.current));
  }, []);
  const requestBrowserSave = useCallback(
    (kind: 'manual' | 'autosave', name: string, overwriteId?: string) => {
      const current = frameRef.current;
      if (!current) return;
      const requestId = nextSaveRequest.current++;
      pendingBrowserSaves.current.set(requestId, {
        kind,
        id: overwriteId ?? `${kind}-${Date.now()}-${requestId}`,
        name,
        scenario: current.scenario,
        planetAge: current.year,
        era: current.era,
        savedAt: Date.now(),
      });
      send({ type: 'save', requestId });
    },
    [send],
  );
  const persistBrowserSave = useCallback(
    async (message: Extract<WorkerResponse, { type: 'saved' }>) => {
      if (message.requestId === undefined) {
        download(message.bytes, message.fileName);
        return;
      }
      const pending = pendingBrowserSaves.current.get(message.requestId);
      pendingBrowserSaves.current.delete(message.requestId);
      if (!pending) return;
      const save = { ...pending, bytes: message.bytes };
      const stored =
        pending.kind === 'autosave'
          ? await addAutosave(saveStore.current, save)
          : await saveManualSlot(saveStore.current, save);
      if (!stored) setNotice(t('saves.unavailable'));
      await refreshBrowserSaves();
    },
    [refreshBrowserSaves],
  );
  const dismissToast = useCallback(
    (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)),
    [],
  );

  const inspectCell = useCallback((cell: number) => send({ type: 'inspect', cell }), [send]);

  const createPlanet = useCallback(
    (
      scenario: ScenarioId,
      resolutionIndex: number,
      start: PlanetStart = 'young',
      planetParams?: Partial<PlanetParameters>,
      continentalFraction?: number,
      difficulty: Difficulty = 'normal',
      adaptivePacing = true,
      seed = randomSeed(),
    ) => {
      const [width, height] = RESOLUTIONS[resolutionIndex]!;
      captureObliquityDefault.current = true;
      lastGoalStatus.current = null;
      send({
        type: 'create',
        scenario,
        seed,
        width,
        height,
        start,
        continentalFraction,
        planetParams,
        difficulty,
        adaptivePacing,
      });
    },
    [send],
  );
  const newPlanet = (choice: NewPlanetChoice) => {
    const {
      scenario,
      resolutionIndex,
      start,
      planetParams,
      continentalFraction,
      difficulty,
      adaptivePacing,
      seed,
    } = choice;
    send({ type: 'run', running: false });
    setRunning(false);
    setDismissedOutcome(null);
    createPlanet(
      scenario,
      resolutionIndex,
      start,
      planetParams,
      continentalFraction,
      difficulty,
      adaptivePacing,
      seed,
    );
    setLayer(SCENARIO_VIEW[scenario].layer);
    setOverlays((current) => [
      ...(SCENARIO_VIEW[scenario].overlays ?? []),
      ...(current.includes('ambient') ? (['ambient'] as const) : []),
    ]);
    setError(null);
  };

  const copyShareLink = useCallback(async () => {
    if (!frame) return;
    const url = new URL(window.location.href);
    url.hash = encodePlanetHash(frame.creation);
    const copied = await copyText(url.toString());
    setNotice(t(copied ? 'share.copied' : 'share.copyFailed'));
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_DURATION);
  }, [frame]);

  useEffect(() => {
    const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'frame') {
        setFrame((current) =>
          !current || current.worldRevision !== message.frame.worldRevision
            ? (message.frame as Frame)
            : ({
                ...message.frame,
                fields: { ...current.fields, ...message.frame.fields },
              } as Frame),
        );
        requestAnimationFrame(() =>
          worker.postMessage({ type: 'frameAck' } satisfies WorkerRequest),
        );
        setRunning(message.frame.running);
        if (toastWorldRevision.current !== message.frame.worldRevision) {
          toastWorldRevision.current = message.frame.worldRevision;
          lastToastEvent.current = message.frame.events.at(-1)
            ? eventSignature(message.frame.events.at(-1)!)
            : '__empty__';
          setToasts([]);
        } else {
          const added = eventsAfter(message.frame.events, lastToastEvent.current);
          lastToastEvent.current = message.frame.events.at(-1)
            ? eventSignature(message.frame.events.at(-1)!)
            : '__empty__';
          if (added.length > 0)
            setToasts((current) => mergeToastEvents(current, added, performance.now()));
          audioEngineRef.current?.playEvents(added);
        }
        if (lastScenario.current !== message.frame.scenario) {
          lastScenario.current = message.frame.scenario;
          setOverlays((current) => [
            ...(SCENARIO_VIEW[message.frame.scenario].overlays ?? []),
            ...(current.includes('ambient') ? (['ambient'] as const) : []),
          ]);
        }
        if (startupShareAccepted.current) {
          startupShareAccepted.current = false;
          setLayer(SCENARIO_VIEW[message.frame.scenario].layer);
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
      else if (message.type === 'saved') void persistBrowserSave(message);
      else if (message.type === 'toolApplied') {
        setToolEffect((current) => ({
          tool: message.tool,
          cell: message.cell,
          serial: (current?.serial ?? 0) + 1,
        }));
        window.clearTimeout(toolEffectTimer.current);
        toolEffectTimer.current = window.setTimeout(() => setToolEffect(null), 1_200);
      } else {
        setNotice(t(message.reason === 'energy' ? 'tools.noEnergy' : 'tools.notAllowed'));
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_DURATION);
      }
    };
    workerRef.current = worker;
    worker.postMessage({
      type: 'autoPause',
      settings: initialAutoPauseSettings.current,
    } satisfies WorkerRequest);
    worker.postMessage({
      type: 'speed',
      delayMs: SPEEDS[initialSettings.current.speed],
    } satisfies WorkerRequest);
    const shared = startupShare.current;
    if (shared && window.confirm(t('share.openPrompt'))) {
      startupShareAccepted.current = true;
      worker.postMessage({ type: 'create', ...shared } satisfies WorkerRequest);
    } else {
      createPlanet(
        'random',
        initialSettings.current.resolutionIndex,
        'young',
        undefined,
        undefined,
        'normal',
        initialSettings.current.adaptivePacing,
      );
    }
    void refreshBrowserSaves();
    return () => {
      window.clearTimeout(toolEffectTimer.current);
      worker.terminate();
    };
  }, [createPlanet, persistBrowserSave, refreshBrowserSaves]);

  useEffect(() => {
    const engine = audioEngineRef.current;
    if (!engine) return;
    const startAudio = () => engine.start();
    window.addEventListener('pointerdown', startAudio, { once: true });
    window.addEventListener('keydown', startAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', startAudio);
      window.removeEventListener('keydown', startAudio);
      engine.destroy();
    };
  }, []);

  useEffect(() => {
    saveAudioSettings(soundSettings);
    audioEngineRef.current?.setSettings(soundSettings);
  }, [soundSettings]);

  useEffect(() => {
    audioEngineRef.current?.setEra(frame?.era ?? null);
    audioEngineRef.current?.setPaused(!running);
  }, [frame?.era, running]);

  useEffect(() => {
    const updateVisibility = () => audioEngineRef.current?.setHidden(document.hidden);
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  const scenarioView = SCENARIO_VIEW[frame?.scenario ?? 'random'];
  // A loaded game may be another scenario than the layer was chosen for.
  const shownLayer = scenarioView.layers.includes(layer) ? layer : scenarioView.layer;

  useEffect(() => {
    const fields = new Set<RenderedField>([...INSPECTOR_FIELDS, ...LAYER_FIELDS[shownLayer]]);
    if (overlays.includes('wind')) {
      fields.add('windU');
      fields.add('windV');
    }
    if (overlays.includes('currents')) {
      fields.add('oceanCurrentU');
      fields.add('oceanCurrentV');
    }
    if (isTexturedLayer(shownLayer)) for (const field of TERRAIN_TILE_FIELDS) fields.add(field);
    if (overlays.includes('isobars')) fields.add('pressure');
    if (overlays.includes('icons')) {
      fields.add('civilization');
      fields.add('dominantClass');
    }
    if (overlays.includes('ambient')) {
      fields.add('elevation');
      fields.add('iceCover');
      fields.add('cloudCover');
      fields.add('windU');
      fields.add('windV');
      fields.add('volcanicActivity');
      fields.add('civilization');
      fields.add('dominantClass');
    }
    send({ type: 'view', fields: [...fields] });
  }, [overlays, send, shownLayer]);

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
    send({ type: 'run', running: false });
    setRunning(false);
    captureObliquityDefault.current = true;
    const bytes = await file.arrayBuffer();
    workerRef.current?.postMessage({ type: 'load', bytes } satisfies WorkerRequest, [bytes]);
  };
  const loadStoredSave = (save: StoredSave) => {
    setError(null);
    send({ type: 'run', running: false });
    setRunning(false);
    captureObliquityDefault.current = true;
    const bytes = save.bytes.slice(0);
    workerRef.current?.postMessage({ type: 'load', bytes } satisfies WorkerRequest, [bytes]);
    setContinueSave(null);
  };
  const applySettings = (next: Settings) => {
    setSettings(next);
    saveSettings(next);
    changeSpeed(next.speed);
    send({ type: 'pacing', adaptive: next.adaptivePacing });
  };

  useEffect(() => {
    if (settings.autosaveInterval === 0) return;
    const timer = window.setInterval(
      () => requestBrowserSave('autosave', t('saves.autosaveName')),
      settings.autosaveInterval * 60_000,
    );
    return () => window.clearInterval(timer);
  }, [requestBrowserSave, settings.autosaveInterval]);

  useEffect(() => {
    const requestHideSave = () => {
      const now = Date.now();
      if (settings.autosaveInterval !== 0 && now - lastHideSave.current > 1_000) {
        lastHideSave.current = now;
        requestBrowserSave('autosave', t('saves.autosaveName'));
      }
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === 'hidden') requestHideSave();
    };
    document.addEventListener('visibilitychange', saveWhenHidden);
    window.addEventListener('pagehide', requestHideSave);
    return () => {
      document.removeEventListener('visibilitychange', saveWhenHidden);
      window.removeEventListener('pagehide', requestHideSave);
    };
  }, [requestBrowserSave, settings.autosaveInterval]);

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

  const openHelp = (page?: GuidePageId) => {
    setHelpPage(page);
    setHelpOpen(true);
  };
  const finishTour = () => {
    try {
      rememberTourComplete(window.localStorage);
    } catch {
      /* The guide can still be skipped for this session. */
    }
    setTourOpen(false);
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
    u: () => setSoundSettings((current) => ({ ...current, muted: !current.muted })),
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
    '?': () => {
      setHelpPage(undefined);
      setHelpOpen(!helpOpen);
    },
    ',': () => setSettingsOpen(true),
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
          key={`${frame.scenario}:${focusedChart ?? ''}`}
          history={frame.history}
          series={scenarioView.charts}
          scenario={frame.scenario}
          events={frame.events}
          focusSeries={focusedChart}
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
    <div className="app" data-contrast={accessibilitySettings.highContrast ? 'high' : undefined}>
      <TopBar
        frame={frame}
        running={running}
        onToggleRunning={toggleRunning}
        onStep={step}
        speed={speed}
        onSpeedChange={changeSpeed}
        onAdaptivePacingChange={(adaptivePacing) => {
          const next = { ...settings, adaptivePacing };
          setSettings(next);
          saveSettings(next);
          send({ type: 'pacing', adaptive: adaptivePacing });
        }}
        onNewPlanet={newPlanet}
        onSave={(fileName) => send({ type: 'save', fileName })}
        onLoad={(file) => void load(file)}
        onCopyShareLink={() => void copyShareLink()}
        onShowHelp={() => openHelp()}
        onShowSettings={() => setSettingsOpen(true)}
        settings={settings}
        saves={browserSaves}
        latestAutosave={continueSave}
        onSaveSlot={(name, overwriteId) => requestBrowserSave('manual', name, overwriteId)}
        onLoadSlot={loadStoredSave}
        onRenameSlot={(id, name) => {
          void renameSave(saveStore.current, id, name).then(refreshBrowserSaves);
        }}
        onDeleteSlot={(id) => {
          void saveStore.current.delete(id).then(refreshBrowserSaves);
        }}
        error={error}
        newPlanetRequest={newPlanetRequest}
        soundSettings={soundSettings}
        onSoundSettingsChange={(settings: AudioSettings) => setSoundSettings(settings)}
      />
      {frame && (
        <aside className="sidebar left" aria-label={t('sidebar.tools')}>
          <CurrentTaskPanel frame={frame} onHelp={openHelp} />
          <Collapsible
            helpPage="goals"
            onHelp={openHelp}
            tourAnchor={TOUR_ANCHORS.tool}
            title={
              <>
                {t('tools.title')}{' '}
                <span className="energy">
                  {frame.unlimitedEnergy
                    ? t('tools.unlimited')
                    : t('tools.energy', { value: formatNumber(Math.floor(frame.energy)) })}
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
          <Collapsible title={t('disasters.title')} helpPage="disasters" onHelp={openHelp}>
            <DisasterPanel
              disasters={frame.disasters}
              onChange={(disasters) => send({ type: 'disasters', disasters })}
            />
          </Collapsible>
          <Collapsible title={t('autoPause.title')} open={false} helpPage="goals" onHelp={openHelp}>
            <AutoPausePanel
              settings={autoPauseSettings}
              onChange={(settings) => {
                setAutoPauseSettings(settings);
                saveAutoPauseSettings(settings);
                send({ type: 'autoPause', settings });
              }}
            />
          </Collapsible>
          <nav
            className="window-launchers"
            aria-label={t('window.launchers')}
            data-tour={TOUR_ANCHORS.windows}
          >
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
                  toolEffect={toolEffect}
                  onVisibleIconsChange={visibleIconsChanged}
                  particleDensity={settings.particleDensity}
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
        <aside className="sidebar right" aria-label={t('sidebar.details')}>
          <TabbedPanel
            key={`${frame.scenario}:${frame.goal?.startYear ?? 'sandbox'}`}
            tabs={tabs}
            label="panel.label"
            selectedId={selectedSideTab}
            onSelect={setSelectedSideTab}
            onHelp={openHelp}
          />
        </aside>
      )}
      <ToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        onCentre={(cell) =>
          setCentreRequest((current) => ({ cell, serial: (current?.serial ?? 0) + 1 }))
        }
      />
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={applySettings}
        >
          <SoundSettingsSection settings={soundSettings} onChange={setSoundSettings} />
          <AccessibilitySettingsSection />
        </SettingsDialog>
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
              helpPage={
                (
                  {
                    geosphere: 'geosphere',
                    atmosphere: 'atmosphereWater',
                    biosphere: 'life',
                    civilization: 'civilization',
                    planet: 'geosphere',
                  } as const
                )[id]
              }
              onHelp={openHelp}
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
                <PlanetPanel frame={frame} onCopyShareLink={() => void copyShareLink()} />
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
                <>
                  <ControlsPanel
                    controls={frame.controls}
                    effectiveControls={frame.effectiveControls}
                    group={id as ControlGroupId}
                    defaults={{ ...DEFAULT_CONTROLS, obliquity: obliquityDefault }}
                    controlLimits={frame.goal?.controlLimits}
                    onChange={(controls) => send({ type: 'controls', controls })}
                  />
                  {id === 'atmosphere' && <AtmosphereDiagnostics frame={frame} />}
                  {id === 'biosphere' && <BiosphereDiagnostics frame={frame} />}
                </>
              )}
            </FloatingWindow>
          );
        })}
      {helpOpen && (
        <HelpDialog
          onClose={() => setHelpOpen(false)}
          onRestartTour={() => {
            setHelpOpen(false);
            setTourOpen(true);
          }}
          initialPage={helpPage}
          availableLayers={scenarioView.layers}
          availableCharts={ALL_CHART_SERIES}
          onLayer={(next) => {
            chooseLayer(next);
            setHelpOpen(false);
          }}
          onChart={(chart) => {
            setSelectedSideTab('charts');
            setFocusedChart(chart);
            setHelpOpen(false);
          }}
        />
      )}
      {frame && tourOpen && <FirstGameTour onFinish={finishTour} />}
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
