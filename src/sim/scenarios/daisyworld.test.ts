import { beforeAll, describe, expect, it } from 'vitest';
import { daisyGrowth } from '../models/biosphere/daisies';
import { createDaisyworld } from './daisyworld';

/** Runs Daisyworld from 4.5 to 8.5 Gyr and returns samples of temperature and daisy cover. */
function run(withDaisies: boolean) {
  const world = createDaisyworld({ width: 64, height: 32, startYear: 4.5e9, withDaisies });
  while (world.planet.globals.year < 8.5e9)
    world.simulation.step(world.planet, world.stepYears(world.planet));
  return world.planet.history;
}

describe('daisies', () => {
  it('grow fastest at 22.5 °C and not at all outside 5–40 °C', () => {
    expect(daisyGrowth(22.5)).toBe(1);
    expect(daisyGrowth(4)).toBe(0);
    expect(daisyGrowth(41)).toBe(0);
  });
});

describe('Daisyworld', () => {
  let withDaisies: ReturnType<typeof run>;
  let bare: ReturnType<typeof run>;
  beforeAll(() => {
    withDaisies = run(true);
    bare = run(false);
  }, 60_000);

  /** Temperature range once the daisies have settled in (from 5 Gyr on). */
  const settledRange = (history: ReturnType<typeof run>) => {
    const values = history.meanTemperature.filter((_, k) => history.year[k]! >= 5e9);
    return Math.max(...values) - Math.min(...values);
  };

  it('holds the temperature far steadier than a bare planet as the star brightens', () => {
    expect(settledRange(withDaisies)).toBeLessThan(settledRange(bare) / 2);
    const last = withDaisies.meanTemperature.length - 1;
    expect(withDaisies.meanTemperature[last]!).toBeGreaterThan(15);
    expect(withDaisies.meanTemperature[last]!).toBeLessThan(35);
  });

  it('favours black daisies under a faint star and white ones under a bright star', () => {
    const last = withDaisies.year.length - 1;
    expect(withDaisies.blackDaisies[0]!).toBeGreaterThan(withDaisies.whiteDaisies[0]!);
    expect(withDaisies.whiteDaisies[last]!).toBeGreaterThan(withDaisies.blackDaisies[last]!);
  });
});
