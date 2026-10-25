import type { Atmosphere } from '../../core/planet';
import { oxygenPartialPressure } from '../atmosphere/atmosphere';

/**
 * What a distant astronomer would conclude from the planet's spectrum. Oxygen and
 * methane destroy each other within years, so seeing both at once needs a living
 * source; either gas alone could still come from geology or photochemistry.
 */
export type Biosignature = 'none' | 'possible' | 'detected';

/** Oxygen partial pressure (bar) visible in a spectrum: ~0.1 % of present Earth's. */
const DETECTABLE_OXYGEN = 2e-4;
/** Methane (µbar) visible alongside oxygen, and alone in an anoxic atmosphere. */
const DETECTABLE_METHANE = 0.1;
const SUSPICIOUS_METHANE = 10;

export function biosignature(atmosphere: Atmosphere): Biosignature {
  const oxygen = oxygenPartialPressure(atmosphere) >= DETECTABLE_OXYGEN;
  if (oxygen && atmosphere.ch4 >= DETECTABLE_METHANE) return 'detected';
  return oxygen || atmosphere.ch4 >= SUSPICIOUS_METHANE ? 'possible' : 'none';
}
