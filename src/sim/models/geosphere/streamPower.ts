import type { SimComponent } from '../../core/component';
import { SEA_LEVEL, neighborDistance } from './flowRouting';

export interface StreamPowerOptions {
  /** Erodibility K in yr⁻¹·m^(1-2m). Effective value for coarse cells, not a field measurement. */
  erodibility?: number;
  /** Drainage area exponent m (slope exponent n is fixed at 1). */
  areaExponent?: number;
}

/**
 * Detachment-limited fluvial erosion E = K·A^m·S, solved implicitly
 * (Braun & Willett 2013), like Landlab's FastscapeEroder with n = 1.
 * Unconditionally stable for any time step.
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
    inputs: ['elevation', 'flowReceiver', 'flowUpstreamOrder', 'drainageArea'],
    outputs: ['elevation'],
    runOneStep(state, dtYears) {
      if (dtYears <= 0) return;
      const { grid, fields } = state;
      const { elevation, flowReceiver, flowUpstreamOrder, drainageArea } = fields;
      for (let k = 0; k < flowUpstreamOrder.length; k++) {
        const i = flowUpstreamOrder[k]!;
        const r = flowReceiver[i]!;
        if (r < 0) continue;
        const base = Math.max(elevation[r]!, SEA_LEVEL);
        const h = elevation[i]!;
        // Lake floors and flats below their outlet are not incised.
        if (h <= base) continue;
        const factor = (K * Math.pow(drainageArea[i]!, m) * dtYears) / neighborDistance(grid, i, r);
        elevation[i] = (h + factor * base) / (1 + factor);
      }
    },
  };
}
