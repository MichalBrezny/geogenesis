import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/i18n';
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
import { drawIsobars } from '../render/isobars';
import { drawHotspots, mantleVelocityField } from '../render/mantleFlow';
import { drawMapLabels } from '../render/mapLabels';
import {
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
  drawViewport,
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

/** Ways to look at the planet. */
export const VIEWS = ['map', 'globe'] as const;
export type View = (typeof VIEWS)[number];

/** Side of the globe image, pixels. */
const GLOBE_SIZE = 512;
/** Pointer travel, px, below which a press on the globe counts as a click, not a drag. */
const CLICK_SLOP = 4;
/** Zoom factor of the zoom buttons and keys. */
const ZOOM_STEP = Math.SQRT2;
/** Zoom per pixel of mouse-wheel travel (exponential, so zooming in and out cancel). */
const WHEEL_ZOOM = 0.002;
const MINIMAP_KEY = 'geogenesis.minimap';

/** Vector fields that can be drawn over any layer: animated particles, or arrows for reduced motion. */
export const OVERLAYS = [
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

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const isobarRef = useRef<HTMLCanvasElement>(null);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });
  const [reducedMotion] = useState(prefersReducedMotion);
  // The running particle animation: its layers and the current projection.
  const flow = useRef<{
    layers: Map<FlowOverlay, FlowLayer>;
    project: Projection | null;
    width: number;
    height: number;
  }>({ layers: new Map(), project: null, width: 0, height: 0 });
  const [hovered, setHovered] = useState<HoveredCell | null>(null);
  const [eventCategories, setEventCategories] = useState<Set<EventCategory>>(
    () => new Set(EVENT_CATEGORIES),
  );
  const [selectedEvent, setSelectedEvent] = useState<PlanetEvent | null>(null);
  const hoveredCell = hovered?.index;
  // One request per newly inspected cell and per new frame (the life changes as time runs).
  useEffect(() => {
    if (hoveredCell !== undefined) onInspect?.(hoveredCell);
  }, [hoveredCell, frame, onInspect]);
  const [globeView, setGlobeView] = useState<GlobeView>({ longitude: 180, latitude: 20 });
  const [mapView, setMapView] = useState<MapViewport>(FULL_VIEW);
  const [minimapOn, setMinimapOn] = useState(() => {
    try {
      return localStorage.getItem(MINIMAP_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const drag = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
    startCell: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
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
      localStorage.setItem(MINIMAP_KEY, String(minimapOn));
    } catch {
      // The map remains usable when storage is unavailable.
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
    for (const overlay of [overlayRef.current, isobarRef.current]) {
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
  }, [frame, layer, globeLookup, temperatureMonth]);

  // The flat map is drawn at screen resolution, zoomed and panned.
  useEffect(() => {
    const canvas = canvasRef.current;
    const source = mapSource.current;
    if (view !== 'map' || !canvas || !source) return;
    drawViewport(canvas, source, mapView, overlaySize.width, overlaySize.height);
  }, [frame, layer, temperatureMonth, view, mapView, overlaySize]);

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
    const overlay = overlayRef.current;
    const isobars = isobarRef.current;
    if (!overlay || !isobars) return;
    const ratio = window.devicePixelRatio || 1;
    for (const canvas of [overlay, isobars]) {
      canvas.width = Math.round(overlaySize.width * ratio);
      canvas.height = Math.round(overlaySize.height * ratio);
      canvas.getContext('2d')?.scale(ratio, ratio);
    }
    const { width: w, height: h } = overlaySize;
    flow.current.project = projection(w, h, view, globeView, mapView);
    flow.current.width = w;
    flow.current.height = h;
  }, [overlaySize, view, globeView, mapView]);

  // Keep a particle layer per shown overlay, flowing along the newest fields.
  useEffect(() => {
    const { layers } = flow.current;
    const shown = overlays.filter(isFlowOverlay);
    for (const kind of [...layers.keys()]) if (!shown.includes(kind)) layers.delete(kind);
    const area = overlaySize.width * overlaySize.height * (view === 'globe' ? 0.785 : 1);
    for (const kind of shown) {
      const field = overlayField(frame, kind);
      const layer = layers.get(kind);
      if (layer) layer.field = field;
      else if (area > 0) {
        const created = createFlowLayer(field, FLOW_STYLES[kind], area);
        const { region, speed } = flowRegion(view, mapView);
        if (region) setFlowRegion(created, region, speed);
        layers.set(kind, created);
      }
    }
  }, [frame, overlays, overlaySize, view, mapView]);

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
      visible = drawLifeAndCityIcons(ctx, frame, frame.civilization.age, samples);
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

  /** Grid cell under the pointer on the map or the globe, or −1 off the planet. */
  const cellAt = (event: React.MouseEvent<HTMLCanvasElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    if (view === 'globe') return globeCell(2 * fx - 1, 1 - 2 * fy, globeView, width, height);
    const { latitude, longitude } = viewportPoint(mapView, fx, fy);
    const x = Math.min(width - 1, Math.floor((longitude / 360) * width));
    const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - latitude) / 180) * height)));
    return y * width + x;
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

  /**
   * Shows the inspector for the cell under the pointer; a pressed button turns the
   * globe or moves a zoomed map.
   */
  const onPointerMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const start = drag.current;
    if (tool === 'earthquake' && start && event.buttons & 1) {
      const dx = event.clientX - start.originX;
      const dy = event.clientY - start.originY;
      if (start.moved || Math.hypot(dx, dy) > CLICK_SLOP) {
        const rect = event.currentTarget.getBoundingClientRect();
        start.moved = true;
        setDirectionArrow({
          x1: start.originX - rect.left,
          y1: start.originY - rect.top,
          x2: event.clientX - rect.left,
          y2: event.clientY - rect.top,
        });
        setHovered(null);
        return;
      }
    }
    if ((view === 'globe' || zoomed) && start && event.buttons & 1) {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (start.moved || Math.hypot(dx, dy) > CLICK_SLOP) {
        const rect = event.currentTarget.getBoundingClientRect();
        if (view === 'globe') {
          const radius = rect.width / 2;
          setGlobeView((current) => dragGlobe(current, dx / radius, dy / radius));
        } else {
          setMapView((current) => panViewport(current, dx / rect.width, dy / rect.height));
        }
        drag.current = { ...start, x: event.clientX, y: event.clientY, moved: true };
        setHovered(null);
        return;
      }
    }
    const index = cellAt(event);
    if (index < 0) {
      setHovered(null);
      return;
    }
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

  /** Clicks a cell (not at the end of a drag). */
  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const dragged = drag.current?.moved;
    drag.current = null;
    if (dragged) return;
    if (overlays.includes('events')) {
      const rect = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const project = projection(rect.width, rect.height, view, globeView, mapView);
      for (let k = mapEvents.length - 1; k >= 0; k--) {
        const mapEvent = mapEvents[k]!;
        const cell = mapEvent.cell!;
        const x = cell % width;
        const y = Math.floor(cell / width);
        const point = project(90 - ((y + 0.5) * 180) / height, ((x + 0.5) * 360) / width);
        if (point && Math.hypot(point[0] - pointerX, point[1] - pointerY) <= 14) {
          setSelectedEvent(mapEvent);
          return;
        }
      }
    }
    const index = cellAt(event);
    if (index >= 0) onCellClick(index % width, Math.floor(index / width));
  };

  const onMouseUp = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const start = drag.current;
    if (tool !== 'earthquake' || !start?.moved || start.startCell < 0) return;
    const end = cellAt(event);
    drag.current = null;
    setDirectionArrow(null);
    suppressClick.current = true;
    if (end < 0) return;
    const direction = bearingBetweenCells(start.startCell, end, width, height);
    onCellClick(start.startCell % width, Math.floor(start.startCell / width), direction);
  };

  return (
    <>
      <div className={`planet-canvas ${view}-wrap`}>
        <canvas
          ref={canvasRef}
          className={[view, zoomed ? 'zoomed' : '', tool ? 'tool-active' : ''].join(' ')}
          onMouseDown={(event) => {
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              originX: event.clientX,
              originY: event.clientY,
              startCell: cellAt(event),
              moved: false,
            };
          }}
          onMouseUp={onMouseUp}
          onClick={onClick}
          onMouseMove={onPointerMove}
          onMouseLeave={() => {
            drag.current = null;
            setDirectionArrow(null);
            setHovered(null);
          }}
          aria-label={t(view === 'globe' ? 'map.globeLabel' : 'map.label')}
        />
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
      {hovered && (
        <CellInspector frame={frame} cell={hovered} life={cellLife} climate={cellClimate} />
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
