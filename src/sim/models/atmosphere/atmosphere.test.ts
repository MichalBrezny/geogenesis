import { describe, expect, it } from 'vitest';
import { createPlanet } from '../../core/planet';
import { boilingPointC, REFERENCE_SURFACE_PRESSURE, surfacePressureOf } from './atmosphere';
import { greenhouseForcing } from './climate';

describe('atmospheric pressure', () => {
  it('derives an Earth-like one-bar reference atmosphere', () => {
    const atmosphere = createPlanet().globals.atmosphere;
    expect(surfacePressureOf(atmosphere)).toBeCloseTo(1, 2);
    expect(surfacePressureOf(atmosphere)).toBe(REFERENCE_SURFACE_PRESSURE);
  });

  it('leaves the calibrated Earth-pressure CO2 forcing unchanged', () => {
    const atmosphere = { ...createPlanet().globals.atmosphere, co2: 560 };
    // Myhre logarithmic term plus the established high-CO2 correction.
    const logRatio = Math.log(2);
    const unbroadened = 5.35 * logRatio + 0.4 * logRatio ** 2;
    expect(greenhouseForcing(atmosphere)).toBeCloseTo(unbroadened, 2);
  });

  it('pressure broadening strengthens greenhouse forcing in thick air', () => {
    const earth = { ...createPlanet().globals.atmosphere, co2: 1120 };
    const thick = { ...earth, n2: earth.n2 * 4 };
    expect(greenhouseForcing(thick)).toBeGreaterThan(greenhouseForcing(earth) * 1.8);
  });

  it('represents a Venus-like carbon-dioxide partial pressure', () => {
    const atmosphere = {
      ...createPlanet().globals.atmosphere,
      co2: 90e6,
      o2: 0,
      waterVapor: 0,
    };
    expect(surfacePressureOf(atmosphere)).toBeCloseTo(90.79, 2);
  });
});

describe('water boiling point', () => {
  it('rises with pressure and matches familiar reference points', () => {
    expect(boilingPointC(1.01325)).toBeCloseTo(100, 5);
    expect(boilingPointC(0.006)).toBeCloseTo(0, 0);
    expect(boilingPointC(10)).toBeGreaterThan(175);
    expect(boilingPointC(90)).toBeGreaterThan(290);
  });
});
