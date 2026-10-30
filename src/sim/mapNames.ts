import type { SimComponent } from './core/component';
import type { Grid } from './core/grid';
import type { PlanetState } from './core/planet';
import type { LifeClassKey } from './data/lifeClasses';
import { LakeType } from './models/geosphere/flowRouting';

export const MAP_FEATURE_KINDS = [
  'plate',
  'continent',
  'island',
  'ocean',
  'mountain',
  'lake',
  'river',
] as const;
export type MapFeatureKind = (typeof MAP_FEATURE_KINDS)[number];

/** A compact, saved description of a named feature. Footprints are only for overlap tracking. */
export interface NamedMapFeature {
  id: number;
  kind: MapFeatureKind;
  name: string;
  /** Representative cell used to place the label. */
  cell: number;
  /** Surface area in square metres, or length in metres for rivers. */
  size: number;
  /** Deterministic sample of member cells, capped to keep saves compact. */
  footprint: number[];
  /** Plate id for plate labels; omitted for geographic features. */
  plateId?: number;
}

export interface MapNamingState {
  nextFeatureId: number;
  nextNameOrdinal: number;
  updatedYear: number;
  features: NamedMapFeature[];
}

export function createMapNamingState(): MapNamingState {
  return { nextFeatureId: 1, nextNameOrdinal: 0, updatedYear: -1, features: [] };
}

const ONSETS = ['b', 'd', 'f', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z'] as const;
const VOWELS = ['a', 'e', 'i', 'o', 'u'] as const;
const CODAS = ['', '', '', 'l', 'm', 'n', 'r', 's'] as const;
const KIND_SALT: Record<MapFeatureKind, number> = {
  plate: 0x91e10da5,
  continent: 0x3c6ef372,
  island: 0xa54ff53a,
  ocean: 0x510e527f,
  mountain: 0x9b05688c,
  lake: 0x1f83d9ab,
  river: 0x5be0cd19,
};

/**
 * Invents a pronounceable name without touching the simulation RNG. The output is
 * solely a hash of the planet seed, feature kind and private ordinal.
 */
export function generateFeatureName(seed: number, kind: MapFeatureKind, ordinal: number): string {
  let state = mix32((seed ^ KIND_SALT[kind] ^ Math.imul(ordinal + 1, 0x9e3779b1)) >>> 0);
  const next = (limit: number) => {
    state = mix32((state + 0x6d2b79f5) >>> 0);
    return state % limit;
  };
  const syllables = 2 + next(2);
  let name = '';
  for (let i = 0; i < syllables; i++) {
    name += ONSETS[next(ONSETS.length)]!;
    name += VOWELS[next(VOWELS.length)]!;
    if (i === syllables - 1 || next(4) === 0) name += CODAS[next(CODAS.length)]!;
  }
  return name[0]!.toUpperCase() + name.slice(1);
}

interface CityNamePalette {
  onsets: readonly string[];
  vowels: readonly string[];
  codas: readonly string[];
}

/** Species-specific sound palettes; even unrelated civilizations remain recognisable by ear. */
const CITY_NAME_PALETTES: Readonly<Record<LifeClassKey, CityNamePalette>> = {
  prokaryotes: { onsets: ['b', 'g', 'm', 'n'], vowels: ['a', 'i', 'u'], codas: ['', 'm'] },
  eukaryotes: { onsets: ['l', 'm', 'n', 'v'], vowels: ['e', 'i', 'o'], codas: ['', 'n'] },
  plants: { onsets: ['f', 'l', 'm', 's'], vowels: ['a', 'e', 'o'], codas: ['', 'l'] },
  radiates: { onsets: ['r', 's', 'v', 'z'], vowels: ['a', 'i', 'o'], codas: ['', 's'] },
  arthropods: { onsets: ['k', 'p', 't', 'z'], vowels: ['a', 'i', 'u'], codas: ['', 'k', 't'] },
  mollusks: { onsets: ['l', 'm', 'n', 'v'], vowels: ['a', 'o', 'u'], codas: ['', '', 'm'] },
  trichordates: { onsets: ['d', 'l', 'r', 't'], vowels: ['a', 'e', 'i'], codas: ['', 'n'] },
  fish: { onsets: ['f', 'l', 's', 'v'], vowels: ['a', 'i', 'u'], codas: ['', '', 's'] },
  insects: { onsets: ['k', 'p', 't', 'v'], vowels: ['e', 'i', 'u'], codas: ['', 'k', 't'] },
  amphibians: { onsets: ['b', 'g', 'l', 'm'], vowels: ['a', 'o', 'u'], codas: ['', 'm', 'n'] },
  reptiles: { onsets: ['k', 'r', 's', 'z'], vowels: ['a', 'e', 'o'], codas: ['', 'r', 's'] },
  dinosaurs: { onsets: ['d', 'k', 'r', 't'], vowels: ['a', 'o', 'u'], codas: ['', 'r', 'n'] },
  avians: { onsets: ['l', 'r', 's', 'v'], vowels: ['a', 'e', 'i'], codas: ['', '', 'l'] },
  mammals: { onsets: ['b', 'd', 'm', 'n', 'v'], vowels: ['a', 'e', 'o'], codas: ['', 'n', 'r'] },
  cetaceans: {
    onsets: ['h', 'l', 'm', 'n', 'w'],
    vowels: ['a', 'e', 'i', 'o', 'u'],
    codas: ['', '', '', 'l'],
  },
};

const CITY_KIND_SALT = 0xc17a4e5d;

/** Deterministic city name from the planet, a city salt, species and private ordinal. */
export function generateCityName(seed: number, species: LifeClassKey, ordinal: number): string {
  const palette = CITY_NAME_PALETTES[species];
  let speciesSalt = 0x811c9dc5;
  for (let index = 0; index < species.length; index++) {
    speciesSalt ^= species.charCodeAt(index);
    speciesSalt = Math.imul(speciesSalt, 0x01000193);
  }
  let state = mix32(
    (seed ^ CITY_KIND_SALT ^ speciesSalt ^ Math.imul(ordinal + 1, 0x9e3779b1)) >>> 0,
  );
  const next = (limit: number) => {
    state = mix32((state + 0x6d2b79f5) >>> 0);
    return state % limit;
  };
  const syllables = 2 + next(2);
  let name = '';
  for (let index = 0; index < syllables; index++) {
    name += palette.onsets[next(palette.onsets.length)]!;
    name += palette.vowels[next(palette.vowels.length)]!;
    name += palette.codas[next(palette.codas.length)]!;
  }
  return name[0]!.toUpperCase() + name.slice(1);
}

/** Rules intentionally kept simple enough that every generated name can be spoken at sight. */
export function isPronounceableName(name: string): boolean {
  return (
    /^[A-Z][a-z]{3,11}$/.test(name) &&
    (name.match(/[aeiou]/gi)?.length ?? 0) >= 2 &&
    !/[bcdfghjklmnpqrstvwxyz]{3}/i.test(name)
  );
}

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

interface FeatureCandidate {
  kind: MapFeatureKind;
  cell: number;
  size: number;
  cells: number[];
  plateId?: number;
}

interface Region {
  cells: number[];
  area: number;
  cell: number;
}

/** Rebuilds names from current geography, preserving old names by maximum overlap. */
export function updateMapNames(state: PlanetState): void {
  const naming = state.mapNaming;
  const candidates = collectCandidates(state);
  const previous = naming.features;
  const claimed = new Set<number>();
  const usedNames = new Set<string>();
  const features: NamedMapFeature[] = [];

  // Larger split pieces claim their old feature first; the smaller pieces receive new names.
  candidates.sort((a, b) => b.size - a.size || a.kind.localeCompare(b.kind) || a.cell - b.cell);
  for (const candidate of candidates) {
    const exactPlate =
      candidate.kind === 'plate'
        ? previous.find(
            (feature) => feature.kind === 'plate' && feature.plateId === candidate.plateId,
          )
        : undefined;
    const matched = exactPlate ?? bestOverlap(candidate, previous, claimed);
    let feature: NamedMapFeature;
    if (matched && !claimed.has(matched.id)) {
      claimed.add(matched.id);
      feature = {
        ...matched,
        kind: candidate.kind,
        cell: candidate.cell,
        size: candidate.size,
        footprint: sampleFootprint(candidate.cells),
        ...(candidate.plateId === undefined ? {} : { plateId: candidate.plateId }),
      };
    } else {
      let name: string;
      do {
        name = generateFeatureName(state.seed, candidate.kind, naming.nextNameOrdinal++);
      } while (usedNames.has(name));
      feature = {
        id: naming.nextFeatureId++,
        kind: candidate.kind,
        name,
        cell: candidate.cell,
        size: candidate.size,
        footprint: sampleFootprint(candidate.cells),
        ...(candidate.plateId === undefined ? {} : { plateId: candidate.plateId }),
      };
    }
    usedNames.add(feature.name);
    features.push(feature);
  }
  features.sort((a, b) => a.id - b.id);
  naming.features = features;
  naming.updatedYear = state.globals.year;
}

function bestOverlap(
  candidate: FeatureCandidate,
  previous: readonly NamedMapFeature[],
  claimed: ReadonlySet<number>,
): NamedMapFeature | undefined {
  if (previous.length === 0) return undefined;
  const family = featureFamily(candidate.kind);
  const members = new Set(candidate.cells);
  let best: NamedMapFeature | undefined;
  let bestCount = 0;
  for (const feature of previous) {
    if (claimed.has(feature.id) || featureFamily(feature.kind) !== family) continue;
    let count = 0;
    for (const cell of feature.footprint) if (members.has(cell)) count++;
    if (
      count > bestCount ||
      (count === bestCount && count > 0 && feature.id < (best?.id ?? Infinity))
    ) {
      best = feature;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : undefined;
}

function featureFamily(kind: MapFeatureKind): string {
  return kind === 'continent' || kind === 'island' ? 'land' : kind;
}

function collectCandidates(state: PlanetState): FeatureCandidate[] {
  const { grid, fields } = state;
  const seaLevel = state.globals.seaLevel;
  const out: FeatureCandidate[] = [];

  const plateCells = new Map<number, number[]>();
  for (let i = 0; i < grid.cellCount; i++) {
    const id = fields.plateId[i]!;
    const cells = plateCells.get(id) ?? [];
    cells.push(i);
    plateCells.set(id, cells);
  }
  for (const plate of [...state.plates].sort((a, b) => a.id - b.id)) {
    const cells = plateCells.get(plate.id) ?? [];
    if (cells.length === 0) continue;
    out.push({
      kind: 'plate',
      plateId: plate.id,
      cells,
      cell: representativeCell(grid, cells),
      size: cellsArea(grid, cells),
    });
  }

  const land = connectedRegions(grid, (i) => fields.elevation[i]! >= seaLevel)
    .sort((a, b) => b.area - a.area)
    .slice(0, 14);
  const landArea = land.reduce((sum, region) => sum + region.area, 0);
  for (let index = 0; index < land.length; index++) {
    const region = land[index]!;
    const continent =
      index < 7 && region.area >= Math.max(landArea * 0.035, planetArea(grid) * 0.004);
    out.push({
      kind: continent ? 'continent' : 'island',
      cells: region.cells,
      cell: region.cell,
      size: region.area,
    });
    if (continent) {
      let summit = region.cells[0]!;
      for (const cell of region.cells) {
        if (fields.elevation[cell]! > fields.elevation[summit]!) summit = cell;
      }
      out.push({
        kind: 'mountain',
        cells: region.cells,
        cell: summit,
        size: Math.max(1, fields.elevation[summit]! - seaLevel),
      });
    }
  }

  for (const region of connectedRegions(grid, (i) => fields.elevation[i]! < seaLevel)
    .sort((a, b) => b.area - a.area)
    .slice(0, 6)) {
    out.push({ kind: 'ocean', cells: region.cells, cell: region.cell, size: region.area });
  }

  for (const region of connectedRegions(
    grid,
    (i) => fields.lakeType[i] === LakeType.Fresh || fields.lakeType[i] === LakeType.Salt,
  )
    .sort((a, b) => b.area - a.area)
    .slice(0, 6)) {
    out.push({ kind: 'lake', cells: region.cells, cell: region.cell, size: region.area });
  }

  return out;
}

function connectedRegions(grid: Grid, included: (cell: number) => boolean): Region[] {
  const seen = new Uint8Array(grid.cellCount);
  const regions: Region[] = [];
  const { width, height } = grid;
  for (let start = 0; start < grid.cellCount; start++) {
    if (seen[start] || !included(start)) continue;
    const cells: number[] = [];
    const queue = [start];
    seen[start] = 1;
    for (let q = 0; q < queue.length; q++) {
      const cell = queue[q]!;
      cells.push(cell);
      const x = cell % width;
      const y = Math.floor(cell / width);
      const neighbors = [
        y > 0 ? cell - width : -1,
        y * width + ((x + 1) % width),
        y + 1 < height ? cell + width : -1,
        y * width + ((x + width - 1) % width),
      ];
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && !seen[neighbor] && included(neighbor)) {
          seen[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    regions.push({ cells, area: cellsArea(grid, cells), cell: representativeCell(grid, cells) });
  }
  return regions;
}

function cellsArea(grid: Grid, cells: readonly number[]): number {
  let area = 0;
  for (const cell of cells) area += grid.rowCellArea[Math.floor(cell / grid.width)]!;
  return area;
}

function planetArea(grid: Grid): number {
  return 4 * Math.PI * grid.radius * grid.radius;
}

function representativeCell(grid: Grid, cells: readonly number[]): number {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const cell of cells) {
    const weight = grid.rowCellArea[Math.floor(cell / grid.width)]!;
    x += grid.cellPosition[cell * 3]! * weight;
    y += grid.cellPosition[cell * 3 + 1]! * weight;
    z += grid.cellPosition[cell * 3 + 2]! * weight;
  }
  const length = Math.hypot(x, y, z) || 1;
  x /= length;
  y /= length;
  z /= length;
  let best = cells[0]!;
  let bestDot = -Infinity;
  for (const cell of cells) {
    const dot =
      grid.cellPosition[cell * 3]! * x +
      grid.cellPosition[cell * 3 + 1]! * y +
      grid.cellPosition[cell * 3 + 2]! * z;
    if (dot > bestDot) {
      best = cell;
      bestDot = dot;
    }
  }
  return best;
}

function sampleFootprint(cells: readonly number[]): number[] {
  const count = Math.min(128, cells.length);
  if (count === cells.length) return [...cells];
  return Array.from(
    { length: count },
    (_, index) => cells[Math.floor((index * cells.length) / count)]!,
  );
}

/** Pure diagnostic component: it reads geography and writes only the saved naming state. */
export const mapNamingModel: SimComponent = {
  name: 'mapNames',
  inputs: ['elevation', 'plateId', 'lakeType'],
  outputs: [],
  runOneStep(state) {
    updateMapNames(state);
  },
};
