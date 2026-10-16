import type { Fields } from '../sim/core/fields';
import type { Grid } from '../sim/core/grid';
import { Biome, BIOMES } from '../sim/data/biomes';
import { SEA_LEVEL } from '../sim/models/geosphere/flowRouting';
import {
  elevationPalette,
  precipitationPalette,
  pressurePalette,
  seaAnomalyPalette,
  temperaturePalette,
  windSpeedPalette,
  type Rgb,
} from './palettes';

/** The fields the map needs; a PlanetState or a snapshot sent from the simulation worker. */
export const RENDERED_FIELDS = [
  'elevation',
  'plateId',
  'discharge',
  'windU',
  'windV',
  'pressure',
  'oceanCurrentU',
  'oceanCurrentV',
  'oceanAnomaly',
  'airTemperature',
  'iceCover',
  'precipitation',
  'daisyWhite',
  'daisyBlack',
  'biome',
  'vegetation',
  'lifeTier',
  'civilization',
] as const;
export interface MapSource {
  grid: Pick<Grid, 'width' | 'height' | 'cellCount'>;
  fields: Pick<Fields, (typeof RENDERED_FIELDS)[number]>;
}

/** Map layers the player can switch between. */
export const MAP_LAYERS = [
  'terrain',
  'plates',
  'airTemperature',
  'pressure',
  'precipitation',
  'wind',
  'oceanCurrents',
  'biomes',
  'life',
  'civilization',
  'daisies',
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

/** Discharge (m³/yr) above which a land cell is drawn as a river (~3,000 m³/s; Earth has ~50). */
export const RIVER_MIN_DISCHARGE = 1e11;
/** Discharge at which rivers reach full colour (~100,000 m³/s, half an Amazon). */
const RIVER_FULL_DISCHARGE = 3e12;
const RIVER_COLOR: Rgb = [40, 90, 200];
const LAND_ICE_COLOR: Rgb = [238, 242, 246];
const SEA_ICE_COLOR: Rgb = [200, 215, 230];
const BARE_GROUND: Rgb = [196, 168, 118];
/** Settlements on the civilization layer (categorical slot 2, orange). */
const CIVILIZATION_COLOR: Rgb = [235, 104, 52];
/** Barren land before plants. */
export const BARREN_COLOR: Rgb = [120, 105, 95];
/**
 * Most advanced life per cell: lifeless, then each tier in LIFE_TIERS order on a
 * single-hue ramp (dark to light = simple to complex on the dark map).
 */
export const LIFE_TIER_COLORS: readonly Rgb[] = [
  [43, 47, 54],
  [24, 79, 149],
  [37, 106, 191],
  [57, 135, 229],
  [109, 167, 236],
  [183, 211, 246],
];

type CellColor = (state: MapSource, i: number) => Rgb;

const layerColors: Record<MapLayer, CellColor> = {
  terrain(state, i) {
    const { elevation, discharge, iceCover } = state.fields;
    const ocean = elevation[i]! < SEA_LEVEL;
    let color = elevationPalette(elevation[i]!);
    const flow = discharge[i]!;
    if (!ocean && flow >= RIVER_MIN_DISCHARGE) {
      const t = Math.min(
        1,
        0.4 +
          (0.6 * Math.log(flow / RIVER_MIN_DISCHARGE)) /
            Math.log(RIVER_FULL_DISCHARGE / RIVER_MIN_DISCHARGE),
      );
      color = mix(color, RIVER_COLOR, t);
    }
    const ice = iceCover[i]!;
    return ice > 0 ? mix(color, ocean ? SEA_ICE_COLOR : LAND_ICE_COLOR, 0.2 + 0.8 * ice) : color;
  },
  plates(state, i) {
    const base = plateColor(state.fields.plateId[i]!);
    // Dim the ocean so continents stay recognisable.
    return state.fields.elevation[i]! < SEA_LEVEL ? mix(base, [10, 20, 40], 0.45) : base;
  },
  airTemperature(state, i) {
    return temperaturePalette(state.fields.airTemperature[i]!);
  },
  pressure(state, i) {
    return pressurePalette(state.fields.pressure[i]!);
  },
  biomes(state, i) {
    const { biome, vegetation, elevation } = state.fields;
    const color = BIOMES[biome[i] as Biome].color;
    // Climate says what could grow; plant cover says how much of it actually does.
    if (elevation[i]! < SEA_LEVEL || biome[i] === Biome.Ice) return color;
    return mix(BARREN_COLOR, color, Math.min(1, vegetation[i]! * 1.5));
  },
  civilization(state, i) {
    const { civilization, elevation } = state.fields;
    const base: Rgb = elevation[i]! < SEA_LEVEL ? [22, 34, 52] : [52, 56, 62];
    const density = civilization[i]!;
    if (density <= 0) return base;
    // Log scale: stone-age bands and industrial cities differ by orders of magnitude.
    const t = Math.min(1, Math.max(0.15, (Math.log10(density) + 5) / 5));
    return mix(base, CIVILIZATION_COLOR, t);
  },
  life(state, i) {
    return LIFE_TIER_COLORS[state.fields.lifeTier[i]!]!;
  },
  daisies(state, i) {
    const { daisyWhite, daisyBlack, elevation } = state.fields;
    if (elevation[i]! < SEA_LEVEL) return [20, 40, 80];
    const white = daisyWhite[i]!;
    const black = daisyBlack[i]!;
    const bare = Math.max(0, 1 - white - black);
    return [
      Math.round(BARE_GROUND[0] * bare + 245 * white + 22 * black),
      Math.round(BARE_GROUND[1] * bare + 245 * white + 22 * black),
      Math.round(BARE_GROUND[2] * bare + 235 * white + 28 * black),
    ];
  },
  wind(state, i) {
    const { windU, windV, elevation } = state.fields;
    const color = windSpeedPalette(Math.hypot(windU[i]!, windV[i]!));
    // Land a little darker, so the coastlines stay visible.
    return elevation[i]! < SEA_LEVEL ? color : mix(color, [40, 40, 40], 0.35);
  },
  oceanCurrents(state, i) {
    const { oceanAnomaly, elevation } = state.fields;
    if (elevation[i]! >= SEA_LEVEL) return [58, 60, 64];
    return seaAnomalyPalette(oceanAnomaly[i]!);
  },
  precipitation(state, i) {
    const color = precipitationPalette(state.fields.precipitation[i]!);
    return state.fields.elevation[i]! < SEA_LEVEL ? mix(color, [10, 20, 40], 0.5) : color;
  },
};

/** Colours one layer at native grid resolution as RGBA pixels (1 pixel per cell). */
export function layerPixels(state: MapSource, layer: MapLayer): Uint8ClampedArray<ArrayBuffer> {
  const { cellCount } = state.grid;
  const pixels = new Uint8ClampedArray(cellCount * 4);
  const color = layerColors[layer];
  for (let i = 0; i < cellCount; i++) {
    const [r, g, b] = color(state, i);
    const p = i * 4;
    pixels[p] = r;
    pixels[p + 1] = g;
    pixels[p + 2] = b;
    pixels[p + 3] = 255;
  }
  return pixels;
}

/**
 * Draws one layer at native grid resolution (1 pixel per cell) into the canvas.
 * The canvas is scaled up with CSS (`image-rendering: pixelated`).
 */
export function renderLayer(canvas: HTMLCanvasElement, state: MapSource, layer: MapLayer): void {
  const { width, height } = state.grid;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(new ImageData(layerPixels(state, layer), width, height), 0, 0);
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
