import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT } from '../../core/grid';
import { SEA_LEVEL } from './flowRouting';

export interface DiffusionOptions {
  /** Effective hillslope diffusivity in m²/yr. Must be large on coarse grids to have any effect. */
  diffusivity?: number;
}

/** East and south neighbour directions (indices into DIRECTIONS); each face is visited once. */
const E = 2;
const S = 4;

/**
 * Linear hillslope diffusion ∂h/∂t = D∇²h in finite-volume form on the
 * lat/long grid, like Landlab's LinearDiffuser.
 *
 * Only land is updated: the surface is clamped to sea level when computing
 * gradients, so coasts lose material to the sea while the ocean floor is
 * left alone. The explicit scheme sub-steps automatically to stay stable.
 *
 * Near the poles the east-west cell spacing becomes tiny, which would force
 * very small time steps; the east-west conduction distance is therefore
 * clamped to half the north-south spacing. Fluxes stay symmetric, so the
 * clamp does not create or destroy material.
 */
export function createLinearDiffuser(options: DiffusionOptions = {}): SimComponent {
  const D = options.diffusivity ?? 2e3;
  return {
    name: 'linearDiffuser',
    inputs: ['elevation'],
    outputs: ['elevation'],
    runOneStep(state, dtYears) {
      if (dtYears <= 0 || D <= 0) return;
      const { grid } = state;
      const { neighbors, rowNorthEdge, rowSouthEdge } = getTopology(grid);
      const { width, height, dy } = grid;
      const elevation = state.fields.elevation;

      // Conductances (m²/yr) per row for each face, and the stable time step.
      const condEW = new Float64Array(height);
      const condN = new Float64Array(height);
      const condS = new Float64Array(height);
      let maxRate = 0;
      for (let y = 0; y < height; y++) {
        const dxEff = Math.max(grid.rowDx[y]!, dy / 2);
        condEW[y] = (D * dy) / dxEff;
        condN[y] = (D * rowNorthEdge[y]!) / dy;
        condS[y] = (D * rowSouthEdge[y]!) / dy;
        const rate = (2 * condEW[y]! + condN[y]! + condS[y]!) / grid.rowCellArea[y]!;
        maxRate = Math.max(maxRate, rate);
      }
      const steps = Math.max(1, Math.ceil((dtYears * maxRate) / 0.5));
      const dt = dtYears / steps;

      const surface = new Float64Array(elevation.length);
      const change = new Float64Array(elevation.length);
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < elevation.length; i++) surface[i] = Math.max(elevation[i]!, SEA_LEVEL);
        change.fill(0);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const h = surface[i]!;
            const e = neighbors[i * NEIGHBOR_COUNT + E]!;
            const sNb = neighbors[i * NEIGHBOR_COUNT + S]!;
            // Each face is visited once (east and south); the flux goes to both cells.
            const fluxE = condEW[y]! * (surface[e]! - h);
            change[i] = change[i]! + fluxE;
            change[e] = change[e]! - fluxE;
            if (sNb >= 0) {
              const fluxS = condS[y]! * (surface[sNb]! - h);
              change[i] = change[i]! + fluxS;
              change[sNb] = change[sNb]! - fluxS;
            }
          }
        }
        for (let y = 0; y < height; y++) {
          const scale = dt / grid.rowCellArea[y]!;
          for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (elevation[i]! >= SEA_LEVEL) elevation[i] = elevation[i]! + change[i]! * scale;
          }
        }
      }
    },
  };
}
