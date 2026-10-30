import { describe, expect, it } from 'vitest';
import { createPlanet, type PlanetState } from '../../core/planet';
import { lifeClassIndex } from '../../data/lifeClasses';
import { CITY_SPACING_KM, cityCellDistance, selectCitySites, updateCities } from './cities';

describe('civilization cities', () => {
  it('selects physically spaced sites with similar counts at two resolutions', () => {
    const coarse = settlementPattern(64, 32);
    const fine = settlementPattern(128, 64);
    const coarseSites = selectCitySites(coarse, 30);
    const fineSites = selectCitySites(fine, 30);

    expect(coarseSites.length).toBeGreaterThanOrEqual(10);
    expect(Math.abs(coarseSites.length - fineSites.length)).toBeLessThanOrEqual(1);
    for (const [state, sites] of [
      [coarse, coarseSites],
      [fine, fineSites],
    ] as const) {
      const minimum = CITY_SPACING_KM[state.civilization.age]! * 1000;
      for (let a = 0; a < sites.length; a++) {
        for (let b = a + 1; b < sites.length; b++) {
          expect(
            cityCellDistance(state.grid, sites[a]!.cell, sites[b]!.cell),
          ).toBeGreaterThanOrEqual(minimum);
        }
      }
    }
  });

  it('keeps a city identity when its settlement maximum moves nearby', () => {
    const planet = createPlanet({ width: 64, height: 32, seed: 91 });
    planet.civilization.species = lifeClassIndex('mammals');
    planet.civilization.age = 2;
    planet.civilization.population = 1;
    planet.fields.elevation.fill(500);
    const first = 16 * planet.grid.width + 10;
    const second = 16 * planet.grid.width + 34;
    planet.fields.civilization[first] = 1;
    planet.fields.civilization[second] = 0.5;

    updateCities(planet);
    const original = planet.civilization.cities.find((city) => city.cell === first)!;
    const originalName = original.name;
    const moved = first + 1;
    planet.globals.year += 100;
    planet.fields.civilization[first] = 0.5;
    planet.fields.civilization[moved] = 1;
    updateCities(planet);

    const persisted = planet.civilization.cities.find((city) => city.id === original.id)!;
    expect(persisted.cell).toBe(moved);
    expect(persisted.name).toBe(originalName);
    expect(persisted.foundedYear).toBe(0);
    expect(persisted.abandonedYear).toBeNull();
    expect(planet.civilization.cities.filter((city) => city.abandonedYear === null)).toHaveLength(
      2,
    );
  });
});

function settlementPattern(width: number, height: number): PlanetState {
  const planet = createPlanet({ width, height, seed: 27 });
  planet.civilization.species = lifeClassIndex('mammals');
  planet.civilization.age = 3;
  planet.fields.elevation.fill(500);
  const peaks = [-40, 0, 40].flatMap((latitude) =>
    [25, 115, 205, 295].map((longitude) => ({ latitude, longitude })),
  );
  const sigma = (7 * Math.PI) / 180;
  for (let cell = 0; cell < planet.grid.cellCount; cell++) {
    const row = Math.floor(cell / width);
    const latitude = (planet.grid.rowLatitude[row]! * Math.PI) / 180;
    const longitude = (((cell % width) + 0.5) * 2 * Math.PI) / width;
    let density = 0;
    for (const peak of peaks) {
      const peakLatitude = (peak.latitude * Math.PI) / 180;
      const peakLongitude = (peak.longitude * Math.PI) / 180;
      const cosine =
        Math.sin(latitude) * Math.sin(peakLatitude) +
        Math.cos(latitude) * Math.cos(peakLatitude) * Math.cos(longitude - peakLongitude);
      const angle = Math.acos(Math.max(-1, Math.min(1, cosine)));
      density = Math.max(density, Math.exp(-(angle * angle) / (2 * sigma * sigma)));
    }
    planet.fields.civilization[cell] = density;
  }
  return planet;
}
