import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT, type Grid } from '../../core/grid';
import { neighborDistance } from './flowRouting';
import { isOcean } from './seaLevel';

export interface StreamPowerOptions {
  /** Erodibility K in yr^-1 m^(1-2m). Effective value for coarse cells. */
  erodibility?: number;
  /** Drainage area exponent m (slope exponent n is fixed at 1). */
  areaExponent?: number;
  /** Basal glacial erodibility per metre of ice, yr^-1. */
  glacialErodibility?: number;
  /** Sediment carrying-capacity coefficient in C * discharge * slope. */
  transportCoefficient?: number;
}

/** Runoff (m/yr) at which discharge counts as drainage area in stream power. */
export const REFERENCE_RUNOFF = 0.3;
/** A 1 km thick temperate glacier supplies about 5 mm/yr of sliding potential. */
export const DEFAULT_GLACIAL_ERODIBILITY = 5e-6;
/** Suspended plus bed-load capacity relative to water discharge and channel slope. */
export const DEFAULT_TRANSPORT_COEFFICIENT = 0.05;
/** Cold-based ice below this annual mean temperature does not appreciably slide. */
const FROZEN_BASE_TEMPERATURE = -15;
/** Sliding reaches full strength near the melting point. */
const FULL_SLIDING_TEMPERATURE = -2;
/** Glaciers may cut a bed this far below sea level before becoming marine outlets. */
const MAX_FJORD_DEPTH = 500;
/** Shelf fan/delta radius from a river mouth, in physical metres. */
export const SHELF_DEPOSITION_WIDTH = 500_000;
/** Existing ocean floor within this depth is preferred as continental shelf. */
const MAX_SHELF_DEPTH = 2500;
/** Marine sediment is not allowed to build more than this far above sea level. */
export const MAX_DELTA_HEIGHT = 2;

/**
 * Implicit stream-power and glacial incision followed by conservative sediment
 * routing.
 *
 * River incision is E = K (Q/R)^m S. A second sliding coefficient proportional
 * to ice thickness and a warm-based-ice factor cuts glaciated valleys and may
 * overdeepen fjords modestly below sea level. Both terms use the unconditionally
 * stable n=1 Braun-Willett solve.
 *
 * The exact eroded cell volume is then accumulated downstream. A reach deposits
 * sediment when its C Q S carrying capacity is below the incoming volume rate;
 * solving deposition together with the changed slope avoids over-filling flats.
 * Sediment reaching the ocean fills shallow cells within about 500 km of the
 * mouth. If that finite shelf accommodation is exhausted, the remainder forms
 * deeper submarine fans. Apart from Float32 elevation round-off, eroded volume
 * equals deposited volume. The pathological remainder after all ocean floor has
 * filled to the delta cap is recorded explicitly in `globals.sedimentExport`.
 */
export function createStreamPowerEroder(options: StreamPowerOptions = {}): SimComponent {
  const riverErodibility = options.erodibility ?? 1e-8;
  const areaExponent = options.areaExponent ?? 0.5;
  const glacialErodibility = options.glacialErodibility ?? DEFAULT_GLACIAL_ERODIBILITY;
  const transportCoefficient = options.transportCoefficient ?? DEFAULT_TRANSPORT_COEFFICIENT;

  return {
    name: 'streamPowerEroder',
    inputs: [
      'elevation',
      'flowReceiver',
      'flowUpstreamOrder',
      'discharge',
      'iceThickness',
      'airTemperature',
    ],
    outputs: ['elevation'],
    runOneStep(state, dtYears) {
      if (dtYears <= 0) return;
      const { grid, fields } = state;
      const seaLevel = state.globals.seaLevel;
      const {
        elevation,
        flowReceiver,
        flowUpstreamOrder,
        discharge,
        iceThickness,
        airTemperature,
      } = fields;
      const scratch = sedimentScratch(grid);
      const { sediment, initialOcean, marineSupply } = scratch;
      sediment.fill(0);
      initialOcean.fill(0);
      marineSupply.fill(0);
      for (let i = 0; i < grid.cellCount; i++) {
        if (isOcean(elevation[i]!, seaLevel)) initialOcean[i] = 1;
      }

      // Receivers precede donors, so their already-incised elevation is the base.
      for (let k = 0; k < flowUpstreamOrder.length; k++) {
        const i = flowUpstreamOrder[k]!;
        const r = flowReceiver[i]!;
        if (r < 0 || initialOcean[i]) continue;
        const h = elevation[i]!;
        const distance = neighborDistance(grid, i, r);
        const riverBase = Math.max(elevation[r]!, seaLevel);
        const riverFactor =
          h > riverBase
            ? (riverErodibility *
                state.effectiveControls.erosion *
                Math.pow(Math.max(0, discharge[i]!) / REFERENCE_RUNOFF, areaExponent) *
                dtYears) /
              distance
            : 0;

        const iceBase = Math.max(elevation[r]!, seaLevel - MAX_FJORD_DEPTH);
        const sliding = slidingFraction(airTemperature[i]!);
        const glacialFactor =
          h > iceBase && iceThickness[i]! > 0 && sliding > 0
            ? (glacialErodibility *
                state.effectiveControls.erosion *
                iceThickness[i]! *
                sliding *
                dtYears) /
              distance
            : 0;
        if (riverFactor <= 0 && glacialFactor <= 0) continue;

        const next =
          (h + riverFactor * riverBase + glacialFactor * iceBase) /
          (1 + riverFactor + glacialFactor);
        elevation[i] = Math.min(h, next);
        const area = grid.rowCellArea[Math.floor(i / grid.width)]!;
        sediment[i] = sediment[i]! + Math.max(0, h - elevation[i]!) * area;
      }

      // Donors now precede receivers, so all supply has arrived when a cell is handled.
      for (let k = flowUpstreamOrder.length - 1; k >= 0; k--) {
        const i = flowUpstreamOrder[k]!;
        let volume = sediment[i]!;
        if (volume <= 0) continue;
        if (initialOcean[i]) {
          marineSupply[i] = marineSupply[i]! + volume;
          continue;
        }

        const r = flowReceiver[i]!;
        if (r < 0) {
          depositAtCell(grid, elevation, i, volume);
          continue;
        }
        volume = depositInReach(
          grid,
          elevation,
          discharge,
          i,
          r,
          seaLevel,
          dtYears,
          transportCoefficient,
          volume,
        );
        sediment[r] = sediment[r]! + volume;
      }

      state.globals.sedimentExport += depositMarineSediment(
        grid,
        elevation,
        initialOcean,
        seaLevel,
        marineSupply,
        scratch.spread,
      );
    },
  };
}

function slidingFraction(temperature: number): number {
  const x = Math.min(
    1,
    Math.max(
      0,
      (temperature - FROZEN_BASE_TEMPERATURE) /
        (FULL_SLIDING_TEMPERATURE - FROZEN_BASE_TEMPERATURE),
    ),
  );
  return x * x * (3 - 2 * x);
}

/** Deposits enough in one reach that outgoing supply equals its new capacity. */
function depositInReach(
  grid: Grid,
  elevation: Float32Array,
  discharge: Float32Array,
  cell: number,
  receiver: number,
  seaLevel: number,
  dtYears: number,
  coefficient: number,
  volume: number,
): number {
  const distance = neighborDistance(grid, cell, receiver);
  const area = grid.rowCellArea[Math.floor(cell / grid.width)]!;
  const base = Math.max(elevation[receiver]!, seaLevel);

  // A real depression fills to its outlet before it can export sediment.
  if (elevation[cell]! < base) {
    const fill = Math.min(volume, (base - elevation[cell]!) * area);
    const deposited = depositAtCell(grid, elevation, cell, fill);
    volume = Math.max(0, volume - deposited);
    if (volume <= 0 || elevation[cell]! < base) return volume;
  }

  const transport = Math.max(0, coefficient) * Math.max(0, discharge[cell]!) * dtYears;
  const drop = Math.max(0, elevation[cell]! - base);
  const capacity = (transport * drop) / distance;
  if (volume <= capacity) return volume;
  // D = V - C*(drop + D/area)/distance, solved directly for deposit D.
  const requested = (volume - capacity) / (1 + transport / Math.max(area * distance, 1));
  const deposited = depositAtCell(grid, elevation, cell, Math.min(volume, requested));
  return Math.max(0, volume - deposited);
}

/** Raises one cell by a requested physical volume and returns the represented volume. */
function depositAtCell(
  grid: Grid,
  elevation: Float32Array,
  cell: number,
  volume: number,
  ceiling = Infinity,
): number {
  if (volume <= 0) return 0;
  const area = grid.rowCellArea[Math.floor(cell / grid.width)]!;
  const before = elevation[cell]!;
  elevation[cell] = Math.min(ceiling, before + volume / area);
  return Math.max(0, elevation[cell]! - before) * area;
}

/**
 * Diffuses every river mouth's load over a physical shelf width simultaneously,
 * then deposits it. The pass count follows the physical maximum fan radius;
 * retaining half the load per pass keeps most sediment within a few hundred km.
 */
function depositMarineSediment(
  grid: Grid,
  elevation: Float32Array,
  initialOcean: Uint8Array,
  seaLevel: number,
  supply: Float64Array,
  next: Float64Array,
): number {
  const { neighbors } = getTopology(grid);
  const passes = Math.max(1, Math.ceil(SHELF_DEPOSITION_WIDTH / grid.dy));
  for (let pass = 0; pass < passes; pass++) {
    next.fill(0);
    for (let i = 0; i < grid.cellCount; i++) {
      const volume = supply[i]!;
      if (volume <= 0) continue;
      let targets = 0;
      for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
        const n = neighbors[i * NEIGHBOR_COUNT + d]!;
        if (n >= 0 && initialOcean[n] && seaLevel - elevation[n]! <= MAX_SHELF_DEPTH) {
          targets++;
        }
      }
      if (targets === 0) {
        next[i] = next[i]! + volume;
        continue;
      }
      const moving = volume / 2;
      next[i] = next[i]! + (volume - moving);
      const share = moving / targets;
      for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
        const n = neighbors[i * NEIGHBOR_COUNT + d]!;
        if (n >= 0 && initialOcean[n] && seaLevel - elevation[n]! <= MAX_SHELF_DEPTH) {
          next[n] = next[n]! + share;
        }
      }
    }
    supply.set(next);
  }

  const ceiling = seaLevel + MAX_DELTA_HEIGHT;
  let overflow = 0;
  for (let i = 0; i < grid.cellCount; i++) {
    const volume = supply[i]!;
    if (volume <= 0) continue;
    const deposited = depositAtCell(grid, elevation, i, volume, ceiling);
    overflow += Math.max(0, volume - deposited);
  }
  // Shelf accommodation is finite. Preserve mass by using shallow ocean cells
  // globally, then deeper submarine fans, only when the local fan filled.
  overflow = depositGlobally(grid, elevation, initialOcean, seaLevel, overflow, MAX_SHELF_DEPTH);
  return depositGlobally(grid, elevation, initialOcean, seaLevel, overflow, Infinity);
}

interface SedimentScratch {
  sediment: Float64Array;
  initialOcean: Uint8Array;
  marineSupply: Float64Array;
  spread: Float64Array;
}

const sedimentScratchCache = new WeakMap<Grid, SedimentScratch>();

/** Grid-sized sediment-routing work arrays, cleared and reused each geology step. */
function sedimentScratch(grid: Grid): SedimentScratch {
  let scratch = sedimentScratchCache.get(grid);
  if (!scratch) {
    const n = grid.cellCount;
    scratch = {
      sediment: new Float64Array(n),
      initialOcean: new Uint8Array(n),
      marineSupply: new Float64Array(n),
      spread: new Float64Array(n),
    };
    sedimentScratchCache.set(grid, scratch);
  }
  return scratch;
}

/** Spreads a fallback volume across available marine accommodation. */
function depositGlobally(
  grid: Grid,
  elevation: Float32Array,
  initialOcean: Uint8Array,
  seaLevel: number,
  volume: number,
  maxDepth: number,
): number {
  if (volume <= 0) return 0;
  const ceiling = seaLevel + MAX_DELTA_HEIGHT;
  let accommodation = 0;
  for (let i = 0; i < grid.cellCount; i++) {
    if (!initialOcean[i] || seaLevel - elevation[i]! > maxDepth) continue;
    const area = grid.rowCellArea[Math.floor(i / grid.width)]!;
    accommodation += Math.max(0, ceiling - elevation[i]!) * area;
  }
  if (accommodation <= 0) return volume;
  const startingVolume = volume;
  for (let i = 0; i < grid.cellCount; i++) {
    if (!initialOcean[i] || seaLevel - elevation[i]! > maxDepth) continue;
    const area = grid.rowCellArea[Math.floor(i / grid.width)]!;
    const available = Math.max(0, ceiling - elevation[i]!) * area;
    const share = Math.min(available, (startingVolume * available) / accommodation);
    volume = Math.max(0, volume - depositAtCell(grid, elevation, i, share, ceiling));
  }
  // Finish any capped or Float32 remainder without changing the preference order.
  for (let i = 0; i < grid.cellCount && volume > 0; i++) {
    if (!initialOcean[i] || seaLevel - elevation[i]! > maxDepth) continue;
    const area = grid.rowCellArea[Math.floor(i / grid.width)]!;
    const available = Math.max(0, ceiling - elevation[i]!) * area;
    volume = Math.max(
      0,
      volume - depositAtCell(grid, elevation, i, Math.min(volume, available), ceiling),
    );
  }
  return volume;
}
