import { describe, expect, it } from 'vitest';
import { cellIndex } from '../core/grid';
import { createPlanet, type PlanetState } from '../core/planet';
import { LIFE_CLASS_COUNT, lifeClassIndex } from '../data/lifeClasses';
import { applyTool, TOOLS } from './tools';

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
});
