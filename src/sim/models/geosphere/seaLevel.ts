import type { SimComponent } from '../../core/component';
import type { Grid } from '../../core/grid';
import type { PlanetState } from '../../core/planet';

/** Ice-free reference sea level in metres; plate elevations remain relative to this datum. */
export const SEA_LEVEL = 0;
/** E-folding time of ocean level responding to water storage and basin changes. */
export const SEA_LEVEL_RESPONSE_TIME = 10_000;
const ICE_DENSITY = 917;
const SEA_WATER_DENSITY = 1025;
const FRESH_WATER_DENSITY = 1000;
const STANDARD_GRAVITY = 9.80665;
const PASCALS_PER_BAR = 100_000;
/** Metres GEL represented by one bar of atmospheric water vapour. */
export const WATER_GEL_PER_BAR = PASCALS_PER_BAR / (STANDARD_GRAVITY * FRESH_WATER_DENSITY);

/** Pressure/column-mass conversion for the planet's configured surface gravity. */
export function waterGelPerBar(surfaceGravity: number): number {
  return PASCALS_PER_BAR / (Math.max(0.1, surfaceGravity) * FRESH_WATER_DENSITY);
}

/** Whether an absolute terrain elevation is below the planet's current sea surface. */
export function isOcean(elevation: number, seaLevel: number): boolean {
  return elevation < seaLevel;
}

/** Area fraction of the planet currently exposed as land. */
export function landSurfaceFraction(
  grid: Grid,
  elevation: ArrayLike<number>,
  seaLevel: number,
): number {
  let land = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (!isOcean(elevation[y * grid.width + x]!, seaLevel)) land += grid.rowAreaWeight[y]!;
    }
  }
  return land;
}

/** Ocean-basin volume below a sea surface, expressed as metres GEL. */
export function basinWaterGel(
  grid: Grid,
  elevation: ArrayLike<number>,
  seaLevel: number,
): number {
  let volume = 0;
  let area = 0;
  for (let y = 0; y < grid.height; y++) {
    const cellArea = grid.rowCellArea[y]!;
    area += cellArea * grid.width;
    for (let x = 0; x < grid.width; x++) {
      const depth = seaLevel - elevation[y * grid.width + x]!;
      if (depth > 0) volume += depth * cellArea;
    }
  }
  return area > 0 ? volume / area : 0;
}

/** Grounded land ice as the equivalent global layer of liquid seawater. */
export function landIceWaterGel(state: PlanetState): number {
  const { grid, fields, globals } = state;
  let volume = 0;
  let area = 0;
  for (let y = 0; y < grid.height; y++) {
    const cellArea = grid.rowCellArea[y]!;
    area += cellArea * grid.width;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (!isOcean(fields.elevation[i]!, globals.seaLevel)) {
        volume += cellArea * Math.max(0, fields.iceThickness[i]!);
      }
    }
  }
  return area > 0 ? (volume * ICE_DENSITY) / (area * SEA_WATER_DENSITY) : 0;
}

/** Water held in the atmosphere, in the same GEL units as the total inventory. */
export function atmosphericWaterGel(state: PlanetState): number {
  return (
    Math.max(0, state.globals.atmosphere.waterVapor) *
    waterGelPerBar(state.planetParams.surfaceGravity)
  );
}

/** Water available to fill ocean basins after grounded ice and vapour are removed. */
export function liquidWaterGel(state: PlanetState): number {
  return Math.max(0, state.globals.water - landIceWaterGel(state) - atmosphericWaterGel(state));
}

/**
 * Initializes a generated planet's conserved inventory so the requested sea
 * surface is reproduced exactly by its actual hypsometry.
 */
export function initializeWaterInventory(state: PlanetState, seaLevel = SEA_LEVEL): void {
  state.globals.seaLevel = seaLevel;
  state.globals.water =
    basinWaterGel(state.grid, state.fields.elevation, seaLevel) +
    landIceWaterGel(state) +
    atmosphericWaterGel(state);
  state.globals.initialWater = state.globals.water;
  state.globals.escapedWater = 0;
}

/**
 * Inverts the terrain's hypsometry by bisection: the volume below the returned
 * elevation equals the liquid inventory. Real spherical cell areas are used.
 * With no liquid water the level sits just below the lowest cell, yielding no sea.
 */
export function equilibriumSeaLevel(state: PlanetState): number {
  return seaLevelForWaterGel(state.grid, state.fields.elevation, liquidWaterGel(state));
}

/** Sea-surface elevation that holds a specified liquid global-equivalent layer. */
export function seaLevelForWaterGel(
  grid: Grid,
  elevation: ArrayLike<number>,
  target: number,
): number {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let i = 0; i < elevation.length; i++) {
    const value = elevation[i]!;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (target <= 1e-9) return minimum - 1;

  let low = minimum;
  // Once every cell is submerged, every additional metre of GEL raises the
  // surface by a metre, so this is a guaranteed upper bracket.
  let high = maximum + target;
  for (let iteration = 0; iteration < 50; iteration++) {
    const mid = (low + high) / 2;
    if (basinWaterGel(grid, elevation, mid) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Keeps terrain elevations tied to the planet's original ice-free ocean datum.
 * Plate raster resampling and unresolved deep-sea sediment can otherwise move
 * the arbitrary vertical zero by hundreds of metres, especially on coarse grids.
 * A uniform shift changes neither relief nor basin volume; it only restores the
 * documented datum against which `seaLevel` is reported. Added/lost water and
 * land ice still move the sea relative to that fixed initial-inventory datum.
 */
export const seaLevelDatumModel: SimComponent = {
  name: 'seaLevelDatum',
  inputs: ['elevation'],
  outputs: ['elevation'],
  runOneStep(state) {
    const referenceVapor = 0.0025 * waterGelPerBar(state.planetParams.surfaceGravity);
    const referenceLiquid = Math.max(0, state.globals.initialWater - referenceVapor);
    if (referenceLiquid <= 0) return;
    const shift = seaLevelForWaterGel(state.grid, state.fields.elevation, referenceLiquid);
    if (Math.abs(shift) < 1e-9) return;
    for (let i = 0; i < state.grid.cellCount; i++) {
      state.fields.elevation[i] = state.fields.elevation[i]! - shift;
    }
    state.globals.seaLevel -= shift;
  },
};

/** Relaxes the ocean surface towards the volume-conserving basin level. */
export const seaLevelModel: SimComponent = {
  name: 'seaLevel',
  inputs: ['elevation', 'iceThickness'],
  outputs: [],
  runOneStep(state, dtYears) {
    const target = equilibriumSeaLevel(state);
    if (dtYears <= 0) return;
    const response = 1 - Math.exp(-dtYears / SEA_LEVEL_RESPONSE_TIME);
    state.globals.seaLevel += (target - state.globals.seaLevel) * response;
  },
};
