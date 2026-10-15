/**
 * Seeded pseudo-random generator (mulberry32).
 *
 * All randomness in the simulation must go through this so a seed fully
 * determines a run. The state is a single uint32, stored in PlanetState
 * so it survives save/load.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max). */
  int(min: number, max: number): number;
  /** Current internal state, for serialization. */
  readonly state: number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) {
      return min + Math.floor(this.next() * (max - min));
    },
    get state() {
      return s;
    },
  };
}
