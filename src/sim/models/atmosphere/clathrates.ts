import type { SimComponent } from '../../core/component';

/**
 * Methane clathrates and permafrost carbon (M13). Placeholder until the
 * clathrate model is implemented: no reservoir and no release.
 */
export const clathrateModel: SimComponent = {
  name: 'clathrates',
  inputs: [],
  outputs: [],
  runOneStep() {},
};
