import { describe, expect, it } from 'vitest';
import { cellIndex, getTopology, NEIGHBOR_COUNT } from '../../core/grid';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { createLinearDiffuser } from './diffusion';
import { flowRouting, LakeType } from './flowRouting';
import { createStreamPowerEroder } from './streamPower';
import { generateTectonicPlanet, spreadFromBoundaries } from './tectonics';

const rng = createRng(1);

/** Small planet: ocean everywhere except a land ridge sloping east into a basin with a closed pit. */
function valleyPlanet(): PlanetState {
  const planet = createPlanet({ width: 16, height: 8 });
  const { elevation } = planet.fields;
  elevation.fill(-1000);
  for (let x = 2; x <= 10; x++) {
    for (let y = 2; y <= 5; y++) elevation[cellIndex(planet.grid, x, y)] = 100 * (11 - x);
  }
  // A closed depression in the middle of the land.
  elevation[cellIndex(planet.grid, 6, 3)] = 50;
  // A wet, temperate climate, so the rivers carry water.
  planet.fields.precipitation.fill(1200);
  planet.fields.airTemperature.fill(10);
  return planet;
}

/** A broad closed hollow connected to the ocean only across a descending spill channel. */
function lakeBasin(wet: boolean): PlanetState {
  const planet = createPlanet({ width: 16, height: 8 });
  const { elevation, precipitation, airTemperature } = planet.fields;
  elevation.fill(-1000);
  precipitation.fill(wet ? 2000 : 0);
  airTemperature.fill(20);
  for (let y = 1; y <= 6; y++) {
    for (let x = 1; x <= 14; x++) elevation[cellIndex(planet.grid, x, y)] = 800;
  }
  for (let x = 9; x <= 14; x++) {
    elevation[cellIndex(planet.grid, x, 4)] = 800 - (x - 8) * 100;
  }
  for (let y = 3; y <= 4; y++) {
    for (let x = 4; x <= 8; x++) {
      const i = cellIndex(planet.grid, x, y);
      elevation[i] = 100 + (x - 4) * 100;
    }
  }
  if (!wet) precipitation[cellIndex(planet.grid, 8, 3)] = 8000;
  return planet;
}

describe('flowRouting', () => {
  it('drains every land cell to the ocean, also through depressions', () => {
    const planet = valleyPlanet();
    flowRouting.runOneStep(planet, 0, rng);
    const { elevation, flowReceiver } = planet.fields;
    for (let i = 0; i < elevation.length; i++) {
      if (elevation[i]! < 0) {
        expect(flowReceiver[i]).toBe(-1);
        continue;
      }
      let cell = i;
      for (let steps = 0; flowReceiver[cell]! >= 0; steps++) {
        expect(steps).toBeLessThan(elevation.length);
        cell = flowReceiver[cell]!;
      }
      expect(elevation[cell]!).toBeLessThan(0);
    }
  });

  it('orders receivers before donors and conserves drainage area', () => {
    const planet = valleyPlanet();
    flowRouting.runOneStep(planet, 0, rng);
    const { flowReceiver, flowUpstreamOrder, drainageArea } = planet.fields;
    const position = new Int32Array(flowUpstreamOrder.length);
    flowUpstreamOrder.forEach((cell, k) => (position[cell] = k));
    let outletArea = 0;
    let totalArea = 0;
    for (let i = 0; i < flowReceiver.length; i++) {
      totalArea += planet.grid.rowCellArea[Math.floor(i / planet.grid.width)]!;
      const r = flowReceiver[i]!;
      if (r < 0) outletArea += drainageArea[i]!;
      else expect(position[r]!).toBeLessThan(position[i]!);
    }
    expect(outletArea / totalArea).toBeCloseTo(1, 4);
  });

  it('routes to the lowest cell on a planet without ocean', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    planet.fields.elevation.fill(500);
    planet.fields.elevation[5] = 100;
    flowRouting.runOneStep(planet, 0, rng);
    expect(planet.fields.flowReceiver[5]).toBe(-1);
    expect(planet.fields.drainageArea[5]! / 4).toBeGreaterThan(planet.grid.rowCellArea[0]!);
  });

  it('fills and drains a deep one-cell pit without making a lake', () => {
    const planet = createPlanet({ width: 16, height: 8 });
    const { elevation, precipitation, airTemperature, lakeType, flowReceiver } = planet.fields;
    elevation.fill(-1000);
    precipitation.fill(0);
    airTemperature.fill(20);
    for (let y = 2; y <= 5; y++) {
      for (let x = 2; x <= 10; x++) elevation[cellIndex(planet.grid, x, y)] = 500 - x;
    }
    const pit = cellIndex(planet.grid, 6, 3);
    elevation[pit] = elevation[cellIndex(planet.grid, 7, 3)]! - 200;

    flowRouting.runOneStep(planet, 0, rng);

    expect(lakeType[pit]).toBe(LakeType.None);
    expect(flowReceiver[pit]).not.toBe(-1);
  });

  it('makes a dry large closed basin endorheic below its rim', () => {
    const wet = lakeBasin(true);
    flowRouting.runOneStep(wet, 0, rng);
    const fresh = Array.from(wet.fields.lakeType, (kind, i) =>
      kind === LakeType.Fresh ? i : -1,
    ).filter((i) => i >= 0);
    const freshSet = new Set(fresh);
    const exit = fresh.find((i) => {
      const r = wet.fields.flowReceiver[i]!;
      return r >= 0 && !freshSet.has(r);
    });
    expect(exit).toBeDefined();
    const downstream = wet.fields.flowReceiver[exit!]!;
    expect(wet.fields.discharge[downstream]).toBeGreaterThan(0);

    const dry = lakeBasin(false);
    flowRouting.runOneStep(dry, 0, rng);
    const salt = dry.fields.lakeType.filter((kind) => kind === LakeType.Salt).length;
    expect(salt).toBeGreaterThan(0);
    expect(salt).toBeLessThan(fresh.length);
    expect(dry.fields.flowReceiver[exit!]).toBe(-1);
    expect(dry.fields.discharge[downstream]).toBe(0);
  });

  it('lets a humid closed basin fill as a freshwater lake and overflow', () => {
    const planet = lakeBasin(true);
    flowRouting.runOneStep(planet, 0, rng);
    const lake = Array.from(planet.fields.lakeType, (kind, i) =>
      kind === LakeType.Fresh ? i : -1,
    ).filter((i) => i >= 0);
    expect(lake.length).toBeGreaterThan(1);
    const lakeSet = new Set(lake);
    expect(
      lake.some((i) => {
        const receiver = planet.fields.flowReceiver[i]!;
        return receiver >= 0 && !lakeSet.has(receiver);
      }),
    ).toBe(true);
  });
});

describe('streamPowerEroder', () => {
  it('lowers land towards base level, never below its receiver or sea level', () => {
    const planet = valleyPlanet();
    flowRouting.runOneStep(planet, 0, rng);
    const before = Float32Array.from(planet.fields.elevation);
    createStreamPowerEroder({ erodibility: 1e-6 }).runOneStep(planet, 1e7, rng);
    const { elevation, flowReceiver } = planet.fields;
    let lowered = 0;
    for (let i = 0; i < elevation.length; i++) {
      expect(elevation[i]!).toBeLessThanOrEqual(before[i]!);
      if (elevation[i]! < before[i]!) lowered++;
      const r = flowReceiver[i]!;
      if (r >= 0 && before[i]! > Math.max(before[r]!, 0)) {
        expect(elevation[i]!).toBeGreaterThanOrEqual(Math.max(elevation[r]!, 0) - 1e-3);
      }
    }
    expect(lowered).toBeGreaterThan(0);
  });

  it('cuts faster where more water runs off', () => {
    const erosion = (precipitation: number) => {
      const planet = valleyPlanet();
      planet.fields.precipitation.fill(precipitation);
      flowRouting.runOneStep(planet, 0, rng);
      const before = planet.fields.elevation.reduce((sum, e) => sum + Math.max(0, e), 0);
      createStreamPowerEroder({ erodibility: 1e-7 }).runOneStep(planet, 1e7, rng);
      return before - planet.fields.elevation.reduce((sum, e) => sum + Math.max(0, e), 0);
    };
    expect(erosion(2000)).toBeGreaterThan(1.5 * erosion(400));
  });

  it('does not incise a closed depression while its outlet stays above it', () => {
    const planet = valleyPlanet();
    flowRouting.runOneStep(planet, 0, rng);
    createStreamPowerEroder({ erodibility: 1e-9 }).runOneStep(planet, 1e6, rng);
    expect(planet.fields.elevation[cellIndex(planet.grid, 6, 3)]).toBe(50);
  });
});

describe('linearDiffuser', () => {
  it('conserves land volume away from the coast and stays stable for huge time steps', () => {
    const planet = createPlanet({ width: 32, height: 16 });
    const { elevation } = planet.fields;
    elevation.fill(1000);
    elevation[cellIndex(planet.grid, 10, 8)] = 5000;
    const volume = () => {
      let v = 0;
      for (let i = 0; i < elevation.length; i++)
        v += elevation[i]! * planet.grid.rowCellArea[Math.floor(i / planet.grid.width)]!;
      return v;
    };
    const before = volume();
    createLinearDiffuser({ diffusivity: 1e4 }).runOneStep(planet, 1e8, rng);
    expect(volume() / before).toBeCloseTo(1, 4);
    expect(Math.max(...elevation)).toBeLessThan(5000);
    expect(Math.min(...elevation)).toBeGreaterThanOrEqual(1000 - 1e-3);
  });
});

describe('generateTectonicPlanet', () => {
  it('assigns every cell to a plate and roughly honours the ocean fraction', () => {
    const planet = createPlanet({ seed: 9 });
    generateTectonicPlanet(planet, { oceanFraction: 0.7 });
    const { plateId, elevation } = planet.fields;
    expect(Math.min(...plateId)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...plateId)).toBeLessThan(planet.plates.length);
    const ocean = elevation.filter((e) => e < 0).length / elevation.length;
    expect(ocean).toBeGreaterThan(0.6);
    expect(ocean).toBeLessThan(0.8);
  });

  it('only uplifts cells next to or near a plate boundary', () => {
    const planet = createPlanet({ seed: 9 });
    generateTectonicPlanet(planet);
    const { neighbors } = getTopology(planet.grid);
    const { plateId, upliftRate } = planet.fields;
    // Distance (in cells) to the nearest boundary, by breadth-first search.
    const distance = new Int32Array(plateId.length).fill(-1);
    const queue: number[] = [];
    for (let i = 0; i < plateId.length; i++) {
      for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
        const n = neighbors[i * NEIGHBOR_COUNT + d]!;
        if (n >= 0 && plateId[n] !== plateId[i]) {
          distance[i] = 0;
          queue.push(i);
          break;
        }
      }
    }
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k]!;
      for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
        const n = neighbors[c * NEIGHBOR_COUNT + d]!;
        if (n >= 0 && distance[n] === -1) {
          distance[n] = distance[c]! + 1;
          queue.push(n);
        }
      }
    }
    let uplifted = 0;
    for (let i = 0; i < upliftRate.length; i++) {
      if (upliftRate[i]! > 0) {
        uplifted++;
        expect(distance[i]!).toBeLessThanOrEqual(3);
      }
    }
    expect(uplifted).toBeGreaterThan(0);
  });
});

describe('spreadFromBoundaries', () => {
  it('matches a full-grid sweep', () => {
    const planet = createPlanet({ width: 64, height: 32 });
    const { neighbors } = getTopology(planet.grid);
    const rand = createRng(3);
    const input = new Float32Array(planet.grid.cellCount);
    for (let i = 0; i < input.length; i++) {
      if (rand.next() < 0.05) input[i] = (rand.next() * 2 - 1) * 4000;
    }

    // Reference: the straightforward sweep over every cell in every pass.
    const expected = Float32Array.from(input);
    const passes = Math.max(1, Math.round(700_000 / planet.grid.dy));
    const decay = Math.exp(-planet.grid.dy / 350_000);
    for (let pass = 0; pass < passes; pass++) {
      const next = Float32Array.from(expected);
      for (let i = 0; i < expected.length; i++) {
        for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
          const n = neighbors[i * NEIGHBOR_COUNT + d]!;
          if (n < 0) continue;
          const candidate = expected[n]! * decay;
          if (Math.abs(candidate) > Math.abs(next[i]!)) next[i] = candidate;
        }
      }
      expected.set(next);
    }

    const actual = Float32Array.from(input);
    spreadFromBoundaries(planet, actual);
    expect(actual).toEqual(expected);
  });
});
