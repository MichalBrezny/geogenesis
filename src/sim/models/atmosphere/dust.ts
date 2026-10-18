import type { SimComponent } from '../../core/component';

/**
 * Atmospheric dust (M13): impacts, eruptions and nuclear war loft dust that
 * dims the Sun. Placeholder until the dust model is implemented: dust stays 0.
 */
export const dustModel: SimComponent = {
  name: 'dust',
  inputs: [],
  outputs: [],
  runOneStep() {},
};
