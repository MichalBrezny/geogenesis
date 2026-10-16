import { describe, expect, it } from 'vitest';
import { cellIndex } from '../../core/grid';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { cellWind, circulationModel, thermalEquator } from './circulation';
import { precipitationModel } from './precipitation';

const rng = createRng(1);

/** An ocean planet with an Earth-like temperature profile. */
function aquaplanet(width = 64, height = 32): PlanetState {
  const planet = createPlanet({ width, height });
  const { grid, fields } = planet;
  fields.elevation.fill(-3000);
  for (let y = 0; y < grid.height; y++) {
    const s = Math.sin((grid.rowLatitude[y]! * Math.PI) / 180);
    fields.airTemperature.fill(28 - 45 * s * s, y * grid.width, (y + 1) * grid.width);
  }
  return planet;
}

function rainAndWind(planet: PlanetState): void {
  circulationModel.runOneStep(planet, 0, rng);
  precipitationModel.runOneStep(planet, 0, rng);
}

/** Mean of a field over the rows within a latitude range. */
function zonalMean(planet: PlanetState, values: Float32Array, from: number, to: number): number {
  const { grid } = planet;
  let sum = 0;
  let count = 0;
  for (let y = 0; y < grid.height; y++) {
    const latitude = grid.rowLatitude[y]!;
    if (latitude < from || latitude > to) continue;
    for (let x = 0; x < grid.width; x++) {
      sum += values[y * grid.width + x]!;
      count++;
    }
  }
  return sum / count;
}

describe('circulation', () => {
  it('has trade winds, westerlies and polar easterlies', () => {
    const [tradeU, tradeV] = cellWind(15, 0, 30);
    expect(tradeU).toBeLessThan(0);
    expect(tradeV).toBeLessThan(0); // towards the ITCZ
    expect(cellWind(-15, 0, 30)[1]).toBeGreaterThan(0);
    const [westerlyU, westerlyV] = cellWind(45, 0, 30);
    expect(westerlyU).toBeGreaterThan(0);
    expect(westerlyV).toBeGreaterThan(0); // poleward
    expect(cellWind(75, 0, 30)[0]).toBeLessThan(0);
  });

  it('moves the ITCZ towards the warmer hemisphere', () => {
    const planet = aquaplanet();
    const { grid, fields } = planet;
    for (let i = 0; i < grid.cellCount; i++) {
      if (grid.rowLatitude[Math.floor(i / grid.width)]! > 0) fields.airTemperature[i]! += 4;
    }
    circulationModel.runOneStep(planet, 0, rng);
    expect(planet.globals.circulation!.meanItcz).toBeGreaterThan(2);
  });
});

describe('precipitation', () => {
  it('rains most at the ITCZ, little under the subtropical highs and at the poles', () => {
    const planet = aquaplanet();
    rainAndWind(planet);
    const rain = planet.fields.precipitation;
    const tropics = zonalMean(planet, rain, -8, 8);
    const subtropics = zonalMean(planet, rain, 20, 32);
    const midLatitudes = zonalMean(planet, rain, 40, 55);
    const polar = zonalMean(planet, rain, 70, 90);
    expect(tropics).toBeGreaterThan(2 * subtropics);
    expect(midLatitudes).toBeGreaterThan(subtropics);
    expect(polar).toBeLessThan(midLatitudes / 2);
    const global = zonalMean(planet, rain, -90, 90);
    expect(global).toBeGreaterThan(500);
    expect(global).toBeLessThan(2500);
  });

  it('wets windward slopes and leaves a rain shadow behind a mountain range', () => {
    const planet = aquaplanet();
    const { grid, fields } = planet;
    // A mid-latitude continent in the westerlies with a north-south range in the middle.
    const y = grid.rowLatitude.findIndex((lat) => lat < 45);
    for (let row = y - 3; row <= y + 3; row++) {
      for (let x = 16; x < 36; x++) {
        const range = Math.max(0, 3000 - 1000 * Math.abs(x - 24));
        fields.elevation[cellIndex(grid, x, row)] = 200 + range;
      }
    }
    rainAndWind(planet);
    const rain = (x: number) => fields.precipitation[cellIndex(grid, x, y)]!;
    // Westerlies: the windward (west) slope is wetter than the lee (east) side.
    expect(rain(23)).toBeGreaterThan(rain(26));
    expect(rain(27)).toBeLessThan(rain(22) * 0.7);
  });

  it('rains more where it is warmer', () => {
    const cold = aquaplanet(16, 8);
    cold.fields.airTemperature.fill(5);
    rainAndWind(cold);
    const warm = aquaplanet(16, 8);
    warm.fields.airTemperature.fill(25);
    rainAndWind(warm);
    const mean = (p: PlanetState) => zonalMean(p, p.fields.precipitation, -90, 90);
    expect(mean(warm)).toBeGreaterThan(1.5 * mean(cold));
  });

  it('does not turn a subtropical continental heat low into a wet belt', () => {
    const planet = aquaplanet();
    const { grid, fields } = planet;
    for (let y = 0; y < grid.height; y++) {
      const latitude = grid.rowLatitude[y]!;
      if (latitude < 18 || latitude > 34) continue;
      for (let x = 24; x <= 39; x++) {
        const i = cellIndex(grid, x, y);
        fields.elevation[i] = 0;
        fields.airTemperature[i]! += 12;
      }
    }
    rainAndWind(planet);
    const interiorMean = () => {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < grid.height; y++) {
        const latitude = grid.rowLatitude[y]!;
        if (latitude < 22 || latitude > 30) continue;
        for (let x = 28; x <= 35; x++) {
          sum += fields.precipitation[cellIndex(grid, x, y)]!;
          count++;
        }
      }
      return sum / count;
    };
    const withHeatLow = interiorMean();

    // Re-run the same warm climate with just the original three-cell winds.
    const temperature = Float64Array.from(fields.airTemperature);
    const itcz = thermalEquator(grid, temperature);
    const hadleyWidth = planet.globals.circulation!.hadleyWidth;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const i = cellIndex(grid, x, y);
        const [u, v] = cellWind(grid.rowLatitude[y]!, itcz[x]!, hadleyWidth);
        const friction = fields.elevation[i]! >= 0 ? 0.7 : 1;
        fields.windU[i] = u * friction;
        fields.windV[i] = v * friction;
      }
    }
    precipitationModel.runOneStep(planet, 0, rng);
    expect(withHeatLow).toBeLessThan(interiorMean() * 1.15);
  });
});
