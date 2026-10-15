import type { SimComponent } from '../../core/component';
import { areaWeightedMean, getTopology, NEIGHBOR_COUNT, type Grid } from '../../core/grid';
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

/** Elevation of freshly formed ocean floor at a spreading ridge, in metres. */
const RIDGE_DEPTH = -2600;
/** E-folding time (years) for young ocean floor to cool and sink to abyssal depth. */
const OCEAN_FLOOR_COOLING_TIME = 60e6;
/** Elevation (m) added to the overriding plate per consumed cell of continental crust. */
const CONTINENTAL_COLLISION_UPLIFT = 500;
/** Elevation (m) added to the overriding plate per subducted cell of ocean floor (volcanic arcs). */
const SUBDUCTION_UPLIFT = 40;
/** Cap on cell-mean elevation (m); a ~300 km cell averages far below the highest peaks. */
const MAX_ELEVATION = 6500;
/** E-folding time (years) over which colliding continents bring both plates to a halt. */
const COLLISION_STALL_TIME = 30e6;
/** Years for a shelf cell to accrete into continent when crust is fully depleted. */
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
    runOneStep(state, dtYears, rng) {
      if (dtYears <= 0 || speedFactor <= 0) return;
      coolOceanFloor(state, dtYears);
      accreteContinents(state, dtYears, continentalFraction, rng);
      // Persist erosion, uplift etc. from the last step into the plates before moving them.
      writeBackToPlates(state);

      if (rng.next() < 1 - Math.exp(-dtYears / reorganizationInterval)) {
        reorganizePlates(state, rng);
      }
      for (const plate of state.plates) {
        rotatePlate(plate, plate.angularSpeed * speedFactor * dtYears);
      }
      fillPlateHoles(state);
      const collisions = composePlates(state, rng);
      for (const plate of state.plates) {
        if (collisions[plate.id]) plate.angularSpeed *= Math.exp(-dtYears / COLLISION_STALL_TIME);
      }
      updateUplift(state, maxUpliftRate);
    },
  };
}

function writeBackToPlates(state: PlanetState): void {
  const { grid, plates } = state;
  const { elevation, plateId, crustType } = state.fields;
  for (let i = 0; i < grid.cellCount; i++) {
    const plate = plates[plateId[i]!]!;
    const r = referenceCell(grid, plate, i);
    if (!plate.crust.owned[r]) continue;
    plate.crust.elevation[r] = elevation[i]!;
    plate.crust.type[r] = crustType[i]!;
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
  const shelfChance = 1 - Math.exp(-(dtYears / SHELF_ACCRETION_TIME) * deficit);

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
  // refs[d * plateCount + k]: reference cell of plate k currently over planet cell d.
  const refs = new Int32Array(n * plateCount);
  // visible[k * n + r]: plate k's reference cell r is on top somewhere. Several planet
  // cells can sample the same reference cell, so crust is only consumed if it is
  // hidden everywhere; otherwise plate edges would erode from resampling alone.
  const visible = new Uint8Array(plateCount * n);
  const winners = new Int32Array(n);

  for (let d = 0; d < n; d++) {
    let winner = -1;
    for (let k = 0; k < plateCount; k++) {
      const r = referenceCell(grid, plates[k]!, d);
      refs[d * plateCount + k] = r;
      if (!plates[k]!.crust.owned[r]) continue;
      if (winner < 0 || beats(plates[k]!, r, plates[winner]!, refs[d * plateCount + winner]!)) {
        winner = k;
      }
    }
    if (winner < 0) {
      // Divergence: new ocean floor joins the plate that was here before.
      winner = plateId[d]!;
      const crust = plates[winner]!.crust;
      const r = refs[d * plateCount + winner]!;
      crust.owned[r] = 1;
      crust.type[r] = 0;
      crust.elevation[r] = RIDGE_DEPTH + (rng.next() - 0.5) * 300;
    }
    winners[d] = winner;
    visible[winner * n + refs[d * plateCount + winner]!] = 1;
  }

  // Crust hidden under the winner is consumed and thickens the winner.
  const thickening = new Float32Array(n);
  for (let d = 0; d < n; d++) {
    const winner = winners[d]!;
    const top = plates[winner]!.crust;
    const topRef = refs[d * plateCount + winner]!;
    for (let k = 0; k < plateCount; k++) {
      const r = refs[d * plateCount + k]!;
      const crust = plates[k]!.crust;
      if (k === winner || !crust.owned[r] || visible[k * n + r]) continue;
      crust.owned[r] = 0;
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
  }
  spreadThickening(state, thickening);
  return collided;
}

/**
 * Adds collision thickening to the continental crust around each collision cell
 * (a third to the cell, the rest shared by its continental neighbours), so
 * mountain belts form instead of single-cell spikes. Isolated islands only get
 * their third, so they cannot grow into needles. The next write-back stores
 * the result in the plates.
 */
function spreadThickening(state: PlanetState, thickening: Float32Array): void {
  const { neighbors } = getTopology(state.grid);
  const { elevation, crustType } = state.fields;
  for (let d = 0; d < thickening.length; d++) {
    const amount = thickening[d]!;
    if (amount <= 0) continue;
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

/**
 * Fills single-cell holes in the plates' reference rasters. The lat/long grid
 * samples a rotated plate unevenly, so some reference cells are never written;
 * left alone they surface later as speckles of ridge floor or of another plate.
 */
function fillPlateHoles(state: PlanetState): void {
  const { neighbors } = getTopology(state.grid);
  for (const plate of state.plates) {
    const { owned, elevation, type } = plate.crust;
    for (let i = 0; i < owned.length; i++) {
      if (owned[i]) continue;
      let count = 0;
      let sum = 0;
      let continental = 0;
      for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
        const n = neighbors[i * NEIGHBOR_COUNT + d]!;
        if (n < 0 || !owned[n]) continue;
        count++;
        sum += elevation[n]!;
        continental += type[n]!;
      }
      if (count < 3) continue;
      owned[i] = 1;
      elevation[i] = sum / count;
      type[i] = continental * 2 >= count ? 1 : 0;
    }
  }
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
