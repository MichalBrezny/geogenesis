import { describe, it } from 'vitest';
import type { PlanetState, Plate } from '../../core/planet';
import { createRandomWorld, type PlanetStart } from '../../world';

const RUN = import.meta.env.GEOGENESIS_PLATE_MEASURE === '1';
const START = import.meta.env.GEOGENESIS_PLATE_MEASURE_START;
const WIDTH = Number(import.meta.env.GEOGENESIS_PLATE_MEASURE_WIDTH || 0);
const RAD = Math.PI / 180;

interface Motion {
  centre: [number, number, number];
  direction: [number, number, number];
  pole: [number, number, number];
  targetPole: [number, number, number];
  speed: number;
  target: number;
  owned: number;
}

function motions(state: PlanetState): Map<number, Motion> {
  const sums = Array.from({ length: state.plates.length }, () => [0, 0, 0, 0]);
  const { plateId } = state.fields;
  const positions = state.grid.cellPosition;
  for (let cell = 0; cell < plateId.length; cell++) {
    const id = plateId[cell]!;
    const area = state.grid.rowCellArea[Math.floor(cell / state.grid.width)]!;
    const sum = sums[id]!;
    sum[0]! += positions[cell * 3]! * area;
    sum[1]! += positions[cell * 3 + 1]! * area;
    sum[2]! += positions[cell * 3 + 2]! * area;
    sum[3]! += area;
  }
  const result = new Map<number, Motion>();
  for (const plate of state.plates) {
    const sum = sums[plate.id]!;
    if (sum[3]! <= 0) continue;
    const length = Math.hypot(sum[0]!, sum[1]!, sum[2]!);
    if (length <= 0) continue;
    const centre: [number, number, number] = [sum[0]! / length, sum[1]! / length, sum[2]! / length];
    const direction = crossDirection(plate, centre);
    result.set(plate.id, {
      centre,
      direction,
      pole: [...plate.eulerPole],
      targetPole: [
        ...((plate as Plate & { targetEulerPole?: [number, number, number] }).targetEulerPole ??
          plate.eulerPole),
      ],
      speed: plate.angularSpeed * state.grid.radius,
      target: plate.targetSpeed * state.grid.radius,
      owned: plate.crust.owned.reduce((total, value) => total + value, 0),
    });
  }
  return result;
}

function crossDirection(
  plate: Plate,
  position: readonly [number, number, number],
): [number, number, number] {
  const [px, py, pz] = plate.eulerPole;
  const [x, y, z] = position;
  const vx = py * z - pz * y;
  const vy = pz * x - px * z;
  const vz = px * y - py * x;
  const length = Math.hypot(vx, vy, vz);
  return length > 0 ? [vx / length, vy / length, vz / length] : [0, 0, 0];
}

function directionForMotion(
  motion: Motion,
  position: readonly [number, number, number],
): [number, number, number] {
  const [px, py, pz] = motion.pole;
  const [x, y, z] = position;
  const vx = py * z - pz * y;
  const vy = pz * x - px * z;
  const vz = px * y - py * x;
  const length = Math.hypot(vx, vy, vz);
  return length > 0 ? [vx / length, vy / length, vz / length] : [0, 0, 0];
}

function angle(a: readonly number[], b: readonly number[]): number {
  return Math.acos(Math.max(-1, Math.min(1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!)));
}

function surfaceStats(state: PlanetState) {
  let totalArea = 0;
  let landArea = 0;
  let crustArea = 0;
  let exposedCrustArea = 0;
  let crustElevation = 0;
  let landElevation = 0;
  let highest = -Infinity;
  const plateAreas = new Float64Array(state.plates.length);
  const { elevation, crustType, plateId } = state.fields;
  for (let cell = 0; cell < elevation.length; cell++) {
    const area = state.grid.rowCellArea[Math.floor(cell / state.grid.width)]!;
    totalArea += area;
    plateAreas[plateId[cell]!]! += area;
    if (crustType[cell]) {
      crustArea += area;
      crustElevation += elevation[cell]! * area;
      if (elevation[cell]! > state.globals.seaLevel) exposedCrustArea += area;
    }
    if (elevation[cell]! > state.globals.seaLevel) {
      landArea += area;
      landElevation += elevation[cell]! * area;
    }
    highest = Math.max(highest, elevation[cell]!);
  }
  let weightedSpeed = 0;
  let movingArea = 0;
  for (const plate of state.plates) {
    if (plateAreas[plate.id]! <= 0) continue;
    weightedSpeed += plate.angularSpeed * state.grid.radius * plateAreas[plate.id]!;
    movingArea += plateAreas[plate.id]!;
  }
  return {
    landFraction: landArea / totalArea,
    crustFraction: crustArea / totalArea,
    exposedCrustFraction: exposedCrustArea / totalArea,
    meanCrustElevation: crustElevation / crustArea,
    seaLevel: state.globals.seaLevel,
    meanLandElevation: landElevation / landArea,
    highest,
    plateCount: plateAreas.filter((area) => area > 0).length,
    meanPlateSpeedCmYr: (weightedSpeed / movingArea) * 100,
  };
}

async function measure(start: PlanetStart, width: number, height: number) {
  const world = createRandomWorld({ start, width, height, seed: 1 });
  const end = world.planet.globals.year + 1e9;
  let previous = motions(world.planet);
  let previousPlateId = Int32Array.from(world.planet.fields.plateId);
  let changes = 0;
  let comparisons = 0;
  const causes = { reorganization: 0, rift: 0, transfer: 0, collision: 0 };
  let collisionStarts = 0;
  const collisionTravel = new Map<number, number>();
  const activeCollision = new Set<number>();
  let maxPenetration = 0;
  let steps = 0;
  while (world.planet.globals.year < end) {
    // Evolved quick worlds can enter civilization cadences of years or decades;
    // keep this geological calibration finite while exercising the full pipeline.
    const dt = Math.min(
      Math.max(world.stepYears(world.planet), 1e6),
      end - world.planet.globals.year,
    );
    world.simulation.step(world.planet, dt);
    steps++;
    const current = motions(world.planet);
    const activeSuture = new Set(
      (
        world.planet.geosphere as {
          continentalSutures?: { plateA: number; plateB: number }[];
        }
      ).continentalSutures?.flatMap((suture) => [suture.plateA, suture.plateB]) ?? [],
    );
    for (const [id, now] of current) {
      const before = previous.get(id);
      if (!before) {
        const parents = new Map<number, number>();
        for (let cell = 0; cell < world.planet.grid.cellCount; cell++) {
          if (world.planet.fields.plateId[cell] !== id) continue;
          const parent = previousPlateId[cell]!;
          parents.set(parent, (parents.get(parent) ?? 0) + 1);
        }
        const parentId = [...parents].sort((a, b) => b[1] - a[1])[0]?.[0];
        const parent = parentId === undefined ? undefined : previous.get(parentId);
        if (parent && angle(directionForMotion(parent, now.centre), now.direction) > 30 * RAD) {
          changes++;
          comparisons++;
          causes.rift++;
        }
        continue;
      }
      comparisons++;
      const poleChange = angle(before.pole, now.pole);
      const targetPoleChange = angle(before.targetPole, now.targetPole);
      const speedDropped = now.speed < before.speed * 0.98 && poleChange < RAD;
      if (speedDropped && !activeCollision.has(id)) {
        activeCollision.add(id);
        collisionTravel.set(id, 0);
        collisionStarts++;
      }
      if (activeCollision.has(id)) {
        const travel = collisionTravel.get(id)! + before.speed * dt;
        collisionTravel.set(id, travel);
        maxPenetration = Math.max(maxPenetration, travel);
        if (now.speed >= now.target * 0.9 || poleChange >= RAD) activeCollision.delete(id);
      }
      if (angle(before.direction, now.direction) <= 30 * RAD) continue;
      changes++;
      if (targetPoleChange >= RAD) causes.reorganization++;
      else if (activeSuture.has(id)) causes.collision++;
      else causes.transfer++;
    }
    previous = current;
    previousPlateId = Int32Array.from(world.planet.fields.plateId);
  }
  return {
    start,
    resolution: `${width}x${height}`,
    minimumStepYears: 1e6,
    steps,
    ...surfaceStats(world.planet),
    continentalCollisions: Math.round(collisionStarts / 2),
    maxPenetrationKm: maxPenetration / 1000,
    recordedContinentalCollisions:
      (world.planet.geosphere as { continentalCollisionCount?: number })
        .continentalCollisionCount ?? null,
    recordedMaxPenetrationKm:
      ((world.planet.geosphere as { maxContinentalCollisionPenetration?: number })
        .maxContinentalCollisionPenetration ?? 0) / 1000 || null,
    directionChanges: changes,
    directionChangesPerPlateGyr: changes / (comparisons / steps),
    causes,
  };
}

describe('plate calibration measurement', () => {
  it.runIf(RUN)(
    'prints one-gigayear plate metrics',
    async () => {
      const cases = [
        ['young', 128, 64],
        ['young', 256, 128],
        ['quick', 128, 64],
        ['quick', 256, 128],
      ] as const;
      for (const [start, width, height] of cases) {
        if (START && start !== START) continue;
        if (WIDTH && width !== WIDTH) continue;
        console.log('PLATE_MEASURE', JSON.stringify(await measure(start, width, height)));
      }
    },
    3_600_000,
  );
});
