import type { SimComponent } from './core/component';
import { DEFAULT_CONTROLS, type ModelControls, type PlanetState } from './core/planet';
import { eraStepYears, planetEra } from './eras';
import { MODEL_CONTROL_COSTS } from './balance';

/** Geological controls take roughly a million years to propagate through the model. */
export function modelControlLagYears(state: PlanetState): number {
  switch (planetEra(state)) {
    case 'geological':
      return 1e6;
    case 'evolution':
      return 250e3;
    case 'civilization':
    case 'technology':
      return Math.max(20, eraStepYears(state) * 10);
  }
}

/** Exact first-order target approach, so changing the outer step length changes no result. */
export const modelControlLag: SimComponent = {
  name: 'modelControls',
  inputs: [],
  outputs: [],
  runOneStep(state, dtYears) {
    const retained = Math.exp(-Math.max(0, dtYears) / modelControlLagYears(state));
    for (const key of Object.keys(DEFAULT_CONTROLS) as (keyof ModelControls)[]) {
      const target = state.controls[key];
      const current = state.effectiveControls[key];
      state.effectiveControls[key] = target + (current - target) * retained;
    }
  },
};

function controlDistance(key: keyof ModelControls, before: number, after: number): number {
  const scale = key === 'obliquity' ? 10 : 1;
  return Math.abs(after - before) / scale;
}

/** Cost of changing the currently set targets; applying the returned changes is atomic. */
export function modelControlChangeCost(
  state: PlanetState,
  changes: Partial<ModelControls>,
): number {
  let cost = 0;
  for (const key of Object.keys(changes) as (keyof ModelControls)[]) {
    const value = changes[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    cost += controlDistance(key, state.controls[key], value) * MODEL_CONTROL_COSTS[key];
  }
  return cost;
}

