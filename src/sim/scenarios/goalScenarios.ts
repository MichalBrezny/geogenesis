import { updateSurfacePressure } from '../models/atmosphere/atmosphere';
import { createRng } from '../core/rng';
import type { PlanetOptions, PlanetState } from '../core/planet';
import { LIFE_CLASSES, lifeClassIndex } from '../data/lifeClasses';
import { createGoal, type GoalId } from '../goals/goals';
import { classSuitability, createLife } from '../models/biosphere/life';
import {
  createRandomWorld,
  randomWorldFromPlanet,
  type RandomWorldSettings,
  type World,
} from '../world';

const BRIGHTENING_START_YEAR = 6.6e9;
const BRIGHTENING_SPINUP_YEAR = 6.2e9;
const BRIGHTENING_STEP_YEARS = 500e3;
const SEEDED_POPULATION = 0.6;

/** Earth-like world just before the Sun's natural late brightening becomes dangerous. */
export function createBrighteningSun(options: PlanetOptions): World {
  // At 6.6 Gyr a from-scratch fixed-point solve is already on the hot branch. Start
  // from the last stable spun-up atmosphere, then age it without an artificial
  // 400 Myr component interval; the unassisted world naturally tips near 7 Gyr.
  const base = createRandomWorld({
    ...options,
    start: 'quick',
    startYear: BRIGHTENING_SPINUP_YEAR,
  });
  const { planet } = base;
  planet.globals.year = BRIGHTENING_START_YEAR;
  for (const component of Object.keys(planet.lastRunYear)) {
    planet.lastRunYear[component] = BRIGHTENING_START_YEAR;
  }
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

/** Seeds every class through mammals into habitat it can currently occupy. */
function seedEstablishedComplexLife(planet: PlanetState): void {
  planet.globals.atmosphere.o2 = 0.21;
  updateSurfacePressure(planet.globals);
  planet.fields.oceanOxygen.fill(1);
  const lastClass = lifeClassIndex('mammals');
  const n = planet.grid.cellCount;
  for (let c = 0; c <= lastClass; c++) {
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
  planet.fields.civilization.fill(0);
  createLife().runOneStep(planet, 0, createRng(planet.rngState));
  planet.biota.ecology.adaptedTemperature = planet.globals.meanTemperature;
  planet.biota.ecology.previousTemperature = planet.globals.meanTemperature;
}
