import { describe, expect, it } from 'vitest';
import type { SimComponent } from '../../core/component';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import { generateTectonicPlanet } from '../geosphere/tectonics';
import { createCarbonCycle, mantleHeat } from './carbon';
import { createClimate } from './climate';
import { precipitationModel } from './precipitation';

const rng = createRng(1);

function planetAt(solarInput: number): PlanetState {
  const planet = createPlanet({ seed: 2, width: 64, height: 32 });
  generateTectonicPlanet(planet);
  planet.globals.year = 4.5e9;
  planet.globals.solarInput = solarInput;
  return planet;
}

/** Runs climate, precipitation and (optionally) the carbon cycle until they settle. */
function settle(planet: PlanetState, withCarbon: boolean): void {
  const components: SimComponent[] = [createClimate(), precipitationModel];
  if (withCarbon) components.push(createCarbonCycle());
  for (let k = 0; k < 30; k++) {
    for (const component of components) component.runOneStep(planet, 10e6, rng);
  }
}

describe('carbon cycle', () => {
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
  });

  it('lets CO₂ build up under a snowball until it thaws', () => {
    const planet = planetAt(0.95);
    planet.globals.atmosphere.co2 = 50;
    planet.fields.iceCover.fill(1);
    const climate = createClimate();
    const carbon = createCarbonCycle();
    climate.runOneStep(planet, 0, rng);
    expect(planet.globals.iceFraction).toBeGreaterThan(0.9);

    let thawed = false;
    for (let step = 0; step < 400 && !thawed; step++) {
      climate.runOneStep(planet, 1e6, rng);
      precipitationModel.runOneStep(planet, 1e6, rng);
      carbon.runOneStep(planet, 1e6, rng);
      thawed = planet.globals.iceFraction < 0.5;
    }
    expect(thawed).toBe(true);
    // It thawed because CO₂ accumulated while weathering was shut off under the ice.
    expect(planet.globals.atmosphere.co2).toBeGreaterThan(100);
  });

  it('has a hotter, more volcanic mantle on young planets', () => {
    expect(mantleHeat(4.5e9)).toBeCloseTo(1, 6);
    expect(mantleHeat(1e9)).toBeGreaterThan(1.4);
    expect(mantleHeat(9e9)).toBeLessThan(1);
  });
});
