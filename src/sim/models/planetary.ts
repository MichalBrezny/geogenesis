import type { SimComponent } from '../core/component';
import { EARTH_RADIUS } from '../core/grid';
import {
  EARTH_SURFACE_GRAVITY,
  type Atmosphere,
  type PlanetState,
} from '../core/planet';
import { createRng } from '../core/rng';
import { recordEvent } from '../events';
import { mantleHeat } from './atmosphere/carbon';
import { MICROBAR_TO_BAR, updateSurfacePressure } from './atmosphere/atmosphere';
import { stellarWindFactor } from './atmosphere/star';
import { atmosphericWaterGel, waterGelPerBar } from './geosphere/seaLevel';

const EARTH_ESCAPE_VELOCITY = Math.sqrt(2 * EARTH_SURFACE_GRAVITY * EARTH_RADIUS);
const DYNAMO_LIFETIME_EARTH = 12e9;
const DYNAMO_FADE_SHARE = 0.2;
const OBLIQUITY_INTERVAL = 10e6;
const OBLIQUITY_STEP_DEGREES = 1.5;
/** Rotation period beyond which a moonless planet's tilt no longer wanders. */
const SLOW_ROTATOR_HOURS = 1000;
/**
 * Mantle heat (Earth today = 1) below which the lid freezes. Earth stays above
 * 0.82 through 10 Gyr; a Mars-size body (0.53 R) drops below it near 1.1 Gyr.
 */
const STAGNANT_HEAT_THRESHOLD = 0.7;
const ATMOSPHERE_LOST_PRESSURE = 1e-3;
/**
 * Unmagnetized present-solar-wind loss at one bar and Earth gravity, bar/yr.
 * Calibrated so an unshielded Mars (g 3.71, 1.524 AU) loses ~80% of 1 bar in
 * ~1 Gyr, Venus (g 8.87, 0.723 AU, no field) keeps >90% of 90 bar over 4.5 Gyr,
 * and a fully shielded Earth loses nothing.
 */
export const SPUTTERING_RATE = 5e-10;

/** Escape speed implied by the independently configurable radius and surface gravity. */
export function escapeVelocity(state: Pick<PlanetState, 'planetParams'>): number {
  const { radius, surfaceGravity } = state.planetParams;
  return Math.sqrt(2 * Math.max(0, surfaceGravity) * Math.max(1, radius));
}

/**
 * A convecting core lasts roughly with the fourth power of radius in this
 * deliberately compact parameterization. That puts a Mars-size body's dynamo
 * shutdown near 0.9 Gyr while an Earth-size body remains protected past 10 Gyr.
 * Mantle heat modulates the remaining strength because core cooling must be
 * carried through the mantle.
 */
export function magneticFieldStrength(
  ageYears: number,
  radius = EARTH_RADIUS,
  dynamoStrength = 1,
): number {
  if (dynamoStrength <= 0) return 0;
  const radiusRatio = Math.max(0.1, radius / EARTH_RADIUS);
  const lifetime = DYNAMO_LIFETIME_EARTH * radiusRatio ** 4;
  const fadeStart = lifetime * (1 - DYNAMO_FADE_SHARE);
  const ageStrength = Math.max(0, Math.min(1, (lifetime - ageYears) / (lifetime - fadeStart)));
  const tenGyrEarthHeat = mantleHeat(10e9, EARTH_RADIUS);
  const heatStrength = Math.max(0, Math.min(1, mantleHeat(ageYears, radius) / tenGyrEarthHeat));
  return Math.max(0, Math.min(1, dynamoStrength * ageStrength * heatStrength));
}

/**
 * Core cooling, irreversible lid transitions and moonless obliquity evolution.
 * Moonless tilt changes occur on fixed physical-time boundaries; each boundary
 * has its own seeded Rng stream, so one 100 Myr step and ten 10 Myr steps agree.
 */
export const planetaryEvolution: SimComponent = {
  name: 'planetaryEvolution',
  inputs: [],
  outputs: [],
  runOneStep(state, dtYears) {
    const endYear = state.globals.year + Math.max(0, dtYears);
    const { planetParams, globals, geosphere } = state;
    globals.magneticField = magneticFieldStrength(
      endYear,
      planetParams.radius,
      planetParams.dynamoStrength,
    );
    if (
      planetParams.dynamoStrength > 0 &&
      globals.magneticField <= 0.05 &&
      !state.events.some((event) => event.key === 'magneticFieldLost')
    ) {
      recordEvent(state, 'magneticFieldLost', undefined, endYear);
    }

    if (
      globals.tectonicRegime === 'mobile' &&
      (globals.water <= Math.max(0.01, globals.initialWater * 1e-6) ||
        mantleHeat(endYear, planetParams.radius) < STAGNANT_HEAT_THRESHOLD)
    ) {
      globals.tectonicRegime = 'stagnant';
      recordEvent(state, 'stagnantLid', undefined, endYear);
    }

    // Very slow or tidally locked rotators precess far from the chaotic
    // spin–orbit resonances (Laskar & Robutel 1993), so their tilt stays put.
    const slowRotator =
      planetParams.tidallyLocked || Math.abs(planetParams.rotationPeriodHours) > SLOW_ROTATOR_HOURS;
    if (planetParams.hasMoon || slowRotator || geosphere.fixedObliquity || dtYears <= 0) return;
    if (geosphere.nextObliquityUpdateYear <= state.globals.year) {
      geosphere.nextObliquityUpdateYear = state.globals.year + OBLIQUITY_INTERVAL;
    }
    while (geosphere.nextObliquityUpdateYear <= endYear) {
      const local = createRng(
        (state.seed ^ Math.imul(geosphere.obliquityUpdateIndex + 1, 0x9e3779b9)) >>> 0,
      );
      const gaussian =
        Math.sqrt(-2 * Math.log(Math.max(1e-12, local.next()))) *
        Math.cos(2 * Math.PI * local.next());
      const jump = local.next() < 0.02 ? (local.next() * 2 - 1) * 12 : 0;
      state.controls.obliquity = reflectObliquity(
        state.controls.obliquity + gaussian * OBLIQUITY_STEP_DEGREES + jump,
      );
      geosphere.obliquityUpdateIndex++;
      geosphere.nextObliquityUpdateYear += OBLIQUITY_INTERVAL;
    }
  },
};

/**
 * Stellar-wind sputtering and ion pickup remove gases in proportion to their
 * partial-pressure inventories. Full Earth shielding is exactly neutral. Loss
 * strengthens for active/near stars and low gravity, while thinning air makes
 * the final tail asymptotic rather than disappearing in one geological step.
 */
export const atmosphericEscape: SimComponent = {
  name: 'atmosphericEscape',
  inputs: [],
  outputs: [],
  runOneStep(state, dtYears) {
    if (dtYears <= 0 || state.globals.magneticField >= 1) return;
    const { globals, planetParams } = state;
    const atmosphere = globals.atmosphere;
    const pressure = updateSurfacePressure(globals);
    if (pressure <= 0) return;
    const unshielded = (1 - globals.magneticField) ** 2;
    const gravity = (EARTH_SURFACE_GRAVITY / Math.max(0.5, planetParams.surfaceGravity)) ** 1.5;
    const wind = stellarWindFactor(
      globals.year + dtYears * 0.5,
      planetParams.starType,
      planetParams.orbitalDistanceAu,
    );
    const removedBar = sputteredPressure(
      pressure,
      SPUTTERING_RATE * unshielded * gravity * wind,
      dtYears,
    );
    if (removedBar <= 0) return;

    const partials = atmosphericPartials(atmosphere);
    const removable = partials.n2 + partials.inert + partials.co2 + partials.waterVapor;
    if (removable <= 0) return;
    const fraction = Math.min(1, removedBar / removable);
    removeGas(state, 'n2', partials.n2 * fraction);
    removeGas(state, 'inert', partials.inert * fraction);
    removeGas(state, 'co2', partials.co2 * fraction);
    removeGas(state, 'waterVapor', partials.waterVapor * fraction);
    updateSurfacePressure(globals);
    if (
      globals.surfacePressure <= ATMOSPHERE_LOST_PRESSURE &&
      !state.events.some((event) => event.key === 'atmosphereLost')
    ) {
      recordEvent(state, 'atmosphereLost', undefined, globals.year + dtYears);
    }
  },
};

/**
 * Exact integral of the sputtering loss: a constant rate (bar/yr) while the
 * atmosphere is above one bar, then first-order decay P' = -rate*P below it.
 * Exact for any step length, and a thin atmosphere decays asymptotically.
 */
export function sputteredPressure(pressure: number, rate: number, dtYears: number): number {
  if (pressure <= 0 || rate <= 0 || dtYears <= 0) return 0;
  const timeToOneBar = pressure > 1 ? (pressure - 1) / rate : 0;
  if (dtYears <= timeToOneBar) return rate * dtYears;
  const base = pressure > 1 ? pressure - 1 : 0;
  const start = pressure > 1 ? 1 : pressure;
  return Math.min(pressure, base + start * (1 - Math.exp(-rate * (dtYears - timeToOneBar))));
}

function atmosphericPartials(atmosphere: Atmosphere) {
  return {
    n2: Math.max(0, atmosphere.n2),
    inert: Math.max(0, atmosphere.inert),
    co2: Math.max(0, atmosphere.co2) * MICROBAR_TO_BAR,
    waterVapor: Math.max(0, atmosphere.waterVapor),
  };
}

function removeGas(
  state: PlanetState,
  gas: keyof PlanetState['globals']['escapedAtmosphere'],
  amountBar: number,
): void {
  if (amountBar <= 0) return;
  const { atmosphere, escapedAtmosphere } = state.globals;
  if (gas === 'co2') {
    atmosphere.co2 = Math.max(0, atmosphere.co2 - amountBar / MICROBAR_TO_BAR);
    escapedAtmosphere.co2 += amountBar;
  } else if (gas === 'waterVapor') {
    // Water is tracked twice on purpose: escapedAtmosphere.waterVapor in bar
    // (the gas ledger) and escapedWater in m GEL (the water ledger). Both
    // record the amount actually removed, which may be capped below the request.
    const gelPerBar = waterGelPerBar(state.planetParams.surfaceGravity);
    const removedWater = Math.min(
      state.globals.water,
      amountBar * gelPerBar,
      atmosphericWaterGel(state),
    );
    const removedBar = removedWater / gelPerBar;
    state.globals.water -= removedWater;
    state.globals.escapedWater += removedWater;
    atmosphere.waterVapor = Math.max(0, atmosphere.waterVapor - removedBar);
    escapedAtmosphere.waterVapor += removedBar;
  } else {
    atmosphere[gas] = Math.max(0, atmosphere[gas] - amountBar);
    escapedAtmosphere[gas] += amountBar;
  }
}

function reflectObliquity(value: number): number {
  let tilt = value;
  while (tilt < 0 || tilt > 60) {
    if (tilt < 0) tilt = -tilt;
    if (tilt > 60) tilt = 120 - tilt;
  }
  return tilt;
}

/**
 * Low-gravity multiplier for diffusion/Jeans-like hydrogen loss (Earth = 1).
 * The magnetic field does not shield thermal escape, only ion pickup.
 */
export function hydrogenEscapeVelocityFactor(state: PlanetState): number {
  const ratio = EARTH_ESCAPE_VELOCITY / Math.max(1_000, escapeVelocity(state));
  return Math.max(0.05, Math.min(100, ratio ** 4));
}
