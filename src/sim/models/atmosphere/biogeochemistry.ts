import type { SimComponent } from '../../core/component';
import { lifeClassIndex } from '../../data/lifeClasses';

/** Modern Earth's oxygen level (fraction by volume). */
const MODERN_OXYGEN = 0.21;
/**
 * Photosynthesis index of a modern Earth-like biosphere (see `photosynthesis`),
 * at which oxygen settles at the modern level.
 */
export const MODERN_PHOTOSYNTHESIS = 1.0;
/**
 * Photosynthesis that is used up oxidising volcanic gases and iron before any
 * oxygen can accumulate; crossing it is the planet's Great Oxidation Event.
 */
const OXYGEN_SINK = 0.14;
/**
 * Extra sink of a young planet: its hotter, more reduced mantle vents more hydrogen,
 * CO and ferrous iron, and the sink fades as the crust oxidises. With these values an
 * Earth-like microbial biosphere overcomes it at ~2.3 Gyr; by 4 Gyr it is negligible.
 */
const EARLY_OXYGEN_SINK = 6.9;
const EARLY_SINK_DECAY_TIME = 0.6e9;
/** E-folding time (years) of the oxygen reservoir. */
const OXYGEN_RESPONSE_TIME = 50e6;
/** Methane (ppm) an anoxic ocean full of methane-producing microbes sustains. */
const ANOXIC_METHANE = 100;
/** Oxygen level (fraction) that halves methane's lifetime ~e-fold; methane needs anoxia. */
const METHANE_OXYGEN_SCALE = 0.005;
/** Background methane (ppm) from geology and life on an oxygenated planet. */
const BACKGROUND_METHANE = 0.7;

/**
 * Oxygen and methane made by life.
 *
 * Photosynthesis by ocean microbes and land plants pushes oxygen towards a
 * level set by how much of it exceeds the planet's oxygen sinks; methane from
 * microbes builds up only while the air is anoxic. On a young planet this keeps
 * the faint-Sun climate warm, until oxygen arrives and destroys the methane —
 * which can tip the planet into an ice age, as happened on Earth.
 */
export const biogeochemistry: SimComponent = {
  name: 'biogeochemistry',
  inputs: [],
  outputs: [],
  runOneStep(state, dtYears) {
    const { atmosphere } = state.globals;
    const cover = state.biota.cover;
    const index = photosynthesis(cover);
    const sink = oxygenSink(state.globals.year);
    const target =
      (MODERN_OXYGEN * Math.max(0, index - sink)) / (MODERN_PHOTOSYNTHESIS - OXYGEN_SINK);
    if (dtYears > 0) {
      atmosphere.o2 += (target - atmosphere.o2) * (1 - Math.exp(-dtYears / OXYGEN_RESPONSE_TIME));
    }
    const methanogens = cover[lifeClassIndex('prokaryotes')]!;
    const anoxia = Math.exp(-atmosphere.o2 / METHANE_OXYGEN_SCALE);
    atmosphere.ch4 =
      BACKGROUND_METHANE * Math.min(1, methanogens * 4) + ANOXIC_METHANE * methanogens * anoxia;
  },
};

/** Photosynthesis the planet's reducing sinks use up before oxygen can build up, at an age. */
export function oxygenSink(ageYears: number): number {
  return OXYGEN_SINK + EARLY_OXYGEN_SINK * Math.exp(-ageYears / EARLY_SINK_DECAY_TIME);
}

/**
 * Photosynthetic productivity of the planet: ocean microbes (eukaryotic algae
 * much more than bacteria) and land plants, from their planet-wide cover.
 */
export function photosynthesis(cover: readonly number[]): number {
  return (
    0.4 * cover[lifeClassIndex('prokaryotes')]! +
    1.0 * cover[lifeClassIndex('eukaryotes')]! +
    1.0 * cover[lifeClassIndex('plants')]!
  );
}
