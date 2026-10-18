import type { SimComponent } from '../../core/component';
import {
  areaWeightedMean,
  createGrid,
  getTopology,
  NEIGHBOR_COUNT,
  type Grid,
} from '../../core/grid';
import {
  EARTH_ROTATION_PERIOD_HOURS,
  EARTH_SURFACE_GRAVITY,
  type Atmosphere,
} from '../../core/planet';
import { recordEvent } from '../../events';
import { isOcean } from '../geosphere/seaLevel';
import {
  REFERENCE_SURFACE_PRESSURE,
  REFERENCE_WATER_VAPOR,
  boilingPointC,
  surfacePressureOf,
  updateSurfacePressure,
} from './atmosphere';
import { LOW_CLOUD_ALBEDO, REFERENCE_LOW_CLOUD } from './clouds';
import { surfaceIceCover } from './ice';
import { SOLAR_CONSTANT } from './star';

export { iceFractionAt } from './ice';

/** Low-temperature outgoing-radiation fit from North et al. (1981), T in deg C. */
const OLR_A = 203.3;
const OLR_B = 2.09;
/** Wet-atmosphere Simpson-Nakajima radiation limit, W/m2. */
export const WET_OLR_LIMIT = 294;
/** Temperature where the OLR bends smoothly away from the linear Earth regime. */
export const WET_OLR_TRANSITION = 40;
const WET_TRANSITION_OLR = OLR_A + OLR_B * WET_OLR_TRANSITION;
/** Numerical bounds for climates from snowballs through dry Venus-like worlds. */
export const MIN_CLIMATE_TEMPERATURE = -120;
export const MAX_CLIMATE_TEMPERATURE = 700;
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
/**
 * Greenhouse effect built into the North OLR fit that a near-vacuum loses, W/m².
 * The fit A + B·T contains Earth's ~33 K greenhouse; a bare surface emits σT⁴
 * instead, which at the −50…−60 °C of thin-atmosphere worlds is ~39–42 W/m² more
 * than the fit (117 vs 78 W/m² at −60 °C). Faded in below 0.1 bar, so it never
 * touches Earth-like atmospheres. With it, Mars (absorbed ≈ 110 W/m²) lands near
 * its observed −60 °C mean (210 K effective temperature).
 */
const THIN_ATMOSPHERE_COOLING = 40;
/** Pressure (bar) below which the atmosphere's heat transport falls off faster. */
const THIN_TRANSPORT_PRESSURE = 0.1;
/**
 * Below THIN_TRANSPORT_PRESSURE heat transport falls linearly with pressure: a thin
 * atmosphere's heat capacity and eddy heat flux scale with its mass while radiative
 * relaxation gets faster than transport, so surface temperatures follow local
 * insolation (Mars: ~50–60 K equator–pole contrast at 6 mbar).
 */
const THIN_TRANSPORT_EXPONENT = 1;
const MIN_TRANSPORT_SCALE = 0.002;
const MAX_TRANSPORT_SCALE = 80;
/**
 * Extra heat transport on a tidally locked planet. Its day–night contrast is erased
 * by a thermally direct overturning and stationary equatorial waves, much more
 * efficient than the zonal-mean eddy diffusion this EBM is tuned for: GCMs give
 * ~40–60 K day–night contrast at 1 bar and < 20–25 K at several bar (Yang, Cowan &
 * Abbot 2013; Koll & Abbot 2016, weak-temperature-gradient scaling with pressure).
 */
const LOCKED_HEAT_TRANSPORT = 2.5;
/**
 * Water inventory (m GEL) below which the atmosphere counts as dry: a comet's trace
 * of water on a Venus-like world must not switch it to the wet radiation limit.
 */
const TRACE_WATER_GEL = 0.01;
/** Ocean share of the surface above which lapse-rate heights are measured from the sea. */
const LAPSE_DATUM_OCEAN_FRACTION = 0.2;

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
  const water = 2 * Math.log(Math.max(atmosphere.waterVapor, 1e-8) / REFERENCE_WATER_VAPOR);
  // Collision/pressure broadening of the CO2 and H2O bands. Normalizing to the
  // complete reference atmosphere makes the calibrated Earth forcing identical.
  // CO2 self-broadening up to ~1 bar is already in the fit's quadratic term, so
  // only CO2 beyond 1 bar adds here; otherwise a CO2-rich young planet feeds on
  // itself, while a Venus-like atmosphere still broadens its bands.
  const broadeningCo2 = REFERENCE_CO2 + Math.max(0, atmosphere.co2 - 1e6);
  const broadening = Math.sqrt(
    surfacePressureOf({ ...atmosphere, co2: broadeningCo2 }) / REFERENCE_SURFACE_PRESSURE,
  );
  // The methane formula uses ppb.
  const ch4 = 0.036 * (Math.sqrt(atmosphere.ch4 * 1000) - Math.sqrt(REFERENCE_CH4 * 1000));
  return broadening * (co2 + water) + ch4;
}

/**
 * Clear-sky OLR used by the EBM. With surface water it joins the North linear
 * fit continuously at 40 C, then approaches 294 W/m2 exponentially: a compact
 * fit to the Simpson-Nakajima limit in Goldblatt et al. (2013) and the moist
 * greenhouse transition in Kopparapu et al. (2013). A dry planet stays linear.
 */
export function outgoingLongwaveRadiation(temperatureC: number, hasWater: boolean): number {
  if (!hasWater || temperatureC <= WET_OLR_TRANSITION) {
    return OLR_A + OLR_B * temperatureC;
  }
  return (
    WET_OLR_LIMIT -
    (WET_OLR_LIMIT - WET_TRANSITION_OLR) *
      Math.exp(
        (-OLR_B * (temperatureC - WET_OLR_TRANSITION)) / (WET_OLR_LIMIT - WET_TRANSITION_OLR),
      )
  );
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

const lockedInsolationNormalization = new WeakMap<Grid, number>();

/** Fixed-substellar insolation, discretely normalized to the same global S/4 mean. */
export function tidallyLockedInsolation(grid: Grid, cell: number, solarInput: number): number {
  let normalization = lockedInsolationNormalization.get(grid);
  if (normalization === undefined) {
    let rawMean = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const i = y * grid.width + x;
        rawMean += Math.max(0, grid.cellPosition[i * 3]!) * grid.rowAreaWeight[y]!;
      }
    }
    normalization = rawMean > 0 ? 0.25 / rawMean : 1;
    lockedInsolationNormalization.set(grid, normalization);
  }
  return SOLAR_CONSTANT * solarInput * Math.max(0, grid.cellPosition[cell * 3]!) * normalization;
}

/** Slow rotation permits broader eddies and stronger horizontal heat transport. */
export function rotationHeatTransportScale(rotationPeriodHours: number): number {
  const period = Math.max(1, Math.abs(rotationPeriodHours));
  return Math.max(0.25, Math.min(4, Math.sqrt(period / EARTH_ROTATION_PERIOD_HOURS)));
}

/** Sulfuric-acid haze on a hot, dry CO₂-rich world (Venus reaches about 0.75). */
export function sulfurCloudAlbedo(atmosphere: Atmosphere, hasWater: boolean): number {
  if (hasWater) return 0;
  const share = Math.max(0, Math.min(1, (atmosphere.co2 * 1e-6 - 10) / 40));
  return 0.75 * share * share * (3 - 2 * share);
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
 * On a coarse lat/long grid it solves the low-temperature steady state of
 *   Q(phi)(1 - alpha) = OLR(T) - F_greenhouse - D laplacian(T)
 * with conjugate gradients, where OLR bends from the North linear fit towards
 * the wet Simpson-Nakajima limit and alpha is the fine-cell mean albedo.
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
      updateSurfacePressure(globals);
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
      climate.transportScale = heatTransportScale(
        globals.surfacePressure,
        state.planetParams.rotationPeriodHours,
        state.planetParams.tidallyLocked,
      );
      const hasWater = globals.water > TRACE_WATER_GEL;
      const hasSeasons = !state.planetParams.tidallyLocked && state.controls.obliquity > 1e-6;
      const continentality = hasSeasons
        ? continentalityField(grid, elevation, globals.seaLevel)
        : null;
      const seasonalForcing = new Float64Array(grid.height);
      for (let y = 0; y < grid.height; y++) {
        seasonalForcing[y] = hasSeasons
          ? Math.abs(
              firstAnnualInsolationHarmonic(
                grid.rowLatitude[y]!,
                globals.solarInput,
                state.controls.obliquity,
              ),
            )
          : 0;
      }
      const forcing =
        greenhouseForcing(globals.atmosphere) -
        thinAtmosphereCooling(globals.surfacePressure) -
        globals.volcanicAerosol +
        globals.impactHeating;
      const hazeAlbedo = sulfurCloudAlbedo(globals.atmosphere, hasWater);
      const lapseDatum = lapseRateDatum(grid, elevation, globals.seaLevel);
      let crossedRunawayLimit = false;

      // Start from last step's albedo where it exists, so the ice state persists (hysteresis).
      for (let i = 0; i < grid.cellCount; i++) {
        const base = Math.max(surfaceAlbedo[i]!, hazeAlbedo);
        if (albedo[i] === 0) albedo[i] = base * (1 - iceCover[i]!) + iceAlbedo * iceCover[i]!;
      }

      for (let iteration = 0; iteration < 12; iteration++) {
        crossedRunawayLimit =
          solveCoarse(
            climate,
            grid,
            albedo,
            globals.solarInput,
            state.controls.obliquity,
            state.planetParams.tidallyLocked,
            forcing,
            hasWater,
            hasWater && (globals.runawayGreenhouse || globals.meanTemperature >= 50),
            globals.surfacePressure,
          ) || crossedRunawayLimit;
        interpolateToFine(
          climate,
          grid,
          elevation,
          fields.oceanAnomaly,
          lapseDatum,
          state.planetParams.surfaceGravity,
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
            Math.max(0.03, hazeAlbedo, surfaceAlbedo[i]! * (1 - ice) + iceAlbedo * ice + cloud),
          );
          // Damped update: the albedo–temperature iteration can oscillate at ice edges.
          const next = iteration === 0 ? target : 0.5 * (albedo[i]! + target);
          maxChange = Math.max(maxChange, Math.abs(next - albedo[i]!));
          albedo[i] = next;
          iceCover[i] = ice;
        }
        if (maxChange < 1e-3) break;
      }
      // Only a planet with water can cross the moist runaway limit; a dry Venus is hot, not runaway.
      if (crossedRunawayLimit && hasWater && !globals.runawayGreenhouse) {
        globals.runawayGreenhouse = true;
        recordEvent(state, 'runawayGreenhouse');
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
  diffusivity: number;
  /** Atmospheric-mass multiplier applied to face conductances. */
  transportScale: number;
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
  if (!climate || climate.diffusivity !== diffusivity) {
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
    diffusivity,
    transportScale: 1,
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
  tidallyLocked: boolean,
  forcing: number,
  hasWater: boolean,
  forcedRunaway: boolean,
  surfacePressure: number,
): boolean {
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
  let absorbedSum = 0;
  let areaSum = 0;
  for (let y = 0; y < coarse.height; y++) {
    const zonalInsolation = tidallyLocked
      ? 0
      : annualInsolation(coarse.rowLatitude[y]!, solarInput, obliquity);
    for (let x = 0; x < coarse.width; x++) {
      const c = y * coarse.width + x;
      coarseAlbedo[c] = coarseAlbedo[c]! / weight[c]!;
      const insolation = tidallyLocked
        ? tidallyLockedInsolation(coarse, c, solarInput)
        : zonalInsolation;
      const absorbed = insolation * (1 - coarseAlbedo[c]!);
      rhs[c] = rowArea[y]! * (absorbed - (OLR_A - forcing));
      absorbedSum += rowArea[y]! * absorbed;
      areaSum += rowArea[y]!;
    }
  }
  conjugateGradient(climate);
  const requiredOlr = absorbedSum / areaSum + forcing;
  const runaway = hasWater && (forcedRunaway || requiredOlr >= WET_OLR_LIMIT);
  if (runaway) {
    // Above the radiation limit no wet steady state exists. Represent the hot
    // moist adiabat with a bounded target that strengthens as steam pressure and
    // greenhouse forcing grow; the water component supplies the slower inventory change.
    const hotTarget = Math.min(
      MAX_CLIMATE_TEMPERATURE,
      Math.max(
        boilingPointC(surfacePressure) + 30,
        120 + 4 * Math.max(0, requiredOlr - WET_OLR_LIMIT) + 1.5 * Math.max(0, forcing),
      ),
    );
    shiftCoarseMean(climate, hotTarget);
  } else if (hasWater && requiredOlr > WET_TRANSITION_OLR) {
    const remaining = Math.max(1e-9, WET_OLR_LIMIT - requiredOlr);
    const wetTarget =
      WET_OLR_TRANSITION -
      ((WET_OLR_LIMIT - WET_TRANSITION_OLR) / OLR_B) *
        Math.log(remaining / (WET_OLR_LIMIT - WET_TRANSITION_OLR));
    shiftCoarseMean(climate, wetTarget);
  }
  return runaway;
}

function shiftCoarseMean(climate: ClimateGrid, target: number): void {
  const { temperature, rowArea, coarse } = climate;
  let sum = 0;
  let area = 0;
  for (let i = 0; i < temperature.length; i++) {
    const weight = rowArea[Math.floor(i / coarse.width)]!;
    sum += temperature[i]! * weight;
    area += weight;
  }
  const shift = target - sum / area;
  for (let i = 0; i < temperature.length; i++) {
    temperature[i] = Math.max(
      MIN_CLIMATE_TEMPERATURE,
      Math.min(MAX_CLIMATE_TEMPERATURE, temperature[i]! + shift),
    );
  }
}

/** (A·B + D·L) x, the energy balance operator; symmetric positive definite. */
function applyOperator(climate: ClimateGrid, x: Float64Array, out: Float64Array): void {
  const { neighbors, conductance, rowArea, coarse, transportScale } = climate;
  for (let i = 0; i < x.length; i++) {
    let value = rowArea[Math.floor(i / coarse.width)]! * OLR_B * x[i]!;
    for (let d = 0; d < 4; d++) {
      const n = neighbors[i * 4 + d]!;
      if (n >= 0) value += transportScale * conductance[i * 4 + d]! * (x[i]! - x[n]!);
    }
    out[i] = value;
  }
}

/** Jacobi-preconditioned conjugate gradients, warm-started from the previous solution. */
function conjugateGradient(climate: ClimateGrid): void {
  const {
    temperature: x,
    rhs: b,
    neighbors,
    conductance,
    rowArea,
    coarse,
    transportScale,
  } = climate;
  const n = x.length;
  const diagonal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let value = rowArea[Math.floor(i / coarse.width)]! * OLR_B;
    for (let d = 0; d < 4; d++) {
      if (neighbors[i * 4 + d]! >= 0) value += transportScale * conductance[i * 4 + d]!;
    }
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
 * Multiplier on the EBM's heat transport. Above 0.1 bar it rises with atmospheric
 * mass as P^0.7 (between the linear and square-root scalings of simple EBMs); below,
 * it falls linearly with mass. Slow rotation and tidal locking strengthen it.
 * Earth (1 bar, 24 h, not locked) gives exactly the calibrated value.
 */
export function heatTransportScale(
  surfacePressure: number,
  rotationPeriodHours: number,
  tidallyLocked: boolean,
): number {
  const ratio = surfacePressure / REFERENCE_SURFACE_PRESSURE;
  const thin = THIN_TRANSPORT_PRESSURE / REFERENCE_SURFACE_PRESSURE;
  const pressureScale =
    ratio >= thin
      ? Math.pow(ratio, 0.7)
      : Math.pow(thin, 0.7) * Math.pow(Math.max(0, ratio) / thin, THIN_TRANSPORT_EXPONENT);
  return Math.max(
    MIN_TRANSPORT_SCALE,
    Math.min(
      MAX_TRANSPORT_SCALE,
      pressureScale *
        rotationHeatTransportScale(rotationPeriodHours) *
        (tidallyLocked ? LOCKED_HEAT_TRANSPORT : 1),
    ),
  );
}

/**
 * Reference the lapse-rate cooling is measured from. With a real ocean it is the sea
 * surface. A planet whose sea has shrunk to its deepest basins, or vanished, measures
 * heights from its area-mean surface instead (cooling highlands, warming basins), so
 * a dry world is not chilled by the kilometres down to a sea level that sank with its
 * oceans. The two blend as the ocean shrinks below LAPSE_DATUM_OCEAN_FRACTION; an
 * Earth-like ocean gives exactly the sea level.
 */
interface LapseDatum {
  seaLevel: number;
  /** Weight of the sea-level reference, 0..1. */
  seaWeight: number;
  meanSurface: number;
}

function lapseRateDatum(grid: Grid, elevation: Float32Array, seaLevel: number): LapseDatum {
  let ocean = 0;
  let mean = 0;
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    for (let x = 0; x < grid.width; x++) {
      const value = elevation[y * grid.width + x]!;
      mean += weight * value;
      if (isOcean(value, seaLevel)) ocean += weight;
    }
  }
  return {
    seaLevel,
    seaWeight: Math.min(1, ocean / LAPSE_DATUM_OCEAN_FRACTION),
    meanSurface: mean,
  };
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
  datum: LapseDatum,
  surfaceGravity: number,
  out: Float32Array,
): void {
  const { coarse, factor, temperature } = climate;
  const { seaLevel, seaWeight, meanSurface } = datum;
  const gravityRatio = surfaceGravity / EARTH_SURFACE_GRAVITY;
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
      out[i] = Math.max(
        MIN_CLIMATE_TEMPERATURE,
        Math.min(
          MAX_CLIMATE_TEMPERATURE,
          top * (1 - ty) +
            bottom * ty -
            (seaWeight >= 1
              ? Math.max(0, elevation[i]! - seaLevel)
              : seaWeight * Math.max(0, elevation[i]! - seaLevel) +
                (1 - seaWeight) * (elevation[i]! - meanSurface)) *
              LAPSE_RATE *
              gravityRatio +
            oceanAnomaly[i]!,
        ),
      );
    }
  }
}

function thinAtmosphereCooling(surfacePressure: number): number {
  const share = Math.max(0, Math.min(1, (0.1 - surfacePressure) / 0.1));
  return THIN_ATMOSPHERE_COOLING * share * share * (3 - 2 * share);
}
