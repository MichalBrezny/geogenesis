import { describe, expect, it } from 'vitest';
import { cellIndex } from '../../core/grid';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { oceanChemistry } from './oceanChemistry';

const rng = createRng(1);

function earthLikeOcean(): PlanetState {
  const planet = createPlanet({ width: 32, height: 16 });
  const { grid, fields } = planet;
  for (let y = 0; y < grid.height; y++) {
    const latitude = (grid.rowLatitude[y]! * Math.PI) / 180;
    for (let x = 0; x < grid.width; x++) {
      const i = cellIndex(grid, x, y);
      const ocean = x >= 8;
      fields.elevation[i] = ocean ? -800 : 300;
      fields.airTemperature[i] = 25 - 30 * Math.sin(latitude) ** 2;
      if (ocean && Math.abs(grid.rowLatitude[y]!) < 12) fields.upwelling[i] = 0.003;
      if (ocean && x === 8) fields.discharge[i] = 8e11;
    }
  }
  return planet;
}

function oceanValues(planet: PlanetState, values: ArrayLike<number>): number[] {
  const result: number[] = [];
  for (let i = 0; i < planet.grid.cellCount; i++) {
    if (planet.fields.elevation[i]! < planet.globals.seaLevel) result.push(values[i]!);
  }
  return result;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function oceanWeightedMean(planet: PlanetState, values: ArrayLike<number>): number {
  let sum = 0;
  let weightSum = 0;
  const { grid } = planet;
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = cellIndex(grid, x, y);
      if (planet.fields.elevation[i]! >= planet.globals.seaLevel) continue;
      sum += values[i]! * weight;
      weightSum += weight;
    }
  }
  return sum / weightSum;
}

describe('ocean chemistry', () => {
  it('keeps a modern ocean near one nutrient unit and mostly well oxygenated', () => {
    const planet = earthLikeOcean();
    oceanChemistry.runOneStep(planet, 0, rng);
    const oxygen = oceanValues(planet, planet.fields.oceanOxygen);
    expect(oceanWeightedMean(planet, planet.fields.nutrients)).toBeCloseTo(1, 5);
    expect(oxygen.filter((value) => value >= 0.7).length / oxygen.length).toBeGreaterThan(0.7);
    expect(mean(oxygen)).toBeGreaterThan(0.75);
    const upwellingNutrients: number[] = [];
    const openOceanNutrients: number[] = [];
    for (let i = 0; i < planet.grid.cellCount; i++) {
      if (planet.fields.elevation[i]! >= planet.globals.seaLevel) continue;
      (planet.fields.upwelling[i]! > 0 ? upwellingNutrients : openOceanNutrients).push(
        planet.fields.nutrients[i]!,
      );
    }
    expect(mean(upwellingNutrients)).toBeGreaterThan(mean(openOceanNutrients));
  });

  it('makes the entire ocean anoxic before atmospheric oxygenation', () => {
    const planet = earthLikeOcean();
    planet.globals.atmosphere.o2 = 0;
    oceanChemistry.runOneStep(planet, 0, rng);
    expect(Math.max(...oceanValues(planet, planet.fields.oceanOxygen))).toBe(0);
  });

  it('draws down oxygen in hot, nutrient-rich upwelling water', () => {
    const temperate = earthLikeOcean();
    temperate.fields.airTemperature.fill(15);
    oceanChemistry.runOneStep(temperate, 0, rng);

    const greenhouse = earthLikeOcean();
    greenhouse.fields.airTemperature.fill(40);
    greenhouse.fields.upwelling.fill(0.006);
    greenhouse.globals.carbon.weathering = 3;
    oceanChemistry.runOneStep(greenhouse, 0, rng);

    const normalOxygen = mean(oceanValues(temperate, temperate.fields.oceanOxygen));
    const hotOxygen = mean(oceanValues(greenhouse, greenhouse.fields.oceanOxygen));
    expect(hotOxygen).toBeLessThan(normalOxygen - 0.4);
    expect(
      oceanValues(greenhouse, greenhouse.fields.oceanOxygen).some((value) => value === 0),
    ).toBe(true);
  });

  it('responds to a rapid CO2 pulse but buffers a slow rise', () => {
    const pulse = earthLikeOcean();
    oceanChemistry.runOneStep(pulse, 0, rng);
    pulse.globals.atmosphere.co2 = 2_800;
    oceanChemistry.runOneStep(pulse, 100, rng);

    const ramp = earthLikeOcean();
    oceanChemistry.runOneStep(ramp, 0, rng);
    for (let step = 1; step <= 100; step++) {
      ramp.globals.atmosphere.co2 = 280 * 10 ** (step / 100);
      oceanChemistry.runOneStep(ramp, 10_000, rng);
    }

    expect(pulse.globals.oceanAcidity).toBeGreaterThan(0.35);
    expect(ramp.globals.oceanAcidity).toBeLessThan(0.03);
  });

  it('uses exact relaxations independent of step length', () => {
    const halfMillion = earthLikeOcean();
    const million = earthLikeOcean();
    const tenMillion = earthLikeOcean();
    for (const planet of [halfMillion, million, tenMillion]) {
      planet.fields.nutrients.fill(0.2);
      oceanChemistry.runOneStep(planet, 0, rng);
      planet.fields.nutrients.fill(0.2);
      planet.globals.atmosphere.co2 = 2_800;
    }
    for (let step = 0; step < 20; step++) oceanChemistry.runOneStep(halfMillion, 500_000, rng);
    for (let step = 0; step < 10; step++) oceanChemistry.runOneStep(million, 1_000_000, rng);
    oceanChemistry.runOneStep(tenMillion, 10_000_000, rng);

    expect(oceanWeightedMean(halfMillion, halfMillion.fields.nutrients)).toBeCloseTo(
      oceanWeightedMean(tenMillion, tenMillion.fields.nutrients),
      5,
    );
    expect(oceanWeightedMean(million, million.fields.nutrients)).toBeCloseTo(
      oceanWeightedMean(tenMillion, tenMillion.fields.nutrients),
      5,
    );
    expect(halfMillion.globals.oceanAcidity).toBeCloseTo(tenMillion.globals.oceanAcidity, 10);
    expect(million.globals.oceanAcidity).toBeCloseTo(tenMillion.globals.oceanAcidity, 10);
  });

  it('does not alter climate or atmospheric carbon', () => {
    const planet = earthLikeOcean();
    const temperatures = Float32Array.from(planet.fields.airTemperature);
    const co2 = planet.globals.atmosphere.co2;
    const meanTemperature = planet.globals.meanTemperature;
    oceanChemistry.runOneStep(planet, 1e6, rng);
    expect(planet.fields.airTemperature).toEqual(temperatures);
    expect(planet.globals.atmosphere.co2).toBe(co2);
    expect(planet.globals.meanTemperature).toBe(meanTemperature);
  });
});
