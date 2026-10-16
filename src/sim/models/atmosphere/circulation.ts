import type { SimComponent } from '../../core/component';
import type { Grid } from '../../core/grid';
import { SEA_LEVEL } from '../geosphere/flowRouting';
import {
  averageToCoarse,
  getAtmosphereGrid,
  interpolateToFine,
  type AtmosphereGrid,
} from './atmosphereGrid';

/** Temperature drop with altitude, °C per metre (as in the climate model). */
const LAPSE_RATE = 0.0065;
/** Surface wind speeds of the circulation cells at their strongest, m/s (Earth-like). */
const TRADE_WIND = 6;
const HADLEY_INFLOW = 1.5;
const WESTERLY_WIND = 7;
const FERREL_OUTFLOW = 1;
const POLAR_EASTERLY = 3;
const POLAR_OUTFLOW = 0.5;
/** Surface friction slows wind over land relative to the sea. */
const LAND_WIND_FACTOR = 0.7;
/** Hadley cell half-width at an Earth-like equator-to-pole contrast, degrees. */
const HADLEY_WIDTH = 30;
/** Equator-to-pole temperature contrast (°C) of present-day Earth. */
const REFERENCE_CONTRAST = 45;
/** The ITCZ stays within this many degrees of the equator. */
const MAX_ITCZ_LATITUDE = 20;
/** Longitudes (degrees, either side) over which the thermal equator is smoothed. */
const ITCZ_SMOOTHING = 30;
/** Temperature scale (°C) of the weighting that finds the warmest latitudes. */
const ITCZ_TEMPERATURE_SCALE = 2;

/**
 * General circulation of the atmosphere, as a three-cell model.
 *
 * The rising branch of the Hadley cells (the ITCZ) sits on the thermal equator,
 * found column by column from the climate's sea-level temperatures, so it moves
 * towards the warmer hemisphere and bends over hot continents. The Hadley cells
 * widen as the equator-to-pole contrast grows (after Held & Hou 1980); Ferrel
 * cells reach to the polar front halfway to the pole, polar cells beyond.
 *
 * Surface winds follow the cells: trade winds blow west and towards the ITCZ,
 * westerlies east and poleward, polar easterlies west and equatorward. Where
 * they converge (ITCZ, polar front) air rises and rains; where they diverge
 * (subtropical highs, poles) it sinks and dries — the moisture model computes
 * that from the wind fields. Friction slows wind over land.
 */
export const circulationModel: SimComponent = {
  name: 'circulation',
  inputs: ['elevation', 'airTemperature'],
  outputs: ['windU', 'windV'],
  runOneStep(state) {
    const { grid, fields } = state;
    const atmosphere = getAtmosphereGrid(grid);
    const { coarse } = atmosphere;
    const n = coarse.cellCount;
    const { elevation, airTemperature } = fields;

    const seaLevelTemperature = new Float64Array(grid.cellCount);
    for (let i = 0; i < grid.cellCount; i++) {
      seaLevelTemperature[i] = airTemperature[i]! + Math.max(0, elevation[i]!) * LAPSE_RATE;
    }
    const temperature = averageToCoarse(atmosphere, grid, seaLevelTemperature, new Float64Array(n));
    const land = averageToCoarse(
      atmosphere,
      grid,
      Array.from(elevation, (e) => (e >= SEA_LEVEL ? 1 : 0)),
      new Float64Array(n),
    );

    const itcz = thermalEquator(coarse, temperature);
    const hadleyWidth =
      HADLEY_WIDTH * Math.sqrt(contrast(coarse, temperature) / REFERENCE_CONTRAST);
    const width = Math.max(20, Math.min(40, hadleyWidth));
    state.globals.circulation = { hadleyWidth: width, meanItcz: mean(itcz) };

    const u = new Float64Array(n);
    const v = new Float64Array(n);
    for (let y = 0; y < coarse.height; y++) {
      const latitude = coarse.rowLatitude[y]!;
      for (let x = 0; x < coarse.width; x++) {
        const c = y * coarse.width + x;
        const [eastward, northward] = cellWind(latitude, itcz[x]!, width);
        const friction = 1 - (1 - LAND_WIND_FACTOR) * land[c]!;
        u[c] = eastward * friction;
        v[c] = northward * friction;
      }
    }
    toFine(atmosphere, grid, u, fields.windU);
    toFine(atmosphere, grid, v, fields.windV);
  },
};

function toFine(atmosphere: AtmosphereGrid, grid: Grid, values: Float64Array, out: Float32Array) {
  if (atmosphere.coarse === grid) out.set(values);
  else interpolateToFine(atmosphere, grid, values, out);
}

/**
 * Surface wind (eastward, northward; m/s) at a latitude for an ITCZ at `itcz`
 * and Hadley cells `width` degrees wide.
 */
export function cellWind(latitude: number, itcz: number, width: number): [number, number] {
  const north = latitude >= itcz;
  // Distances from the ITCZ: to this point, to the pole, to the Hadley cell's edge
  // and to the polar front, which lies halfway between that edge and the pole.
  const s = Math.abs(latitude - itcz);
  const toPole = north ? 90 - itcz : 90 + itcz;
  const hadley = Math.min(width, 0.6 * toPole);
  const polarFront = (hadley + toPole) / 2;
  // +1 points poleward in this hemisphere.
  const poleward = north ? 1 : -1;
  if (s < hadley) {
    const t = Math.sin((Math.PI * s) / hadley);
    return [-TRADE_WIND * t, -poleward * HADLEY_INFLOW * t];
  }
  if (s < polarFront) {
    const t = Math.sin((Math.PI * (s - hadley)) / (polarFront - hadley));
    return [WESTERLY_WIND * t, poleward * FERREL_OUTFLOW * t];
  }
  const t = Math.sin((Math.PI * (s - polarFront)) / Math.max(1, toPole - polarFront));
  return [-POLAR_EASTERLY * t, -poleward * POLAR_OUTFLOW * t];
}

/**
 * Latitude of the warmest air in each column, smoothed in longitude: where the
 * trade winds meet. Weighted towards the warmest rows rather than the single
 * hottest one, so it moves smoothly.
 */
function thermalEquator(coarse: Grid, temperature: Float64Array): Float64Array {
  const { width, height, rowLatitude, rowAreaWeight } = coarse;
  const raw = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let warmest = -Infinity;
    for (let y = 0; y < height; y++) {
      if (Math.abs(rowLatitude[y]!) <= MAX_ITCZ_LATITUDE + 10) {
        warmest = Math.max(warmest, temperature[y * width + x]!);
      }
    }
    let sum = 0;
    let total = 0;
    for (let y = 0; y < height; y++) {
      const latitude = rowLatitude[y]!;
      if (Math.abs(latitude) > MAX_ITCZ_LATITUDE + 10) continue;
      const w =
        rowAreaWeight[y]! *
        Math.exp((temperature[y * width + x]! - warmest) / ITCZ_TEMPERATURE_SCALE);
      sum += latitude * w;
      total += w;
    }
    raw[x] = total > 0 ? sum / total : 0;
  }
  const half = Math.max(1, Math.round((ITCZ_SMOOTHING / 360) * width));
  const itcz = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -half; k <= half; k++) sum += raw[(x + k + width) % width]!;
    itcz[x] = Math.max(-MAX_ITCZ_LATITUDE, Math.min(MAX_ITCZ_LATITUDE, sum / (2 * half + 1)));
  }
  return itcz;
}

/** Mean temperature of the tropics minus that of the polar caps, °C. */
function contrast(coarse: Grid, temperature: Float64Array): number {
  let tropics = 0;
  let tropicsWeight = 0;
  let polar = 0;
  let polarWeight = 0;
  for (let y = 0; y < coarse.height; y++) {
    const latitude = Math.abs(coarse.rowLatitude[y]!);
    const w = coarse.rowAreaWeight[y]!;
    for (let x = 0; x < coarse.width; x++) {
      const t = temperature[y * coarse.width + x]!;
      if (latitude < 20) {
        tropics += t * w;
        tropicsWeight += w;
      } else if (latitude > 60) {
        polar += t * w;
        polarWeight += w;
      }
    }
  }
  return Math.max(1, tropics / tropicsWeight - polar / polarWeight);
}

/** Horizontal divergence on the sphere, (1 / (R cos φ)) (∂u/∂λ + ∂(v cos φ)/∂φ), 1/s. */
export function computeDivergence(coarse: Grid, u: Float64Array, v: Float64Array): Float64Array {
  const { width, height, rowLatitude, rowDx, dy } = coarse;
  const divergence = new Float64Array(coarse.cellCount);
  const cosine = (y: number) => Math.cos((rowLatitude[y]! * Math.PI) / 180);
  for (let y = 0; y < height; y++) {
    const yn = Math.max(0, y - 1);
    const ys = Math.min(height - 1, y + 1);
    const span = (ys - yn) * dy;
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      const east = y * width + ((x + 1) % width);
      const west = y * width + ((x - 1 + width) % width);
      const dudx = (u[east]! - u[west]!) / (2 * rowDx[y]!);
      // Row 0 is north, so northward is towards smaller y.
      const flux =
        (v[yn * width + x]! * cosine(yn) - v[ys * width + x]! * cosine(ys)) / (span * cosine(y));
      divergence[c] = dudx + flux;
    }
  }
  return divergence;
}

function mean(values: Float64Array): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
