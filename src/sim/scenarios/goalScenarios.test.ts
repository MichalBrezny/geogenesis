import { describe, expect, it } from 'vitest';
import { complexBiomass } from '../models/biosphere/life';
import { createScenario } from './index';

describe('goal scenarios', () => {
  it('opens Brightening Sun with established complex life and the tracker last', () => {
    const world = createScenario('brighteningSun', {
      seed: 2,
      width: 32,
      height: 16,
      start: 'quick',
    });
    expect(world.planet.globals.year).toBe(5.6e9);
    expect(world.planet.goal?.id).toBe('brighteningSun');
    expect(complexBiomass(world.planet.biota.cover)).toBeGreaterThan(0);
    expect(world.planet.civilization.species).toBeNull();
    expect(world.simulation.components.at(-1)?.name).toBe('goals');
  });

  it('opens Snowball globally frozen with microbes only', () => {
    const world = createScenario('snowball', {
      seed: 2,
      width: 32,
      height: 16,
      start: 'quick',
    });
    expect(world.planet.goal?.id).toBe('snowball');
    expect(world.planet.globals.iceFraction).toBe(1);
    expect(world.planet.globals.meanTemperature).toBeLessThan(0);
    expect(world.planet.biota.cover.slice(2).every((cover) => cover === 0)).toBe(true);
  });

  it('opens Cradle as a quick-start microbial world', () => {
    const world = createScenario('cradle', {
      seed: 2,
      width: 32,
      height: 16,
      start: 'quick',
    });
    expect(world.planet.goal?.id).toBe('cradle');
    expect(world.planet.goal?.status).toBe('active');
    expect(world.planet.biota.cover[0]).toBeGreaterThan(0);
    expect(world.planet.civilization.species).toBeNull();
  });
});
