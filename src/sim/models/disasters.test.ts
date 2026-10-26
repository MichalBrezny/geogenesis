import { describe, expect, it } from 'vitest';
import { FIELD_NAMES } from '../core/fields';
import { cellIndex } from '../core/grid';
import { createPlanet, type PlanetState, type Plate } from '../core/planet';
import { createSimulation } from '../simulation';
import { createRandomWorld } from '../world';
import {
  applyDisasterMortality,
  cycloneHazardRates,
  disasterModel,
  earthquakeHazardRates,
} from './disasters';
import { dustModel } from './atmosphere/dust';

function plate(state: PlanetState, id: number, angularSpeed: number): Plate {
  const n = state.grid.cellCount;
  return {
    id,
    eulerPole: [0, 0, 1],
    angularSpeed,
    targetSpeed: angularSpeed,
    rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    crust: {
      owned: new Uint8Array(n),
      elevation: new Float32Array(n),
      type: new Uint8Array(n),
    },
  };
}

describe('natural disasters', () => {
  it('concentrates earthquake hazard at moving plate boundaries', () => {
    const state = createPlanet({ width: 64, height: 32 });
    state.plates = [plate(state, 0, 1e-8), plate(state, 1, -1e-8)];
    for (let y = 0; y < state.grid.height; y++) {
      for (let x = 0; x < state.grid.width; x++) {
        state.fields.plateId[cellIndex(state.grid, x, y)] = x < 32 ? 0 : 1;
      }
    }
    const rates = earthquakeHazardRates(state);
    expect(rates[cellIndex(state.grid, 31, 16)]).toBeGreaterThan(0);
    expect(rates[cellIndex(state.grid, 31, 16)]).toBeGreaterThan(
      rates[cellIndex(state.grid, 16, 16)]!,
    );
  });

  it('needs warm tropical sea and falls off inland from a downwind coast', () => {
    const state = createPlanet({ width: 128, height: 64 });
    state.fields.elevation.fill(100);
    state.fields.airTemperature.fill(20);
    state.fields.windU.fill(8);
    const row = 24; // about 21 degrees north
    for (let y = 0; y < state.grid.height; y++) {
      for (let x = 0; x < 64; x++) {
        const i = cellIndex(state.grid, x, y);
        state.fields.elevation[i] = -100;
        state.fields.airTemperature[i] = 29;
      }
    }
    const warm = cycloneHazardRates(state);
    expect(warm[cellIndex(state.grid, 64, row)]).toBeGreaterThan(
      warm[cellIndex(state.grid, 65, row)]!,
    );
    expect(warm[cellIndex(state.grid, 65, row)]).toBeGreaterThanOrEqual(
      warm[cellIndex(state.grid, 67, row)]!,
    );

    state.fields.airTemperature.fill(20);
    const cold = cycloneHazardRates(state);
    expect(warm[cellIndex(state.grid, 64, row)]).toBeGreaterThan(
      cold[cellIndex(state.grid, 64, row)]!,
    );
  });

  it('integrates mortality independently of the outer step length', () => {
    const make = () => {
      const state = createPlanet({ width: 8, height: 4 });
      state.civilization.species = 0;
      state.fields.civilization.fill(0.8);
      return state;
    };
    const short = make();
    const long = make();
    const rates = new Float32Array(short.grid.cellCount).fill(1e-4);
    for (let step = 0; step < 200; step++) applyDisasterMortality(short, rates, 5);
    for (let step = 0; step < 10; step++) applyDisasterMortality(long, rates, 100);
    expect(short.fields.civilization[0]).toBeCloseTo(long.fields.civilization[0]!, 6);
  });

  it('keeps the steady dust-storm optical depth below 0.01', () => {
    const state = createPlanet({ width: 16, height: 8 });
    state.civilization.species = 0;
    state.fields.elevation.fill(100);
    state.fields.airTemperature.fill(30);
    state.fields.precipitation.fill(0);
    state.fields.vegetation.fill(0);
    state.fields.windU.fill(12);
    Object.assign(state.disasters, {
      earthquakes: false,
      tsunamis: false,
      cyclones: false,
      droughts: false,
      dustStorms: true,
    });
    for (let step = 0; step < 200; step++) {
      disasterModel.runOneStep(state, 0.1, { next: () => 0.5, int: () => 0, state: 0 });
      dustModel.runOneStep(state, 0.1, { next: () => 0.5, int: () => 0, state: 0 });
      state.globals.year += 0.1;
    }
    expect(state.globals.dust).toBeLessThanOrEqual(0.01);
  });

  it('does not perturb the established simulation stream when local disasters are off', () => {
    const withDisasters = createRandomWorld({ start: 'quick', seed: 41, width: 32, height: 16 });
    Object.assign(withDisasters.planet.disasters, {
      earthquakes: false,
      tsunamis: false,
      cyclones: false,
      droughts: false,
      dustStorms: false,
      impacts: true,
      supervolcanoes: true,
    });
    const baselineWorld = createRandomWorld({ start: 'quick', seed: 41, width: 32, height: 16 });
    Object.assign(baselineWorld.planet.disasters, withDisasters.planet.disasters);
    const baseline = createSimulation(
      baselineWorld.simulation.components.map((component) =>
        component.name === 'disasters' ? { ...component, runOneStep: () => undefined } : component,
      ),
      FIELD_NAMES,
    );
    withDisasters.simulation.step(withDisasters.planet, 1e6);
    baseline.step(baselineWorld.planet, 1e6);
    expect(withDisasters.planet.rngState).toBe(baselineWorld.planet.rngState);
    expect(withDisasters.planet.globals).toEqual(baselineWorld.planet.globals);
    for (const name of FIELD_NAMES) {
      if (name !== 'hazard')
        expect(withDisasters.planet.fields[name]).toEqual(baselineWorld.planet.fields[name]);
    }
  });
});
