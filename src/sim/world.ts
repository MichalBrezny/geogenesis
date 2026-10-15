import { createPlanet, type PlanetOptions, type PlanetState } from './core/planet';
import { createClimate } from './models/atmosphere/climate';
import { precipitationModel } from './models/atmosphere/precipitation';
import { stellarEvolution } from './models/atmosphere/star';
import { createLinearDiffuser } from './models/geosphere/diffusion';
import { createPlateDrift } from './models/geosphere/drift';
import { flowRouting } from './models/geosphere/flowRouting';
import { createStreamPowerEroder } from './models/geosphere/streamPower';
import { generateTectonicPlanet, tectonicUplift } from './models/geosphere/tectonics';
import { createSimulation, type Simulation } from './simulation';

export interface WorldOptions extends PlanetOptions {
  /** Planet (and star) age at the start, in years. Defaults to an Earth-like 4.5 Gyr. */
  startYear?: number;
}

export interface World {
  planet: PlanetState;
  simulation: Simulation;
}

/** Creates a random planet with the standard component pipeline. */
export function createRandomWorld(options: WorldOptions = {}): World {
  const planet = createPlanet(options);
  planet.globals.year = options.startYear ?? 4.5e9;
  generateTectonicPlanet(planet);
  const simulation = createSimulation(
    [
      createPlateDrift(),
      tectonicUplift,
      flowRouting,
      createStreamPowerEroder(),
      createLinearDiffuser(),
      stellarEvolution,
      createClimate(),
      precipitationModel,
    ],
    ['elevation', 'upliftRate', 'plateId', 'crustType'],
  );
  // Run once with dt = 0 so derived fields are valid before the first real step.
  simulation.step(planet, 0);
  return { planet, simulation };
}
