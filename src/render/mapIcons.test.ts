import { describe, expect, it } from 'vitest';
import { viewportProjection } from './viewport';
import { sampleIconCells } from './mapIcons';

describe('map icon lattice', () => {
  it('is anchored to geography while a flat map pans', () => {
    const common = { gridWidth: 256, gridHeight: 128, screenWidth: 800, screenHeight: 400 };
    const firstView = { zoom: 4, latitude: 0, longitude: 180 };
    const secondView = { ...firstView, longitude: 185 };
    const bounds = (view: typeof firstView) => ({
      west: view.longitude - 180 / view.zoom,
      north: view.latitude + 90 / view.zoom,
      lonSpan: 360 / view.zoom,
      latSpan: 180 / view.zoom,
    });
    const first = sampleIconCells({
      ...common,
      bounds: bounds(firstView),
      project: viewportProjection(800, 400, firstView),
    });
    const second = sampleIconCells({
      ...common,
      bounds: bounds(secondView),
      project: viewportProjection(800, 400, secondView),
    });
    const firstCells = new Set(first.map((sample) => sample.cell));
    const shared = second.filter((sample) => firstCells.has(sample.cell));
    expect(first.length).toBeGreaterThan(100);
    expect(shared.length).toBeGreaterThan(first.length * 0.8);
    for (const sample of shared) {
      const before = first.find((candidate) => candidate.cell === sample.cell)!;
      expect(sample.x - before.x).toBeCloseTo(-800 * (5 / 90), 4);
      expect(sample.y).toBeCloseTo(before.y, 4);
    }
  });

  it('deduplicates lattice points that land in the same coarse grid cell', () => {
    const samples = sampleIconCells({
      gridWidth: 8,
      gridHeight: 4,
      screenWidth: 1200,
      screenHeight: 600,
      bounds: { west: 0, north: 90, lonSpan: 360, latSpan: 180 },
      project: (latitude, longitude) => [longitude * (1200 / 360), (90 - latitude) * (600 / 180)],
    });
    expect(samples.length).toBeLessThanOrEqual(32);
    expect(new Set(samples.map((sample) => sample.cell)).size).toBe(samples.length);
  });
});
