import { TECH_AGES } from '../sim/data/civilization';
import { LIFE_CLASS_KEYS } from '../sim/data/lifeClasses';
import type { City } from '../sim/core/planet';
import type { EventKey, PlanetEvent } from '../sim/events';
import type { Device, DeviceKind } from '../sim/tools/devices';
import type { PaletteMode } from './accessibilitySettings';
import type { Projection } from './arrows';
import type { MapSource } from './mapRenderer';
import {
  CAPITAL_PIXEL_ICON,
  CITY_PIXEL_ICONS,
  DEVICE_PIXEL_ICONS,
  drawPixelIcon,
  EVENT_PIXEL_ICONS,
  LIFE_PIXEL_ICONS,
  RUINS_PIXEL_ICON,
} from './pixelIcons';

/** Bold silhouettes on the same 24-unit grid as the React UI icons. */
export const LIFE_ICON_PATHS = {
  prokaryotes: 'M4 9C5 4 12 2 17 5s4 9 0 13S7 22 4 17 2 12 4 9Zm14-2 4-3-2 5 3 2-4 1',
  eukaryotes:
    'M4 7c3-5 8-4 10-2 5-1 8 3 6 7 2 5-2 9-7 8-4 3-9 1-9-3-4-2-5-7-2-10Zm8 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  plants: 'M10 22V11C5 11 2 8 3 3c5 0 8 3 8 8 1-6 5-9 10-9 0 6-3 10-9 11v9Z',
  radiates: 'M12 2l2.5 6.5L21 6l-4 6 5 4-7 .5L12 23l-3-6.5-7-.5 5-4-4-6 6.5 2.5Z',
  arthropods:
    'M8 9 4 5 2 7l4 4-5 2 1 3 5-2v4l-4 3 2 2 5-4h4l5 4 2-2-4-3v-4l5 2 1-3-5-2 4-4-2-2-4 4H8Zm1-4h6l2 5-2 7H9l-2-7Z',
  mollusks:
    'M3 18c0-5 4-9 9-9a6 6 0 1 1 6 6h3l2 4H5c-2 0-3 1-4 2 0-2 0-2 2-3Zm9-6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  trichordates: 'M2 14c4-8 10-8 15-4l5-3-1 6 2 5-6-2C11 20 6 20 2 14Z',
  fish: 'M2 12c5-6 11-6 16-2l4-4v12l-4-4c-5 4-11 4-16-2Zm5-1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  insects:
    'M10 10C7 4 3 4 2 7c0 3 3 5 7 6-4 1-6 4-5 7 3 2 6 0 8-4 2 4 5 6 8 4 1-3-1-6-5-7 4-1 7-3 7-6-1-3-5-3-8 3l-1-5-2 5Z',
  amphibians: 'M7 8 3 5 1 7l4 4-3 3 2 2 4-3h10l4 3 2-2-3-3 4-4-2-2-4 3c-1-6-11-6-12 0Z',
  reptiles:
    'M2 15c4-6 9-7 14-4l5-3 2 2-4 3 4 2-2 2-5-2c-4 4-9 5-14 3Zm7-2-4-4 2-1 4 3Zm4 2 3 5-2 1-4-5Z',
  dinosaurs: 'M2 19c3-4 5-7 6-12l3-5 2 1-1 7c3-1 7 0 9 3l2 5h-5l-2-3h-4v6H9l-1-6-3 4Z',
  avians: 'M2 14c5-1 8-5 10-10 1 5 4 8 10 9-4 2-7 2-9 1 2 3 4 5 7 7-5 0-9-2-12-7Z',
  mammals: 'M2 17 5 9l4-2 4 2 5-4 4 2-3 5 3 5h-4l-2-3h-6l-1 6H6l-1-5Z',
  cetaceans: 'M2 13c4-5 10-7 16-4l4-4v7l-3 2c-3 5-10 7-17 2l3-1Z',
} as const satisfies Record<(typeof LIFE_CLASS_KEYS)[number], string>;

export const CITY_ICON_PATHS = {
  stone: 'M3 12 12 4l9 8-2 1v8h-6v-6h-3v6H5v-8Z',
  bronze: 'M2 21V8h20v13h-4V10h-3v11h-6V10H6v11ZM1 6l11-4 11 4Z',
  iron: 'M2 21V8h4V4h4v4h4V4h4v4h4v13h-5v-6H7v6Z',
  industrial: 'M2 21V11l6 4v-4l6 4V7h4v14Zm14-16V2h4v19h-2V5Z',
  atomic:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0-7c3 0 5 4 5 10s-2 10-5 10-5-4-5-10S9 2 12 2Zm-9 5c2-2 7 0 12 3s8 7 6 9-7 0-12-3S1 9 3 7Zm18 0c2 2-1 6-6 9S5 21 3 19s1-6 6-9 10-5 12-3Z',
  information:
    'M9 22h6l-1-13h-4Zm3-17a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 4C2 8 2 14 6 18l2-2C5 13 5 9 8 6Zm12 0-2 2c3 3 3 7 0 10l2 2c4-4 4-10 0-14Z',
  nanotech:
    'M2 21a10 10 0 0 1 20 0Zm5-2a5 5 0 0 1 10 0ZM11 3h2v5h-2ZM4 8l2-2 3 4-2 2Zm16 0-2-2-3 4 2 2Z',
} as const satisfies Record<(typeof TECH_AGES)[number]['key'], string>;

export const DEVICE_ICON_PATHS: Record<DeviceKind, string> = {
  co2Generator: 'M2 21V11l6 4v-4l6 4V7h4v14Zm16-16c0-3 3-3 3-5 2 3 0 5-1 7Z',
  n2Generator: 'M2 21V11l6 4v-4l6 4V7h4v14Zm14-16c2-3 3 2 5-1l2 2c-3 4-5-1-7 2Z',
  o2Generator: 'M2 21V11l6 4v-4l6 4V7h4v14Zm17-20a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  co2Scrubber: 'M2 3h20l-7 9v6l-6 4V12Zm6 3 4 5 4-5Z',
  biomeFactory:
    'M2 21a10 10 0 0 1 20 0Zm9-1v-7c-4 0-6-2-6-6 4 0 7 2 7 6 1-5 4-8 8-8 0 5-3 9-7 9v6Z',
};

const EVENT_GROUP_PATHS = {
  life: LIFE_ICON_PATHS.plants,
  climate: 'M12 2s-7 8-7 13a7 7 0 0 0 14 0c0-5-7-13-7-13Zm-1 8h2v8h-2Zm0 9h2v2h-2Z',
  geology: 'M2 21 9 8l3 5 3-4 7 12Zm8-15 2-5 2 5-2 3Z',
  civilization: CITY_ICON_PATHS.iron,
  goal: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 4a6 6 0 1 1-6 6 6 6 0 0 1 6-6Zm0 4a2 2 0 1 1-2 2 2 2 0 0 1 2-2Z',
  device:
    'M12 2 9 6l-5-1-1 4 4 3-4 3 2 4 5-1 2 4h4l2-4 5 1 2-4-4-3 4-3-1-4-5 1Zm0 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
} as const;

/** Every log event has an icon; located kinds use recognisable, specific art. */
export const EVENT_ICON_PATHS: Record<EventKey, string> = {
  lifeOrigin: LIFE_ICON_PATHS.prokaryotes,
  impact: 'M2 19 9 12l3 3 8-12 2 2-8 12 3 3-5 2Zm1-1 4-8 4 4Z',
  classAppeared: EVENT_GROUP_PATHS.life,
  classExtinct: 'M4 5 19 20l2-2L6 3Zm1 15 5-5 2 2-5 5Z',
  massExtinction: 'M3 3h5l4 6 4-6h5l-6 9 6 9h-5l-4-6-4 6H3l6-9Z',
  cambrianExplosion: LIFE_ICON_PATHS.radiates,
  sentience: 'M6 21v-5c-3-5 0-12 6-12s9 7 6 12v5h-4v-5l3-3h-4l-1-5-1 5H7l3 3v5Z',
  ageReached: EVENT_GROUP_PATHS.civilization,
  plague: 'M10 2h4v5h5v4h-5v5h-4v-5H5V7h5Zm-5 15 3 3-2 2-3-3Zm14 0 2 2-3 3-2-2Z',
  nuclearWar: 'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3Zm0 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  fossilFuelsRunningOut: EVENT_GROUP_PATHS.civilization,
  energyTransition: EVENT_GROUP_PATHS.civilization,
  pollutionCrisis: EVENT_GROUP_PATHS.climate,
  civilizationCollapsed: 'M3 21V8h5l2 4 3-8 3 7h5v10h-6l-2-5-3 5Z',
  exodusPopulationTooLow: EVENT_GROUP_PATHS.civilization,
  exodus: 'M12 2c4 3 5 8 3 12l-3 7-3-7c-2-4-1-9 3-12Zm-4 12-5 4h6Zm8 0 5 4h-6Z',
  meteor: 'M3 20a5 5 0 1 1 7-7l11-11 1 1-9 13c0 3-3 6-6 6Z',
  largeEruption: EVENT_GROUP_PATHS.geology,
  largeIgneousProvince: 'M2 21 6 11l4 4 4-11 3 9 5 8Zm5-13 2-6 3 7-3 3Z',
  runawayGreenhouse: EVENT_GROUP_PATHS.climate,
  runawayWarning: EVENT_GROUP_PATHS.climate,
  runawayEnded: EVENT_GROUP_PATHS.climate,
  oceansLost: 'M12 2s7 8 7 13a7 7 0 0 1-14 0C5 10 12 2 12 2Zm-6 16 12-8-1 8Z',
  magneticFieldLost: 'M5 3h4v10a3 3 0 0 0 6 0V3h4v10a7 7 0 0 1-14 0Zm-3 17L20 2l2 2L4 22Z',
  stagnantLid: 'M2 8h20v5H2Zm2 8h16v5H4Z',
  atmosphereLost: 'M3 7c4-4 7 3 11 0s6 1 7 3H3Zm0 6c4-3 7 3 11 0s6 1 7 3H3Zm15-12 4 2-3 3Z',
  methaneRelease: EVENT_GROUP_PATHS.climate,
  monolith: 'M8 3h8v18H8Zm-5 18h18v2H3Z',
  eraReached: EVENT_GROUP_PATHS.civilization,
  goalWon: EVENT_GROUP_PATHS.goal,
  goalLost:
    'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-4 5 4 4 4-4 2 2-4 4 4 4-2 2-4-4-4 4-2-2 4-4-4-4Z',
  deviceDestroyed: 'M4 3 21 20l-2 2L2 5Zm8 5 2-5 3 2-1 5 5 1v4l-3 1-3-3-3 3-4-2 2-4Z',
  iceMeteor: 'M3 20a4 4 0 0 1 5-6L20 2l2 2-10 13a5 5 0 0 1-9 3Zm4-7v10m-4-7 8 5m-8 0 8-5Z',
  earthquake: 'M2 18 7 13l3 3 3-9 3 6 6-5v13H2Zm4-11 4-4 2 5 3-6 3 5',
  tsunami:
    'M1 15c3-5 7-7 12-7 4 0 7 2 10 5-5-1-8 1-8 5-5-5-9-4-14 0Zm1 5c3-3 6-3 9 0s7 3 11 0v3H2Z',
  cyclone: 'M12 10c-5-1-7-5-5-8-3 5-1 10 5 12 5 1 7 5 5 8 3-5 1-10-5-12-5-1-7-5-5-8-3 5-1 10 5 12Z',
  drought: 'M2 21 7 12l4 4 3-3 8 8Zm15-19a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-2v2m0 8v2m-6-6h2m8 0h2',
  greatOxidation: EVENT_GROUP_PATHS.life,
  snowballOnset: EVENT_GROUP_PATHS.climate,
  snowballEnded: EVENT_GROUP_PATHS.climate,
  trendRunaway: EVENT_GROUP_PATHS.climate,
  trendSnowball: EVENT_GROUP_PATHS.climate,
  trendCo2Starvation: EVENT_GROUP_PATHS.life,
  trendOxygenLoss: EVENT_GROUP_PATHS.life,
  trendBiodiversityLoss: EVENT_GROUP_PATHS.life,
  trendFossilLow: EVENT_GROUP_PATHS.civilization,
  trendPollution: EVENT_GROUP_PATHS.climate,
  disasterWarning: 'M12 2 23 21H1Zm0 6v6m0 3v2',
};

export interface IconSample {
  cell: number;
  x: number;
  y: number;
}

export interface IconSamplingOptions {
  gridWidth: number;
  gridHeight: number;
  screenWidth: number;
  screenHeight: number;
  spacing?: number;
  /** Visible geographic rectangle; west may be outside 0..360. */
  bounds: { west: number; north: number; lonSpan: number; latSpan: number };
  project: Projection;
  /** Globe views show only 180 degrees across although candidates cover all 360. */
  projectedLonSpan?: number;
}

/** Picks a pleasant, stable angular lattice interval near the requested size. */
const LATTICE_INTERVALS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;

function latticeStep(target: number): number {
  if (!(target > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(target));
  const scaled = target / power;
  let nice: number = LATTICE_INTERVALS[0];
  let distance = Math.abs(scaled - nice);
  for (let i = 1; i < LATTICE_INTERVALS.length; i++) {
    const candidate = LATTICE_INTERVALS[i]!;
    const candidateDistance = Math.abs(scaled - candidate);
    if (candidateDistance >= distance) continue;
    nice = candidate;
    distance = candidateDistance;
  }
  return nice * power;
}

/**
 * Samples a geographic (not screen-anchored) lattice and projects it. Panning
 * therefore reveals the same cells instead of making the symbols shimmer.
 */
export function sampleIconCells(options: IconSamplingOptions): IconSample[] {
  const {
    gridWidth,
    gridHeight,
    screenWidth,
    screenHeight,
    bounds,
    project,
    projectedLonSpan = bounds.lonSpan,
  } = options;
  if (screenWidth <= 0 || screenHeight <= 0 || gridWidth <= 0 || gridHeight <= 0) return [];
  const spacing = options.spacing ?? 32;
  const lonStep = latticeStep((projectedLonSpan * spacing) / screenWidth);
  const latStep = latticeStep((bounds.latSpan * spacing) / screenHeight);
  const south = bounds.north - bounds.latSpan;
  const firstRow = Math.max(0, Math.ceil((90 - bounds.north) / latStep - 0.5));
  const lastRow = Math.floor((90 - south) / latStep - 0.5);
  const firstColumn = Math.ceil(bounds.west / lonStep - 0.5);
  const lastColumn = Math.floor((bounds.west + bounds.lonSpan) / lonStep - 0.5);
  const samples: IconSample[] = [];
  const seen = new Set<number>();
  for (let row = firstRow; row <= lastRow; row++) {
    const latitude = 90 - (row + 0.5) * latStep;
    if (latitude <= -90 || latitude >= 90) continue;
    for (let column = firstColumn; column <= lastColumn; column++) {
      const rawLongitude = (column + 0.5) * lonStep;
      const longitude = ((rawLongitude % 360) + 360) % 360;
      const point = project(latitude, longitude);
      if (!point) continue;
      const [x, y] = point;
      if (x < 0 || x > screenWidth || y < 0 || y > screenHeight) continue;
      const gx = Math.min(gridWidth - 1, Math.floor((longitude / 360) * gridWidth));
      const gy = Math.min(
        gridHeight - 1,
        Math.max(0, Math.floor(((90 - latitude) / 180) * gridHeight)),
      );
      const cell = gy * gridWidth + gx;
      if (seen.has(cell)) continue;
      seen.add(cell);
      samples.push({ cell, x, y });
    }
  }
  return samples;
}

const pathCache = new Map<string, Path2D>();

function cachedPath(path: string): Path2D {
  let cached = pathCache.get(path);
  if (!cached) {
    cached = new Path2D(path);
    pathCache.set(path, cached);
  }
  return cached;
}

export interface DrawIconStyle {
  size?: number;
  fill?: string;
  outline?: string;
  alpha?: number;
}

/** Draws the shared 24-unit SVG art with a dark halo beneath a light fill. */
export function drawMapIcon(
  ctx: CanvasRenderingContext2D,
  path: string,
  x: number,
  y: number,
  style: DrawIconStyle = {},
): void {
  const size = style.size ?? 18;
  const scale = size / 24;
  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 3 / scale;
  ctx.strokeStyle = style.outline ?? 'rgba(9, 12, 16, 0.95)';
  ctx.fillStyle = style.fill ?? '#f5edcf';
  const icon = cachedPath(path);
  ctx.stroke(icon);
  ctx.fill(icon);
  ctx.restore();
}

export interface VisibleMapIcons {
  lifeClasses: number[];
  cityAge: number | null;
}

/** Draws the life lattice, leaving settled samples clear for discrete city markers. */
export function drawLifeAndCityIcons(
  ctx: CanvasRenderingContext2D,
  source: MapSource,
  samples: readonly IconSample[],
  paletteMode: PaletteMode,
): VisibleMapIcons {
  const visible = new Set<number>();
  for (const sample of samples) {
    const density = source.fields.civilization[sample.cell]!;
    if (density >= 1e-4) continue;
    const lifeClass = source.fields.dominantClass[sample.cell]!;
    if (lifeClass < 0 || lifeClass >= LIFE_CLASS_KEYS.length) continue;
    drawPixelIcon(
      ctx,
      LIFE_PIXEL_ICONS[LIFE_CLASS_KEYS[lifeClass]!],
      sample.x,
      sample.y,
      18,
      paletteMode,
    );
    visible.add(lifeClass);
  }
  return { lifeClasses: [...visible].sort((a, b) => a - b), cityAge: null };
}

/** Draws population-tiered cities at a constant screen size; capitals receive a gold ring. */
export function drawCityIcons(
  ctx: CanvasRenderingContext2D,
  cities: readonly City[],
  width: number,
  height: number,
  project: Projection,
  zoom: number,
  paletteMode: PaletteMode,
): number | null {
  let visibleAge: number | null = null;
  const ordered = [...cities].sort(
    (a, b) =>
      Number(a.abandonedYear !== null) - Number(b.abandonedYear !== null) ||
      b.population - a.population ||
      a.id - b.id,
  );
  for (const city of ordered) {
    if (!cityVisibleAtZoom(city, zoom)) continue;
    const point = cellPoint(city.cell, width, height, project);
    if (!point) continue;
    const age = TECH_AGES[Math.max(0, Math.min(TECH_AGES.length - 1, city.age))]!;
    const ruin = city.abandonedYear !== null;
    const size = cityMarkerSize(city.population);
    const key = ruin
      ? RUINS_PIXEL_ICON
      : city.capital
        ? CAPITAL_PIXEL_ICON
        : CITY_PIXEL_ICONS[age.key as keyof typeof CITY_PIXEL_ICONS];
    drawPixelIcon(ctx, key, point[0], point[1], size, paletteMode, ruin ? 0.62 : 1);
    if (!ruin) {
      visibleAge = Math.max(visibleAge ?? 0, city.age);
    }
  }
  return visibleAge;
}

function cityMarkerSize(population: number): number {
  if (population >= 0.5) return 24;
  if (population >= 0.05) return 21;
  if (population >= 0.005) return 18;
  return 15;
}

function cityVisibleAtZoom(city: City, zoom: number): boolean {
  if (city.abandonedYear !== null) return zoom >= 2.5;
  if (city.capital || city.population >= 0.5) return true;
  if (city.population >= 0.05) return zoom >= 1.25;
  if (city.population >= 0.005) return zoom >= 2;
  return zoom >= 3;
}

function cellPoint(cell: number, width: number, height: number, project: Projection) {
  const x = cell % width;
  const y = Math.floor(cell / width);
  return project(90 - ((y + 0.5) * 180) / height, ((x + 0.5) * 360) / width);
}

export function drawDeviceIcons(
  ctx: CanvasRenderingContext2D,
  devices: readonly Device[],
  width: number,
  height: number,
  project: Projection,
  paletteMode: PaletteMode,
): void {
  for (const device of devices) {
    const point = cellPoint(device.cell, width, height, project);
    if (!point) continue;
    drawPixelIcon(ctx, DEVICE_PIXEL_ICONS[device.kind], point[0], point[1], 17, paletteMode);
  }
}

/** Recent located events, oldest and faintest first. */
export function drawEventMarkers(
  ctx: CanvasRenderingContext2D,
  events: readonly PlanetEvent[],
  width: number,
  height: number,
  project: Projection,
  paletteMode: PaletteMode,
  options: { limit?: number; fade?: boolean } = {},
): void {
  const all = events.filter((event) => event.cell !== undefined);
  const located = options.limit === undefined ? all.slice(-30) : all.slice(-options.limit);
  located.forEach((event, index) => {
    const point = cellPoint(event.cell!, width, height, project);
    if (!point) return;
    const alpha = options.fade === false ? 1 : 0.3 + (0.7 * (index + 1)) / located.length;
    drawPixelIcon(ctx, EVENT_PIXEL_ICONS[event.key], point[0], point[1], 14, paletteMode, alpha);
  });
}
