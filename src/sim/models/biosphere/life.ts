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
  type LifeClassKey,
} from '../../data/lifeClasses';
import { recordEvent } from '../../events';
import { disperse } from '../dispersal';
import { isOcean } from '../geosphere/seaLevel';

export interface LifeOptions {
  /** Multiplier on the rate at which new classes evolve (a future player control). */
  mutationRate?: number;
  /** Scenario-specific transition-rate multipliers; Quick start uses this for legacy pacing. */
  evolutionTimeFactors?: Partial<Record<LifeClassKey, number>>;
}

/** Years for a population to settle to a new carrying capacity (e-folding time). */
const POPULATION_RESPONSE_TIME = 2e6;
/**
 * Speed (m/yr) at which life colonises habitable land or sea next to where it
 * lives: 300 km per million years, so a class crosses a continent in some tens
 * of millions of years — slow enough to watch, fast against evolution.
 */
const DISPERSAL_SPEED = 0.3;
/** Population below which a class is gone from a cell. */
const EXTINCTION_THRESHOLD = 1e-3;
/**
 * A cell must hold at least this much of a class to send out colonists; newly
 * colonised cells start at least this dense (if they can hold it), so the front
 * keeps moving however short the steps are.
 */
const COLONISATION_THRESHOLD = 0.005;
/** Population a new class starts with in the cell where it evolves. */
const FOUNDER_POPULATION = 0.2;
/**
 * New classes evolve at 1 / (BASE_EVOLUTION_TIME × difficulty) per year, scaled
 * by how much of the new class's potential habitat the ancestor reaches. Tuned
 * so microbes reach mammals in roughly a billion years.
 */
const BASE_EVOLUTION_TIME = 40e6;
/**
 * Mean origin time on an otherwise fully suitable Earth-like ocean. The actual
 * hazard scales with suitable liquid-ocean area, giving roughly 100–300 Myr on
 * a temperate young planet.
 */
export const ABIOGENESIS_TIME = 180e6;
const ABIOGENESIS_REFERENCE_OCEAN = 0.7;
const ABIOGENESIS_MIN_TEMPERATURE = 0;
const ABIOGENESIS_MAX_TEMPERATURE = 85;
const ORIGIN_CLUSTER_RADIUS = 600_000;
/** Population at which a class counts as fully present in a cell when evolving descendants. */
const PRESENCE_POPULATION = 0.2;
/** Sea water does not get much colder than this, whatever the air does. */
const SEA_WATER_MIN_TEMPERATURE = -1.8;

/**
 * Life: a population of every class in every cell, and evolution of new classes.
 *
 * Each step a class moves towards the carrying capacity its environment allows
 * (habitat, temperature, oxygen, plants for land animals) in cells it holds, and
 * colonises neighbouring habitable cells at DISPERSAL_SPEED (independent of the
 * step length and grid), so it cannot cross oceans or land it cannot live on. Classes vanish where
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
      if (dtYears > 0) {
        attemptAbiogenesis(state, dtYears, rng);
        // Only classes that exist, or could evolve now, need any work.
        const alive = presentClasses(state);
        const relevant = alive.map((isAlive, c) => isAlive || isEvolutionCandidate(c, alive));
        const suitability = computeSuitability(state, relevant);
        growAndSpread(state, suitability, dtYears, alive, rng);
        evolve(state, suitability, dtYears, mutationRate, options.evolutionTimeFactors ?? {}, rng);
      }
      summarize(state);
    },
  };
}

/** Exact Poisson-event probability used by abiogenesis and its statistical tests. */
export function abiogenesisProbability(ratePerYear: number, dtYears: number): number {
  return 1 - Math.exp(-Math.max(0, ratePerYear) * Math.max(0, dtYears));
}

/** Mean full-overlap waiting time for a class's data-driven evolutionary transition. */
export function evolutionTimeYears(lifeClass: LifeClass): number {
  return BASE_EVOLUTION_TIME * lifeClass.difficulty * (lifeClass.evolutionTime ?? 1);
}

/** Whether a cell offers exposed liquid seawater in the origin-of-life temperature range. */
export function isAbiogenesisHabitat(state: PlanetState, cell: number): boolean {
  return (
    isOcean(state.fields.elevation[cell]!, state.globals.seaLevel) &&
    state.fields.iceCover[cell]! < 0.1 &&
    state.fields.airTemperature[cell]! >= ABIOGENESIS_MIN_TEMPERATURE &&
    state.fields.airTemperature[cell]! <= ABIOGENESIS_MAX_TEMPERATURE
  );
}

function attemptAbiogenesis(state: PlanetState, dtYears: number, rng: Rng): void {
  const prokaryotes = lifeClassIndex('prokaryotes');
  const n = state.grid.cellCount;
  for (let i = 0; i < n; i++) {
    if (state.biota.populations[prokaryotes * n + i]! > 0) return;
  }

  const start = state.globals.year;
  const end = start + dtYears;
  const availableYears = Math.max(
    0,
    end - Math.max(start, state.geosphere.abiogenesisSuppressedUntil),
  );
  if (availableYears === 0) return;

  let suitableArea = 0;
  const candidates: number[] = [];
  for (let y = 0; y < state.grid.height; y++) {
    const area = state.grid.rowAreaWeight[y]!;
    for (let x = 0; x < state.grid.width; x++) {
      const i = y * state.grid.width + x;
      if (!isAbiogenesisHabitat(state, i)) continue;
      suitableArea += area;
      candidates.push(i);
    }
  }
  if (candidates.length === 0) return;
  const rate = suitableArea / (ABIOGENESIS_REFERENCE_OCEAN * ABIOGENESIS_TIME);
  if (rng.next() >= abiogenesisProbability(rate, availableYears)) return;

  // Hydrothermal systems are favoured, but a quiet suitable ocean is not forbidden.
  let totalWeight = 0;
  for (const cell of candidates) {
    const row = Math.floor(cell / state.grid.width);
    totalWeight +=
      state.grid.rowAreaWeight[row]! * (0.25 + Math.max(0, state.fields.volcanicActivity[cell]!));
  }
  let pick = rng.next() * totalWeight;
  let origin = candidates[candidates.length - 1]!;
  for (const cell of candidates) {
    const row = Math.floor(cell / state.grid.width);
    pick -=
      state.grid.rowAreaWeight[row]! * (0.25 + Math.max(0, state.fields.volcanicActivity[cell]!));
    if (pick <= 0) {
      origin = cell;
      break;
    }
  }
  seedOriginCluster(state, origin, prokaryotes);
  if (state.biota.appeared[prokaryotes] === null) {
    state.biota.appeared[prokaryotes] = end;
  }
  recordEvent(state, 'lifeOrigin', undefined, end);
}

function seedOriginCluster(state: PlanetState, origin: number, lifeClass: number): void {
  const { grid } = state;
  const positions = grid.cellPosition;
  const [ox, oy, oz] = [
    positions[origin * 3]!,
    positions[origin * 3 + 1]!,
    positions[origin * 3 + 2]!,
  ];
  const offset = lifeClass * grid.cellCount;
  for (let i = 0; i < grid.cellCount; i++) {
    if (!isAbiogenesisHabitat(state, i)) continue;
    const dot = Math.max(
      -1,
      Math.min(1, ox * positions[i * 3]! + oy * positions[i * 3 + 1]! + oz * positions[i * 3 + 2]!),
    );
    const distance = Math.acos(dot) * grid.radius;
    if (distance <= ORIGIN_CLUSTER_RADIUS) {
      state.biota.populations[offset + i] =
        FOUNDER_POPULATION * Math.max(0.25, 1 - distance / ORIGIN_CLUSTER_RADIUS);
    }
  }
  // Coarse grids may have no second cell within 600 km; the vent cell always starts life.
  state.biota.populations[offset + origin] = FOUNDER_POPULATION;
}

/** Seeds the first life: prokaryotes throughout the ocean. */
export function seedPrimordialLife(state: PlanetState): void {
  const { populations, appeared } = state.biota;
  const prokaryotes = lifeClassIndex('prokaryotes');
  const n = state.grid.cellCount;
  for (let i = 0; i < n; i++) {
    if (isOcean(state.fields.elevation[i]!, state.globals.seaLevel)) {
      populations[prokaryotes * n + i] = 0.5;
    }
  }
  appeared[prokaryotes] = state.globals.year;
}

/**
 * Carrying capacity (0..1) of every class in every cell: suitability[c * n + i].
 * Classes not marked `relevant` are left at zero.
 */
function computeSuitability(state: PlanetState, relevant: readonly boolean[]): Float32Array {
  const n = state.grid.cellCount;
  const result = new Float32Array(n * LIFE_CLASS_COUNT);
  for (let c = 0; c < LIFE_CLASS_COUNT; c++) {
    if (relevant[c]) classSuitability(state, c, result.subarray(c * n, (c + 1) * n));
  }
  return result;
}

/** Whether each class has any population anywhere. */
function presentClasses(state: PlanetState): boolean[] {
  const n = state.grid.cellCount;
  const { populations } = state.biota;
  return LIFE_CLASSES.map((_, c) => {
    for (let i = c * n; i < (c + 1) * n; i++) if (populations[i]! > 0) return true;
    return false;
  });
}

/** A missing class whose ancestor lives, so it may evolve this step. */
function isEvolutionCandidate(c: number, alive: readonly boolean[]): boolean {
  const ancestor = LIFE_CLASSES[c]!.ancestor;
  return !alive[c] && ancestor !== undefined && alive[lifeClassIndex(ancestor)]!;
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
    const ocean = isOcean(elevation[i]!, globals.seaLevel);
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

function growAndSpread(
  state: PlanetState,
  suitability: Float32Array,
  dtYears: number,
  alive: readonly boolean[],
  rng: Rng,
): void {
  const { grid, biota } = state;
  const n = grid.cellCount;
  const response = 1 - Math.exp(-dtYears / POPULATION_RESPONSE_TIME);
  const populations = biota.populations;

  for (let c = 0; c < LIFE_CLASS_COUNT; c++) {
    // An absent class has nothing to grow or spread from.
    if (!alive[c]) continue;
    const offset = c * n;
    for (let i = 0; i < n; i++) {
      const before = populations[offset + i]!;
      if (before === 0) continue;
      let after = before + (suitability[offset + i]! - before) * response;
      if (after < EXTINCTION_THRESHOLD) after = 0;
      populations[offset + i] = after;
    }
    disperse(grid, {
      dtYears,
      speed: DISPERSAL_SPEED,
      rng,
      isSource: (i) => populations[offset + i]! >= COLONISATION_THRESHOLD,
      canEnter: (i) =>
        populations[offset + i] === 0 && suitability[offset + i]! > EXTINCTION_THRESHOLD,
      settle: (i, remaining) => {
        const capacity = suitability[offset + i]!;
        const grown = capacity * (1 - Math.exp((-remaining * dtYears) / POPULATION_RESPONSE_TIME));
        populations[offset + i] = Math.max(grown, Math.min(capacity, COLONISATION_THRESHOLD));
      },
    });
  }
}

function evolve(
  state: PlanetState,
  suitability: Float32Array,
  dtYears: number,
  mutationRate: number,
  evolutionTimeFactors: Partial<Record<LifeClassKey, number>>,
  rng: Rng,
): void {
  const { grid, biota, globals } = state;
  const { neighbors } = getTopology(grid);
  const n = grid.cellCount;
  const alive = presentClasses(state);

  LIFE_CLASSES.forEach((lifeClass, c) => {
    if (!isEvolutionCandidate(c, alive)) return;
    const a = lifeClassIndex(lifeClass.ancestor!);

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
      (mutationRate *
        state.controls.mutationRate *
        share *
        (evolutionTimeFactors[lifeClass.key] ?? 1)) /
      evolutionTimeYears(lifeClass);
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
    if (biota.cover[c] === 0) return;
    const tier = LIFE_TIERS.indexOf(lifeClass.tier) + 1;
    for (let i = 0; i < n; i++) {
      if (biota.populations[c * n + i]! >= 0.05 && tier > fields.lifeTier[i]!) {
        fields.lifeTier[i] = tier;
      }
    }
  });
}
