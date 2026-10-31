import { describe, expect, it } from 'vitest';
import { areaWeightedMean, createGrid } from '../../core/grid';
import { resampleTopography } from '.';

const SOURCE_SIZE = [512, 256] as const;

describe('real planet topography', () => {
  for (const name of ['mars', 'venus'] as const) {
    it(`preserves the spherical mean when resampling ${name}`, () => {
      const sourceGrid = createGrid(...SOURCE_SIZE);
      const sourceMean = areaWeightedMean(sourceGrid, resampleTopography(name, sourceGrid));
      for (const [width, height] of [
        [64, 32],
        [100, 50],
        [128, 64],
        [256, 128],
        [512, 256],
      ] as const) {
        const grid = createGrid(width, height);
        const mean = areaWeightedMean(grid, resampleTopography(name, grid));
        expect(mean).toBeCloseTo(sourceMean, 2);
      }
    });
  }

  it('keeps Olympus Mons and Hellas in their expected Mars regions', () => {
    const grid = createGrid(128, 64);
    const elevation = resampleTopography('mars', grid);
    const highest = extremeCell(elevation, 'highest');
    const olympus = coordinateCell(grid.width, grid.height, 18.6, 226);

    expect(
      wrappedColumnDistance(highest % grid.width, olympus % grid.width, grid.width),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(Math.floor(highest / grid.width) - Math.floor(olympus / grid.width)),
    ).toBeLessThanOrEqual(1);
    expect(elevation[highest]).toBeGreaterThan(18_000);

    const hellasMinimum = neighborhoodExtreme(
      elevation,
      grid.width,
      grid.height,
      -42,
      70,
      6,
      'lowest',
    );
    expect(hellasMinimum).toBeLessThan(-6_500);
    expect(hellasMinimum).toBeLessThan(elevation[extremeCell(elevation, 'lowest')]! + 500);
  });

  it('keeps Maxwell Montes in the highest Venus neighbourhood', () => {
    const grid = createGrid(128, 64);
    const elevation = resampleTopography('venus', grid);
    const highest = extremeCell(elevation, 'highest');
    const maxwell = coordinateCell(grid.width, grid.height, 65, 3);

    expect(
      wrappedColumnDistance(highest % grid.width, maxwell % grid.width, grid.width),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(Math.floor(highest / grid.width) - Math.floor(maxwell / grid.width)),
    ).toBeLessThanOrEqual(1);
    expect(elevation[highest]).toBeGreaterThan(9_000);
  });
});

function coordinateCell(
  width: number,
  height: number,
  latitude: number,
  longitude: number,
): number {
  const x = Math.floor(((((longitude % 360) + 360) % 360) / 360) * width);
  const y = Math.min(height - 1, Math.floor(((90 - latitude) / 180) * height));
  return y * width + x;
}

function extremeCell(elevation: Float32Array, which: 'highest' | 'lowest'): number {
  let result = 0;
  for (let i = 1; i < elevation.length; i++) {
    if (
      (which === 'highest' && elevation[i]! > elevation[result]!) ||
      (which === 'lowest' && elevation[i]! < elevation[result]!)
    ) {
      result = i;
    }
  }
  return result;
}

function neighborhoodExtreme(
  elevation: Float32Array,
  width: number,
  height: number,
  latitude: number,
  longitude: number,
  radius: number,
  which: 'highest' | 'lowest',
): number {
  const center = coordinateCell(width, height, latitude, longitude);
  const centerX = center % width;
  const centerY = Math.floor(center / width);
  let result = which === 'highest' ? -Infinity : Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = Math.max(0, Math.min(height - 1, centerY + dy));
    for (let dx = -radius; dx <= radius; dx++) {
      const x = (centerX + dx + width) % width;
      const value = elevation[y * width + x]!;
      result = which === 'highest' ? Math.max(result, value) : Math.min(result, value);
    }
  }
  return result;
}

function wrappedColumnDistance(a: number, b: number, width: number): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, width - direct);
}
