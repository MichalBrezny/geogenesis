import type { FieldName } from './fields';
import type { PlanetState } from './planet';
import type { Rng } from './rng';

/**
 * A simulation process, modelled on Landlab components.
 *
 * Each component declares the fields it reads (`inputs`) and writes (`outputs`)
 * and advances the planet by `dtYears` in `runOneStep`. Components must be
 * deterministic given the Rng and must not touch anything outside `state`.
 */
export interface SimComponent {
  readonly name: string;
  readonly inputs: readonly FieldName[];
  readonly outputs: readonly FieldName[];
  /**
   * Minimum simulated years between runs. Slow processes (e.g. tectonics)
   * set this high so they are skipped on fine time scales. 0 = every step.
   */
  readonly minIntervalYears?: number;
  runOneStep(state: PlanetState, dtYears: number, rng: Rng): void;
}
