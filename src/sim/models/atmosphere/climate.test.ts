import { describe, expect, it } from 'vitest';
import { areaWeightedMean } from '../../core/grid';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { generateTectonicPlanet } from '../geosphere/tectonics';
import {
  annualInsolation,
  createClimate,
  firstAnnualInsolationHarmonic,
  greenhouseForcing,
  seasonalTemperatureAmplitude,
} from './climate';
import { SOLAR_CONSTANT, stellarLuminosity, SUN_AGE } from './star';
import { createSurfaceAlbedo } from './surfaceAlbedo';

const rng = createRng(1);

function oceanPlanet(): PlanetState {
  const planet = createPlanet({ width: 64, height: 32 });
  planet.fields.elevation.fill(-4000);
  createSurfaceAlbedo().runOneStep(planet, 0, rng);
  return planet;
}

function earthLike(): PlanetState {
  const planet = createPlanet({ seed: 3 });
  generateTectonicPlanet(planet);
  planet.fields.precipitation.fill(500);
  createSurfaceAlbedo().runOneStep(planet, 0, rng);
  return planet;
}

describe('star', () => {
  it('is about 70% as bright at birth and 100% at the age of the Sun', () => {
    expect(stellarLuminosity(0)).toBeCloseTo(0.714, 2);
    expect(stellarLuminosity(SUN_AGE)).toBeCloseTo(1, 6);
    expect(stellarLuminosity(8e9)).toBeGreaterThan(1.3);
  });
});

describe('climate', () => {
  it('integrates Earth-obliquity insolation close to the former North fit', () => {
    for (const latitude of [0, 15, 30, 45, 60, 75, 89.9]) {
      const x = Math.sin((latitude * Math.PI) / 180);
      const p2 = (3 * x * x - 1) / 2;
      const northFit = (SOLAR_CONSTANT / 4) * (1 - 0.482 * p2);
      expect(Math.abs(annualInsolation(latitude, 1, 23.44) - northFit)).toBeLessThan(8);
    }
  });

  it('conserves global sunlight and responds physically to obliquity', () => {
    expect(firstAnnualInsolationHarmonic(60, 1, 0)).toBeCloseTo(0, 10);
    expect(annualInsolation(89.999, 1, 90)).toBeGreaterThan(annualInsolation(0, 1, 90));
    for (const obliquity of [0, 23.44, 45, 90]) {
      let mean = 0;
      const rows = 720;
      for (let y = 0; y < rows; y++) {
        const north = Math.PI / 2 - (y * Math.PI) / rows;
        const south = Math.PI / 2 - ((y + 1) * Math.PI) / rows;
        const latitude = 90 - ((y + 0.5) * 180) / rows;
        mean +=
          (annualInsolation(latitude, 1, obliquity) * (Math.sin(north) - Math.sin(south))) / 2;
      }
      expect(mean).toBeCloseTo(SOLAR_CONSTANT / 4, 1);
    }
  });

  it('makes oceans maritime, coasts intermediate and interiors continental', () => {
    const args = [60, 1, 23.44, 0.3] as const;
    const ocean = seasonalTemperatureAmplitude(...args, true, 0, 0);
    const coast = seasonalTemperatureAmplitude(...args, false, 0.5, 0);
    const interior = seasonalTemperatureAmplitude(...args, false, 1, 0);
    expect(ocean).toBeGreaterThan(3);
    expect(ocean).toBeLessThan(6);
    expect(coast).toBeGreaterThan(ocean);
    expect(interior).toBeGreaterThan(coast);
    expect(interior).toBeGreaterThan(15);
    expect(interior).toBeLessThan(30);
    expect(seasonalTemperatureAmplitude(60, 1, 0, 0.3, false, 1, 0)).toBeCloseTo(0, 10);
    expect(seasonalTemperatureAmplitude(60, 1, 45, 0.3, false, 1, 0)).toBeGreaterThan(interior);
  });

  it('warms gradually after a jump in CO₂ when steps are short (ocean heat capacity)', () => {
    const planet = oceanPlanet();
    const climate = createClimate();
    climate.runOneStep(planet, 0, rng);
    const before = planet.globals.meanTemperature;
    planet.globals.atmosphere.co2 *= 4;
    climate.runOneStep(planet, 10, rng);
    const afterTenYears = planet.globals.meanTemperature;
    for (let year = 10; year < 1000; year += 10) climate.runOneStep(planet, 10, rng);
    const settled = planet.globals.meanTemperature;
    expect(settled - before).toBeGreaterThan(3);
    // A decade in, only part of the eventual warming has arrived.
    expect(afterTenYears - before).toBeGreaterThan(0.1 * (settled - before));
    expect(afterTenYears - before).toBeLessThan(0.5 * (settled - before));
    // Long steps reach equilibrium at once.
    const fresh = oceanPlanet();
    climate.runOneStep(fresh, 0, rng);
    fresh.globals.atmosphere.co2 *= 4;
    climate.runOneStep(fresh, 1e6, rng);
    expect(fresh.globals.meanTemperature).toBeCloseTo(settled, 0);
  });

  it('gives an Earth-like planet an Earth-like climate', () => {
    const planet = earthLike();
    createClimate().runOneStep(planet, 0, rng);
    const { meanTemperature, iceFraction } = planet.globals;
    expect(meanTemperature).toBeGreaterThan(9);
    expect(meanTemperature).toBeLessThan(18);
    expect(iceFraction).toBeGreaterThan(0.02);
    expect(iceFraction).toBeLessThan(0.25);
    // Equator warmer than the poles.
    const { width, height } = planet.grid;
    const t = planet.fields.airTemperature;
    const rowMean = (y: number) =>
      t.slice(y * width, (y + 1) * width).reduce((a, b) => a + b) / width;
    expect(rowMean(height / 2)).toBeGreaterThan(rowMean(0) + 30);
  });

  it('balances absorbed sunlight against outgoing radiation globally', () => {
    const planet = oceanPlanet();
    createClimate().runOneStep(planet, 0, rng);
    const { grid, fields, globals } = planet;
    const absorbed = new Float32Array(grid.cellCount);
    for (let i = 0; i < grid.cellCount; i++) {
      const latitude = grid.rowLatitude[Math.floor(i / grid.width)]!;
      absorbed[i] =
        annualInsolation(latitude, globals.solarInput, planet.controls.obliquity) *
        (1 - fields.albedo[i]!);
    }
    const outgoing = 203.3 + 2.09 * globals.meanTemperature - greenhouseForcing(globals.atmosphere);
    expect(areaWeightedMean(grid, absorbed)).toBeCloseTo(outgoing, 0);
  });

  it('warms with more CO₂', () => {
    const temperatures = [100, 280, 1000, 4000].map((co2) => {
      const planet = earthLike();
      planet.globals.atmosphere.co2 = co2;
      createClimate().runOneStep(planet, 0, rng);
      return planet.globals.meanTemperature;
    });
    for (let k = 1; k < temperatures.length; k++) {
      expect(temperatures[k]!).toBeGreaterThan(temperatures[k - 1]!);
    }
  });

  it('remembers a snowball: the same sunlight supports a warm and a frozen state', () => {
    const warm = oceanPlanet();
    const frozen = oceanPlanet();
    frozen.fields.iceCover.fill(1);
    for (const planet of [warm, frozen]) {
      planet.globals.solarInput = 0.95;
      createClimate().runOneStep(planet, 0, rng);
    }
    expect(warm.globals.iceFraction).toBeLessThan(0.5);
    expect(frozen.globals.iceFraction).toBeGreaterThan(0.95);
    expect(frozen.globals.meanTemperature).toBeLessThan(warm.globals.meanTemperature - 30);
  });
});
