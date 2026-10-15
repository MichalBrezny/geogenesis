import { describe, expect, it } from 'vitest';
import { areaWeightedMean, cellIndex, createGrid, neighbors4 } from './grid';

describe('grid', () => {
  const grid = createGrid(8, 4);

  it('wraps east-west', () => {
    expect(cellIndex(grid, -1, 0)).toBe(7);
    expect(cellIndex(grid, 8, 1)).toBe(8);
  });

  it('has no neighbour beyond the poles', () => {
    const north = neighbors4(grid, cellIndex(grid, 0, 0));
    expect(north[0]).toBe(-1);
    expect(north[3]).toBe(cellIndex(grid, 7, 0));
    const south = neighbors4(grid, cellIndex(grid, 3, 3));
    expect(south[2]).toBe(-1);
  });

  it('area weights sum to 1 and favour the equator', () => {
    const ones = new Float32Array(grid.cellCount).fill(1);
    expect(areaWeightedMean(grid, ones)).toBeCloseTo(1, 10);
    expect(grid.rowAreaWeight[1]!).toBeGreaterThan(grid.rowAreaWeight[0]!);
  });

  it('rejects invalid sizes', () => {
    expect(() => createGrid(1, 4)).toThrow();
    expect(() => createGrid(8.5, 4)).toThrow();
  });
});
