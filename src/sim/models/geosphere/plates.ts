import { cellAt, type Grid } from '../../core/grid';
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
