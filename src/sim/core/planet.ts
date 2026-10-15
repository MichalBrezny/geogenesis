import { createFields, type Fields } from './fields';
import { createHistory, type History } from '../history';
import { createGrid, type Grid } from './grid';

/** Well-mixed atmospheric gases. */
export interface Atmosphere {
  /** Carbon dioxide, ppm by volume (280 before the industrial era). */
  co2: number;
  /** Methane, ppm by volume (0.7 before the industrial era). */
  ch4: number;
  /** Oxygen, fraction by volume (0.21 on modern Earth). */
  o2: number;
}

/** Planet-wide (non-gridded) state. */
export interface GlobalState {
  /** Simulated years since the planet formed (the star is assumed to be the same age). */
  year: number;
  /** Star luminosity relative to the present Sun (1 = 1361 W/m² at the planet). */
  solarInput: number;
  atmosphere: Atmosphere;
  /** Area-weighted mean surface air temperature, °C (written by the climate model). */
  meanTemperature: number;
  /** Fraction of the surface covered by ice, 0..1 (written by the climate model). */
  iceFraction: number;
  /** Carbon fluxes relative to present-day Earth (written by the carbon cycle). */
  carbon: { outgassing: number; weathering: number };
  /** Player energy budget (Ω). */
  energy: number;
}

/** A rigid tectonic plate rotating about an Euler pole. */
export interface Plate {
  id: number;
  /** Unit vector of the rotation axis through the planet centre. */
  eulerPole: [number, number, number];
  /** Rotation rate in radians per year (surface speed = rate × radius × sin(angle to pole)). */
  angularSpeed: number;
  /**
   * Rotation rate the plate's driving forces aim for (rad/yr). Collisions slow the
   * plate below it; it recovers once free.
   */
  targetSpeed: number;
  /**
   * Total rotation of the plate since its crust was anchored, as a row-major 3×3
   * matrix mapping reference positions to current positions.
   */
  rotation: number[];
  /**
   * The plate's crust in its own reference frame, on a grid identical to the
   * planet's. Moving the plate only changes `rotation`; the planet fields are
   * re-composed from these rasters, so plate shapes never degrade from repeated
   * resampling.
   */
  crust: PlateCrust;
}

export interface PlateCrust {
  /** 1 where the plate has crust at this reference cell. */
  owned: Uint8Array;
  elevation: Float32Array;
  /** Same meaning as the crustType field. */
  type: Uint8Array;
}

/** Complete simulation state. Must stay plain data so it can be serialized and sent to a worker. */
export interface PlanetState {
  grid: Grid;
  fields: Fields;
  globals: GlobalState;
  plates: Plate[];
  /** Global quantities over time, one sample per step (thinned on long runs). */
  history: History;
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
    globals: {
      year: 0,
      solarInput: 1,
      atmosphere: { co2: 280, ch4: 0.7, o2: 0.21 },
      meanTemperature: 0,
      iceFraction: 0,
      carbon: { outgassing: 1, weathering: 1 },
      energy: 0,
    },
    plates: [],
    history: createHistory(),
    seed,
    rngState: seed,
  };
}
