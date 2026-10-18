import { describe, expect, it } from 'vitest';
import { cellIndex } from '../../core/grid';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { cellWind, circulationModel, zonalPressureAnomaly } from './circulation';

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

describe('planet parameters', () => {
  function run(
    params: Partial<PlanetState['planetParams']>,
    surfacePressure?: number,
  ): PlanetState {
    const planet = climatePlanet();
    Object.assign(planet.planetParams, params);
    if (surfacePressure !== undefined) planet.globals.surfacePressure = surfacePressure;
    circulationModel.runOneStep(planet, 0, rng);
    return planet;
  }

  it('gives Earth defaults the same fields as explicit Earth parameters', () => {
    const a = run({});
    const b = run({ rotationPeriodHours: 24, tidallyLocked: false });
    expect(Array.from(b.fields.windU)).toEqual(Array.from(a.fields.windU));
    expect(Array.from(b.fields.windV)).toEqual(Array.from(a.fields.windV));
    expect(Array.from(b.fields.pressure)).toEqual(Array.from(a.fields.pressure));
  });

  it('keeps the pressure map an anomaly around 1013 hPa whatever the surface pressure', () => {
    const a = run({}, 1.013);
    const b = run({}, 0.79);
    expect(Array.from(b.fields.pressure)).toEqual(Array.from(a.fields.pressure));
    expect(Math.max(...b.fields.pressure)).toBeLessThan(1040);
    expect(Math.min(...b.fields.pressure)).toBeGreaterThan(990);
  });

  it('keeps the three-cell wind unchanged for Earth widths', () => {
    expect(cellWind(10, 0, 40)[0]).toBeLessThan(0);
    expect(cellWind(45, 0, 40)[0]).toBeGreaterThan(0);
    expect(cellWind(80, 0, 40)[0]).toBeLessThan(0);
  });

  it('widens the Hadley cells on a slow rotator into a single cell', () => {
    const slow = run({ rotationPeriodHours: 24 * 243 });
    expect(slow.globals.circulation!.hadleyWidth).toBeGreaterThanOrEqual(60);
    expect(run({}).globals.circulation!.hadleyWidth).toBeLessThanOrEqual(40);
    // No midlatitude westerlies, and equatorward return flow reaches the pole.
    expect(cellWind(45, 0, 90)[0]).toBeLessThan(0);
    expect(cellWind(80, 0, 90)[1]).toBeLessThan(0);
    expect(zonalPressureAnomaly(80, 0, 90)).toBeGreaterThan(zonalPressureAnomaly(0, 0, 90));
    // Smooth transition.
    const w = [44, 50, 55, 60, 65].map((width) => cellWind(45, 0, width)[0]);
    for (let i = 1; i < w.length; i++) expect(Math.abs(w[i]! - w[i - 1]!)).toBeLessThan(4);
  });

  it('mirrors the zonal flow for retrograde rotation, not the meridional flow', () => {
    const pro = run({});
    const retro = run({ rotationPeriodHours: -24 });
    const { grid } = pro;
    const y = grid.rowLatitude.findIndex((latitude) => latitude < 10);
    const i = cellIndex(grid, 5, y);
    expect(retro.fields.windU[i]!).toBeCloseTo(-pro.fields.windU[i]!, 4);
    expect(retro.fields.windV[i]!).toBeCloseTo(pro.fields.windV[i]!, 4);
  });
});
