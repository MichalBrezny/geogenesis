import { describe, expect, it } from 'vitest';
import { createPlanet } from '../sim/core/planet';
import { Biome } from '../sim/data/biomes';
import { LakeType } from '../sim/models/geosphere/flowRouting';
import type { MapSource } from './mapRenderer';
import {
  BoundedTileCache,
  cellTileVariant,
  TerrainPattern,
  terrainPatternAt,
  tileAnimationPhase,
  tileBlend,
} from './terrainTiles';

function mapSource(): MapSource {
  const planet = createPlanet({ width: 4, height: 3 });
  planet.fields.elevation.fill(100);
  planet.fields.airTemperature.fill(15);
  planet.fields.biome.fill(Biome.Grassland);
  planet.fields.vegetation.fill(1);
  return { grid: planet.grid, fields: planet.fields, seaLevel: 0 };
}

describe('pixel terrain pattern selection', () => {
  it('distinguishes water depth, lakes, vegetation and hot barren ground', () => {
    const state = mapSource();
    state.fields.elevation[0] = -4000;
    state.fields.elevation[1] = -200;
    state.fields.lakeType[2] = LakeType.Fresh;
    state.fields.biome[3] = Biome.Jungle;
    state.fields.vegetation[3] = 0.9;
    state.fields.airTemperature[4] = 120;
    state.fields.vegetation[4] = 0;

    expect(terrainPatternAt(state, 'terrain', 0, 0)).toBe(TerrainPattern.DeepOcean);
    expect(terrainPatternAt(state, 'terrain', 1, 0)).toBe(TerrainPattern.ShallowOcean);
    expect(terrainPatternAt(state, 'terrain', 2, 0)).toBe(TerrainPattern.FreshLake);
    expect(terrainPatternAt(state, 'biomes', 3, 0)).toBe(TerrainPattern.Rainforest);
    expect(terrainPatternAt(state, 'terrain', 0, 1)).toBe(TerrainPattern.Lava);
  });

  it('uses relief for alpine rock and drained seafloor patterns', () => {
    const state = mapSource();
    state.fields.elevation[5] = 3200;
    state.fields.elevation[6] = -5000;
    state.fields.elevation[7] = -500;
    expect(terrainPatternAt(state, 'terrain', 1, 1)).toBe(TerrainPattern.Mountain);
    expect(terrainPatternAt(state, 'seafloor', 2, 1)).toBe(TerrainPattern.Abyss);
    expect(terrainPatternAt(state, 'seafloor', 3, 1)).toBe(TerrainPattern.Shelf);
  });
});

describe('pixel terrain variants and cache', () => {
  it('keeps land stable while advancing animated water variants', () => {
    const grass = cellTileVariant(12, 7, TerrainPattern.Grassland, 0);
    expect(cellTileVariant(12, 7, TerrainPattern.Grassland, 3)).toBe(grass);
    const ocean = cellTileVariant(12, 7, TerrainPattern.DeepOcean, 0);
    expect(cellTileVariant(12, 7, TerrainPattern.DeepOcean, 1)).toBe((ocean + 1) % 4);
    expect(cellTileVariant(12, 7, TerrainPattern.DeepOcean, 0)).toBe(ocean);
  });

  it('reuses entries and bounds old tile sizes', () => {
    const cache = new BoundedTileCache<string>(2);
    cache.set(1, 'forest');
    expect(cache.get(1)).toBe('forest');
    cache.set(2, 'desert');
    cache.set(3, 'ocean');
    expect(cache.size).toBe(1);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(3)).toBe('ocean');
  });
});

describe('pixel terrain transition and animation timing', () => {
  it('fades smoothly from the unchanged flat map', () => {
    expect(tileBlend(5)).toBe(0);
    expect(tileBlend(6)).toBe(0.5);
    expect(tileBlend(7)).toBe(1);
  });

  it('advances every 480 ms and stays still with reduced motion', () => {
    expect(tileAnimationPhase(0, false)).toBe(0);
    expect(tileAnimationPhase(479, false)).toBe(0);
    expect(tileAnimationPhase(480, false)).toBe(1);
    expect(tileAnimationPhase(1920, false)).toBe(0);
    expect(tileAnimationPhase(5000, true)).toBe(0);
  });
});
