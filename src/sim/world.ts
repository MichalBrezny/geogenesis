import type { SimComponent } from './core/component';
import {
  createPlanet,
  type PlanetOptions,
  type PlanetParameters,
  type PlanetState,
} from './core/planet';
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
import { co2FrostCycle } from './models/atmosphere/co2Frost';
import { landIceMassBalance } from './models/atmosphere/ice';
import { atmosphericWaterCycle } from './models/atmosphere/water';
import { dustModel } from './models/atmosphere/dust';
import { oceanChemistry } from './models/atmosphere/oceanChemistry';
import { clathrateModel } from './models/atmosphere/clathrates';
import { biomeModel } from './models/biosphere/biomes';
import { createLife, seedPrimordialLife } from './models/biosphere/life';
import { createLinearDiffuser } from './models/geosphere/diffusion';
import { continentalCrustTarget, createPlateDrift } from './models/geosphere/drift';
import { flowRouting } from './models/geosphere/flowRouting';
import { impactModel } from './models/geosphere/impacts';
import {
  equilibriumSeaLevel,
  initializeWaterInventory,
  seaLevelDatumModel,
  seaLevelModel,
} from './models/geosphere/seaLevel';
import { createStreamPowerEroder } from './models/geosphere/streamPower';
import { generateTectonicPlanet, tectonicUplift } from './models/geosphere/tectonics';
import { eruptionModel, volcanicActivityModel } from './models/geosphere/volcanism';
import { recordHistory } from './history';
import { createSimulation, withMinInterval, type Simulation } from './simulation';
import { energyIncome, STARTING_ENERGY } from './tools/tools';
import { createCivilization } from './models/civilization/civilization';
import { eraStepYears, eraTracker, planetEra, type Era } from './eras';
import { atmosphericEscape, planetaryEvolution } from './models/planetary';
import { updateSurfacePressure } from './models/atmosphere/atmosphere';
import { starProperties } from './models/atmosphere/star';
import { goalTracker } from './goals/goals';
import { terraformDevices } from './tools/devices';
import { disasterModel } from './models/disasters';

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
export type PlanetPreset = 'mars' | 'venus';

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
  if (
    options.planetParams?.tidallyLocked === undefined &&
    planet.planetParams.starType === 'M' &&
    planet.planetParams.orbitalDistanceAu <= 0.2
  ) {
    planet.planetParams.tidallyLocked = true;
    if (options.planetParams?.rotationPeriodHours === undefined) {
      const orbitalDays =
        365.25 *
        Math.sqrt(
          planet.planetParams.orbitalDistanceAu ** 3 /
            starProperties(planet.planetParams.starType).mass,
        );
      planet.planetParams.rotationPeriodHours = orbitalDays * 24;
    }
  }
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
  initializeWaterInventory(planet);
  if (options.planetParams?.initialWaterGel !== undefined) {
    planet.globals.water = Math.max(0, options.planetParams.initialWaterGel);
    planet.globals.initialWater = planet.globals.water;
    planet.globals.escapedWater = 0;
  } else {
    planet.planetParams.initialWaterGel = planet.globals.initialWater;
  }
  if (start !== 'young') seedPrimordialLife(planet);
  planet.globals.atmosphere.o2 = 0;
  planet.globals.energy = STARTING_ENERGY;
  const world = randomWorldFromPlanet(planet, {
    continentalFraction,
    start,
  });
  // Run once with dt = 0 so derived fields are valid before the first real step.
  world.simulation.step(planet, 0);
  const carbonInventory = planet.globals.crustalCarbon + planet.globals.atmosphere.co2 * 1e-6;
  // An explicitly requested CO2 inventory is an upper bound for the spin-up: a cold
  // planet without a working weathering sink has no balance to settle into and would
  // otherwise open at the wet guardrail instead of with the atmosphere it was given.
  spinUpAtmosphere(planet, options.planetParams?.initialCo2Microbar);
  // The spin-up does not advance time: whatever CO2 it settled on came from (or went
  // back to) the crust, so the planet's total carbon is unchanged.
  planet.globals.crustalCarbon = Math.max(
    0,
    carbonInventory - planet.globals.atmosphere.co2 * 1e-6,
  );
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
      planetaryEvolution,
      impactModel,
      withMinInterval(
        createPlateDrift({ continentalFraction: settings.continentalFraction }),
        SLOW_PROCESS_INTERVAL,
      ),
      withMinInterval(tectonicUplift, SLOW_PROCESS_INTERVAL),
      withMinInterval(volcanicActivityModel, SLOW_PROCESS_INTERVAL),
      eruptionModel,
      disasterModel,
      dustModel,
      withMinInterval(flowRouting, SLOW_PROCESS_INTERVAL),
      withMinInterval(createStreamPowerEroder(), SLOW_PROCESS_INTERVAL),
      withMinInterval(createLinearDiffuser(), SLOW_PROCESS_INTERVAL),
      withMinInterval(seaLevelDatumModel, SLOW_PROCESS_INTERVAL),
      stellarEvolution,
      createSurfaceAlbedo(),
      createClimate(),
      circulationModel,
      oceanModel,
      precipitationModel,
      cloudModel,
      landIceMassBalance,
      atmosphericWaterCycle,
      atmosphericEscape,
      seaLevelModel,
      biomeModel,
      oceanChemistry,
      withMinInterval(
        createLife({
          // The Quick start keeps the pre-M11 pace of the first microbial and complex steps.
          evolutionTimeFactors:
            settings.start === 'quick' ? { eukaryotes: 30, plants: 60, radiates: 40 } : {},
        }),
        EVOLUTION_INTERVAL,
      ),
      createCivilization(),
      terraformDevices,
      clathrateModel,
      biogeochemistry,
      createCarbonCycle(),
      co2FrostCycle,
      energyIncome,
      // One sample per million years keeps the long history readable in the charts.
      withMinInterval(recordHistory, HISTORY_INTERVAL),
      eraTracker,
      ...(planet.goal ? [goalTracker] : []),
    ],
    [
      // Geology runs first and uses the last step's climate; the climate the last
      // step's ocean.
      'airTemperature',
      'seasonalAmplitude',
      'iceCover',
      'co2Ice',
      'iceThickness',
      'lowCloud',
      'precipitation',
      'oceanAnomaly',
      'windU',
      'windV',
      'elevation',
      'upliftRate',
      'plateId',
      'crustType',
      'daisyWhite',
      'daisyBlack',
      'biome',
      'vegetation',
      'civilization',
    ],
  );
  // Goal scenarios can establish a civilization before rebuilding this pipeline;
  // derive their hazard layer immediately without advancing time or sampling events.
  disasterModel.runOneStep(planet, 0, createRng(0));
  return {
    planet,
    simulation,
    stepYears: eraStepYears,
    era: planetEra,
    settings,
  };
}

/** Present-day calibrated Mars and Venus scenario worlds. */
export function createPlanetPreset(preset: PlanetPreset, options: PlanetOptions = {}): World {
  const definition = PRESET_DEFINITIONS[preset];
  const planet = createPlanet({ ...options, planetParams: definition.planetParams });
  planet.globals.year = 4.5e9;
  planet.controls.obliquity = definition.obliquity;
  planet.globals.atmosphere = { ...definition.atmosphere };
  planet.globals.co2Ice = definition.co2IceBar;
  planet.globals.crustalCarbon = Math.max(0, planet.globals.crustalCarbon - definition.co2IceBar);
  planet.globals.tectonicRegime = 'stagnant';
  planet.globals.magneticField = 0;
  planet.geosphere.fixedObliquity = true;
  planet.globals.energy = STARTING_ENERGY;
  generateTectonicPlanet(planet, { oceanFraction: definition.oceanFraction });
  initializeWaterInventory(planet);
  planet.globals.water = definition.planetParams.initialWaterGel!;
  planet.globals.initialWater = definition.planetParams.initialWaterGel!;
  planet.globals.escapedWater = 0;
  updateSurfacePressure(planet.globals);
  // Re-reference the terrain to the small inventory's datum and open with its
  // basin-filling sea; the dt = 0 step below does not move the sea level, so the
  // Earth-sized sea of the generated terrain would otherwise flood the first frame.
  seaLevelDatumModel.runOneStep(planet, 0, createRng(0));
  planet.globals.seaLevel = equilibriumSeaLevel(planet);
  const world = randomWorldFromPlanet(planet, { continentalFraction: 0.3, start: 'quick' });
  world.simulation.step(planet, 0);
  recordHistory.runOneStep(planet, 0, createRng(0));
  return world;
}

const PRESET_DEFINITIONS: Readonly<
  Record<
    PlanetPreset,
    {
      planetParams: Partial<PlanetParameters>;
      atmosphere: PlanetState['globals']['atmosphere'];
      obliquity: number;
      oceanFraction: number;
      co2IceBar: number;
    }
  >
> = {
  mars: {
    planetParams: {
      radius: 3_390_000,
      surfaceGravity: 3.71,
      orbitalDistanceAu: 1.524,
      rotationPeriodHours: 24.6,
      hasMoon: false,
      initialWaterGel: 0.1,
      initialN2Bar: 0.00008,
      initialCo2Microbar: 5900,
      // Accessible carbon left in the crust after ~4 Gyr of loss to space and burial:
      // a few tens of mbar (orbital carbonate detections are ≲ 0.01–0.25 bar;
      // Edwards & Ehlmann 2015), so the nearly extinct volcanism adds ~3 mbar/Gyr.
      crustalCarbonBar: 0.0059 + 0.05,
      tectonicRegime: 'stagnant',
      dynamoStrength: 0,
    },
    atmosphere: { n2: 0.00008, inert: 0.00002, co2: 5900, ch4: 0, o2: 0, waterVapor: 0 },
    obliquity: 25,
    oceanFraction: 0.65,
    co2IceBar: 0.0059,
  },
  venus: {
    planetParams: {
      radius: 6_052_000,
      surfaceGravity: 8.87,
      orbitalDistanceAu: 0.723,
      rotationPeriodHours: -5832,
      hasMoon: false,
      initialWaterGel: 0,
      initialN2Bar: 3,
      initialCo2Microbar: 90e6,
      crustalCarbonBar: 90,
      tectonicRegime: 'stagnant',
      dynamoStrength: 0,
    },
    atmosphere: { n2: 3, inert: 0, co2: 90e6, ch4: 0, o2: 0, waterVapor: 0 },
    obliquity: 3,
    oceanFraction: 0.7,
    co2IceBar: 0,
  },
};

/**
 * Lets the atmosphere settle into balance with the new planet without advancing
 * time: alternates climate and carbon cycle with long carbon time steps, so the
 * game does not open with a planet still adjusting from an arbitrary 280 ppm.
 */
function spinUpAtmosphere(planet: PlanetState, maxCo2?: number): void {
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
    createCarbonCycle({ maxCo2 }),
  ];
  const rng = createRng(planet.rngState);
  const { globals } = planet;
  const eventCount = planet.events.length;
  // A snowball first guess has no weathering, so an undamped solve swings to
  // the guardrail and back (snowball → steam) and used to strand young planets
  // in a runaway. Such planets damp their CO2 updates in log space; planets
  // that open mostly ice-free keep the undamped iteration unchanged.
  const damped = globals.iceFraction > 0.5;
  for (let iteration = 0; iteration < 20; iteration++) {
    // A transient overshoot of this fixed-point iteration must not latch the
    // runaway greenhouse; only a planet that ends the spin-up in one keeps it.
    globals.runawayGreenhouse = false;
    const before = globals.atmosphere.co2;
    for (const component of components) component.runOneStep(planet, 20e6, rng);
    if (damped && before > 0 && globals.atmosphere.co2 > 0) {
      globals.atmosphere.co2 = Math.sqrt(before * globals.atmosphere.co2);
      updateSurfacePressure(globals);
    }
  }
  globals.runawayGreenhouse = false;
  planet.events.splice(eventCount);
  // The last carbon solve changes CO2 after the last climate pass. Refresh the
  // diagnostic atmosphere at zero elapsed time so the opening temperature and
  // clouds describe that final reservoir rather than the previous iteration.
  for (const component of components.slice(0, -1)) component.runOneStep(planet, 0, rng);
}
