import { describe, expect, it } from 'vitest';
import { restoreScenario } from './scenarios';
import { compress, decompress, deserializeGame, SaveFormatError, serializeGame } from './serialize';
import { createRandomWorld } from './world';

describe('save files', () => {
  it('round-trip a planet exactly', async () => {
    const world = createRandomWorld({ seed: 3, width: 32, height: 16 });
    for (let s = 0; s < 5; s++) world.simulation.step(world.planet, 1e6);
    const bytes = await compress(serializeGame({ scenario: 'random', planet: world.planet }));
    const loaded = deserializeGame(await decompress(bytes));
    expect(loaded.scenario).toBe('random');
    expect(loaded.planet).toEqual(world.planet);
    expect(loaded.planet.fields.elevation).toBeInstanceOf(Float32Array);
    expect(loaded.planet.plates[0]!.crust.owned).toBeInstanceOf(Uint8Array);
  });

  it('resumes the simulation after loading', () => {
    const world = createRandomWorld({ seed: 4, width: 32, height: 16 });
    world.simulation.step(world.planet, 1e6);
    const loaded = deserializeGame(serializeGame({ scenario: 'random', planet: world.planet }));
    const restored = restoreScenario('random', loaded.planet);
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

  it('rejects files that are not saves', () => {
    expect(() => deserializeGame(new TextEncoder().encode('hello world, not a save'))).toThrow(
      SaveFormatError,
    );
  });
});
