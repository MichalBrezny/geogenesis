import { createFields, type Fields } from './fields';
import type { PlanetEvent } from '../events';
import { createHistory, type History } from '../history';
import { LIFE_CLASS_COUNT } from '../data/lifeClasses';
import { createGrid, type Grid } from './grid';
import type { Era } from '../eras';

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
  /** Ocean surface elevation relative to the ice-free datum, m. */
  seaLevel: number;
  /** Shape of the general circulation (written by the circulation model). */
  circulation?: { hadleyWidth: number; meanItcz: number };
  /** Carbon fluxes relative to present-day Earth (written by the carbon cycle). */
  carbon: { outgassing: number; weathering: number; burial: number };
  /** Player energy budget (Ω). */
  energy: number;
  /** Experimental mode: tools cost nothing. */
  unlimitedEnergy: boolean;
  /** Era the planet was in after the last step (see eras.ts); absent before the first step. */
  era?: Era;
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

/** Life on the planet (see models/biosphere/life.ts). */
export interface Biota {
  /** populations[c * cellCount + i]: class c in cell i, as a fraction of carrying capacity. */
  populations: Float32Array;
  /** Year each class first appeared, or null if it never has. Indexed like LIFE_CLASSES. */
  appeared: (number | null)[];
  /** Area-weighted mean population of each class over the planet (written each step). */
  cover: number[];
}

/** The planet's sentient species and its civilization (see models/civilization). */
export interface CivilizationState {
  /** Life class index of the sentient species, or null when there is none. */
  species: number | null;
  /** Index into TECH_AGES. */
  age: number;
  /** Progress through the current age, 0..1. */
  progress: number;
  /** World population in billions. */
  population: number;
  /** Year the current species became sentient. */
  sentientSince: number | null;
  /** Year a civilization left the planet, if one has. */
  exodusYear: number | null;
}

/**
 * Player-adjustable model parameters, as multipliers on each process (1 = normal),
 * like the model control panels of SimEarth.
 */
export interface ModelControls {
  /** Plate speeds. */
  driftSpeed: number;
  /** Volcanic CO₂ outgassing. */
  volcanism: number;
  /** River and hillslope erosion. */
  erosion: number;
  /** Rate at which new life classes evolve. */
  mutationRate: number;
  /** The star's brightness. */
  solarFactor: number;
}

export const DEFAULT_CONTROLS: Readonly<ModelControls> = {
  driftSpeed: 1,
  volcanism: 1,
  erosion: 1,
  mutationRate: 1,
  solarFactor: 1,
};

/** Complete simulation state. Must stay plain data so it can be serialized and sent to a worker. */
export interface PlanetState {
  grid: Grid;
  fields: Fields;
  globals: GlobalState;
  plates: Plate[];
  /** Global quantities over time, one sample per step (thinned on long runs). */
  history: History;
  biota: Biota;
  civilization: CivilizationState;
  /** Notable moments, most recent last (see events.ts). */
  events: PlanetEvent[];
  controls: ModelControls;
  /** Year each simulation component last ran, by component name (see simulation.ts). */
  lastRunYear: Record<string, number>;
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
      seaLevel: 0,
      carbon: { outgassing: 1, weathering: 1, burial: 0 },
      energy: 0,
      unlimitedEnergy: false,
    },
    plates: [],
    history: createHistory(),
    biota: {
      populations: new Float32Array(grid.cellCount * LIFE_CLASS_COUNT),
      appeared: Array.from({ length: LIFE_CLASS_COUNT }, () => null),
      cover: Array.from({ length: LIFE_CLASS_COUNT }, () => 0),
    },
    civilization: {
      species: null,
      age: 0,
      progress: 0,
      population: 0,
      sentientSince: null,
      exodusYear: null,
    },
    events: [],
    controls: { ...DEFAULT_CONTROLS },
    lastRunYear: {},
    seed,
    rngState: seed,
  };
}
