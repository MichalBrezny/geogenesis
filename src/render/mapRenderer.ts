import type { Fields } from '../sim/core/fields';
import type { Grid } from '../sim/core/grid';
import { Biome, BIOMES } from '../sim/data/biomes';
import { LakeType } from '../sim/models/geosphere/flowRouting';
import { co2FrostCover } from '../sim/models/atmosphere/co2Frost';
import {
  clathratePalette,
  diversityPalette,
  elevationPalette,
  hazardPalette,
  nutrientPalette,
  oceanOxygenPalette,
  precipitationPalette,
  pressurePalette,
  seasonalRangePalette,
  seaAnomalyPalette,
  temperaturePalette,
  volcanicPalette,
  windSpeedPalette,
  type Rgb,
} from './palettes';

/** The fields the map needs; a PlanetState or a snapshot sent from the simulation worker. */
export const RENDERED_FIELDS = [
  'elevation',
  'plateId',
  'volcanicActivity',
  'discharge',
  'lakeDepth',
  'lakeType',
  'windU',
  'windV',
  'pressure',
  'oceanCurrentU',
  'oceanCurrentV',
  'oceanAnomaly',
  'cloudCover',
  'airTemperature',
  'seasonalAmplitude',
  'iceCover',
  'co2Ice',
  'oceanOxygen',
  'nutrients',
  'precipitation',
  'daisyWhite',
  'daisyBlack',
  'biome',
  'vegetation',
  'lifeTier',
  'dominantClass',
  'diversity',
  'civilization',
  'hazard',
] as const;
export interface MapSource {
  grid: Pick<Grid, 'width' | 'height' | 'cellCount'>;
  fields: Pick<Fields, (typeof RENDERED_FIELDS)[number]>;
  seaLevel: number;
  /** Methane in clathrates/permafrost, microbar CH4 equivalent (2.8 Gt C each). */
  clathrateCarbon?: number;
}

/** Map layers the player can switch between. */
export const MAP_LAYERS = [
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
  'oceanOxygen',
  'nutrients',
  'clathrates',
  'biomes',
  'life',
  'diversity',
  'civilization',
  'hazard',
  'daisies',
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];
export const TEMPERATURE_MONTHS = ['annual', 'january', 'july'] as const;
export type TemperatureMonth = (typeof TEMPERATURE_MONTHS)[number];

/** Discharge (m³/yr) above which a land cell is drawn as a river (~3,000 m³/s; Earth has ~50). */
export const RIVER_MIN_DISCHARGE = 1e11;
/** Discharge at which rivers reach full colour (~100,000 m³/s, half an Amazon). */
const RIVER_FULL_DISCHARGE = 3e12;
const RIVER_COLOR: Rgb = [40, 90, 200];
export const FRESH_LAKE_COLOR: Rgb = [45, 105, 175];
export const SALT_LAKE_COLOR: Rgb = [205, 225, 226];
export const SALT_FLAT_COLOR: Rgb = [181, 171, 150];
const LAND_ICE_COLOR: Rgb = [238, 242, 246];
const SEA_ICE_COLOR: Rgb = [200, 215, 230];
/** Pale lavender distinguishes CO2 frost from blue-white water ice. */
export const CO2_FROST_COLOR: Rgb = [232, 220, 244];
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

type CellColor = (state: MapSource, i: number, temperatureMonth: TemperatureMonth) => Rgb;

const layerColors: Record<MapLayer, CellColor> = {
  terrain(state, i) {
    const { elevation, discharge, iceCover, co2Ice, lakeType } = state.fields;
    const ocean = elevation[i]! < state.seaLevel;
    const lake = lakeType[i]!;
    let color = elevationPalette(elevation[i]! - state.seaLevel);
    if (lake === LakeType.Fresh) color = FRESH_LAKE_COLOR;
    else if (lake === LakeType.Salt) color = SALT_LAKE_COLOR;
    else if (lake === LakeType.SaltFlat) color = SALT_FLAT_COLOR;
    const flow = discharge[i]!;
    if (!ocean && lake === LakeType.None && flow >= RIVER_MIN_DISCHARGE) {
      const t = Math.min(
        1,
        0.4 +
          (0.6 * Math.log(flow / RIVER_MIN_DISCHARGE)) /
            Math.log(RIVER_FULL_DISCHARGE / RIVER_MIN_DISCHARGE),
      );
      color = mix(color, RIVER_COLOR, t);
    }
    const ice = iceCover[i]!;
    if (ice > 0) color = mix(color, ocean ? SEA_ICE_COLOR : LAND_ICE_COLOR, 0.2 + 0.8 * ice);
    const frost = co2FrostCover(co2Ice[i]!);
    return frost > 0 ? mix(color, CO2_FROST_COLOR, 0.25 + 0.75 * frost) : color;
  },
  plates(state, i) {
    const base = PLATE_PALETTE[state.fields.plateId[i]! % PLATE_PALETTE.length]!;
    // Dim the ocean so continents stay recognisable.
    return state.fields.elevation[i]! < state.seaLevel ? mix(base, [10, 20, 40], 0.45) : base;
  },
  volcanism(state, i) {
    const terrain = elevationPalette(state.fields.elevation[i]! - state.seaLevel);
    const activity = state.fields.volcanicActivity[i]!;
    return mix(
      mix(terrain, [12, 16, 22], 0.72),
      volcanicPalette(activity),
      Math.min(0.9, activity / 3),
    );
  },
  airTemperature(state, i, temperatureMonth) {
    return temperaturePalette(displayedTemperature(state, i, temperatureMonth));
  },
  seasons(state, i) {
    return seasonalRangePalette(state.fields.seasonalAmplitude[i]!);
  },
  pressure(state, i) {
    const color = pressurePalette(state.fields.pressure[i]!);
    // Neutral land shading preserves the pressure signal while making continents legible.
    return state.fields.elevation[i]! < state.seaLevel ? color : mix(color, [55, 55, 55], 0.3);
  },
  biomes(state, i) {
    const { biome, vegetation, elevation } = state.fields;
    const color = BIOMES[biome[i] as Biome].color;
    // Climate says what could grow; plant cover says how much of it actually does.
    if (elevation[i]! < state.seaLevel || biome[i] === Biome.Ice) return color;
    return mix(BARREN_COLOR, color, Math.min(1, vegetation[i]! * 1.5));
  },
  civilization(state, i) {
    const { civilization, elevation } = state.fields;
    const base: Rgb = elevation[i]! < state.seaLevel ? [22, 34, 52] : [52, 56, 62];
    const density = civilization[i]!;
    if (density <= 0) return base;
    // Log scale: stone-age bands and industrial cities differ by orders of magnitude.
    const t = Math.min(1, Math.max(0.15, (Math.log10(density) + 5) / 5));
    return mix(base, CIVILIZATION_COLOR, t);
  },
  hazard(state, i) {
    const risk = state.fields.hazard[i]!;
    const color = hazardPalette(risk);
    return state.fields.elevation[i]! < state.seaLevel ? mix(color, [18, 31, 52], 0.55) : color;
  },
  life(state, i) {
    return LIFE_TIER_COLORS[state.fields.lifeTier[i]!]!;
  },
  diversity(state, i) {
    const { diversity, elevation } = state.fields;
    const count = diversity[i]!;
    if (count <= 0) return elevation[i]! < state.seaLevel ? [22, 34, 52] : [52, 56, 62];
    return diversityPalette(count);
  },
  daisies(state, i) {
    const { daisyWhite, daisyBlack, elevation } = state.fields;
    if (elevation[i]! < state.seaLevel) return [20, 40, 80];
    const white = daisyWhite[i]!;
    const black = daisyBlack[i]!;
    const bare = Math.max(0, 1 - white - black);
    return [
      Math.round(BARE_GROUND[0] * bare + 245 * white + 22 * black),
      Math.round(BARE_GROUND[1] * bare + 245 * white + 22 * black),
      Math.round(BARE_GROUND[2] * bare + 235 * white + 28 * black),
    ];
  },
  clouds(state, i) {
    const { cloudCover, elevation } = state.fields;
    // Clouds as white over a dark planet, so the cloud bands stand out.
    const base: Rgb = elevation[i]! < state.seaLevel ? [16, 30, 52] : [46, 50, 44];
    return mix(base, [242, 244, 248], Math.min(1, Math.max(0, cloudCover[i]!)));
  },
  wind(state, i) {
    const { windU, windV, elevation } = state.fields;
    const color = windSpeedPalette(Math.hypot(windU[i]!, windV[i]!));
    // Land a little darker, so the coastlines stay visible.
    return elevation[i]! < state.seaLevel ? color : mix(color, [40, 40, 40], 0.35);
  },
  oceanCurrents(state, i) {
    const { oceanAnomaly, elevation } = state.fields;
    if (elevation[i]! >= state.seaLevel) return [58, 60, 64];
    return seaAnomalyPalette(oceanAnomaly[i]!);
  },
  oceanOxygen(state, i) {
    const { elevation, oceanOxygen } = state.fields;
    if (elevation[i]! >= state.seaLevel) return dimmedTerrain(state, i);
    return oceanOxygenPalette(oceanOxygen[i]! * 100);
  },
  nutrients(state, i) {
    const { elevation, nutrients } = state.fields;
    if (elevation[i]! >= state.seaLevel) return dimmedTerrain(state, i);
    return nutrientPalette(nutrients[i]!);
  },
  clathrates(state, i) {
    const suitability = clathrateSuitability(state, i);
    if (suitability === 0) return dimmedTerrain(state, i);
    // The model keeps one global reservoir. Show where that store is stable and
    // fade it as the global reservoir empties (2,500 microbar is its maximum).
    const reservoir = state.clathrateCarbon ?? 0;
    return clathratePalette(suitability * Math.min(1, Math.max(0, reservoir) / 2500) * 100);
  },
  precipitation(state, i) {
    const color = precipitationPalette(state.fields.precipitation[i]!);
    return state.fields.elevation[i]! < state.seaLevel ? mix(color, [10, 20, 40], 0.5) : color;
  },
};

/** Colours one layer at native grid resolution as RGBA pixels (1 pixel per cell). */
export function layerPixels(
  state: MapSource,
  layer: MapLayer,
  temperatureMonth: TemperatureMonth = 'annual',
): Uint8ClampedArray<ArrayBuffer> {
  const { cellCount } = state.grid;
  const pixels = new Uint8ClampedArray(cellCount * 4);
  if (layer === 'plates') return platePixels(state, pixels);
  const color = layerColors[layer];
  for (let i = 0; i < cellCount; i++) {
    const [r, g, b] = color(state, i, temperatureMonth);
    const p = i * 4;
    pixels[p] = r;
    pixels[p + 1] = g;
    pixels[p + 2] = b;
    pixels[p + 3] = 255;
  }
  return pixels;
}

/** Palette index per plate id from the last plate map, kept so colours stay stable. */
const plateColors: number[] = [];

/** Contrasting greedy graph colours plus a one-native-pixel boundary line. */
function platePixels(
  state: MapSource,
  pixels: Uint8ClampedArray<ArrayBuffer>,
): Uint8ClampedArray<ArrayBuffer> {
  const { width, height } = state.grid;
  const ids = state.fields.plateId;
  const maxId = ids.reduce((maximum, id) => Math.max(maximum, id), 0);
  const adjacency = Array.from({ length: maxId + 1 }, () => new Set<number>());
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const east = y * width + ((x + 1) % width);
      const south = y + 1 < height ? i + width : -1;
      for (const neighbor of [east, south]) {
        if (neighbor < 0 || ids[neighbor] === ids[i]) continue;
        adjacency[ids[i]!]!.add(ids[neighbor]!);
        adjacency[ids[neighbor]!]!.add(ids[i]!);
      }
    }
  }
  // Plates keep last frame's colour unless a neighbour already holds it, so a
  // changed boundary recolours only the plates involved, not the whole map.
  const assigned = new Int16Array(maxId + 1).fill(-1);
  const pickColor = (id: number, preferred: number): number => {
    const used = new Uint8Array(PLATE_PALETTE.length);
    for (const neighbor of adjacency[id]!) {
      const color = assigned[neighbor]!;
      if (color >= 0) used[color] = 1;
    }
    if (preferred >= 0 && !used[preferred]) return preferred;
    for (let k = 0; k < PLATE_PALETTE.length; k++) {
      const candidate = (id + k) % PLATE_PALETTE.length;
      if (!used[candidate]) return candidate;
    }
    return id % PLATE_PALETTE.length;
  };
  for (let id = 0; id <= maxId; id++) {
    const previous = plateColors[id] ?? -1;
    if (previous >= 0) assigned[id] = pickColor(id, previous);
  }
  for (let id = 0; id <= maxId; id++) {
    if (assigned[id]! < 0) assigned[id] = pickColor(id, -1);
    plateColors[id] = assigned[id]!;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const east = y * width + ((x + 1) % width);
      const south = y + 1 < height ? i + width : -1;
      const boundary = ids[east] !== ids[i] || (south >= 0 && ids[south] !== ids[i]);
      let color: Rgb = boundary ? [9, 13, 18] : PLATE_PALETTE[assigned[ids[i]!]!]!;
      if (!boundary && state.fields.elevation[i]! < state.seaLevel) {
        color = mix(color, [10, 20, 40], 0.45);
      }
      const p = i * 4;
      pixels[p] = color[0];
      pixels[p + 1] = color[1];
      pixels[p + 2] = color[2];
      pixels[p + 3] = 255;
    }
  }
  return pixels;
}

/** Qualitative palette chosen for separation in hue and lightness. */
export const PLATE_PALETTE: readonly Rgb[] = [
  [69, 117, 180],
  [230, 126, 34],
  [79, 157, 105],
  [196, 78, 82],
  [137, 101, 184],
  [196, 137, 68],
  [84, 166, 169],
  [214, 103, 164],
  [154, 150, 65],
  [120, 120, 125],
];

/**
 * Draws one layer at native grid resolution (1 pixel per cell) into the canvas.
 * The canvas is scaled up with CSS (`image-rendering: pixelated`).
 */
export function renderLayer(
  canvas: HTMLCanvasElement,
  state: MapSource,
  layer: MapLayer,
  temperatureMonth: TemperatureMonth = 'annual',
): void {
  const { width, height } = state.grid;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(new ImageData(layerPixels(state, layer, temperatureMonth), width, height), 0, 0);
}

/** Temperature displayed for annual, January or July maps (no ocean phase lag). */
export function displayedTemperature(state: MapSource, i: number, month: TemperatureMonth): number {
  const mean = state.fields.airTemperature[i]!;
  if (month === 'annual') return mean;
  const y = Math.floor(i / state.grid.width);
  const northern = y < state.grid.height / 2;
  const warmMonth = northern ? 'july' : 'january';
  return mean + (month === warmMonth ? 1 : -1) * state.fields.seasonalAmplitude[i]!;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function dimmedTerrain(state: MapSource, i: number): Rgb {
  return mix(elevationPalette(state.fields.elevation[i]! - state.seaLevel), [24, 27, 32], 0.72);
}

/** Mirrors the model's cold-land and shallow-shelf stability envelope. */
function clathrateSuitability(state: MapSource, i: number): number {
  const { elevation, airTemperature, iceCover } = state.fields;
  const height = elevation[i]!;
  const temperature = airTemperature[i]!;
  const ice = iceCover[i]!;
  if (height < state.seaLevel) {
    if (state.seaLevel - height > 500) return 0;
    return Math.max(ice, clamp01((5 - temperature) / 8));
  }
  return Math.max(ice, clamp01((2 - temperature) / 12));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
