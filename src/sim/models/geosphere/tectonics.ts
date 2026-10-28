import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT, type Grid } from '../../core/grid';
import { createValueNoise3D, fractalNoise, type Noise3D } from '../../core/noise';
import type { PlanetState } from '../../core/planet';
import { createRng, type Rng } from '../../core/rng';
import { mantleHeat } from '../atmosphere/carbon';
import {
  anchorPlates,
  orientMotionAcrossPlate,
  randomPlate,
  randomUnitVector,
  removePlateExclaves,
} from './plates';

export interface TectonicsOptions {
  plateCount?: number;
  /** Approximate fraction of the surface covered by ocean (0..1). */
  oceanFraction?: number;
  /** Probability that a plate carries a large continent. */
  continentalPlateChance?: number;
  /** Uplift rate at the most active convergent boundaries, in m/yr. */
  maxUpliftRate?: number;
}

export const DEFAULT_MAX_UPLIFT_RATE = 1e-4;

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
  const { grid } = state;
  const areaRatio = (grid.radius / 6_371_000) ** 2;
  const opts = {
    ...DEFAULTS,
    ...options,
    plateCount: options.plateCount ?? Math.max(4, Math.round(DEFAULTS.plateCount * areaRatio)),
  };
  const rng = createRng(state.seed ^ 0x9e3779b9);
  const pos = grid.cellPosition;

  state.plates = Array.from({ length: opts.plateCount }, (_, id) => randomPlate(rng, id, grid));
  const speedFactor = mantleHeat(state.globals.year, state.planetParams.radius);
  for (const plate of state.plates) {
    plate.angularSpeed *= speedFactor;
    plate.targetSpeed *= speedFactor;
  }
  state.geosphere.plateSpeedMantleFactor = speedFactor;
  state.geosphere.initialPlateCount = opts.plateCount;
  const plateCentres = Array.from({ length: opts.plateCount }, () => randomUnitVector(rng));
  const { plateId, crustType, elevation } = state.fields;
  assignPlates(state, plateCentres, rng);
  removePlateExclaves(state);

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
  for (const plate of state.plates) orientMotionAcrossPlate(plate, grid);
  initializeHotspots(state, rng);
  updateUplift(state, opts.maxUpliftRate);
}

/** Creates an area-scaled population (10–20 on Earth) of major mantle plumes. */
function initializeHotspots(state: PlanetState, rng: Rng): void {
  const areaRatio = (state.grid.radius / 6_371_000) ** 2;
  const minimum = Math.max(3, Math.round(10 * areaRatio));
  const maximum = Math.max(minimum + 1, Math.round(20 * areaRatio) + 1);
  const count = rng.int(minimum, maximum);
  const now = state.globals.year;
  state.geosphere.hotspots = Array.from({ length: count }, (_, id) => ({
    id,
    position: randomUnitVector(rng),
    strength: 0.7 + rng.next() * 0.6,
    birthYear: now - rng.next() * 300e6,
    deathYear: now + 300e6 + rng.next() * 500e6,
  }));
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
  const scratch = tectonicsScratch(grid, state);
  const { relief, collision, arcNoise: arcs } = scratch;
  relief.fill(0);
  collision.fill(0);

  for (let i = 0; i < grid.cellCount; i++) {
    // Most cells are plate interiors; skip them before doing any vector maths.
    let onBoundary = false;
    for (let d = 0; d < NEIGHBOR_COUNT && !onBoundary; d += 2) {
      const n = neighbors[i * NEIGHBOR_COUNT + d]!;
      onBoundary = n >= 0 && plateId[n] !== plateId[i];
    }
    if (!onBoundary) continue;

    const plate = plates[plateId[i]!]!;
    const p = i * 3;
    const plateScale = plate.angularSpeed * grid.radius;
    const [plateX, plateY, plateZ] = plate.eulerPole;
    const vx = plateScale * (plateY * pos[p + 2]! - plateZ * pos[p + 1]!);
    const vy = plateScale * (plateZ * pos[p]! - plateX * pos[p + 2]!);
    const vz = plateScale * (plateX * pos[p + 1]! - plateY * pos[p]!);
    let strongest = 0;
    let strongestCollision = 0;
    // Orthogonal neighbours only (even directions), so diagonal contacts do not double count.
    for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
      const n = neighbors[i * NEIGHBOR_COUNT + d]!;
      if (n < 0 || plateId[n] === plateId[i]) continue;
      const other = plates[plateId[n]!]!;
      const q = n * 3;
      const otherScale = other.angularSpeed * grid.radius;
      const [otherX, otherY, otherZ] = other.eulerPole;
      const ux = otherScale * (otherY * pos[q + 2]! - otherZ * pos[q + 1]!);
      const uy = otherScale * (otherZ * pos[q]! - otherX * pos[q + 2]!);
      const uz = otherScale * (otherX * pos[q + 1]! - otherY * pos[q]!);
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
  const arcs = tectonicsScratch(state.grid, state).arcs;
  arcs.set(collision);
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
 *
 * Only the front of cells that changed in the previous pass is propagated, so
 * the cost scales with the belt area rather than the whole grid.
 */
export function spreadFromBoundaries(state: PlanetState, relief: Float32Array): void {
  const { grid } = state;
  const { neighbors } = getTopology(grid);
  const passes = Math.max(1, Math.round(BELT_WIDTH / grid.dy));
  const decay = Math.exp(-grid.dy / (BELT_WIDTH / 2));
  const { proposed, touched, front, changed } = tectonicsScratch(grid, state);
  let currentFront = front;
  let nextFront = changed;
  let frontCount = 0;
  for (let i = 0; i < relief.length; i++) if (relief[i] !== 0) currentFront[frontCount++] = i;

  // Values proposed in this pass; applied together at the end, like a full-grid sweep.
  for (let pass = 0; pass < passes && frontCount > 0; pass++) {
    let changedCount = 0;
    for (let index = 0; index < frontCount; index++) {
      const c = currentFront[index]!;
      const candidate = relief[c]! * decay;
      for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
        const n = neighbors[c * NEIGHBOR_COUNT + d]!;
        if (n < 0 || Math.abs(candidate) <= Math.abs(relief[n]!)) continue;
        if (!touched[n]) {
          touched[n] = 1;
          proposed[n] = candidate;
          nextFront[changedCount++] = n;
        } else if (Math.abs(candidate) > Math.abs(proposed[n]!)) {
          proposed[n] = candidate;
        }
      }
    }
    for (let index = 0; index < changedCount; index++) {
      const n = nextFront[index]!;
      relief[n] = proposed[n]!;
      touched[n] = 0;
    }
    frontCount = changedCount;
    const swap = currentFront;
    currentFront = nextFront;
    nextFront = swap;
  }
}

interface TectonicsScratch {
  relief: Float32Array;
  collision: Float32Array;
  arcs: Float32Array;
  proposed: Float32Array;
  touched: Uint8Array;
  front: Int32Array;
  changed: Int32Array;
  arcNoise: Noise3D;
}

const tectonicsScratchCache = new WeakMap<Grid, TectonicsScratch>();

/** Derived boundary work arrays, kept outside the serializable planet state. */
function tectonicsScratch(grid: Grid, state: PlanetState): TectonicsScratch {
  let scratch = tectonicsScratchCache.get(grid);
  if (!scratch) {
    const n = grid.cellCount;
    scratch = {
      relief: new Float32Array(n),
      collision: new Float32Array(n),
      arcs: new Float32Array(n),
      proposed: new Float32Array(n),
      touched: new Uint8Array(n),
      front: new Int32Array(n),
      changed: new Int32Array(n),
      arcNoise: arcNoise(state),
    };
    tectonicsScratchCache.set(grid, scratch);
  }
  return scratch;
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
    if (state.globals.tectonicRegime === 'stagnant') {
      state.fields.upliftRate.fill(0);
      return;
    }
    const { elevation, upliftRate } = state.fields;
    for (let i = 0; i < elevation.length; i++) {
      elevation[i] = elevation[i]! + upliftRate[i]! * dtYears;
    }
  },
};
