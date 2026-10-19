import { cellAt, getTopology, NEIGHBOR_COUNT, type Grid } from '../../core/grid';
import type { PlanetState, Plate } from '../../core/planet';
import type { Rng } from '../../core/rng';

/** Plate surface speeds are drawn from this range (m/yr), similar to Earth's plates. */
const MIN_PLATE_SPEED = 0.01;
const MAX_PLATE_SPEED = 0.08;

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A plate with a random Euler pole and speed, identity rotation and no crust. */
export function randomPlate(rng: Rng, id: number, grid: Grid): Plate {
  const plate: Plate = {
    id,
    eulerPole: [0, 0, 1],
    angularSpeed: 0,
    targetSpeed: 0,
    rotation: [...IDENTITY],
    crust: {
      owned: new Uint8Array(grid.cellCount),
      elevation: new Float32Array(grid.cellCount),
      type: new Uint8Array(grid.cellCount),
    },
  };
  randomizeMotion(plate, rng, grid.radius);
  return plate;
}

/** New random Euler pole and surface speed; crust and accumulated rotation are kept. */
export function randomizeMotion(plate: Plate, rng: Rng, radius: number): void {
  const pole = randomUnitVector(rng);
  const speed = MIN_PLATE_SPEED + rng.next() * (MAX_PLATE_SPEED - MIN_PLATE_SPEED);
  plate.eulerPole = pole;
  plate.angularSpeed = speed / radius;
  plate.targetSpeed = plate.angularSpeed;
}

/**
 * Moves a plate's Euler pole onto the great circle 90 degrees from its centroid.
 * The resulting motion is translation-like across the plate instead of spinning
 * the plate around a pole within (or immediately beside) its own crust.
 */
export function orientMotionAcrossPlate(plate: Plate, grid: Grid): void {
  const { owned } = plate.crust;
  const positions = grid.cellPosition;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < owned.length; i++) {
    if (!owned[i]) continue;
    cx += positions[i * 3]!;
    cy += positions[i * 3 + 1]!;
    cz += positions[i * 3 + 2]!;
  }
  const centreLength = Math.hypot(cx, cy, cz);
  if (centreLength < 1e-9) return;
  cx /= centreLength;
  cy /= centreLength;
  cz /= centreLength;

  // The crust centroid is in the reference frame. Rotate it to the plate's
  // current position before projecting the newly sampled pole.
  const m = plate.rotation;
  const x = m[0]! * cx + m[1]! * cy + m[2]! * cz;
  const y = m[3]! * cx + m[4]! * cy + m[5]! * cz;
  const z = m[6]! * cx + m[7]! * cy + m[8]! * cz;
  const [px, py, pz] = plate.eulerPole;
  const dot = px * x + py * y + pz * z;
  let tx = px - dot * x;
  let ty = py - dot * y;
  let tz = pz - dot * z;
  let tangentLength = Math.hypot(tx, ty, tz);
  if (tangentLength < 1e-9) {
    // Deterministic fallback when the random pole lands exactly at the centroid.
    if (Math.abs(z) < 0.9) {
      tx = -y;
      ty = x;
      tz = 0;
    } else {
      tx = 0;
      ty = -z;
      tz = y;
    }
    tangentLength = Math.hypot(tx, ty, tz);
  }
  plate.eulerPole = [tx / tangentLength, ty / tangentLength, tz / tangentLength];
}

export function randomUnitVector(rng: Rng): [number, number, number] {
  const z = rng.next() * 2 - 1;
  const lon = rng.next() * 2 * Math.PI;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(lon), r * Math.sin(lon), z];
}

/**
 * Copies the planet's current plateId / elevation / crustType fields into the
 * plates' reference rasters and resets their rotations. Call after generating
 * a planet (or editing plates directly).
 */
export function anchorPlates(state: PlanetState): void {
  const { plateId, elevation, crustType } = state.fields;
  for (const plate of state.plates) {
    plate.rotation = [...IDENTITY];
    plate.crust.owned.fill(0);
  }
  for (let i = 0; i < plateId.length; i++) {
    const crust = state.plates[plateId[i]!]!.crust;
    crust.owned[i] = 1;
    crust.elevation[i] = elevation[i]!;
    crust.type[i] = crustType[i]!;
  }
}

/** Reference-frame cell of `plate` that is currently over planet cell `i`. */
export function referenceCell(grid: Grid, plate: Plate, i: number): number {
  const m = plate.rotation;
  const p = grid.cellPosition;
  const x = p[i * 3]!;
  const y = p[i * 3 + 1]!;
  const z = p[i * 3 + 2]!;
  // The inverse of a rotation matrix is its transpose.
  return cellAt(
    grid,
    m[0]! * x + m[3]! * y + m[6]! * z,
    m[1]! * x + m[4]! * y + m[7]! * z,
    m[2]! * x + m[5]! * y + m[8]! * z,
  );
}

/** Planet cell currently covered by a reference-frame cell of `plate`. */
export function currentCell(grid: Grid, plate: Plate, reference: number): number {
  const m = plate.rotation;
  const p = grid.cellPosition;
  const x = p[reference * 3]!;
  const y = p[reference * 3 + 1]!;
  const z = p[reference * 3 + 2]!;
  return cellAt(
    grid,
    m[0]! * x + m[1]! * y + m[2]! * z,
    m[3]! * x + m[4]! * y + m[5]! * z,
    m[6]! * x + m[7]! * y + m[8]! * z,
  );
}

/** 8-connected components of one value in a categorical planet raster. */
export function valueComponents(grid: Grid, values: Int32Array, value: number): number[][] {
  const { neighbors } = getTopology(grid);
  const seen = new Uint8Array(grid.cellCount);
  const components: number[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < grid.cellCount; start++) {
    if (seen[start] || values[start] !== value) continue;
    const cells: number[] = [];
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const cell = stack.pop()!;
      cells.push(cell);
      for (let d = 0; d < NEIGHBOR_COUNT; d++) {
        const neighbor = neighbors[cell * NEIGHBOR_COUNT + d]!;
        if (neighbor < 0 || seen[neighbor] || values[neighbor] !== value) continue;
        seen[neighbor] = 1;
        stack.push(neighbor);
      }
    }
    components.push(cells);
  }
  return components;
}

/**
 * Removes noise-warped Voronoi exclaves before crust is generated. Every piece
 * except a plate's largest is assigned to the neighbour sharing the longest
 * physical border. Repeating handles rare cases where reassignment joins two
 * pieces of the receiving plate.
 */
export function removePlateExclaves(state: PlanetState): void {
  const { grid } = state;
  const ids = state.fields.plateId;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const plate of state.plates) {
      const pieces = valueComponents(grid, ids, plate.id);
      if (pieces.length <= 1) continue;
      pieces.sort((a, b) => componentArea(grid, b) - componentArea(grid, a));
      for (const piece of pieces.slice(1)) {
        const receiver = surroundingPlate(grid, ids, piece, plate.id);
        if (receiver < 0) continue;
        for (const cell of piece) ids[cell] = receiver;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/** Physical area of a list of planet cells, m². */
export function componentArea(grid: Grid, cells: readonly number[]): number {
  let area = 0;
  for (const cell of cells) area += grid.rowCellArea[Math.floor(cell / grid.width)]!;
  return area;
}

/** Neighbour sharing the longest four-connected physical border with `cells`. */
export function surroundingPlate(
  grid: Grid,
  ids: Int32Array,
  cells: readonly number[],
  excluded: number,
): number {
  const { neighbors, rowNorthEdge, rowSouthEdge } = getTopology(grid);
  const borders = new Map<number, number>();
  for (const cell of cells) {
    const row = Math.floor(cell / grid.width);
    for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
      const neighbor = neighbors[cell * NEIGHBOR_COUNT + d]!;
      if (neighbor < 0) continue;
      const id = ids[neighbor]!;
      if (id === excluded) continue;
      const length = d === 0 ? rowNorthEdge[row]! : d === 4 ? rowSouthEdge[row]! : grid.dy;
      borders.set(id, (borders.get(id) ?? 0) + length);
    }
  }
  let best = -1;
  let bestLength = -1;
  for (const [id, length] of borders) {
    if (length > bestLength || (length === bestLength && id < best)) {
      best = id;
      bestLength = length;
    }
  }
  return best;
}

/** Rotates the plate further by `angle` radians about its current Euler pole. */
export function rotatePlate(plate: Plate, angle: number): void {
  const r = axisRotation(plate.eulerPole, angle);
  const m = plate.rotation;
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        r[row * 3]! * m[col]! + r[row * 3 + 1]! * m[3 + col]! + r[row * 3 + 2]! * m[6 + col]!;
    }
  }
  plate.rotation = out;
}

/** Row-major rotation matrix about a unit axis (Rodrigues' formula). */
function axisRotation(axis: readonly [number, number, number], angle: number): number[] {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}
