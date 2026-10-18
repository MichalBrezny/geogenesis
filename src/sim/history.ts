import type { SimComponent } from './core/component';
import { Biome } from './data/biomes';
import type { PlanetState } from './core/planet';
import { ERAS, planetEra } from './eras';
import { isOcean } from './models/geosphere/seaLevel';

/** Global quantities recorded once per step, for graphs. */
export const HISTORY_SERIES = [
  'year',
  'meanTemperature',
  'co2',
  'co2Ice',
  'surfacePressure',
  'water',
  'iceFraction',
  'solarInput',
  'seaLevel',
  'landFraction',
  'whiteDaisies',
  'blackDaisies',
  'forestFraction',
  'desertFraction',
  'o2',
  'ch4',
  'livingClasses',
  'impactFlux',
  'era',
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
    const surface = surfaceShares(state);
    const sample: Record<HistorySeries, number> = {
      year: globals.year,
      meanTemperature: globals.meanTemperature,
      co2: globals.atmosphere.co2,
      co2Ice: globals.co2Ice,
      surfacePressure: globals.surfacePressure,
      water: globals.water,
      iceFraction: globals.iceFraction,
      solarInput: globals.solarInput,
      seaLevel: globals.seaLevel,
      landFraction: surface.land,
      whiteDaisies: surface.whiteDaisies,
      blackDaisies: surface.blackDaisies,
      forestFraction: surface.forest,
      desertFraction: surface.desert,
      o2: globals.atmosphere.o2,
      ch4: globals.atmosphere.ch4,
      livingClasses: state.biota.cover.filter((cover) => cover > 0).length,
      impactFlux: globals.impactFlux,
      era: ERAS.indexOf(planetEra(state)),
    };
    const last = history.year[history.year.length - 1];
    // A zero-length step (initialization) replaces the sample for the same year.
    if (last === globals.year) for (const name of HISTORY_SERIES) history[name].pop();
    for (const name of HISTORY_SERIES) history[name].push(sample[name]);
    if (history.year.length >= MAX_HISTORY_LENGTH) {
      const era = history.era;
      for (const name of HISTORY_SERIES) {
        history[name] = history[name].filter(
          (_, k) => k % 2 === 0 || (k > 0 && era[k] !== era[k - 1]),
        );
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

/**
 * Area fractions of the planet's surface in one pass: land, actual forest
 * (forest climate × plant cover), desert and daisies.
 */
function surfaceShares(state: PlanetState) {
  const { grid, fields } = state;
  const { elevation, biome, vegetation, daisyWhite, daisyBlack } = fields;
  const shares = { land: 0, forest: 0, desert: 0, whiteDaisies: 0, blackDaisies: 0 };
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (!isOcean(elevation[i]!, state.globals.seaLevel)) shares.land += weight;
      const b = biome[i] as Biome;
      if (FOREST_BIOMES.includes(b)) shares.forest += weight * vegetation[i]!;
      else if (b === Biome.Desert) shares.desert += weight;
      shares.whiteDaisies += weight * daisyWhite[i]!;
      shares.blackDaisies += weight * daisyBlack[i]!;
    }
  }
  return shares;
}
