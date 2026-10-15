/**
 * Equirectangular latitude/longitude grid covering the whole planet.
 *
 * Cells are stored row-major: index = y * width + x.
 * Row 0 is the northernmost row. The grid wraps east-west; the poles do not wrap.
 * Resolution is a parameter so the planet can be refined later without code changes.
 */
export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly cellCount: number;
  /** Latitude of each row's centre in degrees (+90 north .. -90 south). */
  readonly rowLatitude: Float64Array;
  /** Relative cell area per row (proportional to cos(latitude)), summing to 1 over all cells. */
  readonly rowAreaWeight: Float64Array;
}

export function createGrid(width: number, height: number): Grid {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error(`Invalid grid size ${width}x${height}`);
  }
  const rowLatitude = new Float64Array(height);
  const rowAreaWeight = new Float64Array(height);
  let total = 0;
  for (let y = 0; y < height; y++) {
    const lat = 90 - ((y + 0.5) * 180) / height;
    rowLatitude[y] = lat;
    const w = Math.cos((lat * Math.PI) / 180);
    rowAreaWeight[y] = w;
    total += w * width;
  }
  for (let y = 0; y < height; y++) rowAreaWeight[y]! /= total;
  return { width, height, cellCount: width * height, rowLatitude, rowAreaWeight };
}

export function cellIndex(grid: Grid, x: number, y: number): number {
  return y * grid.width + wrapX(grid, x);
}

export function wrapX(grid: Grid, x: number): number {
  const w = grid.width;
  return ((x % w) + w) % w;
}

/**
 * Indices of the 4 orthogonal neighbours (N, E, S, W).
 * At the poles the missing neighbour is -1.
 */
export function neighbors4(
  grid: Grid,
  index: number,
  out: Int32Array = new Int32Array(4),
): Int32Array {
  const x = index % grid.width;
  const y = (index - x) / grid.width;
  out[0] = y > 0 ? index - grid.width : -1;
  out[1] = y * grid.width + wrapX(grid, x + 1);
  out[2] = y < grid.height - 1 ? index + grid.width : -1;
  out[3] = y * grid.width + wrapX(grid, x - 1);
  return out;
}

/** Area-weighted mean of a per-cell field (cells near the poles count less). */
export function areaWeightedMean(grid: Grid, values: ArrayLike<number>): number {
  let sum = 0;
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    const row = y * grid.width;
    for (let x = 0; x < grid.width; x++) sum += values[row + x]! * weight;
  }
  return sum;
}
