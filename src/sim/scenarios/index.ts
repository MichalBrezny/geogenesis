import type { PlanetOptions, PlanetState } from '../core/planet';
import {
  createRandomWorld,
  createPlanetPreset,
  randomWorldFromPlanet,
  type PlanetStart,
  type RandomWorldSettings,
  type World,
} from '../world';
import { createDaisyworld, daisyworldFromPlanet } from './daisyworld';
import {
  createBrighteningSun,
  createCradle,
  createSnowball,
  createTerraformMars,
  createStoneAge,
  createCambrian,
  restoreGoalScenario,
} from './goalScenarios';

interface Scenario {
  /** Generates a new planet. */
  create: (options: ScenarioOptions) => World;
  /** Rebuilds the simulation around a saved planet. */
  restore: (planet: PlanetState, settings?: RandomWorldSettings) => World;
}

export interface ScenarioOptions extends PlanetOptions {
  start?: PlanetStart;
  /** Desired mature ice-free land share for random planets. */
  continentalFraction?: number;
}

/** Scenarios the player can start; ids are stable (used in messages and saves). */
export const SCENARIOS = {
  random: {
    create: createRandomWorld,
    restore: (planet, settings) => randomWorldFromPlanet(planet, settings),
  },
  daisyworld: { create: createDaisyworld, restore: (planet) => daisyworldFromPlanet(planet) },
  aquarium: {
    // SimEarth's water world: no continents, only the islands volcanoes build.
    create: (options) =>
      createRandomWorld({ ...options, oceanFraction: 1, continentalFraction: 0 }),
    restore: (planet, settings) =>
      randomWorldFromPlanet(planet, {
        continentalFraction: 0,
        start: settings?.start ?? 'quick',
      }),
  },
  mars: {
    create: (options) => createPlanetPreset('mars', options),
    restore: (planet, settings) => randomWorldFromPlanet(planet, settings),
  },
  venus: {
    create: (options) => createPlanetPreset('venus', options),
    restore: (planet, settings) => randomWorldFromPlanet(planet, settings),
  },
  brighteningSun: {
    create: createBrighteningSun,
    restore: (planet, settings) => restoreGoalScenario('brighteningSun', planet, settings),
  },
  snowball: {
    create: createSnowball,
    restore: (planet, settings) => restoreGoalScenario('snowball', planet, settings),
  },
  cradle: {
    create: createCradle,
    restore: (planet, settings) => restoreGoalScenario('cradle', planet, settings),
  },
  terraformMars: {
    create: createTerraformMars,
    restore: (planet, settings) => restoreGoalScenario('terraformMars', planet, settings),
  },
  stoneAge: {
    create: createStoneAge,
    restore: (planet, settings) => restoreGoalScenario('exodus', planet, settings),
  },
  cambrian: {
    create: createCambrian,
    restore: (planet, settings) => randomWorldFromPlanet(planet, settings),
  },
} satisfies Record<string, Scenario>;

export type ScenarioId = keyof typeof SCENARIOS;
export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

export function isScenarioId(id: string): id is ScenarioId {
  return id in SCENARIOS;
}

export function createScenario(id: ScenarioId, options: ScenarioOptions): World {
  return SCENARIOS[id].create(options);
}

export function restoreScenario(
  id: ScenarioId,
  planet: PlanetState,
  settings?: RandomWorldSettings,
): World {
  return SCENARIOS[id].restore(planet, settings);
}
