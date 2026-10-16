import { describe, expect, it } from 'vitest';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import { equilibriumSeaLevel, landSurfaceFraction, seaLevelModel } from './seaLevel';

describe('seaLevelModel', () => {
  it('gives Earth-like ice tens of metres of sea-level equivalent and snowballs hundreds', () => {
    const planet = createPlanet({ width: 16, height: 8 });
    for (let y = 0; y < planet.grid.height; y++) {
      for (let x = 0; x < planet.grid.width; x++) {
        const i = y * planet.grid.width + x;
        planet.fields.elevation[i] = x < 11 ? -1000 : 100;
        if (x >= 11) planet.fields.iceCover[i] = 0.15;
      }
    }
    expect(equilibriumSeaLevel(planet)).toBeLessThan(-50);
    expect(equilibriumSeaLevel(planet)).toBeGreaterThan(-150);
    for (let i = 0; i < planet.grid.cellCount; i++) {
      if (planet.fields.elevation[i]! >= 0) planet.fields.iceCover[i] = 1;
    }
    expect(equilibriumSeaLevel(planet)).toBeLessThan(-500);
  });

  it('falls as land ice grows, exposes land, and recovers after the ice melts', () => {
    const planet = createPlanet({ width: 16, height: 8 });
    for (let y = 0; y < planet.grid.height; y++) {
      for (let x = 0; x < planet.grid.width; x++) {
        const i = y * planet.grid.width + x;
        planet.fields.elevation[i] = x < 7 ? -100 : x < 10 ? -50 : 100;
        if (planet.fields.elevation[i]! >= 0) planet.fields.iceCover[i] = 0.2;
      }
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

    planet.fields.iceCover.fill(0);
    seaLevelModel.runOneStep(planet, 10_000, createRng(1));
    expect(planet.globals.seaLevel).toBeGreaterThan(glacialLevel);
    expect(planet.globals.seaLevel).toBeLessThan(0);
  });
});
