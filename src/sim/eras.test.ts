import { describe, expect, it } from 'vitest';
import { createPlanet } from './core/planet';
import { createRng } from './core/rng';
import { TECH_AGES } from './data/civilization';
import { lifeClassIndex } from './data/lifeClasses';
import {
  eraStepYears,
  eraTracker,
  EVOLUTION_ERA_STEP,
  GEOLOGICAL_ERA_STEP,
  planetEra,
} from './eras';

describe('eras', () => {
  it('follow the planet from microbes to technology and back after an Exodus', () => {
    const planet = createPlanet({ width: 16, height: 8 });
    const rng = createRng(1);
    planet.biota.cover[lifeClassIndex('prokaryotes')] = 0.5;
    eraTracker.runOneStep(planet, 0, rng);
    expect(planetEra(planet)).toBe('geological');
    expect(eraStepYears(planet)).toBe(GEOLOGICAL_ERA_STEP);
    // The first era is set without an event.
    expect(planet.events).toHaveLength(0);

    planet.biota.cover[lifeClassIndex('plants')] = 0.1;
    eraTracker.runOneStep(planet, 1, rng);
    expect(planetEra(planet)).toBe('evolution');
    expect(eraStepYears(planet)).toBe(EVOLUTION_ERA_STEP);
    expect(planet.events.at(-1)).toMatchObject({ key: 'eraReached', subject: 'evolution' });

    planet.civilization.species = lifeClassIndex('mammals');
    expect(planetEra(planet)).toBe('civilization');
    expect(eraStepYears(planet)).toBe(TECH_AGES[0]!.yearsPerStep);
    planet.civilization.age = TECH_AGES.findIndex((age) => age.key === 'industrial');
    expect(planetEra(planet)).toBe('technology');

    planet.civilization.species = null;
    expect(planetEra(planet)).toBe('evolution');
  });
});
