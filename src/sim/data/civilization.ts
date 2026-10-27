import type { CivilizationPolicy, EnergySourceKey } from '../core/planet';
import type { LifeClassKey } from './lifeClasses';

const ENERGY_SOURCE_KEYS: readonly EnergySourceKey[] = [
  'biomass',
  'fossil',
  'nuclear',
  'solarWind',
  'hydroGeothermal',
];
const INVESTMENT_KEYS = ['science', 'agriculture', 'medicine', 'philosophy', 'culture'] as const;
const DEFAULT_POLICY: CivilizationPolicy = {
  energy: {
    biomass: 20,
    fossil: 50,
    nuclear: 10,
    solarWind: 10,
    hydroGeothermal: 10,
  },
  investment: { science: 20, agriculture: 20, medicine: 20, philosophy: 20, culture: 20 },
};

/** SimEarth's technology ages, in order; reaching the end of Nanotech means Exodus. */
export interface TechAge {
  key: string;
  /** Typical length of the age in years at its expected population. */
  duration: number;
  /** World population (billions) at which the age progresses at its typical pace. */
  expectedPopulation: number;
  /** Simulated years per step while in this age (finer as history speeds up). */
  yearsPerStep: number;
  /** Share of a cell's food production the civilization can use (farming, then industry). */
  foodUse: number;
  /** Yearly population growth rate where food allows. */
  growthRate: number;
  /** Fraction of a fully settled cell's vegetation cleared for farms and cities. */
  landUse: number;
  /** Baseline fossil CO₂ emitted per billion people per year, ppm. */
  emissions: number;
  /** Yearly chance of nuclear war per civilization, once weapons exist. */
  warRisk: number;
  /** Can cross narrow seas (boats). */
  seafaring: boolean;
  /** Speed at which settlement spreads into new land, m/yr (walking, then roads, then rail). */
  spreadSpeed: number;
}

export const TECH_AGES: readonly TechAge[] = [
  {
    key: 'stone',
    duration: 50_000,
    expectedPopulation: 0.005,
    yearsPerStep: 2000,
    foodUse: 0.01,
    growthRate: 0.0005,
    landUse: 0.02,
    emissions: 0,
    warRisk: 0,
    seafaring: false,
    spreadSpeed: 80,
  },
  {
    key: 'bronze',
    duration: 3000,
    expectedPopulation: 0.05,
    yearsPerStep: 200,
    foodUse: 0.05,
    growthRate: 0.002,
    landUse: 0.1,
    emissions: 0,
    warRisk: 0,
    seafaring: false,
    spreadSpeed: 800,
  },
  {
    key: 'iron',
    duration: 2000,
    expectedPopulation: 0.2,
    yearsPerStep: 200,
    foodUse: 0.1,
    growthRate: 0.003,
    landUse: 0.2,
    emissions: 0,
    warRisk: 0,
    seafaring: true,
    spreadSpeed: 800,
  },
  {
    key: 'industrial',
    duration: 200,
    expectedPopulation: 1.5,
    yearsPerStep: 10,
    foodUse: 0.4,
    growthRate: 0.01,
    landUse: 0.4,
    emissions: 0.3,
    warRisk: 0,
    seafaring: true,
    spreadSpeed: 15000,
  },
  {
    key: 'atomic',
    duration: 60,
    expectedPopulation: 4,
    yearsPerStep: 5,
    foodUse: 0.8,
    growthRate: 0.015,
    landUse: 0.5,
    emissions: 0.35,
    warRisk: 0.004,
    seafaring: true,
    spreadSpeed: 30000,
  },
  {
    key: 'information',
    duration: 60,
    expectedPopulation: 6,
    yearsPerStep: 5,
    foodUse: 1,
    growthRate: 0.01,
    landUse: 0.5,
    emissions: 0.25,
    warRisk: 0.002,
    seafaring: true,
    spreadSpeed: 30000,
  },
  {
    key: 'nanotech',
    duration: 100,
    expectedPopulation: 7,
    yearsPerStep: 5,
    foodUse: 1.2,
    growthRate: 0.005,
    landUse: 0.4,
    emissions: 0.05,
    warRisk: 0.001,
    seafaring: true,
    spreadSpeed: 30000,
  },
];

export interface EnergySource {
  key: EnergySourceKey;
  /** First index in TECH_AGES in which this source can be used. */
  unlockAge: number;
  /** Useful output from one policy point in each technology age. */
  efficiency: readonly number[];
  /** Pollution produced per unit of energy relative to fossil fuel. */
  pollution: number;
  /** Direct CO₂ per unit of energy relative to fossil fuel. */
  co2: number;
  /** Extra annual nuclear-war/accident escalation at a 100% share. */
  risk: number;
}

/** Energy technologies and their age-dependent output. */
export const ENERGY_SOURCES: Readonly<Record<EnergySourceKey, EnergySource>> = {
  biomass: {
    key: 'biomass',
    unlockAge: 0,
    efficiency: [1, 1, 0.95, 0.75, 0.65, 0.55, 0.45],
    pollution: 0.25,
    co2: 0.12,
    risk: 0,
  },
  fossil: {
    key: 'fossil',
    unlockAge: 3,
    efficiency: [0, 0, 0, 1, 1.05, 1, 0.85],
    pollution: 1,
    co2: 1,
    risk: 0,
  },
  nuclear: {
    key: 'nuclear',
    unlockAge: 4,
    efficiency: [0, 0, 0, 0, 1, 1.1, 1.15],
    pollution: 0.08,
    co2: 0,
    risk: 0.001,
  },
  solarWind: {
    key: 'solarWind',
    unlockAge: 5,
    efficiency: [0, 0, 0, 0, 0, 0.72, 1.2],
    pollution: 0.02,
    co2: 0,
    risk: 0,
  },
  hydroGeothermal: {
    key: 'hydroGeothermal',
    unlockAge: 0,
    efficiency: [0.9, 0.95, 1, 0.95, 0.9, 0.85, 0.8],
    pollution: 0.03,
    co2: 0,
    risk: 0,
  },
};

export function energySourceUnlocked(key: EnergySourceKey, age: number): boolean {
  return age >= ENERGY_SOURCES[key].unlockAge;
}

/** Returns a defensive, normalized policy; malformed or empty groups fall back to defaults. */
export function normalizeCivilizationPolicy(
  policy: Partial<CivilizationPolicy>,
): CivilizationPolicy {
  return {
    energy: normalizeGroup(ENERGY_SOURCE_KEYS, policy.energy, DEFAULT_POLICY.energy),
    investment: normalizeGroup(INVESTMENT_KEYS, policy.investment, DEFAULT_POLICY.investment),
  };
}

export interface CivilizationPolicyChanges {
  energy?: Partial<CivilizationPolicy['energy']>;
  investment?: Partial<CivilizationPolicy['investment']>;
}

/** Applies slider changes while preserving the changed values and proportionally scaling the rest. */
export function updateCivilizationPolicy(
  current: CivilizationPolicy,
  changes: CivilizationPolicyChanges,
): CivilizationPolicy {
  return {
    energy: changes.energy
      ? updateGroup(ENERGY_SOURCE_KEYS, current.energy, changes.energy)
      : { ...current.energy },
    investment: changes.investment
      ? updateGroup(INVESTMENT_KEYS, current.investment, changes.investment)
      : { ...current.investment },
  };
}

function normalizeGroup<K extends string>(
  keys: readonly K[],
  values: Partial<Record<K, number>> | undefined,
  fallback: Readonly<Record<K, number>>,
): Record<K, number> {
  const clean = Object.fromEntries(
    keys.map((key) => [key, Math.max(0, Number.isFinite(values?.[key]) ? values![key]! : 0)]),
  ) as Record<K, number>;
  const total = keys.reduce((sum, key) => sum + clean[key], 0);
  if (!(total > 0)) return { ...fallback };
  for (const key of keys) clean[key] = (clean[key] * 100) / total;
  return clean;
}

function updateGroup<K extends string>(
  keys: readonly K[],
  current: Record<K, number>,
  changes: Partial<Record<K, number>>,
): Record<K, number> {
  const changed = keys.filter((key) => changes[key] !== undefined && Number.isFinite(changes[key]));
  if (changed.length === 0) return normalizeGroup(keys, current, current);
  const next = { ...current };
  let fixed = 0;
  for (const key of changed) {
    next[key] = Math.max(0, changes[key]!);
    fixed += next[key];
  }
  if (fixed >= 100) {
    for (const key of keys) next[key] = changed.includes(key) ? (next[key] * 100) / fixed : 0;
    return next;
  }
  const others = keys.filter((key) => !changed.includes(key));
  const oldOthers = others.reduce((sum, key) => sum + Math.max(0, current[key]), 0);
  for (const key of others) {
    next[key] =
      oldOthers > 0
        ? (Math.max(0, current[key]) * (100 - fixed)) / oldOthers
        : (100 - fixed) / others.length;
  }
  return normalizeGroup(keys, next, current);
}

/** People per km² in a cell whose food is fully used. */
export const PEOPLE_PER_KM2 = 80;

/**
 * How readily each animal class can become sentient (0 = never). As in
 * SimEarth, any animal can get there — mammals and birds just get there first.
 */
export const SENTIENCE_POTENTIAL: Partial<Record<LifeClassKey, number>> = {
  mammals: 1,
  avians: 0.3,
  cetaceans: 0.2,
  dinosaurs: 0.1,
  // Marine intelligence remains possible but rare: sea animals are established
  // hundreds of Myr before land vertebrates, so their weights must stay small.
  mollusks: 0.012,
  // Amniotes are the first broadly established land vertebrates, so they keep the
  // land route competitive while dinosaurs, birds and mammals are still radiating.
  reptiles: 0.3,
  trichordates: 0.003,
  insects: 0.01,
  amphibians: 0.01,
  fish: 0.003,
  arthropods: 0.004,
};
