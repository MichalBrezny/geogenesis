import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT } from '../../core/grid';
import { createValueNoise3D, fractalNoise } from '../../core/noise';
import type { PlanetState, Plate } from '../../core/planet';
import { createRng, type Rng } from '../../core/rng';

export interface TectonicsOptions {
  plateCount?: number;
  /** Approximate fraction of the surface covered by ocean (0..1). */
  oceanFraction?: number;
  /** Probability that a plate carries a large continent. */
  continentalPlateChance?: number;
  /** Typical width of mountain belts and trenches, in metres. */
  beltWidth?: number;
  /** Uplift rate at the most active convergent boundaries, in m/yr. */
  maxUpliftRate?: number;
}

const DEFAULTS: Required<TectonicsOptions> = {
  plateCount: 14,
  oceanFraction: 0.7,
  continentalPlateChance: 0.4,
  beltWidth: 700_000,
  maxUpliftRate: 3e-5,
};

/** Plate surface speeds are drawn from this range (m/yr), similar to Earth's plates. */
const MIN_PLATE_SPEED = 0.01;
const MAX_PLATE_SPEED = 0.08;
/** Convergence speed (m/yr) that produces the full boundary relief below. */
const REFERENCE_CONVERGENCE = 0.06;

/** Boundary relief at REFERENCE_CONVERGENCE, in metres. */
const MOUNTAIN_HEIGHT = 4000;
const TRENCH_DEPTH = 3500;
const ISLAND_ARC_HEIGHT = 2500;
/** Noise threshold for island arcs to break the surface; higher = fewer, smaller island groups. */
const ISLAND_ARC_COVERAGE = 0.25;
const RIDGE_HEIGHT = 2000;
const RIFT_DEPTH = 1200;

/**
 * Generates plates, continental crust and initial elevation, and sets the
 * tectonic uplift field. Plates are a noise-warped Voronoi partition of the
 * sphere; relief along plate boundaries depends on whether the plates
 * converge or diverge and on the crust type on each side.
 *
 * Plates do not move yet (continental drift is a later step), but their
 * velocities drive the boundary relief and the uplift rate.
 */
export function generateTectonicPlanet(state: PlanetState, options: TectonicsOptions = {}): void {
  const opts = { ...DEFAULTS, ...options };
  const { grid } = state;
  const rng = createRng(state.seed ^ 0x9e3779b9);
  const pos = grid.cellPosition;

  const plates = createPlates(rng, opts.plateCount, grid.radius);
  state.plates = plates;
  const plateCentres = randomUnitVectors(rng, opts.plateCount);
  const plateId = state.fields.plateId;
  assignPlates(state, plateCentres, rng);

  // Continental crust: per-plate bias plus noise, thresholded to the target land fraction.
  const continental = plates.map(() => rng.next() < opts.continentalPlateChance);
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
  const elevation = state.fields.elevation;
  const isContinental = new Uint8Array(grid.cellCount);
  for (let i = 0; i < grid.cellCount; i++) {
    const c = crust[i]! - shoreline;
    if (c >= 0) {
      isContinental[i] = 1;
      elevation[i] = 150 + Math.min(1500, 1200 * c);
    } else {
      elevation[i] = -150 - 4300 * (1 - Math.exp(6 * c));
    }
  }

  const { relief, collision } = boundaryRelief(state, plates, isContinental);

  // Break ocean-ocean island arcs into separate island groups; between them the arc
  // stays a submarine ridge that does not keep rising.
  const arcNoise = createValueNoise3D(rng);
  for (let i = 0; i < grid.cellCount; i++) {
    if (isContinental[i] || collision[i]! <= 0) continue;
    const p = i * 3;
    if (fractalNoise(arcNoise, pos[p]!, pos[p + 1]!, pos[p + 2]!, 3, 6) < ISLAND_ARC_COVERAGE) {
      relief[i] = collision[i]! * 0.4;
      collision[i] = 0;
    }
  }
  // Island arcs stay narrow chains on the boundary itself; only mountain belts are widened.
  const arcs = Float32Array.from(collision);
  spreadFromBoundaries(state, relief, opts.beltWidth);
  spreadFromBoundaries(state, collision, opts.beltWidth);

  // Small-scale detail so the surface is not smooth between features.
  const detailNoise = createValueNoise3D(rng);
  const uplift = state.fields.upliftRate;
  for (let i = 0; i < grid.cellCount; i++) {
    const p = i * 3;
    const detail = fractalNoise(detailNoise, pos[p]!, pos[p + 1]!, pos[p + 2]!, 4, 6);
    elevation[i] = elevation[i]! + relief[i]! + detail * (isContinental[i] ? 400 : 250);
    // Only collision zones (mountain belts, island arcs) keep rising; erosion wears down the rest.
    // Mid-ocean ridges are static relief: they sit below sea level where nothing erodes them.
    const source = isContinental[i] ? collision[i]! : arcs[i]!;
    uplift[i] = (source / MOUNTAIN_HEIGHT) * opts.maxUpliftRate;
  }
}

function createPlates(rng: Rng, count: number, radius: number): Plate[] {
  const poles = randomUnitVectors(rng, count);
  const plates: Plate[] = [];
  for (let id = 0; id < count; id++) {
    const speed = MIN_PLATE_SPEED + rng.next() * (MAX_PLATE_SPEED - MIN_PLATE_SPEED);
    plates.push({
      id,
      eulerPole: [poles[id * 3]!, poles[id * 3 + 1]!, poles[id * 3 + 2]!],
      angularSpeed: speed / radius,
    });
  }
  return plates;
}

function randomUnitVectors(rng: Rng, count: number): Float64Array {
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = rng.next() * 2 - 1;
    const lon = rng.next() * 2 * Math.PI;
    const r = Math.sqrt(1 - z * z);
    out[i * 3] = r * Math.cos(lon);
    out[i * 3 + 1] = r * Math.sin(lon);
    out[i * 3 + 2] = z;
  }
  return out;
}

/** Nearest plate centre after warping each cell's position with noise, giving irregular plate shapes. */
function assignPlates(state: PlanetState, centres: Float64Array, rng: Rng): void {
  const { grid } = state;
  const pos = grid.cellPosition;
  const warp = [createValueNoise3D(rng), createValueNoise3D(rng), createValueNoise3D(rng)];
  const plateCount = centres.length / 3;
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
    for (let k = 0; k < plateCount; k++) {
      const dot = wx * centres[k * 3]! + wy * centres[k * 3 + 1]! + wz * centres[k * 3 + 2]!;
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

/**
 * Relief (m) on cells that touch another plate, plus the part of it caused by
 * collision (mountains, island arcs), which drives ongoing uplift.
 * Positive convergence means the neighbouring plate moves towards this cell.
 */
function boundaryRelief(
  state: PlanetState,
  plates: readonly Plate[],
  isContinental: Uint8Array,
): { relief: Float32Array; collision: Float32Array } {
  const { grid } = state;
  const { neighbors } = getTopology(grid);
  const pos = grid.cellPosition;
  const plateId = state.fields.plateId;
  const relief = new Float32Array(grid.cellCount);
  const collision = new Float32Array(grid.cellCount);

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
        if (isContinental[i]) value = MOUNTAIN_HEIGHT * strength;
        else if (isContinental[n]) value = -TRENCH_DEPTH * strength;
        // Ocean-ocean: the lower plate id subducts, the other side forms an island arc.
        else
          value =
            plateId[i]! > plateId[n]! ? ISLAND_ARC_HEIGHT * strength : -TRENCH_DEPTH * strength;
        strongestCollision = Math.max(strongestCollision, value);
      } else {
        value = isContinental[i] ? -RIFT_DEPTH * strength : RIDGE_HEIGHT * strength;
      }
      if (Math.abs(value) > Math.abs(strongest)) strongest = value;
    }
    relief[i] = strongest;
    collision[i] = strongestCollision;
  }
  return { relief, collision };
}

/**
 * Widens boundary relief into belts: each pass lets a cell take a decayed copy of
 * its strongest neighbour, so features fall off with distance from the boundary.
 * The number of passes scales with grid resolution so belt width stays in metres.
 */
function spreadFromBoundaries(state: PlanetState, relief: Float32Array, beltWidth: number): void {
  const { grid } = state;
  const { neighbors } = getTopology(grid);
  const passes = Math.max(1, Math.round(beltWidth / grid.dy));
  const decay = Math.exp(-grid.dy / (beltWidth / 2));
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
    for (let i = 0; i < elevation.length; i++)
      elevation[i] = elevation[i]! + upliftRate[i]! * dtYears;
  },
};
