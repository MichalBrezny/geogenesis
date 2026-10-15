import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('can resume from its state', () => {
    const a = createRng(7);
    a.next();
    const b = createRng(a.state);
    expect(b.next()).toBe(a.next());
  });

  it('stays within range', () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(9);
    }
  });
});
