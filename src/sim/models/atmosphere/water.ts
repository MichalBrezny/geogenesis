import type { SimComponent } from '../../core/component';
import { recordEvent } from '../../events';
import { atmosphericWaterGel, landIceWaterGel, waterGelPerBar } from '../geosphere/seaLevel';
import { hydrogenEscapeVelocityFactor } from '../planetary';
import { REFERENCE_WATER_VAPOR, updateSurfacePressure } from './atmosphere';
import { stellarXuvFactor as starXuvFactor } from './star';

/** Ocean-to-steam e-folding time during a runaway greenhouse. */
export const RUNAWAY_EVAPORATION_TIME = 1e6;
/** Present-XUV time to remove one initial ocean once the cold trap has failed. */
export const OCEAN_ESCAPE_TIME = 500e6;
/** Fast tropospheric equilibration compared with even the shortest geological step. */
const TROPOSPHERIC_WATER_TIME = 1;
const MOIST_GREENHOUSE_START = 50;
const FAILED_COLD_TRAP = 100;
/**
 * Diffusion-limited/Jeans-like loss of a cold world's vapour column: fraction of
 * the column lost per year at Earth XUV and 1x the Earth hydrogen factor excess.
 * The driver is (hydrogenEscapeVelocityFactor - 1), which is exactly 0 for Earth
 * and steep (~ (v_earth/v_esc)^4) for small planets; Mars-size loses of order
 * 0.1-1 m GEL over 4 Gyr, a trickle next to the moist-greenhouse route.
 */
const JEANS_COLUMN_RATE = 1e-9;

/** Smooth 0..1 transition with zero slope at both ends. */
function smoothstep(low: number, high: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return x * x * (3 - 2 * x);
}

/** Backward-compatible G-star-at-1-AU helper used by existing callers/tests. */
export const stellarXuvFactor = (ageYears: number): number => starXuvFactor(ageYears);

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
    const gelPerBar = waterGelPerBar(state.planetParams.surfaceGravity);
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
        REFERENCE_WATER_VAPOR * gelPerBar *
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
      atmosphere.waterVapor = Math.max(0, nextVapor / gelPerBar);

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
        starXuvFactor(
          globals.year,
          state.planetParams.starType,
          state.planetParams.orbitalDistanceAu,
        ) *
        hydrogenEscapeVelocityFactor(state) *
        coldTrapFailure *
        moistEnough;
      const xuv = starXuvFactor(
        globals.year,
        state.planetParams.starType,
        state.planetParams.orbitalDistanceAu,
      );
      const jeansRate =
        JEANS_COLUMN_RATE *
        xuv *
        Math.max(0, hydrogenEscapeVelocityFactor(state) - 1) *
        atmosphericWaterGel(state);
      const waterAtStart = globals.water;
      // The moist-greenhouse route is limited by the standing vapour; the slow
      // Jeans-like trickle is resupplied from the surface, so only the water bounds it.
      const escaped = Math.min(
        globals.water,
        Math.min(atmosphericWaterGel(state), Math.max(0, escapeRate * dtYears)) +
          Math.max(0, jeansRate * dtYears),
      );
      if (escaped > 0) {
        globals.water -= escaped;
        globals.escapedWater += escaped;
        atmosphere.waterVapor = Math.max(
          0,
          atmosphere.waterVapor - escaped / gelPerBar,
        );
      }

      const lostThreshold = Math.max(0.01, globals.initialWater * 1e-6);
      if (globals.water <= lostThreshold) {
        // Judged from the water held before this step's escape, so draining the
        // last water in one step still counts as losing the oceans.
        const wasWet = waterAtStart > 0 || globals.escapedWater > 0 || globals.initialWater > 0;
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
