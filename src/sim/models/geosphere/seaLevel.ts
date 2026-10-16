import type { SimComponent } from '../../core/component';
import type { Grid } from '../../core/grid';
import type { PlanetState } from '../../core/planet';

/** Ice-free reference sea level in metres; plate elevations remain relative to this datum. */
export const SEA_LEVEL = 0;
/** E-folding time of ocean level responding to land-ice storage. */
export const SEA_LEVEL_RESPONSE_TIME = 10_000;
const ICE_DENSITY = 917;
const SEA_WATER_DENSITY = 1025;

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

/**
 * Equilibrium sea level from the represented grounded land-ice volume. The ice
 * volume is converted to seawater volume over the ice-free reference ocean
 * area, so no ice always means the 0 m datum.
 */
export function equilibriumSeaLevel(state: PlanetState): number {
  const { grid, fields } = state;
  const { elevation, iceThickness } = fields;
  let iceVolume = 0;
  let oceanArea = 0;
  for (let y = 0; y < grid.height; y++) {
    const area = grid.rowCellArea[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (isOcean(elevation[i]!, SEA_LEVEL)) oceanArea += area;
      if (!isOcean(elevation[i]!, state.globals.seaLevel)) {
        iceVolume += area * Math.max(0, iceThickness[i]!);
      }
    }
  }
  if (iceVolume <= 0 || oceanArea <= 0) return SEA_LEVEL;
  const equivalentWater = iceVolume * (ICE_DENSITY / SEA_WATER_DENSITY);
  return SEA_LEVEL - equivalentWater / oceanArea;
}

/** Relaxes the ocean surface towards the land-ice sea-level equivalent. */
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
