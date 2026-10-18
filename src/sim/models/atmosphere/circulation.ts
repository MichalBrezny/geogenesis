import type { SimComponent } from '../../core/component';
import type { Grid } from '../../core/grid';
import { EARTH_ROTATION_PERIOD_HOURS, EARTH_SURFACE_GRAVITY } from '../../core/planet';
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
/** Hadley width (degrees) where the Ferrel and polar cells start to vanish, and where they are gone. */
const SINGLE_CELL_START = 45;
const SINGLE_CELL_FULL = 60;
/** The ITCZ stays within this many degrees of the equator. */
const MAX_ITCZ_LATITUDE = 20;
/** Longitudes (degrees, either side) over which the thermal equator is smoothed. */
const ITCZ_SMOOTHING = 30;
/** Temperature scale (°C) of the weighting that finds the warmest latitudes. */
const ITCZ_TEMPERATURE_SCALE = 2;
/** Mean sea-level pressure around which the circulation's pressure systems vary, hPa. */
export const STANDARD_PRESSURE = 1013;
/** Thermal pressure response to a sea-level temperature anomaly, hPa/°C. */
const LAND_THERMAL_PRESSURE = -2.2;
const SEA_THERMAL_PRESSURE = -0.12;
/** Gaussian sigma: 1,880 km full width at half maximum, a continental-scale system. */
const THERMAL_SMOOTHING = 800_000;
/** Air density used to turn a sea-level pressure gradient into acceleration, kg/m³. */
const SURFACE_AIR_DENSITY = 1.225;
/** Earth's rotation rate, radians/s. */
const ROTATION_RATE = 7.2921e-5;
/** Linear boundary-layer drag rates over sea and land, s⁻¹. */
const SEA_DRAG = 1.5e-5;
const LAND_DRAG = 3e-5;
/** Thermal systems steer the broad circulation without overwhelming it. */
const MAX_THERMAL_WIND = 4.5;

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
 * (subtropical highs, poles) it sinks and dries. Continental temperature
 * anomalies add broad heat lows or cold highs; their pressure-gradient flow is
 * frictional-geostrophic, becoming directly down-gradient near the equator.
 */
export const circulationModel: SimComponent = {
  name: 'circulation',
  inputs: ['elevation', 'airTemperature'],
  outputs: ['windU', 'windV', 'pressure'],
  runOneStep(state) {
    const { grid, fields } = state;
    const atmosphere = getAtmosphereGrid(grid);
    const { coarse } = atmosphere;
    const n = coarse.cellCount;
    const { elevation, airTemperature } = fields;
    const seaLevel = state.globals.seaLevel;
    const gravityScale = state.planetParams.surfaceGravity / EARTH_SURFACE_GRAVITY;

    const seaLevelTemperature = new Float64Array(grid.cellCount);
    for (let i = 0; i < grid.cellCount; i++) {
      seaLevelTemperature[i] =
        airTemperature[i]! + Math.max(0, elevation[i]! - seaLevel) * LAPSE_RATE * gravityScale;
    }
    const temperature = averageToCoarse(atmosphere, grid, seaLevelTemperature, new Float64Array(n));
    const land = averageToCoarse(
      atmosphere,
      grid,
      Array.from(elevation, (e) => (e >= seaLevel ? 1 : 0)),
      new Float64Array(n),
    );

    const thermalPressure = thermalPressureAnomaly(coarse, temperature, land);
    if (state.planetParams.tidallyLocked) {
      lockedCirculation(
        coarse,
        thermalPressure,
        land,
        fields.windU,
        fields.windV,
        fields.pressure,
        atmosphere,
        grid,
      );
      state.globals.circulation = { hadleyWidth: 90, meanItcz: 0 };
      return;
    }

    const itcz = thermalEquator(coarse, temperature);
    const periodRatio =
      Math.abs(state.planetParams.rotationPeriodHours) / EARTH_ROTATION_PERIOD_HOURS;
    // Held–Hou: the Hadley edge scales as Ω^-1 (Kaspi & Showman 2015 find the same
    // trend in GCMs), so slow rotators scale linearly; fast ones keep the gentler sqrt.
    const rotationScale = Math.max(
      0.5,
      Math.min(30, periodRatio >= 1 ? periodRatio : Math.sqrt(periodRatio)),
    );
    const hadleyWidth =
      HADLEY_WIDTH * Math.sqrt(contrast(coarse, temperature) / REFERENCE_CONTRAST) * rotationScale;
    const width = Math.max(
      20 * Math.max(1, rotationScale),
      Math.min(Math.min(90, 40 * rotationScale), hadleyWidth),
    );
    const zonalSign = state.planetParams.rotationPeriodHours < 0 ? -1 : 1;
    state.globals.circulation = { hadleyWidth: width, meanItcz: mean(itcz) };

    const u = new Float64Array(n);
    const v = new Float64Array(n);
    const pressure = new Float64Array(n);
    for (let y = 0; y < coarse.height; y++) {
      const latitude = coarse.rowLatitude[y]!;
      for (let x = 0; x < coarse.width; x++) {
        const c = y * coarse.width + x;
        const [eastward, northward] = cellWind(latitude, itcz[x]!, width);
        const friction = 1 - (1 - LAND_WIND_FACTOR) * land[c]!;
        u[c] = zonalSign * eastward * friction;
        v[c] = northward * friction;
        pressure[c] =
          STANDARD_PRESSURE + zonalPressureAnomaly(latitude, itcz[x]!, width) + thermalPressure[c]!;
      }
    }
    addThermalWind(
      coarse,
      thermalPressure,
      land,
      u,
      v,
      EARTH_ROTATION_PERIOD_HOURS / state.planetParams.rotationPeriodHours,
    );
    toFine(atmosphere, grid, u, fields.windU);
    toFine(atmosphere, grid, v, fields.windV);
    toFine(atmosphere, grid, pressure, fields.pressure);
  },
};

/** Surface return flow from the nightside towards the fixed substellar rain belt. */
function lockedCirculation(
  coarse: Grid,
  thermalPressure: Float64Array,
  land: Float64Array,
  fineU: Float32Array,
  fineV: Float32Array,
  finePressure: Float32Array,
  atmosphere: AtmosphereGrid,
  fineGrid: Grid,
): void {
  const u = new Float64Array(coarse.cellCount);
  const v = new Float64Array(coarse.cellCount);
  const pressure = new Float64Array(coarse.cellCount);
  const speed = 6;
  for (let i = 0; i < coarse.cellCount; i++) {
    const x = coarse.cellPosition[i * 3]!;
    const y = coarse.cellPosition[i * 3 + 1]!;
    const z = coarse.cellPosition[i * 3 + 2]!;
    const longitude = Math.atan2(y, x);
    const latitude = Math.asin(z);
    const east = -Math.sin(longitude);
    const north = -Math.sin(latitude) * Math.cos(longitude);
    const length = Math.hypot(east, north);
    const friction = 1 - (1 - LAND_WIND_FACTOR) * land[i]!;
    u[i] = length > 1e-8 ? (speed * friction * east) / length : 0;
    v[i] = length > 1e-8 ? (speed * friction * north) / length : 0;
    pressure[i] = STANDARD_PRESSURE + thermalPressure[i]!;
  }
  addThermalWind(coarse, thermalPressure, land, u, v, 0);
  toFine(atmosphere, fineGrid, u, fineU);
  toFine(atmosphere, fineGrid, v, fineV);
  toFine(atmosphere, fineGrid, pressure, finePressure);
}

function toFine(atmosphere: AtmosphereGrid, grid: Grid, values: Float64Array, out: Float32Array) {
  if (atmosphere.coarse === grid) out.set(values);
  else interpolateToFine(atmosphere, grid, values, out);
}

/**
 * Surface wind (eastward, northward; m/s) at a latitude for an ITCZ at `itcz`
 * and Hadley cells `width` degrees wide. Beyond ~60 degrees the Hadley cell
 * reaches the pole and the Ferrel and polar cells disappear.
 */
export function cellWind(latitude: number, itcz: number, width: number): [number, number] {
  const single = singleCellWeight(width);
  const [u, v] = multiCellWind(latitude, itcz, width);
  if (single <= 0) return [u, v];
  const [us, vs] = singleCellWind(latitude, itcz);
  return [u + (us - u) * single, v + (vs - v) * single];
}

/** Weight of the single-cell regime: 0 below 45 degrees of Hadley width, 1 from 60. */
function singleCellWeight(width: number): number {
  return smoothMix(0, 1, (width - SINGLE_CELL_START) / (SINGLE_CELL_FULL - SINGLE_CELL_START));
}

function multiCellWind(latitude: number, itcz: number, width: number): [number, number] {
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

/** One Hadley cell per hemisphere, from the ITCZ to the pole: easterlies and equatorward flow. */
function singleCellWind(latitude: number, itcz: number): [number, number] {
  const north = latitude >= itcz;
  const s = Math.abs(latitude - itcz);
  const toPole = Math.max(1, north ? 90 - itcz : 90 + itcz);
  const poleward = north ? 1 : -1;
  const t = Math.sin((Math.PI * s) / toPole);
  return [-TRADE_WIND * t, -poleward * HADLEY_INFLOW * t];
}

/**
 * Zonal sea-level pressure relative to 1013 hPa. Smooth interpolation places
 * the ITCZ trough at −4 hPa, subtropical highs at +6, subpolar lows at −10,
 * and polar highs at +4, following the same cell boundaries as `cellWind`.
 * In the single-cell regime pressure rises from the ITCZ trough to a polar high.
 */
export function zonalPressureAnomaly(latitude: number, itcz: number, width: number): number {
  const north = latitude >= itcz;
  const distance = Math.abs(latitude - itcz);
  const toPole = north ? 90 - itcz : 90 + itcz;
  const hadley = Math.min(width, 0.6 * toPole);
  const polarFront = (hadley + toPole) / 2;
  let multi: number;
  if (distance < hadley) multi = smoothMix(-4, 6, distance / hadley);
  else if (distance < polarFront) {
    multi = smoothMix(6, -10, (distance - hadley) / (polarFront - hadley));
  } else multi = smoothMix(-10, 4, (distance - polarFront) / Math.max(1, toPole - polarFront));
  const single = singleCellWeight(width);
  if (single <= 0) return multi;
  const one = smoothMix(-4, 4, distance / Math.max(1, toPole));
  return multi + (one - multi) * single;
}

/** Broad pressure anomaly made by continents departing from their latitude's mean temperature. */
function thermalPressureAnomaly(
  coarse: Grid,
  temperature: Float64Array,
  land: Float64Array,
): Float64Array {
  const { width, height } = coarse;
  const source = new Float64Array(coarse.cellCount);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let zonalMean = 0;
    for (let x = 0; x < width; x++) zonalMean += temperature[row + x]!;
    zonalMean /= width;
    for (let x = 0; x < width; x++) {
      const c = row + x;
      const response =
        SEA_THERMAL_PRESSURE + (LAND_THERMAL_PRESSURE - SEA_THERMAL_PRESSURE) * land[c]!;
      source[c] = (temperature[c]! - zonalMean) * response;
    }
  }
  return gaussianSmooth(coarse, source, THERMAL_SMOOTHING);
}

/** Separable physical-distance Gaussian blur; longitude wraps and latitude stops at the poles. */
function gaussianSmooth(grid: Grid, values: Float64Array, sigma: number): Float64Array {
  const { width, height, rowDx, dy } = grid;
  const horizontal = new Float64Array(values.length);
  for (let y = 0; y < height; y++) {
    const radius = Math.min(Math.floor((width - 1) / 2), Math.ceil((3 * sigma) / rowDx[y]!));
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let weight = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const distance = offset * rowDx[y]!;
        const w = Math.exp(-(distance * distance) / (2 * sigma * sigma));
        sum += values[row + ((x + offset + width) % width)]! * w;
        weight += w;
      }
      horizontal[row + x] = sum / weight;
    }
  }
  const out = new Float64Array(values.length);
  const radius = Math.ceil((3 * sigma) / dy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let weight = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const row = y + offset;
        if (row < 0 || row >= height) continue;
        const distance = offset * dy;
        const w = Math.exp(-(distance * distance) / (2 * sigma * sigma));
        sum += horizontal[row * width + x]! * w;
        weight += w;
      }
      out[y * width + x] = sum / weight;
    }
  }
  return out;
}

/** Adds the boundary-layer solution of f k×v + r v = −∇p/ρ for the thermal pressure. */
function addThermalWind(
  grid: Grid,
  pressure: Float64Array,
  land: Float64Array,
  u: Float64Array,
  v: Float64Array,
  rotationFactor = 1,
): void {
  const { width, height, rowDx, dy, rowLatitude } = grid;
  for (let y = 0; y < height; y++) {
    const north = Math.max(0, y - 1);
    const south = Math.min(height - 1, y + 1);
    const meridionalSpan = (south - north) * dy;
    const latitude = (rowLatitude[y]! * Math.PI) / 180;
    const coriolis = 2 * ROTATION_RATE * rotationFactor * Math.sin(latitude);
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      const east = y * width + ((x + 1) % width);
      const west = y * width + ((x - 1 + width) % width);
      // hPa to Pa; row 0 is north, hence north minus south for dp/dy.
      const dpdx = ((pressure[east]! - pressure[west]!) * 100) / (2 * rowDx[y]!);
      const dpdy =
        meridionalSpan > 0
          ? ((pressure[north * width + x]! - pressure[south * width + x]!) * 100) / meridionalSpan
          : 0;
      const drag = SEA_DRAG + (LAND_DRAG - SEA_DRAG) * land[c]!;
      const denominator = SURFACE_AIR_DENSITY * (drag * drag + coriolis * coriolis);
      let thermalU = (-drag * dpdx + coriolis * dpdy) / denominator;
      let thermalV = (-drag * dpdy - coriolis * dpdx) / denominator;
      const speed = Math.hypot(thermalU, thermalV);
      if (speed > MAX_THERMAL_WIND) {
        const scale = MAX_THERMAL_WIND / speed;
        thermalU *= scale;
        thermalV *= scale;
      }
      u[c] = u[c]! + thermalU;
      v[c] = v[c]! + thermalV;
    }
  }
}

function smoothMix(from: number, to: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const smooth = clamped * clamped * (3 - 2 * clamped);
  return from + (to - from) * smooth;
}

/**
 * Latitude of the warmest air in each column, smoothed in longitude: where the
 * trade winds meet. Weighted towards the warmest rows rather than the single
 * hottest one, so it moves smoothly.
 */
export function thermalEquator(coarse: Grid, temperature: Float64Array): Float64Array {
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
