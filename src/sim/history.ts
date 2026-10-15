import type { SimComponent } from './core/component';
import { Biome } from './data/biomes';
import { areaWeightedMean } from './core/grid';
import type { PlanetState } from './core/planet';
import { SEA_LEVEL } from './models/geosphere/flowRouting';

/** Global quantities recorded once per step, for graphs. */
export const HISTORY_SERIES = [
  'year',
  'meanTemperature',
  'co2',
  'iceFraction',
  'solarInput',
  'landFraction',
  'whiteDaisies',
  'blackDaisies',
  'forestFraction',
  'desertFraction',
] as const;
export type HistorySeries = (typeof HISTORY_SERIES)[number];
export type History = Record<HistorySeries, number[]>;

/** Recorded samples are thinned to every other one when they reach this length. */
export const MAX_HISTORY_LENGTH = 2000;

export function createHistory(): History {
  const history = {} as History;
  for (const name of HISTORY_SERIES) history[name] = [];
  return history;
}

/**
 * Appends one sample of the planet's global state to `state.history`. Long runs
 * keep an even spread over the whole history by dropping every other sample
 * whenever the limit is reached.
 */
export const recordHistory: SimComponent = {
  name: 'history',
  inputs: ['elevation'],
  outputs: [],
  runOneStep(state) {
    const { history, globals } = state;
    const sample: Record<HistorySeries, number> = {
      year: globals.year,
      meanTemperature: globals.meanTemperature,
      co2: globals.atmosphere.co2,
      iceFraction: globals.iceFraction,
      solarInput: globals.solarInput,
      landFraction: landFraction(state),
      whiteDaisies: areaWeightedMean(state.grid, state.fields.daisyWhite),
      blackDaisies: areaWeightedMean(state.grid, state.fields.daisyBlack),
      forestFraction: biomeFraction(state, FOREST_BIOMES),
      desertFraction: biomeFraction(state, [Biome.Desert]),
    };
    const last = history.year[history.year.length - 1];
    // A zero-length step (initialization) replaces the sample for the same year.
    if (last === globals.year) for (const name of HISTORY_SERIES) history[name].pop();
    for (const name of HISTORY_SERIES) history[name].push(sample[name]);
    if (history.year.length >= MAX_HISTORY_LENGTH) {
      for (const name of HISTORY_SERIES) {
        history[name] = history[name].filter((_, k) => k % 2 === 0);
      }
    }
  },
};

const FOREST_BIOMES: readonly Biome[] = [
  Biome.BorealForest,
  Biome.TemperateForest,
  Biome.Jungle,
  Biome.Swamp,
];

/** Fraction of the planet's surface covered by the given biomes. */
function biomeFraction(state: PlanetState, biomes: readonly Biome[]): number {
  const covered = Float32Array.from(state.fields.biome, (b) =>
    biomes.includes(b as Biome) ? 1 : 0,
  );
  return areaWeightedMean(state.grid, covered);
}

function landFraction(state: PlanetState): number {
  const land = state.fields.elevation.map((h) => (h >= SEA_LEVEL ? 1 : 0));
  return areaWeightedMean(state.grid, land);
}
