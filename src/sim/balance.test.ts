import { describe, expect, it } from 'vitest';
import { createPlanet } from './core/planet';
import { createRng } from './core/rng';
import { modelControlChangeCost, modelControlLag } from './controls';
import { GOALS, createGoal } from './goals/goals';
import { civilizationEnvironmentalScale } from './models/civilization/civilization';
import { createScenario } from './scenarios';
import { energyCap, energyIncome } from './tools/tools';

describe('balance settings', () => {
  it('applies difficulty to the cap and income without changing normal', () => {
    const easy = createPlanet({ difficulty: 'easy' });
    const normal = createPlanet({ difficulty: 'normal' });
    const hard = createPlanet({ difficulty: 'hard' });
    easy.globals.energy = normal.globals.energy = hard.globals.energy = 0;
    for (const state of [easy, normal, hard]) {
      energyIncome.runOneStep(state, 1e6, createRng(1));
    }
    expect(energyCap(easy)).toBe(2500);
    expect(energyCap(normal)).toBe(2000);
    expect(energyCap(hard)).toBe(1500);
    expect(easy.globals.energy).toBeGreaterThan(normal.globals.energy);
    expect(normal.globals.energy).toBeGreaterThan(hard.globals.energy);
  });

  it('integrates the model-control lag independently of step length', () => {
    const one = createPlanet();
    const split = createPlanet();
    one.controls.solarFactor = split.controls.solarFactor = 0.9;
    modelControlLag.runOneStep(one, 1e6, createRng(1));
    for (let step = 0; step < 10; step++) {
      modelControlLag.runOneStep(split, 1e5, createRng(1));
    }
    expect(split.effectiveControls.solarFactor).toBeCloseTo(one.effectiveControls.solarFactor, 12);
  });

  it('prices target movement and leaves experimental mode to the host', () => {
    const state = createPlanet();
    expect(modelControlChangeCost(state, { solarFactor: 0.95 })).toBeCloseTo(60, 10);
    expect(modelControlChangeCost(state, { obliquity: 33.44 })).toBeCloseTo(35, 10);
  });

  it('keeps the Earth population calibration while making island societies visible', () => {
    expect(civilizationEnvironmentalScale(7)).toBe(7);
    expect(civilizationEnvironmentalScale(0.006)).toBeGreaterThan(0.03);
    expect(civilizationEnvironmentalScale(0.006)).toBeLessThan(0.1);
  });

  it('makes survival goal tolerance easier and deadline goals longer on easy', () => {
    const survivalTargets = (['easy', 'normal', 'hard'] as const).map((difficulty) => {
      const state = createPlanet({ difficulty });
      state.globals.year = 5.6e9;
      const goal = createGoal('brighteningSun', state.globals.year);
      return GOALS.brighteningSun.conditions(state, goal)[2]!.target;
    });
    expect(survivalTargets[0]).toBeLessThan(survivalTargets[1]!);
    expect(survivalTargets[1]).toBeLessThan(survivalTargets[2]!);
  });
});

describe('untouched goal regressions', () => {
  it('does not win Stone age with the default policy', () => {
    const world = createScenario('stoneAge', {
      seed: 2,
      width: 32,
      height: 16,
      start: 'quick',
    });
    while (world.planet.goal?.status === 'active') {
      world.simulation.step(world.planet, world.stepYears(world.planet));
    }
    expect(world.planet.goal?.status).toBe('lost');
    expect(world.planet.goal?.outcomeReason).toBe('timeExpired');
  }, 30_000);

  it('wins Stone age with active science and agriculture policy', () => {
    const world = createScenario('stoneAge', {
      seed: 2,
      width: 64,
      height: 32,
      start: 'quick',
    });
    world.planet.civPolicy.energy = {
      biomass: 100,
      fossil: 0,
      nuclear: 0,
      solarWind: 0,
      hydroGeothermal: 0,
    };
    world.planet.civPolicy.investment = {
      science: 75,
      agriculture: 20,
      medicine: 0,
      philosophy: 2.5,
      culture: 2.5,
    };
    while (world.planet.goal?.status === 'active') {
      const age = world.planet.civilization.age;
      if (age >= 2 && age < 6) {
        world.planet.civPolicy.investment = {
          science: 45,
          agriculture: 40,
          medicine: 5,
          philosophy: 5,
          culture: 5,
        };
      }
      if (age >= 3) {
        world.planet.civPolicy.energy = {
          biomass: 0,
          fossil: age < 5 ? 100 : 0,
          nuclear: 0,
          solarWind: age >= 5 ? 100 : 0,
          hydroGeothermal: 0,
        };
      }
      if (age === 6) {
        world.planet.civPolicy.investment = {
          science: 0,
          agriculture: 80,
          medicine: 10,
          philosophy: 5,
          culture: 5,
        };
      }
      world.simulation.step(world.planet, world.stepYears(world.planet));
    }
    expect(world.planet.goal?.status).toBe('won');
    expect(world.planet.goal?.outcomeReason).toBe('exodus');
  }, 30_000);

  it('does not win Brightening Sun without intervention', () => {
    const world = createScenario('brighteningSun', {
      seed: 2,
      width: 16,
      height: 8,
      start: 'quick',
    });
    let steps = 0;
    while (world.planet.goal?.status === 'active' && steps < 7_000) {
      world.simulation.step(world.planet, world.stepYears(world.planet));
      steps++;
    }
    expect(world.planet.goal?.status).toBe('lost');
    expect(world.planet.goal?.score).toBeLessThan(1000);
  }, 15_000);
});
