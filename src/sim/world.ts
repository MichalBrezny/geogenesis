import type { SimComponent } from './core/component';
import { createPlanet, type PlanetOptions, type PlanetState } from './core/planet';
import { createRng, type Rng } from './core/rng';
import { createCarbonCycle } from './models/atmosphere/carbon';
import { createClimate } from './models/atmosphere/climate';
import { circulationModel } from './models/atmosphere/circulation';
import { oceanModel } from './models/atmosphere/ocean';
import { precipitationModel } from './models/atmosphere/precipitation';
import { stellarEvolution } from './models/atmosphere/star';
import { createSurfaceAlbedo } from './models/atmosphere/surfaceAlbedo';
import { biogeochemistry } from './models/atmosphere/biogeochemistry';
import { cloudModel } from './models/atmosphere/clouds';
import { landIceMassBalance } from './models/atmosphere/ice';
import { biomeModel } from './models/biosphere/biomes';
import { createLife, seedPrimordialLife } from './models/biosphere/life';
import { createLinearDiffuser } from './models/geosphere/diffusion';
import { continentalCrustTarget, createPlateDrift } from './models/geosphere/drift';
import { flowRouting } from './models/geosphere/flowRouting';
import { impactModel } from './models/geosphere/impacts';
import { seaLevelModel } from './models/geosphere/seaLevel';
import { createStreamPowerEroder } from './models/geosphere/streamPower';
import { generateTectonicPlanet, tectonicUplift } from './models/geosphere/tectonics';
import { eruptionModel, volcanicActivityModel } from './models/geosphere/volcanism';
import { recordHistory } from './history';
import { createSimulation, withMinInterval, type Simulation } from './simulation';
import { energyIncome, STARTING_ENERGY } from './tools/tools';
import { createCivilization } from './models/civilization/civilization';
import { eraStepYears, eraTracker, planetEra, type Era } from './eras';

export interface WorldOptions extends PlanetOptions {
  /** Preset age and biosphere for a new random planet. Defaults to `young`. */
  start?: PlanetStart;
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
  start: PlanetStart;
}

export const PLANET_STARTS = ['young', 'microbial', 'quick'] as const;
export type PlanetStart = (typeof PLANET_STARTS)[number];

/** The young start is 0.5 Gyr: after ocean formation but during declining bombardment. */
export const PLANET_START_AGES: Readonly<Record<PlanetStart, number>> = {
  young: 0.5e9,
  microbial: 2e9,
  quick: 4e9,
};

export interface World {
  planet: PlanetState;
  simulation: Simulation;
  /** Simulated years the next step should cover (set by the planet's era). */
  stepYears: (planet: PlanetState) => number;
  /** The planet's era, or null for scenarios without eras (Daisyworld). */
  era: (planet: PlanetState) => Era | null;
  /** Plain scenario choices needed to rebuild this simulation after loading. */
  settings?: RandomWorldSettings;
}

/** Geology and evolution update at most this often (years) during civilizations. */
const SLOW_PROCESS_INTERVAL = 1e5;
const EVOLUTION_INTERVAL = 1e4;
/** Years between history samples. */
const HISTORY_INTERVAL = 1e6;

/** Creates a random planet with the standard component pipeline. */
export function createRandomWorld(options: WorldOptions = {}): World {
  const planet = createPlanet(options);
  // Explicit startYear is retained for tests/custom callers and keeps the former
  // seeded behaviour unless they also choose a start preset.
  const start = options.start ?? (options.startYear === undefined ? 'young' : 'quick');
  const parameterRng = createRng(planet.rngState);
  planet.controls.obliquity = randomObliquity(parameterRng);
  planet.rngState = parameterRng.state;
  planet.globals.year = options.startYear ?? PLANET_START_AGES[start];
  const continentalFraction = options.continentalFraction ?? 0.3;
  generateTectonicPlanet(planet, {
    oceanFraction:
      options.oceanFraction ?? 1 - continentalCrustTarget(planet.globals.year, continentalFraction),
  });
  if (start !== 'young') seedPrimordialLife(planet);
  planet.globals.atmosphere.o2 = 0;
  planet.globals.energy = STARTING_ENERGY;
  const world = randomWorldFromPlanet(planet, {
    continentalFraction,
    start,
  });
  // Run once with dt = 0 so derived fields are valid before the first real step.
  world.simulation.step(planet, 0);
  spinUpAtmosphere(planet);
  recordHistory.runOneStep(planet, 0, createRng(0));
  return world;
}

/** Triangular 15–35° distribution, with Earth-like tilts the most likely. */
function randomObliquity(rng: Rng): number {
  const minimum = 15;
  const maximum = 35;
  const mode = 23.44;
  const u = rng.next();
  const split = (mode - minimum) / (maximum - minimum);
  return u < split
    ? minimum + Math.sqrt(u * (maximum - minimum) * (mode - minimum))
    : maximum - Math.sqrt((1 - u) * (maximum - minimum) * (maximum - mode));
}

/** Builds the random-planet simulation around an existing planet (new or loaded). */
export function randomWorldFromPlanet(
  planet: PlanetState,
  settings: RandomWorldSettings = { continentalFraction: 0.3, start: 'quick' },
): World {
  const simulation = createSimulation(
    [
      impactModel,
      withMinInterval(
        createPlateDrift({ continentalFraction: settings.continentalFraction }),
        SLOW_PROCESS_INTERVAL,
      ),
      withMinInterval(tectonicUplift, SLOW_PROCESS_INTERVAL),
      withMinInterval(volcanicActivityModel, SLOW_PROCESS_INTERVAL),
      eruptionModel,
      withMinInterval(flowRouting, SLOW_PROCESS_INTERVAL),
      withMinInterval(createStreamPowerEroder(), SLOW_PROCESS_INTERVAL),
      withMinInterval(createLinearDiffuser(), SLOW_PROCESS_INTERVAL),
      stellarEvolution,
      createSurfaceAlbedo(),
      createClimate(),
      circulationModel,
      oceanModel,
      precipitationModel,
      cloudModel,
      landIceMassBalance,
      seaLevelModel,
      biomeModel,
      withMinInterval(
        createLife({
          // The Quick start keeps the pre-M11 pace of the first microbial and complex steps.
          evolutionTimeFactors:
            settings.start === 'quick' ? { eukaryotes: 30, plants: 60, radiates: 40 } : {},
        }),
        EVOLUTION_INTERVAL,
      ),
      createCivilization(),
      biogeochemistry,
      createCarbonCycle(),
      energyIncome,
      // One sample per million years keeps the long history readable in the charts.
      withMinInterval(recordHistory, HISTORY_INTERVAL),
      eraTracker,
    ],
    [
      // Geology runs first and uses the last step's climate; the climate the last
      // step's ocean.
      'airTemperature',
      'seasonalAmplitude',
      'iceCover',
      'iceThickness',
      'lowCloud',
      'precipitation',
      'oceanAnomaly',
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
    stepYears: eraStepYears,
    era: planetEra,
    settings,
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
    circulationModel,
    oceanModel,
    precipitationModel,
    cloudModel,
    landIceMassBalance,
    seaLevelModel,
    biomeModel,
    createCarbonCycle(),
  ];
  const rng = createRng(planet.rngState);
  for (let iteration = 0; iteration < 10; iteration++) {
    for (const component of components) component.runOneStep(planet, 20e6, rng);
  }
}
