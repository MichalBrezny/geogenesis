import type { SimComponent } from '../../core/component';
import { getTopology, type Grid } from '../../core/grid';
import { EARTH_SURFACE_GRAVITY } from '../../core/planet';
import {
  averageToCoarse,
  getAtmosphereGrid,
  interpolateToFine,
  sampleCoarse,
  type AtmosphereGrid,
} from './atmosphereGrid';
import { computeDivergence, thermalEquator } from './circulation';

const SECONDS_PER_YEAR = 365.25 * 86_400;
/** Precipitable water (mm) of saturated air at 15 °C, and its growth per °C (Clausius–Clapeyron). */
const SATURATION_WATER = 30;
const SATURATION_SENSITIVITY = 0.065;
/** Wettest the air gets over the open sea, as a share of saturation. */
const OCEAN_HUMIDITY = 0.7;
/** Time (s) for the sea to bring the air above it to that humidity. */
const EVAPORATION_TIME = 3 * 86_400;
/**
 * Share of rain that land returns to the air by evapotranspiration: some from
 * bare ground, much more from plants (moisture recycling keeps continents wet).
 */
const BARE_RECYCLING = 0.25;
const PLANT_RECYCLING = 0.4;
/** Inland water evaporates less efficiently than the open ocean at this coarse scale. */
const LAKE_EVAPORATION_SHARE = 0.55;
/** Mean time (s) water stays in calm air before it rains out (Earth: about 9 days). */
const RESIDENCE_TIME = 9 * 86_400;
/**
 * Converging air (s⁻¹) that doubles the rain rate; diverging air suppresses it in
 * the same proportion (subtropical highs, deserts).
 */
const CONVERGENCE_SCALE = 5e-7;
/** Rising motion (m/s) forced by wind blowing up slopes that doubles the rain rate. */
const UPSLOPE_SCALE = 0.01;
/** Bounds on how much lifting or sinking air changes the rain rate. */
const MIN_RAIN_FACTOR = 0.08;
const MAX_RAIN_FACTOR = 3;
/** Pseudo-time step (s) of the moisture transport iteration. */
const TIME_STEP = 12 * 3600;
/** Iterations of the transport; about 8 residence times, enough to settle. */
const ITERATIONS = 150;
/** How strongly fine-scale slopes facing the wind (m/s of lift) concentrate rain. */
const OROGRAPHIC_CONTRAST = 40;
/** Temperature drop with altitude, °C per metre. */
const LAPSE_RATE = 0.0065;
/** Share of shallow heat-low convergence that becomes rain-producing ascent. */
const SUBTROPICAL_CONVERGENCE_LIFT = 0.15;
/** Half-width of the Hadley cell's deep, rain-producing rising branch, degrees. */
const DEEP_ASCENT_WIDTH = 9;

/** Precipitable water (mm) of saturated air at a temperature (°C). */
export function saturationWater(temperature: number): number {
  return Math.min(250, SATURATION_WATER * Math.exp(SATURATION_SENSITIVITY * (temperature - 15)));
}

/**
 * Annual precipitation (mm/yr) from a moisture budget carried by the winds.
 *
 * On the coarse atmosphere grid, water vapour is evaporated from the sea (towards
 * a humidity that grows ~7%/°C with temperature) and re-evaporated from land
 * (more where plants grow), carried along the circulation's surface winds and
 * rained out at a rate that rises where air is lifted — converging winds (ITCZ,
 * polar front) and wind blowing up mountains — and falls where it sinks
 * (subtropical highs). Air that is lifted into colder levels holds less water:
 * whatever exceeds saturation rains out at once. So deserts form under the
 * subtropical highs and in the lee of mountains, and windward coasts are wet.
 *
 * The coarse result is interpolated to the fine grid and redistributed within
 * each coarse cell towards slopes facing the wind, keeping the coarse total.
 */
export const precipitationModel: SimComponent = {
  name: 'precipitation',
  inputs: ['elevation', 'airTemperature', 'iceCover', 'vegetation', 'windU', 'windV', 'lakeDepth'],
  outputs: ['precipitation'],
  runOneStep(state) {
    const { grid, fields } = state;
    let oceanCells = 0;
    for (const elevation of fields.elevation) {
      if (elevation < state.globals.seaLevel) oceanCells++;
    }
    // With no surface reservoir there is no source for the steady moisture
    // budget. This also prevents a dry planet retaining synthetic initial rain.
    if (oceanCells === 0) {
      fields.precipitation.fill(0);
      return;
    }
    const atmosphere = getAtmosphereGrid(grid);
    const coarseRain = moistureBudget(
      atmosphere,
      grid,
      fields,
      state.globals.seaLevel,
      state.globals.circulation,
      state.planetParams.surfaceGravity,
      state.planetParams.tidallyLocked,
      state.effectiveControls.rainfall,
    );
    const fine = fields.precipitation;
    if (atmosphere.coarse === grid) {
      for (let i = 0; i < fine.length; i++) fine[i] = coarseRain[i]!;
    } else {
      interpolateToFine(atmosphere, grid, coarseRain, fine);
    }
    concentrateOnWindwardSlopes(atmosphere, grid, fields, state.globals.seaLevel, fine);
  },
};

type Fields = Parameters<SimComponent['runOneStep']>[0]['fields'];

/** Steady-state precipitation (mm/yr) on the coarse grid. */
function moistureBudget(
  atmosphere: AtmosphereGrid,
  grid: Grid,
  fields: Fields,
  seaLevel: number,
  circulation: { hadleyWidth: number; meanItcz: number } | undefined,
  surfaceGravity: number,
  tidallyLocked: boolean,
  rainfall: number,
): Float64Array {
  const { coarse } = atmosphere;
  const n = coarse.cellCount;
  const { elevation, airTemperature, iceCover, vegetation, windU, windV, lakeDepth } = fields;
  const isLand = (i: number) => (elevation[i]! >= seaLevel ? 1 : 0);
  const isSea = (i: number) => 1 - isLand(i);

  const temperature = averageToCoarse(atmosphere, grid, airTemperature, new Float64Array(n));
  const seaLevelTemperature = new Float64Array(grid.cellCount);
  for (let i = 0; i < grid.cellCount; i++) {
    seaLevelTemperature[i] =
      airTemperature[i]! +
      Math.max(0, elevation[i]! - seaLevel) *
        LAPSE_RATE *
        (surfaceGravity / EARTH_SURFACE_GRAVITY);
  }
  const reducedTemperature = averageToCoarse(
    atmosphere,
    grid,
    seaLevelTemperature,
    new Float64Array(n),
  );
  const itcz = thermalEquator(coarse, reducedTemperature);
  const land = averageToCoarse(
    atmosphere,
    grid,
    Array.from(elevation, (e) => (e >= seaLevel ? 1 : 0)),
    new Float64Array(n),
  );
  const lakes = averageToCoarse(
    atmosphere,
    grid,
    Array.from(lakeDepth, (depth) => (depth > 0 ? 1 : 0)),
    new Float64Array(n),
  );
  const seaIce = averageToCoarse(atmosphere, grid, iceCover, new Float64Array(n), isSea);
  const plants = averageToCoarse(atmosphere, grid, vegetation, new Float64Array(n), isLand);
  const u = averageToCoarse(atmosphere, grid, windU, new Float64Array(n));
  const v = averageToCoarse(atmosphere, grid, windV, new Float64Array(n));
  const lift = averageToCoarse(
    atmosphere,
    grid,
    upslopeLift(grid, fields, seaLevel),
    new Float64Array(n),
  );
  // Convergence zones are a few hundred km wide, wider than one coarse row.
  const divergence = smoothNorthSouth(coarse, computeDivergence(coarse, u, v));

  // Rain rate (1/s) of each cell and the water its air can hold.
  const rate = new Float64Array(n);
  const capacity = new Float64Array(n);
  const evaporable = new Float64Array(n);
  const recycling = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    const y = Math.floor(c / coarse.width);
    const x = c % coarse.width;
    let convergence = -divergence[c]! / CONVERGENCE_SCALE;
    // Heat lows in the descending half of a Hadley cell are shallow: their air
    // returns aloft before reaching moist levels. Deep ascent remains effective
    // near the local ITCZ, and polar-front convergence is unaffected.
    const distanceFromItcz = Math.abs(coarse.rowLatitude[y]! - itcz[x]!);
    const inDescendingHadley =
      !tidallyLocked &&
      convergence > 0 &&
      distanceFromItcz > DEEP_ASCENT_WIDTH &&
      distanceFromItcz < (circulation?.hadleyWidth ?? 30);
    if (inDescendingHadley) convergence *= SUBTROPICAL_CONVERGENCE_LIFT;
    const lifting = convergence + Math.max(0, lift[c]!) / UPSLOPE_SCALE;
    const factor = lifting >= 0 ? 1 + lifting : 1 / (1 - lifting); // sinking air rains less, never negatively
    rate[c] = Math.min(MAX_RAIN_FACTOR, Math.max(MIN_RAIN_FACTOR, factor)) / RESIDENCE_TIME;
    capacity[c] = saturationWater(temperature[c]!);
    evaporable[c] = (1 - land[c]!) * (1 - seaIce[c]!) + LAKE_EVAPORATION_SHARE * lakes[c]!;
    recycling[c] =
      Math.max(0, land[c]! - lakes[c]!) * (BARE_RECYCLING + PLANT_RECYCLING * plants[c]!);
  }

  // Departure points of the semi-Lagrangian advection, in coarse cell units.
  const { width, height, rowDx, dy } = coarse;
  const departX = new Float64Array(n);
  const departY = new Float64Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      departX[c] = x - (u[c]! * TIME_STEP) / rowDx[y]!;
      // Northward wind comes from the south, i.e. from larger row numbers.
      departY[c] = y + (v[c]! * TIME_STEP) / dy;
    }
  }

  let water = new Float64Array(n);
  for (let c = 0; c < n; c++)
    water[c] = OCEAN_HUMIDITY * capacity[c]! * (0.3 + 0.7 * evaporable[c]!);
  const rain = new Float64Array(n);
  let next = new Float64Array(n);
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    for (let c = 0; c < n; c++) {
      let w = sampleCoarse(coarse, water, departX[c]!, departY[c]!);
      // Evaporation from the sea and re-evaporation of the last rain on land.
      w +=
        evaporable[c]! *
        Math.max(0, OCEAN_HUMIDITY * capacity[c]! - w) *
        (TIME_STEP / EVAPORATION_TIME) *
        rainfall;
      w += recycling[c]! * rain[c]! * TIME_STEP;
      // Rain: the cell's rate, plus anything beyond what the air can hold here.
      const excess = Math.max(0, w - capacity[c]!);
      const out = Math.min(w, (w - excess) * rate[c]! * TIME_STEP + excess);
      rain[c] = out / TIME_STEP;
      next[c] = w - out;
    }
    [water, next] = [next, water];
  }
  // mm/s to mm/yr.
  for (let c = 0; c < n; c++) rain[c] = rain[c]! * SECONDS_PER_YEAR;
  return rain;
}

/**
 * Vertical velocity (m/s) forced by the surface wind blowing up (positive) or
 * down (negative) the slope of each fine land cell; 0 at sea.
 */
function upslopeLift(grid: Grid, fields: Fields, seaLevel: number): Float32Array {
  const { elevation, windU, windV } = fields;
  const { neighbors } = getTopology(grid);
  const lift = new Float32Array(grid.cellCount);
  const height = (j: number) => Math.max(seaLevel, elevation[j]!);
  for (let y = 0; y < grid.height; y++) {
    const dx = grid.rowDx[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (elevation[i]! < seaLevel) continue;
      // Neighbours: 0 N, 2 E, 4 S, 6 W.
      const north = neighbors[i * 8]!;
      const east = neighbors[i * 8 + 2]!;
      const south = neighbors[i * 8 + 4]!;
      const west = neighbors[i * 8 + 6]!;
      const dhdx = (height(east) - height(west)) / (2 * dx);
      const dhdy = north >= 0 && south >= 0 ? (height(north) - height(south)) / (2 * grid.dy) : 0;
      lift[i] = windU[i]! * dhdx + windV[i]! * dhdy;
    }
  }
  return lift;
}

/**
 * Within each coarse cell, moves rain from lee slopes to windward ones (by the
 * fine-scale lift), keeping the coarse cell's total; also wets cold summits less
 * as their air holds less water.
 */
function concentrateOnWindwardSlopes(
  atmosphere: AtmosphereGrid,
  grid: Grid,
  fields: Fields,
  seaLevel: number,
  precipitation: Float32Array,
): void {
  const { coarseOf, coarse } = atmosphere;
  const lift = upslopeLift(grid, fields, seaLevel);
  const weight = new Float32Array(grid.cellCount);
  const sumWeighted = new Float64Array(coarse.cellCount);
  const sumPlain = new Float64Array(coarse.cellCount);
  for (let fy = 0; fy < grid.height; fy++) {
    const area = grid.rowCellArea[fy]!;
    for (let fx = 0; fx < grid.width; fx++) {
      const i = fy * grid.width + fx;
      const altitude = Math.max(0, fields.elevation[i]! - seaLevel);
      const thinAir = Math.exp(-SATURATION_SENSITIVITY * LAPSE_RATE * altitude * 0.5);
      const w = Math.exp(Math.max(-2, Math.min(2, OROGRAPHIC_CONTRAST * lift[i]!))) * thinAir;
      weight[i] = w;
      const c = coarseOf[i]!;
      sumWeighted[c] = sumWeighted[c]! + precipitation[i]! * w * area;
      sumPlain[c] = sumPlain[c]! + precipitation[i]! * area;
    }
  }
  for (let i = 0; i < grid.cellCount; i++) {
    const c = coarseOf[i]!;
    const norm = sumWeighted[c]! > 0 ? sumPlain[c]! / sumWeighted[c]! : 1;
    precipitation[i] = precipitation[i]! * weight[i]! * norm;
  }
}

/** One [1 2 1] pass across rows. */
function smoothNorthSouth(coarse: Grid, values: Float64Array): Float64Array {
  const { width, height } = coarse;
  const out = new Float64Array(values.length);
  for (let y = 0; y < height; y++) {
    const north = Math.max(0, y - 1) * width;
    const south = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x++) {
      out[y * width + x] =
        (values[north + x]! + 2 * values[y * width + x]! + values[south + x]!) / 4;
    }
  }
  return out;
}
