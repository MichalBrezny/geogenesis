import { describe, expect, it } from 'vitest';
import { createPlanet } from './core/planet';
import { createRng } from './core/rng';
import { gaiaDiagnostic, gaiaHealthScore, type GaiaScoreInputs } from './diagnostics';
import { createRandomWorld } from './world';
import { createClimate, greenhouseForcing } from './models/atmosphere/climate';
import { createSurfaceAlbedo } from './models/atmosphere/surfaceAlbedo';

describe('planet explanations', () => {
  it('records carbon terms that sum to the net rate for several quick-world steps', () => {
    const world = createRandomWorld({ start: 'quick', seed: 17, width: 16, height: 8 });
    for (let step = 0; step < 3; step++) {
      world.simulation.step(world.planet, 500_000);
      const budget = world.planet.globals.carbonBudget;
      const terms = [
        budget.volcanicOutgassing,
        budget.lipOutgassing,
        budget.landWeathering,
        budget.seafloorWeathering,
        budget.organicBurial,
        budget.civilizationEmissions,
        budget.clathrateRelease,
        budget.deviceSources,
        budget.deviceSinks,
      ];
      expect(terms.reduce((sum, term) => sum + term.microbarPerYear, 0)).toBeCloseTo(
        budget.net.microbarPerYear,
        12,
      );
      expect(terms.reduce((sum, term) => sum + term.gtCarbonPerYear, 0)).toBeCloseTo(
        budget.net.gtCarbonPerYear,
        12,
      );
    }
  });

  it('splits the exact greenhouse calculation into the recorded energy terms', () => {
    const planet = createPlanet({ width: 16, height: 8 });
    planet.fields.elevation.fill(-4000);
    createSurfaceAlbedo().runOneStep(planet, 0, createRng(1));
    createClimate().runOneStep(planet, 0, createRng(1));
    const terms = planet.globals.energyBalance.greenhouse;
    expect(terms.co2 + terms.waterVapor + terms.methane).toBeCloseTo(
      greenhouseForcing(planet.globals.atmosphere),
      12,
    );
    expect(planet.globals.energyBalance.absorbedSunlight).toBeGreaterThan(0);
    expect(planet.globals.energyBalance.runawayMargin).toBe(planet.globals.runawayMargin);
  });

  it('makes Gaia health monotonic in every healthy and stressful input', () => {
    const baseline: GaiaScoreInputs = {
      biodiversity: 0.5,
      biomassTrend: 0.5,
      habitableArea: 0.5,
      temperatureStress: 0.5,
      acidityStress: 0.5,
      pollutionStress: 0.5,
    };
    const score = gaiaHealthScore(baseline);
    for (const key of ['biodiversity', 'biomassTrend', 'habitableArea'] as const) {
      expect(gaiaHealthScore({ ...baseline, [key]: 0.75 })).toBeGreaterThan(score);
    }
    for (const key of ['temperatureStress', 'acidityStress', 'pollutionStress'] as const) {
      expect(gaiaHealthScore({ ...baseline, [key]: 0.75 })).toBeLessThan(score);
    }
  });

  it('leaves the full simulation state bit-identical when diagnostics are read', () => {
    const read = createRandomWorld({ start: 'quick', seed: 91, width: 16, height: 8 });
    const untouched = createRandomWorld({ start: 'quick', seed: 91, width: 16, height: 8 });
    for (let step = 0; step < 3; step++) {
      read.simulation.step(read.planet, 500_000);
      void gaiaDiagnostic(read.planet);
      void JSON.stringify(read.planet.globals.carbonBudget);
      void JSON.stringify(read.planet.globals.energyBalance);
      untouched.simulation.step(untouched.planet, 500_000);
    }
    expect(read.planet).toEqual(untouched.planet);
  });
});
