import type { PlanetOptions } from '../core/planet';
import { createRandomWorld, type World } from '../world';
import { createDaisyworld } from './daisyworld';

/** Scenarios the player can start; ids are stable (used in messages and saves). */
export const SCENARIOS = {
  random: (options: PlanetOptions) => createRandomWorld(options),
  daisyworld: (options: PlanetOptions) => createDaisyworld(options),
} satisfies Record<string, (options: PlanetOptions) => World>;

export type ScenarioId = keyof typeof SCENARIOS;
export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

export function createScenario(id: ScenarioId, options: PlanetOptions): World {
  return SCENARIOS[id](options);
}
