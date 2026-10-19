import { describe, expect, it } from 'vitest';
import { areaWeightedMean, getTopology, NEIGHBOR_COUNT } from '../../core/grid';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import { createSimulation } from '../../simulation';
import { createRandomWorld } from '../../world';
import { cleanupPlateFragments, createPlateDrift } from './drift';
import { anchorPlates, referenceCell, rotatePlate, valueComponents } from './plates';
import { generateTectonicPlanet } from './tectonics';

describe('plates', () => {
  it('a full turn about the Euler pole maps every cell back to itself', () => {
    const planet = createPlanet({ width: 32, height: 16 });
    generateTectonicPlanet(planet, { plateCount: 3 });
    const plate = planet.plates[0]!;
    for (let k = 0; k < 8; k++) rotatePlate(plate, Math.PI / 4);
    for (let i = 0; i < planet.grid.cellCount; i++) {
      expect(referenceCell(planet.grid, plate, i)).toBe(i);
    }
  });

  it('removes noise-warped Voronoi exclaves before crust is anchored', () => {
    const planet = createPlanet({ width: 128, height: 64, seed: 19 });
    generateTectonicPlanet(planet);
    for (const plate of planet.plates) {
      expect(
        valueComponents(planet.grid, planet.fields.plateId, plate.id).length,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('keeps Euler poles away from plate interiors', () => {
    const planet = createPlanet({ width: 128, height: 64, seed: 23 });
    generateTectonicPlanet(planet);
    const positions = planet.grid.cellPosition;
    for (const plate of planet.plates) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let cell = 0; cell < planet.grid.cellCount; cell++) {
        if (!plate.crust.owned[cell]) continue;
        x += positions[cell * 3]!;
        y += positions[cell * 3 + 1]!;
        z += positions[cell * 3 + 2]!;
      }
      const length = Math.hypot(x, y, z);
      const dot =
        (x * plate.eulerPole[0] + y * plate.eulerPole[1] + z * plate.eulerPole[2]) / length;
      expect(Math.abs(dot)).toBeLessThan(1e-10);
    }
  });
});

describe('plateDrift', () => {
  function driftOnly(seed: number) {
    const planet = createPlanet({ seed });
    generateTectonicPlanet(planet);
    const simulation = createSimulation(
      [createPlateDrift()],
      ['elevation', 'upliftRate', 'plateId', 'crustType'],
    );
    return { planet, simulation };
  }

  it('moves plates', () => {
    const { planet, simulation } = driftOnly(3);
    const before = Int32Array.from(planet.fields.plateId);
    for (let s = 0; s < 20; s++) simulation.step(planet, 1e6);
    const changed = planet.fields.plateId.filter((id, i) => id !== before[i]).length;
    expect(changed).toBeGreaterThan(planet.grid.cellCount * 0.02);
  });

  it('keeps continental crust and plate count roughly stable over 500 Myr', () => {
    // A mature planet: young ones grow their continents on purpose.
    const { planet, simulation } = createRandomWorld({ seed: 4, start: 'quick' });
    const startCrust = areaWeightedMean(planet.grid, planet.fields.crustType);
    for (let s = 0; s < 500; s++) simulation.step(planet, 1e6);
    const crust = areaWeightedMean(planet.grid, planet.fields.crustType);
    expect(crust).toBeGreaterThan(startCrust * 0.7);
    expect(crust).toBeLessThan(startCrust * 1.3);
    expect(new Set(planet.fields.plateId).size).toBeGreaterThanOrEqual(
      planet.geosphere.initialPlateCount - 4,
    );
  }, 60_000);

  it('keeps plates contiguous (few cells surrounded by another plate)', () => {
    const { planet, simulation } = driftOnly(5);
    for (let s = 0; s < 200; s++) simulation.step(planet, 1e6);
    const { neighbors } = getTopology(planet.grid);
    const plateId = planet.fields.plateId;
    let isolated = 0;
    const areas = new Float64Array(planet.plates.length);
    for (let i = 0; i < plateId.length; i++) {
      let same = 0;
      for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
        const n = neighbors[i * NEIGHBOR_COUNT + d]!;
        if (n >= 0 && plateId[n] === plateId[i]) same++;
      }
      if (same === 0) isolated++;
      areas[plateId[i]!] =
        areas[plateId[i]!]! + planet.grid.rowCellArea[Math.floor(i / planet.grid.width)]!;
    }
    expect(isolated / plateId.length).toBeLessThan(0.01);
    for (const plate of planet.plates) {
      for (const piece of valueComponents(planet.grid, plateId, plate.id)) {
        expect(piece.length).toBeGreaterThan(3);
      }
    }
    const totalArea = 4 * Math.PI * planet.grid.radius * planet.grid.radius;
    expect(Math.max(...areas) / totalArea).toBeLessThan(0.35);
  }, 60_000);

  it('is deterministic for a seed', () => {
    const a = driftOnly(6);
    const b = driftOnly(6);
    for (let s = 0; s < 30; s++) {
      a.simulation.step(a.planet, 1e6);
      b.simulation.step(b.planet, 1e6);
    }
    expect(a.planet.fields.elevation).toEqual(b.planet.fields.elevation);
    expect(a.planet.fields.plateId).toEqual(b.planet.fields.plateId);
  });

  it('does not move plates when the speed factor is 0', () => {
    const planet = createPlanet({ seed: 7 });
    planet.globals.year = 4.5e9;
    generateTectonicPlanet(planet);
    const before = Int32Array.from(planet.fields.plateId);
    // Ocean floor still cools and crust still accretes; only the plates stand still.
    createPlateDrift({ speedFactor: 0 }).runOneStep(planet, 1e7, createRng(1));
    expect(planet.fields.plateId).toEqual(before);
  });

  it('transfers a small detached piece between reference rasters without losing crust', () => {
    const planet = createPlanet({ width: 128, height: 64, seed: 8 });
    generateTectonicPlanet(planet, { plateCount: 2 });
    const { width, height } = planet.grid;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) planet.fields.plateId[y * width + x] = x < width / 2 ? 0 : 1;
    }
    const detached = Math.floor(height / 2) * width + Math.floor((width * 3) / 4);
    planet.fields.plateId[detached] = 0;
    anchorPlates(planet);
    const before = planet.plates.reduce(
      (sum, plate) => sum + plate.crust.owned.reduce((plateSum, value) => plateSum + value, 0),
      0,
    );
    expect(cleanupPlateFragments(planet, createRng(2))).toBe(true);
    const after = planet.plates.reduce(
      (sum, plate) => sum + plate.crust.owned.reduce((plateSum, value) => plateSum + value, 0),
      0,
    );
    expect(after).toBe(before);
    expect(planet.plates[0]!.crust.owned[detached]).toBe(0);
    expect(planet.plates[1]!.crust.owned[detached]).toBe(1);
  });

  it('turns a large detached continental piece into a new stable plate id', () => {
    const planet = createPlanet({ width: 128, height: 64, seed: 9 });
    generateTectonicPlanet(planet, { plateCount: 2 });
    const { width, height } = planet.grid;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) planet.fields.plateId[y * width + x] = x < width / 2 ? 0 : 1;
    }
    const row = Math.floor(height / 2);
    // Four cells exceed the explicit 1-3-cell speck threshold as well as the
    // physical terrane-area threshold, so this is a genuine daughter plate.
    for (let x = 90; x < 94; x++) {
      const i = row * width + x;
      planet.fields.plateId[i] = 0;
      planet.fields.crustType[i] = 1;
    }
    anchorPlates(planet);
    expect(cleanupPlateFragments(planet, createRng(3))).toBe(true);
    expect(planet.plates.length).toBe(3);
    expect(
      planet.plates[2]!.crust.owned.reduce((sum, value) => sum + value, 0),
    ).toBeGreaterThanOrEqual(4);
    expect(planet.plates[2]!.eulerPole).not.toEqual(planet.plates[0]!.eulerPole);
  });
});
