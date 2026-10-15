import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT, type Grid } from '../../core/grid';
import { CellPriorityQueue } from '../../core/priorityQueue';

/** Sea level in metres; cells below it are ocean and act as outlets. */
export const SEA_LEVEL = 0;

/**
 * Minimum drop (m) imposed across filled depressions so that every land cell
 * has a strictly lower neighbour to drain to.
 */
const FILL_EPSILON = 1e-3;

/**
 * Routes water over the land surface (a combination of Landlab's
 * PriorityFloodFlowRouter / DepressionFinderAndRouter and FlowAccumulator):
 *
 * 1. Priority-flood fill (Barnes et al. 2014) from the ocean, so closed
 *    depressions spill over their lowest rim instead of trapping flow.
 * 2. D8 steepest descent on the filled surface gives each land cell a receiver.
 * 3. The priority-flood visit order is already sorted from downstream to
 *    upstream, which lets drainage area be accumulated in one reverse pass.
 *
 * Ocean cells (and the single lowest cell on a planet without ocean) are outlets
 * with receiver -1.
 */
export const flowRouting: SimComponent = {
  name: 'flowRouting',
  inputs: ['elevation'],
  outputs: ['flowReceiver', 'flowUpstreamOrder', 'drainageArea'],
  runOneStep(state) {
    const { grid, fields } = state;
    const { elevation, flowReceiver, flowUpstreamOrder, drainageArea } = fields;
    const filled = fillDepressions(grid, elevation, flowUpstreamOrder);
    assignReceivers(grid, filled, elevation, flowReceiver);
    accumulateDrainageArea(grid, flowReceiver, flowUpstreamOrder, drainageArea);
  },
};

/**
 * Returns the depression-filled surface and writes the visit order (lowest
 * first) to `order`.
 */
export function fillDepressions(
  grid: Grid,
  elevation: Float32Array,
  order: Int32Array,
): Float64Array {
  const { neighbors } = getTopology(grid);
  const n = grid.cellCount;
  const filled = new Float64Array(n);
  const closed = new Uint8Array(n);
  const queue = new CellPriorityQueue(n);

  // Ocean cells are outlets: they go first in the order, and only those touching
  // land need to seed the flood (keeps the heap small, as most cells are ocean).
  let visited = 0;
  for (let i = 0; i < n; i++) {
    if (elevation[i]! < SEA_LEVEL) {
      filled[i] = elevation[i]!;
      closed[i] = 1;
      order[visited++] = i;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!closed[i]) continue;
    for (let d = 0; d < NEIGHBOR_COUNT; d++) {
      const nb = neighbors[i * NEIGHBOR_COUNT + d]!;
      if (nb >= 0 && !closed[nb]) {
        queue.push(i, filled[i]!);
        break;
      }
    }
  }
  if (visited === 0) {
    // No ocean: drain everything towards the lowest cell.
    let lowest = 0;
    for (let i = 1; i < n; i++) if (elevation[i]! < elevation[lowest]!) lowest = i;
    filled[lowest] = elevation[lowest]!;
    closed[lowest] = 1;
    queue.push(lowest, filled[lowest]!);
  }

  while (queue.size > 0) {
    const c = queue.pop();
    // Ocean seeds are already in the order; land joins it as it is reached.
    if (elevation[c]! >= SEA_LEVEL) order[visited++] = c;
    for (let d = 0; d < NEIGHBOR_COUNT; d++) {
      const nb = neighbors[c * NEIGHBOR_COUNT + d]!;
      if (nb < 0 || closed[nb]) continue;
      closed[nb] = 1;
      filled[nb] = Math.max(elevation[nb]!, filled[c]! + FILL_EPSILON);
      queue.push(nb, filled[nb]!);
    }
  }
  return filled;
}

function assignReceivers(
  grid: Grid,
  filled: Float64Array,
  elevation: Float32Array,
  receiver: Int32Array,
): void {
  const { neighbors, rowDistance } = getTopology(grid);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      receiver[i] = -1;
      if (elevation[i]! < SEA_LEVEL) continue;
      let steepest = 0;
      for (let d = 0; d < NEIGHBOR_COUNT; d++) {
        const nb = neighbors[i * NEIGHBOR_COUNT + d]!;
        if (nb < 0) continue;
        const slope = (filled[i]! - filled[nb]!) / rowDistance[y * NEIGHBOR_COUNT + d]!;
        if (slope > steepest) {
          steepest = slope;
          receiver[i] = nb;
        }
      }
    }
  }
}

function accumulateDrainageArea(
  grid: Grid,
  receiver: Int32Array,
  order: Int32Array,
  area: Float32Array,
): void {
  for (let i = 0; i < grid.cellCount; i++) area[i] = grid.rowCellArea[Math.floor(i / grid.width)]!;
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    const r = receiver[i]!;
    if (r >= 0) area[r] = area[r]! + area[i]!;
  }
}

/** Distance in metres from cell `i` to its neighbour `j`, or NaN if they are not adjacent. */
export function neighborDistance(grid: Grid, i: number, j: number): number {
  const { neighbors, rowDistance } = getTopology(grid);
  const y = Math.floor(i / grid.width);
  for (let d = 0; d < NEIGHBOR_COUNT; d++) {
    if (neighbors[i * NEIGHBOR_COUNT + d] === j) return rowDistance[y * NEIGHBOR_COUNT + d]!;
  }
  return NaN;
}
