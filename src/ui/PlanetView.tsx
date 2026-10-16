import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/i18n';
import {
  buildGlobeLookup,
  dragGlobe,
  globeCell,
  projectGlobe,
  type GlobeView,
} from '../render/globe';
import { layerPixels, renderLayer, type MapLayer } from '../render/mapRenderer';
import type { Frame } from '../worker/protocol';
import { CellInspector, type HoveredCell } from './CellInspector';

/** Ways to look at the planet. */
export const VIEWS = ['map', 'globe'] as const;
export type View = (typeof VIEWS)[number];

/** Side of the globe image, pixels. */
const GLOBE_SIZE = 512;
/** Pointer travel, px, below which a press on the globe counts as a click, not a drag. */
const CLICK_SLOP = 4;

interface Props {
  frame: Frame;
  layer: MapLayer;
  view: View;
  /** Whether clicking applies a tool (changes the cursor). */
  toolActive: boolean;
  /** Called with the grid cell the player clicked. */
  onCellClick: (x: number, y: number) => void;
}

/** The planet as a flat map or a globe, with the cell inspector under the pointer. */
export function PlanetView({ frame, layer, view, toolActive, onCellClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      renderLayer(canvas, frame, layer);
      return;
    }
    canvas.width = GLOBE_SIZE;
    canvas.height = GLOBE_SIZE;
    const pixels = projectGlobe(layerPixels(frame, layer), globeLookup);
    canvas.getContext('2d')?.putImageData(new ImageData(pixels, GLOBE_SIZE, GLOBE_SIZE), 0, 0);
  }, [frame, layer, globeLookup]);

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
      {hovered && <CellInspector frame={frame} cell={hovered} />}
    </>
  );
}
