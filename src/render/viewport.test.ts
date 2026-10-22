import { describe, expect, it } from 'vitest';
import { mapProjection } from './arrows';
import {
  clampViewport,
  FULL_VIEW,
  MAX_ZOOM,
  panViewport,
  viewportPoint,
  viewportProjection,
  zoomViewport,
} from './viewport';

describe('map viewport', () => {
  it('matches the plain map projection when not zoomed', () => {
    const plain = mapProjection(800, 400);
    const zoomed = viewportProjection(800, 400, FULL_VIEW);
    for (const [lat, lon] of [
      [0, 0],
      [45, 90],
      [-60, 300],
      [89, 359],
    ] as const) {
      const [ax, ay] = plain(lat, lon)!;
      const [bx, by] = zoomed(lat, lon)!;
      expect(bx).toBeCloseTo(ax, 6);
      expect(by).toBeCloseTo(ay, 6);
    }
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const before = viewportPoint(FULL_VIEW, 0.3, 0.7);
    const view = zoomViewport(FULL_VIEW, 4, 0.3, 0.7);
    const after = viewportPoint(view, 0.3, 0.7);
    expect(view.zoom).toBe(4);
    expect(after.latitude).toBeCloseTo(before.latitude, 6);
    expect(after.longitude).toBeCloseTo(before.longitude, 6);
  });

  it('clamps the zoom and keeps the view inside the poles', () => {
    expect(zoomViewport(FULL_VIEW, 100).zoom).toBe(MAX_ZOOM);
    expect(zoomViewport(FULL_VIEW, 0.1).zoom).toBe(1);
    const view = clampViewport({ zoom: 2, latitude: 80, longitude: 10 });
    expect(view.latitude).toBe(45);
  });

  it('wraps east-west when panning across the date line', () => {
    const view = panViewport({ zoom: 4, latitude: 0, longitude: 10 }, 1 / 6, 0);
    expect(view.longitude).toBeCloseTo(355, 6);
    const project = viewportProjection(400, 200, view);
    // 355° is the centre; 5° just east of the 0° line is to the right of it.
    expect(project(0, 355)![0]).toBeCloseTo(200, 6);
    expect(project(0, 5)![0]).toBeGreaterThan(200);
  });

  it('puts points just west of the view off the west edge', () => {
    const project = viewportProjection(400, 200, { zoom: 4, latitude: 0, longitude: 180 });
    expect(project(0, 130)![0]).toBeLessThan(0);
    expect(project(0, 230)![0]).toBeGreaterThan(400);
  });
});
