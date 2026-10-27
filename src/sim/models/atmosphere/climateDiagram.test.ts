import { describe, expect, it } from 'vitest';
import { createPlanet, type PlanetState } from '../../core/planet';
import { monthlyClimate } from './climateDiagram';

function climateAt(latitude: number, options: { obliquity?: number; ocean?: boolean } = {}) {
  const state = createPlanet({ width: 36, height: 18, seed: 7 });
  state.controls.obliquity = options.obliquity ?? 23.44;
  state.globals.circulation = { hadleyWidth: 30, meanItcz: 0 };
  state.globals.seaLevel = 0;
  state.fields.elevation.fill(options.ocean ? -1000 : 500);
  state.fields.airTemperature.fill(20);
  state.fields.seasonalAmplitude.fill(8);
  state.fields.precipitation.fill(1200);
  const y = nearestRow(state, latitude);
  return { state, cell: y * state.grid.width + 18 };
}

describe('monthlyClimate', () => {
  it('preserves the annual precipitation total exactly', () => {
    const { state, cell } = climateAt(18);
    state.fields.precipitation[cell] = 987.25;
    expect(monthlyClimate(state, cell).precipitation.reduce((a, b) => a + b, 0)).toBe(987.25);
  });

  it('has uniform precipitation at zero obliquity', () => {
    const { state, cell } = climateAt(18, { obliquity: 0 });
    const precipitation = monthlyClimate(state, cell).precipitation;
    expect(precipitation.every((value) => value === precipitation[0])).toBe(true);
  });

  it('gives the equator two rainy seasons', () => {
    const { state, cell } = climateAt(0, { ocean: true });
    const p = monthlyClimate(state, cell).precipitation;
    expect(p[2]!).toBeGreaterThan(p[0]!);
    expect(p[8]!).toBeGreaterThan(p[6]!);
  });

  it('gives the northern outer tropics one wet summer and a dry winter', () => {
    const { state, cell } = climateAt(18);
    const p = monthlyClimate(state, cell).precipitation;
    expect(p[6]!).toBeGreaterThan(p[0]! * 2);
    expect(p.indexOf(Math.max(...p))).toBeGreaterThanOrEqual(4);
    expect(p.indexOf(Math.max(...p))).toBeLessThanOrEqual(8);
  });

  it('shifts the outer-tropical wet season six months in the south', () => {
    const north = climateAt(18);
    const south = climateAt(-18);
    const np = monthlyClimate(north.state, north.cell).precipitation;
    const sp = monthlyClimate(south.state, south.cell).precipitation;
    for (let month = 0; month < 12; month++) {
      expect(sp[(month + 6) % 12]).toBeCloseTo(np[month]!, 9);
    }
  });

  it('does not mutate globals or RNG state', () => {
    const { state, cell } = climateAt(12);
    const globals = structuredClone(state.globals);
    const rngState = state.rngState;
    monthlyClimate(state, cell);
    expect(state.globals).toEqual(globals);
    expect(state.rngState).toBe(rngState);
  });
});

function nearestRow(state: PlanetState, latitude: number): number {
  let best = 0;
  for (let y = 1; y < state.grid.height; y++) {
    if (
      Math.abs(state.grid.rowLatitude[y]! - latitude) <
      Math.abs(state.grid.rowLatitude[best]! - latitude)
    ) {
      best = y;
    }
  }
  return best;
}
