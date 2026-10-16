import type { LifeClassKey } from './lifeClasses';

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
  /** CO₂ emitted per billion people per year, ppm (fossil fuels). */
  emissions: number;
  /** Yearly chance of nuclear war per civilization, once weapons exist. */
  warRisk: number;
  /** Can cross narrow seas (boats). */
  seafaring: boolean;
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
  },
];

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
  mollusks: 0.03,
  reptiles: 0.02,
  trichordates: 0.01,
  insects: 0.01,
  amphibians: 0.01,
  fish: 0.005,
  arthropods: 0.005,
};
