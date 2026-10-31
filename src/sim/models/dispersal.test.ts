import { describe, expect, it } from 'vitest';
import { cellIndex, createGrid } from '../core/grid';
import { createRng } from '../core/rng';
import { disperse } from './dispersal';

/** Settled area (km²) after `years`, from one settled cell on the equator, mean of a few runs. */
function settledArea(width: number, height: number, years: number, dt: number): number {
  const grid = createGrid(width, height);
  let total = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const settled = new Uint8Array(grid.cellCount);
    settled[cellIndex(grid, width / 2, height / 2)] = 1;
    const rng = createRng(seed);
    for (let t = 0; t < years; t += dt) {
      disperse(grid, {
        dtYears: dt,
        speed: 0.3,
        rng,
        isSource: (i) => settled[i] === 1,
        canEnter: (i) => settled[i] === 0,
        settle: (i) => {
          settled[i] = 1;
        },
      });
    }
    for (let i = 0; i < grid.cellCount; i++) {
      if (settled[i]) total += grid.rowCellArea[Math.floor(i / width)]! / 1e6;
    }
  }
  return total / 4;
}

describe('dispersal', () => {
  it('moves at the same speed whatever the step length and the resolution', () => {
    const reference = settledArea(128, 64, 10e6, 1e6);
    // 300 km/Myr for 10 Myr: a patch some thousands of km across.
    expect(Math.sqrt(reference)).toBeGreaterThan(2000);
    expect(Math.sqrt(reference)).toBeLessThan(12000);
    for (const [w, h, dt] of [
      [128, 64, 10e6],
      [128, 64, 0.1e6],
      [256, 128, 1e6],
    ] as const) {
      const area = settledArea(w, h, 10e6, dt);
      expect(Math.abs(area - reference) / reference).toBeLessThan(0.3);
    }
  });

  it('crosses the same physical sea gap at coarse and fine resolutions', () => {
    for (const [width, height, targetOffset] of [
      [64, 32, 2],
      [128, 64, 3],
    ] as const) {
      const grid = createGrid(width, height);
      const source = cellIndex(grid, width / 2, height / 2);
      const target = cellIndex(grid, width / 2 + targetOffset, height / 2);
      const settled = new Uint8Array(grid.cellCount);
      settled[source] = 1;
      disperse(grid, {
        dtYears: 10_000,
        speed: 80,
        reach: 700_000,
        rng: createRng(1),
        isSource: (i) => settled[i] === 1,
        canEnter: (i) => i === target,
        settle: (i) => {
          settled[i] = 1;
        },
      });
      expect(settled[target]).toBe(1);
    }
  });
});
