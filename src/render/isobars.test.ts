import { describe, expect, it } from 'vitest';
import { extractIsobars, findPressureExtrema, type PressureField } from './isobars';

function circularLow(): PressureField {
  const width = 41;
  const height = 21;
  const values = new Float32Array(width * height);
  const centreX = 20;
  const centreY = 10;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const radiusSquared = (x - centreX) ** 2 + (y - centreY) ** 2;
      values[y * width + x] = 995 + 0.6 * radiusSquared;
    }
  }
  return { width, height, values };
}

describe('isobars', () => {
  it('extracts closed contours at 4 hPa levels around a circular low', () => {
    const contours = extractIsobars(circularLow());
    const contour = contours.find((candidate) => candidate.level === 1000);
    expect(contour).toBeDefined();
    expect(contour!.closed).toBe(true);
    expect(contour!.points.length).toBeGreaterThan(12);
    expect(contour!.points[0]).toEqual(contour!.points.at(-1));
  });

  it('labels the circular pressure minimum as a low', () => {
    const extrema = findPressureExtrema(circularLow());
    expect(extrema).toHaveLength(1);
    expect(extrema[0]!.kind).toBe('L');
    expect(extrema[0]!.value).toBeCloseTo(995);
  });
});
