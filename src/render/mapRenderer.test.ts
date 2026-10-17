import { describe, expect, it } from 'vitest';
import { createPlanet } from '../sim/core/planet';
import { displayedTemperature } from './mapRenderer';

describe('temperature map months', () => {
  it('shows opposite January and July seasons in the two hemispheres', () => {
    const planet = createPlanet({ width: 2, height: 2 });
    planet.fields.airTemperature.fill(10);
    planet.fields.seasonalAmplitude.fill(5);
    const source = { grid: planet.grid, fields: planet.fields, seaLevel: 0 };
    expect(displayedTemperature(source, 0, 'annual')).toBe(10);
    expect(displayedTemperature(source, 0, 'january')).toBe(5);
    expect(displayedTemperature(source, 0, 'july')).toBe(15);
    expect(displayedTemperature(source, 2, 'january')).toBe(15);
    expect(displayedTemperature(source, 2, 'july')).toBe(5);
  });
});
