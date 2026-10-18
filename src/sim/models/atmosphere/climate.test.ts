import { describe, expect, it } from 'vitest';
import { areaWeightedMean, createGrid } from '../../core/grid';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { generateTectonicPlanet } from '../geosphere/tectonics';
import {
  annualInsolation,
  createClimate,
  firstAnnualInsolationHarmonic,
  greenhouseForcing,
  heatTransportScale,
  outgoingLongwaveRadiation,
  seasonalTemperatureAmplitude,
  thinInsolationContrastScale,
  thinSeasonalAmplitudeScale,
  tidallyLockedInsolation,
  WET_OLR_LIMIT,
} from './climate';
import { REFERENCE_SURFACE_PRESSURE } from './atmosphere';
import { SOLAR_CONSTANT, starProperties, stellarLuminosity, SUN_AGE } from './star';
import { createSurfaceAlbedo } from './surfaceAlbedo';

const rng = createRng(1);

function oceanPlanet(): PlanetState {
  const planet = createPlanet({ width: 64, height: 32 });
  planet.fields.elevation.fill(-4000);
  createSurfaceAlbedo().runOneStep(planet, 0, rng);
  return planet;
}

function earthLike(): PlanetState {
  const planet = createPlanet({ seed: 3 });
  generateTectonicPlanet(planet);
  planet.fields.precipitation.fill(500);
  createSurfaceAlbedo().runOneStep(planet, 0, rng);
  return planet;
}

describe('star', () => {
  it('is about 70% as bright at birth and 100% at the age of the Sun', () => {
    expect(stellarLuminosity(0)).toBeCloseTo(0.714, 2);
    expect(stellarLuminosity(SUN_AGE)).toBeCloseTo(1, 6);
    expect(stellarLuminosity(8e9)).toBeGreaterThan(1.3);
  });

  it('scales luminosity and main-sequence lifetime with stellar mass', () => {
    const f = starProperties('F');
    const g = starProperties('G');
    const k = starProperties('K');
    const m = starProperties('M');
    expect(f.luminosity).toBeGreaterThan(g.luminosity);
    expect(k.luminosity).toBeLessThan(g.luminosity);
    expect(m.lifetime).toBeGreaterThan(k.lifetime);
    expect(f.lifetime).toBeLessThan(g.lifetime);
    expect(stellarLuminosity(SUN_AGE, 'G')).toBe(1);
  });
});

describe('climate', () => {
  it('saturates wet outgoing radiation but leaves a dry planet radiative', () => {
    expect(outgoingLongwaveRadiation(15, true)).toBeCloseTo(203.3 + 2.09 * 15, 8);
    expect(outgoingLongwaveRadiation(200, true)).toBeLessThanOrEqual(WET_OLR_LIMIT);
    expect(outgoingLongwaveRadiation(200, true)).toBeGreaterThan(WET_OLR_LIMIT - 0.1);
    expect(outgoingLongwaveRadiation(200, false)).toBeGreaterThan(WET_OLR_LIMIT);
  });

  it('has no wet steady state above the radiation limit', () => {
    const planet = oceanPlanet();
    planet.globals.solarInput = 1.5;
    createClimate().runOneStep(planet, 1e6, rng);
    expect(planet.globals.runawayGreenhouse).toBe(true);
    expect(planet.globals.meanTemperature).toBeGreaterThan(100);
    expect(planet.events.some((event) => event.key === 'runawayGreenhouse')).toBe(true);
  });

  it('integrates Earth-obliquity insolation close to the former North fit', () => {
    for (const latitude of [0, 15, 30, 45, 60, 75, 89.9]) {
      const x = Math.sin((latitude * Math.PI) / 180);
      const p2 = (3 * x * x - 1) / 2;
      const northFit = (SOLAR_CONSTANT / 4) * (1 - 0.482 * p2);
      expect(Math.abs(annualInsolation(latitude, 1, 23.44) - northFit)).toBeLessThan(8);
    }
  });

  it('conserves global sunlight and responds physically to obliquity', () => {
    expect(firstAnnualInsolationHarmonic(60, 1, 0)).toBeCloseTo(0, 10);
    expect(annualInsolation(89.999, 1, 90)).toBeGreaterThan(annualInsolation(0, 1, 90));
    for (const obliquity of [0, 23.44, 45, 90]) {
      let mean = 0;
      const rows = 720;
      for (let y = 0; y < rows; y++) {
        const north = Math.PI / 2 - (y * Math.PI) / rows;
        const south = Math.PI / 2 - ((y + 1) * Math.PI) / rows;
        const latitude = 90 - ((y + 0.5) * 180) / rows;
        mean +=
          (annualInsolation(latitude, 1, obliquity) * (Math.sin(north) - Math.sin(south))) / 2;
      }
      expect(mean).toBeCloseTo(SOLAR_CONSTANT / 4, 1);
    }
  });

  it('gives a locked dayside the same global mean insolation as the zonal case', () => {
    const grid = createGrid(128, 64);
    const locked = new Float32Array(grid.cellCount);
    for (let i = 0; i < grid.cellCount; i++) locked[i] = tidallyLockedInsolation(grid, i, 1);
    expect(areaWeightedMean(grid, locked)).toBeCloseTo(SOLAR_CONSTANT / 4, 4);
    expect(locked.some((value) => value === 0)).toBe(true);
  });

  it('keeps the explicit Earth parameters numerically identical to defaults', () => {
    const defaults = oceanPlanet();
    const explicit = oceanPlanet();
    explicit.planetParams = {
      ...defaults.planetParams,
      radius: 6_371_000,
      surfaceGravity: 9.80665,
      orbitalDistanceAu: 1,
      starType: 'G',
      rotationPeriodHours: 24,
    };
    const climate = createClimate();
    climate.runOneStep(defaults, 0, rng);
    climate.runOneStep(explicit, 0, rng);
    expect(explicit.globals.meanTemperature).toBe(defaults.globals.meanTemperature);
    expect(explicit.fields.airTemperature).toEqual(defaults.fields.airTemperature);
  });

  it('makes oceans maritime, coasts intermediate and interiors continental', () => {
    const args = [60, 1, 23.44, 0.3] as const;
    const ocean = seasonalTemperatureAmplitude(...args, true, 0, 0);
    const coast = seasonalTemperatureAmplitude(...args, false, 0.5, 0);
    const interior = seasonalTemperatureAmplitude(...args, false, 1, 0);
    expect(ocean).toBeGreaterThan(3);
    expect(ocean).toBeLessThan(6);
    expect(coast).toBeGreaterThan(ocean);
    expect(interior).toBeGreaterThan(coast);
    expect(interior).toBeGreaterThan(15);
    expect(interior).toBeLessThan(30);
    expect(seasonalTemperatureAmplitude(60, 1, 0, 0.3, false, 1, 0)).toBeCloseTo(0, 10);
    expect(seasonalTemperatureAmplitude(60, 1, 45, 0.3, false, 1, 0)).toBeGreaterThan(interior);
  });

  it('warms gradually after a jump in CO₂ when steps are short (ocean heat capacity)', () => {
    const planet = oceanPlanet();
    const climate = createClimate();
    climate.runOneStep(planet, 0, rng);
    const before = planet.globals.meanTemperature;
    planet.globals.atmosphere.co2 *= 4;
    climate.runOneStep(planet, 10, rng);
    const afterTenYears = planet.globals.meanTemperature;
    for (let year = 10; year < 1000; year += 10) climate.runOneStep(planet, 10, rng);
    const settled = planet.globals.meanTemperature;
    expect(settled - before).toBeGreaterThan(3);
    // A decade in, only part of the eventual warming has arrived.
    expect(afterTenYears - before).toBeGreaterThan(0.1 * (settled - before));
    expect(afterTenYears - before).toBeLessThan(0.5 * (settled - before));
    // Long steps reach equilibrium at once.
    const fresh = oceanPlanet();
    climate.runOneStep(fresh, 0, rng);
    fresh.globals.atmosphere.co2 *= 4;
    climate.runOneStep(fresh, 1e6, rng);
    expect(fresh.globals.meanTemperature).toBeCloseTo(settled, 0);
  });

  it('gives an Earth-like planet an Earth-like climate', () => {
    const planet = earthLike();
    createClimate().runOneStep(planet, 0, rng);
    const { meanTemperature, iceFraction } = planet.globals;
    expect(meanTemperature).toBeGreaterThan(9);
    expect(meanTemperature).toBeLessThan(18);
    expect(iceFraction).toBeGreaterThan(0.02);
    expect(iceFraction).toBeLessThan(0.25);
    // Equator warmer than the poles.
    const { width, height } = planet.grid;
    const t = planet.fields.airTemperature;
    const rowMean = (y: number) =>
      t.slice(y * width, (y + 1) * width).reduce((a, b) => a + b) / width;
    expect(rowMean(height / 2)).toBeGreaterThan(rowMean(0) + 30);
  });

  it('balances absorbed sunlight against outgoing radiation globally', () => {
    const planet = oceanPlanet();
    createClimate().runOneStep(planet, 0, rng);
    const { grid, fields, globals } = planet;
    const absorbed = new Float32Array(grid.cellCount);
    for (let i = 0; i < grid.cellCount; i++) {
      const latitude = grid.rowLatitude[Math.floor(i / grid.width)]!;
      absorbed[i] =
        annualInsolation(latitude, globals.solarInput, planet.controls.obliquity) *
        (1 - fields.albedo[i]!);
    }
    const outgoing = 203.3 + 2.09 * globals.meanTemperature - greenhouseForcing(globals.atmosphere);
    expect(areaWeightedMean(grid, absorbed)).toBeCloseTo(outgoing, 0);
  });

  it('warms with more CO₂', () => {
    const temperatures = [100, 280, 1000, 4000].map((co2) => {
      const planet = earthLike();
      planet.globals.atmosphere.co2 = co2;
      createClimate().runOneStep(planet, 0, rng);
      return planet.globals.meanTemperature;
    });
    for (let k = 1; k < temperatures.length; k++) {
      expect(temperatures[k]!).toBeGreaterThan(temperatures[k - 1]!);
    }
  });

  it('uses thick air to reduce the equator-to-pole contrast', () => {
    const contrasts = [0.02, 8].map((n2) => {
      const planet = oceanPlanet();
      planet.globals.atmosphere.n2 = n2;
      planet.globals.atmosphere.inert = 0;
      planet.globals.atmosphere.o2 = 0;
      createClimate().runOneStep(planet, 0, rng);
      const { width, height } = planet.grid;
      const rowMean = (y: number) => {
        let sum = 0;
        for (let x = 0; x < width; x++) sum += planet.fields.airTemperature[y * width + x]!;
        return sum / width;
      };
      return rowMean(height / 2) - rowMean(0);
    });
    expect(contrasts[1]!).toBeLessThan(contrasts[0]! * 0.5);
  });

  it('remembers a snowball: the same sunlight supports a warm and a frozen state', () => {
    const warm = oceanPlanet();
    const frozen = oceanPlanet();
    frozen.fields.iceCover.fill(1);
    for (const planet of [warm, frozen]) {
      planet.globals.solarInput = 0.95;
      createClimate().runOneStep(planet, 0, rng);
    }
    expect(warm.globals.iceFraction).toBeLessThan(0.5);
    expect(frozen.globals.iceFraction).toBeGreaterThan(0.95);
    expect(frozen.globals.meanTemperature).toBeLessThan(warm.globals.meanTemperature - 30);
  });

  it('transports heat as before on Earth, weaker in thin air and stronger when locked', () => {
    const earth = heatTransportScale(REFERENCE_SURFACE_PRESSURE, 24, false);
    expect(earth).toBe(1);
    expect(heatTransportScale(0.5, 24, false)).toBe(
      Math.pow(0.5 / REFERENCE_SURFACE_PRESSURE, 0.7),
    );
    // Below 0.1 bar it falls linearly with atmospheric mass.
    expect(heatTransportScale(0.006, 24, false)).toBeLessThan(0.015);
    expect(heatTransportScale(0.8, 24, true)).toBeGreaterThan(
      2 * heatTransportScale(0.8, 24, false),
    );
  });

  it('amplifies annual and seasonal forcing only in thin atmospheres', () => {
    expect(thinInsolationContrastScale(1)).toBe(1);
    expect(thinSeasonalAmplitudeScale(1)).toBe(1);
    expect(thinInsolationContrastScale(0.006)).toBeGreaterThan(1.6);
    expect(thinSeasonalAmplitudeScale(0.006)).toBeGreaterThan(2);
  });

  it('does not chill a dry planet by the depth of a sea level that sank with its oceans', () => {
    const run = (seaLevel: number) => {
      const planet = earthLike();
      planet.globals.water = 0;
      planet.globals.atmosphere.waterVapor = 0;
      planet.globals.seaLevel = seaLevel;
      createClimate().runOneStep(planet, 0, rng);
      return planet;
    };
    const sunken = run(-9800);
    const datum = run(-20_000);
    // Measured from the sea, 10 km of sea-level difference would be ~65 K of cooling.
    expect(Math.abs(sunken.globals.meanTemperature - datum.globals.meanTemperature)).toBeLessThan(
      3,
    );
    // Lapse rates are measured from the mean surface: highlands cool, basins warm.
    const { elevation, airTemperature } = sunken.fields;
    let high = 0;
    let low = 0;
    for (let i = 0; i < elevation.length; i++) {
      if (elevation[i]! > elevation[high]!) high = i;
      if (elevation[i]! < elevation[low]!) low = i;
    }
    expect(airTemperature[low]!).toBeGreaterThan(airTemperature[high]!);
  });
});
