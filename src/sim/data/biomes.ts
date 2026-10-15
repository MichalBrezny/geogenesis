/**
 * Land biomes, in the spirit of SimEarth's biome map. The enum value is what
 * the `biome` field stores; keep values stable (saved games, i18n keys).
 */
export const Biome = {
  Ocean: 0,
  Ice: 1,
  Tundra: 2,
  BorealForest: 3,
  TemperateForest: 4,
  Grassland: 5,
  Desert: 6,
  Savanna: 7,
  Jungle: 8,
  Swamp: 9,
  Rock: 10,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

export interface BiomeInfo {
  /** Key used for UI strings (`biome.<key>`). */
  key: string;
  /** Planetary albedo of the ice-free surface including typical clouds. */
  albedo: number;
  /**
   * Silicate weathering relative to bare rock: plant roots, soils and microbes
   * speed it up several times over.
   */
  weathering: number;
  /** Map colour. */
  color: readonly [number, number, number];
}

export const BIOMES: Record<Biome, BiomeInfo> = {
  [Biome.Ocean]: { key: 'ocean', albedo: 0.29, weathering: 0, color: [30, 70, 140] },
  [Biome.Ice]: { key: 'ice', albedo: 0.31, weathering: 0, color: [235, 240, 245] },
  [Biome.Tundra]: { key: 'tundra', albedo: 0.33, weathering: 0.6, color: [150, 160, 140] },
  [Biome.BorealForest]: {
    key: 'borealForest',
    albedo: 0.26,
    weathering: 1.3,
    color: [40, 95, 75],
  },
  [Biome.TemperateForest]: {
    key: 'temperateForest',
    albedo: 0.25,
    weathering: 1.6,
    color: [55, 130, 60],
  },
  [Biome.Grassland]: { key: 'grassland', albedo: 0.31, weathering: 1.0, color: [160, 185, 90] },
  [Biome.Desert]: { key: 'desert', albedo: 0.36, weathering: 0.3, color: [220, 195, 130] },
  [Biome.Savanna]: { key: 'savanna', albedo: 0.3, weathering: 1.1, color: [195, 180, 85] },
  [Biome.Jungle]: { key: 'jungle', albedo: 0.22, weathering: 2.0, color: [20, 110, 40] },
  [Biome.Swamp]: { key: 'swamp', albedo: 0.24, weathering: 1.6, color: [70, 105, 90] },
  [Biome.Rock]: { key: 'rock', albedo: 0.31, weathering: 0.8, color: [130, 120, 115] },
};

export const BIOME_IDS = Object.keys(BIOMES).map(Number) as Biome[];
