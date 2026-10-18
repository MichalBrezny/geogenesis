import type { SimComponent } from '../../core/component';
import { recordEvent } from '../../events';
import { isOcean } from '../geosphere/seaLevel';
import { methaneTarget } from './biogeochemistry';

/** 7,000 Gt C, using 1 ppm (and here 1 microbar) CH4 ~= 2.8 Gt C. */
export const MAX_CLATHRATE_CARBON = 2_500;
const FORMATION_TIME = 250e6;
const MODERN_BURIAL = 0.2;
/** The running temperature reference remembers roughly the previous 10 kyr. */
export const WARMING_REFERENCE_TIME = 10_000;
const RAPID_WARMING_THRESHOLD = 2;
const RELEASE_TIME = 20_000;
/** 100 Gt C expressed in microbar CH4 equivalent. */
const LARGE_RELEASE = 100 / 2.8;
const EVENT_EPISODE_GAP = 100_000;
const SHELF_DEPTH = 500;

/** Methane survives about a decade in oxic air, but much longer under anoxia. */
export function methaneLifetime(oxygenFraction: number): number {
  return 10 + 100_000 * Math.exp(-Math.max(0, oxygenFraction) / 0.005);
}

/**
 * Cold land and shallow cold seas store a fraction of buried organic carbon.
 * Rapid warming against a 10 kyr reference destabilises that store; methane is
 * oxidised exactly in time and its carbon is returned to atmospheric CO2.
 */
export const clathrateModel: SimComponent = {
  name: 'clathrates',
  inputs: ['airTemperature', 'iceCover', 'elevation'],
  outputs: [],
  runOneStep(state, dtYears) {
    const { globals } = state;
    const temperature = globals.meanTemperature;
    const reference = globals.clathrateReferenceTemperature ?? temperature;
    globals.clathrateReferenceTemperature =
      dtYears > 0
        ? temperature + (reference - temperature) * Math.exp(-dtYears / WARMING_REFERENCE_TIME)
        : reference;

    let reservoir = Math.max(0, globals.clathrateCarbon);
    // A geological step's endpoint change occurred over the whole step; scale
    // it to the 10 kyr diagnostic window so a 1 Myr trend is not a sudden jump.
    const observedAnomaly =
      (temperature - reference) * Math.min(1, WARMING_REFERENCE_TIME / Math.max(dtYears, 1));
    const exposure = rapidWarmingExposure(observedAnomaly, dtYears);
    const released = reservoir * -Math.expm1(-exposure / RELEASE_TIME);
    reservoir -= released;

    if (dtYears > 0) {
      const capacity = storageCapacity(state);
      if (reservoir < capacity) {
        const burialScale = Math.max(0, globals.carbon.burial) / MODERN_BURIAL;
        const formedFraction = -Math.expm1((-dtYears * burialScale) / FORMATION_TIME);
        reservoir += (capacity - reservoir) * formedFraction;
      }
    }
    globals.clathrateCarbon = Math.min(MAX_CLATHRATE_CARBON, reservoir);

    integrateMethane(state, dtYears, released);
    const largeReleaseThreshold = LARGE_RELEASE * Math.min(1, Math.max(0, dtYears) / 100_000);
    if (released >= largeReleaseThreshold && released > 0 && !recentMethaneRelease(state)) {
      recordEvent(state, 'methaneRelease', undefined, globals.year + dtYears);
    }
  },
};

/** Integral of warming above the threshold while the reference relaxes. */
function rapidWarmingExposure(anomaly: number, dtYears: number): number {
  if (dtYears <= 0 || anomaly <= RAPID_WARMING_THRESHOLD) return 0;
  const activeTime = Math.min(
    dtYears,
    WARMING_REFERENCE_TIME * Math.log(anomaly / RAPID_WARMING_THRESHOLD),
  );
  return (
    anomaly * WARMING_REFERENCE_TIME * -Math.expm1(-activeTime / WARMING_REFERENCE_TIME) -
    RAPID_WARMING_THRESHOLD * activeTime
  );
}

function storageCapacity(state: Parameters<SimComponent['runOneStep']>[0]): number {
  const { grid, fields, globals } = state;
  let stableArea = 0;
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      const temperature = fields.airTemperature[i]!;
      const ice = fields.iceCover[i]!;
      const elevation = fields.elevation[i]!;
      let cold = 0;
      if (isOcean(elevation, globals.seaLevel)) {
        if (globals.seaLevel - elevation <= SHELF_DEPTH) {
          cold = Math.max(ice, clamp01((5 - temperature) / 8));
        }
      } else {
        cold = Math.max(ice, clamp01((2 - temperature) / 12));
      }
      stableArea += weight * cold;
    }
  }
  // Roughly 35% suitable area corresponds to the upper plausible Earth store.
  return MAX_CLATHRATE_CARBON * Math.min(1, stableArea / 0.35);
}

function integrateMethane(
  state: Parameters<SimComponent['runOneStep']>[0],
  dtYears: number,
  released: number,
): void {
  const atmosphere = state.globals.atmosphere;
  const target = methaneTarget(state);
  const excess = Math.max(0, atmosphere.ch4 - target) + released;
  const remaining = excess * Math.exp(-Math.max(0, dtYears) / methaneLifetime(atmosphere.o2));
  atmosphere.ch4 = target + remaining;
  atmosphere.co2 += excess - remaining;
}

function recentMethaneRelease(state: Parameters<SimComponent['runOneStep']>[0]): boolean {
  const cutoff = state.globals.year - EVENT_EPISODE_GAP;
  return state.events.some((event) => event.key === 'methaneRelease' && event.year >= cutoff);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
