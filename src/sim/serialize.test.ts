import { describe, expect, it } from 'vitest';
import { restoreScenario } from './scenarios';
import { compress, decompress, deserializeGame, SaveFormatError, serializeGame } from './serialize';
import { createRandomWorld } from './world';
import { surfacePressureOf } from './models/atmosphere/atmosphere';
import { ERAS } from './eras';
import { createGoal } from './goals/goals';

describe('save files', () => {
  it('round-trip a planet exactly', async () => {
    const world = createRandomWorld({ seed: 3, width: 32, height: 16 });
    for (let s = 0; s < 5; s++) world.simulation.step(world.planet, 1e6);
    world.planet.history.era[0] = ERAS.indexOf('evolution');
    const bytes = await compress(
      serializeGame({ scenario: 'random', settings: world.settings, planet: world.planet }),
    );
    const loaded = deserializeGame(await decompress(bytes));
    expect(loaded.scenario).toBe('random');
    expect(loaded.settings).toEqual({ start: 'young', continentalFraction: 0.3 });
    expect(loaded.planet).toEqual(world.planet);
    expect(loaded.planet.fields.elevation).toBeInstanceOf(Float32Array);
    expect(loaded.planet.plates[0]!.crust.owned).toBeInstanceOf(Uint8Array);
    expect(loaded.planet.history.era).toEqual(world.planet.history.era);
  });

  it('round-trips goal state and rebuilds the goal tracker', () => {
    const world = createRandomWorld({ seed: 31, width: 32, height: 16, start: 'quick' });
    world.planet.goal = createGoal('cradle', world.planet.globals.year);
    world.planet.goal.score = 123.5;
    world.planet.goal.heldSince = world.planet.globals.year - 10;
    world.planet.goal.memory.complexLifeSeen = true;
    const loaded = deserializeGame(
      serializeGame({ scenario: 'cradle', settings: world.settings, planet: world.planet }),
    );
    expect(loaded.planet.goal).toEqual(world.planet.goal);
    const restored = restoreScenario('cradle', loaded.planet, loaded.settings);
    expect(restored.simulation.components.at(-1)?.name).toBe('goals');
  });

  it('resumes the simulation after loading', () => {
    const world = createRandomWorld({ start: 'microbial', seed: 4, width: 32, height: 16 });
    world.simulation.step(world.planet, 1e6);
    const loaded = deserializeGame(
      serializeGame({ scenario: 'random', settings: world.settings, planet: world.planet }),
    );
    const restored = restoreScenario('random', loaded.planet, loaded.settings);
    expect(restored.settings).toEqual(world.settings);
    for (let s = 0; s < 10; s++) {
      world.simulation.step(world.planet, 1e6);
      restored.simulation.step(restored.planet, 1e6);
    }
    expect(restored.planet.globals.year).toBe(world.planet.globals.year);
    // Same random sequence and schedule: the two copies evolve alike.
    expect(restored.planet.rngState).toBe(world.planet.rngState);
    expect(restored.planet.globals.meanTemperature).toBeCloseTo(
      world.planet.globals.meanTemperature,
      0,
    );
  });

  it('hydrates atmosphere, water, seasons, ice, sea level, lakes and history from an older shape', () => {
    const planet = createRandomWorld({ seed: 7, width: 32, height: 16 }).planet;
    delete (planet.globals.atmosphere as Partial<typeof planet.globals.atmosphere>).n2;
    delete (planet.globals.atmosphere as Partial<typeof planet.globals.atmosphere>).inert;
    delete (planet.globals.atmosphere as Partial<typeof planet.globals.atmosphere>).waterVapor;
    delete (planet.globals as Partial<typeof planet.globals>).surfacePressure;
    delete (planet.globals as Partial<typeof planet.globals>).water;
    delete (planet.globals as Partial<typeof planet.globals>).initialWater;
    delete (planet.globals as Partial<typeof planet.globals>).escapedWater;
    delete (planet.globals as Partial<typeof planet.globals>).runawayGreenhouse;
    delete (planet.globals as Partial<typeof planet.globals>).seaLevel;
    delete (planet.globals as Partial<typeof planet.globals>).sedimentExport;
    delete (planet.fields as Partial<typeof planet.fields>).iceThickness;
    delete (planet.fields as Partial<typeof planet.fields>).co2Ice;
    delete (planet.fields as Partial<typeof planet.fields>).seasonalAmplitude;
    delete (planet.fields as Partial<typeof planet.fields>).lakeDepth;
    delete (planet.fields as Partial<typeof planet.fields>).lakeType;
    delete (planet.history as Partial<typeof planet.history>).seaLevel;
    delete (planet.history as Partial<typeof planet.history>).surfacePressure;
    delete (planet.history as Partial<typeof planet.history>).water;
    delete (planet.history as Partial<typeof planet.history>).era;
    delete (planet.controls as Partial<typeof planet.controls>).obliquity;
    delete (planet as Partial<typeof planet>).planetParams;
    delete (planet.globals as Partial<typeof planet.globals>).magneticField;
    delete (planet.globals as Partial<typeof planet.globals>).tectonicRegime;
    delete (planet.globals as Partial<typeof planet.globals>).crustalCarbon;
    delete (planet.globals as Partial<typeof planet.globals>).co2Ice;
    delete (planet.globals as Partial<typeof planet.globals>).dustBurden;
    delete (planet.globals as Partial<typeof planet.globals>).dustSources;
    delete (planet.globals as Partial<typeof planet.globals>).dustIntegralSinceLife;
    delete (planet.globals as Partial<typeof planet.globals>).dustYearsSinceLife;
    delete (planet.biota as Partial<typeof planet.biota>).ecology;
    delete (planet.history as Partial<typeof planet.history>).co2Ice;
    delete (planet.globals as Partial<typeof planet.globals>).escapedAtmosphere;
    delete (planet.geosphere as Partial<typeof planet.geosphere>).plateRngState;
    delete (planet.geosphere as Partial<typeof planet.geosphere>).sliverCleanupElapsedYears;
    delete (planet as Partial<typeof planet>).goal;
    const loaded = deserializeGame(serializeGame({ scenario: 'random', planet }));
    expect(loaded.planet.globals.seaLevel).toBe(0);
    expect(loaded.planet.globals.sedimentExport).toBe(0);
    expect(loaded.planet.globals.atmosphere.n2).toBe(0.78084);
    expect(loaded.planet.globals.atmosphere.inert).toBe(0.00934);
    expect(loaded.planet.globals.atmosphere.waterVapor).toBe(0.0025);
    expect(loaded.planet.globals.surfacePressure).toBeCloseTo(
      surfacePressureOf(loaded.planet.globals.atmosphere),
      6,
    );
    expect(loaded.planet.globals.water).toBeGreaterThan(0);
    expect(loaded.planet.globals.initialWater).toBe(loaded.planet.globals.water);
    expect(loaded.planet.globals.escapedWater).toBe(0);
    expect(loaded.planet.globals.runawayGreenhouse).toBe(false);
    expect(loaded.planet.fields.iceThickness).toEqual(new Float32Array(planet.grid.cellCount));
    expect(loaded.planet.fields.co2Ice).toEqual(new Float32Array(planet.grid.cellCount));
    expect(loaded.planet.fields.seasonalAmplitude).toEqual(new Float32Array(planet.grid.cellCount));
    expect(loaded.planet.fields.lakeDepth).toEqual(new Float32Array(planet.grid.cellCount));
    expect(loaded.planet.fields.lakeType).toEqual(new Int32Array(planet.grid.cellCount));
    expect(loaded.planet.history.seaLevel).toEqual(loaded.planet.history.year.map(() => 0));
    expect(loaded.planet.history.surfacePressure).toEqual(loaded.planet.history.year.map(() => 0));
    expect(loaded.planet.history.water).toEqual(loaded.planet.history.year.map(() => 0));
    expect(loaded.planet.history.era).toEqual(loaded.planet.history.year.map(() => 0));
    expect(loaded.planet.history.co2Ice).toEqual(loaded.planet.history.year.map(() => 0));
    expect(loaded.planet.controls.obliquity).toBe(23.44);
    expect(loaded.planet.planetParams.starType).toBe('G');
    expect(loaded.planet.planetParams.radius).toBe(loaded.planet.grid.radius);
    expect(loaded.planet.globals.magneticField).toBe(1);
    expect(loaded.planet.globals.tectonicRegime).toBe('mobile');
    expect(loaded.planet.globals.co2Ice).toBe(0);
    expect(loaded.planet.globals.dustBurden).toEqual([0, 0, 0]);
    expect(loaded.planet.globals.dustSources).toEqual([]);
    expect(loaded.planet.globals.dustIntegralSinceLife).toBe(0);
    expect(loaded.planet.biota.ecology.adaptedTemperature).toBe(
      loaded.planet.globals.meanTemperature,
    );
    expect(loaded.planet.geosphere.plateRngState).toBe((planet.seed ^ 0x7f4a7c15) >>> 0);
    expect(loaded.planet.geosphere.sliverCleanupElapsedYears).toBe(0);
    expect(loaded.planet.goal).toBeNull();
    const restored = restoreScenario('random', loaded.planet, loaded.settings);
    expect(() => restored.simulation.step(restored.planet, 5)).not.toThrow();
  });

  it('rejects files that are not saves', () => {
    expect(() => deserializeGame(new TextEncoder().encode('hello world, not a save'))).toThrow(
      SaveFormatError,
    );
  });
});
