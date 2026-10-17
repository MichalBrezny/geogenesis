import type { SimComponent } from '../../core/component';
import {
  areaWeightedMean,
  createGrid,
  getTopology,
  NEIGHBOR_COUNT,
  type Grid,
} from '../../core/grid';
import type { Atmosphere } from '../../core/planet';
import { isOcean } from '../geosphere/seaLevel';
import { LOW_CLOUD_ALBEDO, REFERENCE_LOW_CLOUD } from './clouds';
import { surfaceIceCover } from './ice';
import { SOLAR_CONSTANT } from './star';

export { iceFractionAt } from './ice';

/**
 * Outgoing longwave radiation OLR = A + B·T (T in °C), from satellite fits
 * (North et al. 1981). B includes the water-vapour feedback.
 */
const OLR_A = 203.3;
const OLR_B = 2.09;
/** Meridional heat transport coefficient for the Laplacian on the unit sphere, W m⁻² K⁻¹. */
const DEFAULT_DIFFUSIVITY = 0.45;
/** Planetary albedo (surface plus typical cloud cover) of snow and ice. */
export const ICE_ALBEDO = 0.62;
/** Temperature drop with altitude, °C per metre (standard atmosphere). */
const LAPSE_RATE = 0.0065;
/** Pre-industrial greenhouse gas levels the forcing is measured against (ppm). */
const REFERENCE_CO2 = 280;
const REFERENCE_CH4 = 0.7;
/**
 * E-folding time (years) of the surface climate's response to a change in
 * forcing, set by the heat capacity of the ocean's mixed layer and upper ocean.
 * Only short (civilization-era) steps feel it.
 */
const OCEAN_RESPONSE_TIME = 40;
/** Width of the coarse climate grid; heat transport is smooth, so this is plenty. */
const CLIMATE_GRID_WIDTH = 64;
/** Solar longitudes used for the annual mean and first harmonic. */
const ORBIT_SAMPLES = 96;
/** Effective damping by longwave radiation and seasonal atmospheric heat transport. */
const SEASONAL_DAMPING = 4.5;
const SECONDS_PER_YEAR = 365.25 * 86_400;
/** Heat capacities expressed as W·yr·m⁻²·K⁻¹ for use with omega in yr⁻¹. */
const LAND_HEAT_CAPACITY = 0.5;
const WATER_VOLUMETRIC_HEAT_CAPACITY = 4.1e6;
const OCEAN_MIXED_LAYER_DEPTH = 50;
const OCEAN_HEAT_CAPACITY =
  (WATER_VOLUMETRIC_HEAT_CAPACITY * OCEAN_MIXED_LAYER_DEPTH) / SECONDS_PER_YEAR;
const SEA_ICE_HEAT_CAPACITY_FACTOR = 0.2;
const LAND_ICE_HEAT_CAPACITY_FACTOR = 0.25;
/** Distance from the sea (m) over which maritime air loses its hold on the seasons. */
const MARITIME_LENGTH = 1_000_000;

export interface ClimateOptions {
  /** Heat transport coefficient; larger values even out the pole-equator contrast. */
  diffusivity?: number;
  /**
   * Albedo of snow and ice. Setting it to the surface albedo switches off the
   * ice–albedo feedback (Daisyworld has none).
   */
  iceAlbedo?: number;
}

/**
 * Radiative forcing (W/m²) of CO₂ and CH₄ relative to pre-industrial levels.
 * The logarithmic CO₂ term (Myhre et al. 1998) underestimates forcing at the very
 * high CO₂ of early or snowball planets, so a quadratic term is added above the
 * reference level (rough fit to radiative-convective models).
 */
export function greenhouseForcing(atmosphere: Atmosphere): number {
  const logRatio = Math.log(Math.max(atmosphere.co2, 1e-3) / REFERENCE_CO2);
  const co2 = 5.35 * logRatio + 0.4 * Math.max(0, logRatio) ** 2;
  // The methane formula uses ppb.
  const ch4 = 0.036 * (Math.sqrt(atmosphere.ch4 * 1000) - Math.sqrt(REFERENCE_CH4 * 1000));
  return co2 + ch4;
}

interface InsolationHarmonics {
  annualMean: number;
  /** Signed sine harmonic: positive for northern summer, negative for southern summer. */
  firstAnnual: number;
}

const insolationCache = new Map<string, InsolationHarmonics>();

/**
 * Annual-mean daily insolation (W/m²) for a circular orbit. Daily means include
 * polar day/night and are integrated over equally spaced solar longitudes.
 */
export function annualInsolation(
  latitudeDeg: number,
  solarInput: number,
  obliquityDeg = 23.44,
): number {
  return insolationHarmonics(latitudeDeg, obliquityDeg).annualMean * solarInput;
}

/** Signed amplitude of the first annual insolation harmonic (W/m²). */
export function firstAnnualInsolationHarmonic(
  latitudeDeg: number,
  solarInput: number,
  obliquityDeg = 23.44,
): number {
  return insolationHarmonics(latitudeDeg, obliquityDeg).firstAnnual * solarInput;
}

function insolationHarmonics(latitudeDeg: number, obliquityDeg: number): InsolationHarmonics {
  const latitude = Math.max(-90, Math.min(90, latitudeDeg));
  const obliquity = Math.max(0, Math.min(90, obliquityDeg));
  const key = `${latitude.toFixed(8)}:${obliquity.toFixed(6)}`;
  const cached = insolationCache.get(key);
  if (cached) return cached;

  const phi = (latitude * Math.PI) / 180;
  const epsilon = (obliquity * Math.PI) / 180;
  let annualMean = 0;
  let sine = 0;
  for (let sample = 0; sample < ORBIT_SAMPLES; sample++) {
    const longitude = (2 * Math.PI * (sample + 0.5)) / ORBIT_SAMPLES;
    const declination = Math.asin(Math.sin(epsilon) * Math.sin(longitude));
    const sunsetCosine = -Math.tan(phi) * Math.tan(declination);
    const sunsetHourAngle =
      sunsetCosine >= 1 ? 0 : sunsetCosine <= -1 ? Math.PI : Math.acos(sunsetCosine);
    const dailyMean =
      (SOLAR_CONSTANT / Math.PI) *
      (sunsetHourAngle * Math.sin(phi) * Math.sin(declination) +
        Math.cos(phi) * Math.cos(declination) * Math.sin(sunsetHourAngle));
    annualMean += dailyMean;
    sine += dailyMean * Math.sin(longitude);
  }
  const result = {
    annualMean: annualMean / ORBIT_SAMPLES,
    firstAnnual: (2 * sine) / ORBIT_SAMPLES,
  };
  insolationCache.set(key, result);
  return result;
}

/**
 * Energy-balance climate model (Budyko–Sellers / North type) in 2D.
 *
 * On a coarse lat/long grid it solves the steady state of
 *   Q(φ)(1 − α) = A + B·T − F_greenhouse − D∇²T
 * with conjugate gradients, where α is the area-mean albedo of the fine cells.
 * The result is interpolated to the fine grid, cooled with altitude, and turned
 * into snow/ice cover, whose high albedo feeds back into the next iteration —
 * the ice–albedo feedback that can tip a planet into a snowball.
 *
 * Steady state suits geological steps, which are far longer than the climate's
 * response time; in short steps the ocean's heat capacity makes temperatures
 * approach it over OCEAN_RESPONSE_TIME, so warming lags behind emissions.
 */
export function createClimate(options: ClimateOptions = {}): SimComponent {
  const diffusivity = options.diffusivity ?? DEFAULT_DIFFUSIVITY;
  const iceAlbedo = options.iceAlbedo ?? ICE_ALBEDO;
  return {
    name: 'climate',
    inputs: [
      'elevation',
      'surfaceAlbedo',
      'oceanAnomaly',
      'precipitation',
      'iceThickness',
      'lowCloud',
    ],
    outputs: ['airTemperature', 'seasonalAmplitude', 'iceCover', 'albedo'],
    runOneStep(state, dtYears) {
      const { grid, fields, globals } = state;
      const {
        elevation,
        surfaceAlbedo,
        airTemperature,
        seasonalAmplitude,
        precipitation,
        iceThickness,
        iceCover,
        albedo,
      } = fields;
      // Last step's temperatures, for the ocean's lag. The first run of a planet has
      // dt = 0 and goes straight to equilibrium.
      const lag = dtYears > 0 ? Math.exp(-dtYears / OCEAN_RESPONSE_TIME) : 0;
      const previous = lag > 1e-6 ? Float32Array.from(airTemperature) : null;
      const hasClouds = globals.cloudCover !== undefined;
      const climate = getClimateGrid(grid, diffusivity);
      const hasSeasons = state.controls.obliquity > 1e-6;
      const continentality = hasSeasons
        ? continentalityField(grid, elevation, globals.seaLevel)
        : null;
      const seasonalForcing = new Float64Array(grid.height);
      for (let y = 0; y < grid.height; y++) {
        seasonalForcing[y] = Math.abs(
          firstAnnualInsolationHarmonic(
            grid.rowLatitude[y]!,
            globals.solarInput,
            state.controls.obliquity,
          ),
        );
      }
      const forcing = greenhouseForcing(globals.atmosphere) - globals.volcanicAerosol;

      // Start from last step's albedo where it exists, so the ice state persists (hysteresis).
      for (let i = 0; i < grid.cellCount; i++) {
        const base = surfaceAlbedo[i]!;
        if (albedo[i] === 0) albedo[i] = base * (1 - iceCover[i]!) + iceAlbedo * iceCover[i]!;
      }

      for (let iteration = 0; iteration < 12; iteration++) {
        solveCoarse(climate, grid, albedo, globals.solarInput, state.controls.obliquity, forcing);
        interpolateToFine(
          climate,
          grid,
          elevation,
          fields.oceanAnomaly,
          globals.seaLevel,
          airTemperature,
        );
        let maxChange = 0;
        for (let i = 0; i < grid.cellCount; i++) {
          seasonalAmplitude[i] = seasonalAmplitudeFromHarmonic(
            seasonalForcing[Math.floor(i / grid.width)]!,
            albedo[i]!,
            isOcean(elevation[i]!, globals.seaLevel),
            continentality?.[i] ?? 0,
            iceCover[i]!,
          );
          const ice = surfaceIceCover(
            isOcean(elevation[i]!, globals.seaLevel),
            airTemperature[i]!,
            precipitation[i]!,
            iceThickness[i]!,
            seasonalAmplitude[i]!,
          );
          // Low cloud above the reference brightens the ice-free part (the last step's
          // clouds); planets without a cloud model keep the typical clouds of the albedos.
          const cloud = hasClouds
            ? LOW_CLOUD_ALBEDO * (fields.lowCloud[i]! - REFERENCE_LOW_CLOUD) * (1 - ice)
            : 0;
          const target = Math.min(
            0.9,
            Math.max(0.03, surfaceAlbedo[i]! * (1 - ice) + iceAlbedo * ice + cloud),
          );
          // Damped update: the albedo–temperature iteration can oscillate at ice edges.
          const next = iteration === 0 ? target : 0.5 * (albedo[i]! + target);
          maxChange = Math.max(maxChange, Math.abs(next - albedo[i]!));
          albedo[i] = next;
          iceCover[i] = ice;
        }
        if (maxChange < 1e-3) break;
      }
      if (previous) {
        for (let i = 0; i < grid.cellCount; i++) {
          airTemperature[i] = airTemperature[i]! + (previous[i]! - airTemperature[i]!) * lag;
          iceCover[i] = surfaceIceCover(
            isOcean(elevation[i]!, globals.seaLevel),
            airTemperature[i]!,
            precipitation[i]!,
            iceThickness[i]!,
            seasonalAmplitude[i]!,
          );
        }
      }

      globals.meanTemperature = areaWeightedMean(grid, airTemperature);
      globals.iceFraction = areaWeightedMean(grid, iceCover);
    },
  };
}

interface ClimateGrid {
  coarse: Grid;
  /** Fine cells per coarse cell along each axis. */
  factor: number;
  /** neighbors[i * 4 + d] (N, E, S, W) on the coarse grid, -1 past a pole. */
  neighbors: Int32Array;
  /** D × conductance of each face on the unit sphere, same layout as neighbors. */
  conductance: Float64Array;
  /** Unit-sphere area of each coarse row. */
  rowArea: Float64Array;
  /** Coarse temperatures (°C), kept between steps as the solver's starting guess. */
  temperature: Float64Array;
  coarseAlbedo: Float64Array;
  rhs: Float64Array;
}

const climateCache = new WeakMap<Grid, ClimateGrid>();

function getClimateGrid(grid: Grid, diffusivity: number): ClimateGrid {
  let climate = climateCache.get(grid);
  if (!climate) {
    climate = buildClimateGrid(grid, diffusivity);
    climateCache.set(grid, climate);
  }
  return climate;
}

function buildClimateGrid(grid: Grid, diffusivity: number): ClimateGrid {
  const coarsens =
    grid.width % CLIMATE_GRID_WIDTH === 0 && grid.height % (CLIMATE_GRID_WIDTH / 2) === 0;
  const width = coarsens ? CLIMATE_GRID_WIDTH : grid.width;
  const height = coarsens ? CLIMATE_GRID_WIDTH / 2 : grid.height;
  const coarse = createGrid(width, height, 1);
  const n = coarse.cellCount;
  const dLon = (2 * Math.PI) / width;
  const dLat = Math.PI / height;
  const neighbors = new Int32Array(n * 4);
  const conductance = new Float64Array(n * 4);
  const rowArea = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    rowArea[y] = coarse.rowCellArea[y]!;
    const lat = (coarse.rowLatitude[y]! * Math.PI) / 180;
    const northEdge = Math.PI / 2 - y * dLat;
    const southEdge = Math.PI / 2 - (y + 1) * dLat;
    // Face length / centre distance on the unit sphere.
    const ew = dLat / (Math.cos(lat) * dLon);
    const north = (Math.cos(northEdge) * dLon) / dLat;
    const south = (Math.cos(southEdge) * dLon) / dLat;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      neighbors[i * 4] = y > 0 ? i - width : -1;
      neighbors[i * 4 + 1] = y * width + ((x + 1) % width);
      neighbors[i * 4 + 2] = y < height - 1 ? i + width : -1;
      neighbors[i * 4 + 3] = y * width + ((x - 1 + width) % width);
      conductance[i * 4] = diffusivity * north;
      conductance[i * 4 + 1] = diffusivity * ew;
      conductance[i * 4 + 2] = diffusivity * south;
      conductance[i * 4 + 3] = diffusivity * ew;
    }
  }
  return {
    coarse,
    factor: grid.width / width,
    neighbors,
    conductance,
    rowArea,
    temperature: new Float64Array(n).fill(14),
    coarseAlbedo: new Float64Array(n),
    rhs: new Float64Array(n),
  };
}

/**
 * Linear response of a surface layer to the first annual insolation harmonic.
 * Ocean heat capacity represents a 50 m mixed layer; land receives an oceanic
 * contribution near coasts, and snow/sea ice decouple the active layer below.
 */
export function seasonalTemperatureAmplitude(
  latitude: number,
  solarInput: number,
  obliquity: number,
  albedo: number,
  ocean: boolean,
  continentality: number,
  iceCover: number,
): number {
  return seasonalAmplitudeFromHarmonic(
    Math.abs(firstAnnualInsolationHarmonic(latitude, solarInput, obliquity)),
    albedo,
    ocean,
    continentality,
    iceCover,
  );
}

function seasonalAmplitudeFromHarmonic(
  firstHarmonic: number,
  albedo: number,
  ocean: boolean,
  continentality: number,
  iceCover: number,
): number {
  const forcing = firstHarmonic * (1 - Math.max(0, Math.min(1, albedo)));
  const ice = Math.max(0, Math.min(1, iceCover));
  if (ocean) {
    return responseAmplitude(
      forcing,
      OCEAN_HEAT_CAPACITY * (1 - (1 - SEA_ICE_HEAT_CAPACITY_FACTOR) * ice),
    );
  }
  // Maritime air carries the ocean's small cycle inland: mix the two responses, not the heat
  // capacities (a capacity mix lets a little nearby sea swamp a continent's cycle).
  const land = responseAmplitude(
    forcing,
    LAND_HEAT_CAPACITY * (1 - (1 - LAND_ICE_HEAT_CAPACITY_FACTOR) * ice),
  );
  const sea = responseAmplitude(forcing, OCEAN_HEAT_CAPACITY);
  const c = Math.max(0, Math.min(1, continentality));
  return sea + (land - sea) * c;
}

function responseAmplitude(forcing: number, capacity: number): number {
  return forcing / Math.hypot(SEASONAL_DAMPING, capacity * 2 * Math.PI);
}

/**
 * Continentality 0..1 from the distance to the nearest sea, 1 − exp(−d / MARITIME_LENGTH):
 * coasts take the ocean's mild seasons, interiors far from any sea the land's full cycle.
 * Distances run through the 8-neighbour graph in metres (Dijkstra), so the scale does not
 * depend on the grid.
 */
function continentalityField(grid: Grid, elevation: Float32Array, seaLevel: number): Float32Array {
  const { neighbors, rowDistance } = getTopology(grid);
  const n = grid.cellCount;
  const distance = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap();
  for (let i = 0; i < n; i++) {
    if (isOcean(elevation[i]!, seaLevel)) {
      distance[i] = 0;
      heap.push(i, 0);
    }
  }
  while (heap.size > 0) {
    const [i, d] = heap.pop();
    if (d > distance[i]!) continue;
    const row = Math.floor(i / grid.width);
    for (let k = 0; k < NEIGHBOR_COUNT; k++) {
      const j = neighbors[i * NEIGHBOR_COUNT + k]!;
      if (j < 0) continue;
      const next = d + rowDistance[row * NEIGHBOR_COUNT + k]!;
      if (next < distance[j]!) {
        distance[j] = next;
        heap.push(j, next);
      }
    }
  }
  const out = new Float32Array(n);
  // A planet with no sea at all is fully continental.
  for (let i = 0; i < n; i++) {
    out[i] = Number.isFinite(distance[i]!) ? 1 - Math.exp(-distance[i]! / MARITIME_LENGTH) : 1;
  }
  return out;
}

/** Binary min-heap of (cell, key) pairs for the coast-distance search. */
class MinHeap {
  private cells: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  push(cell: number, key: number): void {
    const { cells, keys } = this;
    let i = cells.length;
    cells.push(cell);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent]! <= key) break;
      cells[i] = cells[parent]!;
      keys[i] = keys[parent]!;
      i = parent;
    }
    cells[i] = cell;
    keys[i] = key;
  }

  pop(): [number, number] {
    const { cells, keys } = this;
    const top: [number, number] = [cells[0]!, keys[0]!];
    const lastCell = cells.pop()!;
    const lastKey = keys.pop()!;
    const n = cells.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= n) break;
        const right = left + 1;
        const child = right < n && keys[right]! < keys[left]! ? right : left;
        if (keys[child]! >= lastKey) break;
        cells[i] = cells[child]!;
        keys[i] = keys[child]!;
        i = child;
      }
      cells[i] = lastCell;
      keys[i] = lastKey;
    }
    return top;
  }
}

function solveCoarse(
  climate: ClimateGrid,
  grid: Grid,
  albedo: Float32Array,
  solarInput: number,
  obliquity: number,
  forcing: number,
): void {
  const { coarse, factor, coarseAlbedo, rhs, rowArea } = climate;

  // Area-weighted mean albedo of the fine cells in each coarse cell.
  coarseAlbedo.fill(0);
  const weight = new Float64Array(coarse.cellCount);
  for (let fy = 0; fy < grid.height; fy++) {
    const cy = Math.floor(fy / factor);
    const area = grid.rowCellArea[fy]!;
    for (let fx = 0; fx < grid.width; fx++) {
      const c = cy * coarse.width + Math.floor(fx / factor);
      coarseAlbedo[c] = coarseAlbedo[c]! + albedo[fy * grid.width + fx]! * area;
      weight[c] = weight[c]! + area;
    }
  }
  for (let y = 0; y < coarse.height; y++) {
    const insolation = annualInsolation(coarse.rowLatitude[y]!, solarInput, obliquity);
    for (let x = 0; x < coarse.width; x++) {
      const c = y * coarse.width + x;
      coarseAlbedo[c] = coarseAlbedo[c]! / weight[c]!;
      rhs[c] = rowArea[y]! * (insolation * (1 - coarseAlbedo[c]!) - (OLR_A - forcing));
    }
  }
  conjugateGradient(climate);
}

/** (A·B + D·L) x, the energy balance operator; symmetric positive definite. */
function applyOperator(climate: ClimateGrid, x: Float64Array, out: Float64Array): void {
  const { neighbors, conductance, rowArea, coarse } = climate;
  for (let i = 0; i < x.length; i++) {
    let value = rowArea[Math.floor(i / coarse.width)]! * OLR_B * x[i]!;
    for (let d = 0; d < 4; d++) {
      const n = neighbors[i * 4 + d]!;
      if (n >= 0) value += conductance[i * 4 + d]! * (x[i]! - x[n]!);
    }
    out[i] = value;
  }
}

/** Jacobi-preconditioned conjugate gradients, warm-started from the previous solution. */
function conjugateGradient(climate: ClimateGrid): void {
  const { temperature: x, rhs: b, neighbors, conductance, rowArea, coarse } = climate;
  const n = x.length;
  const diagonal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let value = rowArea[Math.floor(i / coarse.width)]! * OLR_B;
    for (let d = 0; d < 4; d++) if (neighbors[i * 4 + d]! >= 0) value += conductance[i * 4 + d]!;
    diagonal[i] = value;
  }
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const ap = new Float64Array(n);
  applyOperator(climate, x, ap);
  let bNorm = 0;
  let rz = 0;
  for (let i = 0; i < n; i++) {
    r[i] = b[i]! - ap[i]!;
    z[i] = r[i]! / diagonal[i]!;
    p[i] = z[i]!;
    rz += r[i]! * z[i]!;
    bNorm += b[i]! * b[i]!;
  }
  const tolerance = 1e-10 * Math.max(bNorm, 1e-30);
  for (let iteration = 0; iteration < 500; iteration++) {
    let rNorm = 0;
    for (let i = 0; i < n; i++) rNorm += r[i]! * r[i]!;
    if (rNorm <= tolerance) break;
    applyOperator(climate, p, ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i]! * ap[i]!;
    const alpha = rz / pAp;
    let rzNext = 0;
    for (let i = 0; i < n; i++) {
      x[i] = x[i]! + alpha * p[i]!;
      r[i] = r[i]! - alpha * ap[i]!;
      z[i] = r[i]! / diagonal[i]!;
      rzNext += r[i]! * z[i]!;
    }
    const beta = rzNext / rz;
    rz = rzNext;
    for (let i = 0; i < n; i++) p[i] = z[i]! + beta * p[i]!;
  }
}

/**
 * Bilinear interpolation of coarse sea-level temperatures, then cooling with
 * altitude and the warm or cold ocean currents' anomaly.
 */
function interpolateToFine(
  climate: ClimateGrid,
  grid: Grid,
  elevation: Float32Array,
  oceanAnomaly: Float32Array,
  seaLevel: number,
  out: Float32Array,
): void {
  const { coarse, factor, temperature } = climate;
  const cw = coarse.width;
  for (let fy = 0; fy < grid.height; fy++) {
    const cy = (fy + 0.5) / factor - 0.5;
    const y0 = Math.max(0, Math.min(coarse.height - 1, Math.floor(cy)));
    const y1 = Math.min(coarse.height - 1, y0 + 1);
    const ty = Math.max(0, Math.min(1, cy - y0));
    for (let fx = 0; fx < grid.width; fx++) {
      const cx = (fx + 0.5) / factor - 0.5;
      const xf = Math.floor(cx);
      const tx = cx - xf;
      const x0 = (xf + cw) % cw;
      const x1 = (x0 + 1) % cw;
      const top = temperature[y0 * cw + x0]! * (1 - tx) + temperature[y0 * cw + x1]! * tx;
      const bottom = temperature[y1 * cw + x0]! * (1 - tx) + temperature[y1 * cw + x1]! * tx;
      const i = fy * grid.width + fx;
      out[i] =
        top * (1 - ty) +
        bottom * ty -
        Math.max(0, elevation[i]! - seaLevel) * LAPSE_RATE +
        oceanAnomaly[i]!;
    }
  }
}
