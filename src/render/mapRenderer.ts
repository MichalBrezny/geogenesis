import type { Fields } from '../sim/core/fields';
import type { Grid } from '../sim/core/grid';
import { SEA_LEVEL } from '../sim/models/geosphere/flowRouting';
import { elevationPalette, temperaturePalette, type Rgb } from './palettes';

/** The fields the map needs; a PlanetState or a snapshot sent from the simulation worker. */
export const RENDERED_FIELDS = ['elevation', 'plateId', 'drainageArea', 'airTemperature'] as const;
export interface MapSource {
  grid: Pick<Grid, 'width' | 'height' | 'cellCount'>;
  fields: Pick<Fields, (typeof RENDERED_FIELDS)[number]>;
}

/** Map layers the player can switch between. */
export const MAP_LAYERS = ['terrain', 'plates', 'airTemperature'] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

/** Drainage area (m²) above which a land cell is drawn as a river. */
const RIVER_MIN_AREA = 1.5e12;
/** Drainage area at which rivers reach full colour. */
const RIVER_FULL_AREA = 2e13;
const RIVER_COLOR: Rgb = [40, 90, 200];

type CellColor = (state: MapSource, i: number) => Rgb;

const layerColors: Record<MapLayer, CellColor> = {
  terrain(state, i) {
    const { elevation, drainageArea } = state.fields;
    const base = elevationPalette(elevation[i]!);
    const area = drainageArea[i]!;
    if (elevation[i]! < SEA_LEVEL || area < RIVER_MIN_AREA) return base;
    const t = Math.min(
      1,
      0.4 + (0.6 * Math.log(area / RIVER_MIN_AREA)) / Math.log(RIVER_FULL_AREA / RIVER_MIN_AREA),
    );
    return mix(base, RIVER_COLOR, t);
  },
  plates(state, i) {
    const base = plateColor(state.fields.plateId[i]!);
    // Dim the ocean so continents stay recognisable.
    return state.fields.elevation[i]! < SEA_LEVEL ? mix(base, [10, 20, 40], 0.45) : base;
  },
  airTemperature(state, i) {
    return temperaturePalette(state.fields.airTemperature[i]!);
  },
};

/**
 * Draws one layer at native grid resolution (1 pixel per cell) into the canvas.
 * The canvas is scaled up with CSS (`image-rendering: pixelated`).
 */
export function renderLayer(canvas: HTMLCanvasElement, state: MapSource, layer: MapLayer): void {
  const { width, height, cellCount } = state.grid;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const image = ctx.createImageData(width, height);
  const color = layerColors[layer];
  for (let i = 0; i < cellCount; i++) {
    const [r, g, b] = color(state, i);
    const p = i * 4;
    image.data[p] = r;
    image.data[p + 1] = g;
    image.data[p + 2] = b;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Distinct, stable colour per plate id (golden-angle hue spacing). */
function plateColor(id: number): Rgb {
  const hue = (id * 137.508) % 360;
  return hslToRgb(hue, 0.55, 0.55);
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
