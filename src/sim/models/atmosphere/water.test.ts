import { describe, expect, it } from 'vitest';
import { createPlanet } from '../../core/planet';
import { createRng } from '../../core/rng';
import {
  atmosphericWaterGel,
  initializeWaterInventory,
  landIceWaterGel,
  liquidWaterGel,
} from '../geosphere/seaLevel';
import { atmosphericWaterCycle } from './water';

describe('atmosphericWaterCycle', () => {
  it('conserves ocean, vapour and escaped water during evaporation and escape', () => {
    const planet = createPlanet({ width: 16, height: 8 });
    planet.fields.elevation.fill(-1000);
    initializeWaterInventory(planet);
    planet.globals.waterDelivered = 2;
    planet.globals.water += planet.globals.waterDelivered;
    planet.globals.runawayGreenhouse = true;
    planet.globals.meanTemperature = 250;
    const total = planet.globals.initialWater + planet.globals.waterDelivered;

    for (let step = 0; step < 20; step++) {
      planet.globals.year += 1e6;
      atmosphericWaterCycle.runOneStep(planet, 1e6, createRng(step));
      const accounted =
        liquidWaterGel(planet) +
        landIceWaterGel(planet) +
        atmosphericWaterGel(planet) +
        planet.globals.escapedWater;
      expect(accounted).toBeCloseTo(total, 8);
    }
    expect(planet.globals.atmosphere.waterVapor).toBeGreaterThan(1);
    expect(planet.globals.escapedWater).toBeGreaterThan(0);
  });
});

describe('water loss details', () => {
  const makeWet = (params: Parameters<typeof createPlanet>[0]) => {
    const planet = createPlanet({ width: 16, height: 8, ...params });
    planet.fields.elevation.fill(-1000);
    initializeWaterInventory(planet);
    planet.globals.meanTemperature = 15;
    return planet;
  };

  it('keeps Earth water unchanged over 10 Gyr but loses some on a cold small planet', () => {
    const earth = makeWet({});
    const before = earth.globals.water;
    for (let i = 0; i < 1000; i++) {
      earth.globals.year += 10e6;
      atmosphericWaterCycle.runOneStep(earth, 10e6, createRng(i));
    }
    expect(Math.abs(earth.globals.water - before)).toBeLessThan(1);

    const mars = makeWet({ planetParams: { radius: 3_390_000, surfaceGravity: 3.71 } });
    const marsBefore = mars.globals.water;
    for (let i = 0; i < 400; i++) {
      mars.globals.year += 10e6;
      atmosphericWaterCycle.runOneStep(mars, 10e6, createRng(i));
    }
    expect(mars.globals.water).toBeLessThan(marsBefore);
  });

  it('records oceansLost when the last water drains in one step', () => {
    const planet = makeWet({});
    planet.globals.runawayGreenhouse = true;
    planet.globals.meanTemperature = 300;
    planet.globals.year = 8e9;
    for (let i = 0; i < 200; i++) {
      planet.globals.year += 100e6;
      atmosphericWaterCycle.runOneStep(planet, 100e6, createRng(i));
      if (planet.globals.water === 0) break;
    }
    expect(planet.globals.water).toBe(0);
    expect(planet.events.some((event) => event.key === 'oceansLost')).toBe(true);
  });
});
