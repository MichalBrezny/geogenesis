import { createPlanet, type PlanetOptions, type PlanetState } from './core/planet';
import { surfaceTemperature } from './models/atmosphere/temperature';
import { createLinearDiffuser } from './models/geosphere/diffusion';
import { createPlateDrift } from './models/geosphere/drift';
import { flowRouting } from './models/geosphere/flowRouting';
import { createStreamPowerEroder } from './models/geosphere/streamPower';
import { generateTectonicPlanet, tectonicUplift } from './models/geosphere/tectonics';
import { createSimulation, type Simulation } from './simulation';

export interface World {
  planet: PlanetState;
  simulation: Simulation;
}

/** Creates a random planet with the standard component pipeline. */
export function createRandomWorld(options: PlanetOptions = {}): World {
  const planet = createPlanet(options);
  generateTectonicPlanet(planet);
  const simulation = createSimulation(
    [
      createPlateDrift(),
      tectonicUplift,
      flowRouting,
      createStreamPowerEroder(),
      createLinearDiffuser(),
      surfaceTemperature,
    ],
    ['elevation', 'upliftRate', 'plateId', 'crustType'],
  );
  // Run once with dt = 0 so derived fields are valid before the first real step.
  simulation.step(planet, 0);
  return { planet, simulation };
}
