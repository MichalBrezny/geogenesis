import { describe, expect, it } from 'vitest';
import { createScenario } from '.';

describe('Aquarium', () => {
  it('stays a water world where sea life evolves', () => {
    const world = createScenario('aquarium', { seed: 2, width: 64, height: 32, start: 'quick' });
    const { planet, simulation } = world;
    const landShare = () => planet.history.landFraction.at(-1)!;
    expect(landShare()).toBeLessThan(0.02);
    for (let step = 0; step < 300; step++) simulation.step(planet, world.stepYears(planet));
    // Only the islands that volcanic arcs push up.
    expect(landShare()).toBeLessThan(0.08);
    expect(planet.biota.cover.filter((cover) => cover > 0).length).toBeGreaterThan(2);
  }, 60_000);
});
