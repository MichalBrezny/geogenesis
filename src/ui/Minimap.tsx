import { useEffect, useRef } from 'react';
import { t } from '../i18n/i18n';
import type { GlobeView } from '../render/globe';
import { renderLayer, type MapLayer, type TemperatureMonth } from '../render/mapRenderer';
import { viewBounds, type MapViewport } from '../render/viewport';
import type { Frame } from '../worker/protocol';
import type { View } from './PlanetView';

/** Width of the minimap drawing, CSS pixels (the map is twice as wide as high; CSS may scale it). */
const MINIMAP_WIDTH = 180;
const MARK_COLOR = 'rgba(255, 255, 255, 0.95)';
const MARK_SHADOW = 'rgba(0, 0, 0, 0.6)';
const DEG = Math.PI / 180;

interface Props {
  frame: Frame;
  layer: MapLayer;
  temperatureMonth: TemperatureMonth;
  view: View;
  mapView: MapViewport;
  globeView: GlobeView;
  /** Called with the place the player clicked or dragged to. */
  onCentre: (latitude: number, longitude: number) => void;
}

/** Strokes a path twice, dark under light, so the mark shows on any layer. */
function strokeMark(ctx: CanvasRenderingContext2D, path: () => void) {
  for (const [color, lineWidth] of [
    [MARK_SHADOW, 3.5],
    [MARK_COLOR, 1.5],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    path();
    ctx.stroke();
  }
}

/** The whole planet, small, with the part in view marked; click or drag it to move the view. */
export function Minimap({
  frame,
  layer,
  temperatureMonth,
  view,
  mapView,
  globeView,
  onCentre,
}: Props) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (baseRef.current) renderLayer(baseRef.current, frame, layer, temperatureMonth);
  }, [frame, layer, temperatureMonth]);

  useEffect(() => {
    const canvas = markRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const w = MINIMAP_WIDTH;
    const h = MINIMAP_WIDTH / 2;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.scale(ratio, ratio);
    ctx.lineJoin = 'round';
    const x = (longitude: number) => ((((longitude % 360) + 360) % 360) / 360) * w;
    const y = (latitude: number) => ((90 - latitude) / 180) * h;
    if (view === 'map') {
      // The view rectangle, in two parts where it crosses the map's edge.
      const { west, north, lonSpan, latSpan } = viewBounds(mapView);
      const left = x(west);
      const width = (lonSpan / 360) * w;
      strokeMark(ctx, () => {
        ctx.rect(left, y(north), width, (latSpan / 180) * h);
        if (left + width > w) ctx.rect(left - w, y(north), width, (latSpan / 180) * h);
      });
      return;
    }
    // The globe: the visible hemisphere's edge, 90° from the centre of the disc.
    const lat0 = globeView.latitude * DEG;
    strokeMark(ctx, () => {
      let previous: number | null = null;
      for (let k = 0; k <= 96; k++) {
        const bearing = (k / 96) * 2 * Math.PI;
        const lat = Math.asin(Math.cos(lat0) * Math.cos(bearing));
        const lon =
          globeView.longitude +
          Math.atan2(Math.sin(bearing) * Math.cos(lat0), -Math.sin(lat0) * Math.sin(lat)) / DEG;
        const px = x(lon);
        const py = y(lat / DEG);
        if (previous === null || Math.abs(px - previous) > w / 2) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        previous = px;
      }
      const cx = x(globeView.longitude);
      const cy = y(globeView.latitude);
      ctx.moveTo(cx + 3, cy);
      ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
    });
  }, [view, mapView, globeView]);

  const centreAt = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    onCentre(90 - fy * 180, fx * 360);
  };

  return (
    <div className="minimap">
      <canvas
        ref={baseRef}
        aria-label={t('map.minimapLabel')}
        title={t('map.minimapLabel')}
        onMouseDown={centreAt}
        onMouseMove={(event) => {
          if (event.buttons & 1) centreAt(event);
        }}
      />
      <canvas ref={markRef} className="minimap-mark" aria-hidden="true" />
    </div>
  );
}
