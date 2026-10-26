import type { SimComponent } from '../core/component';
import { getTopology, NEIGHBOR_COUNT } from '../core/grid';
import type { PlanetState, Plate } from '../core/planet';
import { createRng, type Rng } from '../core/rng';
import { recordEvent } from '../events';
import { addDustSource, DUST_FINE } from './atmosphere/dust';
import { aridityIndex } from './biosphere/biomes';

/** Spatial hazards are refreshed this often; mortality is still integrated every step. */
export const HAZARD_REFRESH_YEARS = 1_000;
/** Shaking footprint grows approximately exponentially with moment magnitude. */
export function earthquakeDamageRadius(magnitude: number): number {
  return 45_000 * 10 ** (0.38 * Math.max(0, magnitude - 5));
}

const QUAKE_DAMAGE_DISTANCE = earthquakeDamageRadius(8);
const TSUNAMI_REACH = 3_000_000;
const TSUNAMI_MAX_ELEVATION = 50;
const CYCLONE_INLAND_SCALE = 300_000;
const CYCLONE_SEARCH_DISTANCE = 900_000;
const CYCLONE_MIN_SST = 26.5;
/** At maximum global source strength, tau approaches 0.006 with the 0.3-year dust lifetime. */
const DUST_INJECTION_RATE = 0.02;

const PROTECTION = [0, 0.08, 0.18, 0.45, 0.65, 0.78, 0.88] as const;

interface HazardCache {
  year: number;
  settings: string;
  earthquake: Float32Array;
  tsunami: Float32Array;
  cyclone: Float32Array;
  drought: Float32Array;
  mortality: Float32Array;
  dustSource: number;
}

const cacheByPlanet = new WeakMap<PlanetState, HazardCache>();

function settingsKey(state: PlanetState): string {
  const d = state.disasters;
  return `${+d.earthquakes}${+d.tsunamis}${+d.cyclones}${+d.droughts}${+d.dustStorms}`;
}

function localDisastersEnabled(state: PlanetState): boolean {
  const d = state.disasters;
  return d.earthquakes || d.tsunamis || d.cyclones || d.droughts || d.dustStorms;
}

/** Plate velocity at one surface position, in metres per year. */
function plateVelocity(
  plate: Plate,
  x: number,
  y: number,
  z: number,
  radius: number,
): readonly [number, number, number] {
  const s = plate.angularSpeed * radius;
  const [ax, ay, az] = plate.eulerPole;
  return [s * (ay * z - az * y), s * (az * x - ax * z), s * (ax * y - ay * x)];
}

interface BoundaryHazards {
  earthquake: Float32Array;
  submarineConvergence: Float32Array;
}

/** Annual earthquake mortality hazard, before technology protection. */
export function earthquakeHazardRates(state: PlanetState): Float32Array {
  return boundaryHazards(state).earthquake;
}

function boundaryHazards(state: PlanetState): BoundaryHazards {
  const { grid, plates } = state;
  const { plateId, elevation } = state.fields;
  const { neighbors } = getTopology(grid);
  const positions = grid.cellPosition;
  const source = new Float32Array(grid.cellCount);
  const submarineConvergence = new Float32Array(grid.cellCount);

  for (let i = 0; i < grid.cellCount; i++) {
    const a = plates[plateId[i]!] as Plate | undefined;
    if (!a) continue;
    const p = i * 3;
    const va = plateVelocity(a, positions[p]!, positions[p + 1]!, positions[p + 2]!, grid.radius);
    // East and south faces diagnose every boundary once. Write the result to
    // both sides so no second all-neighbour plate comparison is necessary.
    for (const direction of [2, 4] as const) {
      const j = neighbors[i * NEIGHBOR_COUNT + direction]!;
      if (j < 0 || plateId[j] === plateId[i]) continue;
      const b = plates[plateId[j]!] as Plate | undefined;
      if (!b) continue;
      const q = j * 3;
      const vb = plateVelocity(b, positions[q]!, positions[q + 1]!, positions[q + 2]!, grid.radius);
      let dx = positions[q]! - positions[p]!;
      let dy = positions[q + 1]! - positions[p + 1]!;
      let dz = positions[q + 2]! - positions[p + 2]!;
      const length = Math.hypot(dx, dy, dz) || 1;
      dx /= length;
      dy /= length;
      dz /= length;
      const rvx = vb[0] - va[0];
      const rvy = vb[1] - va[1];
      const rvz = vb[2] - va[2];
      const speed = Math.hypot(rvx, rvy, rvz);
      const convergence = -(rvx * dx + rvy * dy + rvz * dz);
      // Convergent margins dominate seismic energy; transform margins remain much
      // more active than ridges. Relative plate speed scales every class.
      const kind = convergence > speed * 0.2 ? 10 : convergence < -speed * 0.2 ? 1 : 3;
      const rate = 5e-7 * kind * Math.min(3, speed / 0.05);
      source[i] = Math.max(source[i]!, rate);
      source[j] = Math.max(source[j]!, rate);
      if (
        kind === 10 &&
        (elevation[i]! < state.globals.seaLevel || elevation[j]! < state.globals.seaLevel)
      ) {
        submarineConvergence[i] = Math.max(submarineConvergence[i]!, rate);
        submarineConvergence[j] = Math.max(submarineConvergence[j]!, rate);
      }
    }
  }

  return {
    earthquake: spreadMaximum(state, source, QUAKE_DAMAGE_DISTANCE),
    submarineConvergence,
  };
}

/** Cheap physical-distance dilation for the finite damage radius of large quakes. */
function spreadMaximum(state: PlanetState, source: Float32Array, distance: number): Float32Array {
  const { grid } = state;
  const { neighbors, rowDistance } = getTopology(grid);
  const result = Float32Array.from(source);
  for (let i = 0; i < source.length; i++) {
    if (source[i]! > 0) continue;
    const row = Math.floor(i / grid.width);
    for (let direction = 0; direction < NEIGHBOR_COUNT; direction++) {
      const j = neighbors[i * NEIGHBOR_COUNT + direction]!;
      if (j < 0 || source[j]! <= 0) continue;
      const carried =
        source[j]! * Math.exp(-rowDistance[row * NEIGHBOR_COUNT + direction]! / distance);
      if (carried > result[i]!) result[i] = carried;
    }
  }
  return result;
}

function isLowCoast(state: PlanetState, cell: number): boolean {
  const elevation = state.fields.elevation[cell]!;
  if (
    elevation < state.globals.seaLevel ||
    elevation - state.globals.seaLevel > TSUNAMI_MAX_ELEVATION
  )
    return false;
  const { neighbors } = getTopology(state.grid);
  for (let direction = 0; direction < NEIGHBOR_COUNT; direction++) {
    const neighbor = neighbors[cell * NEIGHBOR_COUNT + direction]!;
    if (neighbor >= 0 && state.fields.elevation[neighbor]! < state.globals.seaLevel) return true;
  }
  return false;
}

function tsunamiHazardRates(state: PlanetState, source: Float32Array): Float32Array {
  const { grid } = state;
  const { neighbors, rowDistance } = getTopology(grid);
  const result = new Float32Array(grid.cellCount);
  for (let i = 0; i < grid.cellCount; i++) {
    if (!isLowCoast(state, i)) continue;
    for (let direction = 0; direction < NEIGHBOR_COUNT; direction++) {
      let cell = i;
      let distance = 0;
      while (distance < TSUNAMI_REACH) {
        const row = Math.floor(cell / grid.width);
        const next = neighbors[cell * NEIGHBOR_COUNT + direction]!;
        if (next < 0 || state.fields.elevation[next]! >= state.globals.seaLevel) break;
        distance += rowDistance[row * NEIGHBOR_COUNT + direction]!;
        cell = next;
        const rate = source[cell]! * 7 * Math.exp(-distance / 1_500_000);
        if (rate > result[i]!) result[i] = rate;
      }
    }
  }
  return result;
}

/** Annual cyclone mortality hazard; warm tropical seas seed it and inland distance damps it. */
export function cycloneHazardRates(state: PlanetState): Float32Array {
  const { grid, fields, globals } = state;
  const { neighbors, rowDistance } = getTopology(grid);
  const out = new Float32Array(grid.cellCount);
  const genesis = new Float32Array(grid.cellCount);
  for (let i = 0; i < grid.cellCount; i++) {
    if (fields.elevation[i]! >= globals.seaLevel) continue;
    const row = Math.floor(i / grid.width);
    const latitude = Math.abs(grid.rowLatitude[row]!);
    const sst = fields.airTemperature[i]! + fields.oceanAnomaly[i]!;
    if (latitude < 5 || latitude > 30 || sst <= CYCLONE_MIN_SST) continue;
    genesis[i] = Math.min(2.5, 1 + (sst - CYCLONE_MIN_SST) / 8);
    out[i] = 4e-6 * genesis[i]!;
  }

  for (let i = 0; i < grid.cellCount; i++) {
    if (fields.elevation[i]! < globals.seaLevel) continue;
    const row = Math.floor(i / grid.width);
    if (Math.abs(grid.rowLatitude[row]!) > 40) continue;
    const localTrack = Math.atan2(fields.windU[i]!, fields.windV[i]!);
    const downwind = ((Math.round((localTrack * 4) / Math.PI) % 8) + 8) % 8;
    const upwind = (downwind + 4) % 8;
    for (const direction of [(upwind + 7) % 8, upwind, (upwind + 1) % 8]) {
      let cell = i;
      let distance = 0;
      while (distance < CYCLONE_SEARCH_DISTANCE) {
        const row = Math.floor(cell / grid.width);
        const next = neighbors[cell * NEIGHBOR_COUNT + direction]!;
        if (next < 0) break;
        const edge = rowDistance[row * NEIGHBOR_COUNT + direction]!;
        distance += edge;
        cell = next;
        if (fields.elevation[cell]! >= globals.seaLevel) continue;
        const strength = genesis[cell]!;
        if (strength <= 0) break;
        const wind = Math.hypot(fields.windU[cell]!, fields.windV[cell]!);
        // Direction is clockwise from north. From the sea back towards the land is
        // the opposite of this land-to-sea ray.
        const theta = (((direction + 4) % 8) * Math.PI) / 4;
        const alongTrack =
          wind > 0
            ? Math.max(
                0,
                (fields.windU[cell]! * Math.sin(theta) + fields.windV[cell]! * Math.cos(theta)) /
                  wind,
              )
            : 0;
        const coastDistance = Math.max(0, distance - edge * 0.5);
        const rate =
          2e-5 *
          strength *
          (0.25 + 0.75 * alongTrack) *
          Math.exp(-coastDistance / CYCLONE_INLAND_SCALE);
        if (rate > out[i]!) out[i] = rate;
        break;
      }
    }
  }
  return out;
}

/** 0..1 exposure of semi-arid, seasonal land to recurring drought. */
export function droughtPropensityAt(state: PlanetState, cell: number): number {
  const f = state.fields;
  if (f.elevation[cell]! < state.globals.seaLevel) return 0;
  const aridity = aridityIndex(f.precipitation[cell]!, f.airTemperature[cell]!);
  if (!Number.isFinite(aridity) || aridity < 0.12 || aridity > 0.85) return 0;
  const dryBand = Math.max(0, 1 - Math.abs(aridity - 0.42) / 0.38);
  const seasonality = Math.min(1, 0.3 + f.seasonalAmplitude[cell]! / 22);
  return dryBand * seasonality;
}

/** Food capacity multiplier used by civilization while droughts are enabled. */
export function droughtFoodMultiplier(state: PlanetState, cell: number): number {
  return state.disasters.droughts ? 1 - 0.35 * droughtPropensityAt(state, cell) : 1;
}

function dustStormPropensity(state: PlanetState, cell: number): number {
  const f = state.fields;
  if (f.elevation[cell]! < state.globals.seaLevel) return 0;
  const aridity = aridityIndex(f.precipitation[cell]!, f.airTemperature[cell]!);
  if (!Number.isFinite(aridity) || aridity >= 0.3) return 0;
  const dryness = Math.max(0, Math.min(1, (0.3 - aridity) / 0.3));
  const bare = Math.max(0, Math.min(1, 1 - f.vegetation[cell]!));
  const wind = Math.min(1, Math.hypot(f.windU[cell]!, f.windV[cell]!) / 12);
  return dryness * bare * wind;
}

function calculateHazards(state: PlanetState): HazardCache {
  const boundary =
    state.disasters.earthquakes || state.disasters.tsunamis
      ? boundaryHazards(state)
      : {
          earthquake: new Float32Array(state.grid.cellCount),
          submarineConvergence: new Float32Array(state.grid.cellCount),
        };
  const earthquake = state.disasters.earthquakes
    ? boundary.earthquake
    : new Float32Array(state.grid.cellCount);
  const tsunami = state.disasters.tsunamis
    ? tsunamiHazardRates(state, boundary.submarineConvergence)
    : new Float32Array(state.grid.cellCount);
  const cyclone = state.disasters.cyclones
    ? cycloneHazardRates(state)
    : new Float32Array(state.grid.cellCount);
  const drought = new Float32Array(state.grid.cellCount);
  const mortality = new Float32Array(state.grid.cellCount);
  let dustSource = 0;
  for (let y = 0; y < state.grid.height; y++) {
    const areaWeight = state.grid.rowAreaWeight[y]!;
    const row = y * state.grid.width;
    for (let x = 0; x < state.grid.width; x++) {
      const i = row + x;
      if (state.disasters.droughts) drought[i] = droughtPropensityAt(state, i);
      mortality[i] = earthquake[i]! + tsunami[i]! + cyclone[i]!;
      state.fields.hazard[i] = Math.min(
        1,
        mortality[i]! * 10_000 + (state.disasters.droughts ? drought[i]! * 0.25 : 0),
      );
      if (state.disasters.dustStorms) {
        dustSource += dustStormPropensity(state, i) * areaWeight;
      }
    }
  }
  return {
    year: state.globals.year,
    settings: settingsKey(state),
    earthquake,
    tsunami,
    cyclone,
    drought,
    mortality,
    dustSource,
  };
}

function hazardsFor(state: PlanetState): HazardCache {
  const old = cacheByPlanet.get(state);
  const key = settingsKey(state);
  // Refresh on fixed boundaries of simulated time, not relative to the last refresh,
  // so a loaded game rebuilds its cache on the same schedule as an uninterrupted one.
  const bucket = Math.floor(state.globals.year / HAZARD_REFRESH_YEARS);
  if (old && old.settings === key && Math.floor(old.year / HAZARD_REFRESH_YEARS) === bucket) {
    return old;
  }
  const next = calculateHazards(state);
  cacheByPlanet.set(state, next);
  return next;
}

/** Exponential mortality makes the result independent of how a duration is partitioned. */
export function applyDisasterMortality(
  state: PlanetState,
  annualRates: ArrayLike<number>,
  dtYears: number,
): void {
  const protection =
    PROTECTION[Math.max(0, Math.min(PROTECTION.length - 1, state.civilization.age))]!;
  const density = state.fields.civilization;
  for (let i = 0; i < density.length; i++) {
    if (density[i]! <= 0 || annualRates[i]! <= 0) continue;
    density[i] = density[i]! * Math.exp(-annualRates[i]! * (1 - protection) * dtYears);
  }
}

/** Gutenberg-Richter sample with b = 1, truncated at the largest plausible event. */
export function sampleEarthquakeMagnitude(rng: Rng, minimum = 5): number {
  return Math.min(9.5, minimum - Math.log10(Math.max(Number.EPSILON, 1 - rng.next())));
}

function weightedSettledCell(state: PlanetState, rates: ArrayLike<number>, rng: Rng): number {
  let total = 0;
  for (let i = 0; i < state.grid.cellCount; i++) {
    total += state.fields.civilization[i]! * rates[i]!;
  }
  if (!(total > 0)) return -1;
  let pick = rng.next() * total;
  for (let i = 0; i < state.grid.cellCount; i++) {
    pick -= state.fields.civilization[i]! * rates[i]!;
    if (pick <= 0) return i;
  }
  return state.grid.cellCount - 1;
}

function recordNotableEvents(state: PlanetState, cache: HazardCache, dt: number, rng: Rng): void {
  let remaining = 3;
  const attempt = (
    enabled: boolean,
    rates: ArrayLike<number>,
    interval: number,
    key: 'earthquake' | 'tsunami' | 'cyclone',
    subject?: () => string,
  ) => {
    if (!enabled || remaining <= 0) return;
    const cell = weightedSettledCell(state, rates, rng);
    if (cell < 0 || rng.next() >= -Math.expm1(-dt / interval)) return;
    recordEvent(state, key, subject?.(), state.globals.year + rng.next() * dt, cell);
    remaining--;
  };
  attempt(state.disasters.earthquakes, cache.earthquake, 250, 'earthquake', () => {
    const magnitude = sampleEarthquakeMagnitude(rng, 8);
    return `M ${magnitude.toFixed(1)}`;
  });
  attempt(state.disasters.tsunamis, cache.tsunami, 120, 'tsunami');
  attempt(state.disasters.cyclones, cache.cyclone, 50, 'cyclone');
  if (state.disasters.droughts && remaining > 0) {
    let population = 0;
    let exposed = 0;
    for (let i = 0; i < state.grid.cellCount; i++) {
      const density = state.fields.civilization[i]!;
      population += density;
      exposed += density * cache.drought[i]!;
    }
    if (population > 0 && exposed / population > 0.2 && rng.next() < -Math.expm1(-dt / 80)) {
      const cell = weightedSettledCell(state, cache.drought, rng);
      if (cell >= 0)
        recordEvent(state, 'drought', undefined, state.globals.year + rng.next() * dt, cell);
    }
  }
}

/** Natural-disaster rates, civilization damage, drought exposure and aeolian dust. */
export const disasterModel: SimComponent = {
  name: 'disasters',
  inputs: [
    'elevation',
    'plateId',
    'airTemperature',
    'seasonalAmplitude',
    'precipitation',
    'windU',
    'windV',
    'oceanAnomaly',
    'vegetation',
    'civilization',
  ],
  outputs: ['hazard', 'civilization'],
  runOneStep(state, dtYears) {
    // No civilization means no people at risk and no expensive spatial work. This
    // keeps geological-era steps bit-neutral apart from the new zero field.
    if (state.civilization.species === null || !localDisastersEnabled(state)) {
      state.fields.hazard.fill(0);
      return;
    }
    const cache = hazardsFor(state);
    const dt = Math.max(0, dtYears);
    if (dt <= 0) return;
    applyDisasterMortality(state, cache.mortality, dt);
    if (state.disasters.dustStorms && cache.dustSource > 0) {
      addDustSource(
        state,
        DUST_FINE,
        cache.dustSource * DUST_INJECTION_RATE * dt,
        state.globals.year,
        state.globals.year + dt,
      );
    }
    const rng = createRng(state.disasterRngState);
    recordNotableEvents(state, cache, dt, rng);
    state.disasterRngState = rng.state;
  },
};

/** Immediate tsunami from an ocean source, used by natural impacts and the player tool. */
export function strikeTsunami(
  state: PlanetState,
  source: number,
  strength = 1,
  record = true,
): boolean {
  if (state.fields.elevation[source]! >= state.globals.seaLevel) return false;
  const p = state.grid.cellPosition;
  const sx = p[source * 3]!;
  const sy = p[source * 3 + 1]!;
  const sz = p[source * 3 + 2]!;
  let struck = false;
  let eventCell = -1;
  let eventDensity = 0;
  for (let i = 0; i < state.grid.cellCount; i++) {
    if (!isLowCoast(state, i)) continue;
    const dot = Math.max(-1, Math.min(1, sx * p[i * 3]! + sy * p[i * 3 + 1]! + sz * p[i * 3 + 2]!));
    const distance = Math.acos(dot) * state.grid.radius;
    if (distance > TSUNAMI_REACH) continue;
    const damage = Math.min(0.9, 0.55 * strength * Math.exp(-distance / 1_500_000));
    if (damage <= 0) continue;
    state.fields.civilization[i] = state.fields.civilization[i]! * (1 - damage);
    if (state.fields.civilization[i]! > eventDensity) {
      eventDensity = state.fields.civilization[i]!;
      eventCell = i;
    }
    struck = true;
  }
  if (record && eventCell >= 0)
    recordEvent(state, 'tsunami', undefined, state.globals.year, eventCell);
  return struck;
}

/** Radial quake damage shared by natural/tool-directed earthquakes. */
export function damageCivilizationNear(
  state: PlanetState,
  centre: number,
  radius: number,
  peakDamage: number,
): void {
  const p = state.grid.cellPosition;
  const cx = p[centre * 3]!;
  const cy = p[centre * 3 + 1]!;
  const cz = p[centre * 3 + 2]!;
  for (let i = 0; i < state.grid.cellCount; i++) {
    if (state.fields.civilization[i]! <= 0) continue;
    const dot = Math.max(-1, Math.min(1, cx * p[i * 3]! + cy * p[i * 3 + 1]! + cz * p[i * 3 + 2]!));
    const distance = Math.acos(dot) * state.grid.radius;
    if (distance >= radius) continue;
    state.fields.civilization[i] =
      state.fields.civilization[i]! * (1 - peakDamage * (1 - distance / radius));
  }
}

/** Short player-created cyclone track following the local surface wind. */
export function strikeCyclone(state: PlanetState, centre: number): boolean {
  const { grid, fields } = state;
  const { neighbors } = getTopology(grid);
  const coastalOrSea =
    fields.elevation[centre]! < state.globals.seaLevel ||
    Array.from({ length: NEIGHBOR_COUNT }, (_, d) => neighbors[centre * NEIGHBOR_COUNT + d]!).some(
      (i) => i >= 0 && fields.elevation[i]! < state.globals.seaLevel,
    );
  if (!coastalOrSea) return false;
  let cell = centre;
  for (let step = 0; step < 5; step++) {
    damageCivilizationNear(state, cell, 350_000, 0.3 * (1 - step / 7));
    const angle = Math.atan2(fields.windU[cell]!, fields.windV[cell]!);
    const direction = ((Math.round((angle * 4) / Math.PI) % 8) + 8) % 8;
    const next = neighbors[cell * NEIGHBOR_COUNT + direction]!;
    if (next < 0) break;
    cell = next;
  }
  recordEvent(state, 'cyclone', undefined, state.globals.year, centre);
  return true;
}
