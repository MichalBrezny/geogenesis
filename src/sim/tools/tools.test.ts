import { describe, expect, it } from 'vitest';
import { cellIndex } from '../core/grid';
import { createPlanet, type PlanetState } from '../core/planet';
import { createRng } from '../core/rng';
import { LIFE_CLASS_COUNT, lifeClassIndex } from '../data/lifeClasses';
import { applyTool, energyIncome, TOOLS } from './tools';

function planet(): PlanetState {
  const state = createPlanet({ width: 64, height: 32 });
  state.fields.elevation.fill(-2000);
  state.fields.airTemperature.fill(18);
  state.globals.energy = 1000;
  return state;
}

describe('tools', () => {
  it('raises land around the target and charges energy', () => {
    const state = planet();
    const centre = cellIndex(state.grid, 20, 16);
    for (let k = 0; k < 5; k++)
      expect(applyTool(state, { tool: 'raise', x: 20, y: 16 }).ok).toBe(true);
    expect(state.fields.elevation[centre]).toBeGreaterThan(0);
    expect(state.fields.crustType[centre]).toBe(1);
    expect(state.fields.elevation[cellIndex(state.grid, 50, 16)]).toBe(-2000);
    expect(state.globals.energy).toBe(1000 - 5 * TOOLS.raise.cost);
  });

  it('refuses tools the budget cannot pay for, unless energy is unlimited', () => {
    const state = planet();
    state.globals.energy = 10;
    expect(applyTool(state, { tool: 'meteor', x: 5, y: 5 })).toEqual({
      ok: false,
      reason: 'energy',
    });
    state.globals.unlimitedEnergy = true;
    expect(applyTool(state, { tool: 'meteor', x: 5, y: 5 }).ok).toBe(true);
    expect(state.globals.energy).toBe(10);
  });

  it('can originate prokaryotes, but only moves later life after it has evolved', () => {
    const state = planet();
    const use = { tool: 'seedLife', x: 10, y: 16, lifeClass: 'prokaryotes' } as const;
    expect(applyTool(state, use).ok).toBe(true);
    expect(state.biota.appeared[lifeClassIndex('prokaryotes')]).toBe(0);
    const n = state.grid.cellCount;
    expect(
      state.biota.populations[lifeClassIndex('prokaryotes') * n + cellIndex(state.grid, 10, 16)],
    ).toBeGreaterThan(0);
    expect(applyTool(state, { ...use, lifeClass: 'eukaryotes' })).toEqual({
      ok: false,
      reason: 'notAllowed',
    });
  });

  it('wakes up intelligence with the monolith', () => {
    const state = planet();
    state.fields.elevation.fill(300);
    const n = state.grid.cellCount;
    const mammals = lifeClassIndex('mammals');
    state.biota.populations.fill(0.6, mammals * n, (mammals + 1) * n);
    state.biota.cover = Array.from({ length: LIFE_CLASS_COUNT }, (_, c) =>
      c === mammals ? 0.6 : 0,
    );
    expect(applyTool(state, { tool: 'monolith', x: 30, y: 16 }).ok).toBe(true);
    expect(state.civilization.species).toBe(mammals);
  });

  it('changes CO₂', () => {
    const state = planet();
    applyTool(state, { tool: 'addCo2', x: 0, y: 0 });
    expect(state.globals.atmosphere.co2).toBe(480);
    applyTool(state, { tool: 'removeCo2', x: 0, y: 0 });
    expect(state.globals.atmosphere.co2).toBe(240);
  });
  it('keeps the base energy income without a civilization', () => {
    const state = planet();
    energyIncome.runOneStep(state, 1_000, createRng(1));
    expect(state.globals.energy).toBeCloseTo(1000.002, 10);
  });

  it('increases energy income with the civilization tech age', () => {
    const stone = planet();
    stone.civilization.species = 0;
    stone.civilization.age = 0;
    energyIncome.runOneStep(stone, 100, createRng(1));

    const nanotech = planet();
    nanotech.civilization.species = 0;
    nanotech.civilization.age = 6;
    energyIncome.runOneStep(nanotech, 100, createRng(1));

    expect(nanotech.globals.energy - 1000).toBeGreaterThan(stone.globals.energy - 1000);
  });

  it('earns the same civilization income across different step lengths', () => {
    const oneStep = planet();
    oneStep.civilization.species = 0;
    oneStep.civilization.age = 4;
    energyIncome.runOneStep(oneStep, 100, createRng(1));

    const split = planet();
    split.civilization.species = 0;
    split.civilization.age = 4;
    for (let step = 0; step < 20; step++) energyIncome.runOneStep(split, 5, createRng(1));

    expect(split.globals.energy).toBeCloseTo(oneStep.globals.energy, 10);
  });

  it('orients the earthquake uplift band perpendicular to the drag direction', () => {
    const state = planet();
    state.fields.elevation.fill(0);
    const x = 32;
    const y = 16;
    expect(applyTool(state, { tool: 'earthquake', x, y, direction: Math.PI / 2 }).ok).toBe(true);
    const north = state.fields.elevation[cellIndex(state.grid, x, y - 1)]!;
    const east = state.fields.elevation[cellIndex(state.grid, x + 1, y)]!;
    expect(north).toBeGreaterThan(east);
    expect(north).toBeGreaterThan(0);
  });

  it('drives a hurricane along the wind from a sea or coast', () => {
    const state = planet();
    state.fields.elevation.fill(100);
    state.fields.windU.fill(8);
    for (let y = 0; y < state.grid.height; y++) {
      for (let x = 0; x < 32; x++) state.fields.elevation[cellIndex(state.grid, x, y)] = -100;
    }
    const coast = cellIndex(state.grid, 32, 16);
    state.fields.civilization[coast] = 0.8;
    expect(applyTool(state, { tool: 'hurricane', x: 31, y: 16 }).ok).toBe(true);
    expect(state.fields.civilization[coast]).toBeLessThan(0.8);
  });

  it('sends a tidal wave from ocean onto low settled coasts', () => {
    const state = planet();
    state.fields.elevation.fill(20);
    for (let y = 0; y < state.grid.height; y++) {
      for (let x = 0; x < 32; x++) state.fields.elevation[cellIndex(state.grid, x, y)] = -100;
    }
    const coast = cellIndex(state.grid, 32, 16);
    state.fields.civilization[coast] = 0.8;
    expect(applyTool(state, { tool: 'tidalWave', x: 30, y: 16 }).ok).toBe(true);
    expect(state.fields.civilization[coast]).toBeLessThan(0.8);
  });

  it('burns land vegetation and land life, leaves sea life alone, and adds soot', () => {
    const state = planet();
    state.fields.elevation.fill(100);
    state.fields.vegetation.fill(0.8);
    const centre = cellIndex(state.grid, 20, 16);
    const mammals = lifeClassIndex('mammals');
    const fish = lifeClassIndex('fish');
    const n = state.grid.cellCount;
    state.biota.populations[mammals * n + centre] = 0.8;
    state.biota.populations[fish * n + centre] = 0.8;
    expect(applyTool(state, { tool: 'fire', x: 20, y: 16 }).ok).toBe(true);
    expect(state.fields.vegetation[centre]).toBeLessThan(0.8);
    expect(state.biota.populations[mammals * n + centre]).toBeLessThan(0.8);
    expect(state.biota.populations[fish * n + centre]).toBeCloseTo(0.8, 6);
    expect(state.globals.dustSources.length).toBeGreaterThan(0);
  });
});
