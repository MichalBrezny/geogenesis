import { describe, expect, it } from 'vitest';
import type { PlanetState } from './core/planet';
import { createScenario } from './scenarios';
import { createRandomWorld, type World } from './world';

/**
 * Regression digests of short runs on a 64×32 grid. Performance work must keep
 * them unchanged; a deliberate model change updates them (run the test and copy
 * the received values).
 */
const EXPECTED = {
  young: '4ef03679',
  quick: '4aa4f4a6',
  stoneAge: 'da84c5b0',
};

/** FNV-1a (32-bit) over the bytes of every field, the populations and key globals. */
function digest(planet: PlanetState): string {
  let hash = 0x811c9dc5;
  const add = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i]!;
      hash = Math.imul(hash, 0x01000193);
    }
  };
  for (const name of Object.keys(planet.fields).sort() as (keyof PlanetState['fields'])[]) {
    const values = planet.fields[name];
    add(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
  }
  const populations = planet.biota.populations;
  add(new Uint8Array(populations.buffer, populations.byteOffset, populations.byteLength));
  add(
    new TextEncoder().encode(
      JSON.stringify([planet.globals, planet.rngState, planet.events.length, planet.civilization]),
    ),
  );
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function advance(world: World, steps: number): void {
  for (let step = 0; step < steps; step++) {
    world.simulation.step(world.planet, world.stepYears(world.planet));
  }
}

describe('simulation determinism digests', () => {
  for (const start of ['young', 'quick'] as const) {
    it(`reproduces 30 ${start} steps at 64×32`, () => {
      const world = createRandomWorld({ start, seed: 19, width: 64, height: 32 });
      advance(world, 30);
      expect(digest(world.planet)).toBe(EXPECTED[start]);
    }, 60_000);
  }

  it('reproduces 300 Stone age steps at 64×32', () => {
    const world = createScenario('stoneAge', { seed: 17, width: 64, height: 32 });
    advance(world, 300);
    expect(digest(world.planet)).toBe(EXPECTED.stoneAge);
  }, 120_000);
});
