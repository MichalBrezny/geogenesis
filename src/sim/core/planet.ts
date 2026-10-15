import { createFields, type Fields } from './fields';
import { createGrid, type Grid } from './grid';

/** Planet-wide (non-gridded) state. */
export interface GlobalState {
  /** Simulated years since the planet formed. */
  year: number;
  /** Solar input relative to present-day Earth (1 = 1361 W/m²). */
  solarInput: number;
  /** Player energy budget (Ω). */
  energy: number;
}

/** Complete simulation state. Must stay plain data so it can be serialized and sent to a worker. */
export interface PlanetState {
  grid: Grid;
  fields: Fields;
  globals: GlobalState;
  seed: number;
  rngState: number;
}

export interface PlanetOptions {
  width?: number;
  height?: number;
  seed?: number;
}

export const DEFAULT_GRID_WIDTH = 128;
export const DEFAULT_GRID_HEIGHT = 64;

export function createPlanet(options: PlanetOptions = {}): PlanetState {
  const grid = createGrid(
    options.width ?? DEFAULT_GRID_WIDTH,
    options.height ?? DEFAULT_GRID_HEIGHT,
  );
  const seed = (options.seed ?? 1) >>> 0;
  return {
    grid,
    fields: createFields(grid.cellCount),
    globals: { year: 0, solarInput: 1, energy: 0 },
    seed,
    rngState: seed,
  };
}
