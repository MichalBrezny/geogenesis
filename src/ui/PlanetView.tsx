import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n/i18n';
import {
  buildGlobeLookup,
  dragGlobe,
  globeCell,
  projectGlobe,
  type GlobeView,
} from '../render/globe';
import {
  drawArrows,
  globeProjection,
  type ArrowStyle,
  type Projection,
  type VectorField,
} from '../render/arrows';
import {
  createFlowLayer,
  setFlowRegion,
  stepFlow,
  type FlowLayer,
  type FlowStyle,
} from '../render/particles';
import {
  createAmbientLayer,
  drawAmbient,
  setAmbientGlobeView,
  setAmbientMapView,
  updateAmbientLayer,
  type AmbientLayer,
} from '../render/ambient';
import { systemPrefersReducedMotion } from '../render/ambientPreference';
import { drawIsobars } from '../render/isobars';
import { drawHotspots, mantleVelocityField } from '../render/mantleFlow';
import { drawMapLabels } from '../render/mapLabels';
import {
  drawCityIcons,
  drawDeviceIcons,
  drawEventMarkers,
  drawLifeAndCityIcons,
  sampleIconCells,
  type VisibleMapIcons,
} from '../render/mapIcons';
import {
  layerPixels,
  renderLayer,
  type MapLayer,
  type TemperatureMonth,
} from '../render/mapRenderer';
import {
  clampViewport,
  FULL_VIEW,
  MAX_ZOOM,
  panViewport,
  viewBounds,
  viewportPoint,
  viewportProjection,
  zoomViewport,
  type MapViewport,
} from '../render/viewport';
import type { Frame } from '../worker/protocol';
import { CellInspector, type HoveredCell } from './CellInspector';
import { MAP_ICONS } from './icons';
import { Minimap } from './Minimap';
import { MapExportControls, type CaptureMap } from './MapExportControls';
import { useShortcuts } from './shortcuts';
import type { CellLife } from '../sim/models/biosphere/diversity';
import type { ToolId } from '../sim/tools/tools';
import type { MonthlyClimate } from '../sim/models/atmosphere/climateDiagram';
import { EventMapPanel } from './EventMapPanel';
import { EVENT_CATEGORIES, filterMapEvents, type EventCategory } from './eventMap';
import type { PlanetEvent } from '../sim/events';
import { isTap, pinchGesture, type GesturePoint } from './mapGestures';
import { useAccessibilitySettings } from './AccessibilitySettingsSection';
import { BIOMES, type Biome } from '../sim/data/biomes';
import {
  drawTexturedViewport,
  isTexturedLayer,
  TILE_ANIMATION_MS,
  tileAnimationPhase,
  tileBlend,
} from '../render/terrainTiles';

/** Ways to look at the planet. */
export const VIEWS = ['map', 'globe'] as const;
export type View = (typeof VIEWS)[number];

/** Side of the globe image, pixels. */
const GLOBE_SIZE = 512;
/** Pointer travel, px, below which a press counts as a tap, not a drag. */
const TAP_SLOP = 6;
/** Zoom factor of the zoom buttons and keys. */
const ZOOM_STEP = Math.SQRT2;
/** Zoom per pixel of mouse-wheel travel (exponential, so zooming in and out cancel). */
const WHEEL_ZOOM = 0.002;
const MINIMAP_KEY = 'geogenesis.minimap';

function loadMinimapPreference(): boolean {
  try {
    return globalThis.localStorage.getItem(MINIMAP_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Vector fields that can be drawn over any layer: animated particles, or arrows for reduced motion. */
export const OVERLAYS = [
  'ambient',
  'wind',
  'currents',
  'isobars',
  'mantle',
  'names',
  'icons',
  'events',
] as const;
export type Overlay = (typeof OVERLAYS)[number];
type FlowOverlay = 'wind' | 'currents';

/** Screen pixels between arrows. */
const ARROW_SPACING = 28;
const ARROW_STYLES: Record<FlowOverlay, Omit<ArrowStyle, 'spacing'>> = {
  // Winds: up to ~12 m/s.
  wind: {
    pixelsPerUnit: 2.6,
    maxLength: 24,
    minSpeed: 0.5,
    color: 'rgba(240, 244, 250, 0.85)',
    lineWidth: 1.3,
  },
  // Currents: up to ~0.15 m/s.
  currents: {
    pixelsPerUnit: 220,
    maxLength: 26,
    minSpeed: 0.004,
    color: 'rgba(20, 28, 40, 0.9)',
    lineWidth: 1.5,
  },
};

const FLOW_STYLES: Record<FlowOverlay, FlowStyle> = {
  wind: {
    degreesPerUnit: 0.09,
    minSpeed: 0.3,
    color: 'rgba(255, 255, 255, 0.85)',
    lineWidth: 1.4,
    density: 2.4,
  },
  currents: {
    degreesPerUnit: 6,
    minSpeed: 0.003,
    color: 'rgba(10, 60, 75, 0.9)',
    lineWidth: 1.3,
    density: 2,
  },
};

function overlayField(frame: Frame, overlay: FlowOverlay): VectorField {
  const { width, height } = frame.grid;
  const f = frame.fields;
  return overlay === 'wind'
    ? { width, height, u: f.windU, v: f.windV }
    : { width, height, u: f.oceanCurrentU, v: f.oceanCurrentV };
}

function isFlowOverlay(overlay: Overlay): overlay is FlowOverlay {
  return overlay === 'wind' || overlay === 'currents';
}

/** Projection of the globe or the zoomed map onto `w` × `h` overlay pixels. */
function projection(
  w: number,
  h: number,
  view: View,
  globeView: GlobeView,
  mapView: MapViewport,
): Projection {
  return view === 'globe' ? globeProjection(w, globeView) : viewportProjection(w, h, mapView);
}

/** Where particles live and how fast they move: in view and at an even screen speed. */
function flowRegion(view: View, mapView: MapViewport) {
  if (view === 'globe' || mapView.zoom === 1) return { region: null, speed: 1 };
  return { region: viewBounds(mapView), speed: 1 / mapView.zoom };
}

interface Props {
  frame: Frame;
  layer: MapLayer;
  view: View;
  /** Selected player tool; earthquake turns a drag into a directed push. */
  tool: ToolId | null;
  /** Called with the grid cell the player clicked. */
  onCellClick: (x: number, y: number, direction?: number) => void;
  /** Flow and pressure overlays to draw. */
  overlays: readonly Overlay[];
  temperatureMonth: TemperatureMonth;
  /** Asks the worker for the life classes of the inspected cell. */
  onInspect?: (cell: number) => void;
  /** The worker's answer for the inspected cell. */
  cellLife?: CellLife | null;
  /** Monthly climate returned in the same inspection response. */
  cellClimate?: MonthlyClimate | null;
  /** A log entry can request that both projections face this cell. */
  centreRequest?: { cell: number; serial: number } | null;
  /** Last successfully applied tool, projected identically on the map and globe. */
  toolEffect?: { tool: ToolId; cell: number; serial: number } | null;
  /** Reports the life/city symbols actually represented by the current lattice. */
  onVisibleIconsChange?: (icons: VisibleMapIcons) => void;
  /** Multiplier for animated wind and current particle counts. */
  particleDensity?: number;
}

/** The planet as a flat map or a globe, with the cell inspector under the pointer. */
export function PlanetView({
  frame,
  layer,
  view,
  tool,
  onCellClick,
  overlays,
  temperatureMonth,
  onInspect,
  cellLife,
  cellClimate,
  centreRequest,
  toolEffect,
  onVisibleIconsChange,
  particleDensity = 1,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ambientRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const isobarRef = useRef<HTMLCanvasElement>(null);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });
  const [reducedMotion] = useState(systemPrefersReducedMotion);
  const [terrainAnimationPhase, setTerrainAnimationPhase] = useState(0);
  const paletteMode = useAccessibilitySettings().palette;
  const ambient = useRef<AmbientLayer | null>(null);
  // The running particle animation: its layers and the current projection.
  const flow = useRef<{
    layers: Map<FlowOverlay, FlowLayer>;
    project: Projection | null;
    width: number;
    height: number;
  }>({ layers: new Map(), project: null, width: 0, height: 0 });
  const previousParticleDensity = useRef(particleDensity);
  const [hovered, setHovered] = useState<HoveredCell | null>(null);
  const [keyboardCursor, setKeyboardCursor] = useState<number | null>(null);
  const [keyboardInspector, setKeyboardInspector] = useState<HoveredCell | null>(null);
  const [mapFocused, setMapFocused] = useState(false);
  const [eventCategories, setEventCategories] = useState<Set<EventCategory>>(
    () => new Set(EVENT_CATEGORIES),
  );
  const [selectedEvent, setSelectedEvent] = useState<PlanetEvent | null>(null);
  const inspected = keyboardInspector ?? hovered;
  const inspectedCell = inspected?.index;
  // One request per newly inspected cell and per new frame (the life changes as time runs).
  useEffect(() => {
    if (inspectedCell !== undefined) onInspect?.(inspectedCell);
  }, [inspectedCell, frame, onInspect]);
  const [globeView, setGlobeView] = useState<GlobeView>({ longitude: 180, latitude: 20 });
  const [mapView, setMapView] = useState<MapViewport>(FULL_VIEW);
  const [minimapOn, setMinimapOn] = useState(loadMinimapPreference);
  const pointers = useRef(new Map<number, { start: GesturePoint; current: GesturePoint }>());
  const primaryGesture = useRef<{
    pointerId: number;
    start: GesturePoint;
    last: GesturePoint;
    startCell: number;
    moved: boolean;
    pointerType: string;
  } | null>(null);
  const pinchStart = useRef<{
    firstId: number;
    secondId: number;
    first: GesturePoint;
    second: GesturePoint;
    view: MapViewport;
  } | null>(null);
  const pointerFocused = useRef(false);
  const [directionArrow, setDirectionArrow] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  // The map at 1 pixel per cell; the visible canvas shows the part in view.
  const mapSource = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(MINIMAP_KEY, String(minimapOn));
    } catch {
      // The minimap still works for this session when storage is unavailable.
    }
  }, [minimapOn]);

  const captureMap = useCallback<CaptureMap>((caption, maxWidth) => {
    const base = canvasRef.current;
    if (!base || base.width === 0 || base.height === 0) return null;
    const scale = maxWidth && base.width > maxWidth ? maxWidth / base.width : 1;
    const width = Math.max(1, Math.round(base.width * scale));
    const mapHeight = Math.max(1, Math.round(base.height * scale));
    const captionHeight = caption ? Math.max(26, Math.round(width / 32)) : 0;
    const output = document.createElement('canvas');
    output.width = width;
    output.height = mapHeight + captionHeight;
    const context = output.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#101418';
    context.fillRect(0, 0, output.width, output.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(base, 0, 0, width, mapHeight);
    for (const overlay of [ambientRef.current, overlayRef.current, isobarRef.current]) {
      if (overlay) context.drawImage(overlay, 0, 0, width, mapHeight);
    }
    if (caption) {
      context.imageSmoothingEnabled = true;
      context.fillStyle = '#e6e6e6';
      context.font = `${Math.max(11, Math.round(captionHeight * 0.48))}px system-ui, sans-serif`;
      context.textBaseline = 'middle';
      context.fillText(caption, 10, mapHeight + captionHeight / 2, width - 20);
    }
    return output;
  }, []);

  useEffect(() => {
    if (!centreRequest || centreRequest.cell < 0 || centreRequest.cell >= frame.grid.cellCount)
      return;
    const x = centreRequest.cell % frame.grid.width;
    const y = Math.floor(centreRequest.cell / frame.grid.width);
    const longitude = ((x + 0.5) * 360) / frame.grid.width;
    const latitude = 90 - ((y + 0.5) * 180) / frame.grid.height;
    const handle = requestAnimationFrame(() => {
      setGlobeView({ longitude, latitude });
      setMapView((current) => clampViewport({ ...current, longitude, latitude }));
    });
    return () => cancelAnimationFrame(handle);
  }, [centreRequest, frame.grid.cellCount, frame.grid.height, frame.grid.width]);

  const zoomBy = (factor: number) => setMapView((current) => zoomViewport(current, factor));
  useShortcuts({
    '+': () => zoomBy(ZOOM_STEP),
    '=': () => zoomBy(ZOOM_STEP),
    '-': () => zoomBy(1 / ZOOM_STEP),
    m: () => setMinimapOn((on) => !on),
  });

  const { width, height } = frame.grid;
  const globeLookup = useMemo(
    () => (view === 'globe' ? buildGlobeLookup(GLOBE_SIZE, globeView, width, height) : null),
    [view, globeView, width, height],
  );
  const mapEvents = useMemo(
    () => filterMapEvents(frame.events, eventCategories),
    [frame.events, eventCategories],
  );
  // This allocates two grid-sized arrays only while the mantle overlay is visible.
  const mantleField = useMemo(
    () =>
      overlays.includes('mantle')
        ? mantleVelocityField({
            grid: frame.grid,
            radius: frame.planetParams.radius,
            plateId: frame.fields.plateId,
            plates: frame.tectonics.plates,
          })
        : null,
    [frame, overlays],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!globeLookup) {
      const source = (mapSource.current ??= document.createElement('canvas'));
      renderLayer(source, frame, layer, temperatureMonth);
      return;
    }
    canvas.width = GLOBE_SIZE;
    canvas.height = GLOBE_SIZE;
    const pixels = projectGlobe(layerPixels(frame, layer, temperatureMonth), globeLookup);
    canvas.getContext('2d')?.putImageData(new ImageData(pixels, GLOBE_SIZE, GLOBE_SIZE), 0, 0);
  }, [frame, layer, globeLookup, temperatureMonth, paletteMode]);

  // The flat map is drawn at screen resolution, zoomed and panned.
  useEffect(() => {
    const canvas = canvasRef.current;
    const source = mapSource.current;
    if (view !== 'map' || !canvas || !source) return;
    drawTexturedViewport(
      canvas,
      source,
      frame,
      layer,
      mapView,
      overlaySize.width,
      overlaySize.height,
      reducedMotion ? 0 : terrainAnimationPhase,
    );
  }, [
    frame,
    layer,
    temperatureMonth,
    view,
    mapView,
    overlaySize,
    paletteMode,
    reducedMotion,
    terrainAnimationPhase,
  ]);

  // Only water and lava motifs move, at a deliberately low cadence; reduced motion stays static.
  useEffect(() => {
    const cellPixels = Math.min(
      (overlaySize.width * mapView.zoom) / width,
      (overlaySize.height * mapView.zoom) / height,
    );
    if (reducedMotion || view !== 'map' || !isTexturedLayer(layer) || tileBlend(cellPixels) <= 0) {
      return;
    }
    const update = () => setTerrainAnimationPhase(tileAnimationPhase(performance.now(), false));
    const timer = window.setInterval(update, TILE_ANIMATION_MS);
    return () => window.clearInterval(timer);
  }, [height, layer, mapView.zoom, overlaySize, reducedMotion, view, width]);

  // Mouse-wheel zoom around the pointer; a native listener, so it can keep the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || view !== 'map') return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const fx = (event.clientX - rect.left) / rect.width;
      const fy = (event.clientY - rect.top) / rect.height;
      // Lines (Firefox) to pixels.
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      setMapView((current) => zoomViewport(current, Math.exp(-delta * WHEEL_ZOOM), fx, fy));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [view]);

  // The arrows are drawn at screen resolution, so they track the canvas's size on the page.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() =>
      setOverlaySize({ width: canvas.clientWidth, height: canvas.clientHeight }),
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Size the overlay to the screen and set its projection; this also clears the trails.
  useEffect(() => {
    const ambientCanvas = ambientRef.current;
    const overlay = overlayRef.current;
    const isobars = isobarRef.current;
    if (!ambientCanvas || !overlay || !isobars) return;
    const ratio = window.devicePixelRatio || 1;
    for (const canvas of [ambientCanvas, overlay, isobars]) {
      canvas.width = Math.round(overlaySize.width * ratio);
      canvas.height = Math.round(overlaySize.height * ratio);
      const context = canvas.getContext('2d');
      context?.scale(ratio, ratio);
      if (context) context.imageSmoothingEnabled = false;
    }
    const { width: w, height: h } = overlaySize;
    flow.current.project = projection(w, h, view, globeView, mapView);
    flow.current.width = w;
    flow.current.height = h;
  }, [overlaySize, view, globeView, mapView]);

  // Re-select sparse details only when simulation fields change; the frame loop just paints them.
  useEffect(() => {
    const now = performance.now();
    if (ambient.current) updateAmbientLayer(ambient.current, frame, now);
    else ambient.current = createAmbientLayer(frame, now);
  }, [frame, paletteMode]);

  // Projection changes are also kept outside the animation hot loop.
  useEffect(() => {
    const ambientLayer = ambient.current;
    const { width: w, height: h } = overlaySize;
    if (!ambientLayer) return;
    if (view === 'map') setAmbientMapView(ambientLayer, mapView, w, h);
    else setAmbientGlobeView(ambientLayer, projection(w, h, view, globeView, mapView), w, h);
  }, [frame, overlaySize, view, globeView, mapView]);

  // Keep a particle layer per shown overlay, flowing along the newest fields.
  useEffect(() => {
    const { layers } = flow.current;
    if (previousParticleDensity.current !== particleDensity) {
      layers.clear();
      previousParticleDensity.current = particleDensity;
    }
    const shown = overlays.filter(isFlowOverlay);
    for (const kind of [...layers.keys()]) if (!shown.includes(kind)) layers.delete(kind);
    const area = overlaySize.width * overlaySize.height * (view === 'globe' ? 0.785 : 1);
    for (const kind of shown) {
      const field = overlayField(frame, kind);
      const layer = layers.get(kind);
      if (layer) layer.field = field;
      else if (area > 0) {
        const created = createFlowLayer(
          field,
          { ...FLOW_STYLES[kind], density: FLOW_STYLES[kind].density * particleDensity },
          area,
        );
        const { region, speed } = flowRegion(view, mapView);
        if (region) setFlowRegion(created, region, speed);
        layers.set(kind, created);
      }
    }
  }, [frame, overlays, overlaySize, view, mapView, particleDensity]);

  // Zooming or panning moves the particles into the new view and wipes the old trails.
  useEffect(() => {
    const { region, speed } = flowRegion(view, mapView);
    for (const layer of flow.current.layers.values()) setFlowRegion(layer, region, speed);
    const { width: w, height: h } = flow.current;
    overlayRef.current?.getContext('2d')?.clearRect(0, 0, w, h);
  }, [view, mapView]);

  // Isobars and symbols share one static canvas, outside the particle animation loop.
  useEffect(() => {
    const canvas = isobarRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width: w, height: h } = overlaySize;
    ctx.clearRect(0, 0, w, h);
    if (w === 0 || h === 0) return;
    const project = projection(w, h, view, globeView, mapView);
    if (overlays.includes('isobars')) {
      drawIsobars(
        ctx,
        {
          width: frame.grid.width,
          height: frame.grid.height,
          values: frame.fields.pressure,
          elevation: frame.fields.elevation,
          seaLevel: frame.seaLevel,
          radiusKm: frame.planetParams.radius / 1000,
        },
        project,
        { width: w, height: h },
      );
    }
    const arrowSpacing = ((view === 'globe' ? 180 : 360 / mapView.zoom) * ARROW_SPACING) / w;
    if (mantleField) {
      const scale = Math.max(0.65, view === 'globe' ? w / 640 : w / 1100);
      drawArrows(ctx, mantleField, project, {
        spacing: arrowSpacing,
        pixelsPerUnit: 3.2 * scale,
        maxLength: 28 * scale,
        minSpeed: 0.15,
        color: 'rgba(255, 224, 130, 0.92)',
        lineWidth: 1.5,
      });
      drawHotspots(ctx, frame.tectonics.hotspots, project);
    }
    if (overlays.includes('names')) {
      drawMapLabels(ctx, frame, project, view === 'map' ? mapView.zoom : Math.max(1.4, w / 512));
    }
    let visible: VisibleMapIcons = { lifeClasses: [], cityAge: null };
    if (overlays.includes('icons')) {
      const bounds =
        view === 'map' ? viewBounds(mapView) : { west: 0, north: 90, lonSpan: 360, latSpan: 180 };
      const samples = sampleIconCells({
        gridWidth: frame.grid.width,
        gridHeight: frame.grid.height,
        screenWidth: w,
        screenHeight: h,
        spacing: 32,
        bounds,
        project,
        projectedLonSpan: view === 'globe' ? 180 : bounds.lonSpan,
      });
      visible = drawLifeAndCityIcons(ctx, frame, samples);
      visible.cityAge = drawCityIcons(
        ctx,
        frame.civilization.cities,
        frame.grid.width,
        frame.grid.height,
        project,
        view === 'map' ? mapView.zoom : Math.max(1.4, w / 512),
      );
    }
    onVisibleIconsChange?.(visible);
    drawDeviceIcons(ctx, frame.devices, frame.grid.width, frame.grid.height, project);
    drawEventMarkers(ctx, frame.events, frame.grid.width, frame.grid.height, project);
    if (overlays.includes('events')) {
      drawEventMarkers(ctx, mapEvents, frame.grid.width, frame.grid.height, project, {
        limit: mapEvents.length,
        fade: false,
      });
    }
  }, [
    frame,
    overlays,
    view,
    globeView,
    mapView,
    overlaySize,
    onVisibleIconsChange,
    mantleField,
    mapEvents,
  ]);

  // Animate the particles; with reduced motion, draw still arrows instead.
  useEffect(() => {
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext('2d');
    if (!overlay || !ctx || reducedMotion) return;
    let handle = 0;
    const tick = () => {
      const { layers, project, width: w, height: h } = flow.current;
      if (project && layers.size > 0) stepFlow(ctx, [...layers.values()], project, w, h);
      else ctx.clearRect(0, 0, w, h);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [reducedMotion]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext('2d');
    if (!overlay || !ctx || !reducedMotion) return;
    const { width: w, height: h } = overlaySize;
    ctx.clearRect(0, 0, w, h);
    const shown = overlays.filter(isFlowOverlay);
    if (shown.length === 0 || w === 0) return;
    const project = projection(w, h, view, globeView, mapView);
    // Degrees between arrows: the map spans 360° across (divided by the zoom), the globe's disc 180°.
    const spacing = ((view === 'globe' ? 180 : 360 / mapView.zoom) * ARROW_SPACING) / w;
    const scale = Math.max(0.6, view === 'globe' ? w / 640 : w / 1100);
    for (const kind of shown) {
      const style = ARROW_STYLES[kind];
      drawArrows(ctx, overlayField(frame, kind), project, {
        ...style,
        spacing,
        pixelsPerUnit: style.pixelsPerUnit * scale,
        maxLength: style.maxLength * scale,
      });
    }
  }, [frame, overlays, view, globeView, mapView, overlaySize, reducedMotion]);

  // Ambient pixels animate independently of flow trails; reduced motion paints one still frame.
  useEffect(() => {
    const canvas = ambientRef.current;
    const ctx = canvas?.getContext('2d');
    const ambientLayer = ambient.current;
    if (!canvas || !ctx || !ambientLayer) return;
    if (!overlays.includes('ambient')) {
      ctx.clearRect(0, 0, ambientLayer.width, ambientLayer.height);
      return;
    }
    let handle = 0;
    const tick = (timestamp: number) => {
      drawAmbient(ctx, ambientLayer, timestamp, reducedMotion);
      if (!reducedMotion) handle = requestAnimationFrame(tick);
    };
    if (reducedMotion) tick(0);
    else handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [frame, overlays, view, globeView, mapView, overlaySize, reducedMotion, paletteMode]);

  /** Grid cell under the pointer on the map or the globe, or −1 off the planet. */
  const cellAtPoint = (clientX: number, clientY: number, canvas: HTMLCanvasElement): number => {
    const rect = canvas.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    if (view === 'globe') return globeCell(2 * fx - 1, 1 - 2 * fy, globeView, width, height);
    const { latitude, longitude } = viewportPoint(mapView, fx, fy);
    const x = Math.min(width - 1, Math.floor((longitude / 360) * width));
    const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - latitude) / 180) * height)));
    return y * width + x;
  };

  const inspectedAt = (index: number, left: number, top: number): HoveredCell => {
    const x = index % width;
    const y = Math.floor(index / width);
    return {
      index,
      latitude: 90 - ((y + 0.5) * 180) / height,
      longitude: ((x + 0.5) * 360) / width,
      left,
      top,
    };
  };

  const selectMapEvent = (clientX: number, clientY: number, canvas: HTMLCanvasElement): boolean => {
    if (!overlays.includes('events')) return false;
    const rect = canvas.getBoundingClientRect();
    const project = projection(rect.width, rect.height, view, globeView, mapView);
    for (let k = mapEvents.length - 1; k >= 0; k--) {
      const mapEvent = mapEvents[k]!;
      const cell = mapEvent.cell!;
      const x = cell % width;
      const y = Math.floor(cell / width);
      const point = project(90 - ((y + 0.5) * 180) / height, ((x + 0.5) * 360) / width);
      if (
        point &&
        Math.hypot(point[0] - (clientX - rect.left), point[1] - (clientY - rect.top)) <= 14
      ) {
        setSelectedEvent(mapEvent);
        return true;
      }
    }
    return false;
  };

  const activatePoint = (clientX: number, clientY: number, canvas: HTMLCanvasElement) => {
    if (selectMapEvent(clientX, clientY, canvas)) return;
    const index = cellAtPoint(clientX, clientY, canvas);
    if (index < 0) return;
    setHovered(inspectedAt(index, clientX + 16, clientY + 16));
    onCellClick(index % width, Math.floor(index / width));
  };

  const zoomed = view === 'map' && mapView.zoom > 1;
  const effectPoint = (() => {
    if (!toolEffect || overlaySize.width <= 0) return null;
    const x = toolEffect.cell % width;
    const y = Math.floor(toolEffect.cell / width);
    return projection(
      overlaySize.width,
      overlaySize.height,
      view,
      globeView,
      mapView,
    )(90 - ((y + 0.5) * 180) / height, ((x + 0.5) * 360) / width);
  })();

  const cursorPoint = (() => {
    if (!mapFocused || keyboardCursor === null || overlaySize.width <= 0) return null;
    const x = keyboardCursor % width;
    const y = Math.floor(keyboardCursor / width);
    return projection(
      overlaySize.width,
      overlaySize.height,
      view,
      globeView,
      mapView,
    )(90 - ((y + 0.5) * 180) / height, ((x + 0.5) * 360) / width);
  })();

  /** Shows the inspector for a mouse pointer that is not currently dragging. */
  const inspectPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const index = cellAtPoint(event.clientX, event.clientY, event.currentTarget);
    if (index < 0) {
      setHovered(null);
      return;
    }
    setHovered(inspectedAt(index, event.clientX + 16, event.clientY + 16));
  };

  const beginPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerFocused.current = true;
    event.currentTarget.focus({ preventScroll: true });
    pointerFocused.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, { start: point, current: point });
    if (pointers.current.size === 1) {
      primaryGesture.current = {
        pointerId: event.pointerId,
        start: point,
        last: point,
        startCell: cellAtPoint(point.x, point.y, event.currentTarget),
        moved: false,
        pointerType: event.pointerType,
      };
      return;
    }
    const entries = [...pointers.current.entries()].slice(0, 2);
    const [firstId, firstPointer] = entries[0]!;
    const [secondId, secondPointer] = entries[1]!;
    pinchStart.current = {
      firstId,
      secondId,
      first: firstPointer.current,
      second: secondPointer.current,
      view: mapView,
    };
    if (primaryGesture.current) primaryGesture.current.moved = true;
    setHovered(null);
  };

  const movePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const tracked = pointers.current.get(event.pointerId);
    if (tracked) tracked.current = { x: event.clientX, y: event.clientY };
    const pinch = pinchStart.current;
    if (pinch && view === 'map') {
      const first = pointers.current.get(pinch.firstId)?.current;
      const second = pointers.current.get(pinch.secondId)?.current;
      if (first && second) {
        const gesture = pinchGesture(pinch.first, pinch.second, first, second);
        const rect = event.currentTarget.getBoundingClientRect();
        const zoomedView = zoomViewport(
          pinch.view,
          gesture.scale,
          (gesture.startCentre.x - rect.left) / rect.width,
          (gesture.startCentre.y - rect.top) / rect.height,
        );
        setMapView(
          panViewport(
            zoomedView,
            (gesture.centre.x - gesture.startCentre.x) / rect.width,
            (gesture.centre.y - gesture.startCentre.y) / rect.height,
          ),
        );
        setHovered(null);
      }
      return;
    }
    if (pinch) return;
    const gesture = primaryGesture.current;
    if (gesture?.pointerId === event.pointerId && tracked) {
      const threshold = gesture.pointerType === 'touch' ? TAP_SLOP * 1.5 : TAP_SLOP;
      if (!isTap(gesture.start, tracked.current, threshold)) gesture.moved = true;
      if (gesture.moved && tool === 'earthquake') {
        const rect = event.currentTarget.getBoundingClientRect();
        setDirectionArrow({
          x1: gesture.start.x - rect.left,
          y1: gesture.start.y - rect.top,
          x2: event.clientX - rect.left,
          y2: event.clientY - rect.top,
        });
        setHovered(null);
        return;
      }
      if (gesture.moved) {
        const rect = event.currentTarget.getBoundingClientRect();
        const dx = event.clientX - gesture.last.x;
        const dy = event.clientY - gesture.last.y;
        if (view === 'globe') {
          const radius = rect.width / 2;
          setGlobeView((current) => dragGlobe(current, dx / radius, dy / radius));
        } else {
          setMapView((current) => panViewport(current, dx / rect.width, dy / rect.height));
        }
        gesture.last = tracked.current;
        setHovered(null);
        return;
      }
    }
    if (event.pointerType === 'mouse') inspectPointer(event);
  };

  const endPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const gesture = primaryGesture.current;
    const wasPinch = pinchStart.current !== null;
    const endCell = cellAtPoint(event.clientX, event.clientY, event.currentTarget);
    pointers.current.delete(event.pointerId);
    if (pinchStart.current && pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size > 0) {
      const [pointerId, pointer] = pointers.current.entries().next().value!;
      primaryGesture.current = {
        pointerId,
        start: pointer.current,
        last: pointer.current,
        startCell: wasPinch
          ? -1
          : cellAtPoint(pointer.current.x, pointer.current.y, event.currentTarget),
        moved: true,
        pointerType: event.pointerType,
      };
      return;
    }
    primaryGesture.current = null;
    setDirectionArrow(null);
    if (!gesture || gesture.pointerId !== event.pointerId || wasPinch) return;
    if (tool === 'earthquake' && gesture.moved && gesture.startCell >= 0 && endCell >= 0) {
      const direction = bearingBetweenCells(gesture.startCell, endCell, width, height);
      onCellClick(gesture.startCell % width, Math.floor(gesture.startCell / width), direction);
      return;
    }
    if (!gesture.moved) activatePoint(event.clientX, event.clientY, event.currentTarget);
  };

  const cancelPointers = () => {
    pointers.current.clear();
    primaryGesture.current = null;
    pinchStart.current = null;
    setDirectionArrow(null);
  };

  const centreCell = (): number => {
    const centre = view === 'globe' ? globeView : mapView;
    const wrappedLongitude = ((centre.longitude % 360) + 360) % 360;
    const x = Math.floor((wrappedLongitude / 360) * width) % width;
    const y = Math.min(
      height - 1,
      Math.max(0, Math.floor(((90 - centre.latitude) / 180) * height)),
    );
    return y * width + x;
  };

  const setKeyboardCell = (index: number, centreView: boolean) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const longitude = ((x + 0.5) * 360) / width;
    const latitude = 90 - ((y + 0.5) * 180) / height;
    setKeyboardCursor(index);
    if (centreView) {
      if (view === 'globe') setGlobeView({ longitude, latitude });
      else setMapView((current) => clampViewport({ ...current, longitude, latitude }));
    }
    const rect = canvasRef.current?.getBoundingClientRect();
    setKeyboardInspector(
      inspectedAt(
        index,
        (rect?.left ?? 0) + (rect?.width ?? 0) / 2 + 16,
        (rect?.top ?? 0) + (rect?.height ?? 0) / 2 + 16,
      ),
    );
  };

  const onMapKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const moves: Partial<Record<string, readonly [number, number]>> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      event.stopPropagation();
      const current = keyboardCursor ?? centreCell();
      const x = ((current % width) + move[0] + width) % width;
      const y = Math.min(height - 1, Math.max(0, Math.floor(current / width) + move[1]));
      setKeyboardCell(y * width + x, true);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const index = keyboardCursor ?? centreCell();
      setKeyboardCell(index, false);
      onCellClick(index % width, Math.floor(index / width));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setKeyboardCursor(null);
      setKeyboardInspector(null);
    }
  };

  const cellAlternative = inspected
    ? (() => {
        const relativeElevation = frame.fields.elevation[inspected.index]! - frame.seaLevel;
        const biome = BIOMES[frame.fields.biome[inspected.index] as Biome];
        return t('map.inspectedCell', {
          position: formatMapPosition(inspected.latitude, inspected.longitude),
          biome: t(`biome.${biome.key}` as MessageKey),
          elevation: t(relativeElevation < 0 ? 'map.oceanDepth' : 'map.landElevation', {
            value: Math.round(Math.abs(relativeElevation)).toLocaleString('en'),
          }),
          temperature: t('map.temperatureValue', {
            value: frame.fields.airTemperature[inspected.index]!.toFixed(1),
          }),
        });
      })()
    : t('map.noInspectedCell');
  const mapAlternative = t('map.textAlternative', {
    view: t(`view.${view}`),
    layer: t(`layer.${layer}`),
    age: t('map.ageGyr', { value: (frame.year / 1e9).toFixed(3) }),
    cell: cellAlternative,
  });

  return (
    <>
      <div className={`planet-canvas ${view}-wrap`}>
        <canvas
          ref={canvasRef}
          className={[view, zoomed ? 'zoomed' : '', tool ? 'tool-active' : ''].join(' ')}
          tabIndex={0}
          title={t('map.keyboardHint')}
          onPointerDown={(event) => {
            setKeyboardCursor(null);
            setKeyboardInspector(null);
            beginPointer(event);
          }}
          onPointerUp={endPointer}
          onPointerCancel={cancelPointers}
          onPointerMove={movePointer}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse' && event.buttons === 0) setHovered(null);
          }}
          onKeyDown={onMapKeyDown}
          onFocus={() => {
            setMapFocused(true);
            if (pointerFocused.current) {
              pointerFocused.current = false;
              return;
            }
            if (keyboardCursor === null) setKeyboardCell(centreCell(), false);
          }}
          onBlur={() => setMapFocused(false)}
          aria-label={mapAlternative}
        >
          {mapAlternative}
        </canvas>
        <canvas ref={ambientRef} className="overlay-ambient" aria-hidden="true" />
        {cursorPoint && (
          <span
            className="keyboard-cursor"
            style={{ left: cursorPoint[0], top: cursorPoint[1] }}
            aria-hidden="true"
          />
        )}
        {directionArrow && (
          <svg className="direction-arrow" aria-hidden="true">
            <defs>
              <marker
                id="direction-arrow-head"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0 0 8 4 0 8Z" />
              </marker>
            </defs>
            <line
              x1={directionArrow.x1}
              y1={directionArrow.y1}
              x2={directionArrow.x2}
              y2={directionArrow.y2}
              markerEnd="url(#direction-arrow-head)"
            />
          </svg>
        )}
        {effectPoint && toolEffect && (
          <svg
            key={toolEffect.serial}
            className="tool-effect"
            viewBox={`0 0 ${overlaySize.width} ${overlaySize.height}`}
            aria-hidden="true"
          >
            <circle className="tool-effect-area" cx={effectPoint[0]} cy={effectPoint[1]} r="25" />
            <circle className="tool-effect-ring" cx={effectPoint[0]} cy={effectPoint[1]} r="11" />
          </svg>
        )}
        <canvas ref={overlayRef} className="overlay-arrows" aria-hidden="true" />
        <canvas ref={isobarRef} className="overlay-isobars" aria-hidden="true" />
        <div className="map-controls">
          {view === 'map' && (
            <>
              <button
                onClick={() => zoomBy(ZOOM_STEP)}
                disabled={mapView.zoom >= MAX_ZOOM}
                title={t('map.zoomIn')}
                aria-label={t('map.zoomIn')}
              >
                {MAP_ICONS.zoomIn}
              </button>
              <button
                onClick={() => zoomBy(1 / ZOOM_STEP)}
                disabled={!zoomed}
                title={t('map.zoomOut')}
                aria-label={t('map.zoomOut')}
              >
                {MAP_ICONS.zoomOut}
              </button>
              <button
                onClick={() => setMapView(FULL_VIEW)}
                disabled={!zoomed}
                title={t('map.zoomReset')}
                aria-label={t('map.zoomReset')}
              >
                {MAP_ICONS.zoomReset}
              </button>
            </>
          )}
          <button
            className={minimapOn ? 'selected' : ''}
            onClick={() => setMinimapOn((on) => !on)}
            aria-pressed={minimapOn}
            title={t('map.minimap')}
            aria-label={t('map.minimap')}
          >
            {MAP_ICONS.minimap}
          </button>
        </div>
        <MapExportControls frame={frame} layer={layer} capture={captureMap} />
        {minimapOn && (view === 'globe' || zoomed) && (
          <Minimap
            frame={frame}
            layer={layer}
            temperatureMonth={temperatureMonth}
            view={view}
            mapView={mapView}
            globeView={globeView}
            onCentre={(latitude, longitude) =>
              view === 'globe'
                ? setGlobeView({ latitude, longitude })
                : setMapView((current) => clampViewport({ ...current, latitude, longitude }))
            }
          />
        )}
        {overlays.includes('events') && (
          <EventMapPanel
            enabled={eventCategories}
            onToggle={(category) => {
              setEventCategories((current) => {
                const next = new Set(current);
                if (next.has(category)) next.delete(category);
                else next.add(category);
                return next;
              });
              setSelectedEvent(null);
            }}
            selected={selectedEvent}
            onClear={() => setSelectedEvent(null)}
          />
        )}
      </div>
      {inspected && (
        <CellInspector frame={frame} cell={inspected} life={cellLife} climate={cellClimate} />
      )}
    </>
  );
}

/** Initial great-circle bearing, clockwise from north. */
function bearingBetweenCells(start: number, end: number, width: number, height: number): number {
  const x1 = start % width;
  const y1 = Math.floor(start / width);
  const x2 = end % width;
  const y2 = Math.floor(end / width);
  const lat1 = ((90 - ((y1 + 0.5) * 180) / height) * Math.PI) / 180;
  const lat2 = ((90 - ((y2 + 0.5) * 180) / height) * Math.PI) / 180;
  let dLon = ((((x2 - x1) * 2 * Math.PI) / width + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (dLon < -Math.PI) dLon += 2 * Math.PI;
  return Math.atan2(
    Math.sin(dLon) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon),
  );
}

function formatMapPosition(latitude: number, longitude: number): string {
  const wrappedLongitude = ((longitude % 360) + 360) % 360;
  return t('map.positionValue', {
    latitude: Math.abs(latitude).toFixed(0),
    northSouth: t(latitude >= 0 ? 'map.north' : 'map.south'),
    longitude: Math.abs(wrappedLongitude > 180 ? 360 - wrappedLongitude : wrappedLongitude).toFixed(
      0,
    ),
    eastWest: t(wrappedLongitude > 180 ? 'map.west' : 'map.east'),
  });
}
