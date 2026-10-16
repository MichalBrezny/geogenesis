import { describe, expect, it } from 'vitest';
import { globeProjection } from './arrows';
import { buildGlobeLookup, dragGlobe, globeCell, projectGlobe } from './globe';

const W = 64;
const H = 32;

describe('globe projection', () => {
  it('puts the view centre in the middle of the disc', () => {
    const cell = globeCell(0, 0, { longitude: 90, latitude: 0 }, W, H);
    expect(cell % W).toBe(16);
    expect(Math.floor(cell / W)).toBe(16);
  });

  it('shows the north pole at the top when tilted', () => {
    const cell = globeCell(0, 0, { longitude: 0, latitude: 90 }, W, H);
    expect(Math.floor(cell / W)).toBe(0);
  });

  it('wraps longitudes across the date line', () => {
    const east = globeCell(0.5, 0, { longitude: 350, latitude: 0 }, W, H);
    expect(east % W).toBeLessThan(W / 4);
  });

  it('leaves pixels outside the disc empty', () => {
    expect(globeCell(0.9, 0.9, { longitude: 0, latitude: 0 }, W, H)).toBe(-1);
    const lookup = buildGlobeLookup(8, { longitude: 0, latitude: 0 }, W, H);
    const pixels = new Uint8ClampedArray(W * H * 4).fill(200);
    const out = projectGlobe(pixels, lookup);
    expect(out[3]).toBe(0); // corner
    const centre = (4 * 8 + 4) * 4;
    expect(out[centre + 3]).toBe(255);
    expect(out[centre]).toBeGreaterThan(150);
  });

  it('places arrows where the globe shows the same place', () => {
    const view = { longitude: 120, latitude: 25 };
    const project = globeProjection(400, view);
    for (const [lat, lon] of [
      [10.5, 130.5],
      [45.5, 100.5],
      [-20.5, 150.5],
    ] as const) {
      const [px, py] = project(lat, lon)!;
      const cell = globeCell((2 * px) / 400 - 1, 1 - (2 * py) / 400, view, 360, 180);
      expect(cell % 360).toBe(Math.floor(lon));
      expect(Math.floor(cell / 360)).toBe(Math.floor(90 - lat));
    }
    // The far side is hidden.
    expect(project(0, 300)).toBeNull();
  });

  it('turns and clamps the view when dragged', () => {
    expect(dragGlobe({ longitude: 10, latitude: 0 }, 1, 0).longitude).toBeCloseTo(280);
    expect(dragGlobe({ longitude: 0, latitude: 80 }, 0, 1).latitude).toBe(90);
  });
});
