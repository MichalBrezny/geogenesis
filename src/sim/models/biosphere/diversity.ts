import type { PlanetState } from '../../core/planet';
import { LIFE_CLASS_COUNT, LIFE_CLASSES } from '../../data/lifeClasses';
import { classSuitability } from './life';

/** Population above which a class counts as present in a cell for diversity. */
export const DIVERSITY_THRESHOLD = 0.01;

/** Life in one cell, for the inspector: only classes that are present. */
export interface CellLife {
  cell: number;
  /** Present classes, most advanced (highest class index) first. */
  classes: { index: number; population: number; suitability: number }[];
}

/** Writes the number of life classes present (population above threshold) in each cell. */
export function updateDiversity(state: PlanetState): void {
  const n = state.grid.cellCount;
  const { populations } = state.biota;
  const out = state.fields.diversity;
  out.fill(0);
  for (let c = 0; c < LIFE_CLASS_COUNT; c++) {
    const base = c * n;
    for (let i = 0; i < n; i++) {
      if (populations[base + i]! > DIVERSITY_THRESHOLD) out[i]!++;
    }
  }
}

/** Populations and habitat suitability (the life model's own, 0..1) of the classes in one cell. */
export function inspectCellLife(state: PlanetState, cell: number): CellLife {
  const n = state.grid.cellCount;
  const classes: CellLife['classes'] = [];
  if (!(cell >= 0 && cell < n)) return { cell, classes };
  for (let c = LIFE_CLASSES.length - 1; c >= 0; c--) {
    const population = state.biota.populations[c * n + cell]!;
    if (population <= DIVERSITY_THRESHOLD) continue;
    classes.push({ index: c, population, suitability: classSuitability(state, c)[cell]! });
  }
  return { cell, classes };
}
