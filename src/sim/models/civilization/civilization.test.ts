import { describe, expect, it } from 'vitest';
import { createPlanet, DEFAULT_CIV_POLICY, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { EXODUS_MIN_POPULATION, SENTIENCE_POTENTIAL, TECH_AGES } from '../../data/civilization';
import { LIFE_CLASS_COUNT, lifeClassIndex } from '../../data/lifeClasses';
import { Biome } from '../../data/biomes';
import { eraStepYears } from '../../eras';
import {
  civilizationProduction,
  createCivilization,
  effectiveEnergyMix,
  makeSentient,
  occupiedHabitatShare,
  POLLUTION_RESIDENCE_TIME,
  SENTIENCE_TIME,
  technologyPopulationPace,
  updatePollution,
} from './civilization';
import { createCarbonCycle } from '../atmosphere/carbon';
import { normalizeCivilizationPolicy, updateCivilizationPolicy } from '../../data/civilization';

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
  it('scales technology pace more steeply while retaining bounded progress', () => {
    expect(technologyPopulationPace(0, 7)).toBe(0.25);
    expect(technologyPopulationPace(0.7, 7)).toBeCloseTo(0.1 ** 0.35);
    expect(technologyPopulationPace(7, 7)).toBe(1);
    expect(technologyPopulationPace(21, 7)).toBeCloseTo(3 ** 0.35);
    expect(technologyPopulationPace(700, 7)).toBe(2);
  });

  it('keeps marine sentience possible but secondary to land vertebrates', () => {
    const potential = (['arthropods', 'mollusks', 'trichordates', 'fish'] as const).reduce(
      (sum, key) => sum + (SENTIENCE_POTENTIAL[key] ?? 0),
      0,
    );
    expect(potential).toBeCloseTo(0.022);
    expect(SENTIENCE_TIME).toBe(150e6);
  });

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

  it('judges establishment by occupied range rather than guild-reduced density', () => {
    const planet = mammalWorld();
    const mammals = lifeClassIndex('mammals');
    const n = planet.grid.cellCount;
    planet.biota.populations.fill(0.01, mammals * n, (mammals + 1) * n);
    planet.biota.cover[mammals] = 0.01;

    expect(occupiedHabitatShare(planet, mammals)).toBe(1);
    createCivilization({ sentienceTime: 1 }).runOneStep(planet, 1e6, createRng(23));
    expect(planet.civilization.species).toBe(mammals);
  });

  it('keeps a seeded sentience time stable across step lengths', () => {
    const sentientAt = (dt: number) => {
      const planet = mammalWorld();
      const civilization = createCivilization();
      const stepRng = createRng(31);
      for (let elapsed = 0; elapsed < 2e9 && planet.civilization.species === null; elapsed += dt) {
        civilization.runOneStep(planet, dt, stepRng);
        planet.globals.year += dt;
      }
      return planet.civilization.sentientSince!;
    };

    expect(sentientAt(2e6)).toBeCloseTo(sentientAt(10e6), -5);
  });

  it('grows, advances through the ages, burns fossil fuels and finally leaves', () => {
    const planet = mammalWorld();
    const civilization = createCivilization({ sentienceTime: 1e3 });
    const carbon = createCarbonCycle();
    planet.globals.fossilCarbon = 8_000;
    const fossilBefore = planet.globals.fossilCarbon;
    civilization.runOneStep(planet, 1e6, rng);
    expect(planet.civilization.species).not.toBeNull();

    const co2Before = planet.globals.atmosphere.co2;
    let steps = 0;
    while (planet.civilization.exodusYear === null && steps < 5000) {
      const dt = eraStepYears(planet);
      civilization.runOneStep(planet, dt, rng);
      carbon.runOneStep(planet, dt, rng);
      planet.globals.year += dt;
      steps++;
    }
    expect(planet.civilization.exodusYear).not.toBeNull();
    expect(planet.civilization.species).toBeNull();
    const reached = planet.events.filter((e) => e.key === 'ageReached').map((e) => e.subject);
    expect(reached).toContain('industrial');
    expect(reached).toContain('nanotech');
    expect(planet.globals.atmosphere.co2).toBeGreaterThan(co2Before + 50);
    expect(planet.globals.fossilCarbon).toBeLessThan(fossilBefore);
    // Settlements are cleared when the civilization leaves.
    expect(Math.max(...planet.fields.civilization)).toBe(0);
  });

  it('holds completed Nanotech until the population can support Exodus', () => {
    const planet = mammalWorld();
    makeSentient(planet, lifeClassIndex('mammals'), 0);
    planet.civilization.age = TECH_AGES.length - 1;
    planet.civilization.progress = 0.99;
    planet.fields.civilization.fill(0);
    planet.fields.civilization[0] = 0.001;
    planet.civilization.population = 0.001;
    const civilization = createCivilization();

    civilization.runOneStep(planet, 5, createRng(17));
    civilization.runOneStep(planet, 5, createRng(17));

    expect(planet.civilization.progress).toBe(1);
    expect(planet.civilization.exodusYear).toBeNull();
    expect(planet.events.filter((event) => event.key === 'exodusPopulationTooLow')).toHaveLength(1);

    planet.civilization.progress = 0.5;
    civilization.runOneStep(planet, 5, createRng(17));
    expect(planet.civilization.progress).toBe(1);
    expect(planet.events.filter((event) => event.key === 'exodusPopulationTooLow')).toHaveLength(1);

    planet.fields.civilization.fill(0.1);
    planet.civilization.population = EXODUS_MIN_POPULATION;
    civilization.runOneStep(planet, 5, createRng(17));
    expect(planet.civilization.exodusYear).not.toBeNull();
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

  it('unlocks energy sources by technology age and falls back while a chosen source is locked', () => {
    const planet = mammalWorld();
    makeSentient(planet, lifeClassIndex('mammals'), 0);
    planet.civPolicy.energy = {
      biomass: 0,
      fossil: 0,
      nuclear: 0,
      solarWind: 100,
      hydroGeothermal: 0,
    };
    expect(effectiveEnergyMix(planet).solarWind).toBe(0);
    expect(effectiveEnergyMix(planet).biomass).toBeGreaterThan(0);
    planet.civilization.age = 5;
    expect(effectiveEnergyMix(planet).solarWind).toBe(1);
  });

  it('renormalizes policy groups to 100 percent and changes energy output', () => {
    const normalized = normalizeCivilizationPolicy({
      energy: { biomass: 1, fossil: 1, nuclear: 1, solarWind: 1, hydroGeothermal: 1 },
      investment: { science: 2, agriculture: 2, medicine: 2, philosophy: 2, culture: 2 },
    });
    expect(Object.values(normalized.energy).reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    const changed = updateCivilizationPolicy(normalized, { energy: { fossil: 80 } });
    expect(changed.energy.fossil).toBeCloseTo(80);
    expect(Object.values(changed.energy).reduce((a, b) => a + b, 0)).toBeCloseTo(100);

    const planet = mammalWorld();
    makeSentient(planet, lifeClassIndex('mammals'), 0);
    planet.civilization.age = 5;
    planet.globals.fossilCarbon = 0;
    const scarce = civilizationProduction(planet).energySupply;
    planet.civPolicy.energy = {
      biomass: 0,
      fossil: 0,
      nuclear: 0,
      solarWind: 100,
      hydroGeothermal: 0,
    };
    expect(civilizationProduction(planet).energySupply).not.toBeCloseTo(scarce);
  });

  it('keeps the planned share of locked energy sources while unlocked ones are rebalanced', () => {
    const stoneAge = { biomass: 20, fossil: 50, nuclear: 10, solarWind: 10, hydroGeothermal: 10 };
    const changed = updateCivilizationPolicy(
      { energy: stoneAge, investment: DEFAULT_CIV_POLICY.investment },
      { energy: { biomass: 100 } },
      0,
    );
    expect(changed.energy.fossil).toBeCloseTo(50);
    expect(changed.energy.nuclear).toBeCloseTo(10);
    expect(changed.energy.solarWind).toBeCloseTo(10);
    expect(changed.energy.biomass).toBeCloseTo(30);
    expect(changed.energy.hydroGeothermal).toBeCloseTo(0);
  });

  it('decays pollution exactly independent of step length', () => {
    const once = mammalWorld();
    const stepped = mammalWorld();
    once.globals.pollution = stepped.globals.pollution = 2;
    updatePollution(once, 100, 0);
    for (let k = 0; k < 20; k++) updatePollution(stepped, 5, 0);
    expect(once.globals.pollution).toBeCloseTo(2 * Math.exp(-100 / POLLUTION_RESIDENCE_TIME), 12);
    expect(stepped.globals.pollution).toBeCloseTo(once.globals.pollution, 12);
  });

  it('keeps a 1000-year industrial civilization close at 5-year and 100-year steps', () => {
    const run = (dt: number) => {
      const planet = mammalWorld();
      makeSentient(planet, lifeClassIndex('mammals'), 0);
      planet.civilization.age = 3;
      planet.civilization.progress = -20;
      planet.globals.fossilCarbon = 8_000;
      planet.fields.civilization.fill(0.0001);
      planet.civilization.population = 4;
      const civilization = createCivilization();
      const carbon = createCarbonCycle();
      const stepRng = createRng(91);
      for (let elapsed = 0; elapsed < 1000; elapsed += dt) {
        civilization.runOneStep(planet, dt, stepRng);
        carbon.runOneStep(planet, dt, stepRng);
        planet.globals.year += dt;
      }
      return planet;
    };
    const short = run(5);
    const long = run(100);
    expect(long.civilization.population).toBeCloseTo(short.civilization.population, 1);
    expect(long.globals.fossilCarbon / short.globals.fossilCarbon).toBeCloseTo(1, 1);
    expect(long.globals.pollution / short.globals.pollution).toBeCloseTo(1, 1);
  });
});
