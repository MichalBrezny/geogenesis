import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT, type Grid } from '../../core/grid';
import type { City, PlanetState } from '../../core/planet';
import { PEOPLE_PER_KM2 } from '../../data/civilization';
import { LIFE_CLASSES } from '../../data/lifeClasses';
import { generateCityName } from '../../mapNames';

/** Physical separation of city sites by age, from sparse villages to dense modern networks. */
export const CITY_SPACING_KM = [1800, 1400, 1000, 750, 550, 400, 300] as const;
/** City identities can follow a moving density peak this far relative to their normal spacing. */
const MATCH_RADIUS_FACTOR = 0.75;
/** Abandoned cities remain visible as ruins through several evolution-era frames. */
export const RUIN_RETENTION_YEARS = 2e6;
const MIN_CITY_DENSITY = 1e-6;
const LARGE_RIVER_DISCHARGE = 1e11;

export interface CitySite {
  cell: number;
  score: number;
}

/** Great-circle distance between two cell centres, in metres. */
export function cityCellDistance(grid: Grid, a: number, b: number): number {
  const p = grid.cellPosition;
  const dot = p[a * 3]! * p[b * 3]! + p[a * 3 + 1]! * p[b * 3 + 1]! + p[a * 3 + 2]! * p[b * 3 + 2]!;
  return Math.acos(Math.max(-1, Math.min(1, dot))) * grid.radius;
}

/** Number of represented urban centres, bounded by both population and available technology. */
export function desiredCityCount(populationBillions: number, age: number): number {
  if (!(populationBillions > 0)) return 0;
  const populationCount = 1 + Math.floor((29 * populationBillions) / (populationBillions + 0.6));
  const ageCap = [4, 7, 12, 18, 24, 28, 30][Math.max(0, Math.min(6, age))]!;
  return Math.max(1, Math.min(ageCap, populationCount));
}

/**
 * Finds settlement-density maxima and greedily applies physical spacing. Coastal
 * sites and large rivers receive only a mild bonus, so density remains decisive.
 */
export function selectCitySites(
  state: PlanetState,
  maximum = desiredCityCount(state.civilization.population, state.civilization.age),
): CitySite[] {
  if (maximum <= 0) return [];
  const { grid, fields } = state;
  const topology = getTopology(grid);
  const candidates: CitySite[] = [];
  for (let cell = 0; cell < grid.cellCount; cell++) {
    const density = fields.civilization[cell]!;
    if (density < MIN_CITY_DENSITY) continue;
    let maximumHere = true;
    let coast = false;
    const ocean = fields.elevation[cell]! < state.globals.seaLevel;
    for (let direction = 0; direction < NEIGHBOR_COUNT; direction++) {
      const neighbor = topology.neighbors[cell * NEIGHBOR_COUNT + direction]!;
      if (neighbor < 0) continue;
      const neighborDensity = fields.civilization[neighbor]!;
      if (neighborDensity > density || (neighborDensity === density && neighbor < cell)) {
        maximumHere = false;
        break;
      }
      if (fields.elevation[neighbor]! < state.globals.seaLevel !== ocean) coast = true;
    }
    if (!maximumHere) continue;
    const river = Math.min(
      1,
      Math.log10(1 + Math.max(0, fields.discharge[cell]!) / LARGE_RIVER_DISCHARGE) / 2,
    );
    candidates.push({ cell, score: density * (1 + (coast ? 0.08 : 0) + river * 0.06) });
  }
  candidates.sort((a, b) => b.score - a.score || a.cell - b.cell);
  const spacing = CITY_SPACING_KM[Math.max(0, Math.min(6, state.civilization.age))]! * 1000;
  const selected: CitySite[] = [];
  for (const candidate of candidates) {
    if (selected.every((site) => cityCellDistance(grid, site.cell, candidate.cell) >= spacing)) {
      selected.push(candidate);
      if (selected.length >= maximum) break;
    }
  }
  return selected;
}

/** Rebuilds the small city registry while preserving identities near moving maxima. */
export function updateCities(state: PlanetState): void {
  const civ = state.civilization;
  ensureCityState(civ);
  const year = state.globals.year;
  if (civ.citySpecies !== civ.species) {
    abandonCivilizationCities(state, year);
    civ.citySpecies = civ.species;
  }
  civ.cities = civ.cities.filter(
    (city) => city.abandonedYear === null || year - city.abandonedYear <= RUIN_RETENTION_YEARS,
  );
  if (civ.species === null) return;

  const sites = selectCitySites(state);
  const active = civ.cities.filter((city) => city.abandonedYear === null);
  const unmatched = new Set(active.map((city) => city.id));
  const spacing = CITY_SPACING_KM[Math.max(0, Math.min(6, civ.age))]! * 1000;
  const matched: City[] = [];
  for (const site of sites) {
    let existing: City | undefined;
    let distance = Infinity;
    for (const city of active) {
      if (!unmatched.has(city.id)) continue;
      const candidateDistance = cityCellDistance(state.grid, city.cell, site.cell);
      if (
        candidateDistance < distance ||
        (candidateDistance === distance && city.id < (existing?.id ?? Infinity))
      ) {
        existing = city;
        distance = candidateDistance;
      }
    }
    if (existing && distance <= spacing * MATCH_RADIUS_FACTOR) {
      unmatched.delete(existing.id);
      existing.cell = site.cell;
      existing.age = civ.age;
      matched.push(existing);
    } else {
      const species = LIFE_CLASSES[civ.species]!.key;
      let name: string;
      do {
        name = generateCityName(state.seed, species, civ.nextCityNameOrdinal++);
      } while (civ.cities.some((city) => city.name === name));
      const city: City = {
        id: civ.nextCityId++,
        cell: site.cell,
        name,
        foundedYear: year,
        population: 0,
        capital: false,
        abandonedYear: null,
        age: civ.age,
      };
      civ.cities.push(city);
      matched.push(city);
    }
  }
  for (const city of active) {
    if (unmatched.has(city.id)) abandonCity(city, year);
  }
  assignCityPopulations(state, matched);
}

/** Marks the current civilization's active cities as ruins without dropping their names. */
export function abandonCivilizationCities(state: PlanetState, year = state.globals.year): void {
  ensureCityState(state.civilization);
  for (const city of state.civilization.cities) {
    if (city.abandonedYear === null) abandonCity(city, year);
  }
  state.civilization.citySpecies = null;
}

function abandonCity(city: City, year: number): void {
  city.population = 0;
  city.capital = false;
  city.abandonedYear = year;
}

function assignCityPopulations(state: PlanetState, cities: City[]): void {
  for (const city of cities) {
    city.population = 0;
    city.capital = false;
  }
  if (cities.length === 0) return;
  const { grid } = state;
  for (let cell = 0; cell < grid.cellCount; cell++) {
    const density = state.fields.civilization[cell]!;
    if (density <= 0) continue;
    let nearest = cities[0]!;
    let distance = cityCellDistance(grid, cell, nearest.cell);
    for (let index = 1; index < cities.length; index++) {
      const candidate = cities[index]!;
      const candidateDistance = cityCellDistance(grid, cell, candidate.cell);
      if (
        candidateDistance < distance ||
        (candidateDistance === distance && candidate.id < nearest.id)
      ) {
        nearest = candidate;
        distance = candidateDistance;
      }
    }
    const row = Math.floor(cell / grid.width);
    nearest.population += (density * grid.rowCellArea[row]! * PEOPLE_PER_KM2) / 1e15;
  }
  cities.sort((a, b) => b.population - a.population || a.id - b.id);
  cities[0]!.capital = true;
}

function ensureCityState(civ: PlanetState['civilization']): void {
  civ.cities ??= [];
  civ.nextCityId ??= 1;
  civ.nextCityNameOrdinal ??= 0;
  civ.citySpecies ??= null;
}

/** Closest active city to a cell; the registry is small enough for a direct scan. */
export function nearestActiveCity(state: PlanetState, cell: number): City | undefined {
  let nearest: City | undefined;
  let distance = Infinity;
  for (const city of state.civilization.cities ?? []) {
    if (city.abandonedYear !== null) continue;
    const candidateDistance = cityCellDistance(state.grid, cell, city.cell);
    if (
      candidateDistance < distance ||
      (candidateDistance === distance && city.id < (nearest?.id ?? Infinity))
    ) {
      nearest = city;
      distance = candidateDistance;
    }
  }
  return nearest;
}

/** Diagnostic component: it never changes the settlement field or simulation RNG. */
export const cityModel: SimComponent = {
  name: 'cities',
  inputs: ['civilization', 'elevation', 'discharge'],
  outputs: [],
  runOneStep(state) {
    updateCities(state);
  },
};

export const CITY_MODEL_INTERVAL_YEARS = 100;
