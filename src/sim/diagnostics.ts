import type { PlanetState } from './core/planet';
import { complexBiomass, globalStress } from './models/biosphere/life';

export type GaiaMood = 'happy' | 'neutral' | 'sad' | 'sick' | 'asleep';
export type GaiaDrag =
  'biodiversity' | 'biomass' | 'habitat' | 'temperature' | 'acidity' | 'pollution';

export interface GaiaScoreInputs {
  biodiversity: number;
  biomassTrend: number;
  habitableArea: number;
  temperatureStress: number;
  acidityStress: number;
  pollutionStress: number;
}

export interface GaiaDiagnostic extends GaiaScoreInputs {
  hasLife: boolean;
  score: number;
  mood: GaiaMood;
  biggestDrag: GaiaDrag;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Gaia health is a weighted 0..100 diagnostic: biodiversity 30%, biomass versus
 * its recent extinction-memory peak 25%, habitable area 25%, and the three stress
 * terms 8/6/6%. Every healthy input is monotonic; every stress is monotonic in the
 * opposite direction. Face thresholds are happy >= 75, neutral >= 50, sad >= 25.
 */
export function gaiaHealthScore(input: GaiaScoreInputs): number {
  return (
    100 *
    (0.3 * clamp01(input.biodiversity) +
      0.25 * clamp01(input.biomassTrend) +
      0.25 * clamp01(input.habitableArea) +
      0.08 * (1 - clamp01(input.temperatureStress)) +
      0.06 * (1 - clamp01(input.acidityStress)) +
      0.06 * (1 - clamp01(input.pollutionStress)))
  );
}

/** Pure, read-only Gaia diagnosis used when a worker frame is assembled. */
export function gaiaDiagnostic(state: PlanetState): GaiaDiagnostic {
  const totalBiomass = state.biota.cover.reduce((sum, cover) => sum + Math.max(0, cover), 0);
  const hasLife = totalBiomass > 1e-8;
  const complex = complexBiomass(state.biota.cover);
  const recentPeak = state.biota.ecology.biomassReference;
  const biomassTrend = recentPeak > 1e-8 ? clamp01(complex / recentPeak) : hasLife ? 1 : 0;
  const stress = globalStress(state);
  const inputs: GaiaScoreInputs = {
    biodiversity: clamp01(state.globals.biodiversity),
    biomassTrend,
    habitableArea: habitableAreaShare(state),
    temperatureStress: 1 - stress.climate,
    acidityStress: 1 - stress.acidity,
    pollutionStress: clamp01(state.globals.pollution / (1 + Math.max(0, state.globals.pollution))),
  };
  const score = hasLife ? gaiaHealthScore(inputs) : 0;
  const drags: [GaiaDrag, number][] = [
    ['biodiversity', 0.3 * (1 - inputs.biodiversity)],
    ['biomass', 0.25 * (1 - inputs.biomassTrend)],
    ['habitat', 0.25 * (1 - inputs.habitableArea)],
    ['temperature', 0.08 * inputs.temperatureStress],
    ['acidity', 0.06 * inputs.acidityStress],
    ['pollution', 0.06 * inputs.pollutionStress],
  ];
  const biggestDrag = drags.reduce((largest, drag) => (drag[1] > largest[1] ? drag : largest))[0];
  return {
    ...inputs,
    hasLife,
    score,
    mood: !hasLife
      ? 'asleep'
      : score >= 75
        ? 'happy'
        : score >= 50
          ? 'neutral'
          : score >= 25
            ? 'sad'
            : 'sick',
    biggestDrag,
  };
}

/** Fraction of the surface with temperatures and ice cover compatible with active life. */
function habitableAreaShare(state: PlanetState): number {
  const { grid, fields } = state;
  let share = 0;
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      const temperature = fields.airTemperature[i]!;
      const thermal = clamp01(Math.min((temperature + 20) / 15, (55 - temperature) / 15));
      share += weight * thermal * (1 - 0.9 * clamp01(fields.iceCover[i]!));
    }
  }
  return clamp01(share);
}
