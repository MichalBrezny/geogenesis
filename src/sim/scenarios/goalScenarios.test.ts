import { describe, expect, it } from 'vitest';
import { complexBiomass } from '../models/biosphere/life';
import { lifeClassIndex } from '../data/lifeClasses';
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

describe('terraforming scenarios', () => {
  it.each(['terraformMars'] as const)('opens %s with a budget and the tracker', (id) => {
    const world = createScenario(id, { seed: 2, width: 32, height: 16, start: 'quick' });
    expect(world.planet.goal?.id).toBe(id);
    expect(world.planet.globals.energy).toBe(1800);
    expect(world.planet.devices).toEqual([]);
    expect(world.simulation.components.at(-1)?.name).toBe('goals');
  });
});

describe('civilization scenarios', () => {
  it('starts a sentient stone-age people with the Exodus goal', () => {
    const world = createScenario('stoneAge', { seed: 2, width: 64, height: 32, start: 'quick' });
    const { civilization, goal, fields } = world.planet;
    expect(goal?.id).toBe('exodus');
    expect(civilization.species).not.toBeNull();
    expect(civilization.age).toBe(0);
    expect(fields.civilization.some((density) => density > 0)).toBe(true);
    expect(world.simulation.components.at(-1)?.name).toBe('goals');
  });

  it('opens the Cambrian with sea animals and bare land', () => {
    const world = createScenario('cambrian', { seed: 2, width: 64, height: 32, start: 'quick' });
    const { biota, goal, globals } = world.planet;
    expect(goal).toBeNull();
    expect(globals.year).toBe(4.002e9);
    expect(biota.cover[lifeClassIndex('radiates')]).toBeGreaterThan(0);
    expect(biota.cover[lifeClassIndex('plants')]).toBe(0);
    expect(biota.appeared[lifeClassIndex('fish')]).toBeNull();
  });
});
