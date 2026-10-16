import { describe, expect, it } from 'vitest';
import { cellIndex } from '../../core/grid';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { circulationModel } from './circulation';
import { oceanModel } from './ocean';

const rng = createRng(1);

/** An ocean basin between two pole-to-pole continents, with an Earth-like temperature profile. */
function basinPlanet(): PlanetState {
  const planet = createPlanet({ width: 64, height: 32 });
  const { grid, fields } = planet;
  for (let y = 0; y < grid.height; y++) {
    const s = Math.sin((grid.rowLatitude[y]! * Math.PI) / 180);
    for (let x = 0; x < grid.width; x++) {
      const i = cellIndex(grid, x, y);
      // Ocean from x = 10 to x = 40, land elsewhere.
      fields.elevation[i] = x >= 10 && x < 40 ? -4000 : 300;
      fields.airTemperature[i] = 28 - 45 * s * s;
    }
  }
  circulationModel.runOneStep(planet, 0, rng);
  oceanModel.runOneStep(planet, 0, rng);
  return planet;
}

describe('ocean', () => {
  it('turns the subtropical gyre with a strong current on its western side', () => {
    const planet = basinPlanet();
    const { grid, fields } = planet;
    const y = grid.rowLatitude.findIndex((lat) => lat < 30);
    const v = (x: number) => fields.oceanCurrentV[cellIndex(grid, x, y)]!;
    // Northern subtropical gyre turns clockwise: north along the west, south in the interior.
    expect(v(11)).toBeGreaterThan(0);
    expect(v(25)).toBeLessThan(0);
    expect(Math.abs(v(11))).toBeGreaterThan(2 * Math.abs(v(25)));
    // No currents on land.
    expect(fields.oceanCurrentU[cellIndex(grid, 50, y)]).toBe(0);
  });

  it('warms the western side of the subtropical ocean and cools the eastern side', () => {
    const planet = basinPlanet();
    const { grid, fields } = planet;
    let west = 0;
    let east = 0;
    for (let y = 0; y < grid.height; y++) {
      const latitude = Math.abs(grid.rowLatitude[y]!);
      if (latitude < 15 || latitude > 40) continue;
      west += fields.oceanAnomaly[cellIndex(grid, 11, y)]!;
      east += fields.oceanAnomaly[cellIndex(grid, 38, y)]!;
    }
    expect(west).toBeGreaterThan(0);
    expect(east).toBeLessThan(0);
  });
});
