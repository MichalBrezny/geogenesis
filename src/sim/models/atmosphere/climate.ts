import type { SimComponent } from '../../core/component';
import { areaWeightedMean, createGrid, type Grid } from '../../core/grid';
import type { Atmosphere } from '../../core/planet';
import { SOLAR_CONSTANT } from './star';

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
/** Snow and ice cover ramps from none at ICE_NONE to full at ICE_FULL (°C, annual mean). */
const ICE_NONE = -5;
const ICE_FULL = -15;
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

/**
 * Annual-mean insolation (W/m²) at a latitude for Earth's obliquity, using the
 * second Legendre polynomial fit of North (1975).
 */
export function annualInsolation(latitudeDeg: number, solarInput: number): number {
  const x = Math.sin((latitudeDeg * Math.PI) / 180);
  const p2 = (3 * x * x - 1) / 2;
  return ((SOLAR_CONSTANT * solarInput) / 4) * (1 - 0.482 * p2);
}

/** Fraction of a cell covered by snow and ice at an annual-mean temperature. */
export function iceFractionAt(temperature: number): number {
  return Math.min(1, Math.max(0, (ICE_NONE - temperature) / (ICE_NONE - ICE_FULL)));
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
    inputs: ['elevation', 'surfaceAlbedo', 'oceanAnomaly'],
    outputs: ['airTemperature', 'iceCover', 'albedo'],
    runOneStep(state, dtYears) {
      const { grid, fields, globals } = state;
      const { elevation, surfaceAlbedo, airTemperature, iceCover, albedo } = fields;
      // Last step's temperatures, for the ocean's lag. The first run of a planet has
      // dt = 0 and goes straight to equilibrium.
      const lag = dtYears > 0 ? Math.exp(-dtYears / OCEAN_RESPONSE_TIME) : 0;
      const previous = lag > 1e-6 ? Float32Array.from(airTemperature) : null;
      const climate = getClimateGrid(grid, diffusivity);
      const forcing = greenhouseForcing(globals.atmosphere);

      // Start from last step's albedo where it exists, so the ice state persists (hysteresis).
      for (let i = 0; i < grid.cellCount; i++) {
        const base = surfaceAlbedo[i]!;
        if (albedo[i] === 0) albedo[i] = base * (1 - iceCover[i]!) + iceAlbedo * iceCover[i]!;
      }

      for (let iteration = 0; iteration < 12; iteration++) {
        solveCoarse(climate, grid, albedo, globals.solarInput, forcing);
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
          const ice = iceFractionAt(airTemperature[i]!);
          const target = surfaceAlbedo[i]! * (1 - ice) + iceAlbedo * ice;
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
          iceCover[i] = iceFractionAt(airTemperature[i]!);
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

function solveCoarse(
  climate: ClimateGrid,
  grid: Grid,
  albedo: Float32Array,
  solarInput: number,
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
    const insolation = annualInsolation(coarse.rowLatitude[y]!, solarInput);
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
