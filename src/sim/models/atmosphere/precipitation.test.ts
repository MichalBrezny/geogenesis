import { describe, expect, it } from 'vitest';
import { cellIndex } from '../../core/grid';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import { precipitationModel, prevailingWind, zonalPrecipitation } from './precipitation';

const rng = createRng(1);

describe('precipitation', () => {
  it('has wet tropics, dry subtropics and wetter mid-latitudes', () => {
    expect(zonalPrecipitation(0)).toBeGreaterThan(2000);
    expect(zonalPrecipitation(27)).toBeLessThan(zonalPrecipitation(0) / 2);
    expect(zonalPrecipitation(50)).toBeGreaterThan(zonalPrecipitation(27));
    expect(zonalPrecipitation(85)).toBeLessThan(zonalPrecipitation(50));
  });

  it('leaves a rain shadow behind a mountain range', () => {
    const planet = createPlanet({ width: 64, height: 32 });
    const { grid, fields } = planet;
    fields.elevation.fill(-3000);
    fields.airTemperature.fill(15);
    // A mid-latitude continent with a north-south range in the middle (all rows here
    // have westerlies).
    const y = grid.rowLatitude.findIndex((lat) => lat < 45);
    expect(prevailingWind(grid.rowLatitude[y]!)).toBe(1);
    for (let row = y - 2; row <= y + 2; row++) {
      for (let x = 18; x < 33; x++) {
        fields.elevation[cellIndex(grid, x, row)] = x === 25 ? 3000 : 200;
      }
    }
    precipitationModel.runOneStep(planet, 0, rng);

    const rain = (x: number) => fields.precipitation[cellIndex(grid, x, y)]!;
    // Westerlies: the windward (west) slope is wetter than the lee (east) side.
    expect(rain(25)).toBeGreaterThan(rain(24));
    expect(rain(27)).toBeLessThan(rain(23) * 0.7);
    // Inland is drier than the coast.
    expect(rain(23)).toBeLessThan(rain(18));
  });

  it('rains more where it is warmer', () => {
    const planet = createPlanet({ width: 16, height: 8 });
    planet.fields.elevation.fill(-3000);
    planet.fields.airTemperature.fill(5);
    precipitationModel.runOneStep(planet, 0, rng);
    const cold = Float32Array.from(planet.fields.precipitation);
    planet.fields.airTemperature.fill(25);
    precipitationModel.runOneStep(planet, 0, rng);
    for (let i = 0; i < cold.length; i++) {
      expect(planet.fields.precipitation[i]!).toBeGreaterThan(cold[i]!);
    }
  });
});
