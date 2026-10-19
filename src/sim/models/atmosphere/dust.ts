import type { SimComponent } from '../../core/component';
import type { DustSource, PlanetState } from '../../core/planet';

/**
 * Atmospheric dust (M13): impacts, large igneous provinces and nuclear war loft
 * dust, sulfate and soot that dim the Sun for a few years.
 *
 * Optical depth lives in three reservoirs with different fallout times. Sources
 * register themselves with the year they happen (`addDustPulse`) or as a steady
 * emission over an interval (`addDustSource`); each step this component integrates
 * every reservoir exactly (exponential decay plus the exact response to each
 * source), so the result does not depend on how the time is cut into steps.
 *
 * `globals.dust` is the MEAN optical depth over the step (integral of tau / dt),
 * like `impactHeating`: a 5-year step sees most of a winter, a 500 kyr step sees
 * almost none of it, and the integrated cooling is consistent. Life reads it as a
 * photosynthesis dimming factor exp(-dust); the climate subtracts `dustForcing`.
 */

/** Fallout e-folding times in years, per reservoir. */
export const DUST_EFOLD = [
  0.3, // fine silicate dust and ejecta: months (Toon et al. 1997 impact review)
  1.5, // stratospheric sulfate: Pinatubo-like, 1-2 years (Robock 2000)
  4, // stratospheric soot: self-lofted, several years (Toon et al. 2007, 2019)
] as const;

export type DustKind = DustSource['kind'];
export const DUST_FINE: DustKind = 0;
export const DUST_SULFATE: DustKind = 1;
export const DUST_SOOT: DustKind = 2;

/** Radiative forcing scale in W/m²: forcing = F0 (1 - exp(-tau)), about 25 W/m² at tau = 1. */
export const DUST_FORCING_SCALE = 40;

/** Cooling (W/m², positive = cooling) from a mean optical depth. Zero for clear sky. */
export function dustForcing(tau: number): number {
  return tau > 0 ? DUST_FORCING_SCALE * (1 - Math.exp(-tau)) : 0;
}

/** Optical depth currently in the sky (end of the last step), summed over reservoirs. */
export function dustBurden(state: PlanetState): number {
  return state.globals.dustBurden.reduce((sum, value) => sum + value, 0);
}

/** Registers an instantaneous injection at `year` (simulated planet age in years). */
export function addDustPulse(state: PlanetState, kind: DustKind, tau: number, year: number): void {
  if (tau > 0) state.globals.dustSources.push({ kind, tau, start: year, end: year });
}

/** Registers `tau` emitted evenly between `start` and `end`. */
export function addDustSource(
  state: PlanetState,
  kind: DustKind,
  tau: number,
  start: number,
  end: number,
): void {
  if (tau > 0) state.globals.dustSources.push({ kind, tau, start, end });
}

export const dustModel: SimComponent = {
  name: 'dust',
  inputs: [],
  outputs: [],
  runOneStep(state, dtYears) {
    const dt = Math.max(0, dtYears);
    const s = state.globals;
    const start = state.globals.year;
    const end = start + dt;
    const burden = s.dustBurden;

    if (dt === 0) {
      // No time passes: whatever was registered up to now simply sits in the sky.
      const pending: DustSource[] = [];
      for (const src of s.dustSources) {
        if (src.start <= start) burden[src.kind] = burden[src.kind]! + src.tau;
        else pending.push(src);
      }
      s.dustSources = pending;
      state.globals.dust = burden.reduce((sum, v) => sum + v, 0);
      return;
    }

    const integral = DUST_EFOLD.map((T, k) => burden[k]! * T * (1 - Math.exp(-dt / T)));
    const finish = DUST_EFOLD.map((T, k) => burden[k]! * Math.exp(-dt / T));
    const pending: DustSource[] = [];

    for (const src of s.dustSources) {
      if (src.start >= end) {
        pending.push(src);
        continue;
      }
      const T = DUST_EFOLD[src.kind];
      const a = Math.max(start, src.start);
      if (src.end <= src.start) {
        const remaining = end - a;
        integral[src.kind] = integral[src.kind]! + src.tau * T * (1 - Math.exp(-remaining / T));
        finish[src.kind] = finish[src.kind]! + src.tau * Math.exp(-remaining / T);
        continue;
      }
      // Steady emission between a and b; anything beyond this step stays pending.
      const b = Math.min(end, src.end);
      const q = src.tau / (src.end - src.start);
      const span = b - a;
      if (span > 0) {
        const tail = T * (Math.exp(-(end - b) / T) - Math.exp(-(end - a) / T));
        integral[src.kind] = integral[src.kind]! + q * T * (span - tail);
        finish[src.kind] = finish[src.kind]! + q * tail;
      }
      if (src.end > end) {
        pending.push({ ...src, tau: q * (src.end - end), start: end });
      }
    }

    for (let k = 0; k < burden.length; k++) burden[k] = finish[k]!;
    s.dustSources = pending;
    const stepIntegral = integral.reduce((sum, value) => sum + value, 0);
    state.globals.dust = stepIntegral / dt;
    state.globals.dustIntegralSinceLife += stepIntegral;
    state.globals.dustYearsSinceLife += dt;
  },
};
