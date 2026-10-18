import { useEffect, useMemo, useRef, useState } from 'react';
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
  mapProjection,
  type ArrowStyle,
  type Projection,
  type VectorField,
} from '../render/arrows';
import { createFlowLayer, stepFlow, type FlowLayer, type FlowStyle } from '../render/particles';
import { drawIsobars } from '../render/isobars';
import {
  layerPixels,
  renderLayer,
  type MapLayer,
  type TemperatureMonth,
} from '../render/mapRenderer';
import type { Frame } from '../worker/protocol';
import { CellInspector, type HoveredCell } from './CellInspector';

/** Ways to look at the planet. */
export const VIEWS = ['map', 'globe'] as const;
export type View = (typeof VIEWS)[number];

/** Side of the globe image, pixels. */
const GLOBE_SIZE = 512;
/** Pointer travel, px, below which a press on the globe counts as a click, not a drag. */
const CLICK_SLOP = 4;

/** Vector fields that can be drawn over any layer: animated particles, or arrows for reduced motion. */
export const OVERLAYS = ['wind', 'currents', 'isobars'] as const;
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

interface Props {
  frame: Frame;
  layer: MapLayer;
  view: View;
  /** Whether clicking applies a tool (changes the cursor). */
  toolActive: boolean;
  /** Called with the grid cell the player clicked. */
  onCellClick: (x: number, y: number) => void;
  /** Flow and pressure overlays to draw. */
  overlays: readonly Overlay[];
  temperatureMonth: TemperatureMonth;
}

/** The planet as a flat map or a globe, with the cell inspector under the pointer. */
export function PlanetView({
  frame,
  layer,
  view,
  toolActive,
  onCellClick,
  overlays,
  temperatureMonth,
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
  const [globeView, setGlobeView] = useState<GlobeView>({ longitude: 180, latitude: 20 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const { width, height } = frame.grid;
  const globeLookup = useMemo(
    () => (view === 'globe' ? buildGlobeLookup(GLOBE_SIZE, globeView, width, height) : null),
    [view, globeView, width, height],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!globeLookup) {
      renderLayer(canvas, frame, layer, temperatureMonth);
      return;
    }
    canvas.width = GLOBE_SIZE;
    canvas.height = GLOBE_SIZE;
    const pixels = projectGlobe(layerPixels(frame, layer, temperatureMonth), globeLookup);
    canvas.getContext('2d')?.putImageData(new ImageData(pixels, GLOBE_SIZE, GLOBE_SIZE), 0, 0);
  }, [frame, layer, globeLookup, temperatureMonth]);

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
    flow.current.project = view === 'globe' ? globeProjection(w, globeView) : mapProjection(w, h);
    flow.current.width = w;
    flow.current.height = h;
  }, [overlaySize, view, globeView]);

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
      else if (area > 0) layers.set(kind, createFlowLayer(field, FLOW_STYLES[kind], area));
    }
  }, [frame, overlays, overlaySize, view]);

  // Isobars use their own static canvas, so particle-trail fading cannot erase them.
  useEffect(() => {
    const canvas = isobarRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width: w, height: h } = overlaySize;
    ctx.clearRect(0, 0, w, h);
    if (!overlays.includes('isobars') || w === 0 || h === 0) return;
    const project = view === 'globe' ? globeProjection(w, globeView) : mapProjection(w, h);
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
  }, [frame, overlays, view, globeView, overlaySize]);

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
    const project = view === 'globe' ? globeProjection(w, globeView) : mapProjection(w, h);
    // Degrees between arrows: the map spans 360° across, the globe's disc 180°.
    const spacing = ((view === 'globe' ? 180 : 360) * ARROW_SPACING) / w;
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
  }, [frame, overlays, view, globeView, overlaySize, reducedMotion]);

  /** Grid cell under the pointer on the map or the globe, or −1 off the planet. */
  const cellAt = (event: React.MouseEvent<HTMLCanvasElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    if (view === 'globe') return globeCell(2 * fx - 1, 1 - 2 * fy, globeView, width, height);
    const x = Math.min(width - 1, Math.floor(fx * width));
    const y = Math.min(height - 1, Math.floor(fy * height));
    return y * width + x;
  };

  /** Shows the inspector for the cell under the pointer; on the globe, a pressed button turns it. */
  const onPointerMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
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
    const dragged = drag.current?.moved;
    drag.current = null;
    if (dragged) return;
    const index = cellAt(event);
    if (index >= 0) onCellClick(index % width, Math.floor(index / width));
  };

  return (
    <>
      <div className={`planet-canvas ${view}-wrap`}>
        <canvas
          ref={canvasRef}
          className={[view, toolActive ? 'tool-active' : ''].join(' ')}
          onMouseDown={(event) => {
            drag.current = { x: event.clientX, y: event.clientY, moved: false };
          }}
          onClick={onClick}
          onMouseMove={onPointerMove}
          onMouseLeave={() => {
            drag.current = null;
            setHovered(null);
          }}
          aria-label={t(view === 'globe' ? 'map.globeLabel' : 'map.label')}
        />
        <canvas ref={overlayRef} className="overlay-arrows" aria-hidden="true" />
        <canvas ref={isobarRef} className="overlay-isobars" aria-hidden="true" />
      </div>
      {hovered && <CellInspector frame={frame} cell={hovered} />}
    </>
  );
}
