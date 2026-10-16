import { describe, expect, it } from 'vitest';
import {
  extractIsobars,
  findPressureExtrema,
  PRESSURE_LABEL_MIN_SPACING_KM,
  type PressureField,
} from './isobars';

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

function highBelt(bulges: readonly { longitude: number; strength: number }[]): PressureField {
  const width = 144;
  const height = 72;
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const latitude = 90 - ((y + 0.5) * 180) / height;
    const belt = Math.exp(-0.5 * ((latitude - 30) / 7) ** 2);
    for (let x = 0; x < width; x++) {
      const longitude = ((x + 0.5) * 360) / width;
      let pressure = 1013 + 6 * belt;
      for (const bulge of bulges) {
        const distance = Math.abs(((longitude - bulge.longitude + 540) % 360) - 180);
        pressure += bulge.strength * belt * Math.exp(-0.5 * (distance / 5) ** 2);
      }
      values[y * width + x] = pressure;
    }
  }
  return { width, height, values };
}

function distanceKm(a: { latitude: number; longitude: number }, b: typeof a): number {
  const radians = Math.PI / 180;
  const latA = a.latitude * radians;
  const latB = b.latitude * radians;
  const dLat = latB - latA;
  const dLon = (b.longitude - a.longitude) * radians;
  const chord = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(chord)));
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

  it('labels one stronger bulge along an otherwise zonal band', () => {
    const extrema = findPressureExtrema(highBelt([{ longitude: 140, strength: 4 }]));
    expect(extrema).toHaveLength(1);
    expect(extrema[0]!.kind).toBe('H');
    expect(Math.abs(extrema[0]!.latitude - 30)).toBeLessThan(2);
    expect(Math.abs(extrema[0]!.longitude - 140)).toBeLessThan(2);
  });

  it('keeps pressure-centre labels at least the minimum distance apart', () => {
    const extrema = findPressureExtrema(
      highBelt([
        { longitude: 80, strength: 5 },
        { longitude: 110, strength: 4.8 },
        { longitude: 230, strength: 4 },
      ]),
    );
    expect(extrema).toHaveLength(2);
    for (let i = 0; i < extrema.length; i++) {
      for (let j = i + 1; j < extrema.length; j++) {
        expect(distanceKm(extrema[i]!, extrema[j]!)).toBeGreaterThanOrEqual(
          PRESSURE_LABEL_MIN_SPACING_KM,
        );
      }
    }
  });
});
