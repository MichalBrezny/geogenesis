import type { Fields } from '../sim/core/fields';
import type { City } from '../sim/core/planet';
import { LIFE_CLASSES } from '../sim/data/lifeClasses';
import type { PlanetEvent } from '../sim/events';
import type { HotspotMarker } from './mantleFlow';
import {
  categoricalColor,
  cloudPalette,
  diversityPalette,
  elevationPalette,
  volcanicPalette,
  type Rgb,
} from './palettes';
import type { MapViewport, ViewBounds } from './viewport';
import { viewBounds } from './viewport';
import type { Projection } from './arrows';

const DEG = Math.PI / 180;
const CLOUD_MIN = 0.52;
const VOLCANO_MIN = 0.55;
const ERUPTION_PUFF_MS = 6500;
const DAY_CYCLE_MS = 240_000;
const STATIC_TIME_MS = 73_000;

export type WaterPattern = 'foam' | 'twinkle' | 'wave' | null;

export interface AmbientSource {
  worldRevision: number;
  year: number;
  stepYears: number;
  grid: { width: number; height: number; cellCount: number };
  seaLevel: number;
  fields: Pick<
    Fields,
    | 'elevation'
    | 'iceCover'
    | 'cloudCover'
    | 'windU'
    | 'windV'
    | 'volcanicActivity'
    | 'civilization'
    | 'dominantClass'
  >;
  civilization: { age: number; cities: readonly City[] };
  events: readonly PlanetEvent[];
  tectonics: { hotspots: readonly HotspotMarker[] };
}

interface Feature {
  latitude: number;
  longitude: number;
  x: number;
  y: number;
  seed: number;
  strength: number;
  kind: number;
  windU: number;
  windV: number;
}

interface EruptionFeature extends Feature {
  startedAt: number;
}

interface AmbientPalette {
  water: string;
  foam: string;
  cloud: string;
  cloudShadow: string;
  lava: string;
  lavaHot: string;
  smoke: string;
  light: string;
  wildlife: string;
}

type AmbientView =
  { kind: 'none' } | { kind: 'map'; bounds: ViewBounds } | { kind: 'globe'; project: Projection };

export interface AmbientLayer {
  width: number;
  height: number;
  view: AmbientView;
  worldRevision: number;
  civilizationAge: number;
  palette: AmbientPalette;
  spriteCache: AmbientTileCache<HTMLCanvasElement>;
  cloudSprites: (HTMLCanvasElement | null)[];
  water: Feature[];
  clouds: Feature[];
  volcanoes: Feature[];
  lights: Feature[];
  wildlife: Feature[];
  eruptions: EruptionFeature[];
  visibleWater: Feature[];
  visibleClouds: Feature[];
  visibleVolcanoes: Feature[];
  visibleLights: Feature[];
  visibleWildlife: Feature[];
  visibleEruptions: EruptionFeature[];
  knownEruptions: Set<string>;
}

/** Small generic cache used by the hand-written pixel sprites. */
export class AmbientTileCache<T> {
  private readonly values = new Map<string, T>();

  get(key: string, create: () => T): T {
    const existing = this.values.get(key);
    if (existing !== undefined) return existing;
    const value = create();
    this.values.set(key, value);
    return value;
  }

  clear(): void {
    this.values.clear();
  }

  get size(): number {
    return this.values.size;
  }
}

/** Stable integer noise: visual variety never touches the simulation RNG. */
export function ambientHash(cell: number, salt = 0): number {
  let value = Math.imul(cell + 1, 0x9e3779b1) ^ Math.imul(salt + 17, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return value >>> 0;
}

/** Sparse deterministic ocean decoration, with extra foam and less motion under ice. */
export function selectWaterPattern(cell: number, coast: boolean, iceCover: number): WaterPattern {
  const hash = ambientHash(cell, 3);
  if (iceCover >= 0.75) return hash % 151 === 0 ? 'twinkle' : null;
  if (coast && hash % 3 !== 0) return 'foam';
  if (hash % (iceCover > 0.25 ? 89 : 43) === 0) return 'twinkle';
  if (hash % (iceCover > 0.25 ? 127 : 67) === 0) return 'wave';
  return null;
}

/** Repeating 0..1 phase; a zero timestamp is valid and deterministic for tests. */
export function ambientPhase(timestampMs: number, periodMs: number, offset = 0): number {
  const phase = timestampMs / periodMs + offset;
  return phase - Math.floor(phase);
}

/** Cosmetic night-side strength, including a soft terminator. */
export function nightFactor(longitude: number, timestampMs: number): number {
  const subsolar = ambientPhase(timestampMs, DAY_CYCLE_MS) * 360;
  const daylight = Math.cos((longitude - subsolar) * DEG);
  return Math.max(0, Math.min(1, -daylight * 2.2));
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function ambientPalette(): AmbientPalette {
  const water = elevationPalette(-200);
  const foam = elevationPalette(0);
  const cloud = cloudPalette(100);
  return {
    water: rgba(water, 0.58),
    foam: rgba(foam, 0.72),
    cloud: rgba(cloud, 0.72),
    cloudShadow: 'rgba(16, 24, 38, 0.22)',
    lava: rgba(volcanicPalette(1.5), 0.8),
    lavaHot: rgba(volcanicPalette(5), 0.92),
    smoke: 'rgba(72, 68, 72, 0.48)',
    light: rgba(categoricalColor(3, [255, 205, 105]), 0.9),
    wildlife: rgba(diversityPalette(12), 0.65),
  };
}

function feature(
  cell: number,
  width: number,
  height: number,
  strength: number,
  kind: number,
): Feature {
  const x = cell % width;
  const y = Math.floor(cell / width);
  return {
    latitude: 90 - ((y + 0.5) * 180) / height,
    longitude: ((x + 0.5) * 360) / width,
    x: 0,
    y: 0,
    seed: ambientHash(cell, kind) / 0x1_0000_0000,
    strength,
    kind,
    windU: 0,
    windV: 0,
  };
}

function isCoast(source: AmbientSource, cell: number): boolean {
  const { width, height } = source.grid;
  const x = cell % width;
  const y = Math.floor(cell / width);
  const elevation = source.fields.elevation;
  const west = y * width + ((x + width - 1) % width);
  const east = y * width + ((x + 1) % width);
  if (elevation[west]! >= source.seaLevel || elevation[east]! >= source.seaLevel) return true;
  if (y > 0 && elevation[cell - width]! >= source.seaLevel) return true;
  return y + 1 < height && elevation[cell + width]! >= source.seaLevel;
}

function eventId(event: PlanetEvent): string {
  return `${event.key}:${event.year}:${event.cell ?? -1}`;
}

function markExistingEruptions(layer: AmbientLayer, events: readonly PlanetEvent[]): void {
  for (const event of events) {
    if (event.key === 'largeEruption' || event.key === 'largeIgneousProvince') {
      layer.knownEruptions.add(eventId(event));
    }
  }
}

function rebuildFeatures(layer: AmbientLayer, source: AmbientSource, nowMs: number): void {
  layer.water.length = 0;
  layer.clouds.length = 0;
  layer.volcanoes.length = 0;
  layer.lights.length = 0;
  layer.wildlife.length = 0;
  layer.civilizationAge = source.civilization.age;
  const { width, height, cellCount } = source.grid;
  const fields = source.fields;

  for (let cell = 0; cell < cellCount; cell++) {
    const ocean = fields.elevation[cell]! < source.seaLevel;
    if (ocean) {
      const pattern = selectWaterPattern(cell, isCoast(source, cell), fields.iceCover[cell]!);
      if (pattern) {
        const kind = pattern === 'foam' ? 0 : pattern === 'twinkle' ? 1 : 2;
        layer.water.push(feature(cell, width, height, 1 - fields.iceCover[cell]!, kind));
      }
    }

    const cloud = fields.cloudCover[cell]!;
    if (cloud >= CLOUD_MIN && ambientHash(cell, 7) % 17 === 0) {
      const windU = fields.windU[cell]!;
      const windV = fields.windV[cell]!;
      const puff = feature(cell, width, height, cloud, ambientHash(cell, 8) % 3);
      puff.windU = windU;
      puff.windV = windV;
      layer.clouds.push(puff);
    }

    const activity = fields.volcanicActivity[cell]!;
    if (activity >= VOLCANO_MIN && (activity >= 2 || ambientHash(cell, 11) % 7 === 0)) {
      layer.volcanoes.push(feature(cell, width, height, Math.min(3, activity), 0));
    }

    const density = fields.civilization[cell]!;
    if (density >= 1e-5 && ambientHash(cell, 13) % 7 === 0) {
      layer.lights.push(
        feature(cell, width, height, Math.min(1, 0.2 + Math.log10(1 + density * 1e5) / 5), 0),
      );
    }

    const lifeIndex = fields.dominantClass[cell]!;
    const life = lifeIndex >= 0 ? LIFE_CLASSES[lifeIndex] : undefined;
    if (life && ambientHash(cell, 17) % 83 === 0) {
      if (ocean && life.habitat === 'ocean' && lifeIndex >= 7) {
        layer.wildlife.push(feature(cell, width, height, 0.7, 0));
      } else if (!ocean && life.tier === 'landVertebrates') {
        layer.wildlife.push(feature(cell, width, height, 0.65, 1));
      }
    }
  }

  for (const hotspot of source.tectonics.hotspots) {
    const [x, y, z] = hotspot.position;
    layer.volcanoes.push({
      latitude: (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI,
      longitude: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
      x: 0,
      y: 0,
      seed: ambientHash(hotspot.id, 19) / 0x1_0000_0000,
      strength: Math.max(0.5, Math.min(3, hotspot.strength)),
      kind: 1,
      windU: 0,
      windV: 0,
    });
  }

  for (const city of source.civilization.cities) {
    if (city.abandonedYear === null && city.cell >= 0 && city.cell < cellCount) {
      layer.lights.push(
        feature(
          city.cell,
          width,
          height,
          Math.min(1, 0.55 + Math.log10(1 + city.population) * 0.3),
          1,
        ),
      );
    }
  }

  let write = 0;
  for (let i = 0; i < layer.eruptions.length; i++) {
    const eruption = layer.eruptions[i]!;
    if (nowMs - eruption.startedAt < ERUPTION_PUFF_MS) layer.eruptions[write++] = eruption;
  }
  layer.eruptions.length = write;
  for (const event of source.events) {
    if (
      event.cell === undefined ||
      (event.key !== 'largeEruption' && event.key !== 'largeIgneousProvince')
    )
      continue;
    const id = eventId(event);
    if (layer.knownEruptions.has(id)) continue;
    layer.knownEruptions.add(id);
    const point = feature(event.cell, width, height, 1, 0);
    layer.eruptions.push({ ...point, startedAt: nowMs });
  }
}

export function createAmbientLayer(source: AmbientSource, nowMs = 0): AmbientLayer {
  const layer: AmbientLayer = {
    width: 0,
    height: 0,
    view: { kind: 'none' },
    worldRevision: source.worldRevision,
    civilizationAge: source.civilization.age,
    palette: ambientPalette(),
    spriteCache: new AmbientTileCache<HTMLCanvasElement>(),
    cloudSprites: [null, null, null],
    water: [],
    clouds: [],
    volcanoes: [],
    lights: [],
    wildlife: [],
    eruptions: [],
    visibleWater: [],
    visibleClouds: [],
    visibleVolcanoes: [],
    visibleLights: [],
    visibleWildlife: [],
    visibleEruptions: [],
    knownEruptions: new Set<string>(),
  };
  markExistingEruptions(layer, source.events);
  rebuildFeatures(layer, source, nowMs);
  return layer;
}

export function updateAmbientLayer(
  layer: AmbientLayer,
  source: AmbientSource,
  nowMs: number,
): void {
  if (layer.worldRevision !== source.worldRevision) {
    layer.worldRevision = source.worldRevision;
    layer.eruptions.length = 0;
    layer.knownEruptions.clear();
    markExistingEruptions(layer, source.events);
  }
  const nextPalette = ambientPalette();
  if (
    nextPalette.cloud !== layer.palette.cloud ||
    nextPalette.water !== layer.palette.water ||
    nextPalette.lava !== layer.palette.lava
  ) {
    layer.palette = nextPalette;
    layer.spriteCache.clear();
    layer.cloudSprites.fill(null);
  }
  rebuildFeatures(layer, source, nowMs);
  refreshVisible(layer);
}

function projectMap(layer: AmbientLayer, point: Feature, bounds: ViewBounds): boolean {
  let east = (((point.longitude - bounds.west) % 360) + 360) % 360;
  const backEdge = 360 - (360 - bounds.lonSpan) / 2;
  if (east > backEdge) east -= 360;
  point.x = (east / bounds.lonSpan) * layer.width;
  point.y = ((bounds.north - point.latitude) / bounds.latSpan) * layer.height;
  return (
    point.x >= -12 && point.x <= layer.width + 12 && point.y >= -12 && point.y <= layer.height + 12
  );
}

function projectFeature(layer: AmbientLayer, point: Feature): boolean {
  if (layer.view.kind === 'none') return false;
  if (layer.view.kind === 'map') return projectMap(layer, point, layer.view.bounds);
  const projected = layer.view.project(point.latitude, point.longitude);
  if (!projected) return false;
  point.x = projected[0];
  point.y = projected[1];
  return (
    point.x >= -12 && point.x <= layer.width + 12 && point.y >= -12 && point.y <= layer.height + 12
  );
}

function visible<T extends Feature>(layer: AmbientLayer, source: readonly T[], target: T[]): void {
  target.length = 0;
  for (const point of source) if (projectFeature(layer, point)) target.push(point);
}

function refreshVisible(layer: AmbientLayer): void {
  visible(layer, layer.water, layer.visibleWater);
  visible(layer, layer.clouds, layer.visibleClouds);
  visible(layer, layer.volcanoes, layer.visibleVolcanoes);
  visible(layer, layer.lights, layer.visibleLights);
  visible(layer, layer.wildlife, layer.visibleWildlife);
  visible(layer, layer.eruptions, layer.visibleEruptions);
}

export function setAmbientMapView(
  layer: AmbientLayer,
  mapView: MapViewport,
  width: number,
  height: number,
): void {
  layer.width = width;
  layer.height = height;
  layer.view = { kind: 'map', bounds: viewBounds(mapView) };
  refreshVisible(layer);
}

export function setAmbientGlobeView(
  layer: AmbientLayer,
  project: Projection,
  width: number,
  height: number,
): void {
  layer.width = width;
  layer.height = height;
  layer.view = { kind: 'globe', project };
  refreshVisible(layer);
}

const CLOUD_PIXELS: readonly (readonly string[])[] = [
  ['0011000', '0111110', '1111111'],
  ['0001100', '0111110', '1111111'],
  ['0011100', '1111110', '0111111'],
];

function cloudSprite(layer: AmbientLayer, pattern: number): HTMLCanvasElement {
  const index = pattern % CLOUD_PIXELS.length;
  const existing = layer.cloudSprites[index];
  if (existing) return existing;
  const sprite = layer.spriteCache.get(`cloud:${index}:${layer.palette.cloud}`, () => {
    const pixels = CLOUD_PIXELS[index]!;
    const canvas = document.createElement('canvas');
    canvas.width = pixels[0]!.length + 2;
    canvas.height = pixels.length + 2;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = layer.palette.cloudShadow;
    for (let y = 0; y < pixels.length; y++) {
      for (let x = 0; x < pixels[y]!.length; x++) {
        if (pixels[y]![x] === '1') ctx.fillRect(x + 2, y + 2, 1, 1);
      }
    }
    ctx.fillStyle = layer.palette.cloud;
    for (let y = 0; y < pixels.length; y++) {
      for (let x = 0; x < pixels[y]!.length; x++) {
        if (pixels[y]![x] === '1') ctx.fillRect(x + 1, y + 1, 1, 1);
      }
    }
    return canvas;
  });
  layer.cloudSprites[index] = sprite;
  return sprite;
}

function drawWater(ctx: CanvasRenderingContext2D, layer: AmbientLayer, nowMs: number): void {
  for (let i = 0; i < layer.visibleWater.length; i++) {
    const point = layer.visibleWater[i]!;
    const phase = ambientPhase(nowMs, point.kind === 2 ? 3200 : 1800, point.seed);
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    if (point.kind === 0) {
      ctx.fillStyle = layer.palette.foam;
      ctx.globalAlpha = 0.28 + (phase < 0.5 ? phase : 1 - phase) * 0.42;
      ctx.fillRect(x, y, 2, 1);
      if (point.seed > 0.55) ctx.fillRect(x + 2, y + 1, 1, 1);
    } else if (point.kind === 1) {
      ctx.fillStyle = layer.palette.foam;
      ctx.globalAlpha = phase < 0.18 ? 0.72 * point.strength : 0.16;
      ctx.fillRect(x, y, 1, 1);
    } else {
      ctx.fillStyle = layer.palette.water;
      ctx.globalAlpha = 0.3 * point.strength;
      ctx.fillRect(x + Math.floor(phase * 3), y, 3, 1);
    }
  }
}

function drawClouds(ctx: CanvasRenderingContext2D, layer: AmbientLayer, nowMs: number): void {
  for (let i = 0; i < layer.visibleClouds.length; i++) {
    const point = layer.visibleClouds[i]!;
    const phase = ambientPhase(nowMs, 13_000, point.seed);
    const drift = phase - 0.5;
    const x = Math.round(point.x + Math.max(-7, Math.min(7, point.windU * drift * 0.8)));
    const y = Math.round(point.y - Math.max(-5, Math.min(5, point.windV * drift * 0.8)));
    const fade = Math.min(1, Math.min(phase, 1 - phase) * 8);
    ctx.globalAlpha = (0.2 + point.strength * 0.34) * fade;
    ctx.drawImage(cloudSprite(layer, point.kind), x - 4, y - 2);
  }
}

function drawSmoke(
  ctx: CanvasRenderingContext2D,
  layer: AmbientLayer,
  point: Feature,
  nowMs: number,
  amount: number,
): void {
  const phase = ambientPhase(nowMs, 2600, point.seed);
  const x = Math.round(point.x);
  const rise = Math.floor(phase * (4 + amount * 3));
  ctx.fillStyle = layer.palette.smoke;
  ctx.globalAlpha = (1 - phase) * 0.48;
  ctx.fillRect(x + (rise % 2), Math.round(point.y) - 2 - rise, 2, 2);
  if (amount > 1.1) ctx.fillRect(x - 1, Math.round(point.y) - 4 - ((rise + 2) % 6), 1, 1);
}

function drawVolcanoes(ctx: CanvasRenderingContext2D, layer: AmbientLayer, nowMs: number): void {
  for (let i = 0; i < layer.visibleVolcanoes.length; i++) {
    const point = layer.visibleVolcanoes[i]!;
    const pulse = ambientPhase(nowMs, 1600, point.seed);
    const hot = pulse < 0.45;
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    ctx.fillStyle = hot ? layer.palette.lavaHot : layer.palette.lava;
    ctx.globalAlpha = 0.38 + Math.min(0.42, point.strength * 0.14);
    ctx.fillRect(x, y, hot && point.strength > 1.4 ? 2 : 1, 1);
    if (point.kind === 1 || point.strength > 1) drawSmoke(ctx, layer, point, nowMs, point.strength);
  }
  for (let i = 0; i < layer.visibleEruptions.length; i++) {
    const point = layer.visibleEruptions[i]!;
    const age = nowMs - point.startedAt;
    if (age < 0 || age >= ERUPTION_PUFF_MS) continue;
    const amount = 2.4 * (1 - age / ERUPTION_PUFF_MS);
    drawSmoke(ctx, layer, point, nowMs, amount);
  }
}

function drawLights(ctx: CanvasRenderingContext2D, layer: AmbientLayer, nowMs: number): void {
  const steadiness = Math.min(1, layer.civilizationAge / 5);
  ctx.fillStyle = layer.palette.light;
  for (let i = 0; i < layer.visibleLights.length; i++) {
    const point = layer.visibleLights[i]!;
    const night = nightFactor(point.longitude, nowMs);
    if (night <= 0) continue;
    const twinkle = ambientPhase(nowMs, 1900, point.seed) > 0.24 ? 1 : steadiness;
    ctx.globalAlpha = night * point.strength * (0.42 + 0.5 * twinkle);
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    ctx.fillRect(x, y, point.kind === 1 && layer.civilizationAge >= 3 ? 2 : 1, 1);
  }
}

function drawWildlife(ctx: CanvasRenderingContext2D, layer: AmbientLayer, nowMs: number): void {
  ctx.fillStyle = layer.palette.wildlife;
  for (let i = 0; i < layer.visibleWildlife.length; i++) {
    const point = layer.visibleWildlife[i]!;
    const phase = ambientPhase(nowMs, point.kind === 0 ? 4200 : 6200, point.seed);
    const travel = Math.round((phase - 0.5) * (point.kind === 0 ? 4 : 7));
    const x = Math.round(point.x) + travel;
    const y = Math.round(point.y) + (point.kind === 1 && phase > 0.5 ? 1 : 0);
    ctx.globalAlpha = point.strength * Math.min(1, Math.min(phase, 1 - phase) * 7);
    ctx.fillRect(x, y, 1, 1);
    if (point.kind === 1) ctx.fillRect(x + 2, y - 1, 1, 1);
    else if (phase > 0.42 && phase < 0.58) ctx.fillRect(x + 1, y, 2, 1);
  }
}

/** Draws only the candidates cached as visible for the current projection. */
export function drawAmbient(
  ctx: CanvasRenderingContext2D,
  layer: AmbientLayer,
  timestampMs: number,
  reducedMotion = false,
): void {
  const time = reducedMotion ? STATIC_TIME_MS : timestampMs;
  ctx.clearRect(0, 0, layer.width, layer.height);
  if (layer.width <= 0 || layer.height <= 0) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  drawWater(ctx, layer, time);
  drawClouds(ctx, layer, time);
  drawVolcanoes(ctx, layer, time);
  drawLights(ctx, layer, time);
  drawWildlife(ctx, layer, time);
  ctx.restore();
}

export function ambientFeatureCounts(layer: AmbientLayer): Record<string, number> {
  return {
    water: layer.water.length,
    clouds: layer.clouds.length,
    volcanoes: layer.volcanoes.length,
    lights: layer.lights.length,
    wildlife: layer.wildlife.length,
  };
}
