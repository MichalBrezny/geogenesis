import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT } from '../../core/grid';
import type { PlanetState } from '../../core/planet';
import type { Rng } from '../../core/rng';
import type { Biome } from '../../data/biomes';
import {
  LIFE_CLASS_COUNT,
  LIFE_CLASSES,
  LIFE_TIERS,
  lifeClassIndex,
  PLANT_PRODUCTIVITY,
  type LifeClass,
} from '../../data/lifeClasses';
import { recordEvent } from '../../events';
import { SEA_LEVEL } from '../geosphere/flowRouting';

export interface LifeOptions {
  /** Multiplier on the rate at which new classes evolve (a future player control). */
  mutationRate?: number;
}

/** Years for a population to settle to a new carrying capacity; far shorter than a step. */
const POPULATION_RESPONSE_TIME = 2e6;
/** Population below which a class is gone from a cell. */
const EXTINCTION_THRESHOLD = 1e-3;
/** A neighbour must hold at least this much of a class to colonise a cell from it. */
const COLONISATION_THRESHOLD = 0.05;
/** Population a new class starts with in the cell where it evolves. */
const FOUNDER_POPULATION = 0.2;
/**
 * New classes evolve at 1 / (BASE_EVOLUTION_TIME × difficulty) per year, scaled
 * by how much of the new class's potential habitat the ancestor reaches. Tuned
 * so microbes reach mammals in roughly a billion years.
 */
const BASE_EVOLUTION_TIME = 40e6;
/** Population at which a class counts as fully present in a cell when evolving descendants. */
const PRESENCE_POPULATION = 0.2;
/** Sea water does not get much colder than this, whatever the air does. */
const SEA_WATER_MIN_TEMPERATURE = -1.8;

/**
 * Life: a population of every class in every cell, and evolution of new classes.
 *
 * Each step a class moves towards the carrying capacity its environment allows
 * (habitat, temperature, oxygen, plants for land animals) in cells it already
 * holds or can reach from a neighbouring cell, so it spreads about one cell per
 * step and cannot cross oceans or land it cannot live on. Classes vanish where
 * conditions turn against them — mass extinctions follow climate catastrophes.
 *
 * A class that is not alive can evolve from its living ancestor; the chance
 * grows with how much of the planet the ancestor occupies where the new class
 * could live. Extinct classes can evolve again.
 */
export function createLife(options: LifeOptions = {}): SimComponent {
  const mutationRate = options.mutationRate ?? 1;
  return {
    name: 'life',
    inputs: ['elevation', 'airTemperature', 'iceCover', 'biome'],
    outputs: ['vegetation', 'lifeTier'],
    runOneStep(state, dtYears, rng) {
      const suitability = computeSuitability(state);
      if (dtYears > 0) {
        growAndSpread(state, suitability, dtYears);
        evolve(state, suitability, dtYears, mutationRate, rng);
      }
      summarize(state);
    },
  };
}

/** Seeds the first life: prokaryotes throughout the ocean. */
export function seedPrimordialLife(state: PlanetState): void {
  const { populations, appeared } = state.biota;
  const prokaryotes = lifeClassIndex('prokaryotes');
  const n = state.grid.cellCount;
  for (let i = 0; i < n; i++) {
    if (state.fields.elevation[i]! < SEA_LEVEL) populations[prokaryotes * n + i] = 0.5;
  }
  appeared[prokaryotes] = state.globals.year;
}

/** Carrying capacity (0..1) of every class in every cell: suitability[c * n + i]. */
function computeSuitability(state: PlanetState): Float32Array {
  const n = state.grid.cellCount;
  const result = new Float32Array(n * LIFE_CLASS_COUNT);
  for (let c = 0; c < LIFE_CLASS_COUNT; c++) {
    classSuitability(state, c, result.subarray(c * n, (c + 1) * n));
  }
  return result;
}

/**
 * Carrying capacity (0..1) of one class in every cell, from habitat,
 * temperature, oxygen and (for land animals) plant cover.
 */
export function classSuitability(
  state: PlanetState,
  c: number,
  out: Float32Array = new Float32Array(state.grid.cellCount),
): Float32Array {
  const { grid, fields, globals, biota } = state;
  const n = grid.cellCount;
  const { elevation, airTemperature, iceCover, biome } = fields;
  const plants = lifeClassIndex('plants');
  const lifeClass = LIFE_CLASSES[c]!;
  out.fill(0);
  const oxygen = oxygenFactor(lifeClass, globals.atmosphere.o2);
  if (oxygen === 0) return out;
  for (let i = 0; i < n; i++) {
    const ocean = elevation[i]! < SEA_LEVEL;
    if (ocean !== (lifeClass.habitat === 'ocean')) continue;
    const temperature = ocean
      ? Math.max(SEA_WATER_MIN_TEMPERATURE, airTemperature[i]!)
      : airTemperature[i]!;
    const d = (temperature - lifeClass.optimumTemperature) / lifeClass.temperatureTolerance;
    let value = Math.max(0, 1 - d * d) * oxygen;
    // Life under sea ice survives at low density; land ice is uninhabitable.
    value *= ocean ? 1 - 0.8 * iceCover[i]! : 1 - iceCover[i]!;
    if (lifeClass.key === 'plants') value *= PLANT_PRODUCTIVITY[biome[i] as Biome];
    if (lifeClass.needsPlants) value *= biota.populations[plants * n + i]!;
    out[i] = value;
  }
  return out;
}

function oxygenFactor(lifeClass: LifeClass, o2: number): number {
  if (lifeClass.minOxygen === 0) return 1;
  // Ramps up over half the required level above it, so oxygen shortages bite gradually.
  return Math.min(1, Math.max(0, (o2 - lifeClass.minOxygen) / (0.5 * lifeClass.minOxygen)));
}

function growAndSpread(state: PlanetState, suitability: Float32Array, dtYears: number): void {
  const { grid, biota } = state;
  const { neighbors } = getTopology(grid);
  const n = grid.cellCount;
  const response = 1 - Math.exp(-dtYears / POPULATION_RESPONSE_TIME);
  const previous = Float32Array.from(biota.populations);

  for (let c = 0; c < LIFE_CLASS_COUNT; c++) {
    const offset = c * n;
    for (let i = 0; i < n; i++) {
      let present = previous[offset + i]! > 0;
      for (let d = 0; d < NEIGHBOR_COUNT && !present; d += 2) {
        const nb = neighbors[i * NEIGHBOR_COUNT + d]!;
        present = nb >= 0 && previous[offset + nb]! >= COLONISATION_THRESHOLD;
      }
      if (!present) continue;
      const before = previous[offset + i]!;
      let after = before + (suitability[offset + i]! - before) * response;
      if (after < EXTINCTION_THRESHOLD) after = 0;
      biota.populations[offset + i] = after;
    }
  }
}

function evolve(
  state: PlanetState,
  suitability: Float32Array,
  dtYears: number,
  mutationRate: number,
  rng: Rng,
): void {
  const { grid, biota, globals } = state;
  const { neighbors } = getTopology(grid);
  const n = grid.cellCount;
  const alive = classTotals(state).map((total) => total > 0);

  LIFE_CLASSES.forEach((lifeClass, c) => {
    if (alive[c] || !lifeClass.ancestor) return;
    const a = lifeClassIndex(lifeClass.ancestor);
    if (!alive[a]) return;

    // Where could the new class arise? Cells it can live in, next to or within the
    // ancestor's range (so sea life can found land life along coasts and back).
    // Measured as a share of the new class's potential habitat, so a move from sea
    // to land is limited by how much of the coast the ancestor holds, not by how
    // small coasts are compared with the planet.
    let overlap = 0;
    let potential = 0;
    let bestCell = -1;
    let bestScore = 0;
    for (let y = 0; y < grid.height; y++) {
      const weight = grid.rowAreaWeight[y]!;
      for (let x = 0; x < grid.width; x++) {
        const i = y * grid.width + x;
        const fit = suitability[c * n + i]!;
        if (fit === 0) continue;
        potential += fit * weight;
        let ancestor = biota.populations[a * n + i]!;
        for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
          const nb = neighbors[i * NEIGHBOR_COUNT + d]!;
          if (nb >= 0) ancestor = Math.max(ancestor, biota.populations[a * n + nb]!);
        }
        // Presence matters, not density: sparse land animals evolve as readily as dense plankton.
        const score = Math.min(1, ancestor / PRESENCE_POPULATION) * fit;
        overlap += score * weight;
        if (score > bestScore) {
          bestScore = score;
          bestCell = i;
        }
      }
    }
    if (bestCell < 0) return;

    const share = overlap / potential;
    const rate =
      (mutationRate * state.controls.mutationRate * share) /
      (BASE_EVOLUTION_TIME * lifeClass.difficulty);
    if (rng.next() < 1 - Math.exp(-rate * dtYears)) {
      biota.populations[c * n + bestCell] = FOUNDER_POPULATION;
      if (biota.appeared[c] === null) biota.appeared[c] = globals.year;
      recordEvent(state, 'classAppeared', lifeClass.key);
    }
  });
}

/** Area-weighted mean population of every class. */
function classTotals(state: PlanetState): number[] {
  const { grid, biota } = state;
  const n = grid.cellCount;
  return LIFE_CLASSES.map((_, c) => {
    let total = 0;
    for (let y = 0; y < grid.height; y++) {
      const weight = grid.rowAreaWeight[y]!;
      for (let x = 0; x < grid.width; x++)
        total += biota.populations[c * n + y * grid.width + x]! * weight;
    }
    return total;
  });
}

/** Updates class cover, the vegetation field and the most advanced tier per cell. */
function summarize(state: PlanetState): void {
  const { grid, biota, fields } = state;
  const n = grid.cellCount;
  const before = biota.cover;
  biota.cover = classTotals(state);
  LIFE_CLASSES.forEach((lifeClass, c) => {
    if (before[c]! > 0 && biota.cover[c] === 0) recordEvent(state, 'classExtinct', lifeClass.key);
  });
  const plants = lifeClassIndex('plants');
  fields.vegetation.set(biota.populations.subarray(plants * n, (plants + 1) * n));
  fields.lifeTier.fill(0);
  LIFE_CLASSES.forEach((lifeClass, c) => {
    const tier = LIFE_TIERS.indexOf(lifeClass.tier) + 1;
    for (let i = 0; i < n; i++) {
      if (biota.populations[c * n + i]! >= 0.05 && tier > fields.lifeTier[i]!) {
        fields.lifeTier[i] = tier;
      }
    }
  });
}
