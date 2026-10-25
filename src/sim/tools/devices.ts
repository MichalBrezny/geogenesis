import type { SimComponent } from '../core/component';
import { EARTH_RADIUS } from '../core/grid';
import { EARTH_SURFACE_GRAVITY, type PlanetState } from '../core/planet';
import { lifeClassIndex } from '../data/lifeClasses';
import { recordEvent } from '../events';
import { updateSurfacePressure } from '../models/atmosphere/atmosphere';
import { classSuitability } from '../models/biosphere/life';

/**
 * Terraforming devices after SimEarth: factories the player builds on the map that
 * keep working every year until an impact or an eruption destroys them.
 */
export type DeviceKind =
  'co2Generator' | 'n2Generator' | 'o2Generator' | 'co2Scrubber' | 'biomeFactory';

export interface Device {
  kind: DeviceKind;
  /** Grid cell the device stands on. */
  cell: number;
  placedYear: number;
}

export const DEVICE_KINDS: readonly DeviceKind[] = [
  'co2Generator',
  'n2Generator',
  'o2Generator',
  'co2Scrubber',
  'biomeFactory',
];

/**
 * Gas each device makes or removes, in bar per year on an Earth-sized planet. The
 * devices move a fixed mass of gas, so the pressure change scales with gravity and
 * inversely with the planet's surface area.
 */
export const CO2_GENERATOR_RATE = 1e-8;
export const N2_GENERATOR_RATE = 1e-8;
export const O2_GENERATOR_RATE = 1e-9;
/** Scrubbers fix CO₂ as carbonate rock, fast enough to strip Venus in tens of Myr. */
export const CO2_SCRUBBER_RATE = 5e-7;
/** CO₂ (µbar) at which scrubbers stop: pre-industrial Earth, enough for plants. */
export const CO2_SCRUBBER_FLOOR = 280;
/** Radius (m) around a biome factory that it plants, and the population it sows. */
const BIOME_FACTORY_RADIUS = 900_000;
const BIOME_FACTORY_POPULATION = 0.5;

/** Bar of gas per bar on an Earth-sized planet: column mass ∝ g, spread over 4πR². */
export function gasScale(state: PlanetState): number {
  const { surfaceGravity, radius } = state.planetParams;
  return (surfaceGravity / EARTH_SURFACE_GRAVITY) * (EARTH_RADIUS / radius) ** 2;
}

/** Builds a device on a cell; one device per cell. */
export function placeDevice(state: PlanetState, kind: DeviceKind, cell: number): boolean {
  if (state.devices.some((device) => device.cell === cell)) return false;
  state.devices.push({ kind, cell, placedYear: state.globals.year });
  return true;
}

/** Great-circle distance between two cells, in metres. */
function cellDistance(state: PlanetState, a: number, b: number): number {
  const p = state.grid.cellPosition;
  const dot = p[a * 3]! * p[b * 3]! + p[a * 3 + 1]! * p[b * 3 + 1]! + p[a * 3 + 2]! * p[b * 3 + 2]!;
  return Math.acos(Math.max(-1, Math.min(1, dot))) * state.grid.radius;
}

/** Destroys every device within `radius` metres of a cell (impacts, eruptions). */
export function destroyDevicesNear(state: PlanetState, cell: number, radius: number): void {
  if (state.devices.length === 0) return;
  const kept: Device[] = [];
  for (const device of state.devices) {
    if (cellDistance(state, device.cell, cell) <= radius) {
      recordEvent(state, 'deviceDestroyed', device.kind);
    } else {
      kept.push(device);
    }
  }
  state.devices = kept;
}

/** Adds oxygen as a partial pressure (bar); O₂ itself is stored as a volume fraction. */
function addOxygen(state: PlanetState, bar: number): void {
  const { globals } = state;
  const atmosphere = globals.atmosphere;
  const total = updateSurfacePressure(globals);
  const others = total * (1 - atmosphere.o2);
  const oxygen = total * atmosphere.o2 + bar;
  atmosphere.o2 = Math.min(0.95, oxygen / Math.max(1e-9, others + oxygen));
}

/** Sows land plants where they can grow around a biome factory. */
function sowPlants(state: PlanetState, factories: readonly Device[]): void {
  const plants = lifeClassIndex('plants');
  const suitability = classSuitability(state, plants);
  const n = state.grid.cellCount;
  const { populations, appeared } = state.biota;
  let sown = false;
  for (const factory of factories) {
    const row = Math.floor(factory.cell / state.grid.width);
    const rows = Math.ceil(BIOME_FACTORY_RADIUS / state.grid.dy) + 1;
    for (let y = Math.max(0, row - rows); y <= Math.min(state.grid.height - 1, row + rows); y++) {
      for (let x = 0; x < state.grid.width; x++) {
        const i = y * state.grid.width + x;
        if (suitability[i]! <= 0) continue;
        if (cellDistance(state, factory.cell, i) > BIOME_FACTORY_RADIUS) continue;
        const target = BIOME_FACTORY_POPULATION * suitability[i]!;
        if (populations[plants * n + i]! < target) {
          populations[plants * n + i] = target;
          sown = true;
        }
      }
    }
  }
  if (sown && appeared[plants] === null) {
    appeared[plants] = state.globals.year;
    recordEvent(state, 'classAppeared', 'plants');
  }
}

/** Runs the player's devices for the elapsed years. */
export const terraformDevices: SimComponent = {
  name: 'devices',
  inputs: [],
  outputs: [],
  runOneStep(state, dtYears) {
    if (state.devices.length === 0 || dtYears <= 0) return;
    const scale = gasScale(state) * dtYears;
    const count = (kind: DeviceKind) => state.devices.filter((d) => d.kind === kind).length;
    const atmosphere = state.globals.atmosphere;
    atmosphere.co2 += (count('co2Generator') * CO2_GENERATOR_RATE * scale) / 1e-6;
    atmosphere.n2 += count('n2Generator') * N2_GENERATOR_RATE * scale;
    const scrubbed = Math.min(
      Math.max(0, atmosphere.co2 - CO2_SCRUBBER_FLOOR) * 1e-6,
      count('co2Scrubber') * CO2_SCRUBBER_RATE * scale,
    );
    atmosphere.co2 -= scrubbed / 1e-6;
    state.globals.crustalCarbon += scrubbed;
    const oxygen = count('o2Generator') * O2_GENERATOR_RATE * scale;
    if (oxygen > 0) addOxygen(state, oxygen);
    updateSurfacePressure(state.globals);
    const factories = state.devices.filter((d) => d.kind === 'biomeFactory');
    if (factories.length > 0) sowPlants(state, factories);
  },
};
