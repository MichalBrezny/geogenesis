import { describe, expect, it } from 'vitest';
import { createPlanet } from './core/planet';
import { createRng } from './core/rng';
import { MAX_HISTORY_LENGTH, recordHistory } from './history';

const rng = createRng(1);

describe('history', () => {
  it('records one sample per step and replaces a sample for the same year', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    recordHistory.runOneStep(planet, 0, rng);
    planet.globals.atmosphere.co2 = 400;
    recordHistory.runOneStep(planet, 0, rng);
    expect(planet.history.year).toEqual([0]);
    expect(planet.history.co2).toEqual([400]);
    planet.globals.year = 1e6;
    recordHistory.runOneStep(planet, 1e6, rng);
    expect(planet.history.year).toEqual([0, 1e6]);
  });

  it('thins long histories but keeps the first and recent samples', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    for (let step = 0; step < 3 * MAX_HISTORY_LENGTH; step++) {
      planet.globals.year = step;
      recordHistory.runOneStep(planet, 1, rng);
    }
    const years = planet.history.year;
    expect(years.length).toBeLessThan(MAX_HISTORY_LENGTH);
    expect(years[0]).toBe(0);
    expect(years[years.length - 1]).toBeGreaterThan(3 * MAX_HISTORY_LENGTH - 10);
    for (let k = 1; k < years.length; k++) expect(years[k]!).toBeGreaterThan(years[k - 1]!);
  });
});
