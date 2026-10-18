import { describe, expect, it } from 'vitest';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import { landIceWaterGel } from '../geosphere/seaLevel';
import { landIceMassBalance, seasonalSnowFractionAt, snowFractionAt, surfaceIceCover } from './ice';

const rng = createRng(1);

describe('landIceMassBalance', () => {
  it('keeps the annual-mean snow and cover behavior when amplitude is zero', () => {
    for (const temperature of [-20, -10, -2, 0, 2, 10]) {
      expect(seasonalSnowFractionAt(temperature, 0)).toBe(snowFractionAt(temperature));
      expect(surfaceIceCover(true, temperature, 500, 0, 0)).toBe(
        surfaceIceCover(true, temperature, 500, 0),
      );
    }
  });

  it('grows ice on snowy cold land but leaves a dry polar desert bare', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    planet.fields.elevation.fill(200);
    planet.fields.airTemperature.fill(-10);
    for (let y = 0; y < planet.grid.height; y++) {
      for (let x = 0; x < planet.grid.width / 2; x++) {
        planet.fields.precipitation[y * planet.grid.width + x] = 500;
      }
    }

    landIceMassBalance.runOneStep(planet, 100_000, rng);

    const snowy = planet.fields.iceThickness[0]!;
    const dry = planet.fields.iceThickness[planet.grid.width - 1]!;
    expect(snowy).toBeGreaterThan(500);
    expect(planet.fields.iceCover[0]).toBeGreaterThan(0.9);
    expect(dry).toBe(0);
    expect(planet.fields.iceCover[planet.grid.width - 1]).toBe(0);
  });

  it('ablates an ice sheet after the climate warms', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    planet.fields.elevation.fill(200);
    planet.fields.airTemperature.fill(-8);
    planet.fields.precipitation.fill(600);
    landIceMassBalance.runOneStep(planet, 100_000, rng);
    const frozen = planet.fields.iceThickness[0]!;

    planet.fields.airTemperature.fill(8);
    planet.fields.precipitation.fill(0);
    landIceMassBalance.runOneStep(planet, 10_000, rng);

    expect(frozen).toBeGreaterThan(500);
    expect(planet.fields.iceThickness[0]).toBeLessThan(1);
    expect(planet.fields.iceCover[0]).toBeLessThan(0.01);
  });

  it('cannot lock up more water than the planet has', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    planet.fields.elevation.fill(200);
    planet.fields.elevation[0] = -1000;
    planet.fields.airTemperature.fill(-10);
    planet.fields.precipitation.fill(500);
    planet.globals.water = 0.1;
    planet.globals.atmosphere.waterVapor = 0;
    landIceMassBalance.runOneStep(planet, 1e6, rng);
    const ice = landIceWaterGel(planet);
    expect(ice).toBeGreaterThan(0.05);
    expect(ice).toBeLessThanOrEqual(0.08 + 1e-9);
  });

  it('keeps cold ice when no sea is left to receive its meltwater', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    planet.fields.elevation.fill(200);
    planet.fields.airTemperature.fill(-40);
    planet.fields.iceThickness.fill(50);
    planet.fields.precipitation.fill(0);
    landIceMassBalance.runOneStep(planet, 1e7, rng);
    expect(planet.fields.iceThickness[0]).toBe(50);
  });
});
