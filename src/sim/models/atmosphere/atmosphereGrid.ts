import { createGrid, type Grid } from '../../core/grid';

/**
 * Coarse grid for the atmosphere's circulation and moisture transport. Weather
 * systems are far larger than a fine cell, so the fine grid is averaged down to
 * at most this width; this keeps the cost and the behaviour independent of the
 * map resolution.
 */
const ATMOSPHERE_GRID_WIDTH = 64;

export interface AtmosphereGrid {
  coarse: Grid;
  /** Fine cells per coarse cell along each axis. */
  factor: number;
  /** Coarse cell of each fine cell. */
  coarseOf: Int32Array;
  /** Sum of the fine-cell areas in each coarse cell, m². */
  coarseArea: Float64Array;
}

const cache = new WeakMap<Grid, AtmosphereGrid>();

export function getAtmosphereGrid(grid: Grid): AtmosphereGrid {
  let atmosphere = cache.get(grid);
  if (!atmosphere) {
    atmosphere = build(grid);
    cache.set(grid, atmosphere);
  }
  return atmosphere;
}

function build(grid: Grid): AtmosphereGrid {
  const coarsens =
    grid.width > ATMOSPHERE_GRID_WIDTH &&
    grid.width % ATMOSPHERE_GRID_WIDTH === 0 &&
    grid.height % (ATMOSPHERE_GRID_WIDTH / 2) === 0;
  const width = coarsens ? ATMOSPHERE_GRID_WIDTH : grid.width;
  const height = coarsens ? ATMOSPHERE_GRID_WIDTH / 2 : grid.height;
  const coarse = coarsens ? createGrid(width, height, grid.radius) : grid;
  const factor = grid.width / width;
  const coarseOf = new Int32Array(grid.cellCount);
  const coarseArea = new Float64Array(coarse.cellCount);
  for (let fy = 0; fy < grid.height; fy++) {
    const cy = Math.floor(fy / factor);
    for (let fx = 0; fx < grid.width; fx++) {
      const c = cy * width + Math.floor(fx / factor);
      coarseOf[fy * grid.width + fx] = c;
      coarseArea[c] = coarseArea[c]! + grid.rowCellArea[fy]!;
    }
  }
  return { coarse, factor, coarseOf, coarseArea };
}

/**
 * Area-weighted mean of a fine field over each coarse cell. With `weight`, a
 * weighted mean (e.g. over land only); cells with no weight get `empty`.
 */
export function averageToCoarse(
  atmosphere: AtmosphereGrid,
  fine: Grid,
  values: ArrayLike<number>,
  out: Float64Array,
  weight?: (i: number) => number,
  empty = 0,
): Float64Array {
  const { coarseOf, coarse } = atmosphere;
  const total = new Float64Array(coarse.cellCount);
  out.fill(0);
  for (let fy = 0; fy < fine.height; fy++) {
    const area = fine.rowCellArea[fy]!;
    for (let fx = 0; fx < fine.width; fx++) {
      const i = fy * fine.width + fx;
      const w = area * (weight ? weight(i) : 1);
      if (w === 0) continue;
      const c = coarseOf[i]!;
      out[c] = out[c]! + values[i]! * w;
      total[c] = total[c]! + w;
    }
  }
  for (let c = 0; c < out.length; c++) out[c] = total[c]! > 0 ? out[c]! / total[c]! : empty;
  return out;
}

/** Bilinear value of a coarse field at fractional coarse coordinates (x wraps, y clamps). */
export function sampleCoarse(coarse: Grid, values: Float64Array, cx: number, cy: number): number {
  const { width, height } = coarse;
  const yc = Math.max(0, Math.min(height - 1, cy));
  const y0 = Math.min(height - 1, Math.floor(yc));
  const y1 = Math.min(height - 1, y0 + 1);
  const ty = yc - y0;
  const xf = Math.floor(cx);
  const tx = cx - xf;
  const x0 = ((xf % width) + width) % width;
  const x1 = (x0 + 1) % width;
  const top = values[y0 * width + x0]! * (1 - tx) + values[y0 * width + x1]! * tx;
  const bottom = values[y1 * width + x0]! * (1 - tx) + values[y1 * width + x1]! * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Bilinear interpolation of a coarse field to every fine cell centre. */
export function interpolateToFine(
  atmosphere: AtmosphereGrid,
  fine: Grid,
  values: Float64Array,
  out: Float32Array,
): void {
  const { coarse, factor } = atmosphere;
  for (let fy = 0; fy < fine.height; fy++) {
    const cy = (fy + 0.5) / factor - 0.5;
    for (let fx = 0; fx < fine.width; fx++) {
      out[fy * fine.width + fx] = sampleCoarse(coarse, values, (fx + 0.5) / factor - 0.5, cy);
    }
  }
}
