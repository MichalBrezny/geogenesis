import type { SimComponent } from './core/component';
import { createPlanet, type PlanetOptions, type PlanetState } from './core/planet';
import { createRng } from './core/rng';
import { createCarbonCycle } from './models/atmosphere/carbon';
import { createClimate } from './models/atmosphere/climate';
import { precipitationModel } from './models/atmosphere/precipitation';
import { stellarEvolution } from './models/atmosphere/star';
import { createSurfaceAlbedo } from './models/atmosphere/surfaceAlbedo';
import { createLinearDiffuser } from './models/geosphere/diffusion';
import { createPlateDrift } from './models/geosphere/drift';
import { flowRouting } from './models/geosphere/flowRouting';
import { createStreamPowerEroder } from './models/geosphere/streamPower';
import { generateTectonicPlanet, tectonicUplift } from './models/geosphere/tectonics';
import { recordHistory } from './history';
import { createSimulation, type Simulation } from './simulation';

export interface WorldOptions extends PlanetOptions {
  /** Planet (and star) age at the start, in years. Defaults to an Earth-like 4.5 Gyr. */
  startYear?: number;
}

export interface World {
  planet: PlanetState;
  simulation: Simulation;
  /** Simulated years per step for this world. */
  yearsPerStep: number;
}

/** Creates a random planet with the standard component pipeline. */
export function createRandomWorld(options: WorldOptions = {}): World {
  const planet = createPlanet(options);
  planet.globals.year = options.startYear ?? 4.5e9;
  generateTectonicPlanet(planet);
  const surfaceAlbedo = createSurfaceAlbedo();
  const climate = createClimate();
  const carbonCycle = createCarbonCycle();
  const simulation = createSimulation(
    [
      createPlateDrift(),
      tectonicUplift,
      flowRouting,
      createStreamPowerEroder(),
      createLinearDiffuser(),
      stellarEvolution,
      surfaceAlbedo,
      climate,
      precipitationModel,
      carbonCycle,
      recordHistory,
    ],
    ['elevation', 'upliftRate', 'plateId', 'crustType', 'daisyWhite', 'daisyBlack'],
  );
  // Run once with dt = 0 so derived fields are valid before the first real step.
  simulation.step(planet, 0);
  spinUpAtmosphere(planet, [surfaceAlbedo, climate, precipitationModel, carbonCycle]);
  recordHistory.runOneStep(planet, 0, createRng(0));
  return { planet, simulation, yearsPerStep: 1e6 };
}

/**
 * Lets the atmosphere settle into balance with the new planet without advancing
 * time: alternates climate and carbon cycle with long carbon time steps, so the
 * game does not open with a planet still adjusting from an arbitrary 280 ppm.
 */
function spinUpAtmosphere(planet: PlanetState, components: readonly SimComponent[]): void {
  const rng = createRng(planet.rngState);
  for (let iteration = 0; iteration < 10; iteration++) {
    for (const component of components) component.runOneStep(planet, 20e6, rng);
  }
}
