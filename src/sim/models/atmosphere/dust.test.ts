import { describe, expect, it } from 'vitest';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import { impactDustTau } from '../geosphere/impacts';
import { consumeIntervalMeanDust, globalStress } from '../biosphere/life';
import {
  addDustPulse,
  addDustSource,
  dustBurden,
  dustForcing,
  dustModel,
  DUST_EFOLD,
  DUST_FINE,
  DUST_SOOT,
  DUST_SULFATE,
} from './dust';

function planet() {
  return createPlanet({ width: 16, height: 8, seed: 3 });
}

/** Runs the dust model over `total` years in steps of `dt`; returns integral of tau. */
function integrate(
  setup: (p: ReturnType<typeof planet>) => void,
  total: number,
  dt: number,
): { integral: number; burden: number } {
  const p = planet();
  p.globals.year = 0;
  setup(p);
  let integral = 0;
  const rng = createRng(1);
  for (let t = 0; t < total - 1e-9; t += dt) {
    dustModel.runOneStep(p, dt, rng);
    integral += p.globals.dust * dt;
    p.globals.year += dt;
  }
  return { integral, burden: dustBurden(p) };
}

describe('dust model', () => {
  it('decays exponentially and independently of the step length', () => {
    const setup = (p: ReturnType<typeof planet>) => addDustPulse(p, DUST_SULFATE, 2, 0);
    const one = integrate(setup, 6, 6);
    const many = integrate(setup, 6, 0.5);
    expect(one.burden).toBeCloseTo(2 * Math.exp(-6 / DUST_EFOLD[DUST_SULFATE]), 12);
    expect(many.burden).toBeCloseTo(one.burden, 12);
  });

  it('reports the step mean, so integrated optical depth matches at any step length', () => {
    const setup = (p: ReturnType<typeof planet>) => {
      addDustPulse(p, DUST_FINE, 10, 0.2);
      addDustPulse(p, DUST_SOOT, 2, 3.1);
      addDustSource(p, DUST_SULFATE, 0.6, 1, 4);
    };
    const exact = integrate(setup, 10, 0.01).integral;
    for (const dt of [10, 5, 1, 0.5]) {
      expect(integrate(setup, 10, dt).integral).toBeCloseTo(exact, 1);
    }
    // One 10-year step and ten 1-year steps agree on the linear forcing for small tau.
    const small = (p: ReturnType<typeof planet>) => addDustPulse(p, DUST_SULFATE, 0.01, 0);
    const a = integrate(small, 10, 10).integral;
    const b = integrate(small, 10, 1).integral;
    expect(dustForcing(a / 10) * 10).toBeCloseTo(dustForcing(b / 10) * 10, 6);
  });

  it("gives life the same interval-mean light after one long step or many short ones", () => {
    const lightAfter = (dt: number) => {
      const p = planet();
      addDustSource(p, DUST_SOOT, 3, 0, 1);
      const rng = createRng(1);
      for (let elapsed = 0; elapsed < 10_000; elapsed += dt) {
        dustModel.runOneStep(p, dt, rng);
        p.globals.year += dt;
      }
      const meanDust = consumeIntervalMeanDust(p, 10_000);
      return { light: globalStress(p, meanDust).light, meanDust };
    };

    const short = lightAfter(5);
    const long = lightAfter(10_000);
    const analyticMean = (3 * DUST_EFOLD[DUST_SOOT]) / 10_000;
    expect(short.meanDust).toBeCloseTo(analyticMean, 12);
    expect(long.meanDust).toBeCloseTo(analyticMean, 12);
    expect(short.light).toBeCloseTo(Math.exp(-analyticMean), 12);
    expect(long.light).toBeCloseTo(short.light, 12);
  });

  it('keeps a pulse that happens later than the step pending', () => {
    const p = planet();
    p.globals.year = 0;
    addDustPulse(p, DUST_SOOT, 1, 7);
    dustModel.runOneStep(p, 5, createRng(1));
    expect(p.globals.dust).toBe(0);
    p.globals.year = 5;
    dustModel.runOneStep(p, 5, createRng(1));
    expect(p.globals.dust).toBeGreaterThan(0);
  });

  it('survives a save round trip as plain data', () => {
    const p = planet();
    addDustPulse(p, DUST_SOOT, 1, 3);
    const copy = JSON.parse(JSON.stringify(p.globals));
    expect(copy.dustSources).toHaveLength(1);
  });

  it('lofts more dust from bigger land impacts and little from the sea', () => {
    const [fine180] = impactDustTau(180, false);
    const [fine50] = impactDustTau(50, false);
    const [fine10] = impactDustTau(10, false);
    expect(fine180).toBeCloseTo(50, 9);
    expect(fine50).toBeLessThan(fine180);
    expect(fine10).toBeLessThan(0.1);
    expect(impactDustTau(180, true)[0]).toBeCloseTo(5, 9);
  });

  it('turns a nuclear war into soot that fades over years', () => {
    const p = planet();
    p.globals.year = 100;
    addDustPulse(p, DUST_SOOT, 2, 105);
    dustModel.runOneStep(p, 5, createRng(1));
    expect(p.globals.dust).toBe(0);
    p.globals.year = 105;
    dustModel.runOneStep(p, 1, createRng(1));
    expect(p.globals.dust).toBeGreaterThan(1);
    expect(p.globals.dust).toBeLessThanOrEqual(2);
    p.globals.year = 106;
    dustModel.runOneStep(p, 20, createRng(1));
    expect(dustBurden(p)).toBeLessThan(0.05);
  });

  it('adds no forcing and no state change for clear skies', () => {
    expect(dustForcing(0)).toBe(0);
    const p = planet();
    dustModel.runOneStep(p, 1000, createRng(1));
    expect(p.globals.dust).toBe(0);
    expect(dustForcing(1)).toBeGreaterThan(20);
    expect(dustForcing(1)).toBeLessThan(30);
  });
});
