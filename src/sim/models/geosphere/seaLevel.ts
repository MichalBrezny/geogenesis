import type { SimComponent } from '../../core/component';
import type { Grid } from '../../core/grid';
import type { PlanetState } from '../../core/planet';

/** Ice-free reference sea level in metres; plate elevations remain relative to this datum. */
export const SEA_LEVEL = 0;
/** E-folding time of ocean level responding to land-ice storage. */
export const SEA_LEVEL_RESPONSE_TIME = 10_000;
const ICE_DENSITY = 917;
const SEA_WATER_DENSITY = 1025;
const MIN_SHEET_THICKNESS = 300;
const MAX_SHEET_THICKNESS = 2000;

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
 * Equilibrium sea level from water stored in land ice. Sheet thickness grows
 * as sqrt(ice-covered share of land), from 300 m for small caps to 2 km for a
 * continental sheet. The ice volume is converted to seawater volume over the
 * ice-free reference ocean area, so no ice always means the 0 m datum.
 */
export function equilibriumSeaLevel(state: PlanetState): number {
  const { grid, fields } = state;
  const { elevation, iceCover } = fields;
  let landArea = 0;
  let iceArea = 0;
  let oceanArea = 0;
  for (let y = 0; y < grid.height; y++) {
    const area = grid.rowCellArea[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (isOcean(elevation[i]!, SEA_LEVEL)) oceanArea += area;
      if (!isOcean(elevation[i]!, state.globals.seaLevel)) {
        landArea += area;
        iceArea += area * iceCover[i]!;
      }
    }
  }
  if (iceArea <= 0 || landArea <= 0 || oceanArea <= 0) return SEA_LEVEL;
  const extent = Math.min(1, iceArea / landArea);
  const thickness =
    MIN_SHEET_THICKNESS + (MAX_SHEET_THICKNESS - MIN_SHEET_THICKNESS) * Math.sqrt(extent);
  const equivalentWater = iceArea * thickness * (ICE_DENSITY / SEA_WATER_DENSITY);
  return SEA_LEVEL - equivalentWater / oceanArea;
}

/** Relaxes the ocean surface towards the land-ice sea-level equivalent. */
export const seaLevelModel: SimComponent = {
  name: 'seaLevel',
  inputs: ['elevation', 'iceCover'],
  outputs: [],
  runOneStep(state, dtYears) {
    const target = equilibriumSeaLevel(state);
    if (dtYears <= 0) return;
    const response = 1 - Math.exp(-dtYears / SEA_LEVEL_RESPONSE_TIME);
    state.globals.seaLevel += (target - state.globals.seaLevel) * response;
  },
};
