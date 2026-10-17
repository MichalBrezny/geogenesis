import { describe, expect, it } from 'vitest';
import { areaWeightedMean } from './core/grid';
import { lifeClassIndex } from './data/lifeClasses';
import { continentalCrustTarget } from './models/geosphere/drift';
import { createRandomWorld, PLANET_START_AGES } from './world';

describe('random-world starts', () => {
  it('creates a lifeless 0.5 Gyr young planet by default with little continental crust', () => {
    const world = createRandomWorld({ seed: 12, width: 32, height: 16 });
    expect(world.planet.globals.year).toBe(PLANET_START_AGES.young);
    expect(world.planet.biota.appeared.every((year) => year === null)).toBe(true);
    expect(world.planet.globals.solarInput).toBeLessThan(0.8);
    expect(areaWeightedMean(world.planet.grid, world.planet.fields.crustType)).toBeLessThan(0.12);
    expect(world.settings?.start).toBe('young');
  });

  it('creates an anoxic seeded microbial world and preserves the former quick start', () => {
    const microbial = createRandomWorld({
      start: 'microbial',
      seed: 13,
      width: 32,
      height: 16,
    });
    const quick = createRandomWorld({ start: 'quick', seed: 14, width: 32, height: 16 });
    const prokaryotes = lifeClassIndex('prokaryotes');
    const eukaryotes = lifeClassIndex('eukaryotes');
    expect(microbial.planet.globals.year).toBe(PLANET_START_AGES.microbial);
    expect(microbial.planet.biota.cover[prokaryotes]).toBeGreaterThan(0);
    expect(microbial.planet.globals.atmosphere.o2).toBe(0);
    expect(quick.planet.globals.year).toBe(PLANET_START_AGES.quick);
    expect(quick.planet.biota.cover[prokaryotes]).toBeGreaterThan(0);
    expect(quick.planet.biota.appeared[eukaryotes]).toBeNull();
  });
});

describe('continental growth target', () => {
  it('grows from small cratons at 0.5 Gyr to nearly modern cover by 2.5–3 Gyr', () => {
    expect(continentalCrustTarget(0.5e9)).toBeGreaterThan(0.05);
    expect(continentalCrustTarget(0.5e9)).toBeLessThan(0.1);
    expect(continentalCrustTarget(2.5e9)).toBeGreaterThan(0.28);
    expect(continentalCrustTarget(3e9)).toBeLessThanOrEqual(0.3);
  });
});
