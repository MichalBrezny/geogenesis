import { describe, expect, it } from 'vitest';
import { areaWeightedMean } from './core/grid';
import { lifeClassIndex } from './data/lifeClasses';
import { continentalCrustTarget } from './models/geosphere/drift';
import { equilibriumSeaLevel, seaLevelForWaterGel } from './models/geosphere/seaLevel';
import { updateSurfacePressure } from './models/atmosphere/atmosphere';
import { createPlanetPreset, createRandomWorld, PLANET_START_AGES } from './world';
import { createScenario, restoreScenario } from './scenarios';
import { deserializeGame, serializeGame } from './serialize';

describe('random-world starts', () => {
  it('runs a dry planet without oceans or non-finite climate fields', () => {
    const world = createRandomWorld({ start: 'quick', seed: 22, width: 32, height: 16 });
    const { planet } = world;
    planet.globals.water = 0;
    planet.globals.atmosphere.waterVapor = 0;
    planet.fields.iceThickness.fill(0);
    planet.globals.seaLevel = equilibriumSeaLevel(planet);
    updateSurfacePressure(planet.globals);
    for (let step = 0; step < 3; step++) world.simulation.step(planet, 1e6);

    expect(Array.from(planet.fields.elevation).every(Number.isFinite)).toBe(true);
    expect(Array.from(planet.fields.airTemperature).every(Number.isFinite)).toBe(true);
    expect(Array.from(planet.fields.precipitation).every((value) => value === 0)).toBe(true);
    expect(Array.from(planet.fields.oceanAnomaly).every((value) => value === 0)).toBe(true);
    expect(planet.fields.elevation.every((elevation) => elevation >= planet.globals.seaLevel)).toBe(
      true,
    );
  });

  it('creates a lifeless 0.5 Gyr young planet by default with little continental crust', () => {
    const world = createRandomWorld({ seed: 12, width: 32, height: 16 });
    expect(world.planet.globals.year).toBe(PLANET_START_AGES.young);
    expect(world.planet.biota.appeared.every((year) => year === null)).toBe(true);
    expect(world.planet.globals.solarInput).toBeLessThan(0.8);
    expect(areaWeightedMean(world.planet.grid, world.planet.fields.crustType)).toBeLessThan(0.18);
    expect(world.settings?.start).toBe('young');
  });

  it('creates an anoxic seeded microbial world and preserves the former quick start', () => {
    const microbial = createRandomWorld({
      start: 'microbial',
      seed: 13,
      width: 32,
      height: 16,
    });
    const quick = createRandomWorld({ start: 'quick', seed: 14, width: 32, height: 16 });
    const prokaryotes = lifeClassIndex('prokaryotes');
    const eukaryotes = lifeClassIndex('eukaryotes');
    expect(microbial.planet.globals.year).toBe(PLANET_START_AGES.microbial);
    expect(microbial.planet.biota.cover[prokaryotes]).toBeGreaterThan(0);
    expect(microbial.planet.globals.atmosphere.o2).toBe(0);
    expect(quick.planet.globals.year).toBe(PLANET_START_AGES.quick);
    expect(quick.planet.biota.cover[prokaryotes]).toBeGreaterThan(0);
    expect(quick.planet.biota.appeared[eukaryotes]).toBeNull();
  });
});

describe('continental growth target', () => {
  it('grows from small cratons at 0.5 Gyr to nearly modern cover by 2.5–3 Gyr', () => {
    expect(continentalCrustTarget(0.5e9)).toBeGreaterThan(0.1);
    expect(continentalCrustTarget(0.5e9)).toBeLessThan(0.14);
    expect(continentalCrustTarget(2.5e9)).toBeGreaterThan(0.3);
    expect(continentalCrustTarget(10e9)).toBeCloseTo(0.31, 3);
    expect(continentalCrustTarget(10e9, 0.14)).toBeCloseTo(0.155, 3);
    expect(continentalCrustTarget(10e9, 0)).toBe(0);
  });
});

describe('planet presets', () => {
  for (const scenario of ['mars', 'venus'] as const) {
    it(`creates, steps, saves and restores ${scenario} without non-finite state`, () => {
      const world = createScenario(scenario, { seed: 9, width: 32, height: 16 });
      if (scenario === 'mars') {
        expect(world.planet.globals.meanTemperature).toBeGreaterThan(-80);
        expect(world.planet.globals.meanTemperature).toBeLessThan(-50);
      } else {
        expect(world.planet.globals.meanTemperature).toBeGreaterThan(400);
      }
      world.simulation.step(world.planet, 10e6);
      const loaded = deserializeGame(serializeGame({ scenario, planet: world.planet }));
      const restored = restoreScenario(scenario, loaded.planet, loaded.settings);
      restored.simulation.step(restored.planet, 10e6);
      expect(Number.isFinite(restored.planet.globals.meanTemperature)).toBe(true);
      expect(Number.isFinite(restored.planet.globals.surfacePressure)).toBe(true);
      expect(restored.planet.fields.airTemperature.every(Number.isFinite)).toBe(true);
      expect(restored.planet.planetParams.radius).toBe(scenario === 'mars' ? 3_390_000 : 6_052_000);
      if (scenario === 'mars') {
        expect(restored.planet.globals.co2Ice).toBeGreaterThan(0);
        expect(
          restored.planet.globals.atmosphere.co2 * 1e-6 +
            restored.planet.globals.co2Ice +
            restored.planet.globals.crustalCarbon,
        ).toBeCloseTo(0.0559, 3);
        expect(restored.planet.geosphere.fixedObliquity).toBe(true);
      }
    });
  }

  it('retains the major Mars relief over a 10 Myr preset step', () => {
    const world = createPlanetPreset('mars', { seed: 9, width: 128, height: 64 });
    const { planet } = world;
    planet.disasters.impacts = false;
    planet.disasters.supervolcanoes = false;

    world.simulation.step(planet, 10e6);

    expect(neighborhoodExtreme(planet, 18.6, 226, 1, 'highest')).toBeGreaterThan(15_000);
    expect(neighborhoodExtreme(planet, -42, 70, 6, 'lowest')).toBeLessThan(-6_500);
    expect(planet.fields.upliftRate.every((value) => value === 0)).toBe(true);
  });

  it('fills Hellas and the northern lowlands before the southern highlands', () => {
    const world = createPlanetPreset('mars', { seed: 9, width: 128, height: 64 });
    const { planet } = world;
    const lowest = extremeCell(planet.fields.elevation, 'lowest');
    const lowestLatitude =
      90 - ((Math.floor(lowest / planet.grid.width) + 0.5) * 180) / planet.grid.height;
    const lowestLongitude = ((lowest % planet.grid.width) + 0.5) * (360 / planet.grid.width);

    expect(planet.globals.seaLevel).toBeLessThan(-6_500);
    expect(lowestLatitude).toBeGreaterThan(-55);
    expect(lowestLatitude).toBeLessThan(-25);
    expect(lowestLongitude).toBeGreaterThan(40);
    expect(lowestLongitude).toBeLessThan(100);

    const terraformedSeaLevel = seaLevelForWaterGel(planet.grid, planet.fields.elevation, 300);
    expect(neighborhoodExtreme(planet, -42, 70, 2, 'lowest')).toBeLessThan(terraformedSeaLevel);
    expect(neighborhoodExtreme(planet, 50, 150, 2, 'highest')).toBeLessThan(terraformedSeaLevel);
    expect(neighborhoodExtreme(planet, -30, 150, 2, 'lowest')).toBeGreaterThan(terraformedSeaLevel);
  });
});

type PresetPlanet = ReturnType<typeof createPlanetPreset>['planet'];

function coordinateCell(planet: PresetPlanet, latitude: number, longitude: number): number {
  const { width, height } = planet.grid;
  const x = Math.floor(((((longitude % 360) + 360) % 360) / 360) * width);
  const y = Math.min(height - 1, Math.floor(((90 - latitude) / 180) * height));
  return y * width + x;
}

function neighborhoodExtreme(
  planet: PresetPlanet,
  latitude: number,
  longitude: number,
  radius: number,
  which: 'highest' | 'lowest',
): number {
  const { width, height } = planet.grid;
  const center = coordinateCell(planet, latitude, longitude);
  const centerX = center % width;
  const centerY = Math.floor(center / width);
  let result = which === 'highest' ? -Infinity : Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = Math.max(0, Math.min(height - 1, centerY + dy));
    for (let dx = -radius; dx <= radius; dx++) {
      const x = (centerX + dx + width) % width;
      const value = planet.fields.elevation[y * width + x]!;
      result = which === 'highest' ? Math.max(result, value) : Math.min(result, value);
    }
  }
  return result;
}

function extremeCell(elevation: Float32Array, which: 'highest' | 'lowest'): number {
  let result = 0;
  for (let i = 1; i < elevation.length; i++) {
    if (
      (which === 'highest' && elevation[i]! > elevation[result]!) ||
      (which === 'lowest' && elevation[i]! < elevation[result]!)
    ) {
      result = i;
    }
  }
  return result;
}
