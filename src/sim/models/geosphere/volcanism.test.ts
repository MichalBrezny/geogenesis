import { describe, expect, it } from 'vitest';
import { areaWeightedMean } from '../../core/grid';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import { createSimulation } from '../../simulation';
import { createCarbonCycle, tectonicActivity } from '../atmosphere/carbon';
import { createPlateDrift } from './drift';
import { anchorPlates } from './plates';
import { generateTectonicPlanet } from './tectonics';
import { decayAerosol, HOTSPOT_SHARE, samplePoisson, volcanicActivityModel } from './volcanism';

describe('spatial volcanism', () => {
  it('preserves the old Earth-reference outgassing normalization', () => {
    const planet = createPlanet({ width: 64, height: 32, seed: 21 });
    planet.globals.year = 4.5e9;
    generateTectonicPlanet(planet);
    volcanicActivityModel.runOneStep(planet, 0, createRng(1));
    const expected = HOTSPOT_SHARE + (1 - HOTSPOT_SHARE) * tectonicActivity(planet);
    expect(areaWeightedMean(planet.grid, planet.fields.volcanicActivity)).toBeCloseTo(expected, 5);
    createCarbonCycle().runOneStep(planet, 0, createRng(2));
    expect(planet.globals.carbon.outgassing).toBeCloseTo(expected, 5);
  });

  it('leaves a volcanic chain as an oceanic plate moves over a fixed hotspot', () => {
    const planet = createPlanet({ width: 128, height: 64, seed: 22 });
    planet.globals.year = 4.5e9;
    generateTectonicPlanet(planet, { plateCount: 1, oceanFraction: 1 });
    planet.fields.crustType.fill(0);
    planet.fields.elevation.fill(-4500);
    anchorPlates(planet);
    planet.geosphere.hotspots = [
      {
        id: 0,
        position: [1, 0, 0],
        strength: 1,
        birthYear: 0,
        deathYear: 1e9,
      },
    ];
    const simulation = createSimulation(
      [createPlateDrift({ reorganizationInterval: 1e20 }), volcanicActivityModel],
      ['elevation', 'upliftRate', 'plateId', 'crustType'],
    );
    for (let step = 0; step < 30; step++) simulation.step(planet, 1e6);
    expect(Math.max(...planet.fields.elevation)).toBeGreaterThan(0);
    expect(planet.fields.elevation.filter((height) => height > -2000).length).toBeGreaterThan(1);
  }, 20_000);

  it('samples the same eruption rate across different step lengths', () => {
    let oneStep = 0;
    let tenSteps = 0;
    for (let seed = 1; seed <= 2_000; seed++) {
      oneStep += samplePoisson(10, createRng(seed));
      const rng = createRng(seed);
      for (let step = 0; step < 10; step++) tenSteps += samplePoisson(1, rng);
    }
    expect(Math.abs(oneStep - tenSteps) / oneStep).toBeLessThan(0.03);
  });

  it('decays aerosol forcing independently of step length', () => {
    const one = decayAerosol(4, 5);
    let split = 4;
    for (let year = 0; year < 5; year++) split = decayAerosol(split, 1);
    expect(split).toBeCloseTo(one, 12);
  });
});
