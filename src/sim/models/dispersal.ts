import type { Grid } from '../core/grid';
import type { Rng } from '../core/rng';

export interface DispersalOptions {
  dtYears: number;
  /** Speed of the colonisation front, m/yr. */
  speed: number;
  /**
   * Farthest a settler can jump in one go, in metres, along a row or a column
   * (e.g. across a narrow sea). 0 means only to the four adjacent cells.
   */
  reach?: number;
  rng: Rng;
  /** Whether cell i holds a population that sends out settlers. */
  isSource: (i: number) => boolean;
  /** Whether cell i is empty and could be settled. */
  canEnter: (i: number) => boolean;
  /** Settles cell i. `remaining` is the share of the step still to come (for initial growth). */
  settle: (i: number, remaining: number) => void;
}

/**
 * Share of a cell the front may cover in one pass. A cell settled within a pass
 * only sends settlers from the next one, so coarse passes slow the front down
 * (to 1 − e^(−x) of its speed for x cells per pass); 0.1 keeps it within 5%.
 */
const CELLS_PER_PASS = 0.1;
/** Most passes one step is split into, to bound the cost of very long steps. */
const MAX_PASSES = 256;

/**
 * Moves colonisation fronts at a physical speed, independent of the step length
 * and the grid resolution.
 *
 * An empty cell next to a source is settled with the probability that a front
 * moving at `speed` crosses the distance between them in the time step:
 * 1 − exp(−speed·Δt / distance), summed over all its sources. Steps are split
 * into passes that each cover a small part of a cell, so a front can cross
 * several cells per step, and cells settled in one pass send settlers in the next.
 */
export function disperse(grid: Grid, options: DispersalOptions): void {
  const { dtYears, speed, rng, isSource, canEnter, settle } = options;
  if (dtYears <= 0 || speed <= 0) return;
  const reach = options.reach ?? 0;
  const n = grid.cellCount;
  const passes = Math.min(
    MAX_PASSES,
    Math.max(1, Math.ceil((speed * dtYears) / (grid.dy * CELLS_PER_PASS))),
  );
  const travel = (speed * dtYears) / passes;

  const source = new Uint8Array(n);
  const queued = new Uint8Array(n);
  let frontier: number[] = [];
  const enqueueAround = (i: number) => {
    forEachTarget(grid, i, reach, (j) => {
      if (!queued[j] && !source[j] && canEnter(j)) {
        queued[j] = 1;
        frontier.push(j);
      }
    });
  };
  for (let i = 0; i < n; i++) if (isSource(i)) source[i] = 1;
  for (let i = 0; i < n; i++) if (source[i]) enqueueAround(i);

  for (let pass = 0; pass < passes && frontier.length > 0; pass++) {
    const settled: number[] = [];
    const waiting: number[] = [];
    for (const i of frontier) {
      let exposure = 0;
      forEachTarget(grid, i, reach, (j, distance) => {
        if (source[j]) exposure += travel / distance;
      });
      if (exposure > 0 && rng.next() < 1 - Math.exp(-exposure)) settled.push(i);
      else waiting.push(i);
    }
    frontier = waiting;
    const remaining = 1 - (pass + 1) / passes;
    for (const i of settled) {
      settle(i, remaining);
      source[i] = 1;
      queued[i] = 0;
    }
    for (const i of settled) enqueueAround(i);
  }
}

/**
 * Calls `visit` for the cells reachable from cell i: the four adjacent cells, and
 * with a reach, cells along the row and column up to that distance.
 */
function forEachTarget(
  grid: Grid,
  i: number,
  reach: number,
  visit: (j: number, distance: number) => void,
): void {
  const { width, height, dy, rowDx } = grid;
  const x = i % width;
  const y = (i - x) / width;
  const dx = rowDx[y]!;
  // Near the poles east-west cells get tiny; limit the row steps to a full turn.
  const across = Math.min(Math.floor(width / 2), Math.max(1, Math.floor(reach / dx)));
  const along = Math.max(1, Math.floor(reach / dy));
  for (let k = 1; k <= across; k++) {
    visit(y * width + ((x + k) % width), k * dx);
    visit(y * width + ((x - k + width * k) % width), k * dx);
  }
  for (let k = 1; k <= along; k++) {
    if (y - k >= 0) visit(i - k * width, k * dy);
    if (y + k < height) visit(i + k * width, k * dy);
  }
}
