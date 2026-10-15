import type { PlanetState } from '../../core/planet';
import { createRng, type Rng } from '../../core/rng';

export interface TerrainOptions {
  /** Approximate fraction of the surface covered by ocean (0..1). */
  oceanFraction?: number;
  /** Highest peak / deepest trench in metres. */
  maxElevation?: number;
  maxDepth?: number;
}

/**
 * Generates initial elevation with fractal value noise sampled on the sphere,
 * so the map wraps east-west seamlessly and the poles are not stretched.
 * Placeholder until a tectonics-based generator exists.
 */
export function generateTerrain(state: PlanetState, options: TerrainOptions = {}): void {
  const { oceanFraction = 0.7, maxElevation = 6000, maxDepth = 8000 } = options;
  const { grid } = state;
  const elevation = state.fields.elevation;
  const noise = createValueNoise3D(createRng(state.seed ^ 0x9e3779b9));

  const raw = new Float32Array(grid.cellCount);
  for (let y = 0; y < grid.height; y++) {
    const lat = (grid.rowLatitude[y]! * Math.PI) / 180;
    for (let x = 0; x < grid.width; x++) {
      const lon = ((x + 0.5) / grid.width) * 2 * Math.PI;
      const px = Math.cos(lat) * Math.cos(lon);
      const py = Math.cos(lat) * Math.sin(lon);
      const pz = Math.sin(lat);
      let value = 0;
      let amplitude = 1;
      let frequency = 1.5;
      for (let octave = 0; octave < 6; octave++) {
        value += amplitude * noise(px * frequency, py * frequency, pz * frequency);
        amplitude *= 0.5;
        frequency *= 2;
      }
      raw[y * grid.width + x] = value;
    }
  }

  // Shift so that `oceanFraction` of the cells lie below sea level.
  const sorted = Float32Array.from(raw).sort();
  const seaLevel = sorted[Math.floor(oceanFraction * (sorted.length - 1))]!;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]! - seaLevel;
    elevation[i] =
      v >= 0 ? (v / (max - seaLevel || 1)) * maxElevation : (v / (seaLevel - min || 1)) * maxDepth;
  }
}

/** Smooth value noise on an integer lattice in 3D, roughly in [-1, 1]. */
function createValueNoise3D(rng: Rng): (x: number, y: number, z: number) => number {
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
