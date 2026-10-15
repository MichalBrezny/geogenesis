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
  /** Relative cell area per row, summing to 1 over all cells. */
  readonly rowAreaWeight: Float64Array;
  /** Planet radius in metres. */
  readonly radius: number;
  /** North-south distance between row centres in metres. */
  readonly dy: number;
  /** East-west distance between cell centres in each row, in metres (shrinks towards the poles). */
  readonly rowDx: Float64Array;
  /** Surface area of one cell in each row, in m². */
  readonly rowCellArea: Float64Array;
  /** Unit vector of each cell centre on the sphere, interleaved [x, y, z, x, y, z, ...]. */
  readonly cellPosition: Float64Array;
}

export const EARTH_RADIUS = 6_371_000;

export function createGrid(width: number, height: number, radius = EARTH_RADIUS): Grid {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error(`Invalid grid size ${width}x${height}`);
  }
  const rowLatitude = new Float64Array(height);
  const rowAreaWeight = new Float64Array(height);
  const rowDx = new Float64Array(height);
  const rowCellArea = new Float64Array(height);
  const dLon = (2 * Math.PI) / width;
  const totalArea = 4 * Math.PI * radius * radius;
  for (let y = 0; y < height; y++) {
    const lat = 90 - ((y + 0.5) * 180) / height;
    rowLatitude[y] = lat;
    rowDx[y] = radius * Math.cos(toRadians(lat)) * dLon;
    // Exact area of a latitude band segment: R² Δλ (sin φ_north - sin φ_south).
    const north = toRadians(90 - (y * 180) / height);
    const south = toRadians(90 - ((y + 1) * 180) / height);
    const area = radius * radius * dLon * (Math.sin(north) - Math.sin(south));
    rowCellArea[y] = area;
    rowAreaWeight[y] = area / totalArea;
  }

  const cellPosition = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const lat = toRadians(rowLatitude[y]!);
    for (let x = 0; x < width; x++) {
      const lon = (x + 0.5) * dLon;
      const p = (y * width + x) * 3;
      cellPosition[p] = Math.cos(lat) * Math.cos(lon);
      cellPosition[p + 1] = Math.cos(lat) * Math.sin(lon);
      cellPosition[p + 2] = Math.sin(lat);
    }
  }

  return {
    width,
    height,
    cellCount: width * height,
    rowLatitude,
    rowAreaWeight,
    radius,
    dy: (Math.PI * radius) / height,
    rowDx,
    rowCellArea,
    cellPosition,
  };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
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

/** Neighbour directions used by `Topology`, clockwise from north. */
export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export const NEIGHBOR_COUNT = DIRECTIONS.length;
const DX = [0, 1, 1, 1, 0, -1, -1, -1] as const;
const DY = [-1, -1, 0, 1, 1, 1, 0, -1] as const;

/**
 * Precomputed 8-neighbour connectivity and distances, for flow routing and
 * other stencil operations. Derived from the grid and cached, so it is not
 * part of the serialized planet state.
 */
export interface Topology {
  /** neighbors[i * 8 + d] = index of the neighbour of cell i in direction d, or -1 past a pole. */
  readonly neighbors: Int32Array;
  /** rowDistance[y * 8 + d] = distance in metres from a cell in row y to its neighbour in direction d. */
  readonly rowDistance: Float64Array;
  /** Length in metres of a cell's northern / southern edge in each row (0 at the poles). */
  readonly rowNorthEdge: Float64Array;
  readonly rowSouthEdge: Float64Array;
}

const topologyCache = new WeakMap<Grid, Topology>();

export function getTopology(grid: Grid): Topology {
  let topology = topologyCache.get(grid);
  if (!topology) {
    topology = buildTopology(grid);
    topologyCache.set(grid, topology);
  }
  return topology;
}

function buildTopology(grid: Grid): Topology {
  const { width, height, dy, rowDx, radius } = grid;
  const neighbors = new Int32Array(grid.cellCount * NEIGHBOR_COUNT);
  const rowDistance = new Float64Array(height * NEIGHBOR_COUNT);
  const rowNorthEdge = new Float64Array(height);
  const rowSouthEdge = new Float64Array(height);
  const dLon = (2 * Math.PI) / width;

  for (let y = 0; y < height; y++) {
    rowNorthEdge[y] = radius * Math.cos(toRadians(90 - (y * 180) / height)) * dLon;
    rowSouthEdge[y] = radius * Math.cos(toRadians(90 - ((y + 1) * 180) / height)) * dLon;
    for (let d = 0; d < NEIGHBOR_COUNT; d++) {
      const ny = y + DY[d]!;
      // Diagonal east-west span: average of the two rows' spacing.
      const dxSpan = ny >= 0 && ny < height ? (rowDx[y]! + rowDx[ny]!) / 2 : rowDx[y]!;
      const ex = DX[d]! * dxSpan;
      const ey = DY[d]! * dy;
      rowDistance[y * NEIGHBOR_COUNT + d] = Math.sqrt(ex * ex + ey * ey);
    }
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      for (let d = 0; d < NEIGHBOR_COUNT; d++) {
        const ny = y + DY[d]!;
        neighbors[i * NEIGHBOR_COUNT + d] =
          ny >= 0 && ny < height ? ny * width + wrapX(grid, x + DX[d]!) : -1;
      }
    }
  }
  return { neighbors, rowDistance, rowNorthEdge, rowSouthEdge };
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
