import { describe, expect, it } from 'vitest';
import { cellIndex } from '../../core/grid';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { circulationModel, zonalPressureAnomaly } from './circulation';

const rng = createRng(1);

function climatePlanet(): PlanetState {
  const planet = createPlanet({ width: 64, height: 32 });
  const { grid, fields } = planet;
  fields.elevation.fill(-3000);
  for (let y = 0; y < grid.height; y++) {
    const sine = Math.sin((grid.rowLatitude[y]! * Math.PI) / 180);
    fields.airTemperature.fill(28 - 45 * sine * sine, y * grid.width, (y + 1) * grid.width);
  }
  return planet;
}

function tropicalContinent(warming: number): PlanetState {
  const planet = climatePlanet();
  const { grid, fields } = planet;
  for (let y = 0; y < grid.height; y++) {
    if (Math.abs(grid.rowLatitude[y]!) > 12) continue;
    for (let x = 28; x <= 35; x++) {
      const i = cellIndex(grid, x, y);
      fields.elevation[i] = 0;
      fields.airTemperature[i]! += warming;
    }
  }
  return planet;
}

describe('thermal pressure systems', () => {
  it('places the zonal pressure belts at the circulation-cell boundaries', () => {
    expect(zonalPressureAnomaly(0, 0, 30)).toBeCloseTo(-4);
    expect(zonalPressureAnomaly(30, 0, 30)).toBeCloseTo(6);
    expect(zonalPressureAnomaly(60, 0, 30)).toBeCloseTo(-10);
    expect(zonalPressureAnomaly(90, 0, 30)).toBeCloseTo(4);
  });

  it('makes a hot tropical continent a low with onshore wind', () => {
    const neutral = tropicalContinent(0);
    const hot = tropicalContinent(12);
    circulationModel.runOneStep(neutral, 0, rng);
    circulationModel.runOneStep(hot, 0, rng);
    const { grid, fields } = hot;
    const y = grid.rowLatitude.findIndex((latitude) => latitude < 3);
    const centre = cellIndex(grid, 31, y);
    const openSea = cellIndex(grid, 12, y);
    expect(fields.pressure[centre]!).toBeLessThan(fields.pressure[openSea]! - 2);

    // The thermal addition points east into the west coast and west into the east coast.
    const west = cellIndex(grid, 27, y);
    const east = cellIndex(grid, 36, y);
    expect(fields.windU[west]! - neutral.fields.windU[west]!).toBeGreaterThan(0.2);
    expect(fields.windU[east]! - neutral.fields.windU[east]!).toBeLessThan(-0.2);
  });

  it('makes a cold high-latitude continent a high', () => {
    const planet = climatePlanet();
    const { grid, fields } = planet;
    for (let y = 0; y < grid.height; y++) {
      const latitude = grid.rowLatitude[y]!;
      if (latitude < 50 || latitude > 68) continue;
      for (let x = 27; x <= 36; x++) {
        const i = cellIndex(grid, x, y);
        fields.elevation[i] = 0;
        fields.airTemperature[i]! -= 14;
      }
    }
    circulationModel.runOneStep(planet, 0, rng);
    const y = grid.rowLatitude.findIndex((latitude) => latitude < 60);
    expect(fields.pressure[cellIndex(grid, 31, y)]!).toBeGreaterThan(
      fields.pressure[cellIndex(grid, 12, y)]! + 2,
    );
  });
});
