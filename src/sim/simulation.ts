import type { SimComponent } from './core/component';
import type { FieldName } from './core/fields';
import type { PlanetState } from './core/planet';
import { createRng } from './core/rng';

export interface Simulation {
  readonly components: readonly SimComponent[];
  /** Advance the planet by `dtYears`, running components in order. */
  step(state: PlanetState, dtYears: number): void;
  /** Wall-clock milliseconds each component took in the last step (skipped components are absent). */
  readonly timings: ReadonlyMap<string, number>;
}

/**
 * Builds a simulation from components run in the given order
 * (geosphere -> atmosphere -> biosphere -> civilization -> events).
 *
 * `initializedFields` are filled before the first step (e.g. by planet generation).
 * Every component input must be either initialized or written by an earlier
 * component, otherwise construction fails — this catches ordering mistakes early.
 */
export function createSimulation(
  components: readonly SimComponent[],
  initializedFields: readonly FieldName[] = [],
): Simulation {
  const available = new Set<FieldName>(initializedFields);
  const names = new Set<string>();
  for (const component of components) {
    if (names.has(component.name)) throw new Error(`Duplicate component "${component.name}"`);
    names.add(component.name);
    for (const input of component.inputs) {
      if (!available.has(input)) {
        throw new Error(
          `Component "${component.name}" reads "${input}" before anything initializes or writes it`,
        );
      }
    }
    for (const output of component.outputs) available.add(output);
  }

  const lastRunYear = new Map<string, number>();
  const timings = new Map<string, number>();

  return {
    components,
    timings,
    step(state, dtYears) {
      timings.clear();
      const rng = createRng(state.rngState);
      const year = state.globals.year + dtYears;
      for (const component of components) {
        const interval = component.minIntervalYears ?? 0;
        const last = lastRunYear.get(component.name);
        const elapsed = last === undefined ? dtYears : year - last;
        // A component always runs on its first step so its outputs are initialized.
        if (last !== undefined && elapsed < interval) continue;
        const start = performance.now();
        component.runOneStep(state, elapsed, rng);
        timings.set(component.name, performance.now() - start);
        lastRunYear.set(component.name, year);
      }
      state.globals.year = year;
      state.rngState = rng.state;
    },
  };
}
