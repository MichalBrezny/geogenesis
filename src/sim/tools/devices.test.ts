import { describe, expect, it } from 'vitest';
import { createPlanet, type PlanetState } from '../core/planet';
import { createRng } from '../core/rng';
import { oxygenPartialPressure, updateSurfacePressure } from '../models/atmosphere/atmosphere';
import {
  CO2_GENERATOR_RATE,
  CO2_SCRUBBER_FLOOR,
  CO2_SCRUBBER_RATE,
  destroyDevicesNear,
  gasScale,
  placeDevice,
  terraformDevices,
} from './devices';
import { applyTool } from './tools';

function planet(): PlanetState {
  const state = createPlanet({ width: 32, height: 16 });
  state.globals.unlimitedEnergy = true;
  return state;
}

function run(state: PlanetState, steps: number[]): void {
  for (const dt of steps) {
    terraformDevices.runOneStep(state, dt, createRng(1));
    state.globals.year += dt;
  }
}

describe('terraforming devices', () => {
  it('allows one device per cell', () => {
    const state = planet();
    expect(placeDevice(state, 'co2Generator', 40)).toBe(true);
    expect(placeDevice(state, 'n2Generator', 40)).toBe(false);
    expect(state.devices).toHaveLength(1);
  });

  it('releases gas at a fixed rate, independently of the step length', () => {
    const fine = planet();
    const coarse = planet();
    for (const state of [fine, coarse]) {
      placeDevice(state, 'co2Generator', 10);
      placeDevice(state, 'co2Generator', 20);
    }
    const before = fine.globals.atmosphere.co2;
    run(fine, [1e6, 1e6, 1e6, 1e6]);
    run(coarse, [4e6]);
    const added = 2 * CO2_GENERATOR_RATE * 4e6 * 1e6;
    expect(fine.globals.atmosphere.co2 - before).toBeCloseTo(added, 3);
    expect(coarse.globals.atmosphere.co2).toBeCloseTo(fine.globals.atmosphere.co2, 3);
  });

  it('makes more pressure from the same gas on a small, light planet', () => {
    const mars = createPlanet({
      width: 32,
      height: 16,
      planetParams: { radius: 3_390_000, surfaceGravity: 3.71 },
    });
    expect(gasScale(planet())).toBeCloseTo(1, 6);
    expect(gasScale(mars)).toBeCloseTo((3.71 / 9.80665) * (6_371_000 / 3_390_000) ** 2, 6);
  });

  it('scrubs CO₂ into the crust down to a pre-industrial floor', () => {
    const state = planet();
    state.globals.atmosphere.co2 = 1e6;
    const crust = state.globals.crustalCarbon;
    placeDevice(state, 'co2Scrubber', 5);
    run(state, [1e6]);
    expect(state.globals.atmosphere.co2).toBeCloseTo(1e6 - CO2_SCRUBBER_RATE * 1e6 * 1e6, 3);
    expect(state.globals.crustalCarbon - crust).toBeCloseTo(CO2_SCRUBBER_RATE * 1e6, 9);
    run(state, [1e8]);
    expect(state.globals.atmosphere.co2).toBeCloseTo(CO2_SCRUBBER_FLOOR, 6);
  });

  it('adds oxygen as a partial pressure', () => {
    const state = planet();
    state.globals.atmosphere.o2 = 0;
    updateSurfacePressure(state.globals);
    placeDevice(state, 'o2Generator', 5);
    run(state, [10e6]);
    expect(oxygenPartialPressure(state.globals.atmosphere)).toBeCloseTo(0.01, 4);
  });

  it('is destroyed by a nearby blast and logs it', () => {
    const state = planet();
    placeDevice(state, 'co2Generator', 0);
    placeDevice(state, 'n2Generator', state.grid.cellCount - 1);
    destroyDevicesNear(state, 0, 500_000);
    expect(state.devices.map((device) => device.kind)).toEqual(['n2Generator']);
    expect(state.events.at(-1)).toMatchObject({ key: 'deviceDestroyed', subject: 'co2Generator' });
  });

  it('builds devices through the tool palette', () => {
    const state = planet();
    expect(applyTool(state, { tool: 'biomeFactory', x: 3, y: 8 })).toEqual({ ok: true });
    expect(state.devices[0]).toMatchObject({ kind: 'biomeFactory', cell: 8 * 32 + 3 });
  });

  it('drops an ice meteor that adds a fixed mass of water', () => {
    const state = planet();
    const before = state.globals.water;
    applyTool(state, { tool: 'iceMeteor', x: 10, y: 8 });
    const area = 4 * Math.PI * state.grid.radius ** 2;
    expect(state.globals.water - before).toBeCloseTo(5e18 / (1000 * area), 6);
  });
});
