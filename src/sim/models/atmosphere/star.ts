import type { SimComponent } from '../../core/component';

/** Age of the present-day Sun in years. */
export const SUN_AGE = 4.57e9;
/** Age at which a Sun-like star leaves the main sequence and the planet's story ends. */
export const STAR_LIFETIME = 10e9;
/** Solar constant of the present-day Sun at Earth, W/m². */
export const SOLAR_CONSTANT = 1361;

/**
 * Luminosity of a Sun-like star relative to the present Sun (Gough 1981):
 * about 70% at birth, 100% at 4.57 Gyr, and rising steeply towards the end of
 * the main sequence (the "faint young Sun" that SimEarth also models).
 */
export function stellarLuminosity(ageYears: number): number {
  const age = Math.min(ageYears, STAR_LIFETIME);
  return 1 / (1 + 0.4 * (1 - age / SUN_AGE));
}

/** Updates the star's luminosity from the planet's age. */
export const stellarEvolution: SimComponent = {
  name: 'stellarEvolution',
  inputs: [],
  outputs: [],
  runOneStep(state) {
    state.globals.solarInput = stellarLuminosity(state.globals.year) * state.controls.solarFactor;
  },
};
