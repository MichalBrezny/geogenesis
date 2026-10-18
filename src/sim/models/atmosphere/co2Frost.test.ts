import { describe, expect, it } from 'vitest';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import {
  co2FrostCycle,
  co2FrostPointK,
  co2VaporPressureBar,
} from './co2Frost';

const rng = createRng(1);

function frostPlanet(temperatureC = -130) {
  const planet = createPlanet({ width: 16, height: 8 });
  planet.globals.atmosphere.n2 = 0;
  planet.globals.atmosphere.inert = 0;
  planet.globals.atmosphere.o2 = 0;
  planet.globals.atmosphere.waterVapor = 0;
  planet.globals.atmosphere.co2 = 6000;
  planet.globals.surfacePressure = 0.006;
  planet.fields.airTemperature.fill(temperatureC);
  planet.fields.seasonalAmplitude.fill(0);
  return planet;
}

describe('CO2 frost', () => {
  it('puts the 6 mbar frost point near 148 K and inverts the fit', () => {
    expect(co2FrostPointK(0.006)).toBeCloseTo(147.6, 1);
    expect(co2VaporPressureBar(co2FrostPointK(0.006))).toBeCloseTo(0.006, 10);
  });

  it('conserves CO2 exactly while condensing and sublimating', () => {
    const planet = frostPlanet();
    const total = planet.globals.atmosphere.co2 * 1e-6 + planet.globals.co2Ice;
    const totalWithCrust = total + planet.globals.crustalCarbon;
    co2FrostCycle.runOneStep(planet, 1e6, rng);
    expect(planet.globals.co2Ice).toBeGreaterThan(0);
    expect(planet.globals.atmosphere.co2 * 1e-6 + planet.globals.co2Ice).toBe(total);
    expect(
      planet.globals.atmosphere.co2 * 1e-6 +
        planet.globals.co2Ice +
        planet.globals.crustalCarbon,
    ).toBe(totalWithCrust);
    expect(
      planet.fields.airTemperature[0]! - planet.fields.seasonalAmplitude[0]! + 273.15,
    ).toBeCloseTo(co2FrostPointK(planet.globals.atmosphere.co2 * 1e-6), 4);

    planet.fields.airTemperature.fill(-100);
    planet.fields.seasonalAmplitude.fill(0);
    co2FrostCycle.runOneStep(planet, 1e6, rng);
    expect(planet.globals.co2Ice).toBe(0);
    expect(planet.globals.atmosphere.co2 * 1e-6).toBe(total);
  });

  it('is independent of geological step length', () => {
    const oneMyr = frostPlanet();
    const tenMyr = frostPlanet();
    co2FrostCycle.runOneStep(oneMyr, 1e6, rng);
    co2FrostCycle.runOneStep(tenMyr, 10e6, rng);
    expect(oneMyr.globals.atmosphere.co2).toBe(tenMyr.globals.atmosphere.co2);
    expect(oneMyr.globals.co2Ice).toBe(tenMyr.globals.co2Ice);

    for (const planet of [oneMyr, tenMyr]) {
      planet.fields.airTemperature.fill(-100);
      planet.fields.seasonalAmplitude.fill(0);
    }
    co2FrostCycle.runOneStep(oneMyr, 1e6, rng);
    co2FrostCycle.runOneStep(tenMyr, 10e6, rng);
    expect(oneMyr.globals.atmosphere.co2).toBe(tenMyr.globals.atmosphere.co2);
    expect(oneMyr.globals.co2Ice).toBe(tenMyr.globals.co2Ice);
  });

  it('is bit-neutral for Earth-like CO2 and avoids default locked-world collapse', () => {
    const earth = createPlanet({ width: 16, height: 8 });
    earth.globals.atmosphere.co2 = 13_000;
    earth.fields.airTemperature.fill(-120);
    earth.fields.seasonalAmplitude.fill(40);
    const atmosphere = { ...earth.globals.atmosphere };
    const temperature = earth.fields.airTemperature.slice();
    co2FrostCycle.runOneStep(earth, 1e9, rng);
    expect(earth.globals.atmosphere).toEqual(atmosphere);
    expect(earth.fields.airTemperature).toEqual(temperature);
    expect(earth.globals.co2Ice).toBe(0);

    const locked = createPlanet({
      width: 16,
      height: 8,
      planetParams: { tidallyLocked: true, initialN2Bar: 0.8 },
    });
    locked.fields.airTemperature.fill(-120);
    co2FrostCycle.runOneStep(locked, 1e9, rng);
    expect(locked.globals.atmosphere.co2).toBe(280);
    expect(locked.globals.co2Ice).toBe(0);
  });

  it('lets a thin CO2-rich locked world collapse onto its cold side', () => {
    const locked = frostPlanet(-80);
    locked.planetParams.tidallyLocked = true;
    for (let i = 0; i < locked.grid.cellCount / 2; i++) {
      locked.fields.airTemperature[i] = -140;
    }
    co2FrostCycle.runOneStep(locked, 1e6, rng);
    expect(locked.globals.co2Ice).toBeGreaterThan(0);
    expect(locked.fields.co2Ice.slice(0, locked.grid.cellCount / 2).some((ice) => ice > 0)).toBe(
      true,
    );
    expect(locked.fields.co2Ice.slice(locked.grid.cellCount / 2).every((ice) => ice === 0)).toBe(
      true,
    );
  });
});
