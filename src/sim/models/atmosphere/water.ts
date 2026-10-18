import type { SimComponent } from '../../core/component';
import { recordEvent } from '../../events';
import { atmosphericWaterGel, landIceWaterGel, WATER_GEL_PER_BAR } from '../geosphere/seaLevel';
import { REFERENCE_WATER_VAPOR, updateSurfacePressure } from './atmosphere';
import { SUN_AGE } from './star';

/** Ocean-to-steam e-folding time during a runaway greenhouse. */
export const RUNAWAY_EVAPORATION_TIME = 1e6;
/** Present-XUV time to remove one initial ocean once the cold trap has failed. */
export const OCEAN_ESCAPE_TIME = 500e6;
/** Fast tropospheric equilibration compared with even the shortest geological step. */
const TROPOSPHERIC_WATER_TIME = 1;
const MOIST_GREENHOUSE_START = 50;
const FAILED_COLD_TRAP = 100;

/** Smooth 0..1 transition with zero slope at both ends. */
function smoothstep(low: number, high: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return x * x * (3 - 2 * x);
}

/** Young Sun-like stars drive substantially faster hydrogen escape. */
export function stellarXuvFactor(ageYears: number): number {
  return Math.max(0.25, Math.min(20, Math.pow(SUN_AGE / Math.max(1e8, ageYears), 1.2)));
}

/**
 * Exchanges the conserved water inventory between ocean/ice and atmospheric
 * vapour, then removes steam through diffusion/XUV-limited hydrogen escape.
 * Escaped oxygen is assumed to oxidise the crust rather than accumulate as O2.
 */
export const atmosphericWaterCycle: SimComponent = {
  name: 'waterCycle',
  inputs: ['elevation', 'iceThickness', 'airTemperature'],
  outputs: [],
  runOneStep(state, dtYears) {
    const { globals } = state;
    const atmosphere = globals.atmosphere;
    const ice = Math.min(globals.water, landIceWaterGel(state));
    const condensable = Math.max(0, globals.water - ice);
    const currentVapor = Math.min(condensable, atmosphericWaterGel(state));

    let targetVapor: number;
    if (globals.runawayGreenhouse && condensable > 0) {
      targetVapor = condensable;
    } else if (condensable > 0 && globals.seaLevel > minimumElevation(state)) {
      // About 0.025 m GEL at 15 C, increasing by roughly Clausius-Clapeyron's
      // 6.5%/K while liquid surface water is available.
      targetVapor = Math.min(
        condensable,
        REFERENCE_WATER_VAPOR * WATER_GEL_PER_BAR *
          Math.exp(0.065 * (Math.max(-80, Math.min(60, globals.meanTemperature)) - 15)),
      );
    } else {
      targetVapor = 0;
    }

    if (dtYears > 0) {
      const responseTime = globals.runawayGreenhouse
        ? RUNAWAY_EVAPORATION_TIME
        : TROPOSPHERIC_WATER_TIME;
      const response = 1 - Math.exp(-dtYears / responseTime);
      const nextVapor = currentVapor + (targetVapor - currentVapor) * response;
      atmosphere.waterVapor = Math.max(0, nextVapor / WATER_GEL_PER_BAR);

      const coldTrapFailure = smoothstep(
        MOIST_GREENHOUSE_START,
        FAILED_COLD_TRAP,
        globals.meanTemperature,
      );
      const moistEnough = Math.min(
        1,
        atmosphericWaterGel(state) / Math.max(1e-9, globals.initialWater * 0.01),
      );
      const escapeRate =
        (globals.initialWater / OCEAN_ESCAPE_TIME) *
        stellarXuvFactor(globals.year) *
        coldTrapFailure *
        moistEnough;
      const escaped = Math.min(
        globals.water,
        atmosphericWaterGel(state),
        Math.max(0, escapeRate * dtYears),
      );
      if (escaped > 0) {
        globals.water -= escaped;
        globals.escapedWater += escaped;
        atmosphere.waterVapor = Math.max(
          0,
          atmosphere.waterVapor - escaped / WATER_GEL_PER_BAR,
        );
      }

      const lostThreshold = Math.max(0.01, globals.initialWater * 1e-6);
      if (globals.water <= lostThreshold) {
        const wasWet = globals.water > 0 || atmosphere.waterVapor > 0;
        globals.escapedWater += globals.water;
        globals.water = 0;
        atmosphere.waterVapor = 0;
        if (wasWet && !state.events.some((event) => event.key === 'oceansLost')) {
          recordEvent(state, 'oceansLost');
        }
      }
    }
    updateSurfacePressure(globals);
  },
};

function minimumElevation(state: Parameters<SimComponent['runOneStep']>[0]): number {
  let minimum = Infinity;
  for (const value of state.fields.elevation) minimum = Math.min(minimum, value);
  return minimum;
}
