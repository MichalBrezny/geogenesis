import type { SimComponent } from './core/component';
import { createPlanet, type PlanetOptions, type PlanetState } from './core/planet';
import { createRng } from './core/rng';
import { createCarbonCycle } from './models/atmosphere/carbon';
import { createClimate } from './models/atmosphere/climate';
import { precipitationModel } from './models/atmosphere/precipitation';
import { stellarEvolution } from './models/atmosphere/star';
import { createSurfaceAlbedo } from './models/atmosphere/surfaceAlbedo';
import { biogeochemistry } from './models/atmosphere/biogeochemistry';
import { biomeModel } from './models/biosphere/biomes';
import { createLife, seedPrimordialLife } from './models/biosphere/life';
import { createLinearDiffuser } from './models/geosphere/diffusion';
import { createPlateDrift } from './models/geosphere/drift';
import { flowRouting } from './models/geosphere/flowRouting';
import { createStreamPowerEroder } from './models/geosphere/streamPower';
import { generateTectonicPlanet, tectonicUplift } from './models/geosphere/tectonics';
import { recordHistory } from './history';
import { createSimulation, withMinInterval, type Simulation } from './simulation';
import { energyIncome, STARTING_ENERGY } from './tools/tools';
import { civilizationStepYears, createCivilization } from './models/civilization/civilization';

export interface WorldOptions extends PlanetOptions {
  /**
   * Planet (and star) age at the start, in years. Defaults to 4 Gyr: microbes only,
   * so the player can watch complex life evolve while the star is Sun-like.
   */
  startYear?: number;
  /** Fraction of the surface under water; 0.7 is Earth-like. */
  oceanFraction?: number;
  /** Continental crust the planet keeps regrowing towards (see plate drift). */
  continentalFraction?: number;
}

/** Choices a planet's simulation is built with; part of the saved scenario. */
export interface RandomWorldSettings {
  continentalFraction: number;
}

export interface World {
  planet: PlanetState;
  simulation: Simulation;
  /** Simulated years the next step should cover (finer once a civilization arises). */
  stepYears: (planet: PlanetState) => number;
}

/** Step length before any civilization: the geological and evolutionary time scale. */
const GEOLOGICAL_STEP = 1e6;
/** Geology and evolution update at most this often (years) during civilizations. */
const SLOW_PROCESS_INTERVAL = 1e5;
const EVOLUTION_INTERVAL = 1e4;

/** Creates a random planet with the standard component pipeline. */
export function createRandomWorld(options: WorldOptions = {}): World {
  const planet = createPlanet(options);
  planet.globals.year = options.startYear ?? 4.0e9;
  generateTectonicPlanet(planet, { oceanFraction: options.oceanFraction ?? 0.7 });
  seedPrimordialLife(planet);
  planet.globals.atmosphere.o2 = 0;
  planet.globals.energy = STARTING_ENERGY;
  const world = randomWorldFromPlanet(planet, {
    continentalFraction: options.continentalFraction ?? 0.3,
  });
  // Run once with dt = 0 so derived fields are valid before the first real step.
  world.simulation.step(planet, 0);
  spinUpAtmosphere(planet);
  recordHistory.runOneStep(planet, 0, createRng(0));
  return world;
}

/** Builds the random-planet simulation around an existing planet (new or loaded). */
export function randomWorldFromPlanet(
  planet: PlanetState,
  settings: RandomWorldSettings = { continentalFraction: 0.3 },
): World {
  const simulation = createSimulation(
    [
      withMinInterval(
        createPlateDrift({ continentalFraction: settings.continentalFraction }),
        SLOW_PROCESS_INTERVAL,
      ),
      withMinInterval(tectonicUplift, SLOW_PROCESS_INTERVAL),
      withMinInterval(flowRouting, SLOW_PROCESS_INTERVAL),
      withMinInterval(createStreamPowerEroder(), SLOW_PROCESS_INTERVAL),
      withMinInterval(createLinearDiffuser(), SLOW_PROCESS_INTERVAL),
      stellarEvolution,
      createSurfaceAlbedo(),
      createClimate(),
      precipitationModel,
      biomeModel,
      withMinInterval(createLife(), EVOLUTION_INTERVAL),
      createCivilization(),
      biogeochemistry,
      createCarbonCycle(),
      energyIncome,
      // One sample per geological step keeps the long history readable in the charts.
      withMinInterval(recordHistory, GEOLOGICAL_STEP),
    ],
    [
      'elevation',
      'upliftRate',
      'plateId',
      'crustType',
      'daisyWhite',
      'daisyBlack',
      'biome',
      'vegetation',
    ],
  );
  return {
    planet,
    simulation,
    stepYears: (state) => civilizationStepYears(state, GEOLOGICAL_STEP),
  };
}

/**
 * Lets the atmosphere settle into balance with the new planet without advancing
 * time: alternates climate and carbon cycle with long carbon time steps, so the
 * game does not open with a planet still adjusting from an arbitrary 280 ppm.
 */
function spinUpAtmosphere(planet: PlanetState): void {
  const components: SimComponent[] = [
    createSurfaceAlbedo(),
    createClimate(),
    precipitationModel,
    biomeModel,
    createCarbonCycle(),
  ];
  const rng = createRng(planet.rngState);
  for (let iteration = 0; iteration < 10; iteration++) {
    for (const component of components) component.runOneStep(planet, 20e6, rng);
  }
}
