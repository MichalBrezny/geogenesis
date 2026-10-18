import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROLS, type ModelControls } from './core/planet';
import { lifeClassIndex } from './data/lifeClasses';
import { deserializeGame, serializeGame } from './serialize';
import { createRandomWorld } from './world';

function precipitationMean(w: ReturnType<typeof createRandomWorld>): number {
  let sum = 0;
  for (const p of w.planet.fields.precipitation) sum += p;
  return sum / w.planet.grid.cellCount;
}

function lifeTotal(w: ReturnType<typeof createRandomWorld>): number {
  const n = w.planet.grid.cellCount;
  const start = lifeClassIndex('prokaryotes') * n;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += w.planet.biota.populations[start + i]!;
  return sum;
}

/** A small microbial planet stepped with the given controls. */
function run(controls: Partial<ModelControls> | null, steps = 3, dt = 1e6) {
  const world = createRandomWorld({ start: 'microbial', seed: 5, width: 32, height: 16 });
  if (controls) Object.assign(world.planet.controls, controls);
  for (let s = 0; s < steps; s++) world.simulation.step(world.planet, dt);
  return world;
}

describe('atmosphere and biosphere controls', () => {
  it('leave the planet bit-identical at their defaults', () => {
    const a = run(null);
    // Obliquity is drawn per planet, so only the new multipliers are made explicit.
    const explicit = Object.fromEntries(
      Object.entries(DEFAULT_CONTROLS).filter(([key]) => key !== 'obliquity'),
    );
    const b = run(explicit);
    expect(b.planet.globals.meanTemperature).toBe(a.planet.globals.meanTemperature);
    expect(b.planet.globals.atmosphere.co2).toBe(a.planet.globals.atmosphere.co2);
    expect(precipitationMean(b)).toBe(precipitationMean(a));
    expect(lifeTotal(b)).toBe(lifeTotal(a));
    expect(b.planet.rngState).toBe(a.planet.rngState);
  });

  it('greenhouse warms, cloud albedo and surface albedo cool', () => {
    const base = run(null).planet.globals.meanTemperature;
    expect(run({ greenhouse: 1.4 }).planet.globals.meanTemperature).toBeGreaterThan(base);
    expect(run({ greenhouse: 0.6 }).planet.globals.meanTemperature).toBeLessThan(base);
    expect(run({ surfaceAlbedo: 1.4 }).planet.globals.meanTemperature).toBeLessThan(base);
    expect(run({ surfaceAlbedo: 0.7 }).planet.globals.meanTemperature).toBeGreaterThan(base);
    const clouds = run({ cloudAlbedo: 2.5 }).planet.globals.meanTemperature;
    expect(clouds).not.toBe(base);
  });

  it('air-sea heat transfer sets how fast temperatures follow a change', () => {
    const response = (airSeaHeat: number) => {
      const w = createRandomWorld({ start: 'microbial', seed: 5, width: 32, height: 16 });
      w.simulation.step(w.planet, 1e6);
      const before = w.planet.globals.meanTemperature;
      Object.assign(w.planet.controls, { airSeaHeat, solarFactor: 1.15 });
      w.simulation.step(w.planet, 40);
      return w.planet.globals.meanTemperature - before;
    };
    expect(response(4)).toBeGreaterThan(response(0.25));
  });

  it('rainfall scales precipitation', () => {
    const base = precipitationMean(run(null));
    expect(precipitationMean(run({ rainfall: 2 }))).toBeGreaterThan(base);
    expect(precipitationMean(run({ rainfall: 0.5 }))).toBeLessThan(base);
  });

  it('reproduction speeds population change and thermal tolerance widens suitability', () => {
    const slow = lifeTotal(run({ reproduction: 0.1 }, 1, 1e4));
    const fast = lifeTotal(run({ reproduction: 5 }, 1, 1e4));
    const base = lifeTotal(run(null, 1, 1e4));
    // Populations start at 0.5 and relax towards suitability; a faster rate moves further from it.
    expect(Math.abs(fast - base)).toBeGreaterThanOrEqual(Math.abs(slow - base));
    expect(fast).not.toBe(slow);
    const narrow = lifeTotal(run({ thermalTolerance: 0.5 }, 3));
    const wide = lifeTotal(run({ thermalTolerance: 2 }, 3));
    expect(wide).toBeGreaterThanOrEqual(narrow);
    expect(wide).not.toBe(narrow);
  });

  it('advance rate speeds evolution of new classes', () => {
    const classes = (advanceRate: number) => {
      const w = createRandomWorld({ start: 'microbial', seed: 5, width: 32, height: 16 });
      w.planet.controls.advanceRate = advanceRate;
      for (let s = 0; s < 40; s++) w.simulation.step(w.planet, 1e7);
      return w.planet.biota.appeared.filter((a) => a !== null).length;
    };
    expect(classes(5)).toBeGreaterThanOrEqual(classes(0));
  });

  it('are filled in when loading a save made before they existed', () => {
    const w = run(null, 1);
    const controls = w.planet.controls as unknown as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_CONTROLS)) {
      if (
        ![
          'driftSpeed',
          'volcanism',
          'erosion',
          'mutationRate',
          'solarFactor',
          'obliquity',
        ].includes(key)
      )
        delete controls[key];
    }
    const loaded = deserializeGame(
      serializeGame({ scenario: 'random', settings: w.settings, planet: w.planet }),
    );
    expect(loaded.planet.controls).toEqual({
      ...DEFAULT_CONTROLS,
      obliquity: w.planet.controls.obliquity,
    });
  });
});
