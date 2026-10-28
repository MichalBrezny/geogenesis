import { updateSurfacePressure } from '../models/atmosphere/atmosphere';
import { getTopology } from '../core/grid';
import { createRng } from '../core/rng';
import type { PlanetOptions, PlanetState } from '../core/planet';
import { LIFE_CLASSES, lifeClassIndex, type LifeClassKey } from '../data/lifeClasses';
import { createGoal, type GoalId } from '../goals/goals';
import { classSuitability, createLife } from '../models/biosphere/life';
import { makeSentient } from '../models/civilization/civilization';
import { isOcean } from '../models/geosphere/seaLevel';
import {
  createPlanetPreset,
  createRandomWorld,
  randomWorldFromPlanet,
  type RandomWorldSettings,
  type World,
} from '../world';

const BRIGHTENING_START_YEAR = 5.6e9;
const BRIGHTENING_STEP_YEARS = 500e3;
const SEEDED_POPULATION = 0.6;
const MODERN_OXYGEN = 0.21;
/** Ω a terraforming project starts with: a first handful of devices. */
const TERRAFORM_ENERGY = 1800;
/** Planet age of the Cambrian start: Earth's Cambrian began 539 Myr before 4.54 Gyr. */
const CAMBRIAN_YEAR = 4.0e9;
/** Oxygen (volume fraction) of the early Cambrian air, about two thirds of today's. */
const CAMBRIAN_OXYGEN = 0.15;
/** Island sizes (m²) the stone-age people may start on: from Britain to Greenland. */
const ISLAND_MIN_AREA = 2e11;
const ISLAND_MAX_AREA = 2.5e12;
/** Geological steps that let a new world's climate settle before life is placed. */
const SETTLING_STEPS = 4;
const SETTLING_STEP_YEARS = 500e3;
const CAMBRIAN_FOSSIL_CARBON = 1_500;
const STONE_AGE_FOSSIL_CARBON = 8_000;

/**
 * Earth-like world on a brightening Sun. At 5.6 Gyr weathering has already drawn
 * CO₂ down to ~130 ppm; over the next billion years land life thins out as CO₂
 * approaches the C4 starvation floor, and the unassisted world tips into a runaway
 * greenhouse near 7 Gyr.
 */
export function createBrighteningSun(options: PlanetOptions): World {
  const base = createRandomWorld({
    ...options,
    start: 'quick',
    startYear: BRIGHTENING_START_YEAR,
  });
  const { planet } = base;
  seedEstablishedComplexLife(planet);
  planet.goal = createGoal('brighteningSun', planet.globals.year);
  return brighteningWorld(randomWorldFromPlanet(planet, base.settings));
}

/** A deliberately frozen Earth-like world; unlike normal starts it is not atmosphere-spun up. */
export function createSnowball(options: PlanetOptions): World {
  const base = createRandomWorld({
    ...options,
    start: 'quick',
    planetParams: { ...options.planetParams, initialCo2Microbar: 10 },
  });
  const { planet } = base;
  planet.globals.atmosphere.co2 = 10;
  planet.globals.atmosphere.waterVapor = 0;
  updateSurfacePressure(planet.globals);
  // With no accessible natural carbon this ice-albedo state remains frozen; the
  // player's CO2 and volcano tools can still add atmospheric carbon directly.
  planet.globals.crustalCarbon = 0;
  planet.globals.meanTemperature = -45;
  planet.globals.iceFraction = 1;
  planet.fields.airTemperature.fill(-45);
  planet.fields.iceCover.fill(1);
  // A kilometre-class sheet makes the opening state physically and visually frozen;
  // the ordinary ice/water models take over from the first real step.
  planet.fields.iceThickness.fill(1000);
  planet.goal = createGoal('snowball', planet.globals.year);
  return randomWorldFromPlanet(planet, base.settings);
}

/** Quick-start planet whose objective is the first sentient species. */
export function createCradle(options: PlanetOptions): World {
  const base = createRandomWorld({ ...options, start: 'quick' });
  base.planet.goal = createGoal('cradle', base.planet.globals.year);
  return randomWorldFromPlanet(base.planet, base.settings);
}

/** Present-day Mars to be made warm, wet and green with devices and ice meteors. */
export function createTerraformMars(options: PlanetOptions): World {
  return terraformWorld(createPlanetPreset('mars', options), 'terraformMars');
}

function terraformWorld(world: World, id: GoalId): World {
  const { planet } = world;
  planet.globals.energy = TERRAFORM_ENERGY;
  planet.goal = createGoal(id, planet.globals.year);
  return randomWorldFromPlanet(planet, world.settings);
}

/** Mammals become sentient on one island of a living planet and must reach Exodus. */
export function createStoneAge(options: PlanetOptions): World {
  const base = settleClimate(createRandomWorld({ ...options, start: 'quick' }), MODERN_OXYGEN);
  const { planet } = base;
  seedEstablishedComplexLife(planet);
  const mammals = lifeClassIndex('mammals');
  const home = islandHome(planet, mammals);
  makeSentient(planet, mammals, home);
  planet.globals.fossilCarbon = STONE_AGE_FOSSIL_CARBON;
  // A band of neighbouring settlements rather than one cell, so the first people do
  // not fall below the collapse threshold on fine grids, where cells are small.
  const { neighbors } = getTopology(planet.grid);
  const n = planet.grid.cellCount;
  for (let d = 0; d < 8; d++) {
    const j = neighbors[home * 8 + d]!;
    if (j >= 0 && planet.biota.populations[mammals * n + j]! > 0) {
      planet.fields.civilization[j] = planet.fields.civilization[home]!;
    }
  }
  planet.goal = createGoal('exodus', planet.globals.year);
  return randomWorldFromPlanet(planet, base.settings);
}

/**
 * Earth at the start of the Cambrian: oxygen has risen, the seas hold the first
 * animals and the land is still bare. A sandbox without a goal.
 */
export function createCambrian(options: PlanetOptions): World {
  const base = settleClimate(
    createRandomWorld({ ...options, start: 'quick', startYear: CAMBRIAN_YEAR }),
    CAMBRIAN_OXYGEN,
  );
  seedEstablishedComplexLife(base.planet, 'trichordates', {
    oxygen: CAMBRIAN_OXYGEN,
    exclude: ['plants'],
  });
  base.planet.globals.fossilCarbon = CAMBRIAN_FOSSIL_CARBON;
  return randomWorldFromPlanet(base.planet, base.settings);
}

/**
 * Oxygenates a freshly spun-up world and runs it for a few geological steps, so the
 * methane loss and the regional climate, ice and biomes have settled before life is
 * placed on it; otherwise the first short steps would bring a sudden ice age.
 */
function settleClimate(world: World, oxygen: number): World {
  world.planet.globals.atmosphere.o2 = oxygen;
  updateSurfacePressure(world.planet.globals);
  for (let k = 0; k < SETTLING_STEPS; k++) {
    world.simulation.step(world.planet, SETTLING_STEP_YEARS);
  }
  return world;
}

/**
 * Home cell of the first people: the most populated cell of a mid-sized island, so
 * they must learn to sail before they can spread. Falls back to any inhabited
 * landmass when the planet has no island of that size.
 */
function islandHome(planet: PlanetState, species: number): number {
  const { grid, fields, globals, biota } = planet;
  const n = grid.cellCount;
  const { neighbors } = getTopology(grid);
  const land = (i: number) => !isOcean(fields.elevation[i]!, globals.seaLevel);
  const visited = new Uint8Array(n);
  const islands: { area: number; best: number; population: number }[] = [];
  for (let start = 0; start < n; start++) {
    if (visited[start] || !land(start)) continue;
    const island = { area: 0, best: -1, population: 0 };
    const stack = [start];
    visited[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      island.area += grid.rowCellArea[Math.floor(i / grid.width)]!;
      const population = biota.populations[species * n + i]!;
      if (population > island.population) {
        island.population = population;
        island.best = i;
      }
      for (let d = 0; d < 8; d++) {
        const j = neighbors[i * 8 + d]!;
        if (j < 0 || visited[j] || !land(j)) continue;
        visited[j] = 1;
        stack.push(j);
      }
    }
    if (island.best >= 0) islands.push(island);
  }
  const sized = islands.filter(
    (island) => island.area >= ISLAND_MIN_AREA && island.area <= ISLAND_MAX_AREA,
  );
  const pool = sized.length > 0 ? sized : islands;
  if (pool.length === 0) return 0;
  return pool.reduce((best, island) => (island.population > best.population ? island : best)).best;
}

export function restoreGoalScenario(
  id: GoalId,
  planet: PlanetState,
  settings?: RandomWorldSettings,
): World {
  planet.goal ??= createGoal(id, planet.globals.year);
  const world = randomWorldFromPlanet(planet, settings);
  return id === 'brighteningSun' ? brighteningWorld(world) : world;
}

function brighteningWorld(world: World): World {
  return {
    ...world,
    // Keep this geological survival scenario moving after sentience; otherwise the
    // standard civilization era would turn a billion years into millions of clicks.
    stepYears: () => BRIGHTENING_STEP_YEARS,
    era: () => 'evolution',
  };
}

/** Seeds every class up to `last` (except `exclude`) into habitat it can currently occupy. */
function seedEstablishedComplexLife(
  planet: PlanetState,
  last: LifeClassKey = 'mammals',
  options: { oxygen?: number; exclude?: readonly LifeClassKey[] } = {},
): void {
  planet.globals.atmosphere.o2 = options.oxygen ?? MODERN_OXYGEN;
  updateSurfacePressure(planet.globals);
  // Established life is adapted to the present climate; otherwise the climate-change
  // stress would read the whole spin-up as a sudden shift.
  planet.biota.ecology.adaptedTemperature = planet.globals.meanTemperature;
  planet.biota.ecology.previousTemperature = planet.globals.meanTemperature;
  planet.fields.oceanOxygen.fill(1);
  const lastClass = lifeClassIndex(last);
  const excluded = new Set((options.exclude ?? []).map(lifeClassIndex));
  const n = planet.grid.cellCount;
  for (let c = 0; c <= lastClass; c++) {
    if (excluded.has(c)) {
      planet.biota.appeared[c] = null;
      planet.biota.populations.fill(0, c * n, (c + 1) * n);
      continue;
    }
    const suitability = classSuitability(planet, c);
    for (let i = 0; i < n; i++) {
      if (suitability[i]! > 0.01) {
        planet.biota.populations[c * n + i] = suitability[i]! * SEEDED_POPULATION;
      }
    }
    planet.biota.appeared[c] = planet.globals.year - (lastClass - c + 1) * 10e6;
  }
  for (let c = lastClass + 1; c < LIFE_CLASSES.length; c++) {
    planet.biota.appeared[c] = null;
    planet.biota.populations.fill(0, c * n, (c + 1) * n);
  }
  planet.civilization.species = null;
  planet.civilization.age = 0;
  planet.civilization.progress = 0;
  planet.civilization.population = 0;
  planet.civilization.sentientSince = null;
  planet.civilization.exodusYear = null;
  planet.civilization.energySupply = 1;
  planet.civilization.fossilSupply = 1;
  planet.fields.civilization.fill(0);
  createLife().runOneStep(planet, 0, createRng(planet.rngState));
}
