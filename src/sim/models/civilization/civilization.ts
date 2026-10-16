import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT, type Grid } from '../../core/grid';
import type { PlanetState } from '../../core/planet';
import type { Rng } from '../../core/rng';
import type { Biome } from '../../data/biomes';
import { PEOPLE_PER_KM2, SENTIENCE_POTENTIAL, TECH_AGES } from '../../data/civilization';
import { LIFE_CLASSES, lifeClassIndex, PLANT_PRODUCTIVITY } from '../../data/lifeClasses';
import { recordEvent } from '../../events';
import { classSuitability } from '../biosphere/life';
import { SEA_LEVEL } from '../geosphere/flowRouting';

export interface CivilizationOptions {
  /** Mean years for a fully established, most capable class to become sentient. */
  sentienceTime?: number;
}

/**
 * A class must fill this share of its habitat (land or ocean) before it can
 * become sentient; at the full share its chance stops growing.
 */
const MIN_HABITAT_SHARE = 0.05;
const FULL_HABITAT_SHARE = 0.3;
/** Settled density below which a cell counts as empty. */
const MIN_DENSITY = 1e-6;
/** Yearly chance of a plague once cities exist (from the Bronze Age). */
const PLAGUE_RATE = 2e-4;
/** World population (billions) below which a civilization is gone. */
const COLLAPSE_POPULATION = 1e-5;
/** How far (cells, straight lines) a seafaring civilization can settle across water. */
const SEA_CROSSING = 3;

/**
 * Sentience and civilization.
 *
 * Before any species is sentient, established animal classes have a small
 * chance to become sentient, weighted by their potential (mammals and birds
 * most, but even mollusks can). The civilization then grows where its species
 * can live and its food allows — farming and industry raise how much of the
 * land's production it can use — spreads to neighbouring cells (and over
 * narrow seas once seafaring), clears vegetation, and advances through the tech
 * ages. Industry burns fossil fuels, warming the planet; plagues and nuclear
 * wars set it back; finishing the Nanotech age means Exodus: the civilization
 * leaves the planet.
 */
export function createCivilization(options: CivilizationOptions = {}): SimComponent {
  const sentienceTime = options.sentienceTime ?? 200e6;
  return {
    name: 'civilization',
    inputs: ['elevation', 'biome', 'vegetation'],
    outputs: ['civilization', 'vegetation'],
    runOneStep(state, dtYears, rng) {
      const civ = state.civilization;
      if (civ.species === null) {
        state.fields.civilization.fill(0);
        if (dtYears > 0) maybeBecomeSentient(state, dtYears, sentienceTime, rng);
        return;
      }
      if (state.biota.cover[civ.species] === 0) {
        endCivilization(state, 'civilizationCollapsed');
        return;
      }
      if (dtYears <= 0) return;
      const capacity = carryingCapacity(state, civ.species);
      settle(state, capacity, dtYears);
      clearLand(state, capacity);
      civ.population = worldPopulation(state);
      if (civ.population < COLLAPSE_POPULATION) {
        endCivilization(state, 'civilizationCollapsed');
        return;
      }
      const age = TECH_AGES[civ.age]!;
      state.globals.atmosphere.co2 += age.emissions * civ.population * dtYears;
      catastrophes(state, dtYears, rng);
      advanceTechnology(state, dtYears);
    },
  };
}

function maybeBecomeSentient(state: PlanetState, dtYears: number, sentienceTime: number, rng: Rng) {
  const cover = state.biota.cover;
  const land = landFraction(state);
  const candidates = LIFE_CLASSES.map((lifeClass, c) => {
    const potential = SENTIENCE_POTENTIAL[lifeClass.key] ?? 0;
    // Judge land and sea animals by how much of their own habitat they fill.
    const habitat = lifeClass.habitat === 'land' ? land : 1 - land;
    const share = habitat > 0 ? cover[c]! / habitat : 0;
    if (share < MIN_HABITAT_SHARE) return 0;
    return potential * Math.min(1, share / FULL_HABITAT_SHARE);
  });
  const total = candidates.reduce((sum, w) => sum + w, 0);
  if (total === 0 || rng.next() >= 1 - Math.exp(-(dtYears * total) / sentienceTime)) return;

  let pick = rng.next() * total;
  const species = candidates.findIndex((weight) => (pick -= weight) < 0);
  // The first band appears where the species is most numerous.
  const n = state.grid.cellCount;
  let home = 0;
  for (let i = 1; i < n; i++) {
    if (state.biota.populations[species * n + i]! > state.biota.populations[species * n + home]!) {
      home = i;
    }
  }
  makeSentient(state, species, home);
}

/** Makes a life class sentient, with its first band in cell `home`. */
export function makeSentient(state: PlanetState, species: number, home: number): void {
  const civ = state.civilization;
  civ.species = species;
  civ.age = 0;
  civ.progress = 0;
  civ.sentientSince = state.globals.year;
  state.fields.civilization.fill(0);
  state.fields.civilization[home] = TECH_AGES[0]!.foodUse * 0.5;
  civ.population = worldPopulation(state);
  recordEvent(state, 'sentience', LIFE_CLASSES[species]!.key);
}

/** Densest settlement (fraction of PEOPLE_PER_KM2) each cell can feed in the current age. */
function carryingCapacity(state: PlanetState, species: number): Float32Array {
  const { fields, biota, grid } = state;
  const n = grid.cellCount;
  const capacity = classSuitability(state, species);
  const foodUse = TECH_AGES[state.civilization.age]!.foodUse;
  const ocean = LIFE_CLASSES[species]!.habitat === 'ocean';
  const plants = lifeClassIndex('plants');
  const algae = lifeClassIndex('eukaryotes');
  for (let i = 0; i < n; i++) {
    if (capacity[i] === 0) continue;
    // Food: plant production on land, algae (the base of the food web) at sea.
    const food = ocean
      ? biota.populations[algae * n + i]!
      : PLANT_PRODUCTIVITY[fields.biome[i] as Biome] * biota.populations[plants * n + i]!;
    capacity[i] = capacity[i]! * food * foodUse;
  }
  return capacity;
}

function settle(state: PlanetState, capacity: Float32Array, dtYears: number): void {
  const { grid } = state;
  const { neighbors } = getTopology(grid);
  const density = state.fields.civilization;
  const age = TECH_AGES[state.civilization.age]!;
  const before = Float32Array.from(density);
  const growth = 1 - Math.exp(-age.growthRate * dtYears);
  for (let i = 0; i < density.length; i++) {
    let reachable = before[i]! > MIN_DENSITY;
    for (let d = 0; d < NEIGHBOR_COUNT && !reachable; d += 2) {
      const nb = neighbors[i * NEIGHBOR_COUNT + d]!;
      reachable = nb >= 0 && before[nb]! > MIN_DENSITY;
    }
    if (!reachable && age.seafaring) reachable = settledAcrossWater(grid, before, i);
    if (!reachable) continue;
    density[i] = before[i]! + (capacity[i]! - before[i]!) * growth;
    if (density[i]! < MIN_DENSITY) density[i] = 0;
  }
}

/** Whether a settled cell lies within SEA_CROSSING cells along a row or column. */
function settledAcrossWater(grid: Grid, density: Float32Array, i: number): boolean {
  const x = i % grid.width;
  const y = (i - x) / grid.width;
  for (let k = 2; k <= SEA_CROSSING; k++) {
    const candidates = [
      y * grid.width + ((x + k) % grid.width),
      y * grid.width + ((x - k + grid.width) % grid.width),
      y - k >= 0 ? i - k * grid.width : -1,
      y + k < grid.height ? i + k * grid.width : -1,
    ];
    if (candidates.some((c) => c >= 0 && density[c]! > MIN_DENSITY)) return true;
  }
  return false;
}

/** Farms and cities replace vegetation in proportion to how fully a cell is settled. */
function clearLand(state: PlanetState, capacity: Float32Array): void {
  const { fields, biota, grid } = state;
  const n = grid.cellCount;
  const plants = lifeClassIndex('plants');
  const landUse = TECH_AGES[state.civilization.age]!.landUse;
  for (let i = 0; i < n; i++) {
    if (fields.elevation[i]! < SEA_LEVEL) continue;
    const settled = capacity[i]! > 0 ? Math.min(1, fields.civilization[i]! / capacity[i]!) : 0;
    fields.vegetation[i] = biota.populations[plants * n + i]! * (1 - landUse * settled);
  }
}

function landFraction(state: PlanetState): number {
  const { grid, fields } = state;
  let land = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (fields.elevation[y * grid.width + x]! >= SEA_LEVEL) land += grid.rowAreaWeight[y]!;
    }
  }
  return land;
}

function worldPopulation(state: PlanetState): number {
  const { grid, fields } = state;
  let people = 0;
  for (let y = 0; y < grid.height; y++) {
    const km2 = grid.rowCellArea[y]! / 1e6;
    for (let x = 0; x < grid.width; x++) {
      people += fields.civilization[y * grid.width + x]! * km2 * PEOPLE_PER_KM2;
    }
  }
  return people / 1e9;
}

function catastrophes(state: PlanetState, dtYears: number, rng: Rng): void {
  const civ = state.civilization;
  const age = TECH_AGES[civ.age]!;
  const density = state.fields.civilization;
  if (civ.age >= 1 && rng.next() < 1 - Math.exp(-PLAGUE_RATE * dtYears)) {
    for (let i = 0; i < density.length; i++) density[i] = density[i]! * 0.7;
    recordEvent(state, 'plague');
  }
  if (age.warRisk > 0 && rng.next() < 1 - Math.exp(-age.warRisk * dtYears)) {
    for (let i = 0; i < density.length; i++) density[i] = density[i]! * 0.3;
    // The survivors lose much of what the age had achieved, but not the age itself.
    civ.progress = Math.max(0, civ.progress - 0.5);
    recordEvent(state, 'nuclearWar');
  }
  civ.population = worldPopulation(state);
}

function advanceTechnology(state: PlanetState, dtYears: number): void {
  const civ = state.civilization;
  const age = TECH_AGES[civ.age]!;
  // Bigger populations invent faster, with strongly diminishing returns, so a small
  // species is slower but not stuck.
  const pace = Math.min(2, Math.max(0.5, (civ.population / age.expectedPopulation) ** 0.25));
  civ.progress += (pace * dtYears) / age.duration;
  if (civ.progress < 1) return;
  if (civ.age === TECH_AGES.length - 1) {
    civ.exodusYear = state.globals.year;
    endCivilization(state, 'exodus');
    return;
  }
  civ.age += 1;
  civ.progress = 0;
  recordEvent(state, 'ageReached', TECH_AGES[civ.age]!.key);
}

function endCivilization(state: PlanetState, event: 'civilizationCollapsed' | 'exodus'): void {
  const civ = state.civilization;
  recordEvent(state, event, civ.species === null ? undefined : LIFE_CLASSES[civ.species]!.key);
  civ.species = null;
  civ.age = 0;
  civ.progress = 0;
  civ.population = 0;
  civ.sentientSince = null;
  state.fields.civilization.fill(0);
}

/** Simulated years per step for a planet: geological until a civilization arises. */
export function civilizationStepYears(state: PlanetState, geologicalStep: number): number {
  const civ = state.civilization;
  return civ.species === null ? geologicalStep : TECH_AGES[civ.age]!.yearsPerStep;
}
