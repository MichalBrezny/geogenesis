import type { SimComponent } from './core/component';
import type { PlanetState } from './core/planet';
import { TECH_AGES } from './data/civilization';
import { LIFE_CLASSES } from './data/lifeClasses';
import { recordEvent } from './events';

/**
 * Eras of a planet's history, after SimEarth's time scales. Each runs at its own
 * pace, so quiet stretches pass quickly and the player has time for the details
 * once there is life, and then a civilization, to look after.
 */
export const ERAS = ['geological', 'evolution', 'civilization', 'technology'] as const;
export type Era = (typeof ERAS)[number];

/** Years per step while the planet holds only microbes. */
export const GEOLOGICAL_ERA_STEP = 2e6;
/** Years per step once complex (multicellular) life exists. */
export const EVOLUTION_ERA_STEP = 0.5e6;
/** The tech age that starts the technology era. */
const FIRST_TECHNOLOGY_AGE = TECH_AGES.findIndex((age) => age.key === 'industrial');

/**
 * The planet's current era: geological while only microbes live, evolution once
 * complex life exists, civilization from sentience, technology from the
 * Industrial Age. After an Exodus or a collapse the planet returns to evolution.
 */
export function planetEra(state: PlanetState): Era {
  const civ = state.civilization;
  if (civ.species !== null) {
    return civ.age >= FIRST_TECHNOLOGY_AGE ? 'technology' : 'civilization';
  }
  const complexLife = LIFE_CLASSES.some(
    (lifeClass, c) => lifeClass.tier !== 'microbes' && state.biota.cover[c]! > 0,
  );
  return complexLife ? 'evolution' : 'geological';
}

/** Simulated years the next step covers: set by the era, and by the tech age once sentient. */
export function eraStepYears(state: PlanetState): number {
  switch (planetEra(state)) {
    case 'geological':
      return GEOLOGICAL_ERA_STEP;
    case 'evolution':
      return EVOLUTION_ERA_STEP;
    default:
      return TECH_AGES[state.civilization.age]!.yearsPerStep;
  }
}

/** Records the moment the planet enters a new era; runs last in the step. */
export const eraTracker: SimComponent = {
  name: 'era',
  inputs: [],
  outputs: [],
  runOneStep(state) {
    const era = planetEra(state);
    const previous = state.globals.era;
    if (previous !== undefined && previous !== era) recordEvent(state, 'eraReached', era);
    state.globals.era = era;
  },
};
