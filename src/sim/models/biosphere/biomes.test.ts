import { describe, expect, it } from 'vitest';
import { Biome, BIOMES } from '../../data/biomes';
import { classifyBiome, type BiomeInputs } from './biomes';

const temperateLowland: BiomeInputs = {
  elevation: 200,
  temperature: 12,
  precipitation: 900,
  ice: 0,
  drainageArea: 1e10,
};

describe('classifyBiome', () => {
  it.each([
    [{ elevation: -100 }, Biome.Ocean],
    [{ ice: 0.8 }, Biome.Ice],
    [{ elevation: 5000 }, Biome.Rock],
    [{ temperature: -10 }, Biome.Tundra],
    [{ temperature: 0 }, Biome.BorealForest],
    [{}, Biome.TemperateForest],
    [{ precipitation: 400 }, Biome.Grassland],
    [{ precipitation: 100 }, Biome.Desert],
    [{ temperature: 26, precipitation: 2500 }, Biome.Jungle],
    [{ temperature: 26, precipitation: 1000 }, Biome.Savanna],
    [{ precipitation: 1500, drainageArea: 1e12 }, Biome.Swamp],
  ] as const)('%o → %i', (overrides, expected) => {
    expect(classifyBiome({ ...temperateLowland, ...overrides })).toBe(expected);
  });

  it.each([4, 15, 30])('classifies low aridity as desert at %i °C', (temperature) => {
    expect(
      classifyBiome({
        ...temperateLowland,
        temperature,
        precipitation: 0.1 * 60 * (temperature + 5),
      }),
    ).toBe(Biome.Desert);
  });

  it.each([
    [10, Biome.TemperateForest],
    [25, Biome.Jungle],
  ] as const)('classifies humid climates as forest at %i °C', (temperature, expected) => {
    expect(
      classifyBiome({
        ...temperateLowland,
        temperature,
        precipitation: 60 * (temperature + 5),
      }),
    ).toBe(expected);
  });
});

describe('biome data', () => {
  it('makes forests darker than deserts and vegetation weather rock faster', () => {
    expect(BIOMES[Biome.Jungle].albedo).toBeLessThan(BIOMES[Biome.Desert].albedo);
    expect(BIOMES[Biome.TemperateForest].weathering).toBeGreaterThan(
      BIOMES[Biome.Desert].weathering,
    );
  });
});
