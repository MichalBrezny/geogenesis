import { describe, expect, it } from 'vitest';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { TECH_AGES } from '../../data/civilization';
import { LIFE_CLASS_COUNT, lifeClassIndex } from '../../data/lifeClasses';
import { Biome } from '../../data/biomes';
import { eraStepYears } from '../../eras';
import { createCivilization } from './civilization';

const rng = createRng(7);

/** A temperate land planet thick with plants and mammals. */
function mammalWorld(): PlanetState {
  const planet = createPlanet({ width: 32, height: 16 });
  const n = planet.grid.cellCount;
  planet.fields.elevation.fill(300);
  planet.fields.airTemperature.fill(14);
  planet.fields.biome.fill(Biome.TemperateForest);
  planet.globals.atmosphere.o2 = 0.21;
  planet.globals.year = 5e9;
  for (const key of ['plants', 'mammals'] as const) {
    planet.biota.populations.fill(0.8, lifeClassIndex(key) * n, (lifeClassIndex(key) + 1) * n);
  }
  planet.biota.cover = Array.from({ length: LIFE_CLASS_COUNT }, (_, c) =>
    c === lifeClassIndex('plants') || c === lifeClassIndex('mammals') ? 0.8 : 0,
  );
  planet.fields.vegetation.fill(0.8);
  return planet;
}

describe('civilization', () => {
  it('lets an established mammal population become sentient', () => {
    const planet = mammalWorld();
    const civilization = createCivilization({ sentienceTime: 1e6 });
    for (let step = 0; step < 20 && planet.civilization.species === null; step++) {
      civilization.runOneStep(planet, 1e6, rng);
    }
    expect(planet.civilization.species).toBe(lifeClassIndex('mammals'));
    expect(planet.events.at(-1)).toMatchObject({ key: 'sentience', subject: 'mammals' });
    expect(eraStepYears(planet)).toBe(TECH_AGES[0]!.yearsPerStep);
  });

  it('grows, advances through the ages, burns fossil fuels and finally leaves', () => {
    const planet = mammalWorld();
    const civilization = createCivilization({ sentienceTime: 1e3 });
    civilization.runOneStep(planet, 1e6, rng);
    expect(planet.civilization.species).not.toBeNull();

    const co2Before = planet.globals.atmosphere.co2;
    let steps = 0;
    while (planet.civilization.exodusYear === null && steps < 5000) {
      civilization.runOneStep(planet, eraStepYears(planet), rng);
      planet.globals.year += eraStepYears(planet);
      steps++;
    }
    expect(planet.civilization.exodusYear).not.toBeNull();
    expect(planet.civilization.species).toBeNull();
    const reached = planet.events.filter((e) => e.key === 'ageReached').map((e) => e.subject);
    expect(reached).toContain('industrial');
    expect(reached).toContain('nanotech');
    expect(planet.globals.atmosphere.co2).toBeGreaterThan(co2Before + 50);
    // Settlements are cleared when the civilization leaves.
    expect(Math.max(...planet.fields.civilization)).toBe(0);
  });

  it('clears vegetation where it settles', () => {
    const planet = mammalWorld();
    const civilization = createCivilization({ sentienceTime: 1e3 });
    civilization.runOneStep(planet, 1e6, rng);
    for (let step = 0; step < 200 && planet.civilization.age < 3; step++) {
      civilization.runOneStep(planet, eraStepYears(planet), rng);
    }
    expect(Math.min(...planet.fields.vegetation)).toBeLessThan(0.8);
  });
});
