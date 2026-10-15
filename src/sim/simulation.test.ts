import { describe, expect, it } from 'vitest';
import type { SimComponent } from './core/component';
import { createPlanet } from './core/planet';
import { createSimulation } from './simulation';
import { createRandomWorld } from './world';

function counter(name: string, minIntervalYears = 0): SimComponent & { runs: number[] } {
  const runs: number[] = [];
  return {
    name,
    inputs: [],
    outputs: [],
    minIntervalYears,
    runs,
    runOneStep(_state, dt) {
      runs.push(dt);
    },
  };
}

describe('simulation', () => {
  it('rejects a component that reads a field nothing provides', () => {
    const reader: SimComponent = {
      name: 'reader',
      inputs: ['airTemperature'],
      outputs: [],
      runOneStep() {},
    };
    expect(() => createSimulation([reader])).toThrow(/airTemperature/);
    expect(() => createSimulation([reader], ['airTemperature'])).not.toThrow();
  });

  it('runs slow components only after their interval, with accumulated dt', () => {
    const fast = counter('fast');
    const slow = counter('slow', 30);
    const sim = createSimulation([fast, slow]);
    const planet = createPlanet({ width: 4, height: 2 });
    for (let i = 0; i < 4; i++) sim.step(planet, 10);
    expect(fast.runs).toEqual([10, 10, 10, 10]);
    // First step runs immediately, then again once 30 years have elapsed.
    expect(slow.runs).toEqual([10, 30]);
    expect(planet.globals.year).toBe(40);
  });

  it('produces identical planets from the same seed', () => {
    const a = createRandomWorld({ seed: 123, width: 32, height: 16 });
    const b = createRandomWorld({ seed: 123, width: 32, height: 16 });
    expect(a.planet.fields.elevation).toEqual(b.planet.fields.elevation);
    const c = createRandomWorld({ seed: 124, width: 32, height: 16 });
    expect(c.planet.fields.elevation).not.toEqual(a.planet.fields.elevation);
  });

  it('generates roughly the requested ocean fraction', () => {
    const { planet } = createRandomWorld({ seed: 5 });
    const ocean = planet.fields.elevation.filter((e) => e < 0).length / planet.grid.cellCount;
    expect(ocean).toBeGreaterThan(0.65);
    expect(ocean).toBeLessThan(0.75);
  });
});
