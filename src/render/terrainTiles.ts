import { Biome } from '../sim/data/biomes';
import { LakeType } from '../sim/models/geosphere/flowRouting';
import { getAccessibilitySettings, type PaletteMode } from './accessibilitySettings';
import type { MapLayer, MapSource, RenderedField } from './mapRenderer';
import { paintTerrainSprite, TerrainPattern, terrainSpriteVariantCount } from './terrainSprites';
import { drawViewport, type MapViewport, viewBounds } from './viewport';

export { TerrainPattern } from './terrainSprites';

/** Tiles emerge near ten CSS pixels per cell and are opaque before native 16 px size. */
export const TILE_FADE_START = 9;
export const TILE_FADE_END = 14;
export const TILE_ANIMATION_MS = 500;
export const TILE_VARIANTS = 4;

/** Smoothstep avoids a visible pop when zoom crosses the tile threshold. */
export function tileBlend(cellPixels: number): number {
  const t = Math.max(
    0,
    Math.min(1, (cellPixels - TILE_FADE_START) / (TILE_FADE_END - TILE_FADE_START)),
  );
  return t * t * (3 - 2 * t);
}

/** A slow four-frame phase for water. */
export function tileAnimationPhase(timeMs: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : Math.floor(Math.max(0, timeMs) / TILE_ANIMATION_MS) % TILE_VARIANTS;
}

/** Fields terrainPatternAt reads; the worker must send them whenever tiles can show. */
export const TERRAIN_TILE_FIELDS: readonly RenderedField[] = [
  'elevation',
  'iceCover',
  'co2Ice',
  'biome',
  'lakeType',
  'vegetation',
  'airTemperature',
  'volcanicActivity',
];

export function isTexturedLayer(layer: MapLayer): boolean {
  return layer === 'terrain' || layer === 'biomes' || layer === 'seafloor';
}

export function isAnimatedPattern(pattern: TerrainPattern): boolean {
  return (
    pattern === TerrainPattern.DeepOcean ||
    pattern === TerrainPattern.ShallowOcean ||
    pattern === TerrainPattern.FreshLake ||
    pattern === TerrainPattern.SaltLake
  );
}

/** Stable integer hash; it never touches simulation randomness. */
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
  const count = terrainSpriteVariantCount(pattern);
  const stable = (hash >>> 0) % count;
  return isAnimatedPattern(pattern) ? (stable + animationPhase) % count : stable;
}

/** Selects a readable surface symbol while leaving quantitative layers untouched. */
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
  if (isMountain(state, x, y, relative)) {
    return fields.airTemperature[i]! <= 2 || ice >= 0.08
      ? TerrainPattern.SnowMountain
      : TerrainPattern.Mountain;
  }

  const biome = fields.biome[i] as Biome;
  // Potential vegetation remains in the model on lifeless worlds; exposed rock
  // makes its actual absence legible in the physical and biome views.
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

  public constructor(private readonly capacity = 768) {}

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

  public get(
    pattern: TerrainPattern,
    variant: number,
    pixelSize: number,
    paletteMode: PaletteMode,
    tinted: boolean,
  ): HTMLCanvasElement {
    const size = Math.max(4, Math.min(192, pixelSize));
    const palette = paletteMode === 'colourBlind' ? 1 : 0;
    const key =
      (((size * TerrainPattern.Count + pattern) * TILE_VARIANTS + variant) * 2 + palette) * 2 +
      Number(tinted);
    const cached = this.tiles.get(key);
    if (cached) return cached;
    const tile = createTile(pattern, variant, size, paletteMode, tinted);
    this.tiles.set(key, tile);
    return tile;
  }
}

const tileCache = new CanvasTileCache();
let patternScratch = new Uint8Array(0);

/**
 * Paints the ordinary flat viewport, then replaces only visible zoomed cells
 * with cached sprites. The globe and quantitative layers retain their existing rendering.
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

  for (let row = 0; row < rows; row++) {
    const y = firstY + row;
    const rowOffset = row * columns;
    for (let column = 0; column < columns; column++) {
      const x = wrapCell(firstX + column, gridWidth);
      patternScratch[rowOffset + column] = terrainPatternAt(state, layer, x, y);
    }
  }

  const paletteMode = getAccessibilitySettings().palette;
  const tinted = layer === 'seafloor';
  const cacheSize = Math.round(Math.min(cellWidth, cellHeight));
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.globalAlpha = blend;
  for (let row = 0; row < rows; row++) {
    const y = firstY + row;
    const y0 = Math.round(offsetY + row * cellHeight);
    const y1 = Math.round(offsetY + (row + 1) * cellHeight);
    const rowOffset = row * columns;
    for (let column = 0; column < columns; column++) {
      const x = wrapCell(firstX + column, gridWidth);
      const pattern = patternScratch[rowOffset + column] as TerrainPattern;
      const variant = cellTileVariant(x, y, pattern, animationPhase);
      const tile = tileCache.get(pattern, variant, cacheSize, paletteMode, tinted);
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

function createTile(
  pattern: TerrainPattern,
  variant: number,
  size: number,
  paletteMode: PaletteMode,
  tinted: boolean,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  paintTerrainSprite(ctx, pattern, variant, size, paletteMode, tinted);
  return canvas;
}
