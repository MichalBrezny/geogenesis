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
