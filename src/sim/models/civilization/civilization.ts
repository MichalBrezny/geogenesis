import type { SimComponent } from '../../core/component';
import {
  DEFAULT_CIV_POLICY,
  ENERGY_SOURCE_KEYS,
  type EnergySourceKey,
  type PlanetState,
} from '../../core/planet';
import { createRng, type Rng } from '../../core/rng';
import type { Biome } from '../../data/biomes';
import {
  ENERGY_SOURCES,
  energySourceUnlocked,
  EXODUS_MIN_POPULATION,
  PEOPLE_PER_KM2,
  SENTIENCE_POTENTIAL,
  TECH_AGES,
} from '../../data/civilization';
import { LIFE_CLASSES, lifeClassIndex, PLANT_PRODUCTIVITY } from '../../data/lifeClasses';
import { recordEvent } from '../../events';
import { gtCarbonPerMicrobar } from '../atmosphere/carbon';
import { addDustPulse, DUST_SOOT } from '../atmosphere/dust';
import { classSuitability } from '../biosphere/life';
import { disperse } from '../dispersal';
import { isOcean } from '../geosphere/seaLevel';
import { droughtFoodMultiplier } from '../disasters';

export interface CivilizationOptions {
  /** Mean years for a fully established, most capable class to become sentient. */
  sentienceTime?: number;
}

/** Mean years for a fully established candidate with potential 1 to become sentient. */
export const SENTIENCE_TIME = 150e6;

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
/** Soot optical depth of a full-scale nuclear war (Toon et al. 2007: tau 1-3). */
const NUCLEAR_SOOT_TAU = 2;
/** World population (billions) below which a civilization is gone. */
const COLLAPSE_POPULATION = 1e-5;
/** Mature seafaring can connect continents across ocean passages up to 5,000 km. */
const SEA_CROSSING = 5_000_000;
/** Atmospheric/industrial pollution residence time. */
export const POLLUTION_RESIDENCE_TIME = 50;
/** Reserve at which extraction supplies half of unconstrained fossil demand. */
const FOSSIL_EXTRACTION_HALF = 500;
/** Pollution-index source per billion people per year at a 100% fossil mix. */
const POLLUTION_RATE = 0.005;
/** Earth-like population at which the global emissions calibration is unchanged. */
const EARTH_CIVILIZATION_POPULATION = 7;

declare module '../../core/planet' {
  interface CivilizationState {
    /** Integrated pre-sentience hazard, retained across simulation steps. */
    sentienceProgress?: number;
    /** Seeded exponential threshold for the next sentience event. */
    sentienceThreshold?: number;
    /** Private deterministic stream for sentience thresholds and species choice. */
    sentienceRngState?: number;
    /** Integrated plague and war hazards, with thresholds from a private RNG stream. */
    plagueProgress?: number;
    plagueThreshold?: number;
    warProgress?: number;
    warThreshold?: number;
    catastropheRngState?: number;
    fossilDominantSeen?: boolean;
    energyTransitionRecorded?: boolean;
    fossilWarningRecorded?: boolean;
    pollutionCrisisRecorded?: boolean;
    exodusPopulationWarningRecorded?: boolean;
  }
}

/**
 * Sentience and civilization.
 *
 * Before any species is sentient, established animal classes have a small
 * chance to become sentient, weighted by their potential (mammals and birds
 * most, but even mollusks can). The civilization then grows where its species
 * can live and its food allows — farming and industry raise how much of the
 * land's production it can use — spreads at its age's speed (and over
 * ocean passages once seafaring), clears vegetation, and advances through the tech
 * ages. Industry burns fossil fuels, warming the planet; plagues and nuclear
 * wars set it back; finishing the Nanotech age with at least the minimum
 * population means Exodus: the civilization leaves the planet.
 */
export function createCivilization(options: CivilizationOptions = {}): SimComponent {
  const sentienceTime = options.sentienceTime ?? SENTIENCE_TIME;
  return {
    name: 'civilization',
    inputs: ['elevation', 'biome', 'vegetation'],
    outputs: ['civilization', 'vegetation'],
    runOneStep(state, dtYears, rng) {
      const civ = state.civilization;
      ensureSentienceMemory(state, rng);
      if (civ.species === null) {
        state.fields.civilization.fill(0);
        state.globals.civilizationCarbonEmissions = 0;
        updatePollution(state, dtYears, 0);
        if (dtYears > 0) maybeBecomeSentient(state, dtYears, sentienceTime);
        return;
      }
      if (state.biota.cover[civ.species] === 0) {
        endCivilization(state, 'civilizationCollapsed');
        return;
      }
      if (dtYears <= 0) return;
      const populationBefore = civ.population;
      const production = civilizationProduction(state);
      civ.energySupply = production.energySupply;
      const investments = state.civPolicy.investment;
      const science = investmentMultiplier(investments.science, 0.15);
      const agriculture = investmentMultiplier(investments.agriculture, 0.1);
      const cultureGrowth = 1.1 - 0.5 * (investments.culture / 100);
      const cultureStability = 0.8 + investments.culture / 100;
      const pollutionHealth = 1 / (1 + 0.18 * Math.max(0, state.globals.pollution));
      const capacity = carryingCapacity(state, civ.species, agriculture * pollutionHealth);
      settle(
        state,
        capacity,
        dtYears,
        rng,
        production.energySupply * cultureGrowth * pollutionHealth,
      );
      applyScienceOverreach(state, dtYears, science, production.energySupply, cultureStability);
      clearLand(state, capacity, production.mix.biomass);
      civ.population = worldPopulation(state);
      if (civ.population < COLLAPSE_POPULATION) {
        endCivilization(state, 'civilizationCollapsed');
        return;
      }
      const age = TECH_AGES[civ.age]!;
      const meanPopulation = (populationBefore + civ.population) / 2;
      emitCarbonAndPollution(state, age.emissions, meanPopulation, dtYears, production);
      recordPolicyEvents(state, production.mix);
      catastrophes(state, dtYears, rng, production, cultureStability);
      advanceTechnology(state, dtYears, production.energySupply * science);
    },
  };
}

function maybeBecomeSentient(state: PlanetState, dtYears: number, sentienceTime: number) {
  const candidates = sentienceCandidates(state);
  const total = candidates.reduce((sum, w) => sum + w, 0);
  if (total === 0) return;
  const civ = state.civilization;
  const progressBefore = civ.sentienceProgress!;
  const rate = total / sentienceTime;
  civ.sentienceProgress = progressBefore + rate * dtYears;
  if (civ.sentienceProgress < civ.sentienceThreshold!) return;

  const sentienceRng = createRng(civ.sentienceRngState!);
  let pick = sentienceRng.next() * total;
  const species = candidates.findIndex((weight) => (pick -= weight) < 0);
  // The first band appears where the species is most numerous.
  const n = state.grid.cellCount;
  let home = 0;
  for (let i = 1; i < n; i++) {
    if (state.biota.populations[species * n + i]! > state.biota.populations[species * n + home]!) {
      home = i;
    }
  }
  const eventYear = state.globals.year + (civ.sentienceThreshold! - progressBefore) / rate;
  makeSentient(state, species, home, eventYear);
  civ.sentienceProgress = 0;
  civ.sentienceThreshold = exponentialThreshold(sentienceRng);
  civ.sentienceRngState = sentienceRng.state;
}

function sentienceCandidates(state: PlanetState): number[] {
  const candidates = LIFE_CLASSES.map(() => 0);
  const relevant: number[] = [];
  for (let c = 0; c < LIFE_CLASSES.length; c++) {
    // A class with no population anywhere occupies no habitat, so its weight is zero.
    if ((SENTIENCE_POTENTIAL[LIFE_CLASSES[c]!.key] ?? 0) > 0 && hasPopulation(state, c)) {
      relevant.push(c);
    }
  }
  if (relevant.length === 0) return candidates;

  const { grid, fields, biota, globals } = state;
  const occupied = LIFE_CLASSES.map(() => 0);
  let landHabitat = 0;
  let oceanHabitat = 0;
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      const ocean = isOcean(fields.elevation[i]!, globals.seaLevel);
      if (ocean) oceanHabitat += weight;
      else landHabitat += weight;
      for (const c of relevant) {
        if (
          (LIFE_CLASSES[c]!.habitat === 'ocean') === ocean &&
          biota.populations[c * grid.cellCount + i]! > 0
        ) {
          occupied[c] = occupied[c]! + weight;
        }
      }
    }
  }
  for (const c of relevant) {
    const habitat = LIFE_CLASSES[c]!.habitat === 'ocean' ? oceanHabitat : landHabitat;
    const share = habitat > 0 ? occupied[c]! / habitat : 0;
    if (share >= MIN_HABITAT_SHARE) {
      candidates[c] =
        SENTIENCE_POTENTIAL[LIFE_CLASSES[c]!.key]! * Math.min(1, share / FULL_HABITAT_SHARE);
    }
  }
  return candidates;
}

function hasPopulation(state: PlanetState, c: number): boolean {
  const n = state.grid.cellCount;
  const populations = state.biota.populations;
  for (let i = c * n, end = i + n; i < end; i++) if (populations[i]! > 0) return true;
  return false;
}

function ensureSentienceMemory(state: PlanetState, rng: Rng): void {
  const civ = state.civilization;
  if (
    civ.sentienceProgress !== undefined &&
    civ.sentienceThreshold !== undefined &&
    civ.sentienceRngState !== undefined
  ) {
    return;
  }
  const sentienceRng = createRng((rng.state ^ 0x73656e74) >>> 0);
  civ.sentienceProgress = 0;
  civ.sentienceThreshold = exponentialThreshold(sentienceRng);
  civ.sentienceRngState = sentienceRng.state;
}

function exponentialThreshold(rng: Rng): number {
  return -Math.log(1 - rng.next());
}

export interface CivilizationProduction {
  /** Effective shares of sources that are unlocked in this age, as fractions. */
  mix: Record<EnergySourceKey, number>;
  energySupply: number;
  fossilAvailability: number;
}

/** Unlocked requested sources are normalized; if none are unlocked, the default available mix is used. */
export function effectiveEnergyMix(state: PlanetState): Record<EnergySourceKey, number> {
  const age = state.civilization.age;
  const requested = state.civPolicy.energy;
  const availableTotal = ENERGY_SOURCE_KEYS.reduce(
    (sum, key) => sum + (energySourceUnlocked(key, age) ? Math.max(0, requested[key]) : 0),
    0,
  );
  const source = availableTotal > 0 ? requested : DEFAULT_CIV_POLICY.energy;
  const total = ENERGY_SOURCE_KEYS.reduce(
    (sum, key) => sum + (energySourceUnlocked(key, age) ? Math.max(0, source[key]) : 0),
    0,
  );
  return Object.fromEntries(
    ENERGY_SOURCE_KEYS.map((key) => [
      key,
      energySourceUnlocked(key, age) && total > 0 ? Math.max(0, source[key]) / total : 0,
    ]),
  ) as Record<EnergySourceKey, number>;
}

/** Energy supply from policy, age efficiencies, finite fossil extraction and hydro/geothermal limits. */
export function civilizationProduction(state: PlanetState): CivilizationProduction {
  const age = state.civilization.age;
  const mix = effectiveEnergyMix(state);
  const fossilAvailability =
    state.globals.fossilCarbon / (state.globals.fossilCarbon + FOSSIL_EXTRACTION_HALF);
  const hydroCap = hydroGeothermalCap(state);
  const output = (shares: Record<EnergySourceKey, number>, constrainFossil: boolean) =>
    ENERGY_SOURCE_KEYS.reduce((sum, key) => {
      let available = 1;
      if (key === 'fossil' && constrainFossil) available = fossilAvailability;
      if (key === 'hydroGeothermal' && shares[key] > hydroCap) available = hydroCap / shares[key];
      return sum + shares[key] * ENERGY_SOURCES[key].efficiency[age]! * available;
    }, 0);
  const defaultMix = effectiveMixForPolicy(DEFAULT_CIV_POLICY.energy, age);
  const baseline = Math.max(0.05, output(defaultMix, false));
  return {
    mix,
    energySupply: Math.max(0, Math.min(2, output(mix, true) / baseline)),
    fossilAvailability,
  };
}

function effectiveMixForPolicy(
  policy: Readonly<Record<EnergySourceKey, number>>,
  age: number,
): Record<EnergySourceKey, number> {
  const total = ENERGY_SOURCE_KEYS.reduce(
    (sum, key) => sum + (energySourceUnlocked(key, age) ? policy[key] : 0),
    0,
  );
  return Object.fromEntries(
    ENERGY_SOURCE_KEYS.map((key) => [
      key,
      energySourceUnlocked(key, age) && total > 0 ? policy[key] / total : 0,
    ]),
  ) as Record<EnergySourceKey, number>;
}

function hydroGeothermalCap(state: PlanetState): number {
  let relief = 0;
  let land = 0;
  for (let i = 0; i < state.grid.cellCount; i++) {
    const height = state.fields.elevation[i]! - state.globals.seaLevel;
    if (height <= 0) continue;
    relief += Math.min(6000, height);
    land++;
  }
  const meanRelief = land > 0 ? relief / land : 0;
  return Math.min(0.35, 0.06 + meanRelief / 12_000 + 0.03 * state.globals.carbon.outgassing);
}

function investmentMultiplier(share: number, slope: number): number {
  return Math.max(0.25, 1 + slope * (share / 20 - 1));
}

function applyScienceOverreach(
  state: PlanetState,
  dtYears: number,
  science: number,
  energySupply: number,
  cultureStability: number,
): void {
  const overreach = Math.max(0, science - energySupply - 0.25);
  if (overreach === 0) return;
  const survival = Math.exp((-0.00015 * overreach * dtYears) / cultureStability);
  for (let i = 0; i < state.fields.civilization.length; i++) {
    state.fields.civilization[i] = state.fields.civilization[i]! * survival;
  }
}

function emitCarbonAndPollution(
  state: PlanetState,
  baselineEmissions: number,
  population: number,
  dtYears: number,
  production: CivilizationProduction,
): void {
  const defaultMix = effectiveMixForPolicy(DEFAULT_CIV_POLICY.energy, state.civilization.age);
  const defaultFossil = Math.max(0.01, defaultMix.fossil);
  // A small civilization concentrates industry in its inhabited area instead of
  // diluting it over an empty planet. The sub-linear scale makes island societies
  // environmentally visible, while remaining exactly 7 billion at Earth's calibration.
  const environmentalPopulation = civilizationEnvironmentalScale(population);
  const desiredMicrobar =
    baselineEmissions * environmentalPopulation * dtYears * (production.mix.fossil / defaultFossil);
  const desiredCarbon = desiredMicrobar * gtCarbonPerMicrobar(state);
  const fossilBurned = burnFossilCarbon(state, desiredCarbon, dtYears);
  state.civilization.fossilSupply = desiredCarbon > 0 ? fossilBurned / desiredCarbon : 1;
  // Biomass smoke and clearing return a small amount of recently fixed carbon; fossil
  // carbon is the dominant industrial source and is strictly limited by the reserve.
  const biomassCarbon =
    baselineEmissions *
    environmentalPopulation *
    dtYears *
    ENERGY_SOURCES.biomass.co2 *
    (production.mix.biomass / defaultFossil) *
    gtCarbonPerMicrobar(state);
  state.globals.civilizationCarbonEmissions = fossilBurned + biomassCarbon;

  const pollutionIntensity = ENERGY_SOURCE_KEYS.reduce(
    (sum, key) => sum + production.mix[key] * ENERGY_SOURCES[key].pollution,
    0,
  );
  updatePollution(state, dtYears, environmentalPopulation * pollutionIntensity * POLLUTION_RATE);
}

/** Effective population for planet-wide emissions and pollution (billions). */
export function civilizationEnvironmentalScale(population: number): number {
  if (!(population > 0)) return 0;
  if (population >= EARTH_CIVILIZATION_POPULATION) return population;
  return EARTH_CIVILIZATION_POPULATION * (population / EARTH_CIVILIZATION_POPULATION) ** 0.72;
}

/** Depletes the reserve with extraction becoming progressively harder at low inventory. */
export function burnFossilCarbon(
  state: PlanetState,
  desiredCarbon: number,
  dtYears: number,
): number {
  if (!(desiredCarbon > 0) || !(dtYears > 0)) return 0;
  const desiredRate = desiredCarbon / dtYears;
  let remaining = Math.max(0, state.globals.fossilCarbon);
  const before = remaining;
  // A scalar five-year integration is cheap and keeps 5..2000-year civilization
  // steps close while extraction responds continuously to depletion.
  const pieces = Math.max(1, Math.ceil(dtYears / 5));
  const h = dtYears / pieces;
  for (let k = 0; k < pieces && remaining > 0; k++) {
    const extracted = desiredRate * (remaining / (remaining + FOSSIL_EXTRACTION_HALF)) * h;
    remaining -= Math.min(remaining, extracted);
  }
  state.globals.fossilCarbon = remaining;
  return before - remaining;
}

/** Exact source-plus-exponential-decay integration; returns the interval mean burden. */
export function updatePollution(state: PlanetState, dtYears: number, sourceRate: number): number {
  const before = Math.max(0, state.globals.pollution);
  if (!(dtYears > 0)) return before;
  const retained = Math.exp(-dtYears / POLLUTION_RESIDENCE_TIME);
  const source = Math.max(0, sourceRate);
  const end = before * retained + source * POLLUTION_RESIDENCE_TIME * (1 - retained);
  const integral =
    before * POLLUTION_RESIDENCE_TIME * (1 - retained) +
    source * POLLUTION_RESIDENCE_TIME * (dtYears - POLLUTION_RESIDENCE_TIME * (1 - retained));
  state.globals.pollution = end;
  return integral / dtYears;
}

function recordPolicyEvents(state: PlanetState, mix: Record<EnergySourceKey, number>): void {
  const civ = state.civilization;
  if (mix.fossil > 0.5) civ.fossilDominantSeen = true;
  if (civ.fossilDominantSeen && !civ.energyTransitionRecorded && mix.fossil < 0.2) {
    civ.energyTransitionRecorded = true;
    recordEvent(state, 'energyTransition');
  }
  if (!civ.fossilWarningRecorded && mix.fossil >= 0.2 && civ.fossilSupply < 0.5) {
    civ.fossilWarningRecorded = true;
    recordEvent(state, 'fossilFuelsRunningOut');
  }
  if (!civ.pollutionCrisisRecorded && state.globals.pollution >= 1) {
    civ.pollutionCrisisRecorded = true;
    recordEvent(state, 'pollutionCrisis');
  }
}

/** Area share of the class's physical habitat in which it has an extant population. */
export function occupiedHabitatShare(state: PlanetState, species: number): number {
  const { grid, fields, biota, globals } = state;
  const oceanSpecies = LIFE_CLASSES[species]!.habitat === 'ocean';
  const offset = species * grid.cellCount;
  let habitat = 0;
  let occupied = 0;
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (isOcean(fields.elevation[i]!, globals.seaLevel) !== oceanSpecies) continue;
      habitat += weight;
      if (biota.populations[offset + i]! > 0) occupied += weight;
    }
  }
  return habitat > 0 ? occupied / habitat : 0;
}

/** Makes a life class sentient, with its first band in cell `home`. */
export function makeSentient(
  state: PlanetState,
  species: number,
  home: number,
  eventYear = state.globals.year,
): void {
  const civ = state.civilization;
  civ.species = species;
  civ.age = 0;
  civ.progress = 0;
  civ.sentientSince = eventYear;
  civ.energySupply = 1;
  civ.fossilSupply = 1;
  civ.fossilDominantSeen = false;
  civ.energyTransitionRecorded = false;
  civ.fossilWarningRecorded = false;
  civ.pollutionCrisisRecorded = false;
  civ.exodusPopulationWarningRecorded = false;
  civ.plagueProgress = 0;
  civ.warProgress = 0;
  state.fields.civilization.fill(0);
  state.fields.civilization[home] = TECH_AGES[0]!.foodUse * 0.5;
  civ.population = worldPopulation(state);
  recordEvent(state, 'sentience', LIFE_CLASSES[species]!.key, eventYear, home);
}

/** Densest settlement (fraction of PEOPLE_PER_KM2) each cell can feed in the current age. */
function carryingCapacity(state: PlanetState, species: number, policyMultiplier = 1): Float32Array {
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
    capacity[i] =
      capacity[i]! * food * foodUse * droughtFoodMultiplier(state, i) * policyMultiplier;
  }
  return capacity;
}

function settle(
  state: PlanetState,
  capacity: Float32Array,
  dtYears: number,
  rng: Rng,
  growthMultiplier = 1,
): void {
  const density = state.fields.civilization;
  const age = TECH_AGES[state.civilization.age]!;
  const growth = 1 - Math.exp(-age.growthRate * Math.max(0, growthMultiplier) * dtYears);
  for (let i = 0; i < density.length; i++) {
    if (density[i]! <= MIN_DENSITY) continue;
    density[i] = density[i]! + (capacity[i]! - density[i]!) * growth;
    if (density[i]! < MIN_DENSITY) density[i] = 0;
  }
  disperse(state.grid, {
    dtYears,
    speed: age.spreadSpeed,
    reach: age.seafaring ? SEA_CROSSING : 0,
    rng,
    isSource: (i) => density[i]! > MIN_DENSITY,
    canEnter: (i) => density[i]! <= MIN_DENSITY && capacity[i]! > 0,
    settle: (i, remaining) => {
      const grown =
        capacity[i]! *
        (1 - Math.exp(-age.growthRate * Math.max(0, growthMultiplier) * remaining * dtYears));
      density[i] = Math.max(grown, Math.min(capacity[i]!, 2 * MIN_DENSITY));
    },
  });
}

/** Farms and cities replace vegetation in proportion to how fully a cell is settled. */
function clearLand(state: PlanetState, capacity: Float32Array, biomassShare = 0): void {
  const { fields, biota, grid } = state;
  const n = grid.cellCount;
  const plants = lifeClassIndex('plants');
  const landUse = TECH_AGES[state.civilization.age]!.landUse * (1 + 0.6 * biomassShare);
  for (let i = 0; i < n; i++) {
    if (isOcean(fields.elevation[i]!, state.globals.seaLevel)) continue;
    const settled = capacity[i]! > 0 ? Math.min(1, fields.civilization[i]! / capacity[i]!) : 0;
    fields.vegetation[i] = biota.populations[plants * n + i]! * (1 - landUse * settled);
  }
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

function catastrophes(
  state: PlanetState,
  dtYears: number,
  rng: Rng,
  production: CivilizationProduction,
  cultureStability: number,
): void {
  const civ = state.civilization;
  const age = TECH_AGES[civ.age]!;
  const density = state.fields.civilization;
  ensureCatastropheMemory(civ, rng);
  const medicine = 1.25 - 1.25 * (state.civPolicy.investment.medicine / 100);
  if (civ.age >= 1 && hazardOccurs(civ, 'plague', PLAGUE_RATE * medicine, dtYears)) {
    const survival = 1 - Math.min(0.5, 0.3 * medicine);
    for (let i = 0; i < density.length; i++) density[i] = density[i]! * survival;
    recordEvent(state, 'plague');
  }
  const philosophy = 1.25 - 1.25 * (state.civPolicy.investment.philosophy / 100);
  const scarcity = Math.max(0, 1 - civ.fossilSupply) * (production.mix.fossil > 0.2 ? 1 : 0);
  const nuclearRisk = production.mix.nuclear * ENERGY_SOURCES.nuclear.risk;
  const warRate =
    civ.age >= 4
      ? ((age.warRisk + nuclearRisk + 0.002 * scarcity) * philosophy) / cultureStability
      : 0;
  if (warRate > 0 && hazardOccurs(civ, 'war', warRate, dtYears)) {
    for (let i = 0; i < density.length; i++) density[i] = density[i]! * 0.3;
    // The survivors lose much of what the age had achieved, but not the age itself.
    civ.progress = Math.max(0, civ.progress - 0.5);
    // Nuclear winter: stratospheric soot, tau ~2 (Toon et al. 2007), injected at the
    // end of the step because this component runs after the dust model.
    addDustPulse(state, DUST_SOOT, NUCLEAR_SOOT_TAU, state.globals.year + dtYears);
    recordEvent(state, 'nuclearWar');
  }
  civ.population = worldPopulation(state);
}

function ensureCatastropheMemory(civ: PlanetState['civilization'], rng: Rng): void {
  if (
    civ.plagueThreshold !== undefined &&
    civ.warThreshold !== undefined &&
    civ.catastropheRngState !== undefined
  ) {
    return;
  }
  const eventRng = createRng((rng.state ^ 0x63617473) >>> 0);
  civ.plagueProgress ??= 0;
  civ.warProgress ??= 0;
  civ.plagueThreshold = exponentialThreshold(eventRng);
  civ.warThreshold = exponentialThreshold(eventRng);
  civ.catastropheRngState = eventRng.state;
}

function hazardOccurs(
  civ: PlanetState['civilization'],
  kind: 'plague' | 'war',
  annualRate: number,
  dtYears: number,
): boolean {
  const progressKey = kind === 'plague' ? 'plagueProgress' : 'warProgress';
  const thresholdKey = kind === 'plague' ? 'plagueThreshold' : 'warThreshold';
  civ[progressKey] = (civ[progressKey] ?? 0) + Math.max(0, annualRate) * dtYears;
  if (civ[progressKey]! < civ[thresholdKey]!) return false;
  civ[progressKey] = civ[progressKey]! - civ[thresholdKey]!;
  const eventRng = createRng(civ.catastropheRngState!);
  civ[thresholdKey] = exponentialThreshold(eventRng);
  civ.catastropheRngState = eventRng.state;
  return true;
}

function advanceTechnology(state: PlanetState, dtYears: number, policyPace = 1): void {
  const civ = state.civilization;
  const age = TECH_AGES[civ.age]!;
  const completedNanotech =
    civ.age === TECH_AGES.length - 1 && civ.exodusPopulationWarningRecorded === true;
  if (completedNanotech) {
    // Technology stays ready even when a later hazard would otherwise set progress back.
    civ.progress = 1;
  } else {
    // Bigger populations invent faster, with strongly diminishing returns, so a small
    // species is slower but not stuck.
    const pace = technologyPopulationPace(civ.population, age.expectedPopulation);
    civ.progress += (pace * Math.max(0, policyPace) * dtYears) / age.duration;
  }
  if (civ.progress < 1) return;
  if (civ.age === TECH_AGES.length - 1) {
    civ.progress = 1;
    if (civ.population < EXODUS_MIN_POPULATION) {
      if (!civ.exodusPopulationWarningRecorded) {
        civ.exodusPopulationWarningRecorded = true;
        recordEvent(state, 'exodusPopulationTooLow');
      }
      return;
    }
    civ.exodusYear = state.globals.year;
    endCivilization(state, 'exodus');
    return;
  }
  civ.age += 1;
  civ.progress = 0;
  recordEvent(state, 'ageReached', TECH_AGES[civ.age]!.key);
}

/** Population contribution to technology speed, bounded for very small and large societies. */
export function technologyPopulationPace(population: number, expectedPopulation: number): number {
  return Math.min(2, Math.max(0.25, (population / expectedPopulation) ** 0.35));
}

function endCivilization(state: PlanetState, event: 'civilizationCollapsed' | 'exodus'): void {
  const civ = state.civilization;
  recordEvent(state, event, civ.species === null ? undefined : LIFE_CLASSES[civ.species]!.key);
  civ.species = null;
  civ.age = 0;
  civ.progress = 0;
  civ.population = 0;
  civ.sentientSince = null;
  civ.energySupply = 0;
  civ.fossilSupply = 0;
  state.globals.civilizationCarbonEmissions = 0;
  state.fields.civilization.fill(0);
}
