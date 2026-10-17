import { describe, expect, it } from 'vitest';
import { restoreScenario } from './scenarios';
import { compress, decompress, deserializeGame, SaveFormatError, serializeGame } from './serialize';
import { createRandomWorld } from './world';

describe('save files', () => {
  it('round-trip a planet exactly', async () => {
    const world = createRandomWorld({ seed: 3, width: 32, height: 16 });
    for (let s = 0; s < 5; s++) world.simulation.step(world.planet, 1e6);
    const bytes = await compress(
      serializeGame({ scenario: 'random', settings: world.settings, planet: world.planet }),
    );
    const loaded = deserializeGame(await decompress(bytes));
    expect(loaded.scenario).toBe('random');
    expect(loaded.settings).toEqual({ start: 'young', continentalFraction: 0.3 });
    expect(loaded.planet).toEqual(world.planet);
    expect(loaded.planet.fields.elevation).toBeInstanceOf(Float32Array);
    expect(loaded.planet.plates[0]!.crust.owned).toBeInstanceOf(Uint8Array);
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

  it('hydrates seasons, ice thickness, sea level, lakes and history from an older version-2 shape', () => {
    const planet = createRandomWorld({ seed: 7, width: 32, height: 16 }).planet;
    delete (planet.globals as Partial<typeof planet.globals>).seaLevel;
    delete (planet.globals as Partial<typeof planet.globals>).sedimentExport;
    delete (planet.fields as Partial<typeof planet.fields>).iceThickness;
    delete (planet.fields as Partial<typeof planet.fields>).seasonalAmplitude;
    delete (planet.fields as Partial<typeof planet.fields>).lakeDepth;
    delete (planet.fields as Partial<typeof planet.fields>).lakeType;
    delete (planet.history as Partial<typeof planet.history>).seaLevel;
    delete (planet.controls as Partial<typeof planet.controls>).obliquity;
    const loaded = deserializeGame(serializeGame({ scenario: 'random', planet }));
    expect(loaded.planet.globals.seaLevel).toBe(0);
    expect(loaded.planet.globals.sedimentExport).toBe(0);
    expect(loaded.planet.fields.iceThickness).toEqual(new Float32Array(planet.grid.cellCount));
    expect(loaded.planet.fields.seasonalAmplitude).toEqual(new Float32Array(planet.grid.cellCount));
    expect(loaded.planet.fields.lakeDepth).toEqual(new Float32Array(planet.grid.cellCount));
    expect(loaded.planet.fields.lakeType).toEqual(new Int32Array(planet.grid.cellCount));
    expect(loaded.planet.history.seaLevel).toEqual(loaded.planet.history.year.map(() => 0));
    expect(loaded.planet.controls.obliquity).toBe(23.44);
  });

  it('rejects files that are not saves', () => {
    expect(() => deserializeGame(new TextEncoder().encode('hello world, not a save'))).toThrow(
      SaveFormatError,
    );
  });
});
