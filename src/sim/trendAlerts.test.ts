import { describe, expect, it } from 'vitest';
import { createPlanet, type PlanetState } from './core/planet';
import { LIFE_CLASSES } from './data/lifeClasses';
import type { EventKey } from './events';
import { trendAlerts } from './trendAlerts';
import { createRandomWorld } from './world';

function evaluate(planet: PlanetState, years: number): void {
  trendAlerts.runOneStep(planet, years, {} as never);
  planet.globals.year += years;
}

function preparedPlanet(): PlanetState {
  const planet = createPlanet({ width: 8, height: 4 });
  planet.globals.runawayMargin = 50;
  planet.globals.iceFraction = 0.1;
  planet.globals.atmosphere.co2 = 300;
  planet.globals.atmosphere.o2 = 0.1;
  planet.globals.biodiversity = 0.8;
  planet.globals.fossilCarbon = 2_000;
  planet.globals.pollution = 0.2;
  for (let i = 0; i < LIFE_CLASSES.length; i++) planet.biota.appeared[i] = 0;
  planet.civilization.species = 12;
  evaluate(planet, 0);
  return planet;
}

describe('trend alerts', () => {
  const cases: [EventKey, (planet: PlanetState) => void][] = [
    ['trendRunaway', (p) => (p.globals.runawayMargin = 20)],
    ['trendSnowball', (p) => (p.globals.iceFraction = 0.55)],
    ['trendCo2Starvation', (p) => (p.globals.atmosphere.co2 = 180)],
    ['trendOxygenLoss', (p) => (p.globals.atmosphere.o2 = 0.03)],
    ['trendBiodiversityLoss', (p) => (p.globals.biodiversity = 0.4)],
    ['trendFossilLow', (p) => (p.globals.fossilCarbon = 900)],
    ['trendPollution', (p) => (p.globals.pollution = 0.7)],
  ];

  it.each(cases)('fires %s once while the diagnostic remains dangerous', (key, makeDangerous) => {
    const planet = preparedPlanet();
    makeDangerous(planet);
    evaluate(planet, key === 'trendPollution' ? 100 : 1e6);
    makeDangerous(planet);
    evaluate(planet, key === 'trendPollution' ? 100 : 1e6);
    expect(planet.events.filter((event) => event.key === key)).toHaveLength(1);
  });

  it('does not raise trend alerts on a stable quick world', () => {
    const world = createRandomWorld({ start: 'quick', seed: 73, width: 16, height: 8 });
    for (let i = 0; i < 2; i++) world.simulation.step(world.planet, 500_000);
    expect(world.planet.events.some((event) => event.key.startsWith('trend'))).toBe(false);
  });

  it('re-arms only after the runaway margin returns to the safe side of hysteresis', () => {
    const planet = preparedPlanet();
    planet.globals.runawayMargin = 20;
    evaluate(planet, 1e6);
    evaluate(planet, 1e6);
    expect(planet.events.filter((event) => event.key === 'trendRunaway')).toHaveLength(1);
    planet.globals.runawayMargin = 45;
    evaluate(planet, 1e6);
    planet.globals.runawayMargin = 20;
    evaluate(planet, 1e6);
    expect(planet.events.filter((event) => event.key === 'trendRunaway')).toHaveLength(2);
  });

  it('records oxygen and snowball threshold crossings as milestones', () => {
    const planet = preparedPlanet();
    planet.alertDiagnostics.greatOxidationReached = false;
    planet.alertDiagnostics.previous!.oxygenPressure = 0.005;
    planet.globals.atmosphere.o2 = 0.02;
    planet.globals.iceFraction = 0.9;
    evaluate(planet, 1e6);
    planet.globals.iceFraction = 0.5;
    evaluate(planet, 1e6);
    expect(planet.events.map((event) => event.key)).toEqual(
      expect.arrayContaining(['greatOxidation', 'snowballOnset', 'snowballEnded']),
    );
  });
});
