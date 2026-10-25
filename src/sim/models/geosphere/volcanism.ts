import type { SimComponent } from '../../core/component';
import { areaWeightedMean, cellAt, getTopology, NEIGHBOR_COUNT } from '../../core/grid';
import type { LargeIgneousProvince, PlanetState, Plate } from '../../core/planet';
import type { Rng } from '../../core/rng';
import { recordEvent } from '../../events';
import { destroyDevicesNear } from '../../tools/devices';
import { HOTSPOT_SHARE, mantleHeat, tectonicActivity } from '../atmosphere/carbon';
import { addDustSource, DUST_SULFATE } from '../atmosphere/dust';
import { randomUnitVector } from './plates';

export { HOTSPOT_SHARE } from '../atmosphere/carbon';

/** Activity weights retain the established split of modern volcanic carbon sources. */
const REFERENCE_CONVERGENCE = 0.06;
/** Arc activity extends this far onto the overriding plate. */
const ARC_BAND_WIDTH = 250_000;
/** Mantle-plume melting is concentrated within this surface distance. */
const HOTSPOT_RADIUS = 180_000;
/** Cell-mean construction at the plume centre; 700 m/Myr before thermal subsidence. */
const HOTSPOT_BUILD_RATE = 7e-4;
const HOTSPOT_LIFETIME_MIN = 300e6;
const HOTSPOT_LIFETIME_RANGE = 500e6;
const HOTSPOT_BOOST_DECAY = 5e6;
/** VEI 6–7 recurrence on an Earth-like planet. */
const LARGE_ERUPTION_INTERVAL = 200;
/** A 1.5-year e-folding leaves substantial forcing through two post-eruption summers. */
const AEROSOL_EFOLDING_TIME = 1.5;
const MAX_AEROSOL_STEP = 10_000;
/**
 * Sulfate optical depth emitted per year by one active LIP: repeated large pulses
 * averaged to a steady source holding tau ~ 0.05 (about -1 W/m2; Deccan/Siberian
 * sulfur estimates, Schmidt et al. 2016). A steady source, so short and long steps agree.
 */
const LIP_DUST_RATE = 0.05 / 1.5;
/** Mean LIP recurrence; hotter young mantles shorten it through mantleHeat in the caller. */
const LIP_INTERVAL = 35e6;
const LIP_DURATION = 1e6;
/**
 * Extra outgassing of an active LIP, relative to the modern volcanic flux. It is a flux, not a
 * pulse, so the carbon cycle answers it the same way at any step length: a ~2.5× total flux
 * for a million years warms the planet by several degrees, like the Siberian Traps.
 */
const LIP_OUTGASSING = 1.5;
/** Long-term construction by repeated ordinary eruptions in active belts, m/yr. */
const ERUPTIVE_BUILD_RATE = 5e-7;
const MAX_CELL_MEAN_VOLCANIC_ELEVATION = 6500;

/** Surface velocity (m/yr) at a unit position. */
function velocity(plate: Plate, x: number, y: number, z: number, radius: number) {
  const s = plate.angularSpeed * radius;
  const [ax, ay, az] = plate.eulerPole;
  return [s * (ay * z - az * y), s * (az * x - ax * z), s * (ax * y - ay * x)] as const;
}

/**
 * Diagnoses arcs, ridges, continental rifts and mantle hotspots. Raw spatial
 * patterns are area-normalized so their global integral retains the prior carbon
 * calibration: 30% hotspot and 70% plate-speed-dependent activity.
 */
export const volcanicActivityModel: SimComponent = {
  name: 'volcanicActivity',
  inputs: ['elevation', 'plateId', 'crustType'],
  outputs: ['elevation', 'volcanicActivity'],
  runOneStep(state, dtYears, rng) {
    renewHotspots(state, dtYears, rng);
    const { grid, plates } = state;
    const { plateId, crustType, elevation, volcanicActivity } = state.fields;
    const { neighbors } = getTopology(grid);
    const position = grid.cellPosition;
    const arc = new Float32Array(grid.cellCount);
    const boundary = new Float32Array(grid.cellCount);

    // East and south faces only: each boundary segment is diagnosed once.
    for (let i = 0; i < grid.cellCount; i++) {
      for (const direction of [2, 4] as const) {
        const otherCell = neighbors[i * NEIGHBOR_COUNT + direction]!;
        if (otherCell < 0 || plateId[otherCell] === plateId[i]) continue;
        const a = plates[plateId[i]!]!;
        const b = plates[plateId[otherCell]!]!;
        if (!a || !b) continue;
        const p = i * 3;
        const q = otherCell * 3;
        const va = velocity(a, position[p]!, position[p + 1]!, position[p + 2]!, grid.radius);
        const vb = velocity(b, position[q]!, position[q + 1]!, position[q + 2]!, grid.radius);
        let dx = position[q]! - position[p]!;
        let dy = position[q + 1]! - position[p + 1]!;
        let dz = position[q + 2]! - position[p + 2]!;
        const length = Math.hypot(dx, dy, dz);
        dx /= length;
        dy /= length;
        dz /= length;
        const convergence = -((vb[0] - va[0]) * dx + (vb[1] - va[1]) * dy + (vb[2] - va[2]) * dz);
        const strength = Math.min(2, Math.abs(convergence) / REFERENCE_CONVERGENCE);
        if (convergence > 0) {
          // Subduction needs oceanic crust on the descending side. Continental crust,
          // or the higher stable id between two oceanic plates, is overriding.
          let overriding = -1;
          if (crustType[i] && !crustType[otherCell]) overriding = i;
          else if (!crustType[i] && crustType[otherCell]) overriding = otherCell;
          else if (!crustType[i] && !crustType[otherCell]) {
            overriding = plateId[i]! > plateId[otherCell]! ? i : otherCell;
          }
          if (overriding >= 0) arc[overriding] = Math.max(arc[overriding]!, strength);
        } else {
          // Divergent ocean floor is a ridge; continental sides are rifts and are
          // deliberately stronger per unit area because decompression melting is focused.
          const rift = crustType[i] || crustType[otherCell];
          const value = strength * (rift ? 1.4 : 1);
          boundary[i] = Math.max(boundary[i]!, value);
          boundary[otherCell] = Math.max(boundary[otherCell]!, value);
        }
      }
    }
    const arcBand = spreadWithinPlate(state, arc, ARC_BAND_WIDTH);
    for (let i = 0; i < boundary.length; i++) boundary[i] = Math.max(boundary[i]!, arcBand[i]!);

    const hotspot = hotspotPattern(state);
    const plateMean = areaWeightedMean(grid, boundary);
    const hotspotMean = areaWeightedMean(grid, hotspot);
    const plateTarget = (1 - HOTSPOT_SHARE) * tectonicActivity(state);
    const mantle = mantleHeat(state.globals.year, state.planetParams.radius);
    // A stagnant lid has plume volcanism only. It is less efficient than mobile
    // recycling and fades rapidly as the smaller/older mantle cools.
    const hotspotTarget =
      state.globals.tectonicRegime === 'stagnant'
        ? HOTSPOT_SHARE * 0.35 * mantle * mantle
        : HOTSPOT_SHARE * mantle;
    const boostDecay = Math.exp(-Math.max(0, dtYears) / HOTSPOT_BOOST_DECAY);
    for (let i = 0; i < volcanicActivity.length; i++) {
      state.geosphere.volcanicBoost[i] = state.geosphere.volcanicBoost[i]! * boostDecay;
      volcanicActivity[i] =
        (plateMean > 0 ? (boundary[i]! * plateTarget) / plateMean : 0) +
        (hotspotMean > 0 ? (hotspot[i]! * hotspotTarget) / hotspotMean : 0) +
        state.geosphere.volcanicBoost[i]!;
      if (dtYears > 0 && !crustType[i] && hotspot[i]! > 0.01) {
        elevation[i] = Math.min(
          state.globals.seaLevel + 2500,
          elevation[i]! + HOTSPOT_BUILD_RATE * Math.min(1, hotspot[i]!) * dtYears,
        );
      }
    }
  },
};

/** Eruptions, aerosol forcing and rare large igneous provinces. */
export const eruptionModel: SimComponent = {
  name: 'eruptions',
  inputs: ['volcanicActivity', 'elevation'],
  outputs: ['elevation'],
  runOneStep(state, dtYears, rng) {
    const dt = Math.max(0, dtYears);
    const { globals } = state;
    // The climate sees the step-mean forcing; the end value carries into the next step.
    // A 1.5-year pulse barely dents a 2000-year step's mean, however strong at its peak.
    const carried = globals.volcanicAerosolEnd;
    globals.volcanicAerosol = meanAerosol(carried, dt);
    globals.volcanicAerosolEnd = decayAerosol(carried, dt);
    if (dt === 0) return;

    const meanActivity = areaWeightedMean(state.grid, state.fields.volcanicActivity);
    // On geological steps aggregate the innumerable small edifices deterministically.
    if (dt >= 1_000) {
      const { elevation, volcanicActivity } = state.fields;
      for (let i = 0; i < elevation.length; i++) {
        if (elevation[i]! >= MAX_CELL_MEAN_VOLCANIC_ELEVATION) continue;
        elevation[i] = Math.min(
          MAX_CELL_MEAN_VOLCANIC_ELEVATION,
          elevation[i]! + ERUPTIVE_BUILD_RATE * Math.min(5, volcanicActivity[i]!) * dt,
        );
      }
    }

    // Aerosols only matter when the time step resolves their roughly annual lifetime.
    if (dt <= MAX_AEROSOL_STEP) {
      const count = samplePoisson((dt / LARGE_ERUPTION_INTERVAL) * meanActivity, rng);
      if (count > 0) {
        const pulse = count * (1.5 + rng.next() * 1.5);
        // The eruptions of one step are lumped into one pulse at a random time in it.
        const remaining = dt * (1 - rng.next());
        globals.volcanicAerosol += (meanAerosol(pulse, remaining) * remaining) / dt;
        globals.volcanicAerosolEnd += decayAerosol(pulse, remaining);
        const cell = weightedActivityCell(state, rng);
        recordEvent(state, 'largeEruption', formatLocation(state, cell), state.globals.year, cell);
        destroyDevicesNear(state, cell, ERUPTION_DEVICE_RADIUS);
      }
    }

    createLips(state, dt, meanActivity, rng);
    releaseLipCarbon(state, dt);
  },
};

/** Exact exponential aerosol decay, independent of step partitioning. */
export function decayAerosol(forcing: number, dtYears: number): number {
  return forcing * Math.exp(-Math.max(0, dtYears) / AEROSOL_EFOLDING_TIME);
}

/** Mean of a decaying aerosol forcing over the next `dtYears` (its value when dt = 0). */
export function meanAerosol(forcing: number, dtYears: number): number {
  if (dtYears <= 0) return forcing;
  return (
    (forcing * AEROSOL_EFOLDING_TIME * -Math.expm1(-dtYears / AEROSOL_EFOLDING_TIME)) / dtYears
  );
}

/** Poisson count with a bounded-cost normal approximation for very large means. */
export function samplePoisson(mean: number, rng: Rng): number {
  if (!(mean > 0)) return 0;
  if (mean < 30) {
    const limit = Math.exp(-mean);
    let product = 1;
    let count = 0;
    do {
      count++;
      product *= rng.next();
    } while (product > limit);
    return count - 1;
  }
  const u1 = Math.max(Number.EPSILON, rng.next());
  const u2 = rng.next();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal));
}

function renewHotspots(state: PlanetState, dtYears: number, rng: Rng): void {
  const endYear = state.globals.year + Math.max(0, dtYears);
  for (const hotspot of state.geosphere.hotspots) {
    while (hotspot.deathYear <= endYear) {
      hotspot.position = randomUnitVector(rng);
      hotspot.birthYear = hotspot.deathYear;
      hotspot.deathYear += HOTSPOT_LIFETIME_MIN + rng.next() * HOTSPOT_LIFETIME_RANGE;
      hotspot.strength = 0.7 + rng.next() * 0.6;
    }
  }
}

function hotspotPattern(state: PlanetState): Float32Array {
  const { grid } = state;
  const out = new Float32Array(grid.cellCount);
  const positions = grid.cellPosition;
  const sigma = HOTSPOT_RADIUS / grid.radius;
  for (const hotspot of state.geosphere.hotspots) {
    const [hx, hy, hz] = hotspot.position;
    for (let i = 0; i < grid.cellCount; i++) {
      const dot = Math.max(
        -1,
        Math.min(
          1,
          hx * positions[i * 3]! + hy * positions[i * 3 + 1]! + hz * positions[i * 3 + 2]!,
        ),
      );
      const distance = Math.acos(dot);
      if (distance > sigma * 3) continue;
      out[i] = out[i]! + hotspot.strength * Math.exp(-(distance * distance) / (2 * sigma * sigma));
    }
    // A plume never vanishes merely because a coarse cell centre misses its narrow Gaussian.
    const nearest = cellAt(grid, hx, hy, hz);
    out[nearest] = Math.max(out[nearest]!, hotspot.strength);
  }
  return out;
}

/** Dijkstra band in metres, restricted to the source cell's overriding plate. */
function spreadWithinPlate(state: PlanetState, source: Float32Array, width: number): Float32Array {
  const { grid } = state;
  const { neighbors, rowDistance } = getTopology(grid);
  const ids = state.fields.plateId;
  const out = Float32Array.from(source);
  const distance = new Float64Array(grid.cellCount).fill(Infinity);
  const queue = new DistanceHeap();
  for (let i = 0; i < source.length; i++) {
    if (source[i]! > 0) {
      distance[i] = 0;
      queue.push(i, 0);
    }
  }
  while (queue.size > 0) {
    const [cell, d0] = queue.pop();
    if (d0 !== distance[cell]) continue;
    const row = Math.floor(cell / grid.width);
    for (let direction = 0; direction < NEIGHBOR_COUNT; direction++) {
      const neighbor = neighbors[cell * NEIGHBOR_COUNT + direction]!;
      if (neighbor < 0 || ids[neighbor] !== ids[cell]) continue;
      const next = d0 + rowDistance[row * NEIGHBOR_COUNT + direction]!;
      if (next > width || next >= distance[neighbor]!) continue;
      distance[neighbor] = next;
      out[neighbor] = Math.max(
        out[neighbor]!,
        out[cell]! * Math.exp(-rowDistance[row * NEIGHBOR_COUNT + direction]! / width),
      );
      queue.push(neighbor, next);
    }
  }
  return out;
}

class DistanceHeap {
  private cells: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  push(cell: number, key: number): void {
    let index = this.cells.length;
    this.cells.push(cell);
    this.keys.push(key);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.keys[parent]! <= key) break;
      this.cells[index] = this.cells[parent]!;
      this.keys[index] = this.keys[parent]!;
      index = parent;
    }
    this.cells[index] = cell;
    this.keys[index] = key;
  }

  pop(): [number, number] {
    const result: [number, number] = [this.cells[0]!, this.keys[0]!];
    const cell = this.cells.pop()!;
    const key = this.keys.pop()!;
    if (this.cells.length === 0) return result;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.cells.length) break;
      const right = left + 1;
      const child =
        right < this.cells.length && this.keys[right]! < this.keys[left]! ? right : left;
      if (this.keys[child]! >= key) break;
      this.cells[index] = this.cells[child]!;
      this.keys[index] = this.keys[child]!;
      index = child;
    }
    this.cells[index] = cell;
    this.keys[index] = key;
    return result;
  }
}

function weightedActivityCell(state: PlanetState, rng: Rng): number {
  const activity = state.fields.volcanicActivity;
  let total = 0;
  for (let y = 0; y < state.grid.height; y++) {
    const area = state.grid.rowCellArea[y]!;
    for (let x = 0; x < state.grid.width; x++) total += activity[y * state.grid.width + x]! * area;
  }
  if (total <= 0) return rng.int(0, state.grid.cellCount);
  let pick = rng.next() * total;
  for (let y = 0; y < state.grid.height; y++) {
    const area = state.grid.rowCellArea[y]!;
    for (let x = 0; x < state.grid.width; x++) {
      const i = y * state.grid.width + x;
      pick -= activity[i]! * area;
      if (pick <= 0) return i;
    }
  }
  return activity.length - 1;
}

/** Radii (m) within which a large eruption or a flood-basalt province destroys devices. */
const ERUPTION_DEVICE_RADIUS = 300_000;
const LIP_DEVICE_RADIUS = 1_000_000;

function createLips(state: PlanetState, dt: number, activity: number, rng: Rng): void {
  // The spatial activity already includes hotter-mantle plate and hotspot scaling;
  // cap it so pathological player boosts cannot spam LIPs.
  const expected = (dt / LIP_INTERVAL) * Math.max(0.25, Math.min(3, activity));
  const count = samplePoisson(expected, rng);
  const start = state.globals.year;
  for (let n = 0; n < count; n++) {
    const cell = weightedActivityCell(state, rng);
    const p = state.grid.cellPosition;
    const startYear = start + rng.next() * dt;
    const lip: LargeIgneousProvince = {
      id: state.geosphere.nextLipId++,
      position: [p[cell * 3]!, p[cell * 3 + 1]!, p[cell * 3 + 2]!],
      startYear,
      endYear: startYear + LIP_DURATION,
      outgassing: LIP_OUTGASSING,
    };
    state.geosphere.activeLips.push(lip);
    state.geosphere.lipCount++;
    recordEvent(
      state,
      'largeIgneousProvince',
      `LIP-${lip.id} · ${formatLocation(state, cell)}`,
      startYear,
      cell,
    );
    destroyDevicesNear(state, cell, LIP_DEVICE_RADIUS);
  }
}

/** Time-averaged LIP outgassing over this step, for the carbon cycle; retires finished LIPs. */
function releaseLipCarbon(state: PlanetState, dt: number): void {
  const start = state.globals.year;
  const end = start + dt;
  let flux = 0;
  for (const lip of state.geosphere.activeLips) {
    const overlap = Math.min(end, lip.endYear) - Math.max(start, lip.startYear);
    if (overlap > 0 && dt > 0) {
      flux += (lip.outgassing * overlap) / dt;
      const from = Math.max(start, lip.startYear);
      addDustSource(state, DUST_SULFATE, LIP_DUST_RATE * overlap, from, from + overlap);
    }
  }
  state.globals.lipOutgassing = flux;
  state.geosphere.activeLips = state.geosphere.activeLips.filter((lip) => lip.endYear > end);
}

function formatLocation(state: PlanetState, cell: number): string {
  const row = Math.floor(cell / state.grid.width);
  const column = cell % state.grid.width;
  const latitude = state.grid.rowLatitude[row]!;
  const longitude = ((column + 0.5) * 360) / state.grid.width;
  const lat = `${Math.abs(latitude).toFixed(0)}°${latitude >= 0 ? 'N' : 'S'}`;
  const lon = longitude <= 180 ? `${longitude.toFixed(0)}°E` : `${(360 - longitude).toFixed(0)}°W`;
  return `${lat}, ${lon}`;
}
