import type { SimComponent } from '../../core/component';
import type { PlanetState } from '../../core/planet';
import type { Rng } from '../../core/rng';
import { recordEvent } from '../../events';
import { destroyDevicesNear } from '../../tools/devices';
import { addDustPulse, DUST_FINE, DUST_SOOT, DUST_SULFATE } from '../atmosphere/dust';
import { samplePoisson } from './volcanism';

/** E-folding time of the remnant planetesimal population after formation. */
export const IMPACT_FLUX_DECAY_TIME = 150e6;
/** Initial resolved-impact flux: five impacts per million years at formation. */
export const INITIAL_IMPACT_RATE = 5 / 1e6;
/** Long-lived background: one crater-forming impact per 80 Myr. */
export const BACKGROUND_IMPACT_RATE = 1 / 80e6;
/** Work cap; additional small impacts are represented in bulk heat and water delivery. */
export const MAX_RESOLVED_IMPACTS = 8;

const MIN_DIAMETER_KM = 10;
const MAX_DIAMETER_KM = 1200;
const SIZE_POWER = 2.3;
const COMET_FRACTION = 0.2;
const NOTABLE_DIAMETER_KM = 50;
const STERILISING_DIAMETER_KM = 100;
const GLOBAL_STERILISATION_DIAMETER_KM = 500;
const GLOBAL_STERILISATION_MAX_AGE = 800e6;
const IMPACT_HEAT_TIME = 200_000;
/**
 * Chicxulub-class reference (crater diameter, km): fine ejecta tau ~50 for months,
 * sulfate ~3 and soot ~2 for years (Toon et al. 1997; Brugger et al. 2017). Lofted
 * mass scales with excavated volume, roughly D^2.5 here. Sea impacts mostly make
 * steam, so they loft a tenth as much.
 */
const DUST_REFERENCE_DIAMETER_KM = 180;
const DUST_SIZE_POWER = 2.5;
const DUST_FINE_TAU = 50;
const DUST_SULFATE_TAU = 3;
const DUST_SOOT_TAU = 2;
const DUST_OCEAN_FACTOR = 0.1;
const MAX_IMPACT_DUST_TAU = 1e4;

/** Optical depth lofted by an impact, per reservoir: [fine dust, sulfate, soot]. */
export function impactDustTau(diameterKm: number, ocean: boolean): [number, number, number] {
  const scale =
    Math.pow(diameterKm / DUST_REFERENCE_DIAMETER_KM, DUST_SIZE_POWER) *
    (ocean ? DUST_OCEAN_FACTOR : 1);
  const cap = (tau: number) => Math.min(MAX_IMPACT_DUST_TAU, tau * scale);
  return [cap(DUST_FINE_TAU), cap(DUST_SULFATE_TAU), cap(DUST_SOOT_TAU)];
}

/** Instantaneous impact rate at a planet age, in impacts per year. */
export function impactRate(ageYears: number): number {
  return (
    BACKGROUND_IMPACT_RATE +
    INITIAL_IMPACT_RATE * Math.exp(-Math.max(0, ageYears) / IMPACT_FLUX_DECAY_TIME)
  );
}

/** Exact integral of the exponentially declining flux over a time step. */
export function expectedImpactCount(ageYears: number, dtYears: number): number {
  const age = Math.max(0, ageYears);
  const dt = Math.max(0, dtYears);
  return (
    BACKGROUND_IMPACT_RATE * dt +
    INITIAL_IMPACT_RATE *
      IMPACT_FLUX_DECAY_TIME *
      (Math.exp(-age / IMPACT_FLUX_DECAY_TIME) - Math.exp(-(age + dt) / IMPACT_FLUX_DECAY_TIME))
  );
}

/** Natural impacts, late-heavy-bombardment decay, cratering and biological damage. */
export const impactModel: SimComponent = {
  name: 'impacts',
  inputs: ['elevation', 'plateId', 'crustType'],
  outputs: ['elevation'],
  runOneStep(state, dtYears, rng) {
    const dt = Math.max(0, dtYears);
    const start = state.globals.year;
    state.globals.impactFlux = impactRate(start);
    state.globals.impactsThisStep = 0;
    if (dt === 0) {
      state.globals.impactHeating = state.geosphere.impactHeat;
      return;
    }

    // Carry short-lived heat exactly through arbitrary step lengths. Climate sees
    // the mean forcing over this step, while the reservoir keeps the end value.
    const decay = Math.exp(-dt / IMPACT_HEAT_TIME);
    let integratedHeat = state.geosphere.impactHeat * IMPACT_HEAT_TIME * (1 - decay);
    let endHeat = state.geosphere.impactHeat * decay;

    const count = samplePoisson(expectedImpactCount(start, dt), rng);
    state.globals.impactsThisStep = count;
    state.geosphere.impactCount += count;
    const resolved = Math.min(count, MAX_RESOLVED_IMPACTS);
    for (let k = 0; k < resolved; k++) {
      const eventOffset = rng.next() * dt;
      const cell = rng.int(0, state.grid.cellCount);
      const diameterKm = sampleImpactDiameter(rng);
      applyNaturalImpact(state, cell, diameterKm, start + eventOffset, rng);
      const peakHeat = Math.min(500, 5 * Math.pow(diameterKm / 100, 3));
      const remaining = dt - eventOffset;
      integratedHeat += peakHeat * IMPACT_HEAT_TIME * (1 - Math.exp(-remaining / IMPACT_HEAT_TIME));
      endHeat += peakHeat * Math.exp(-remaining / IMPACT_HEAT_TIME);
    }

    // At primordial rates there may be dozens in one step. Aggregate the omitted,
    // power-law-dominated small impacts without extra terrain sweeps or RNG draws.
    const aggregated = count - resolved;
    if (aggregated > 0) {
      const representativeDiameter = 14;
      deliverWater(state, representativeDiameter, aggregated * COMET_FRACTION);
      integratedHeat +=
        aggregated * 5 * Math.pow(representativeDiameter / 100, 3) * Math.min(dt, IMPACT_HEAT_TIME);
    }
    state.geosphere.impactHeat = endHeat;
    state.globals.impactHeating = integratedHeat / dt;
  },
};

/** Smallest radius (m) within which an impact destroys devices. */
const DEVICE_BLAST_MIN = 100_000;

function sampleImpactDiameter(rng: Rng): number {
  const diameter = MIN_DIAMETER_KM * Math.pow(1 - rng.next(), -1 / SIZE_POWER);
  return Math.min(MAX_DIAMETER_KM, diameter);
}

function applyNaturalImpact(
  state: PlanetState,
  centre: number,
  diameterKm: number,
  eventYear: number,
  rng: Rng,
): void {
  const ocean = state.fields.elevation[centre]! < state.globals.seaLevel;
  const [fine, sulfate, soot] = impactDustTau(diameterKm, ocean);
  addDustPulse(state, DUST_FINE, fine, eventYear);
  addDustPulse(state, DUST_SULFATE, sulfate, eventYear);
  addDustPulse(state, DUST_SOOT, soot, eventYear);
  applyImpactCrater(state, centre, diameterKm);
  // The blast flattens any terraforming device within ten crater radii.
  destroyDevicesNear(state, centre, Math.max(DEVICE_BLAST_MIN, diameterKm * 5_000));
  if (rng.next() < COMET_FRACTION) deliverWater(state, diameterKm, 1);
  if (diameterKm >= STERILISING_DIAMETER_KM) sterilise(state, centre, diameterKm, eventYear);
  if (diameterKm >= NOTABLE_DIAMETER_KM) {
    recordEvent(
      state,
      'impact',
      `${diameterKm.toFixed(0)} km · ${formatLocation(state, centre)}`,
      eventYear,
      centre,
    );
  }
}

/**
 * Cuts a physical bowl and adds an ejecta rim. Sub-cell craters use a diluted
 * footprint one cell wide, preserving their approximate excavated volume without
 * pretending a 10 km crater spans a 300 km cell.
 */
export function applyImpactCrater(state: PlanetState, centre: number, diameterKm: number): void {
  const { grid } = state;
  const positions = grid.cellPosition;
  const physicalRadius = Math.max(1, diameterKm * 500);
  const sampledRadius = Math.max(physicalRadius, grid.dy * 0.6);
  const dilution = Math.min(1, (physicalRadius * physicalRadius) / (sampledRadius * sampledRadius));
  const depth = Math.min(8000, diameterKm * 50) * dilution;
  const rimHeight = depth * 0.15;
  const extent = sampledRadius * 1.35;
  const [cx, cy, cz] = [
    positions[centre * 3]!,
    positions[centre * 3 + 1]!,
    positions[centre * 3 + 2]!,
  ];
  for (let i = 0; i < grid.cellCount; i++) {
    const dot = Math.max(
      -1,
      Math.min(1, cx * positions[i * 3]! + cy * positions[i * 3 + 1]! + cz * positions[i * 3 + 2]!),
    );
    const distance = Math.acos(dot) * grid.radius;
    if (distance > extent) continue;
    const q = distance / sampledRadius;
    const change =
      q <= 1 ? -depth * (1 - q * q) : rimHeight * Math.exp(-Math.pow((q - 1.08) / 0.12, 2));
    state.fields.elevation[i] = state.fields.elevation[i]! + change;
  }
}

function deliverWater(state: PlanetState, diameterKm: number, count: number): void {
  // Even a 100 km comet contributes just 2 mm global equivalent here.
  const delivered = count * 0.002 * Math.pow(diameterKm / 100, 3);
  state.globals.waterDelivered += delivered;
  state.globals.water += delivered;
}

function sterilise(
  state: PlanetState,
  centre: number,
  diameterKm: number,
  eventYear: number,
): void {
  const { grid, biota } = state;
  const global =
    diameterKm >= GLOBAL_STERILISATION_DIAMETER_KM && eventYear <= GLOBAL_STERILISATION_MAX_AGE;
  const blastRadius = diameterKm * 15 * 1000;
  const positions = grid.cellPosition;
  const [cx, cy, cz] = [
    positions[centre * 3]!,
    positions[centre * 3 + 1]!,
    positions[centre * 3 + 2]!,
  ];
  for (let i = 0; i < grid.cellCount; i++) {
    let survival = 0;
    if (!global) {
      const dot = Math.max(
        -1,
        Math.min(
          1,
          cx * positions[i * 3]! + cy * positions[i * 3 + 1]! + cz * positions[i * 3 + 2]!,
        ),
      );
      const distance = Math.acos(dot) * grid.radius;
      if (distance >= blastRadius) continue;
      survival = Math.min(1, distance / blastRadius);
    }
    for (let c = 0; c < biota.appeared.length; c++) {
      biota.populations[c * grid.cellCount + i] =
        biota.populations[c * grid.cellCount + i]! * survival;
    }
    state.fields.civilization[i] = state.fields.civilization[i]! * survival;
  }
  const suppression = Math.min(100e6, 10e6 * Math.pow(diameterKm / 100, 1.5));
  state.geosphere.abiogenesisSuppressedUntil = Math.max(
    state.geosphere.abiogenesisSuppressedUntil,
    eventYear + suppression,
  );
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
