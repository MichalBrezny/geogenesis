import { describe, expect, it } from 'vitest';
import { cellIndex } from '../../core/grid';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import {
  applyImpactCrater,
  expectedImpactCount,
  impactModel,
  impactRate,
  MAX_RESOLVED_IMPACTS,
} from './impacts';

describe('natural impacts', () => {
  it('declines exponentially with age and integrates independently of step partitioning', () => {
    expect(impactRate(0.5e9)).toBeGreaterThan(impactRate(1e9));
    expect(impactRate(4.5e9)).toBeCloseTo(impactRate(8e9), 8);
    const whole = expectedImpactCount(0.5e9, 100e6);
    const partitioned = Array.from({ length: 10 }, (_, k) =>
      expectedImpactCount(0.5e9 + k * 10e6, 10e6),
    ).reduce((sum, value) => sum + value, 0);
    expect(partitioned).toBeCloseTo(whole, 12);
  });

  it('samples a Poisson count but caps terrain work by aggregating primordial impacts', () => {
    const planet = createPlanet({ width: 32, height: 16, seed: 8 });
    planet.globals.year = 0;
    planet.fields.elevation.fill(0);
    impactModel.runOneStep(planet, 10e6, createRng(8));
    expect(planet.globals.impactsThisStep).toBeGreaterThan(MAX_RESOLVED_IMPACTS);
    expect(planet.geosphere.impactCount).toBe(planet.globals.impactsThisStep);
    expect(planet.globals.impactFlux).toBeGreaterThan(0);
  });

  it('cuts a bowl with a raised rim and leaves distant flat terrain unchanged', () => {
    const planet = createPlanet({ width: 128, height: 64 });
    const centre = cellIndex(planet.grid, 64, 32);
    applyImpactCrater(planet, centre, 4000);
    expect(planet.fields.elevation[centre]).toBeLessThan(-1000);
    expect(Math.max(...planet.fields.elevation)).toBeGreaterThan(0);
    const antipode = cellIndex(planet.grid, 0, 31);
    expect(planet.fields.elevation[antipode]).toBe(0);
  });
});
