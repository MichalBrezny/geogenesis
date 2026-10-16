import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT, type Grid } from '../../core/grid';
import { CellPriorityQueue } from '../../core/priorityQueue';
import { potentialEvapotranspiration } from '../hydrology';
import { SEA_LEVEL, isOcean } from './seaLevel';

export { SEA_LEVEL } from './seaLevel';

/** Lake categories stored in the `lakeType` field. */
export const LakeType = { None: 0, Fresh: 1, Salt: 2, SaltFlat: 3 } as const;

/**
 * Minimum drop (m) imposed across filled depressions so that every land cell
 * has a strictly lower neighbour to drain to.
 */
const FILL_EPSILON = 1e-3;
/** Ignore sub-metre priority-flood grading when finding a depression footprint. */
const MIN_DEPRESSION_FILL = 1;
/**
 * A depression must be at least this deep to hold a represented lake. The
 * threshold is in physical metres, rather than cells, so shallow terrain noise
 * is filled and drained consistently at every grid resolution.
 */
const MIN_LAKE_DEPRESSION_DEPTH = 50;
/** Minimum depression footprint for a real lake basin (30,000 km²), in m². */
const MIN_LAKE_DEPRESSION_AREA = 30_000e6;
/** Only basins drier than this P/PET ratio may become endorheic. */
const MAX_ENDORHEIC_ARIDITY = 0.5;
/** Shape parameter of Fu's form of the Budyko curve (Earth's catchments: about 2.6). */
const BUDYKO_W = 2.6;

/**
 * Routes water over the land surface (a combination of Landlab's
 * PriorityFloodFlowRouter / DepressionFinderAndRouter and FlowAccumulator):
 *
 * 1. Priority-flood fill (Barnes et al. 2014) from the ocean finds each
 *    depression and its lowest spill path.
 * 2. D8 steepest descent on the filled surface gives each land cell a receiver.
 * 3. The priority-flood visit order is already sorted from downstream to
 *    upstream, which lets drainage area be accumulated in one reverse pass.
 * 4. Runoff is what rain leaves after evapotranspiration (Budyko curve: dry
 *    and hot land evaporates nearly all of it); summed downstream it gives the
 *    rivers' discharge, which drives erosion.
 *
 * Depressions shallower than 50 m, smaller than 30,000 km², or only one cell
 * wide are treated as terrain noise: they are filled for routing but do not
 * become lakes. A physically significant depression in a humid basin
 * (P/PET >= 0.5) fills and overflows. Only a dry basin can retain a terminal
 * endorheic salt lake or salt flat. Ocean cells (and the single lowest cell on
 * a planet without ocean) are also outlets with receiver -1.
 */
export const flowRouting: SimComponent = {
  name: 'flowRouting',
  inputs: ['elevation', 'precipitation', 'airTemperature'],
  outputs: [
    'flowReceiver',
    'flowUpstreamOrder',
    'drainageArea',
    'runoff',
    'discharge',
    'lakeDepth',
    'lakeType',
  ],
  runOneStep(state) {
    const { grid, fields } = state;
    const { elevation, flowReceiver, flowUpstreamOrder, drainageArea, runoff, discharge } = fields;
    const seaLevel = state.globals.seaLevel;
    const filled = fillDepressions(grid, elevation, flowUpstreamOrder, seaLevel);
    assignReceivers(grid, filled, elevation, flowReceiver, seaLevel);
    for (let i = 0; i < grid.cellCount; i++) {
      runoff[i] = isOcean(elevation[i]!, seaLevel)
        ? 0
        : runoffOf(fields.precipitation[i]!, fields.airTemperature[i]!);
    }
    // The provisional open routing supplies catchment inflow for the lake water balance.
    accumulateDischarge(grid, flowReceiver, flowUpstreamOrder, runoff, discharge);
    // Closing an upstream basin can starve one below it, so repeat until no new
    // spill edge closes. Closure only moves downstream and therefore converges.
    while (routeLakes(state, filled)) {
      accumulateDischarge(grid, flowReceiver, flowUpstreamOrder, runoff, discharge);
    }
    accumulateDrainageArea(grid, flowReceiver, flowUpstreamOrder, drainageArea);
    accumulateDischarge(grid, flowReceiver, flowUpstreamOrder, runoff, discharge);
  },
};

/**
 * Returns the depression-filled surface and writes the visit order (lowest
 * first) to `order`.
 */
export function fillDepressions(
  grid: Grid,
  elevation: Float32Array,
  order: Int32Array,
  seaLevel = SEA_LEVEL,
): Float64Array {
  const { neighbors } = getTopology(grid);
  const n = grid.cellCount;
  const filled = new Float64Array(n);
  const closed = new Uint8Array(n);
  const queue = new CellPriorityQueue(n);

  // Ocean cells are outlets: they go first in the order, and only those touching
  // land need to seed the flood (keeps the heap small, as most cells are ocean).
  let visited = 0;
  for (let i = 0; i < n; i++) {
    if (isOcean(elevation[i]!, seaLevel)) {
      filled[i] = elevation[i]!;
      closed[i] = 1;
      order[visited++] = i;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!closed[i]) continue;
    for (let d = 0; d < NEIGHBOR_COUNT; d++) {
      const nb = neighbors[i * NEIGHBOR_COUNT + d]!;
      if (nb >= 0 && !closed[nb]) {
        queue.push(i, filled[i]!);
        break;
      }
    }
  }
  if (visited === 0) {
    // No ocean: drain everything towards the lowest cell.
    let lowest = 0;
    for (let i = 1; i < n; i++) if (elevation[i]! < elevation[lowest]!) lowest = i;
    filled[lowest] = elevation[lowest]!;
    closed[lowest] = 1;
    queue.push(lowest, filled[lowest]!);
  }

  while (queue.size > 0) {
    const c = queue.pop();
    // Ocean seeds are already in the order; land joins it as it is reached.
    if (!isOcean(elevation[c]!, seaLevel)) order[visited++] = c;
    for (let d = 0; d < NEIGHBOR_COUNT; d++) {
      const nb = neighbors[c * NEIGHBOR_COUNT + d]!;
      if (nb < 0 || closed[nb]) continue;
      closed[nb] = 1;
      filled[nb] = Math.max(elevation[nb]!, filled[c]! + FILL_EPSILON);
      queue.push(nb, filled[nb]!);
    }
  }
  return filled;
}

function assignReceivers(
  grid: Grid,
  filled: Float64Array,
  elevation: Float32Array,
  receiver: Int32Array,
  seaLevel: number,
): void {
  const { neighbors, rowDistance } = getTopology(grid);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      receiver[i] = -1;
      if (isOcean(elevation[i]!, seaLevel)) continue;
      let steepest = 0;
      for (let d = 0; d < NEIGHBOR_COUNT; d++) {
        const nb = neighbors[i * NEIGHBOR_COUNT + d]!;
        if (nb < 0) continue;
        const slope = (filled[i]! - filled[nb]!) / rowDistance[y * NEIGHBOR_COUNT + d]!;
        if (slope > steepest) {
          steepest = slope;
          receiver[i] = nb;
        }
      }
    }
  }
}

function accumulateDrainageArea(
  grid: Grid,
  receiver: Int32Array,
  order: Int32Array,
  area: Float32Array,
): void {
  for (let i = 0; i < grid.cellCount; i++) area[i] = grid.rowCellArea[Math.floor(i / grid.width)]!;
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    const r = receiver[i]!;
    if (r >= 0) area[r] = area[r]! + area[i]!;
  }
}

/**
 * Runoff (mm/yr) from annual precipitation and temperature: precipitation minus
 * evapotranspiration, from Fu's form of the Budyko curve,
 * ET/P = 1 + φ − (1 + φ^w)^(1/w) with dryness φ = PET / P.
 */
export function runoffOf(precipitation: number, temperature: number): number {
  if (precipitation <= 0) return 0;
  const pet = potentialEvapotranspiration(temperature);
  const dryness = pet / precipitation;
  const evaporated = 1 + dryness - Math.pow(1 + Math.pow(dryness, BUDYKO_W), 1 / BUDYKO_W);
  return precipitation * Math.max(0, 1 - evaporated);
}

interface Depression {
  cells: number[];
  id: number;
}

/** Finds filled depressions, assigns their lake surfaces, and closes dry outlets. */
function routeLakes(
  state: Parameters<SimComponent['runOneStep']>[0],
  filled: Float64Array,
): boolean {
  const { grid, fields } = state;
  const { elevation, flowReceiver, precipitation, airTemperature, runoff, discharge } = fields;
  const { lakeDepth, lakeType } = fields;
  lakeDepth.fill(0);
  lakeType.fill(LakeType.None);

  const componentOf = new Int32Array(grid.cellCount).fill(-1);
  const depressions = findDepressions(grid, elevation, filled, state.globals.seaLevel, componentOf);
  const incomingByDepression = new Float64Array(depressions.length);
  const localRunoffByDepression = new Float64Array(depressions.length);
  const precipitationByDepression = new Float64Array(depressions.length);
  const petByDepression = new Float64Array(depressions.length);
  const upstreamPrecipitation = new Float64Array(grid.cellCount);
  const upstreamPet = new Float64Array(grid.cellCount);
  for (let i = 0; i < grid.cellCount; i++) {
    if (!isOcean(elevation[i]!, state.globals.seaLevel)) {
      const area = grid.rowCellArea[Math.floor(i / grid.width)]!;
      upstreamPrecipitation[i] = (Math.max(0, precipitation[i]!) / 1000) * area;
      upstreamPet[i] = (potentialEvapotranspiration(airTemperature[i]!) / 1000) * area;
    }
  }
  accumulateAlongFlow(flowReceiver, state.fields.flowUpstreamOrder, upstreamPrecipitation);
  accumulateAlongFlow(flowReceiver, state.fields.flowUpstreamOrder, upstreamPet);

  for (let i = 0; i < grid.cellCount; i++) {
    const id = componentOf[i]!;
    if (id >= 0) {
      const area = grid.rowCellArea[Math.floor(i / grid.width)]!;
      localRunoffByDepression[id] = localRunoffByDepression[id]! + (runoff[i]! / 1000) * area;
      precipitationByDepression[id] =
        precipitationByDepression[id]! + (Math.max(0, precipitation[i]!) / 1000) * area;
      petByDepression[id] =
        petByDepression[id]! + (potentialEvapotranspiration(airTemperature[i]!) / 1000) * area;
    }
    const r = flowReceiver[i]!;
    if (r < 0) continue;
    const receiverId = componentOf[r]!;
    if (receiverId >= 0 && receiverId !== id) {
      incomingByDepression[receiverId] = incomingByDepression[receiverId]! + discharge[i]!;
      precipitationByDepression[receiverId] =
        precipitationByDepression[receiverId]! + upstreamPrecipitation[i]!;
      petByDepression[receiverId] = petByDepression[receiverId]! + upstreamPet[i]!;
    }
  }
  let closedOutlet = false;
  for (const depression of depressions) {
    const incoming = incomingByDepression[depression.id]!;
    const localRunoff = localRunoffByDepression[depression.id]!;

    const pet = petByDepression[depression.id]!;
    const basinAridity = pet > 0 ? precipitationByDepression[depression.id]! / pet : Infinity;
    if (basinAridity >= MAX_ENDORHEIC_ARIDITY) {
      for (const i of depression.cells) {
        lakeDepth[i] = filled[i]! - elevation[i]!;
        lakeType[i] = LakeType.Fresh;
      }
      continue;
    }

    const sorted = [...depression.cells].sort((a, b) => elevation[a]! - elevation[b]!);
    let selected = 0;
    let selectedArea = 0;
    let cost = 0;
    for (let start = 0; start < sorted.length;) {
      let end = start + 1;
      while (end < sorted.length && elevation[sorted[end]!] === elevation[sorted[start]!]!) end++;
      let groupCost = 0;
      let groupArea = 0;
      for (let k = start; k < end; k++) {
        const i = sorted[k]!;
        const area = grid.rowCellArea[Math.floor(i / grid.width)]!;
        const deficit = potentialEvapotranspiration(airTemperature[i]!) - precipitation[i]!;
        groupCost += (runoff[i]! / 1000) * area + (deficit / 1000) * area;
        groupArea += area;
      }
      if (cost + groupCost > incoming + localRunoff) break;
      cost += groupCost;
      selectedArea += groupArea;
      selected = end;
      start = end;
    }

    if (selected === sorted.length) {
      for (const i of depression.cells) {
        lakeDepth[i] = filled[i]! - elevation[i]!;
        lakeType[i] = LakeType.Fresh;
      }
      continue;
    }

    const floor = elevation[sorted[0]!]!;
    let floorCells = 0;
    let floorArea = 0;
    while (floorCells < sorted.length && elevation[sorted[floorCells]!] === floor) {
      const i = sorted[floorCells++]!;
      floorArea += grid.rowCellArea[Math.floor(i / grid.width)]!;
    }
    const hasSaltLake = selected > 1 && selectedArea >= MIN_LAKE_DEPRESSION_AREA;
    const hasSaltFlat = !hasSaltLake && floorCells > 1 && floorArea >= MIN_LAKE_DEPRESSION_AREA;
    if (!hasSaltLake && !hasSaltFlat) continue;

    // Closed lakes retain all basin flow; no discharge crosses their spill rim.
    for (const i of depression.cells) {
      const r = flowReceiver[i]!;
      if (r >= 0 && componentOf[r] !== depression.id) {
        flowReceiver[i] = -1;
        closedOutlet = true;
      }
    }
    if (hasSaltFlat) {
      for (let k = 0; k < floorCells; k++) lakeType[sorted[k]!] = LakeType.SaltFlat;
      continue;
    }

    const waterLevel = elevation[sorted[selected]!]!;
    for (let k = 0; k < selected; k++) {
      const i = sorted[k]!;
      lakeDepth[i] = Math.max(0.1, waterLevel - elevation[i]!);
      lakeType[i] = LakeType.Salt;
    }
  }
  return closedOutlet;
}

function findDepressions(
  grid: Grid,
  elevation: Float32Array,
  filled: Float64Array,
  seaLevel: number,
  componentOf: Int32Array,
): Depression[] {
  const { neighbors } = getTopology(grid);
  const depressions: Depression[] = [];
  const queue = new Int32Array(grid.cellCount);
  for (let seed = 0; seed < grid.cellCount; seed++) {
    if (
      componentOf[seed]! >= 0 ||
      isOcean(elevation[seed]!, seaLevel) ||
      filled[seed]! - elevation[seed]! < MIN_DEPRESSION_FILL
    ) {
      continue;
    }
    const id = depressions.length;
    const cells: number[] = [];
    let maxDepth = 0;
    let area = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    componentOf[seed] = id;
    while (head < tail) {
      const i = queue[head++]!;
      cells.push(i);
      maxDepth = Math.max(maxDepth, filled[i]! - elevation[i]!);
      area += grid.rowCellArea[Math.floor(i / grid.width)]!;
      for (let d = 0; d < NEIGHBOR_COUNT; d++) {
        const nb = neighbors[i * NEIGHBOR_COUNT + d]!;
        if (
          nb < 0 ||
          componentOf[nb]! >= 0 ||
          isOcean(elevation[nb]!, seaLevel) ||
          filled[nb]! - elevation[nb]! < MIN_DEPRESSION_FILL
        ) {
          continue;
        }
        componentOf[nb] = id;
        queue[tail++] = nb;
      }
    }
    if (
      cells.length > 1 &&
      area >= MIN_LAKE_DEPRESSION_AREA &&
      maxDepth >= MIN_LAKE_DEPRESSION_DEPTH
    ) {
      depressions.push({ cells, id });
    } else {
      for (const i of cells) componentOf[i] = -1;
    }
  }
  return depressions;
}

/** Accumulates an extensive quantity from donors into their receivers. */
function accumulateAlongFlow(
  receiver: Int32Array,
  order: Int32Array,
  quantity: Float64Array,
): void {
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    const r = receiver[i]!;
    if (r >= 0) quantity[r] = quantity[r]! + quantity[i]!;
  }
}

/** River discharge (m³/yr): each cell's runoff plus everything flowing into it. */
function accumulateDischarge(
  grid: Grid,
  receiver: Int32Array,
  order: Int32Array,
  runoff: Float32Array,
  discharge: Float32Array,
): void {
  for (let i = 0; i < grid.cellCount; i++) {
    discharge[i] = (runoff[i]! / 1000) * grid.rowCellArea[Math.floor(i / grid.width)]!;
  }
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    const r = receiver[i]!;
    if (r >= 0) discharge[r] = discharge[r]! + discharge[i]!;
  }
}

/** Distance in metres from cell `i` to its neighbour `j`, or NaN if they are not adjacent. */
export function neighborDistance(grid: Grid, i: number, j: number): number {
  const { neighbors, rowDistance } = getTopology(grid);
  const y = Math.floor(i / grid.width);
  for (let d = 0; d < NEIGHBOR_COUNT; d++) {
    if (neighbors[i * NEIGHBOR_COUNT + d] === j) return rowDistance[y * NEIGHBOR_COUNT + d]!;
  }
  return NaN;
}
