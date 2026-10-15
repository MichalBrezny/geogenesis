import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT } from '../../core/grid';
import { createValueNoise3D, fractalNoise, type Noise3D } from '../../core/noise';
import type { PlanetState, Plate } from '../../core/planet';
import { createRng, type Rng } from '../../core/rng';
import { anchorPlates, randomPlate, randomUnitVector } from './plates';

export interface TectonicsOptions {
  plateCount?: number;
  /** Approximate fraction of the surface covered by ocean (0..1). */
  oceanFraction?: number;
  /** Probability that a plate carries a large continent. */
  continentalPlateChance?: number;
  /** Uplift rate at the most active convergent boundaries, in m/yr. */
  maxUpliftRate?: number;
}

export const DEFAULT_MAX_UPLIFT_RATE = 3e-5;

const DEFAULTS: Required<TectonicsOptions> = {
  plateCount: 14,
  oceanFraction: 0.7,
  continentalPlateChance: 0.4,
  maxUpliftRate: DEFAULT_MAX_UPLIFT_RATE,
};

/** Convergence speed (m/yr) that produces the full boundary relief below. */
const REFERENCE_CONVERGENCE = 0.06;
/** Typical width of mountain belts, in metres. */
const BELT_WIDTH = 700_000;

/** Boundary relief at REFERENCE_CONVERGENCE, in metres. */
const MOUNTAIN_HEIGHT = 4000;
const TRENCH_DEPTH = 3500;
const ISLAND_ARC_HEIGHT = 2500;
/** Noise threshold for island arcs to break the surface; higher = fewer, smaller island groups. */
const ISLAND_ARC_COVERAGE = 0.25;
const RIDGE_HEIGHT = 2000;
const RIFT_DEPTH = 1200;

/** Depth of old (abyssal) ocean floor, in metres. Trenches are measured from here. */
export const ABYSSAL_DEPTH = -4500;

/**
 * Generates plates, continental crust and initial elevation, and sets the
 * tectonic uplift field. Plates are a noise-warped Voronoi partition of the
 * sphere; relief along plate boundaries depends on whether the plates
 * converge or diverge and on the crust type on each side.
 */
export function generateTectonicPlanet(state: PlanetState, options: TectonicsOptions = {}): void {
  const opts = { ...DEFAULTS, ...options };
  const { grid } = state;
  const rng = createRng(state.seed ^ 0x9e3779b9);
  const pos = grid.cellPosition;

  state.plates = Array.from({ length: opts.plateCount }, (_, id) => randomPlate(rng, id, grid));
  const plateCentres = Array.from({ length: opts.plateCount }, () => randomUnitVector(rng));
  const { plateId, crustType, elevation } = state.fields;
  assignPlates(state, plateCentres, rng);

  // Continental crust: per-plate bias plus noise, thresholded to the target land fraction.
  const continental = state.plates.map(() => rng.next() < opts.continentalPlateChance);
  if (!continental.some(Boolean)) continental[0] = true;
  const crustNoise = createValueNoise3D(rng);
  const crust = new Float32Array(grid.cellCount);
  for (let i = 0; i < grid.cellCount; i++) {
    const p = i * 3;
    const bias = continental[plateId[i]!] ? 0.55 : -0.55;
    crust[i] = bias + 0.9 * fractalNoise(crustNoise, pos[p]!, pos[p + 1]!, pos[p + 2]!, 5, 1.8);
  }
  const shoreline = percentile(crust, opts.oceanFraction);

  // Base elevation from crust: continental interiors rise gently, oceans deepen away from the shelf.
  for (let i = 0; i < grid.cellCount; i++) {
    const c = crust[i]! - shoreline;
    crustType[i] = c >= 0 ? 1 : 0;
    elevation[i] =
      c >= 0
        ? 150 + Math.min(1500, 1200 * c)
        : -150 + (ABYSSAL_DEPTH + 150) * (1 - Math.exp(6 * c));
  }

  const { relief } = computeBoundaries(state);
  spreadFromBoundaries(state, relief);

  // Small-scale detail so the surface is not smooth between features.
  const detailNoise = createValueNoise3D(rng);
  for (let i = 0; i < grid.cellCount; i++) {
    const p = i * 3;
    const detail = fractalNoise(detailNoise, pos[p]!, pos[p + 1]!, pos[p + 2]!, 4, 6);
    elevation[i] = elevation[i]! + relief[i]! + detail * (crustType[i] ? 400 : 250);
  }
  anchorPlates(state);
  updateUplift(state, opts.maxUpliftRate);
}

/** Nearest plate centre after warping each cell's position with noise, giving irregular plate shapes. */
function assignPlates(
  state: PlanetState,
  centres: readonly (readonly [number, number, number])[],
  rng: Rng,
): void {
  const { grid } = state;
  const pos = grid.cellPosition;
  const warp = [createValueNoise3D(rng), createValueNoise3D(rng), createValueNoise3D(rng)];
  for (let i = 0; i < grid.cellCount; i++) {
    const p = i * 3;
    const x = pos[p]!;
    const y = pos[p + 1]!;
    const z = pos[p + 2]!;
    const wx = x + 0.45 * fractalNoise(warp[0]!, x, y, z, 3, 2);
    const wy = y + 0.45 * fractalNoise(warp[1]!, x, y, z, 3, 2);
    const wz = z + 0.45 * fractalNoise(warp[2]!, x, y, z, 3, 2);
    let best = 0;
    let bestDot = -Infinity;
    for (let k = 0; k < centres.length; k++) {
      const [cx, cy, cz] = centres[k]!;
      const dot = wx * cx + wy * cy + wz * cz;
      if (dot > bestDot) {
        bestDot = dot;
        best = k;
      }
    }
    state.fields.plateId[i] = best;
  }
}

/** Surface velocity (m/yr) of `plate` at unit position p: ω × p, scaled by the radius. */
function plateVelocity(plate: Plate, x: number, y: number, z: number, radius: number) {
  const s = plate.angularSpeed * radius;
  const [ax, ay, az] = plate.eulerPole;
  return [s * (ay * z - az * y), s * (az * x - ax * z), s * (ax * y - ay * x)] as const;
}

/** Noise that decides where island arcs break the surface. Fixed per planet so arcs stay put. */
function arcNoise(state: PlanetState): Noise3D {
  return createValueNoise3D(createRng(state.seed ^ 0x5bd1e995));
}

/**
 * Relief (m) on cells that touch another plate, plus the part of it caused by
 * collision (mountains, island arcs), which drives ongoing uplift.
 * Positive convergence means the neighbouring plate moves towards this cell.
 */
function computeBoundaries(state: PlanetState): { relief: Float32Array; collision: Float32Array } {
  const { grid, plates } = state;
  const { neighbors } = getTopology(grid);
  const pos = grid.cellPosition;
  const { plateId, crustType } = state.fields;
  const relief = new Float32Array(grid.cellCount);
  const collision = new Float32Array(grid.cellCount);
  const arcs = arcNoise(state);

  for (let i = 0; i < grid.cellCount; i++) {
    const plate = plates[plateId[i]!]!;
    const p = i * 3;
    const [vx, vy, vz] = plateVelocity(plate, pos[p]!, pos[p + 1]!, pos[p + 2]!, grid.radius);
    let strongest = 0;
    let strongestCollision = 0;
    // Orthogonal neighbours only (even directions), so diagonal contacts do not double count.
    for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
      const n = neighbors[i * NEIGHBOR_COUNT + d]!;
      if (n < 0 || plateId[n] === plateId[i]) continue;
      const other = plates[plateId[n]!]!;
      const q = n * 3;
      const [ux, uy, uz] = plateVelocity(other, pos[q]!, pos[q + 1]!, pos[q + 2]!, grid.radius);
      let dx = pos[q]! - pos[p]!;
      let dy = pos[q + 1]! - pos[p + 1]!;
      let dz = pos[q + 2]! - pos[p + 2]!;
      const len = Math.hypot(dx, dy, dz);
      dx /= len;
      dy /= len;
      dz /= len;
      const convergence = -((ux - vx) * dx + (uy - vy) * dy + (uz - vz) * dz);
      const strength = Math.min(1.5, Math.abs(convergence) / REFERENCE_CONVERGENCE);

      let value: number;
      if (convergence > 0) {
        if (crustType[i]) {
          value = MOUNTAIN_HEIGHT * strength;
          strongestCollision = Math.max(strongestCollision, value);
        } else if (crustType[n] || plateId[i]! < plateId[n]!) {
          // Oceanic crust subducts under continents; between two oceanic plates the lower id does.
          value = -TRENCH_DEPTH * strength;
        } else if (
          fractalNoise(arcs, pos[p]!, pos[p + 1]!, pos[p + 2]!, 3, 6) >= ISLAND_ARC_COVERAGE
        ) {
          value = ISLAND_ARC_HEIGHT * strength;
          strongestCollision = Math.max(strongestCollision, value);
        } else {
          // Between island groups the arc stays a submarine ridge that does not keep rising.
          value = ISLAND_ARC_HEIGHT * strength * 0.4;
        }
      } else {
        value = crustType[i] ? -RIFT_DEPTH * strength : RIDGE_HEIGHT * strength;
      }
      if (Math.abs(value) > Math.abs(strongest)) strongest = value;
    }
    relief[i] = strongest;
    collision[i] = strongestCollision;
  }
  return { relief, collision };
}

/**
 * Recomputes tectonic uplift from the current plate boundaries and deepens
 * subduction trenches. Called at generation and whenever plates move.
 */
export function updateUplift(state: PlanetState, maxUpliftRate: number): void {
  const { relief, collision } = computeBoundaries(state);
  const { crustType, elevation, upliftRate } = state.fields;
  // Island arcs stay narrow chains on the boundary itself; only mountain belts are widened.
  const arcs = Float32Array.from(collision);
  spreadFromBoundaries(state, collision);
  for (let i = 0; i < upliftRate.length; i++) {
    const source = crustType[i] ? collision[i]! : arcs[i]!;
    upliftRate[i] = (source / MOUNTAIN_HEIGHT) * maxUpliftRate;
    if (!crustType[i] && relief[i]! < 0) {
      elevation[i] = Math.min(elevation[i]!, ABYSSAL_DEPTH + relief[i]!);
    }
  }
}

/**
 * Widens boundary relief into belts: each pass lets a cell take a decayed copy of
 * its strongest neighbour, so features fall off with distance from the boundary.
 * The number of passes scales with grid resolution so belt width stays in metres.
 */
function spreadFromBoundaries(state: PlanetState, relief: Float32Array): void {
  const { grid } = state;
  const { neighbors } = getTopology(grid);
  const passes = Math.max(1, Math.round(BELT_WIDTH / grid.dy));
  const decay = Math.exp(-grid.dy / (BELT_WIDTH / 2));
  const next = new Float32Array(relief.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < relief.length; i++) {
      let best = relief[i]!;
      for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
        const n = neighbors[i * NEIGHBOR_COUNT + d]!;
        if (n < 0) continue;
        const candidate = relief[n]! * decay;
        if (Math.abs(candidate) > Math.abs(best)) best = candidate;
      }
      next[i] = best;
    }
    relief.set(next);
  }
}

function percentile(values: Float32Array, fraction: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.floor(fraction * (sorted.length - 1))]!;
}

/** Applies tectonic uplift (and subsidence) to the surface. */
export const tectonicUplift: SimComponent = {
  name: 'tectonicUplift',
  inputs: ['elevation', 'upliftRate'],
  outputs: ['elevation'],
  runOneStep(state, dtYears) {
    const { elevation, upliftRate } = state.fields;
    for (let i = 0; i < elevation.length; i++) {
      elevation[i] = elevation[i]! + upliftRate[i]! * dtYears;
    }
  },
};
