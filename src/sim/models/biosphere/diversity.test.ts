import { describe, expect, it } from 'vitest';
import { createPlanet } from '../../core/planet';
import { lifeClassIndex } from '../../data/lifeClasses';
import { inspectCellLife, updateDiversity } from './diversity';

describe('diversity', () => {
  it('counts classes above the threshold and lists them most advanced first', () => {
    const planet = createPlanet({ width: 8, height: 4 });
    const n = planet.grid.cellCount;
    planet.fields.elevation.fill(-3000);
    planet.fields.airTemperature.fill(20);
    planet.globals.atmosphere.o2 = 0.21;
    const set = (key: Parameters<typeof lifeClassIndex>[0], i: number, v: number) => {
      planet.biota.populations[lifeClassIndex(key) * n + i] = v;
    };
    set('prokaryotes', 3, 0.5);
    set('eukaryotes', 3, 0.3);
    set('fish', 3, 0.005);
    set('prokaryotes', 4, 0.4);
    updateDiversity(planet);
    expect(planet.fields.diversity[3]).toBe(2);
    expect(planet.fields.diversity[4]).toBe(1);
    expect(planet.fields.diversity[0]).toBe(0);
    const life = inspectCellLife(planet, 3);
    expect(life.classes.map((c) => c.index)).toEqual([
      lifeClassIndex('eukaryotes'),
      lifeClassIndex('prokaryotes'),
    ]);
    expect(life.classes[0]!.suitability).toBeGreaterThan(0);
  });
});
