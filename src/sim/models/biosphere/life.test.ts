import { describe, expect, it } from 'vitest';
import { cellIndex } from '../../core/grid';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { lifeClassIndex } from '../../data/lifeClasses';
import { biogeochemistry } from '../atmosphere/biogeochemistry';
import { createLife, seedPrimordialLife } from './life';

const rng = createRng(1);

/** A temperate water world with a strip of land. */
function waterWorld(): PlanetState {
  const planet = createPlanet({ width: 32, height: 16 });
  planet.fields.elevation.fill(-3000);
  for (let y = 0; y < 16; y++) planet.fields.elevation[cellIndex(planet.grid, 10, y)] = 200;
  planet.fields.airTemperature.fill(20);
  planet.globals.year = 4e9;
  return planet;
}

const population = (planet: PlanetState, key: Parameters<typeof lifeClassIndex>[0], i: number) =>
  planet.biota.populations[lifeClassIndex(key) * planet.grid.cellCount + i]!;

describe('life', () => {
  it('starts with prokaryotes in the ocean only', () => {
    const planet = waterWorld();
    seedPrimordialLife(planet);
    expect(population(planet, 'prokaryotes', cellIndex(planet.grid, 0, 8))).toBeGreaterThan(0);
    expect(population(planet, 'prokaryotes', cellIndex(planet.grid, 10, 8))).toBe(0);
    expect(planet.biota.appeared[lifeClassIndex('prokaryotes')]).toBe(4e9);
  });

  it('spreads into suitable cells only, at a speed independent of the step length', () => {
    /** Mean number of cells fish hold after `years`, from one founding cell. */
    const spread = (years: number, dt: number) => {
      let total = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const planet = waterWorld();
        const n = planet.grid.cellCount;
        planet.globals.atmosphere.o2 = 0.21;
        planet.biota.populations[lifeClassIndex('fish') * n + cellIndex(planet.grid, 20, 8)] = 0.5;
        const life = createLife({ mutationRate: 0 });
        const stepRng = createRng(seed);
        for (let t = 0; t < years; t += dt) life.runOneStep(planet, dt, stepRng);
        for (let i = 0; i < n; i++) if (population(planet, 'fish', i) > 0) total++;
        // Fish never live on the land strip.
        expect(population(planet, 'fish', cellIndex(planet.grid, 10, 8))).toBe(0);
      }
      return total / 6;
    };
    const coarse = spread(12e6, 4e6);
    const fine = spread(12e6, 0.5e6);
    expect(coarse).toBeGreaterThan(3);
    expect(coarse).toBeLessThan(200);
    expect(Math.abs(coarse - fine) / fine).toBeLessThan(0.35);
  });

  it('dies out where conditions become impossible', () => {
    const planet = waterWorld();
    seedPrimordialLife(planet);
    planet.fields.airTemperature.fill(90);
    const life = createLife({ mutationRate: 0 });
    for (let step = 0; step < 20; step++) life.runOneStep(planet, 1e6, rng);
    expect(planet.biota.cover[lifeClassIndex('prokaryotes')]).toBe(0);
  });

  it('evolves new classes from living ancestors', () => {
    const planet = waterWorld();
    seedPrimordialLife(planet);
    planet.globals.atmosphere.o2 = 0.01;
    const life = createLife({ mutationRate: 100 });
    for (let step = 0; step < 50; step++) life.runOneStep(planet, 1e6, rng);
    expect(planet.biota.appeared[lifeClassIndex('eukaryotes')]).not.toBeNull();
    // Oxygen-hungry animals cannot evolve in this thin oxygen.
    expect(planet.biota.appeared[lifeClassIndex('fish')]).toBeNull();
  });
});

describe('biogeochemistry', () => {
  it('fills an anoxic microbial world with methane, and photosynthesis with oxygen', () => {
    const planet = waterWorld();
    seedPrimordialLife(planet);
    planet.globals.atmosphere.o2 = 0;
    createLife().runOneStep(planet, 0, rng);
    biogeochemistry.runOneStep(planet, 0, rng);
    expect(planet.globals.atmosphere.ch4).toBeGreaterThan(10);

    planet.biota.cover[lifeClassIndex('eukaryotes')] = 0.6;
    for (let step = 0; step < 300; step++) biogeochemistry.runOneStep(planet, 1e6, rng);
    expect(planet.globals.atmosphere.o2).toBeGreaterThan(0.05);
    expect(planet.globals.atmosphere.ch4).toBeLessThan(2);
  });
});
