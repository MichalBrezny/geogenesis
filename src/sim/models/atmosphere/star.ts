import type { SimComponent } from '../../core/component';
import type { StarType } from '../../core/planet';

/** Age of the present-day Sun in years. */
export const SUN_AGE = 4.57e9;
/** Age at which a Sun-like star leaves the main sequence and the planet's story ends. */
export const STAR_LIFETIME = 10e9;
/** Solar constant of the present-day Sun at Earth, W/m². */
export const SOLAR_CONSTANT = 1361;

export interface StarProperties {
  /** Stellar mass in solar masses. */
  mass: number;
  /** Main-sequence luminosity scale in present-Sun units. */
  luminosity: number;
  /** Approximate main-sequence lifetime, years. */
  lifetime: number;
  /** Duration and strength of elevated magnetic/XUV activity. */
  activeYears: number;
  xuvActivity: number;
}

const STAR_MASSES: Readonly<Record<StarType, number>> = { F: 1.3, G: 1, K: 0.8, M: 0.3 };

/** L ∝ M⁴ and tMS ≈ 10 Gyr M/L, with an explicit long active phase for M dwarfs. */
export function starProperties(type: StarType): StarProperties {
  const mass = STAR_MASSES[type];
  const luminosity = mass ** 4;
  return {
    mass,
    luminosity,
    lifetime: 10e9 * (mass / luminosity),
    activeYears: type === 'M' ? 2e9 : type === 'K' ? 500e6 : 100e6,
    xuvActivity: type === 'M' ? 8 : type === 'K' ? 1.5 : type === 'F' ? 1.3 : 1,
  };
}

/**
 * Luminosity of a Sun-like star relative to the present Sun (Gough 1981):
 * about 70% at birth, 100% at 4.57 Gyr, and rising steeply towards the end of
 * the main sequence (the "faint young Sun" that SimEarth also models).
 */
export function stellarLuminosity(ageYears: number, type: StarType = 'G'): number {
  const star = starProperties(type);
  const age = Math.min(ageYears, star.lifetime);
  // Preserve Gough's solar fit exactly for G stars. Other types follow the same
  // fractional main-sequence brightening around their M⁴ luminosity scale.
  const referenceAge = SUN_AGE * (star.lifetime / STAR_LIFETIME);
  return star.luminosity / (1 + 0.4 * (1 - age / referenceAge));
}

/** Age- and activity-dependent XUV output relative to the Sun's L_xuv/L_bol history. */
function xuvAgeActivity(ageYears: number, type: StarType): number {
  const star = starProperties(type);
  const solarAgeLaw = Math.max(0.25, Math.min(20, Math.pow(SUN_AGE / Math.max(1e8, ageYears), 1.2)));
  // The activity boost decays over the star's active years (G stars: exactly 1).
  const activeBoost = 1 + (star.xuvActivity - 1) * Math.exp(-ageYears / star.activeYears);
  return solarAgeLaw * activeBoost;
}

/**
 * XUV flux at the planet relative to Earth today: (L_xuv/L_bol) x L / d^2. The
 * star's luminosity scale (main-sequence M^4) is included, so a close-in planet
 * of a dim M dwarf receives a few times Earth's XUV rather than hundreds.
 */
export function stellarXuvFactor(
  ageYears: number,
  type: StarType = 'G',
  orbitalDistanceAu = 1,
): number {
  const { luminosity } = starProperties(type);
  return (xuvAgeActivity(ageYears, type) * luminosity) / Math.max(0.01, orbitalDistanceAu ** 2);
}

/** Stellar-wind activity: square root of the XUV age activity, scaled by L / d^2 like XUV. */
export function stellarWindFactor(
  ageYears: number,
  type: StarType = 'G',
  orbitalDistanceAu = 1,
): number {
  const { luminosity } = starProperties(type);
  return (
    (Math.sqrt(xuvAgeActivity(ageYears, type)) * luminosity) /
    Math.max(0.01, orbitalDistanceAu ** 2)
  );
}

/** Updates the star's luminosity from the planet's age. */
export const stellarEvolution: SimComponent = {
  name: 'stellarEvolution',
  inputs: [],
  outputs: [],
  runOneStep(state) {
    const { starType, orbitalDistanceAu } = state.planetParams;
    state.globals.solarInput =
      (stellarLuminosity(state.globals.year, starType) / orbitalDistanceAu ** 2) *
      state.effectiveControls.solarFactor;
  },
};
