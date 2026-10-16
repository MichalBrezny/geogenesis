import type { SimComponent } from '../../core/component';
import type { PlanetState } from '../../core/planet';
import { Biome, BIOMES } from '../../data/biomes';
import { SEA_LEVEL } from '../geosphere/flowRouting';

export interface CarbonCycleOptions {
  /** Multiplier on volcanic CO₂ outgassing (a future player control). */
  volcanism?: number;
}

/**
 * Typical surface speed of Earth's plates (m/yr); outgassing scales with the
 * planet's mean plate speed relative to this, since spreading ridges and
 * subduction volcanoes release the CO₂.
 */
const REFERENCE_PLATE_SPEED = 0.035;
/** Silicate weathering speeds up by this factor per °C (Walker et al. 1981). */
const WEATHERING_TEMPERATURE_SENSITIVITY = 0.09;
/** Weathering ∝ (CO₂ / 280 ppm)^this, from acidified soil water. */
const WEATHERING_CO2_EXPONENT = 0.3;
/** CO₂ (ppm) at which weathering is halved by lack of carbon; it cannot remove CO₂ that is gone. */
const WEATHERING_CO2_HALF_SATURATION = 10;
/** Weathering of bare rock relative to an average vegetated surface (plants speed it up ~3×). */
const BARREN_WEATHERING = 0.35;
/** Share of outgassing from hotspots and other volcanism independent of plate motion. */
const HOTSPOT_SHARE = 0.3;
/** E-folding time (years) of the excess heat of a young planet's mantle. */
const MANTLE_COOLING_TIME = 2.5e9;
/**
 * Raw weathering sum (see `rawWeathering`) that counts as the present-day carbon
 * flux. Calibrated so random planets at 4.5 Gyr settle at roughly 10–15 °C.
 */
const REFERENCE_WEATHERING = 0.55;
/**
 * Years for the atmosphere–ocean CO₂ reservoir to change by its own size under a
 * unit flux imbalance. Earth's exchangeable carbon responds over a few hundred
 * thousand years.
 */
const RESERVOIR_TIME = 300_000;
/** Global warming per e-fold of CO₂ (°C), used to predict temperature while solving for CO₂. */
const CLIMATE_SENSITIVITY = 2.6;
const MIN_CO2 = 1;
const MAX_CO2 = 1e6;

/**
 * Long-term (geological) carbon cycle: the silicate-weathering thermostat.
 *
 * Volcanoes add CO₂; rain on warm, exposed rock removes it by weathering, which
 * speeds up as the planet warms. The resulting negative feedback keeps the
 * climate habitable as the star brightens, until CO₂ runs out — the
 * self-regulation at the heart of SimEarth's Gaia theme.
 *
 * The reservoir responds faster than one simulation step, so the new CO₂ is
 * found implicitly: temperatures are extrapolated from the last climate
 * solution with a climate sensitivity, and the balance
 *   ΔC/C = (outgassing − weathering(C)) · Δt / RESERVOIR_TIME
 * is solved for C by bisection in log space.
 */
export function createCarbonCycle(options: CarbonCycleOptions = {}): SimComponent {
  const volcanism = options.volcanism ?? 1;
  return {
    name: 'carbonCycle',
    inputs: [
      'elevation',
      'airTemperature',
      'precipitation',
      'iceCover',
      'plateId',
      'biome',
      'vegetation',
    ],
    outputs: [],
    runOneStep(state, dtYears) {
      const plates = tectonicActivity(state);
      const outgassing =
        volcanism * mantleHeat(state.globals.year) * (HOTSPOT_SHARE + (1 - HOTSPOT_SHARE) * plates);
      const atmosphere = state.globals.atmosphere;
      const before = atmosphere.co2;
      const weathering = (co2: number) =>
        rawWeathering(state, co2, CLIMATE_SENSITIVITY * Math.log(co2 / before)) /
        REFERENCE_WEATHERING;

      if (dtYears > 0) {
        const k = dtYears / RESERVOIR_TIME;
        // (C − C₀)/C₀ − k·(V − W(C)) increases with C, since weathering rises with C.
        const residual = (logC: number) => {
          const c = Math.exp(logC);
          return (c - before) / before - k * (outgassing - weathering(c));
        };
        let low = Math.log(MIN_CO2);
        let high = Math.log(MAX_CO2);
        if (residual(low) >= 0) high = low;
        else if (residual(high) <= 0) low = high;
        for (let iteration = 0; iteration < 60 && high - low > 1e-6; iteration++) {
          const mid = (low + high) / 2;
          if (residual(mid) > 0) high = mid;
          else low = mid;
        }
        atmosphere.co2 = Math.exp((low + high) / 2);
      }
      state.globals.carbon = {
        outgassing,
        weathering: weathering(atmosphere.co2),
      };
    },
  };
}

/**
 * Internal heat of the planet relative to an Earth-like planet at 4.5 Gyr: young
 * planets have hotter mantles and far more volcanism.
 */
export function mantleHeat(ageYears: number): number {
  const excess = (age: number) => 1 + 1.5 * Math.exp(-age / MANTLE_COOLING_TIME);
  return excess(ageYears) / excess(4.5e9);
}

/**
 * Vigour of plate tectonics relative to Earth: the area-weighted mean of the
 * plates' target speeds (what mantle convection drives), not their current
 * speeds, so temporary stalls in collisions do not swing the climate.
 */
export function tectonicActivity(state: PlanetState): number {
  const { plates, grid } = state;
  if (plates.length === 0) return 1;
  const cells = new Float64Array(plates.length);
  for (const id of state.fields.plateId) cells[id] = cells[id]! + 1;
  let speed = 0;
  for (const plate of plates) {
    // Average surface speed of a rotating cap is about π/4 of its maximum.
    speed += cells[plate.id]! * plate.targetSpeed * grid.radius * (Math.PI / 4);
  }
  return speed / grid.cellCount / REFERENCE_PLATE_SPEED;
}

/**
 * Unnormalized silicate weathering: land area fraction × runoff × temperature
 * and CO₂ factors, with no weathering under ice. `warming` (°C) is added to
 * every cell's temperature, to predict weathering at a different CO₂ level.
 */
export function rawWeathering(state: PlanetState, co2: number, warming = 0): number {
  const { grid, fields } = state;
  const { elevation, airTemperature, precipitation, iceCover, biome, vegetation } = fields;
  const co2Factor =
    (Math.pow(co2 / 280, WEATHERING_CO2_EXPONENT) *
      ((co2 / (co2 + WEATHERING_CO2_HALF_SATURATION)) * (280 + WEATHERING_CO2_HALF_SATURATION))) /
    280;
  let total = 0;
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (elevation[i]! < SEA_LEVEL) continue;
      const temperature = airTemperature[i]! + warming;
      const ice = Math.max(iceCover[i]!, temperature < -10 ? 1 : 0);
      const runoff = precipitation[i]! / 1000;
      // Plants speed weathering up several times; land without a biome counts as average.
      const plants = vegetation[i]!;
      const life =
        biome[i] === Biome.Ocean
          ? 1
          : BARREN_WEATHERING * (1 - plants) + BIOMES[biome[i] as Biome].weathering * plants;
      total +=
        weight *
        life *
        (1 - ice) *
        runoff *
        Math.exp(WEATHERING_TEMPERATURE_SENSITIVITY * (temperature - 15));
    }
  }
  return total * co2Factor;
}
