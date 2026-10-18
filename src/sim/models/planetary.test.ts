import { describe, expect, it } from 'vitest';
import { createPlanet } from '../core/planet';
import { createSimulation } from '../simulation';
import {
  atmosphericEscape,
  magneticFieldStrength,
  planetaryEvolution,
  SPUTTERING_RATE,
  sputteredPressure,
} from './planetary';
import { mantleHeat } from './atmosphere/carbon';
import { stellarWindFactor } from './atmosphere/star';
import { updateSurfacePressure } from './atmosphere/atmosphere';

describe('planetary evolution', () => {
  it('lets a small planet lose its magnetic field much sooner than Earth', () => {
    expect(magneticFieldStrength(1e9, 3_390_000)).toBeLessThan(0.05);
    expect(magneticFieldStrength(10e9, 6_371_000)).toBeGreaterThan(0.5);
  });

  it('makes moonless obliquity deterministic and step-length independent', () => {
    const make = () => {
      const planet = createPlanet({ seed: 123, planetParams: { hasMoon: false } });
      planet.globals.year = 1e9;
      return { planet, simulation: createSimulation([planetaryEvolution]) };
    };
    const one = make();
    const ten = make();
    one.simulation.step(one.planet, 100e6);
    for (let i = 0; i < 10; i++) ten.simulation.step(ten.planet, 10e6);
    expect(one.planet.controls.obliquity).toBe(ten.planet.controls.obliquity);
    expect(one.planet.geosphere.obliquityUpdateIndex).toBe(10);
    expect(one.planet.controls.obliquity).toBeGreaterThanOrEqual(0);
    expect(one.planet.controls.obliquity).toBeLessThanOrEqual(60);
  });

  it('conserves each gas and water inventory while escape removes atmosphere', () => {
    const planet = createPlanet({
      planetParams: { radius: 3_390_000, surfaceGravity: 3.71, dynamoStrength: 0 },
    });
    planet.globals.year = 0.5e9;
    planet.globals.magneticField = 0;
    planet.globals.atmosphere.o2 = 0;
    planet.globals.water = 10;
    planet.globals.initialWater = 10;
    updateSurfacePressure(planet.globals);
    const beforeGas =
      planet.globals.atmosphere.n2 +
      planet.globals.atmosphere.inert +
      planet.globals.atmosphere.co2 * 1e-6 +
      planet.globals.atmosphere.waterVapor;
    const beforeWater = planet.globals.water + planet.globals.escapedWater;
    atmosphericEscape.runOneStep(planet, 10e6, { next: () => 0, int: () => 0, state: 0 });
    const afterGas =
      planet.globals.atmosphere.n2 +
      planet.globals.atmosphere.inert +
      planet.globals.atmosphere.co2 * 1e-6 +
      planet.globals.atmosphere.waterVapor;
    const escaped = Object.values(planet.globals.escapedAtmosphere).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(afterGas + escaped).toBeCloseTo(beforeGas, 10);
    expect(planet.globals.water + planet.globals.escapedWater).toBeCloseTo(beforeWater, 10);
  });

  it('integrates sputtering exactly, independent of step length', () => {
    for (const rate of [1e-9, 1e-6]) {
      for (const p0 of [0.5, 3]) {
        const run = (steps: number, total: number) => {
          let p = p0;
          for (let i = 0; i < steps; i++) p -= sputteredPressure(p, rate, total / steps);
          return p;
        };
        const one = run(1, 100e6);
        expect(run(10, 100e6)).toBeCloseTo(one, 9);
        expect(run(100, 100e6)).toBeCloseTo(one, 9);
        expect(one).toBeGreaterThanOrEqual(0);
      }
    }
    // A huge step cannot remove more than exists, and thin air decays asymptotically.
    expect(sputteredPressure(0.5, 1e-3, 1e9)).toBeLessThanOrEqual(0.5);
    expect(sputteredPressure(0.5, 1e-9, 1e6)).toBeCloseTo(0.5 * (1 - Math.exp(-1e-3)), 12);
  });

  it('gives the same atmosphere after 1, 10 and 100 Myr steps', () => {
    const make = () => {
      const planet = createPlanet({
        planetParams: { radius: 3_390_000, surfaceGravity: 3.71, dynamoStrength: 0 },
      });
      planet.globals.year = 1e9;
      planet.globals.magneticField = 0;
      planet.globals.atmosphere.o2 = 0;
      updateSurfacePressure(planet.globals);
      return planet;
    };
    const results = [100, 10, 1].map((stepMyr) => {
      const planet = make();
      for (let i = 0; i < 100 / stepMyr; i++) {
        atmosphericEscape.runOneStep(planet, stepMyr * 1e6, { next: () => 0, int: () => 0, state: 0 });
      }
      return planet.globals.surfacePressure;
    });
    // Wind factor is evaluated at step midpoints, so allow a small age-law difference.
    expect(results[1]).toBeCloseTo(results[0]!, 1);
    expect(results[2]).toBeCloseTo(results[0]!, 1);
  });

  it('calibrates sputtering: Mars loses its air, Venus and Earth keep theirs', () => {
    // Mars: g 3.71, 1.524 AU, field gone. Rate in 1/yr below one bar.
    const marsRate =
      SPUTTERING_RATE * (9.80665 / 3.71) ** 1.5 * stellarWindFactor(2e9, 'G', 1.524);
    const marsLeft = 1 - sputteredPressure(1, marsRate, 1.5e9);
    expect(marsLeft).toBeLessThan(0.3);
    const venusRate =
      SPUTTERING_RATE * (9.80665 / 8.87) ** 1.5 * stellarWindFactor(2e9, 'G', 0.723);
    expect(90 - sputteredPressure(90, venusRate, 4.5e9)).toBeGreaterThan(60);
    // Earth with its field fully on is exactly shielded.
    expect(sputteredPressure(1, SPUTTERING_RATE * 0, 10e9)).toBe(0);
  });

  it('turns a Mars-size planet stagnant near 1 Gyr while Earth stays mobile', () => {
    expect(mantleHeat(0.8e9, 3_390_000)).toBeGreaterThan(0.7);
    expect(mantleHeat(1.5e9, 3_390_000)).toBeLessThan(0.7);
    expect(mantleHeat(10e9, 6_371_000)).toBeGreaterThan(0.7);
  });

  it('does not report a lost field for a planet that never had one', () => {
    const planet = createPlanet({ planetParams: { dynamoStrength: 0 } });
    createSimulation([planetaryEvolution]).step(planet, 1e6);
    expect(planet.events.some((event) => event.key === 'magneticFieldLost')).toBe(false);
  });
});
