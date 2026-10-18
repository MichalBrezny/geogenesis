import { describe, expect, it } from 'vitest';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import { clathrateModel, methaneLifetime } from './clathrates';

function coldPlanet() {
  const planet = createPlanet({ width: 8, height: 4 });
  planet.fields.elevation.fill(100);
  planet.fields.airTemperature.fill(-5);
  planet.fields.iceCover.fill(0.5);
  planet.globals.meanTemperature = -5;
  planet.globals.clathrateReferenceTemperature = -5;
  planet.globals.carbon.burial = 0.2;
  planet.globals.atmosphere.ch4 = 0;
  planet.globals.atmosphere.co2 = 0;
  planet.biota.cover.fill(0);
  return planet;
}

function step(planet: ReturnType<typeof createPlanet>, years: number) {
  clathrateModel.runOneStep(planet, years, createRng(1));
  planet.globals.year += years;
}

describe('clathrateModel', () => {
  it('slowly fills cold land and shelf storage from organic burial', () => {
    const planet = coldPlanet();
    step(planet, 250e6);
    expect(planet.globals.clathrateCarbon).toBeGreaterThan(1_500);
    expect(planet.globals.clathrateCarbon).toBeLessThanOrEqual(2_500);
  });

  it('releases a large reservoir during rapid warming and records one episode', () => {
    const planet = coldPlanet();
    planet.globals.carbon.burial = 0;
    planet.globals.clathrateCarbon = 1_000;
    planet.globals.meanTemperature = 3;
    step(planet, 10_000);
    expect(planet.globals.clathrateCarbon).toBeLessThan(300);
    expect(planet.events.filter((event) => event.key === 'methaneRelease')).toHaveLength(1);

    step(planet, 10_000);
    expect(planet.events.filter((event) => event.key === 'methaneRelease')).toHaveLength(1);
  });

  it('does not release methane during slow warming', () => {
    const planet = coldPlanet();
    planet.globals.carbon.burial = 0;
    planet.globals.clathrateCarbon = 1_000;
    for (let k = 0; k < 500; k++) {
      planet.globals.meanTemperature += 0.01;
      step(planet, 1_000);
    }
    expect(planet.globals.clathrateCarbon).toBeCloseTo(1_000, 10);
    expect(planet.events.some((event) => event.key === 'methaneRelease')).toBe(false);
  });

  it('decays excess methane with the oxic lifetime', () => {
    const planet = coldPlanet();
    planet.globals.carbon.burial = 0;
    planet.globals.atmosphere.o2 = 0.21;
    planet.globals.atmosphere.ch4 = 100;
    const lifetime = methaneLifetime(planet.globals.atmosphere.o2);
    step(planet, lifetime);
    expect(planet.globals.atmosphere.ch4).toBeCloseTo(100 / Math.E, 8);
    expect(lifetime).toBeCloseTo(10, 6);
  });

  it('conserves released carbon between the reservoir, methane and carbon dioxide', () => {
    const planet = coldPlanet();
    planet.globals.carbon.burial = 0;
    planet.globals.clathrateCarbon = 1_000;
    planet.globals.atmosphere.ch4 = 10;
    planet.globals.atmosphere.co2 = 100;
    planet.globals.meanTemperature = 3;
    const before =
      planet.globals.clathrateCarbon +
      planet.globals.atmosphere.ch4 +
      planet.globals.atmosphere.co2;
    step(planet, 10_000);
    const after =
      planet.globals.clathrateCarbon +
      planet.globals.atmosphere.ch4 +
      planet.globals.atmosphere.co2;
    expect(after).toBeCloseTo(before, 10);
  });

  it('gives the same warming release when the interval is subdivided', () => {
    const one = coldPlanet();
    const many = coldPlanet();
    for (const planet of [one, many]) {
      planet.globals.carbon.burial = 0;
      planet.globals.clathrateCarbon = 1_000;
      planet.globals.meanTemperature = 3;
    }
    step(one, 10_000);
    for (let k = 0; k < 10; k++) step(many, 1_000);
    expect(many.globals.clathrateCarbon).toBeCloseTo(one.globals.clathrateCarbon, 10);
    expect(many.globals.atmosphere.ch4 + many.globals.atmosphere.co2).toBeCloseTo(
      one.globals.atmosphere.ch4 + one.globals.atmosphere.co2,
      10,
    );
  });
});
