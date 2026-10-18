import type { SimComponent } from '../../core/component';
import { isOcean } from '../geosphere/seaLevel';

/**
 * Ocean oxygen, nutrients and acidification (M13). Placeholder until the
 * ocean chemistry model is implemented: a fully oxygenated sea with modern
 * nutrient supply and no acidification.
 */
export const oceanChemistry: SimComponent = {
  name: 'oceanChemistry',
  inputs: ['elevation'],
  outputs: ['oceanOxygen', 'nutrients'],
  runOneStep(state) {
    const { elevation, oceanOxygen, nutrients } = state.fields;
    for (let i = 0; i < elevation.length; i++) {
      const sea = isOcean(elevation[i]!, state.globals.seaLevel) ? 1 : 0;
      oceanOxygen[i] = sea;
      nutrients[i] = sea;
    }
    state.globals.oceanAcidity = 0;
  },
};
