import type { PlanetOptions, PlanetState } from '../core/planet';
import { createRandomWorld, randomWorldFromPlanet, type World } from '../world';
import { createDaisyworld, daisyworldFromPlanet } from './daisyworld';

interface Scenario {
  /** Generates a new planet. */
  create: (options: PlanetOptions) => World;
  /** Rebuilds the simulation around a saved planet. */
  restore: (planet: PlanetState) => World;
}

/** Scenarios the player can start; ids are stable (used in messages and saves). */
export const SCENARIOS = {
  random: { create: createRandomWorld, restore: randomWorldFromPlanet },
  daisyworld: { create: createDaisyworld, restore: (planet) => daisyworldFromPlanet(planet) },
} satisfies Record<string, Scenario>;

export type ScenarioId = keyof typeof SCENARIOS;
export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

export function isScenarioId(id: string): id is ScenarioId {
  return id in SCENARIOS;
}

export function createScenario(id: ScenarioId, options: PlanetOptions): World {
  return SCENARIOS[id].create(options);
}

export function restoreScenario(id: ScenarioId, planet: PlanetState): World {
  return SCENARIOS[id].restore(planet);
}
