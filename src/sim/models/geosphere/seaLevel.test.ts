import { describe, expect, it } from 'vitest';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import { generateTectonicPlanet } from './tectonics';
import {
  basinWaterGel,
  equilibriumSeaLevel,
  initializeWaterInventory,
  landSurfaceFraction,
  seaLevelModel,
  WATER_GEL_PER_BAR,
} from './seaLevel';

describe('seaLevelModel', () => {
  it('reproduces the initialized datum from the conserved inventory', () => {
    const planet = createPlanet({ width: 32, height: 16, seed: 7 });
    generateTectonicPlanet(planet);
    initializeWaterInventory(planet);
    expect(equilibriumSeaLevel(planet)).toBeCloseTo(0, 8);
    expect(planet.globals.water).toBeCloseTo(
      basinWaterGel(planet.grid, planet.fields.elevation, 0) + 0.0025 * WATER_GEL_PER_BAR,
      3,
    );
  });

  it('puts ten percent of an Earth-like inventory only in low basins', () => {
    const planet = createPlanet({ width: 32, height: 16, seed: 8 });
    generateTectonicPlanet(planet);
    initializeWaterInventory(planet);
    planet.globals.water *= 0.1;
    planet.globals.atmosphere.waterVapor = 0;
    planet.globals.seaLevel = equilibriumSeaLevel(planet);
    const land = landSurfaceFraction(planet.grid, planet.fields.elevation, planet.globals.seaLevel);
    expect(land).toBeGreaterThan(0.7);
    expect(land).toBeLessThan(1);
    expect(planet.globals.seaLevel).toBeLessThan(0);
  });

  it('gives Earth-like ice tens of metres of sea-level equivalent and snowballs hundreds', () => {
    const planet = createPlanet({ width: 16, height: 8 });
    for (let y = 0; y < planet.grid.height; y++) {
      for (let x = 0; x < planet.grid.width; x++) {
        const i = y * planet.grid.width + x;
        planet.fields.elevation[i] = x < 11 ? -1000 : 100;
      }
    }
    initializeWaterInventory(planet);
    for (let i = 0; i < planet.grid.cellCount; i++) {
      if (planet.fields.elevation[i]! >= 0) planet.fields.iceThickness[i] = 150;
    }
    expect(equilibriumSeaLevel(planet)).toBeLessThan(-50);
    expect(equilibriumSeaLevel(planet)).toBeGreaterThan(-150);
    for (let i = 0; i < planet.grid.cellCount; i++) {
      if (planet.fields.elevation[i]! >= 0) planet.fields.iceThickness[i] = 2000;
    }
    expect(equilibriumSeaLevel(planet)).toBeLessThan(-500);
  });

  it('falls as land ice grows, exposes land, and recovers after the ice melts', () => {
    const planet = createPlanet({ width: 16, height: 8 });
    for (let y = 0; y < planet.grid.height; y++) {
      for (let x = 0; x < planet.grid.width; x++) {
        const i = y * planet.grid.width + x;
        planet.fields.elevation[i] = x < 7 ? -100 : x < 10 ? -50 : 100;
      }
    }
    initializeWaterInventory(planet);
    for (let i = 0; i < planet.grid.cellCount; i++) {
      if (planet.fields.elevation[i]! >= 0) planet.fields.iceThickness[i] = 200;
    }
    const beforeLand = landSurfaceFraction(
      planet.grid,
      planet.fields.elevation,
      planet.globals.seaLevel,
    );
    seaLevelModel.runOneStep(planet, 10_000, createRng(1));
    const glacialLevel = planet.globals.seaLevel;
    expect(glacialLevel).toBeLessThan(-50);
    expect(
      landSurfaceFraction(planet.grid, planet.fields.elevation, planet.globals.seaLevel),
    ).toBeGreaterThan(beforeLand);

    planet.fields.iceThickness.fill(0);
    seaLevelModel.runOneStep(planet, 10_000, createRng(1));
    expect(planet.globals.seaLevel).toBeGreaterThan(glacialLevel);
    expect(planet.globals.seaLevel).toBeLessThan(0);
  });
});
