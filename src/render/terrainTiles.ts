import { Biome } from '../sim/data/biomes';
import { LakeType } from '../sim/models/geosphere/flowRouting';
import type { MapLayer, MapSource } from './mapRenderer';
import { drawViewport, type MapViewport, viewBounds } from './viewport';

/** Textures begin to appear at five CSS pixels per cell and are fully visible at seven. */
export const TILE_FADE_START = 5;
export const TILE_FADE_END = 7;
export const TILE_ANIMATION_MS = 480;
export const TILE_VARIANTS = 4;

/** A neutral modulation painted over the layer's palette-derived base colour. */
export const enum TerrainPattern {
  DeepOcean,
  ShallowOcean,
  Abyss,
  Shelf,
  FreshLake,
  SaltLake,
  SaltFlat,
  Ice,
  Tundra,
  BorealForest,
  TemperateForest,
  Grassland,
  Desert,
  Savanna,
  Rainforest,
  Swamp,
  Mountain,
  Rock,
  Lava,
  Count,
}

/** Smoothstep avoids a visible pop when zoom crosses the texture threshold. */
export function tileBlend(cellPixels: number): number {
  const t = Math.max(
    0,
    Math.min(1, (cellPixels - TILE_FADE_START) / (TILE_FADE_END - TILE_FADE_START)),
  );
  return t * t * (3 - 2 * t);
}

/** A deterministic, deliberately slow animation shared by water and lava tiles. */
export function tileAnimationPhase(timeMs: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : Math.floor(Math.max(0, timeMs) / TILE_ANIMATION_MS) % TILE_VARIANTS;
}

export function isTexturedLayer(layer: MapLayer): boolean {
  return layer === 'terrain' || layer === 'biomes' || layer === 'seafloor';
}

export function isAnimatedPattern(pattern: TerrainPattern): boolean {
  return (
    pattern === TerrainPattern.DeepOcean ||
    pattern === TerrainPattern.ShallowOcean ||
    pattern === TerrainPattern.FreshLake ||
    pattern === TerrainPattern.SaltLake ||
    pattern === TerrainPattern.Lava
  );
}

/** Stable integer hash; it does not touch simulation randomness. */
export function cellTileVariant(
  x: number,
  y: number,
  pattern: TerrainPattern,
  animationPhase = 0,
): number {
  let hash = Math.imul(x + 0x6d2b79f5, 0x1b873593);
  hash = Math.imul(hash ^ (y + 0x85ebca6b), 0xc2b2ae35);
  hash = Math.imul(hash ^ pattern, 0x27d4eb2d);
  hash ^= hash >>> 15;
  const stable = (hash >>> 0) % TILE_VARIANTS;
  return isAnimatedPattern(pattern) ? (stable + animationPhase) % TILE_VARIANTS : stable;
}

/** Selects the visual vocabulary while leaving the layer colour authoritative. */
export function terrainPatternAt(
  state: MapSource,
  layer: MapLayer,
  x: number,
  y: number,
): TerrainPattern {
  const { width } = state.grid;
  const i = y * width + x;
  const fields = state.fields;
  const relative = fields.elevation[i]! - state.seaLevel;

  if (layer === 'seafloor') {
    if (relative < -3000) return TerrainPattern.Abyss;
    if (relative < 0) return TerrainPattern.Shelf;
    return isMountain(state, x, y, relative) ? TerrainPattern.Mountain : TerrainPattern.Rock;
  }

  const ice = fields.iceCover[i]!;
  if (ice >= 0.45 || fields.co2Ice[i]! > 0 || fields.biome[i] === Biome.Ice) {
    return TerrainPattern.Ice;
  }
  if (relative < 0) {
    return relative < -2500 ? TerrainPattern.DeepOcean : TerrainPattern.ShallowOcean;
  }

  switch (fields.lakeType[i]!) {
    case LakeType.Fresh:
      return TerrainPattern.FreshLake;
    case LakeType.Salt:
      return TerrainPattern.SaltLake;
    case LakeType.SaltFlat:
      return TerrainPattern.SaltFlat;
  }

  const vegetation = fields.vegetation[i]!;
  const hotAndBare = fields.airTemperature[i]! > 80 && vegetation < 0.02;
  if (fields.volcanicActivity[i]! >= 2.5 || hotAndBare) return TerrainPattern.Lava;
  if (isMountain(state, x, y, relative)) return TerrainPattern.Mountain;

  const biome = fields.biome[i] as Biome;
  // Potential forest colours remain useful on a lifeless planet, but rock texture
  // makes the absence of actual vegetation visible without replacing that colour.
  if (
    vegetation < 0.025 &&
    biome !== Biome.Desert &&
    biome !== Biome.Tundra &&
    biome !== Biome.Rock
  ) {
    return TerrainPattern.Rock;
  }
  switch (biome) {
    case Biome.Tundra:
      return TerrainPattern.Tundra;
    case Biome.BorealForest:
      return TerrainPattern.BorealForest;
    case Biome.TemperateForest:
      return TerrainPattern.TemperateForest;
    case Biome.Grassland:
      return TerrainPattern.Grassland;
    case Biome.Desert:
      return TerrainPattern.Desert;
    case Biome.Savanna:
      return TerrainPattern.Savanna;
    case Biome.Jungle:
      return TerrainPattern.Rainforest;
    case Biome.Swamp:
      return TerrainPattern.Swamp;
    default:
      return TerrainPattern.Rock;
  }
}

function isMountain(state: MapSource, x: number, y: number, relative: number): boolean {
  if (relative >= 2600) return true;
  if (relative < 900) return false;
  const { width, height } = state.grid;
  const elevation = state.fields.elevation;
  const i = y * width + x;
  const west = y * width + ((x + width - 1) % width);
  const east = y * width + ((x + 1) % width);
  const north = y > 0 ? i - width : i;
  const south = y + 1 < height ? i + width : i;
  const low = Math.min(elevation[west]!, elevation[east]!, elevation[north]!, elevation[south]!);
  return elevation[i]! - low >= 750;
}

/** Small bounded cache used by the canvas cache and directly testable without a DOM. */
export class BoundedTileCache<T> {
  private readonly values = new Map<number, T>();

  public constructor(private readonly capacity = 512) {}

  public get size(): number {
    return this.values.size;
  }

  public get(key: number): T | undefined {
    return this.values.get(key);
  }

  public set(key: number, value: T): void {
    if (!this.values.has(key) && this.values.size >= this.capacity) this.values.clear();
    this.values.set(key, value);
  }
}

class CanvasTileCache {
  private readonly tiles = new BoundedTileCache<HTMLCanvasElement>();

  public get(pattern: TerrainPattern, variant: number, pixelSize: number): HTMLCanvasElement {
    const size = Math.max(4, Math.min(96, pixelSize));
    const key = (size * TerrainPattern.Count + pattern) * TILE_VARIANTS + variant;
    const cached = this.tiles.get(key);
    if (cached) return cached;
    const tile = createTile(pattern, variant, size);
    this.tiles.set(key, tile);
    return tile;
  }
}

const tileCache = new CanvasTileCache();
let patternScratch = new Uint8Array(0);

/**
 * Paints the ordinary flat viewport, then adds cached texture only to visible cells.
 * The globe and quantitative layers continue through their existing render paths.
 */
export function drawTexturedViewport(
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  state: MapSource,
  layer: MapLayer,
  view: MapViewport,
  width: number,
  height: number,
  animationPhase = 0,
): void {
  drawViewport(canvas, source, view, width, height);
  if (!isTexturedLayer(layer) || canvas.width === 0 || canvas.height === 0) return;

  const cellCssPixels = Math.min(
    (width * view.zoom) / state.grid.width,
    (height * view.zoom) / state.grid.height,
  );
  const blend = tileBlend(cellCssPixels);
  if (blend <= 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { west, north, lonSpan, latSpan } = viewBounds(view);
  const sourceLeft = (west / 360) * state.grid.width;
  const sourceTop = ((90 - north) / 180) * state.grid.height;
  const sourceWidth = (lonSpan / 360) * state.grid.width;
  const sourceHeight = (latSpan / 180) * state.grid.height;
  const firstX = Math.floor(sourceLeft);
  const lastX = Math.ceil(sourceLeft + sourceWidth);
  const firstY = Math.max(0, Math.floor(sourceTop));
  const lastY = Math.min(state.grid.height, Math.ceil(sourceTop + sourceHeight));
  const columns = lastX - firstX;
  const rows = lastY - firstY;
  const visibleCells = columns * rows;
  if (visibleCells <= 0) return;
  if (patternScratch.length < visibleCells) patternScratch = new Uint8Array(visibleCells);

  const cellWidth = canvas.width / sourceWidth;
  const cellHeight = canvas.height / sourceHeight;
  const offsetX = (firstX - sourceLeft) * cellWidth;
  const offsetY = (firstY - sourceTop) * cellHeight;
  const gridWidth = state.grid.width;

  // Classify once. Both border blending and tile drawing reuse this allocation-free buffer.
  for (let row = 0; row < rows; row++) {
    const y = firstY + row;
    const rowOffset = row * columns;
    for (let column = 0; column < columns; column++) {
      const x = wrapCell(firstX + column, gridWidth);
      patternScratch[rowOffset + column] = terrainPatternAt(state, layer, x, y);
    }
  }

  ctx.imageSmoothingEnabled = false;
  ctx.save();
  // A narrow wash of the actual neighbouring palette colour softens square biome edges.
  ctx.globalAlpha = blend * 0.38;
  const edge = Math.max(1, Math.min(2, Math.round(Math.min(cellWidth, cellHeight) * 0.15)));
  for (let row = 0; row < rows; row++) {
    const y = firstY + row;
    const y0 = Math.round(offsetY + row * cellHeight);
    const y1 = Math.round(offsetY + (row + 1) * cellHeight);
    const rowOffset = row * columns;
    for (let column = 0; column < columns; column++) {
      const p = rowOffset + column;
      const x = wrapCell(firstX + column, gridWidth);
      const x0 = Math.round(offsetX + column * cellWidth);
      const x1 = Math.round(offsetX + (column + 1) * cellWidth);
      if (column > 0 && patternScratch[p - 1] !== patternScratch[p]) {
        const westX = wrapCell(x - 1, gridWidth);
        ctx.drawImage(source, westX, y, 1, 1, x0, y0, edge, y1 - y0);
      }
      if (row > 0 && patternScratch[p - columns] !== patternScratch[p]) {
        ctx.drawImage(source, x, y - 1, 1, 1, x0, y0, x1 - x0, edge);
      }
    }
  }

  ctx.globalAlpha = blend;
  const cacheSize = Math.round(Math.min(cellWidth, cellHeight));
  for (let row = 0; row < rows; row++) {
    const y = firstY + row;
    const y0 = Math.round(offsetY + row * cellHeight);
    const y1 = Math.round(offsetY + (row + 1) * cellHeight);
    const rowOffset = row * columns;
    for (let column = 0; column < columns; column++) {
      const x = wrapCell(firstX + column, gridWidth);
      const pattern = patternScratch[rowOffset + column] as TerrainPattern;
      const variant = cellTileVariant(x, y, pattern, animationPhase);
      const tile = tileCache.get(pattern, variant, cacheSize);
      const x0 = Math.round(offsetX + column * cellWidth);
      const x1 = Math.round(offsetX + (column + 1) * cellWidth);
      ctx.drawImage(tile, x0, y0, x1 - x0, y1 - y0);
    }
  }
  ctx.restore();
}

function wrapCell(x: number, width: number): number {
  return ((x % width) + width) % width;
}

function createTile(pattern: TerrainPattern, variant: number, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  paintPattern(ctx, pattern, variant, size);
  return canvas;
}

const DARK = 'rgba(0, 0, 0, 0.28)';
const DEEP_DARK = 'rgba(0, 0, 0, 0.4)';
const LIGHT = 'rgba(255, 255, 255, 0.18)';
const BRIGHT = 'rgba(255, 255, 255, 0.3)';

function paintPattern(
  ctx: CanvasRenderingContext2D,
  pattern: TerrainPattern,
  variant: number,
  size: number,
): void {
  const shift = variant & 3;
  switch (pattern) {
    case TerrainPattern.DeepOcean:
      pixels(ctx, size, DARK, [0, 2 + (shift & 1), 3, 1], [5, 5 - (shift & 1), 3, 1]);
      pixels(ctx, size, LIGHT, [2 + shift, 1, 3, 1]);
      break;
    case TerrainPattern.ShallowOcean:
      pixels(ctx, size, LIGHT, [shift - 1, 2, 4, 1], [4 - shift, 6, 3, 1]);
      pixels(ctx, size, DARK, [1 + shift, 4, 4, 1]);
      break;
    case TerrainPattern.Abyss:
      pixels(ctx, size, DEEP_DARK, [1 + shift, 1, 1, 5], [2 + shift, 5, 3, 1]);
      pixels(ctx, size, LIGHT, [5 - shift, 2, 1, 2]);
      break;
    case TerrainPattern.Shelf:
      pixels(ctx, size, DARK, [0, 3 + (shift & 1), 5, 1]);
      pixels(ctx, size, LIGHT, [2 + shift, 1, 1, 1], [6 - shift, 6, 1, 1]);
      break;
    case TerrainPattern.FreshLake:
      pixels(ctx, size, LIGHT, [1 + shift, 2, 3, 1], [4 - shift, 6, 3, 1]);
      break;
    case TerrainPattern.SaltLake:
      pixels(ctx, size, BRIGHT, [shift, 2, 2, 1], [5 - shift, 5, 3, 1]);
      pixels(ctx, size, DARK, [2, 7, 4, 1]);
      break;
    case TerrainPattern.SaltFlat:
      pixels(ctx, size, LIGHT, [1, 1 + shift, 2, 1], [5, 2, 1, 2], [2, 6, 4, 1]);
      pixels(ctx, size, DARK, [3, 3, 1, 1], [6 - shift, 7, 1, 1]);
      break;
    case TerrainPattern.Ice:
      pixels(ctx, size, BRIGHT, [2 + shift, 1, 1, 3], [1 + shift, 2, 3, 1]);
      pixels(ctx, size, DARK, [6 - shift, 4, 1, 4], [4 - shift, 6, 3, 1]);
      break;
    case TerrainPattern.Tundra:
      pixels(ctx, size, DARK, [1 + shift, 5, 2, 1], [5 - shift, 2, 1, 2]);
      pixels(ctx, size, LIGHT, [3, 1 + (shift & 1), 1, 1]);
      break;
    case TerrainPattern.BorealForest:
      tree(ctx, size, 1 + (shift & 1), 2, true);
      tree(ctx, size, 5 - (shift & 1), 4, true);
      break;
    case TerrainPattern.TemperateForest:
      tree(ctx, size, 1 + shift, 2, false);
      tree(ctx, size, 5 - (shift & 1), 4, false);
      break;
    case TerrainPattern.Grassland:
      tuft(ctx, size, 1 + shift, 2);
      tuft(ctx, size, 5 - shift, 6);
      break;
    case TerrainPattern.Desert:
      pixels(ctx, size, DARK, [shift - 1, 3, 4, 1], [4 - shift, 6, 4, 1]);
      pixels(ctx, size, LIGHT, [2 + shift, 2, 2, 1]);
      break;
    case TerrainPattern.Savanna:
      tuft(ctx, size, 1 + shift, 5);
      pixels(ctx, size, DARK, [5 - shift, 2, 2, 2], [6 - shift, 4, 1, 2]);
      break;
    case TerrainPattern.Rainforest:
      tree(ctx, size, shift - 1, 1, false);
      tree(ctx, size, 3 + (shift & 1), 3, false);
      tree(ctx, size, 6 - shift, 1, false);
      break;
    case TerrainPattern.Swamp:
      pixels(ctx, size, DEEP_DARK, [0, 6 - (shift & 1), 8, 1], [2 + shift, 2, 1, 4]);
      pixels(ctx, size, LIGHT, [4 - shift, 4, 3, 1]);
      break;
    case TerrainPattern.Mountain:
      pixels(ctx, size, DEEP_DARK, [1 + shift, 6, 6 - shift, 1], [3 + shift, 3, 1, 3]);
      pixels(ctx, size, DARK, [2 + shift, 4, 1, 2], [4 + shift, 5, 1, 1]);
      pixels(ctx, size, BRIGHT, [3 + shift, 2, 1, 2], [2 + shift, 4, 1, 1]);
      break;
    case TerrainPattern.Rock:
      pixels(ctx, size, DARK, [1 + shift, 2, 2, 2], [5 - shift, 5, 2, 1]);
      pixels(ctx, size, LIGHT, [2 + shift, 2, 1, 1], [6 - shift, 4, 1, 1]);
      break;
    case TerrainPattern.Lava:
      pixels(ctx, size, DEEP_DARK, [shift, 0, 1, 4], [1 + shift, 3, 3, 1], [4, 3, 1, 5]);
      pixels(ctx, size, BRIGHT, [1 + shift, 4, 1, 1], [5, 6 - shift, 2, 1]);
      break;
  }
}

function tree(
  ctx: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  conifer: boolean,
): void {
  if (conifer) {
    pixels(ctx, size, DEEP_DARK, [x + 1, y, 1, 1], [x, y + 1, 3, 1], [x, y + 3, 3, 1]);
  } else {
    pixels(ctx, size, DARK, [x, y, 3, 2], [x + 1, y - 1, 1, 4]);
    pixels(ctx, size, LIGHT, [x + 1, y, 1, 1]);
  }
  pixels(ctx, size, DEEP_DARK, [x + 1, y + 3, 1, 2]);
}

function tuft(ctx: CanvasRenderingContext2D, size: number, x: number, y: number): void {
  pixels(ctx, size, DARK, [x + 1, y - 2, 1, 3], [x, y - 1, 1, 1], [x + 2, y - 1, 1, 1]);
  pixels(ctx, size, LIGHT, [x, y + 1, 3, 1]);
}

function pixels(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  ...rects: readonly number[][]
): void {
  ctx.fillStyle = color;
  for (const rect of rects) {
    const x = rect[0]!;
    const y = rect[1]!;
    const width = rect[2]!;
    const height = rect[3]!;
    const left = Math.max(0, Math.floor((x * size) / 8));
    const top = Math.max(0, Math.floor((y * size) / 8));
    const right = Math.min(size, Math.ceil(((x + width) * size) / 8));
    const bottom = Math.min(size, Math.ceil(((y + height) * size) / 8));
    if (right > left && bottom > top) ctx.fillRect(left, top, right - left, bottom - top);
  }
}
