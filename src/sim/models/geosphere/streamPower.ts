import type { SimComponent } from '../../core/component';
import { SEA_LEVEL, neighborDistance } from './flowRouting';

export interface StreamPowerOptions {
  /** Erodibility K in yr⁻¹·m^(1-2m). Effective value for coarse cells, not a field measurement. */
  erodibility?: number;
  /** Drainage area exponent m (slope exponent n is fixed at 1). */
  areaExponent?: number;
}

/**
 * Runoff (m/yr) at which a river's discharge counts as its drainage area in the
 * stream power law — about Earth's mean over land. Wetter catchments erode as
 * if they were larger, deserts as if smaller.
 */
export const REFERENCE_RUNOFF = 0.3;

/**
 * Detachment-limited fluvial erosion E = K·(Q/R)^m·S, solved implicitly
 * (Braun & Willett 2013), like Landlab's FastscapeEroder with n = 1.
 * Unconditionally stable for any time step.
 *
 * Q is the river discharge and R = REFERENCE_RUNOFF, so Q/R is an effective
 * drainage area: rivers in wet climates cut faster than desert wadis.
 *
 * Cells are processed from downstream to upstream so each cell sees its
 * receiver's already-updated elevation. Streams entering the ocean erode
 * towards sea level. Eroded material is removed (no deposition yet).
 */
export function createStreamPowerEroder(options: StreamPowerOptions = {}): SimComponent {
  const K = options.erodibility ?? 1e-8;
  const m = options.areaExponent ?? 0.5;
  return {
    name: 'streamPowerEroder',
    inputs: ['elevation', 'flowReceiver', 'flowUpstreamOrder', 'discharge'],
    outputs: ['elevation'],
    runOneStep(state, dtYears) {
      if (dtYears <= 0) return;
      const { grid, fields } = state;
      const { elevation, flowReceiver, flowUpstreamOrder, discharge } = fields;
      for (let k = 0; k < flowUpstreamOrder.length; k++) {
        const i = flowUpstreamOrder[k]!;
        const r = flowReceiver[i]!;
        if (r < 0) continue;
        const base = Math.max(elevation[r]!, SEA_LEVEL);
        const h = elevation[i]!;
        // Lake floors and flats below their outlet are not incised.
        if (h <= base) continue;
        const factor =
          (K * state.controls.erosion * Math.pow(discharge[i]! / REFERENCE_RUNOFF, m) * dtYears) /
          neighborDistance(grid, i, r);
        elevation[i] = (h + factor * base) / (1 + factor);
      }
    },
  };
}
