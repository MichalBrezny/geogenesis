import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT, type Grid } from '../../core/grid';
import type { EcologyMemory, PlanetState } from '../../core/planet';
import { createRng, type Rng } from '../../core/rng';
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
import { boilingPointC, oxygenPartialPressure } from '../atmosphere/atmosphere';

export interface LifeOptions {
  /** Multiplier on the rate at which new classes evolve (a future player control). */
  mutationRate?: number;
  /** Scenario-specific transition-rate multipliers; Quick start uses this for legacy pacing. */
  evolutionTimeFactors?: Partial<Record<LifeClassKey, number>>;
}

/** Years for a population to grow towards a higher carrying capacity (e-folding time). */
const POPULATION_RESPONSE_TIME = 2e6;
/**
 * Years for a population to fall to a lower carrying capacity. Die-offs are fast
 * and recovery is slow: the main end-Permian extinction pulse took ≲ 60 kyr
 * (Burgess et al. 2014), recovery millions of years.
 */
const POPULATION_DECLINE_TIME = 5e4;
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
export const ABIOGENESIS_TIME = 75e6;
const ABIOGENESIS_REFERENCE_OCEAN = 0.7;
const ABIOGENESIS_MIN_TEMPERATURE = 0;
const ABIOGENESIS_BOILING_MARGIN = 10;
const ORIGIN_CLUSTER_RADIUS = 600_000;
/** Population at which a class counts as fully present in a cell when evolving descendants. */
const PRESENCE_POPULATION = 0.2;
/** Sea water does not get much colder than this, whatever the air does. */
const SEA_WATER_MIN_TEMPERATURE = -1.8;

// --- Stressors (M13) ---
/**
 * Nutrient supply (relative to the modern ocean mean) at which a marine animal's
 * carrying capacity is halved below its saturating value; with the 1.5 prefactor
 * the modern mean gives full capacity, nutrient-poor gyres less and shelves and
 * upwelling zones (≥ 1) the full amount.
 */
const NUTRIENT_HALF_SATURATION = 0.5;
/** pH drop calcifiers shrug off, and the drop at which they cannot build shells at all. */
const ACIDITY_TOLERANCE = 0.05;
const ACIDITY_LETHAL = 0.5;
/**
 * O₂ mole fractions between which wildfires increasingly burn land vegetation:
 * above ~25 % even wet plants burn, above ~35 % forests could not persist
 * (Watson & Lovelock 1978; Belcher & McElwain 2008).
 */
const FIRE_OXYGEN_ONSET = 0.25;
const FIRE_OXYGEN_FULL = 0.35;
/** Largest share of plant cover wildfires remove at FIRE_OXYGEN_FULL. */
const FIRE_MAX_LOSS = 0.8;
/**
 * CO₂ (microbar) at which land plants starve and above which they grow fully. C3
 * plants starve near 50–60 ppm (Pagani et al. 2009, Gerhart & Ward 2010), but C4
 * plants keep the land green down to ~10 ppm (Lenton & von Bloh 2001), so CO₂
 * starvation ends land plant life on a brightening Sun only shortly before the
 * runaway greenhouse (Caldeira & Kasting 1992).
 */
const PLANT_CO2_STARVATION = 10;
const PLANT_CO2_FULL = 100;
/**
 * E-folding time (years) of the temperature life is adapted to; warming or
 * cooling faster than adaptation and migration can follow builds a lag.
 */
const ADAPTATION_TIME = 1e5;
/** Climate lag (°C) complex life tolerates, and the extra lag that wipes it out. */
const CLIMATE_LAG_TOLERANCE = 3;
const CLIMATE_LAG_LETHAL = 10;

// --- Competition ---
/** Strength with which a class present in a cell presses on another of its guild. */
const COMPETITION_STRENGTH = 0.4;
/** Optimum-temperature difference (°C) over which niche overlap falls by e. */
const NICHE_WIDTH = 8;
/** Edge of a more advanced class: it presses harder, and is pressed less, by this share. */
const ADVANCED_EDGE = 0.25;

// --- Mass extinctions and recovery ---
/**
 * Complex biomass is compared with a reference that holds the recent peak and
 * fades with this e-folding time, so only fast losses count.
 */
const BIOMASS_MEMORY_TIME = 5e6;
/**
 * A loss of this share of complex biomass against the reference is a mass
 * extinction: 70 % within ≲ 1.5 Myr, 80 % within ≲ 3.5 Myr.
 */
const MASS_EXTINCTION_LOSS = 0.6;
/** Reference biomass (planet fraction) below which losses are not counted. */
const MIN_REFERENCE_BIOMASS = 0.01;
/**
 * The loss must also be a substantial share of the biosphere's longer-term size
 * (a peak-hold reference fading over BIOSPHERE_MEMORY_TIME), so the last remnants
 * of a slowly dwindling biosphere dying out do not count as a mass extinction.
 */
const BIOSPHERE_MEMORY_TIME = 50e6;
const MIN_LOSS_OF_BIOSPHERE = 0.3;
/** A new episode needs at least this long after the last one. */
const EXTINCTION_EPISODE_GAP = 5e6;
/**
 * Years after a mass extinction during which emptied niches refill quickly:
 * evolution, regrowth and recolonisation speed up (after the end-Permian and
 * end-Cretaceous recoveries, ~5–10 Myr).
 */
const RECOVERY_WINDOW = 8e6;
const RADIATION_BOOST = 4;
const RECOVERY_GROWTH_BOOST = 2;

// --- Cambrian explosion ---
/**
 * O₂ partial pressure (bar, ≈ 20 % of present) the first animals need to evolve:
 * the Neoproterozoic oxygenation that preceded them (Sperling et al. 2013).
 */
const CAMBRIAN_OXYGEN = 0.04;
/** Global ice fraction that counts as a snowball glaciation. */
const SNOWBALL_ICE_FRACTION = 0.5;
/** For this long after a snowball ends, the first animals evolve SNOWBALL_BOOST times faster. */
const POST_SNOWBALL_WINDOW = 50e6;
const POST_SNOWBALL_BOOST = 5;
/** The Cambrian burst: animal classes evolve CAMBRIAN_BOOST times faster for this long. */
const CAMBRIAN_WINDOW = 40e6;
const CAMBRIAN_BOOST = 5;

/** Main cause recorded with a mass extinction. */
export const EXTINCTION_CAUSES = [
  'dust',
  'anoxia',
  'acidification',
  'climateChange',
  'oxygen',
  'co2',
  'impact',
] as const;
export type ExtinctionCause = (typeof EXTINCTION_CAUSES)[number];
/** Stressors whose share of lost carrying capacity is tallied for the cause. */
type Stressor = Exclude<ExtinctionCause, 'impact'>;

/** Ecological memory of the life model (plain data, saved with the planet). */
/**
 * Life: a population of every class in every cell, and evolution of new classes.
 *
 * Each step a class moves towards the carrying capacity its environment allows
 * (habitat, temperature, oxygen, plants for land animals, and the M13 stressors:
 * dust, ocean anoxia and nutrients, acidification, wildfires, CO₂ starvation and
 * rapid climate change), shared with rivals of its guild, in cells it holds, and
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
    inputs: [
      'elevation',
      'airTemperature',
      'iceCover',
      'biome',
      'oceanOxygen',
      'nutrients',
      'civilization',
    ],
    outputs: ['vegetation', 'lifeTier', 'dominantClass'],
    runOneStep(state, dtYears, rng) {
      const tally = emptyTally();
      const evolutionMemory = ensureEvolutionMemory(state, rng);
      if (dtYears > 0) {
        const meanDust = consumeIntervalMeanDust(state, dtYears);
        attemptAbiogenesis(state, dtYears, evolutionMemory);
        adaptToClimate(state, dtYears);
        // Only classes that exist, or could evolve now, need any work.
        const alive = presentClasses(state);
        const relevant = alive.map((isAlive, c) => isAlive || isEvolutionCandidate(c, alive));
        const suitability = computeSuitability(state, relevant, tally, meanDust);
        applyCompetition(state, suitability, relevant);
        const recovery = windowBoost(
          state.globals.year,
          dtYears,
          state.globals.lastMassExtinctionYear,
          RECOVERY_WINDOW,
          RECOVERY_GROWTH_BOOST,
        );
        growAndSpread(state, suitability, dtYears, alive, recovery, rng);
        evolve(
          state,
          suitability,
          dtYears,
          mutationRate,
          options.evolutionTimeFactors ?? {},
          evolutionMemory,
        );
      }
      summarize(state, dtYears, tally);
    },
  };
}

/** Returns life's interval-mean optical depth and starts a fresh integration interval. */
export function consumeIntervalMeanDust(state: PlanetState, dtYears: number): number {
  const { globals } = state;
  const mean =
    globals.dustYearsSinceLife > 0 && dtYears > 0
      ? globals.dustIntegralSinceLife / dtYears
      : globals.dust;
  globals.dustIntegralSinceLife = 0;
  globals.dustYearsSinceLife = 0;
  return mean;
}

/**
 * Mean multiplier over the step [start, start + dt] of a boost that applies
 * during [windowStart, windowStart + window]: integrating the window's overlap
 * with the step keeps the boost independent of the step length.
 */
export function windowBoost(
  start: number,
  dtYears: number,
  windowStart: number | null,
  window: number,
  boost: number,
): number {
  if (windowStart === null || windowStart < 0 || dtYears <= 0) return 1;
  const overlap = Math.max(
    0,
    Math.min(start + dtYears, windowStart + window) - Math.max(start, windowStart),
  );
  return 1 + ((boost - 1) * overlap) / dtYears;
}

/** Ecological memory is initialized with the planet and hydrated for old saves. */
function ecology(state: PlanetState): EcologyMemory {
  const memory = state.biota.ecology;
  if (!memory.initialized) {
    const biomass = complexBiomass(state.biota.cover);
    memory.initialized = true;
    memory.biomassReference = biomass;
    memory.biosphereReference = biomass;
    memory.adaptedTemperature = state.globals.meanTemperature;
    memory.previousTemperature = state.globals.meanTemperature;
  }
  return memory;
}

type EvolutionMemory = Required<
  Pick<
    EcologyMemory,
    | 'evolutionProgress'
    | 'evolutionThresholds'
    | 'evolutionRngState'
    | 'abiogenesisProgress'
    | 'abiogenesisThreshold'
  >
>;

/**
 * A private origination stream and one exponential threshold per class keep
 * stochastic evolution independent of unrelated RNG consumers and of how often
 * the geological era is stepped. The optional fields make old saves migrate on use.
 */
function ensureEvolutionMemory(state: PlanetState, rng: Rng): EvolutionMemory {
  const memory = ecology(state);
  if (
    memory.evolutionProgress?.length !== LIFE_CLASS_COUNT ||
    memory.evolutionThresholds?.length !== LIFE_CLASS_COUNT ||
    memory.evolutionRngState === undefined ||
    memory.abiogenesisProgress === undefined ||
    memory.abiogenesisThreshold === undefined
  ) {
    const evolutionRng = createRng((rng.state ^ 0x65766f6c) >>> 0);
    memory.evolutionProgress = Array<number>(LIFE_CLASS_COUNT).fill(0);
    memory.evolutionThresholds = Array.from({ length: LIFE_CLASS_COUNT }, () =>
      exponentialThreshold(evolutionRng),
    );
    memory.abiogenesisProgress = 0;
    memory.abiogenesisThreshold = exponentialThreshold(evolutionRng);
    memory.evolutionRngState = evolutionRng.state;
  }
  return memory as EvolutionMemory;
}

function exponentialThreshold(rng: Rng): number {
  return -Math.log(1 - rng.next());
}

/**
 * Moves the adapted temperature towards the current one. The relaxation is
 * integrated exactly for a temperature that changed linearly over the step, so a
 * given warming rate builds the same lag (≈ rate × ADAPTATION_TIME) whatever the
 * step length.
 */
export function adaptToClimate(state: PlanetState, dtYears: number): void {
  const memory = ecology(state);
  const now = state.globals.meanTemperature;
  const before = memory.previousTemperature;
  const rate = (now - before) / dtYears;
  const decay = Math.exp(-dtYears / ADAPTATION_TIME);
  memory.adaptedTemperature =
    now -
    rate * ADAPTATION_TIME +
    (memory.adaptedTemperature - before + rate * ADAPTATION_TIME) * decay;
  memory.previousTemperature = now;
}

/** Lost carrying capacity of complex life per stressor, weighted by the populations exposed. */
type StressTally = Record<Stressor, number>;

function emptyTally(): StressTally {
  return { dust: 0, anoxia: 0, acidification: 0, climateChange: 0, oxygen: 0, co2: 0 };
}

/**
 * Stress multipliers (0..1) that are the same for every cell, from the global
 * state: dust dimming, the climate lag, wildfires and CO₂ starvation.
 */
interface GlobalStress {
  /** exp(−dust): sunlight reaching the surface. */
  light: number;
  /** Rapid climate change, for complex life. */
  climate: number;
  /** Land plants burnt by wildfires in an oxygen-rich atmosphere. */
  fire: number;
  /** Land plants starving for CO₂. */
  co2: number;
  /** Calcifiers in an acidified sea. */
  acidity: number;
}

/** Global stress multipliers from the current atmosphere, ocean and climate memory. */
export function globalStress(state: PlanetState, dust = state.globals.dust): GlobalStress {
  const { globals } = state;
  const lag = state.biota.ecology.initialized
    ? Math.abs(globals.meanTemperature - state.biota.ecology.adaptedTemperature)
    : 0;
  const fireLevel = clamp01(
    (globals.atmosphere.o2 - FIRE_OXYGEN_ONSET) / (FIRE_OXYGEN_FULL - FIRE_OXYGEN_ONSET),
  );
  return {
    light: Math.exp(-Math.max(0, dust)),
    climate: 1 - clamp01((lag - CLIMATE_LAG_TOLERANCE) / CLIMATE_LAG_LETHAL),
    fire: 1 - FIRE_MAX_LOSS * fireLevel,
    co2: clamp01(
      (globals.atmosphere.co2 - PLANT_CO2_STARVATION) / (PLANT_CO2_FULL - PLANT_CO2_STARVATION),
    ),
    acidity:
      1 -
      clamp01((globals.oceanAcidity - ACIDITY_TOLERANCE) / (ACIDITY_LETHAL - ACIDITY_TOLERANCE)),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Area-weighted complex (non-microbial) biomass: the sum of plant and animal class cover. */
export function complexBiomass(cover: readonly number[]): number {
  let total = 0;
  LIFE_CLASSES.forEach((lifeClass, c) => {
    if (lifeClass.tier !== 'microbes') total += cover[c] ?? 0;
  });
  return total;
}

/**
 * Biodiversity index (0..1): the Hill number of order 1 (exp of the Shannon
 * entropy of class cover shares, i.e. the effective number of classes) divided
 * by the number of classes. One class alone gives 1/15, all fifteen equally
 * widespread give 1, a lifeless planet 0.
 */
export function biodiversityIndex(cover: readonly number[]): number {
  const total = cover.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return 0;
  let entropy = 0;
  for (const value of cover) {
    if (value <= 0) continue;
    const p = value / total;
    entropy -= p * Math.log(p);
  }
  return Math.exp(entropy) / LIFE_CLASS_COUNT;
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
  const upperTemperature =
    boilingPointC(state.globals.surfacePressure) - ABIOGENESIS_BOILING_MARGIN;
  return (
    isOcean(state.fields.elevation[cell]!, state.globals.seaLevel) &&
    state.fields.iceCover[cell]! < 0.1 &&
    state.fields.airTemperature[cell]! >= ABIOGENESIS_MIN_TEMPERATURE &&
    state.fields.airTemperature[cell]! <= upperTemperature
  );
}

function attemptAbiogenesis(state: PlanetState, dtYears: number, memory: EvolutionMemory): void {
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
  const effectiveRate = rate * state.effectiveControls.advanceRate;
  const progressBefore = memory.abiogenesisProgress;
  memory.abiogenesisProgress += effectiveRate * availableYears;
  if (memory.abiogenesisProgress < memory.abiogenesisThreshold) return;

  const rng = createRng(memory.evolutionRngState);

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
  const availableStart = Math.max(start, state.geosphere.abiogenesisSuppressedUntil);
  const eventYear = availableStart + (memory.abiogenesisThreshold - progressBefore) / effectiveRate;
  if (state.biota.appeared[prokaryotes] === null) {
    state.biota.appeared[prokaryotes] = eventYear;
  }
  recordEvent(state, 'lifeOrigin', undefined, eventYear, origin);
  memory.abiogenesisProgress = 0;
  memory.abiogenesisThreshold = exponentialThreshold(rng);
  memory.evolutionRngState = rng.state;
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
function computeSuitability(
  state: PlanetState,
  relevant: readonly boolean[],
  tally?: StressTally,
  dust = state.globals.dust,
): Float32Array {
  const n = state.grid.cellCount;
  const result = lifeScratch(state.grid).suitability;
  result.fill(0);
  const stress = globalStress(state, dust);
  for (let c = 0; c < LIFE_CLASS_COUNT; c++) {
    if (relevant[c]) {
      classSuitability(state, c, result.subarray(c * n, (c + 1) * n), tally, stress);
    }
  }
  return result;
}

/**
 * Classes of one guild share a cell's carrying capacity: each class present in
 * the cell presses on the others in proportion to its own suitability there and
 * their niche overlap (similar temperature optima), more advanced classes a little
 * harder. Capacity becomes s / (1 + Σ pressure), so neighbours in niche space
 * thin each other out but do not exclude each other. Depends on presence only,
 * not on population sizes, so the result does not oscillate with long steps.
 */
export function applyCompetition(
  state: PlanetState,
  suitability: Float32Array,
  relevant: readonly boolean[],
): void {
  const n = state.grid.cellCount;
  const { populations } = state.biota;
  const base = lifeScratch(state.grid).competitionBase;
  base.set(suitability);
  for (let c = 0; c < LIFE_CLASS_COUNT; c++) {
    const guild = LIFE_CLASSES[c]!.guild;
    if (!relevant[c] || guild === undefined) continue;
    const rivals: { d: number; weight: number }[] = [];
    for (let d = 0; d < LIFE_CLASS_COUNT; d++) {
      if (d === c || LIFE_CLASSES[d]!.guild !== guild) continue;
      const gap =
        (LIFE_CLASSES[c]!.optimumTemperature - LIFE_CLASSES[d]!.optimumTemperature) / NICHE_WIDTH;
      const edge = 1 + ADVANCED_EDGE * Math.sign(d - c);
      rivals.push({ d, weight: COMPETITION_STRENGTH * Math.exp(-gap * gap) * edge });
    }
    for (let i = 0; i < n; i++) {
      const own = base[c * n + i]!;
      if (own === 0) continue;
      let pressure = 0;
      for (const { d, weight } of rivals) {
        if (populations[d * n + i]! > 0) pressure += weight * base[d * n + i]!;
      }
      suitability[c * n + i] = own / (1 + pressure);
    }
  }
}

interface LifeScratch {
  suitability: Float32Array;
  competitionBase: Float32Array;
}

const lifeScratchCache = new WeakMap<Grid, LifeScratch>();

/** Per-grid carrying-capacity buffers; they are derived work, never saved state. */
function lifeScratch(grid: Grid): LifeScratch {
  let scratch = lifeScratchCache.get(grid);
  if (!scratch) {
    const length = grid.cellCount * LIFE_CLASS_COUNT;
    scratch = {
      suitability: new Float32Array(length),
      competitionBase: new Float32Array(length),
    };
    lifeScratchCache.set(grid, scratch);
  }
  return scratch;
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
 * temperature, oxygen and (for land animals) plant cover, times the M13
 * stressors: dust dimming, ocean anoxia and nutrients, acidification (calcifiers),
 * wildfires and CO₂ starvation (plants) and the climate lag (complex life). With a
 * tally, the capacity each stressor removes from present complex life is summed.
 */
export function classSuitability(
  state: PlanetState,
  c: number,
  out: Float32Array = new Float32Array(state.grid.cellCount),
  tally?: StressTally,
  stress: GlobalStress = globalStress(state),
): Float32Array {
  const { grid, fields, globals, biota } = state;
  const n = grid.cellCount;
  const { elevation, airTemperature, iceCover, biome, oceanOxygen, nutrients } = fields;
  const plants = lifeClassIndex('plants');
  const lifeClass = LIFE_CLASSES[c]!;
  const complex = lifeClass.tier !== 'microbes';
  out.fill(0);
  // Oxygen requirements are physiological partial-pressure thresholds. At one
  // bar the value is numerically the same as the former volume-fraction input.
  const oxygen = oxygenFactor(lifeClass, oxygenPartialPressure(globals.atmosphere));
  // Global multipliers: dust dims the food chain's base, and complex life suffers
  // from climate change faster than it can adapt.
  const lightDependence = lifeClass.lightDependence ?? 1;
  const light = 1 - lightDependence * (1 - stress.light);
  const climate = complex ? stress.climate : 1;
  const isPlants = lifeClass.key === 'plants';
  const fire = isPlants ? stress.fire : 1;
  const co2 = isPlants ? stress.co2 : 1;
  const acidity = lifeClass.calcifying ? stress.acidity : 1;
  const minOceanOxygen = lifeClass.minOceanOxygen ?? 0;
  const populations = biota.populations;
  for (let i = 0; i < n; i++) {
    const ocean = isOcean(elevation[i]!, globals.seaLevel);
    if (ocean !== (lifeClass.habitat === 'ocean')) continue;
    const temperature = ocean
      ? Math.max(SEA_WATER_MIN_TEMPERATURE, airTemperature[i]!)
      : airTemperature[i]!;
    const d =
      (temperature - lifeClass.optimumTemperature) /
      (lifeClass.temperatureTolerance * Math.max(0.05, state.effectiveControls.thermalTolerance));
    let value = Math.max(0, 1 - d * d);
    // Life under sea ice survives at low density; land ice is uninhabitable.
    value *= ocean ? 1 - 0.8 * iceCover[i]! : 1 - iceCover[i]!;
    if (isPlants) value *= PLANT_PRODUCTIVITY[biome[i] as Biome];
    if (lifeClass.needsPlants) value *= populations[plants * n + i]!;
    // Shelf seas and upwelling zones feed the most animals, nutrient-poor gyres fewer.
    if (lifeClass.nutrientLimited) value *= nutrientFactor(nutrients[i]!);
    const anoxia =
      minOceanOxygen > 0 ? clamp01((oceanOxygen[i]! - minOceanOxygen) / minOceanOxygen) : 1;
    // Industrial pollution is global state, but exposure is concentrated where people
    // live; even a crisis removes only a mild share of complex-life capacity.
    const pollution = complex
      ? 1 -
        0.15 *
          (globals.pollution / (1 + Math.max(0, globals.pollution))) *
          Math.min(1, fields.civilization[i]! * 2)
      : 1;
    const stressed = value * oxygen * light * climate * fire * co2 * acidity * anoxia * pollution;
    out[i] = stressed;
    if (tally && complex && value > 0) {
      const exposed = populations[c * n + i]! * grid.rowAreaWeight[Math.floor(i / grid.width)]!;
      if (exposed > 0) {
        tally.oxygen += exposed * (1 - oxygen * fire);
        tally.dust += exposed * (1 - light);
        tally.climateChange += exposed * (1 - climate);
        tally.co2 += exposed * (1 - co2);
        tally.acidification += exposed * (1 - acidity);
        tally.anoxia += exposed * (1 - anoxia);
      }
    }
  }
  return out;
}

/** Marine animal carrying capacity from nutrient supply (1 = modern ocean mean). */
export function nutrientFactor(nutrients: number): number {
  const n = Math.max(0, nutrients);
  return Math.min(1, (1 + NUTRIENT_HALF_SATURATION) * (n / (n + NUTRIENT_HALF_SATURATION)));
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
  recovery: number,
  rng: Rng,
): void {
  const { grid, biota } = state;
  const n = grid.cellCount;
  const reproduction = Math.max(0, state.effectiveControls.reproduction);
  const speed = reproduction * recovery;
  const growth = 1 - Math.exp((-dtYears * speed) / POPULATION_RESPONSE_TIME);
  const decline = 1 - Math.exp((-dtYears * reproduction) / POPULATION_DECLINE_TIME);
  const populations = biota.populations;

  for (let c = 0; c < LIFE_CLASS_COUNT; c++) {
    // An absent class has nothing to grow or spread from.
    if (!alive[c]) continue;
    const offset = c * n;
    for (let i = 0; i < n; i++) {
      const before = populations[offset + i]!;
      if (before === 0) continue;
      const capacity = suitability[offset + i]!;
      let after = before + (capacity - before) * (capacity < before ? decline : growth);
      if (after < EXTINCTION_THRESHOLD) after = 0;
      populations[offset + i] = after;
    }
    disperse(grid, {
      dtYears,
      speed: DISPERSAL_SPEED * recovery,
      rng,
      isSource: (i) => populations[offset + i]! >= COLONISATION_THRESHOLD,
      canEnter: (i) =>
        populations[offset + i] === 0 && suitability[offset + i]! > EXTINCTION_THRESHOLD,
      settle: (i, remaining) => {
        const capacity = suitability[offset + i]!;
        const grown =
          capacity * (1 - Math.exp((-remaining * dtYears * speed) / POPULATION_RESPONSE_TIME));
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
  memory: EvolutionMemory,
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
    const requestedFactor = evolutionTimeFactors[lifeClass.key] ?? 1;
    const scenarioFactor = Math.min(
      requestedFactor,
      lifeClass.maxEvolutionRateFactor ?? requestedFactor,
    );
    const rate =
      (mutationRate *
        state.effectiveControls.mutationRate *
        state.effectiveControls.advanceRate *
        share *
        scenarioFactor *
        evolutionBoost(state, lifeClass, dtYears)) /
      evolutionTimeYears(lifeClass);
    const progressBefore = memory.evolutionProgress[c]!;
    const progressAfter = progressBefore + rate * dtYears;
    memory.evolutionProgress[c] = progressAfter;
    if (progressAfter >= memory.evolutionThresholds[c]!) {
      const eventYear = globals.year + (memory.evolutionThresholds[c]! - progressBefore) / rate;
      biota.populations[c * n + bestCell] = FOUNDER_POPULATION;
      const first = biota.appeared[c] === null;
      if (first) biota.appeared[c] = eventYear;
      recordEvent(state, 'classAppeared', lifeClass.key, eventYear, bestCell);
      if (first && lifeClass.firstAnimals) {
        recordEvent(state, 'cambrianExplosion', undefined, eventYear);
      }
      const evolutionRng = createRng(memory.evolutionRngState);
      memory.evolutionProgress[c] = 0;
      memory.evolutionThresholds[c] = exponentialThreshold(evolutionRng);
      memory.evolutionRngState = evolutionRng.state;
    }
  });
}

/**
 * Multiplier on a class's evolution rate this step: the oxygen gate and
 * post-snowball window of the first animals, the Cambrian burst of animal
 * classes after them, and adaptive radiation after a mass extinction. Each window
 * counts by its overlap with the step, so the expected number of originations
 * does not depend on the step length.
 */
export function evolutionBoost(state: PlanetState, lifeClass: LifeClass, dtYears: number): number {
  const { globals, biota } = state;
  const start = globals.year;
  let boost = windowBoost(
    start,
    dtYears,
    globals.lastMassExtinctionYear,
    RECOVERY_WINDOW,
    RADIATION_BOOST,
  );
  if (lifeClass.firstAnimals) {
    if (oxygenPartialPressure(globals.atmosphere) < CAMBRIAN_OXYGEN) return 0;
    boost *= windowBoost(
      start,
      dtYears,
      lastSnowballEnd(state),
      POST_SNOWBALL_WINDOW,
      POST_SNOWBALL_BOOST,
    );
  }
  if (lifeClass.cambrianRadiation) {
    const firstAnimals = LIFE_CLASSES.findIndex((other) => other.firstAnimals);
    boost *= windowBoost(
      start,
      dtYears,
      biota.appeared[firstAnimals] ?? null,
      CAMBRIAN_WINDOW,
      CAMBRIAN_BOOST,
    );
  }
  return boost;
}

/**
 * Year the most recent snowball glaciation (global ice fraction above
 * SNOWBALL_ICE_FRACTION) ended, from the recorded history; null if none has.
 */
export function lastSnowballEnd(state: PlanetState): number | null {
  const { year, iceFraction } = state.history;
  for (let k = iceFraction.length - 1; k > 0; k--) {
    if (iceFraction[k - 1]! >= SNOWBALL_ICE_FRACTION && iceFraction[k]! < SNOWBALL_ICE_FRACTION) {
      return year[k]!;
    }
  }
  return null;
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

/**
 * Updates class cover, biodiversity, the vegetation field and the most advanced
 * tier per cell, and detects mass extinctions.
 */
function summarize(state: PlanetState, dtYears: number, tally: StressTally): void {
  const { grid, biota, fields } = state;
  const n = grid.cellCount;
  const before = biota.cover;
  biota.cover = classTotals(state);
  LIFE_CLASSES.forEach((lifeClass, c) => {
    if (before[c]! > 0 && biota.cover[c] === 0) recordEvent(state, 'classExtinct', lifeClass.key);
  });
  state.globals.biodiversity = biodiversityIndex(biota.cover);
  detectMassExtinction(state, dtYears, tally, complexBiomass(before));
  const plants = lifeClassIndex('plants');
  fields.vegetation.set(biota.populations.subarray(plants * n, (plants + 1) * n));
  updateLifeMapFields(state);
}

/** Population at which a class is legible enough to count as present on the map. */
const MAP_PRESENCE_POPULATION = 0.05;
/**
 * A later class with at least a quarter of the largest population wins the silhouette:
 * plants and algae are naturally denser than the animals that live on them.
 */
const ADVANCED_DOMINANCE_RATIO = 0.25;

/**
 * Chooses the dominant class in one cell. LIFE_CLASSES is ordered from simpler
 * to more advanced, so a later class wins when it is close to the true maximum.
 */
export function dominantClassForCell(
  populations: ArrayLike<number>,
  cellCount: number,
  cell: number,
): number {
  let dominant = -1;
  let largest = MAP_PRESENCE_POPULATION;
  for (let c = 0; c < LIFE_CLASS_COUNT; c++) {
    const population = populations[c * cellCount + cell]!;
    if (population < MAP_PRESENCE_POPULATION) continue;
    if (population > largest) {
      largest = population;
      dominant = c;
    } else if (population >= largest * ADVANCED_DOMINANCE_RATIO) {
      dominant = c;
    }
  }
  return dominant;
}

/** Updates both compact life fields in one allocation-free pass over the grid. */
export function updateLifeMapFields(state: PlanetState): void {
  const { grid, biota, fields } = state;
  const n = grid.cellCount;
  fields.lifeTier.fill(0);
  fields.dominantClass.fill(-1);
  for (let i = 0; i < n; i++) {
    let dominant = -1;
    let largest = MAP_PRESENCE_POPULATION;
    for (let c = 0; c < LIFE_CLASS_COUNT; c++) {
      if (biota.cover[c] === 0) continue;
      const population = biota.populations[c * n + i]!;
      if (population < MAP_PRESENCE_POPULATION) continue;
      const tier = LIFE_TIERS.indexOf(LIFE_CLASSES[c]!.tier) + 1;
      if (tier > fields.lifeTier[i]!) fields.lifeTier[i] = tier;
      if (population > largest) {
        largest = population;
        dominant = c;
      } else if (population >= largest * ADVANCED_DOMINANCE_RATIO) {
        dominant = c;
      }
    }
    fields.dominantClass[i] = dominant;
  }
}

/**
 * A mass extinction is a loss of MASS_EXTINCTION_LOSS of complex biomass against
 * a reference that holds the recent peak and fades with BIOMASS_MEMORY_TIME, so
 * only fast collapses count, whatever the step length. One event per episode,
 * with the stressor that removed the most carrying capacity as its cause (an
 * impact in the step when no stressor explains the loss).
 */
function detectMassExtinction(
  state: PlanetState,
  dtYears: number,
  tally: StressTally,
  exposedBiomass: number,
): void {
  const memory = ecology(state);
  const biomass = complexBiomass(state.biota.cover);
  if (!(dtYears > 0)) return;
  const reference = memory.biomassReference * Math.exp(-dtYears / BIOMASS_MEMORY_TIME);
  const biosphere = Math.max(
    biomass,
    memory.biosphereReference * Math.exp(-dtYears / BIOSPHERE_MEMORY_TIME),
  );
  memory.biosphereReference = biosphere;
  const { globals } = state;
  const end = globals.year + dtYears;
  const quiet =
    globals.lastMassExtinctionYear < 0 ||
    end - globals.lastMassExtinctionYear >= EXTINCTION_EPISODE_GAP;
  if (
    reference >= MIN_REFERENCE_BIOMASS &&
    biomass < (1 - MASS_EXTINCTION_LOSS) * reference &&
    reference - biomass >= MIN_LOSS_OF_BIOSPHERE * biosphere &&
    quiet
  ) {
    globals.lastMassExtinctionYear = end;
    recordEvent(
      state,
      'massExtinction',
      extinctionCause(state, tally, exposedBiomass, dtYears),
      end,
    );
    // A new episode needs a new collapse from here.
    memory.biomassReference = biomass;
    return;
  }
  memory.biomassReference = Math.max(biomass, reference);
}

function extinctionCause(
  state: PlanetState,
  tally: StressTally,
  exposedBiomass: number,
  dtYears: number,
): ExtinctionCause {
  let cause: ExtinctionCause = 'climateChange';
  let largest = 0;
  for (const stressor of Object.keys(tally) as Stressor[]) {
    if (tally[stressor] > largest) {
      largest = tally[stressor];
      cause = stressor;
    }
  }
  // Tallies are in units of the complex biomass exposed at the start of the step; a
  // stressor that cut less than a tenth of it does not explain the collapse.
  if (largest < 0.1 * exposedBiomass) {
    const since = state.globals.year - dtYears;
    if (state.events.some((event) => event.key === 'impact' && event.year >= since)) {
      return 'impact';
    }
  }
  return cause;
}
