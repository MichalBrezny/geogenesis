import { createPlanet, type PlanetOptions, type PlanetState } from './core/planet';
import { surfaceTemperature } from './models/atmosphere/temperature';
import { generateTerrain } from './models/geosphere/terrain';
import { createSimulation, type Simulation } from './simulation';

export interface World {
  planet: PlanetState;
  simulation: Simulation;
}

/** Creates a random planet with the standard component pipeline. */
export function createRandomWorld(options: PlanetOptions = {}): World {
  const planet = createPlanet(options);
  generateTerrain(planet);
  const simulation = createSimulation([surfaceTemperature], ['elevation']);
  // Run once with dt = 0 so derived fields are valid before the first real step.
  simulation.step(planet, 0);
  return { planet, simulation };
}
