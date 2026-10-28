import type { Difficulty, ModelControls, PlanetState } from './core/planet';

/** The three player-facing difficulty presets. Normal is the calibration baseline. */
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;

export interface DifficultyBalance {
  energyCap: number;
  energyIncome: number;
  weatheringGain: number;
  disasterRate: number;
  goalTolerance: number;
}

export const DIFFICULTY_BALANCE: Readonly<Record<Difficulty, DifficultyBalance>> = {
  easy: {
    energyCap: 1.25,
    energyIncome: 1.4,
    weatheringGain: 1.15,
    disasterRate: 0.7,
    goalTolerance: 1.15,
  },
  normal: {
    energyCap: 1,
    energyIncome: 1,
    weatheringGain: 1,
    disasterRate: 1,
    goalTolerance: 1,
  },
  hard: {
    energyCap: 0.75,
    energyIncome: 0.7,
    weatheringGain: 0.82,
    disasterRate: 1.35,
    goalTolerance: 0.85,
  },
};

/**
 * Price of moving a model target through one full natural unit. These are deliberately
 * separate from tool prices: a modest correction is affordable, holding every lever at
 * an extreme is not. Obliquity is priced per ten degrees below.
 */
export const MODEL_CONTROL_COSTS: Readonly<Record<keyof ModelControls, number>> = {
  driftSpeed: 120,
  volcanism: 140,
  erosion: 100,
  mutationRate: 160,
  solarFactor: 1_200,
  obliquity: 35,
  greenhouse: 500,
  cloudAlbedo: 350,
  surfaceAlbedo: 500,
  airSeaHeat: 100,
  rainfall: 180,
  advanceRate: 180,
  reproduction: 160,
  thermalTolerance: 300,
};

export function difficultyBalance(state: PlanetState): DifficultyBalance {
  return DIFFICULTY_BALANCE[state.difficulty];
}

