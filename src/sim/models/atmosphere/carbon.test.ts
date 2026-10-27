import { describe, expect, it } from 'vitest';
import type { SimComponent } from '../../core/component';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { lifeClassIndex } from '../../data/lifeClasses';
import { generateTectonicPlanet } from '../geosphere/tectonics';
import {
  accumulateFossilCarbon,
  createCarbonCycle,
  DRY_DEGASSING_TIME,
  FOSSIL_CARBON_LOSS_TIME,
  mantleHeat,
  MODERN_BURIAL,
} from './carbon';
import { circulationModel } from './circulation';
import { createClimate } from './climate';
import { landIceMassBalance } from './ice';
import { precipitationModel } from './precipitation';
import { createSurfaceAlbedo } from './surfaceAlbedo';

const rng = createRng(1);

function planetAt(solarInput: number): PlanetState {
  const planet = createPlanet({ seed: 2, width: 64, height: 32 });
  generateTectonicPlanet(planet);
  planet.globals.year = 4.5e9;
  planet.globals.solarInput = solarInput;
  createSurfaceAlbedo().runOneStep(planet, 0, rng);
  return planet;
}

/** Runs climate, circulation, precipitation and (optionally) the carbon cycle until they settle. */
function settle(planet: PlanetState, withCarbon: boolean): void {
  const components: SimComponent[] = [
    createClimate(),
    circulationModel,
    precipitationModel,
    landIceMassBalance,
  ];
  if (withCarbon) components.push(createCarbonCycle());
  for (let k = 0; k < 30; k++) {
    for (const component of components) component.runOneStep(planet, 10e6, rng);
  }
}

describe('carbon cycle', () => {
  it('forms an Earth-like recoverable reserve from sustained organic burial', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    accumulateFossilCarbon(planet, 1e9, MODERN_BURIAL);
    const equilibrium = 0.1 * 2.5e-4 * FOSSIL_CARBON_LOSS_TIME;
    expect(planet.globals.fossilCarbon).toBeCloseTo(
      equilibrium * (1 - Math.exp(-1e9 / FOSSIL_CARBON_LOSS_TIME)),
      5,
    );
    expect(planet.globals.fossilCarbon).toBeGreaterThan(5_000);
    expect(planet.globals.atmosphere.co2).toBe(280);
  });

  it('balances outgassing and weathering once settled', () => {
    const planet = planetAt(1);
    settle(planet, true);
    const { outgassing, weathering } = planet.globals.carbon;
    expect(weathering).toBeCloseTo(outgassing, 1);
  });

  it('buffers warming from a brightening star by drawing down CO₂', () => {
    const results = [1, 1.08].map((solarInput) => {
      const free = planetAt(solarInput);
      settle(free, false);
      const regulated = planetAt(solarInput);
      settle(regulated, true);
      return { free, regulated };
    });
    const [dim, bright] = results as [(typeof results)[0], (typeof results)[0]];
    const freeWarming = bright.free.globals.meanTemperature - dim.free.globals.meanTemperature;
    const regulatedWarming =
      bright.regulated.globals.meanTemperature - dim.regulated.globals.meanTemperature;
    expect(bright.regulated.globals.atmosphere.co2).toBeLessThan(
      dim.regulated.globals.atmosphere.co2,
    );
    expect(regulatedWarming).toBeLessThan(freeWarming * 0.6);
  }, 10_000);

  it('lets CO₂ build up under a snowball until it thaws', () => {
    const planet = planetAt(0.95);
    planet.globals.atmosphere.co2 = 50;
    planet.fields.iceCover.fill(1);
    for (let i = 0; i < planet.grid.cellCount; i++) {
      if (planet.fields.elevation[i]! >= planet.globals.seaLevel) {
        planet.fields.iceThickness[i] = 1500;
      }
    }
    const climate = createClimate();
    const carbon = createCarbonCycle();
    climate.runOneStep(planet, 0, rng);
    expect(planet.globals.iceFraction).toBeGreaterThan(0.9);

    let thawed = false;
    for (let step = 0; step < 400 && !thawed; step++) {
      climate.runOneStep(planet, 1e6, rng);
      circulationModel.runOneStep(planet, 1e6, rng);
      precipitationModel.runOneStep(planet, 1e6, rng);
      landIceMassBalance.runOneStep(planet, 1e6, rng);
      carbon.runOneStep(planet, 1e6, rng);
      thawed = planet.globals.iceFraction < 0.5;
    }
    expect(thawed).toBe(true);
    // It thawed because CO₂ accumulated while weathering was shut off under the ice.
    expect(planet.globals.atmosphere.co2).toBeGreaterThan(100);
  });

  it('lets a thriving biosphere draw down CO₂ by burying organic carbon', () => {
    const barren = planetAt(1);
    settle(barren, true);
    const living = planetAt(1);
    living.biota.cover[lifeClassIndex('eukaryotes')] = 0.6;
    living.biota.cover[lifeClassIndex('plants')] = 0.3;
    settle(living, true);
    expect(living.globals.carbon.burial).toBeGreaterThan(0.1);
    expect(living.globals.atmosphere.co2).toBeLessThan(barren.globals.atmosphere.co2);
  });

  it('has a hotter, more volcanic mantle on young planets', () => {
    expect(mantleHeat(4.5e9)).toBeCloseTo(1, 6);
    expect(mantleHeat(1e9)).toBeGreaterThan(1.4);
    expect(mantleHeat(9e9)).toBeLessThan(1);
    expect(mantleHeat(4.5e9, 3_390_000)).toBeLessThan(mantleHeat(4.5e9));
  });

  function dryPlanet(): PlanetState {
    const planet = createPlanet({ width: 8, height: 4 });
    planet.globals.water = 0;
    planet.globals.initialWater = 0;
    planet.globals.atmosphere.waterVapor = 0;
    planet.globals.atmosphere.co2 = 1000;
    planet.globals.crustalCarbon = 0.01;
    return planet;
  }

  it('degasses a dry planet from its finite crustal reservoir, independent of step length', () => {
    const planet = dryPlanet();
    const carbon = createCarbonCycle();
    carbon.runOneStep(planet, 1e6, rng);
    const rate = planet.globals.carbon.outgassing / DRY_DEGASSING_TIME;
    const expectedBar = 0.01 * -Math.expm1(-rate * 1e6);
    // Small steps add CO2 at the outgassing rate (≈ linear in dt).
    expect(expectedBar).toBeCloseTo(0.01 * rate * 1e6, 6);
    expect(planet.globals.atmosphere.co2).toBeCloseTo(1000 + expectedBar * 1e6, 2);
    expect(planet.globals.crustalCarbon).toBeCloseTo(0.01 - expectedBar, 8);
    // Ten 1-Myr steps equal one 10-Myr step.
    const stepped = dryPlanet();
    const once = dryPlanet();
    for (let i = 0; i < 10; i++) carbon.runOneStep(stepped, 1e6, rng);
    carbon.runOneStep(once, 1e7, rng);
    expect(stepped.globals.atmosphere.co2).toBeCloseTo(once.globals.atmosphere.co2, 3);
    // The reservoir is the limit: carbon is conserved and never exceeded.
    carbon.runOneStep(planet, 100e9, rng);
    expect(planet.globals.crustalCarbon).toBeLessThan(1e-9);
    expect(planet.globals.atmosphere.co2).toBeCloseTo(11_000, 1);
  });

  it('does not grow CO2 geometrically on a frozen planet without a weathering sink', () => {
    const planet = dryPlanet();
    planet.globals.water = 1;
    planet.globals.tectonicRegime = 'stagnant';
    planet.fields.airTemperature.fill(-60);
    planet.fields.iceCover.fill(1);
    const carbon = createCarbonCycle();
    carbon.runOneStep(planet, 1e8, rng);
    expect(planet.globals.atmosphere.co2 * 1e-6 + planet.globals.crustalCarbon).toBeCloseTo(
      0.011,
      9,
    );
    expect(planet.globals.atmosphere.co2).toBeLessThan(11_000);
  });
});
