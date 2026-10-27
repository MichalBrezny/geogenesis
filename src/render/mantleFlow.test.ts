import { describe, expect, it } from 'vitest';
import { mantleVelocityField } from './mantleFlow';

describe('mantle-flow plate velocities', () => {
  it('matches a known north-pole Euler rotation at the equator', () => {
    const field = mantleVelocityField({
      grid: { width: 1, height: 1 },
      radius: 2_000_000,
      plateId: new Int32Array([7]),
      plates: [{ id: 7, eulerPole: [0, 0, 1], angularSpeed: 2e-9 }],
    });
    expect(field.u[0]).toBeCloseTo(0.4, 6);
    expect(field.v[0]).toBeCloseTo(0, 6);
  });
});
