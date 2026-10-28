import { describe, expect, it } from 'vitest';
import { createRng } from './core/rng';
import { modelControlLag } from './controls';
import { createRandomWorld } from './world';

/** The climate envelope takes about eight minutes at 128×64: run with GEOGENESIS_SLOW=1. */
const SLOW = import.meta.env.GEOGENESIS_SLOW === '1';

describe('M18a calibration regressions', () => {
  it.runIf(SLOW).each([3, 19, 41])(
    'keeps reference seed %i inside the young and 1 Gyr climate envelope',
    (seed) => {
      const young = createRandomWorld({ seed, width: 128, height: 64, start: 'young' });
      expect(young.planet.globals.meanTemperature).toBeGreaterThan(5.5);
      expect(young.planet.globals.meanTemperature).toBeLessThan(8.5);

      const quick = createRandomWorld({ seed, width: 128, height: 64, start: 'quick' });
      const end = quick.planet.globals.year + 1e9;
      while (quick.planet.globals.year < end && !quick.planet.globals.runawayGreenhouse) {
        quick.simulation.step(quick.planet, quick.stepYears(quick.planet));
      }
      expect(quick.planet.globals.runawayGreenhouse).toBe(false);
      expect(quick.planet.globals.meanTemperature).toBeGreaterThan(10);
      expect(quick.planet.globals.meanTemperature).toBeLessThan(24);
    },
    240_000,
  );

  it('integrates the era-scaled control delay independently of outer step length', () => {
    const oneStep = createRandomWorld({ seed: 3, width: 16, height: 8, start: 'young' }).planet;
    const splitSteps = structuredClone(oneStep);
    oneStep.controls.solarFactor = splitSteps.controls.solarFactor = 0.9;
    modelControlLag.runOneStep(oneStep, 1e6, createRng(1));
    for (let step = 0; step < 10; step++) {
      modelControlLag.runOneStep(splitSteps, 1e5, createRng(1));
    }
    expect(splitSteps.effectiveControls.solarFactor).toBeCloseTo(
      oneStep.effectiveControls.solarFactor,
      12,
    );
  });
});
