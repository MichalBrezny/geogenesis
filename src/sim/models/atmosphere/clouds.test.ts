import { describe, expect, it } from 'vitest';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import { createClimate } from './climate';
import { cloudModel } from './clouds';
import { createSurfaceAlbedo } from './surfaceAlbedo';

const rng = createRng(1);

describe('clouds', () => {
  it('are thick where it rains, thin over deserts, and form stratus over cold seas', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    const { fields } = planet;
    fields.airTemperature.fill(25);
    // Cell 0: rainy land; cell 1: desert; cell 2: ordinary sea; cell 3: sea over a cold current.
    fields.elevation.fill(-3000);
    fields.elevation[0] = 300;
    fields.elevation[1] = 300;
    fields.precipitation.fill(800);
    fields.precipitation[0] = 2500;
    fields.precipitation[1] = 50;
    fields.oceanAnomaly[3] = -5;
    cloudModel.runOneStep(planet, 0, rng);
    expect(fields.cloudCover[0]!).toBeGreaterThan(fields.cloudCover[1]! + 0.3);
    expect(fields.lowCloud[3]!).toBeGreaterThan(fields.lowCloud[2]! + 0.2);
  });

  it('need water vapour: a dry or frozen atmosphere has no low cloud', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    const { fields } = planet;
    fields.airTemperature.fill(-60);
    fields.elevation.fill(300);
    fields.elevation[2] = -3000;
    fields.precipitation.fill(0);
    cloudModel.runOneStep(planet, 0, rng);
    const wet = fields.lowCloud[0]!;
    planet.globals.atmosphere.waterVapor = 0;
    cloudModel.runOneStep(planet, 0, rng);
    expect(wet).toBeGreaterThan(0.3);
    expect(fields.lowCloud[0]).toBe(0);
    expect(fields.lowCloud[2]).toBe(0);
  });

  it('cool the planet when there is more low cloud', () => {
    const temperature = (lowCloud: number) => {
      const planet = createPlanet({ width: 64, height: 32 });
      planet.fields.elevation.fill(-4000);
      createSurfaceAlbedo().runOneStep(planet, 0, rng);
      planet.fields.lowCloud.fill(lowCloud);
      planet.globals.cloudCover = lowCloud;
      createClimate().runOneStep(planet, 0, rng);
      return planet.globals.meanTemperature;
    };
    expect(temperature(0.6)).toBeLessThan(temperature(0.2) - 3);
  });
});
