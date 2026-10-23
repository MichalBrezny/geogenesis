import { describe, expect, it } from 'vitest';
import { cellIndex } from '../../core/grid';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { LIFE_CLASSES, lifeClassIndex } from '../../data/lifeClasses';
import { biogeochemistry, oxygenSink } from '../atmosphere/biogeochemistry';
import {
  ABIOGENESIS_TIME,
  abiogenesisProbability,
  createLife,
  evolutionTimeYears,
  seedPrimordialLife,
} from './life';

const rng = createRng(1);

/** A temperate water world with a strip of land. */
function waterWorld(): PlanetState {
  const planet = createPlanet({ width: 32, height: 16 });
  planet.fields.elevation.fill(-3000);
  for (let y = 0; y < 16; y++) planet.fields.elevation[cellIndex(planet.grid, 10, y)] = 200;
  planet.fields.airTemperature.fill(20);
  // A well-mixed modern sea (what the ocean chemistry model gives in quiet times).
  for (let i = 0; i < planet.grid.cellCount; i++) {
    const sea = planet.fields.elevation[i]! < 0 ? 1 : 0;
    planet.fields.oceanOxygen[i] = sea;
    planet.fields.nutrients[i] = sea;
  }
  planet.globals.meanTemperature = 20;
  planet.globals.atmosphere.co2 = 280;
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

  it('requires exposed liquid ocean for abiogenesis and starts in a local cluster', () => {
    const frozen = waterWorld();
    frozen.fields.iceCover.fill(1);
    createLife({ mutationRate: 0 }).runOneStep(frozen, 5e9, createRng(4));
    expect(frozen.biota.appeared[lifeClassIndex('prokaryotes')]).toBeNull();

    const temperate = waterWorld();
    const life = createLife({ mutationRate: 0 });
    const originRng = createRng(4);
    for (
      let step = 0;
      step < 200 && temperate.biota.appeared[lifeClassIndex('prokaryotes')] === null;
      step++
    ) {
      life.runOneStep(temperate, 10e6, originRng);
      temperate.globals.year += 10e6;
    }
    expect(temperate.biota.appeared[lifeClassIndex('prokaryotes')]).not.toBeNull();
    const n = temperate.grid.cellCount;
    let occupied = 0;
    for (let i = 0; i < n; i++) if (population(temperate, 'prokaryotes', i) > 0) occupied++;
    expect(occupied).toBeGreaterThan(0);
    expect(occupied).toBeLessThan(n / 4);
  });

  it('uses a step-independent abiogenesis hazard', () => {
    const rate = 1 / ABIOGENESIS_TIME;
    const oneStep = abiogenesisProbability(rate, 200e6);
    const twentySteps = 1 - Math.pow(1 - abiogenesisProbability(rate, 10e6), 20);
    expect(twentySteps).toBeCloseTo(oneStep, 12);
  });

  it('keeps seeded abiogenesis timing stable across geological step lengths', () => {
    const originAt = (dt: number) => {
      const planet = waterWorld();
      const life = createLife({ mutationRate: 0 });
      const stepRng = createRng(29);
      for (
        let elapsed = 0;
        elapsed < 5e9 && planet.biota.appeared[lifeClassIndex('prokaryotes')] === null;
        elapsed += dt
      ) {
        life.runOneStep(planet, dt, stepRng);
        planet.globals.year += dt;
      }
      return planet.biota.appeared[lifeClassIndex('prokaryotes')]!;
    };

    expect(originAt(2e6)).toBeCloseTo(originAt(10e6), -5);
  });

  it('gives eukaryotes and the first complex life slow, data-driven transitions', () => {
    const eukaryotes = LIFE_CLASSES[lifeClassIndex('eukaryotes')]!;
    expect(eukaryotes.evolutionTime).toBe(30);
    expect(eukaryotes.maxEvolutionRateFactor).toBe(3);
    expect(evolutionTimeYears(eukaryotes)).toBe(1.2e9);
    expect(evolutionTimeYears(LIFE_CLASSES[lifeClassIndex('plants')]!)).toBe(0.7e9);
  });

  it('keeps a seeded origination time stable across geological step lengths', () => {
    const appearedAt = (dt: number) => {
      const planet = waterWorld();
      seedPrimordialLife(planet);
      planet.globals.atmosphere.o2 = 0.21;
      const life = createLife({
        mutationRate: 10,
        evolutionTimeFactors: { eukaryotes: 30 },
      });
      const stepRng = createRng(17);
      for (
        let elapsed = 0;
        elapsed < 500e6 && planet.biota.appeared[lifeClassIndex('eukaryotes')] === null;
        elapsed += dt
      ) {
        life.runOneStep(planet, dt, stepRng);
        planet.globals.year += dt;
      }
      return planet.biota.appeared[lifeClassIndex('eukaryotes')]!;
    };

    expect(appearedAt(2e6)).toBeCloseTo(appearedAt(10e6), -5);
  });
});

describe('biogeochemistry', () => {
  it('keeps a young planet anoxic until its reducing sinks fade', () => {
    // A microbial biosphere (photosynthesis ~0.28) beats the sink only after ~2.3 Gyr.
    expect(oxygenSink(0.5e9)).toBeGreaterThan(1);
    expect(oxygenSink(2.0e9)).toBeGreaterThan(0.28);
    expect(oxygenSink(2.6e9)).toBeLessThan(0.28);
    expect(oxygenSink(4.5e9)).toBeCloseTo(0.14, 2);
  });

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
