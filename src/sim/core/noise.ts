import type { Rng } from './rng';

export type Noise3D = (x: number, y: number, z: number) => number;

/** Smooth value noise on an integer lattice in 3D, roughly in [-1, 1]. */
export function createValueNoise3D(rng: Rng): Noise3D {
  const size = 256;
  const values = new Float32Array(size);
  const perm = new Uint8Array(size * 2);
  for (let i = 0; i < size; i++) {
    values[i] = rng.next() * 2 - 1;
    perm[i] = i;
  }
  for (let i = size - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  for (let i = 0; i < size; i++) perm[size + i] = perm[i]!;

  const lattice = (ix: number, iy: number, iz: number) =>
    values[perm[perm[perm[ix & 255]! + (iy & 255)]! + (iz & 255)]!]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  return (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const fz = smooth(z - iz);
    const c00 = lerp(lattice(ix, iy, iz), lattice(ix + 1, iy, iz), fx);
    const c10 = lerp(lattice(ix, iy + 1, iz), lattice(ix + 1, iy + 1, iz), fx);
    const c01 = lerp(lattice(ix, iy, iz + 1), lattice(ix + 1, iy, iz + 1), fx);
    const c11 = lerp(lattice(ix, iy + 1, iz + 1), lattice(ix + 1, iy + 1, iz + 1), fx);
    return lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
  };
}

/** Fractal (fBm) sum of `octaves` noise layers, each at double frequency and half amplitude. */
export function fractalNoise(
  noise: Noise3D,
  x: number,
  y: number,
  z: number,
  octaves: number,
  baseFrequency: number,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = baseFrequency;
  for (let octave = 0; octave < octaves; octave++) {
    value += amplitude * noise(x * frequency, y * frequency, z * frequency);
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
}
