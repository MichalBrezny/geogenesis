import type { SimComponent } from '../../core/component';
import {
  areaWeightedMean,
  getTopology,
  NEIGHBOR_COUNT,
  resolutionScale,
  type Grid,
} from '../../core/grid';
import type { PlanetState, Plate } from '../../core/planet';
import type { Rng } from '../../core/rng';
import { randomizeMotion, referenceCell, rotatePlate } from './plates';
import { ABYSSAL_DEPTH, DEFAULT_MAX_UPLIFT_RATE, updateUplift } from './tectonics';

export interface DriftOptions {
  /** Multiplier on all plate speeds (a future player control). 0 stops drift. */
  speedFactor?: number;
  /** Mean years between plate reorganizations (new motions, possibly a plate split). */
  reorganizationInterval?: number;
  /** Uplift rate at the most active convergent boundaries, in m/yr. */
  maxUpliftRate?: number;
  /**
   * Area fraction of continental crust the planet tends towards. When collisions
   * have consumed crust below this, continental shelves grow back faster.
   */
  continentalFraction?: number;
}

/** Longest plate move (years) computed in one go; the model is tuned for 1 Myr steps. */
const MAX_STEP = 1e6;
/** Elevation of freshly formed ocean floor at a spreading ridge, in metres. */
const RIDGE_DEPTH = -2600;
/** E-folding time (years) for young ocean floor to cool and sink to abyssal depth. */
const OCEAN_FLOOR_COOLING_TIME = 60e6;
/** Elevation (m) added to the overriding plate per consumed cell of continental crust. */
const CONTINENTAL_COLLISION_UPLIFT = 500;
// Collision thickening is a height per consumed cell. Finer grids consume more, smaller cells
// for the same plate motion, so the volume added per km of plate boundary is the same at any
// resolution; spreadThickening keeps the belt width the same in kilometres.
/** Elevation (m) added to the overriding plate per subducted cell of ocean floor (volcanic arcs). */
const SUBDUCTION_UPLIFT = 40;
/** Cap on cell-mean elevation (m); a ~300 km cell averages far below the highest peaks. */
const MAX_ELEVATION = 6500;
/** E-folding time (years) over which colliding continents bring both plates to a halt. */
const COLLISION_STALL_TIME = 30e6;
/** E-folding time (years) for a plate freed from a collision to regain its target speed. */
const SPEED_RECOVERY_TIME = 80e6;
/**
 * Years for a reference-grid shelf cell to accrete into continent when crust is fully
 * depleted. Finer grids have more, smaller coastal cells, so each accretes faster.
 */
const SHELF_ACCRETION_TIME = 10e6;
/** Shelf cells shallower than this (m) next to a continent can accrete. */
const SHELF_DEPTH = -3000;

/**
 * Simple continental drift.
 *
 * Every plate keeps its crust in its own reference raster and rotates rigidly
 * about its Euler pole. Each step the planet fields are re-composed: every
 * cell asks each plate which reference cell is now above it.
 *
 * - Several plates over one cell (convergence): continental crust wins over
 *   oceanic, which subducts and is removed from its plate; colliding
 *   continents thicken the winner (mountain building) and slow both plates;
 *   between two oceanic plates the higher id stays on top.
 * - No plate over a cell (divergence): new ocean floor forms at ridge depth and
 *   is added to the plate that was there before.
 *
 * Ocean floor cools and sinks with age. Occasionally plates reorganize: all
 * get new motions and the largest plate may split, which keeps the plate
 * count up and lets supercontinents break apart.
 */
export function createPlateDrift(options: DriftOptions = {}): SimComponent {
  const speedFactor = options.speedFactor ?? 1;
  const reorganizationInterval = options.reorganizationInterval ?? 300e6;
  const maxUpliftRate = options.maxUpliftRate ?? DEFAULT_MAX_UPLIFT_RATE;
  const continentalFraction = options.continentalFraction ?? 0.3;

  return {
    name: 'plateDrift',
    inputs: ['elevation', 'plateId', 'crustType'],
    outputs: ['elevation', 'plateId', 'crustType', 'upliftRate'],
    runOneStep(state, stepYears, rng) {
      const speed = speedFactor * state.controls.driftSpeed;
      if (stepYears <= 0 || speed <= 0) return;
      // Collisions stall plates only after they are detected, so long steps let
      // continents plough through each other: move in sub-steps of at most MAX_STEP.
      const substeps = Math.ceil(stepYears / MAX_STEP);
      for (let k = 0; k < substeps; k++) {
        driftOnce(state, stepYears / substeps, speed, rng);
      }
    },
  };

  function driftOnce(state: PlanetState, dtYears: number, speed: number, rng: Rng): void {
    coolOceanFloor(state, dtYears);
    accreteContinents(state, dtYears, continentalFraction, rng);
    // Persist erosion, uplift etc. from the last step into the plates before moving them.
    writeBackToPlates(state);

    if (rng.next() < 1 - Math.exp(-dtYears / reorganizationInterval)) {
      reorganizePlates(state, rng);
    }
    for (const plate of state.plates) {
      rotatePlate(plate, plate.angularSpeed * speed * dtYears);
    }
    fillPlateHoles(state);
    const collisions = composePlates(state, rng);
    for (const plate of state.plates) {
      if (collisions[plate.id]) {
        plate.angularSpeed *= Math.exp(-dtYears / COLLISION_STALL_TIME);
      } else {
        const recovery = 1 - Math.exp(-dtYears / SPEED_RECOVERY_TIME);
        plate.angularSpeed += (plate.targetSpeed - plate.angularSpeed) * recovery;
      }
    }
    updateUplift(state, maxUpliftRate);
  }
}

/**
 * Stores changes made to the planet fields since the last composition (erosion,
 * uplift, thickening, accretion) in the plates.
 *
 * Several planet cells can sample the same reference cell, so elevation is
 * written as the average change of those cells, not as "last write wins";
 * otherwise peaks and eroded valleys would randomly be lost on every step.
 */
function writeBackToPlates(state: PlanetState): void {
  const { grid, plates } = state;
  const { elevation, plateId, crustType } = state.fields;
  const n = grid.cellCount;
  const buffers = composeBuffers(grid, plates.length);
  if (!buffers.composedValid) {
    // No composition to compare against yet (fresh or loaded planet): copy values.
    for (let i = 0; i < n; i++) {
      const plate = plates[plateId[i]!]!;
      const r = referenceCell(grid, plate, i);
      if (!plate.crust.owned[r]) continue;
      plate.crust.elevation[r] = elevation[i]!;
      plate.crust.type[r] = crustType[i]!;
    }
    return;
  }

  const { refs, composed, deltaSum, deltaCount } = buffers;
  const touched: number[] = [];
  for (let d = 0; d < n; d++) {
    const k = plateId[d]!;
    const r = refs[d * plates.length + k]!;
    const crust = plates[k]!.crust;
    if (!crust.owned[r]) continue;
    const slot = k * n + r;
    if (deltaCount[slot] === 0) touched.push(slot);
    deltaSum[slot] = deltaSum[slot]! + (elevation[d]! - composed[d]!);
    deltaCount[slot] = deltaCount[slot]! + 1;
    if (crustType[d]) crust.type[r] = 1;
  }
  for (const slot of touched) {
    const crust = plates[Math.floor(slot / n)]!.crust;
    const r = slot % n;
    crust.elevation[r] = crust.elevation[r]! + deltaSum[slot]! / deltaCount[slot]!;
    deltaSum[slot] = 0;
    deltaCount[slot] = 0;
  }
}

/**
 * Grows continental crust, balancing what collisions consume:
 * - island arcs that have risen above sea level become continental, as on Earth;
 * - when continental crust is below its target fraction, shallow shelves next to
 *   continents accrete (sediment and terranes), faster the larger the deficit.
 */
function accreteContinents(state: PlanetState, dtYears: number, target: number, rng: Rng): void {
  const { grid } = state;
  const { neighbors } = getTopology(grid);
  const { elevation, crustType, upliftRate } = state.fields;
  const deficit = Math.max(0, target - areaWeightedMean(grid, crustType)) / target;
  const shelfRate = deficit / (SHELF_ACCRETION_TIME * resolutionScale(grid));
  const shelfChance = 1 - Math.exp(-dtYears * shelfRate);

  for (let i = 0; i < elevation.length; i++) {
    if (crustType[i]) continue;
    if (upliftRate[i]! > 0 && elevation[i]! > 0) {
      crustType[i] = 1;
      continue;
    }
    if (shelfChance <= 0 || elevation[i]! < SHELF_DEPTH) continue;
    let coastal = false;
    for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
      const n = neighbors[i * NEIGHBOR_COUNT + d]!;
      if (n >= 0 && crustType[n]) coastal = true;
    }
    if (coastal && rng.next() < shelfChance) {
      crustType[i] = 1;
      // Continental crust is buoyant: the new margin sits just above sea level.
      elevation[i] = Math.max(elevation[i]!, 100);
    }
  }
}

/** Rebuilds the planet fields from the plates. Returns, per plate, whether it had a continental collision. */
function composePlates(state: PlanetState, rng: Rng): Uint8Array {
  const { grid, plates } = state;
  const { elevation, plateId, crustType } = state.fields;
  const n = grid.cellCount;
  const plateCount = plates.length;
  const collided = new Uint8Array(plateCount);
  // refs[d * plateCount + k]: reference cell of plate k currently over planet cell d,
  // or -1 if the plate's bounding cap does not reach d.
  // visible[k * n + r]: plate k's reference cell r is on top somewhere. Several planet
  // cells can sample the same reference cell, so crust is only consumed if it is
  // hidden everywhere; otherwise plate edges would erode from resampling alone.
  const buffers = composeBuffers(grid, plateCount);
  const { refs, visible, winners, thickening, composed, fresh } = buffers;
  visible.fill(0);
  thickening.fill(0);
  const caps = plates.map((plate) => boundingCap(grid, plate));
  const pos = grid.cellPosition;

  for (let d = 0; d < n; d++) {
    const px = pos[d * 3]!;
    const py = pos[d * 3 + 1]!;
    const pz = pos[d * 3 + 2]!;
    let winner = -1;
    let winnerFresh = false;
    for (let k = 0; k < plateCount; k++) {
      const cap = caps[k];
      // Cheap rejection: most plates are nowhere near this cell.
      if (!cap || px * cap[0] + py * cap[1] + pz * cap[2] < cap[3]) {
        refs[d * plateCount + k] = -1;
        continue;
      }
      const r = referenceCell(grid, plates[k]!, d);
      refs[d * plateCount + k] = r;
      if (!plates[k]!.crust.owned[r]) continue;
      // Crust just added by hole filling never displaces another plate's existing crust.
      const isFresh = fresh[k * n + r] === 1;
      if (
        winner < 0 ||
        (winnerFresh && !isFresh) ||
        (isFresh === winnerFresh &&
          beats(plates[k]!, r, plates[winner]!, refs[d * plateCount + winner]!))
      ) {
        winner = k;
        winnerFresh = isFresh;
      }
    }
    if (winner < 0) {
      // Divergence: new ocean floor joins the plate that was here before.
      winner = plateId[d]!;
      const crust = plates[winner]!.crust;
      const r = referenceCell(grid, plates[winner]!, d);
      refs[d * plateCount + winner] = r;
      crust.owned[r] = 1;
      crust.type[r] = 0;
      crust.elevation[r] = RIDGE_DEPTH + (rng.next() - 0.5) * 300;
    }
    winners[d] = winner;
    visible[winner * n + refs[d * plateCount + winner]!] = 1;
  }

  // Crust hidden under the winner is consumed and thickens the winner.
  for (let d = 0; d < n; d++) {
    const winner = winners[d]!;
    const top = plates[winner]!.crust;
    const topRef = refs[d * plateCount + winner]!;
    for (let k = 0; k < plateCount; k++) {
      const r = refs[d * plateCount + k]!;
      const crust = plates[k]!.crust;
      if (k === winner || r < 0 || !crust.owned[r] || visible[k * n + r]) continue;
      crust.owned[r] = 0;
      // Hole-filling artefacts vanish quietly; real overlaps drive collisions.
      if (fresh[k * n + r]) continue;
      if (crust.type[r] && top.type[topRef]) {
        thickening[d] = thickening[d]! + CONTINENTAL_COLLISION_UPLIFT;
        collided[k] = 1;
        collided[winner] = 1;
      } else if (top.type[topRef]) {
        thickening[d] = thickening[d]! + SUBDUCTION_UPLIFT;
      }
    }
  }

  for (let d = 0; d < n; d++) {
    const winner = winners[d]!;
    const crust = plates[winner]!.crust;
    const r = refs[d * plateCount + winner]!;
    plateId[d] = winner;
    elevation[d] = crust.elevation[r]!;
    crustType[d] = crust.type[r]!;
    composed[d] = elevation[d]!;
  }
  buffers.composedValid = true;
  spreadThickening(state, thickening);
  return collided;
}

/**
 * Adds collision thickening to the continental crust around each collision cell
 * (a third to the cell, the rest shared by its continental neighbours), so
 * mountain belts form instead of single-cell spikes. Isolated islands only get
 * their third, so they cannot grow into needles. The next write-back stores
 * the result in the plates.
 *
 * On grids finer than the reference the thickening is first blurred over a few
 * cells, so belts keep the same width in kilometres; otherwise they would be
 * narrower and diffusion would flatten them much faster.
 */
function spreadThickening(state: PlanetState, thickening: Float32Array): void {
  const { neighbors } = getTopology(state.grid);
  const { elevation, crustType } = state.fields;
  const blurPasses = Math.max(0, Math.round(1 / resolutionScale(state.grid)) - 1);
  for (let pass = 0; pass < blurPasses; pass++) blurOnce(thickening, neighbors);

  for (let d = 0; d < thickening.length; d++) {
    const amount = thickening[d]!;
    if (amount <= 0 || !crustType[d]) continue;
    let targets = 0;
    for (let k = 0; k < NEIGHBOR_COUNT; k++) {
      const nb = neighbors[d * NEIGHBOR_COUNT + k]!;
      if (nb >= 0 && crustType[nb]) targets++;
    }
    const centre = amount / 3;
    elevation[d] = Math.min(MAX_ELEVATION, elevation[d]! + centre);
    if (targets === 0) continue;
    const share = (amount - centre) / targets;
    for (let k = 0; k < NEIGHBOR_COUNT; k++) {
      const nb = neighbors[d * NEIGHBOR_COUNT + k]!;
      if (nb >= 0 && crustType[nb]) elevation[nb] = Math.min(MAX_ELEVATION, elevation[nb]! + share);
    }
  }
}

/** One pass of a 4-neighbour blur that keeps the total (half stays, half is shared). */
function blurOnce(values: Float32Array, neighbors: Int32Array): void {
  const source = Float32Array.from(values);
  values.fill(0);
  for (let i = 0; i < source.length; i++) {
    const v = source[i]!;
    if (v === 0) continue;
    let kept = v / 2;
    for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
      const n = neighbors[i * NEIGHBOR_COUNT + d]!;
      if (n >= 0) values[n] = values[n]! + v / 8;
      else kept += v / 8;
    }
    values[i] = values[i]! + kept;
  }
}

/**
 * Fills single-cell holes in the plates' reference rasters. The lat/long grid
 * samples a rotated plate unevenly, so some reference cells are never written;
 * left alone they surface later as speckles of ridge floor or of another plate.
 */
function fillPlateHoles(state: PlanetState): void {
  const { neighbors } = getTopology(state.grid);
  const n = state.grid.cellCount;
  const { fresh } = composeBuffers(state.grid, state.plates.length);
  fresh.fill(0);
  const seen = new Uint8Array(n);
  const holes: number[] = [];
  for (const plate of state.plates) {
    const { owned, elevation, type } = plate.crust;
    // Only unowned cells next to the plate can be holes; find them from the owned side.
    seen.fill(0);
    holes.length = 0;
    for (let i = 0; i < n; i++) {
      if (!owned[i]) continue;
      for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
        const nb = neighbors[i * NEIGHBOR_COUNT + d]!;
        if (nb >= 0 && !owned[nb] && !seen[nb]) {
          seen[nb] = 1;
          holes.push(nb);
        }
      }
    }
    // Decide all fills against the unfilled raster first, so fills cannot cascade.
    const fills: number[] = [];
    for (const i of holes) {
      // Sums and counts per crust type (index 0 = oceanic, 1 = continental).
      const sums = [0, 0];
      const counts = [0, 0];
      for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
        const nb = neighbors[i * NEIGHBOR_COUNT + d]!;
        if (nb < 0 || !owned[nb]) continue;
        sums[type[nb]!]! += elevation[nb]!;
        counts[type[nb]!]!++;
      }
      if (counts[0]! + counts[1]! < 3) continue;
      // Take the majority crust type and average only neighbours of that type, so a
      // continental hole next to deep ocean does not become an inland sea.
      const t = counts[1]! >= counts[0]! ? 1 : 0;
      fills.push(i, sums[t]! / counts[t]!, t);
    }
    for (let f = 0; f < fills.length; f += 3) {
      const i = fills[f]!;
      owned[i] = 1;
      elevation[i] = fills[f + 1]!;
      type[i] = fills[f + 2]!;
      fresh[plate.id * n + i] = 1;
    }
  }
}

interface ComposeBuffers {
  refs: Int32Array;
  visible: Uint8Array;
  winners: Int32Array;
  thickening: Float32Array;
  /** Elevation of every planet cell right after the last composition. */
  composed: Float32Array;
  /** Whether `refs` and `composed` describe the planet's current composition. */
  composedValid: boolean;
  /** fresh[k * n + r]: plate k's reference cell r was created by hole filling this step. */
  fresh: Uint8Array;
  /** Per plate and reference cell: summed elevation change and number of samples. */
  deltaSum: Float32Array;
  deltaCount: Uint16Array;
}

const bufferCache = new WeakMap<Grid, ComposeBuffers>();

/** Scratch arrays for composePlates, reused between steps to avoid large allocations. */
function composeBuffers(grid: Grid, plateCount: number): ComposeBuffers {
  const n = grid.cellCount;
  let buffers = bufferCache.get(grid);
  if (!buffers || buffers.refs.length !== n * plateCount) {
    buffers = {
      refs: new Int32Array(n * plateCount),
      visible: new Uint8Array(n * plateCount),
      winners: new Int32Array(n),
      thickening: new Float32Array(n),
      composed: new Float32Array(n),
      composedValid: false,
      fresh: new Uint8Array(n * plateCount),
      deltaSum: new Float32Array(n * plateCount),
      deltaCount: new Uint16Array(n * plateCount),
    };
    bufferCache.set(grid, buffers);
  }
  return buffers;
}

/**
 * Spherical cap containing all of a plate's crust in its current position, as
 * [centre x, y, z, cosine of the angular radius], or undefined for an empty
 * plate. The radius is padded by two cells so sampling at the edge is never cut.
 */
function boundingCap(grid: Grid, plate: Plate): [number, number, number, number] | undefined {
  const pos = grid.cellPosition;
  const owned = plate.crust.owned;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < owned.length; i++) {
    if (!owned[i]) continue;
    cx += pos[i * 3]!;
    cy += pos[i * 3 + 1]!;
    cz += pos[i * 3 + 2]!;
  }
  const len = Math.hypot(cx, cy, cz);
  if (len === 0) {
    // Empty plate, or crust spread evenly around the globe: no useful cap.
    return owned.some((v) => v === 1) ? [0, 0, 1, -2] : undefined;
  }
  cx /= len;
  cy /= len;
  cz /= len;
  let minDot = 1;
  for (let i = 0; i < owned.length; i++) {
    if (owned[i]) {
      minDot = Math.min(minDot, cx * pos[i * 3]! + cy * pos[i * 3 + 1]! + cz * pos[i * 3 + 2]!);
    }
  }
  const radius = Math.acos(Math.max(-1, Math.min(1, minDot))) + (2 * Math.PI) / grid.height;
  const m = plate.rotation;
  return [
    m[0]! * cx + m[1]! * cy + m[2]! * cz,
    m[3]! * cx + m[4]! * cy + m[5]! * cz,
    m[6]! * cx + m[7]! * cy + m[8]! * cz,
    radius >= Math.PI ? -2 : Math.cos(radius),
  ];
}

/** Whether plate a's crust at reference cell ra stays on top of plate b's crust at rb. */
function beats(a: Plate, ra: number, b: Plate, rb: number): boolean {
  const ta = a.crust.type[ra]!;
  const tb = b.crust.type[rb]!;
  if (ta !== tb) return ta === 1;
  if (ta === 1) return a.crust.elevation[ra]! > b.crust.elevation[rb]!;
  return a.id > b.id;
}

/** Young ocean floor relaxes towards abyssal depth; trenches and arcs are left alone. */
function coolOceanFloor(state: PlanetState, dtYears: number): void {
  const { elevation, crustType, upliftRate } = state.fields;
  const k = 1 - Math.exp(-dtYears / OCEAN_FLOOR_COOLING_TIME);
  for (let i = 0; i < elevation.length; i++) {
    const h = elevation[i]!;
    if (crustType[i] || upliftRate[i]! > 0 || h > -1500 || h <= ABYSSAL_DEPTH) continue;
    elevation[i] = h + (ABYSSAL_DEPTH - h) * k;
  }
}

/**
 * Gives every plate a new motion. If a plate slot is empty (its plate was fully
 * subducted), the largest plate splits in two along a random line.
 */
function reorganizePlates(state: PlanetState, rng: Rng): void {
  const sizes = state.plates.map((plate) => plate.crust.owned.reduce((sum, v) => sum + v, 0));
  const empty = sizes.indexOf(0);
  if (empty >= 0) {
    const largest = sizes.indexOf(Math.max(...sizes));
    splitPlate(state.grid, state.plates[largest]!, state.plates[empty]!, rng);
  }
  for (const plate of state.plates) randomizeMotion(plate, rng, state.grid.radius);
}

/** Moves the part of `source` nearer to one of two random cells of it into `target`. */
function splitPlate(grid: Grid, source: Plate, target: Plate, rng: Rng): void {
  const owned: number[] = [];
  source.crust.owned.forEach((v, i) => v && owned.push(i));
  const a = owned[rng.int(0, owned.length)]!;
  const b = owned[rng.int(0, owned.length)]!;
  if (a === b) return;
  target.rotation = [...source.rotation];
  target.crust.owned.fill(0);
  // Both plates share the same reference frame, so distances can be measured there.
  const pos = grid.cellPosition;
  const dot = (i: number, j: number) =>
    pos[i * 3]! * pos[j * 3]! +
    pos[i * 3 + 1]! * pos[j * 3 + 1]! +
    pos[i * 3 + 2]! * pos[j * 3 + 2]!;
  for (const i of owned) {
    if (dot(i, b) > dot(i, a)) {
      target.crust.owned[i] = 1;
      target.crust.elevation[i] = source.crust.elevation[i]!;
      target.crust.type[i] = source.crust.type[i]!;
      source.crust.owned[i] = 0;
    }
  }
}
