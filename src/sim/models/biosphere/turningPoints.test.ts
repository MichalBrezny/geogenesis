import { describe, expect, it } from 'vitest';
import { cellIndex } from '../../core/grid';
import { createPlanet, type PlanetState } from '../../core/planet';
import { createRng } from '../../core/rng';
import {
  LIFE_CLASS_COUNT,
  LIFE_CLASSES,
  lifeClassIndex,
  type LifeClassKey,
} from '../../data/lifeClasses';
import {
  adaptToClimate,
  applyCompetition,
  biodiversityIndex,
  classSuitability,
  createLife,
  evolutionBoost,
  lastSnowballEnd,
  nutrientFactor,
  windowBoost,
} from './life';

/** A temperate, well-oxygenated water world with a land strip (columns 8–13) under plants. */
function earthlike(): PlanetState {
  const planet = createPlanet({ width: 32, height: 16 });
  const n = planet.grid.cellCount;
  planet.fields.elevation.fill(-3000);
  for (let y = 0; y < 16; y++) {
    for (let x = 8; x < 14; x++) planet.fields.elevation[cellIndex(planet.grid, x, y)] = 300;
  }
  planet.fields.airTemperature.fill(18);
  planet.fields.biome.fill(4); // temperate forest; ignored at sea
  for (let i = 0; i < n; i++) {
    const sea = planet.fields.elevation[i]! < 0 ? 1 : 0;
    planet.fields.oceanOxygen[i] = sea;
    planet.fields.nutrients[i] = sea;
  }
  planet.globals.meanTemperature = 18;
  planet.globals.atmosphere.o2 = 0.21;
  planet.globals.atmosphere.co2 = 280;
  planet.globals.year = 4e9;
  return planet;
}

const SEA = (planet: PlanetState) => cellIndex(planet.grid, 24, 8);
const LAND = (planet: PlanetState) => cellIndex(planet.grid, 10, 8);

function populate(planet: PlanetState, keys: LifeClassKey[], value = 0.8): void {
  const n = planet.grid.cellCount;
  for (const key of keys) {
    const c = lifeClassIndex(key);
    const sea = LIFE_CLASSES[c]!.habitat === 'ocean';
    for (let i = 0; i < n; i++) {
      if (planet.fields.elevation[i]! < 0 === sea) planet.biota.populations[c * n + i] = value;
    }
  }
}

const fit = (planet: PlanetState, key: LifeClassKey, cell: number) =>
  classSuitability(planet, lifeClassIndex(key))[cell]!;

describe('stressors', () => {
  it('dims photosynthesis and everything that eats it with dust, microbes less', () => {
    const planet = earthlike();
    populate(planet, ['plants']);
    const clear = ['prokaryotes', 'eukaryotes', 'fish', 'plants', 'mammals'].map((k) =>
      fit(
        planet,
        k as LifeClassKey,
        k === 'plants' || k === 'mammals' ? LAND(planet) : SEA(planet),
      ),
    );
    planet.globals.dust = 2;
    const dark = ['prokaryotes', 'eukaryotes', 'fish', 'plants', 'mammals'].map((k) =>
      fit(
        planet,
        k as LifeClassKey,
        k === 'plants' || k === 'mammals' ? LAND(planet) : SEA(planet),
      ),
    );
    const ratio = dark.map((d, k) => d / clear[k]!);
    expect(ratio[1]).toBeCloseTo(Math.exp(-2), 5); // eukaryotic algae
    expect(ratio[2]).toBeCloseTo(Math.exp(-2), 5); // fish, through the food chain
    expect(ratio[3]).toBeCloseTo(Math.exp(-2), 5); // plants
    expect(ratio[4]).toBeCloseTo(Math.exp(-2), 5); // land animals
    // Prokaryotes also live on chemosynthesis.
    expect(ratio[0]).toBeGreaterThan(0.6);
  });

  it('suffocates complex marine animals in anoxic water but not microbes or air breathers', () => {
    const planet = earthlike();
    const sea = SEA(planet);
    planet.fields.oceanOxygen.fill(0.1);
    expect(fit(planet, 'fish', sea)).toBe(0);
    expect(fit(planet, 'radiates', sea)).toBe(0);
    expect(fit(planet, 'prokaryotes', sea)).toBeGreaterThan(0.5);
    expect(fit(planet, 'eukaryotes', sea)).toBeGreaterThan(0.5);
    expect(fit(planet, 'cetaceans', sea)).toBeGreaterThan(0.5);
  });

  it('feeds more marine animals on shelves and upwelling than in nutrient-poor gyres', () => {
    expect(nutrientFactor(1)).toBeCloseTo(1, 6);
    expect(nutrientFactor(2.5)).toBe(1);
    expect(nutrientFactor(0.3)).toBeLessThan(0.6);
    expect(nutrientFactor(0)).toBe(0);
    const planet = earthlike();
    planet.fields.nutrients.fill(0.3);
    expect(fit(planet, 'fish', SEA(planet))).toBeCloseTo(
      fit(earthlike(), 'fish', 24 + 8 * 32) * nutrientFactor(0.3),
      5,
    );
    expect(fit(planet, 'eukaryotes', SEA(planet))).toBe(
      fit(earthlike(), 'eukaryotes', SEA(planet)),
    );
  });

  it('harms calcifiers in an acidified sea', () => {
    const planet = earthlike();
    const sea = SEA(planet);
    const before = { mollusks: fit(planet, 'mollusks', sea), fish: fit(planet, 'fish', sea) };
    planet.globals.oceanAcidity = 0.35;
    expect(fit(planet, 'mollusks', sea)).toBeLessThan(0.5 * before.mollusks);
    expect(fit(planet, 'radiates', sea)).toBeLessThan(0.5 * fit(earthlike(), 'radiates', sea));
    expect(fit(planet, 'fish', sea)).toBe(before.fish);
  });

  it('burns plants above ~25 % oxygen and starves them below ~10 µbar CO₂ (C4)', () => {
    const planet = earthlike();
    const land = LAND(planet);
    const normal = fit(planet, 'plants', land);
    planet.globals.atmosphere.o2 = 0.32;
    expect(fit(planet, 'plants', land)).toBeLessThan(0.6 * normal);
    planet.globals.atmosphere.o2 = 0.21;
    planet.globals.atmosphere.co2 = 40;
    expect(fit(planet, 'plants', land)).toBeLessThan(0.5 * normal);
    planet.globals.atmosphere.co2 = 8;
    expect(fit(planet, 'plants', land)).toBe(0);
    // Animals in thin oxygen are stressed by their physiological thresholds.
    planet.globals.atmosphere.co2 = 280;
    populate(planet, ['plants']);
    const mammals = fit(planet, 'mammals', land);
    planet.globals.atmosphere.o2 = 0.17;
    expect(fit(planet, 'mammals', land)).toBeLessThan(0.5 * mammals);
  });

  it('stresses complex life under rapid climate change, independently of the step length', () => {
    const lag = (dt: number) => {
      const planet = earthlike();
      // Warming at 60 °C per Myr (a lag of ~6 °C against a 100 kyr adaptation time).
      for (let t = 0; t < 1e6; t += dt) {
        planet.globals.meanTemperature = 18 + 60e-6 * (t + dt);
        adaptToClimate(planet, dt);
      }
      return planet;
    };
    const lags = [1e4, 1e5, 5e5].map((dt) => {
      const planet = lag(dt);
      return planet.globals.meanTemperature - planet.biota.ecology!.adaptedTemperature;
    });
    for (const value of lags) expect(value).toBeCloseTo(6, 0);
    const planet = lag(1e5);
    planet.fields.airTemperature.fill(18);
    expect(fit(planet, 'fish', SEA(planet))).toBeLessThan(
      0.85 * fit(earthlike(), 'fish', SEA(planet)),
    );
    expect(fit(planet, 'prokaryotes', SEA(planet))).toBe(
      fit(earthlike(), 'prokaryotes', SEA(planet)),
    );
    // A slow warming builds no lag.
    const slow = earthlike();
    for (let t = 0; t < 10e6; t += 5e5) {
      slow.globals.meanTemperature = 18 + 1e-6 * (t + 5e5);
      adaptToClimate(slow, 5e5);
    }
    expect(slow.globals.meanTemperature - slow.biota.ecology!.adaptedTemperature).toBeLessThan(0.2);
  });
});

describe('biodiversity index', () => {
  it('is bounded by 0 and 1', () => {
    const none = Array(LIFE_CLASS_COUNT).fill(0);
    expect(biodiversityIndex(none)).toBe(0);
    const one = [...none];
    one[0] = 0.7;
    expect(biodiversityIndex(one)).toBeCloseTo(1 / LIFE_CLASS_COUNT, 6);
    expect(biodiversityIndex(Array(LIFE_CLASS_COUNT).fill(0.3))).toBeCloseTo(1, 6);
    const mixed = Array.from({ length: LIFE_CLASS_COUNT }, (_, c) => (c < 6 ? 0.5 / (c + 1) : 0));
    const value = biodiversityIndex(mixed);
    expect(value).toBeGreaterThan(1 / LIFE_CLASS_COUNT);
    expect(value).toBeLessThan(6 / LIFE_CLASS_COUNT);
  });
});

/** Runs a settled complex biosphere, then `perturb` from year 4.1 Gyr, and returns the mass extinctions. */
function extinctionRun(
  dt: number,
  perturb: (planet: PlanetState, t: number) => void,
  years = 20e6,
) {
  const planet = earthlike();
  populate(planet, [
    'prokaryotes',
    'eukaryotes',
    'radiates',
    'mollusks',
    'fish',
    'plants',
    'insects',
  ]);
  populate(planet, ['mammals'], 0.5);
  const life = createLife({ mutationRate: 0 });
  const rng = createRng(3);
  for (let t = 0; t < 30e6; t += 1e6) life.runOneStep(planet, 1e6, rng);
  for (let t = 0; t < years; t += dt) {
    perturb(planet, t);
    life.runOneStep(planet, dt, rng);
    planet.globals.year += dt;
  }
  return { planet, events: planet.events.filter((e) => e.key === 'massExtinction') };
}

describe('mass extinctions', () => {
  it('detects a fast collapse once, with its cause, at any step length', () => {
    const results = [0.25e6, 0.5e6, 1e6].map((dt) =>
      extinctionRun(dt, (planet, t) => {
        // Anoxic oceans and a dark sky for 2 Myr.
        const pulse = t >= 5e6 && t < 7e6;
        planet.fields.oceanOxygen.fill(pulse ? 0.05 : 1);
        for (let i = 0; i < planet.grid.cellCount; i++) {
          if (planet.fields.elevation[i]! > 0) planet.fields.oceanOxygen[i] = 0;
        }
        planet.globals.dust = pulse ? 1.5 : 0;
      }),
    );
    const years = results.map(({ events }) => {
      expect(events).toHaveLength(1);
      expect(['anoxia', 'dust']).toContain(events[0]!.subject);
      return events[0]!.year;
    });
    for (const year of years) expect(Math.abs(year - years[0]!)).toBeLessThanOrEqual(1e6);
    expect(results[0]!.planet.globals.lastMassExtinctionYear).toBe(years[0]);
  });

  it('does not count a slow decline, even to the end', () => {
    for (const dt of [0.5e6, 1e6]) {
      const { events } = extinctionRun(
        dt,
        (planet, t) => {
          // Seas lose their oxygen over 60 Myr.
          const oxygen = Math.max(0, 1 - t / 60e6);
          for (let i = 0; i < planet.grid.cellCount; i++) {
            if (planet.fields.elevation[i]! < 0) planet.fields.oceanOxygen[i] = oxygen;
          }
        },
        70e6,
      );
      expect(events).toHaveLength(0);
    }
  });
});

describe('recovery and the Cambrian explosion', () => {
  it('integrates boost windows over the step', () => {
    expect(windowBoost(0, 1e6, null, 8e6, 4)).toBe(1);
    expect(windowBoost(0, 1e6, 0, 8e6, 4)).toBe(4);
    expect(windowBoost(7.5e6, 1e6, 0, 8e6, 4)).toBeCloseTo(2.5, 6);
    expect(windowBoost(9e6, 1e6, 0, 8e6, 4)).toBe(1);
    // A 10 Myr step through the whole window carries the same total boost.
    expect((windowBoost(0, 10e6, 0, 8e6, 4) - 1) * 10e6).toBeCloseTo((4 - 1) * 8e6, 0);
  });

  it('speeds up evolution for a while after a mass extinction', () => {
    const planet = earthlike();
    const mammals = LIFE_CLASSES[lifeClassIndex('mammals')]!;
    expect(evolutionBoost(planet, mammals, 0.5e6)).toBe(1);
    planet.globals.lastMassExtinctionYear = planet.globals.year - 1e6;
    expect(evolutionBoost(planet, mammals, 0.5e6)).toBeGreaterThan(3);
    planet.globals.lastMassExtinctionYear = planet.globals.year - 20e6;
    expect(evolutionBoost(planet, mammals, 0.5e6)).toBe(1);
  });

  it('ties the first animals to oxygen and a post-snowball window, then bursts', () => {
    const planet = earthlike();
    const radiates = LIFE_CLASSES[lifeClassIndex('radiates')]!;
    const fish = LIFE_CLASSES[lifeClassIndex('fish')]!;
    planet.globals.atmosphere.o2 = 0.02;
    expect(evolutionBoost(planet, radiates, 0.5e6)).toBe(0);
    planet.globals.atmosphere.o2 = 0.1;
    expect(evolutionBoost(planet, radiates, 0.5e6)).toBe(1);
    // A snowball that ended 10 Myr ago.
    const now = planet.globals.year;
    planet.history.year.push(now - 30e6, now - 20e6, now - 10e6, now - 5e6);
    planet.history.iceFraction.push(0.1, 0.8, 0.2, 0.1);
    expect(lastSnowballEnd(planet)).toBe(now - 10e6);
    expect(evolutionBoost(planet, radiates, 0.5e6)).toBe(5);
    // The animal classes radiate quickly once the first animals exist.
    expect(evolutionBoost(planet, fish, 0.5e6)).toBe(1);
    planet.biota.appeared[lifeClassIndex('radiates')] = now - 5e6;
    expect(evolutionBoost(planet, fish, 0.5e6)).toBe(5);
    planet.biota.appeared[lifeClassIndex('radiates')] = now - 100e6;
    expect(evolutionBoost(planet, fish, 0.5e6)).toBe(1);
  });

  it('records the Cambrian explosion once, when the first animals evolve', () => {
    const planet = earthlike();
    populate(planet, ['prokaryotes', 'eukaryotes']);
    const life = createLife({ mutationRate: 200 });
    const rng = createRng(5);
    for (let step = 0; step < 40; step++) {
      life.runOneStep(planet, 1e6, rng);
      planet.globals.year += 1e6;
    }
    expect(planet.biota.appeared[lifeClassIndex('radiates')]).not.toBeNull();
    expect(planet.events.filter((e) => e.key === 'cambrianExplosion')).toHaveLength(1);
  });
});

describe('competition', () => {
  it('makes classes of one guild share a cell, with an edge for the more advanced', () => {
    const planet = earthlike();
    const n = planet.grid.cellCount;
    const sea = SEA(planet);
    const relevant = LIFE_CLASSES.map(() => true);
    const compute = () => {
      const s = new Float32Array(n * LIFE_CLASS_COUNT);
      for (let c = 0; c < LIFE_CLASS_COUNT; c++)
        classSuitability(planet, c, s.subarray(c * n, (c + 1) * n));
      const alone = s.slice();
      applyCompetition(planet, s, relevant);
      return { alone, s };
    };
    const mollusks = lifeClassIndex('mollusks');
    const trichordates = lifeClassIndex('trichordates');
    const eukaryotes = lifeClassIndex('eukaryotes');
    populate(planet, ['mollusks', 'eukaryotes']);
    const solo = compute();
    expect(solo.s[mollusks * n + sea]).toBeCloseTo(solo.alone[mollusks * n + sea]!, 6);
    populate(planet, ['trichordates']);
    const both = compute();
    const m = both.s[mollusks * n + sea]! / both.alone[mollusks * n + sea]!;
    const t = both.s[trichordates * n + sea]! / both.alone[trichordates * n + sea]!;
    expect(m).toBeLessThan(0.85);
    expect(m).toBeGreaterThan(0.5);
    // Trichordates are more advanced and keep a larger share.
    expect(t).toBeGreaterThan(m);
    // Microbes have no guild and are not affected.
    expect(both.s[eukaryotes * n + sea]).toBe(both.alone[eukaryotes * n + sea]);
  });
});
