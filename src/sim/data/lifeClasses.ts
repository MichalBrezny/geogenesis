import { Biome } from './biomes';

/** Where a class can live. */
export type Habitat = 'ocean' | 'land';

/**
 * Life classes, after SimEarth's taxa. Order matters: it is the class index in
 * the population arrays and roughly increasing complexity. Keep ids stable.
 */
export const LIFE_CLASS_KEYS = [
  'prokaryotes',
  'eukaryotes',
  'plants',
  'radiates',
  'arthropods',
  'mollusks',
  'trichordates',
  'fish',
  'insects',
  'amphibians',
  'reptiles',
  'dinosaurs',
  'avians',
  'mammals',
  'cetaceans',
] as const;
export type LifeClassKey = (typeof LIFE_CLASS_KEYS)[number];

export interface LifeClass {
  key: LifeClassKey;
  habitat: Habitat;
  /** Class it evolves from; undefined for the first life. */
  ancestor?: LifeClassKey;
  /** Mean annual temperature (°C) it thrives at, and how far from it it still survives. */
  optimumTemperature: number;
  temperatureTolerance: number;
  /** Minimum atmospheric O₂ (fraction by volume) it needs. */
  minOxygen: number;
  /** Needs land plants to exist (food and shelter on land). */
  needsPlants?: boolean;
  /**
   * Share (0..1) of the class's food that comes from sunlight, directly or through
   * the food chain; atmospheric dust dims it by exp(−dust). Defaults to 1;
   * prokaryotes also live on chemosynthesis.
   */
  lightDependence?: number;
  /**
   * Dissolved O₂ (relative to saturation, 0..1) a marine class needs; it is fully
   * at home above twice this level and suffocates in anoxic water below it.
   */
  minOceanOxygen?: number;
  /** Marine animal whose carrying capacity follows the sea's nutrient supply. */
  nutrientLimited?: boolean;
  /** Builds carbonate shells or skeletons, so it suffers from ocean acidification. */
  calcifying?: boolean;
  /**
   * Competition guild: classes in the same guild (and so the same habitat and
   * trophic level) share a cell's carrying capacity, more so the closer their
   * temperature optima. Classes without a guild do not compete.
   */
  guild?: 'seaAnimals' | 'landVertebrates';
  /** The first complex animals: their origin needs the Cambrian oxygen threshold. */
  firstAnimals?: boolean;
  /** Radiates quickly in the Cambrian burst after the first animals appear. */
  cambrianRadiation?: boolean;
  /**
   * Relative evolutionary step size: how hard this class is to evolve from its
   * ancestor. Higher means longer waits.
   */
  difficulty: number;
  /** Multiplier on the base waiting time for this evolutionary transition. */
  evolutionTime?: number;
  /** Map tier: how advanced the class counts for the "most advanced life" layer. */
  tier: LifeTier;
}

/** Coarse complexity tiers for maps and legends (more than eight classes would be unreadable). */
export const LIFE_TIERS = [
  'microbes',
  'plants',
  'seaAnimals',
  'landInvertebrates',
  'landVertebrates',
] as const;
export type LifeTier = (typeof LIFE_TIERS)[number];

export const LIFE_CLASSES: readonly LifeClass[] = [
  {
    key: 'prokaryotes',
    habitat: 'ocean',
    optimumTemperature: 30,
    temperatureTolerance: 45,
    minOxygen: 0,
    difficulty: 0,
    // Many microbes live on chemical energy at vents and in sediments.
    lightDependence: 0.4,
    tier: 'microbes',
  },
  {
    key: 'eukaryotes',
    habitat: 'ocean',
    ancestor: 'prokaryotes',
    optimumTemperature: 22,
    temperatureTolerance: 30,
    minOxygen: 0.002,
    difficulty: 1,
    // Endosymbiosis was an exceptional transition: 30 × 40 Myr = 1.2 Gyr
    // at full habitat overlap, before oxygen and geographic limits are applied.
    evolutionTime: 30,
    tier: 'microbes',
  },
  {
    key: 'plants',
    habitat: 'land',
    ancestor: 'eukaryotes',
    optimumTemperature: 20,
    temperatureTolerance: 28,
    minOxygen: 0.01,
    difficulty: 0.6,
    // Land plants and animals waited for a well-oxygenated, eukaryote-rich ocean: on Earth
    // complex life came ~1.2 Gyr after the first eukaryotes.
    evolutionTime: 60,
    tier: 'plants',
  },
  {
    key: 'radiates',
    habitat: 'ocean',
    ancestor: 'eukaryotes',
    optimumTemperature: 20,
    temperatureTolerance: 22,
    minOxygen: 0.03,
    difficulty: 1.5,
    evolutionTime: 40,
    minOceanOxygen: 0.15,
    nutrientLimited: true,
    // Corals and other reef builders.
    calcifying: true,
    guild: 'seaAnimals',
    firstAnimals: true,
    tier: 'seaAnimals',
  },
  {
    key: 'arthropods',
    habitat: 'ocean',
    ancestor: 'radiates',
    optimumTemperature: 20,
    temperatureTolerance: 22,
    minOxygen: 0.05,
    difficulty: 1,
    minOceanOxygen: 0.2,
    nutrientLimited: true,
    guild: 'seaAnimals',
    cambrianRadiation: true,
    tier: 'seaAnimals',
  },
  {
    key: 'mollusks',
    habitat: 'ocean',
    ancestor: 'radiates',
    optimumTemperature: 18,
    temperatureTolerance: 22,
    minOxygen: 0.05,
    difficulty: 1,
    minOceanOxygen: 0.2,
    nutrientLimited: true,
    // Shells of aragonite and calcite.
    calcifying: true,
    guild: 'seaAnimals',
    cambrianRadiation: true,
    tier: 'seaAnimals',
  },
  {
    key: 'trichordates',
    habitat: 'ocean',
    ancestor: 'radiates',
    optimumTemperature: 18,
    temperatureTolerance: 20,
    minOxygen: 0.06,
    difficulty: 1.2,
    minOceanOxygen: 0.2,
    nutrientLimited: true,
    guild: 'seaAnimals',
    cambrianRadiation: true,
    tier: 'seaAnimals',
  },
  {
    key: 'fish',
    habitat: 'ocean',
    ancestor: 'trichordates',
    optimumTemperature: 16,
    temperatureTolerance: 22,
    minOxygen: 0.08,
    difficulty: 1.2,
    minOceanOxygen: 0.3,
    nutrientLimited: true,
    guild: 'seaAnimals',
    cambrianRadiation: true,
    tier: 'seaAnimals',
  },
  {
    key: 'insects',
    habitat: 'land',
    ancestor: 'arthropods',
    optimumTemperature: 22,
    temperatureTolerance: 20,
    minOxygen: 0.1,
    needsPlants: true,
    difficulty: 1.5,
    tier: 'landInvertebrates',
  },
  {
    key: 'amphibians',
    habitat: 'land',
    ancestor: 'fish',
    optimumTemperature: 20,
    temperatureTolerance: 16,
    minOxygen: 0.12,
    needsPlants: true,
    difficulty: 1.2,
    guild: 'landVertebrates',
    tier: 'landVertebrates',
  },
  {
    key: 'reptiles',
    habitat: 'land',
    ancestor: 'amphibians',
    optimumTemperature: 24,
    temperatureTolerance: 18,
    minOxygen: 0.13,
    needsPlants: true,
    difficulty: 0.9,
    guild: 'landVertebrates',
    tier: 'landVertebrates',
  },
  {
    key: 'dinosaurs',
    habitat: 'land',
    ancestor: 'reptiles',
    optimumTemperature: 24,
    temperatureTolerance: 16,
    minOxygen: 0.15,
    needsPlants: true,
    difficulty: 0.9,
    guild: 'landVertebrates',
    tier: 'landVertebrates',
  },
  {
    key: 'avians',
    habitat: 'land',
    ancestor: 'dinosaurs',
    optimumTemperature: 15,
    temperatureTolerance: 25,
    minOxygen: 0.15,
    needsPlants: true,
    difficulty: 1,
    guild: 'landVertebrates',
    tier: 'landVertebrates',
  },
  {
    key: 'mammals',
    habitat: 'land',
    ancestor: 'reptiles',
    optimumTemperature: 12,
    temperatureTolerance: 25,
    minOxygen: 0.15,
    needsPlants: true,
    difficulty: 1.1,
    guild: 'landVertebrates',
    tier: 'landVertebrates',
  },
  {
    key: 'cetaceans',
    habitat: 'ocean',
    ancestor: 'mammals',
    optimumTemperature: 12,
    temperatureTolerance: 20,
    minOxygen: 0.15,
    difficulty: 1.1,
    // Air breathers: anoxic water does not suffocate them, but their food needs nutrients.
    nutrientLimited: true,
    guild: 'seaAnimals',
    tier: 'seaAnimals',
  },
];

export const LIFE_CLASS_COUNT = LIFE_CLASSES.length;

export function lifeClassIndex(key: LifeClassKey): number {
  return LIFE_CLASS_KEYS.indexOf(key);
}

/**
 * How well land plants grow in each biome (0..1). Biomes describe the climate;
 * plants only cover the land once they have evolved and spread there.
 */
export const PLANT_PRODUCTIVITY: Record<Biome, number> = {
  [Biome.Ocean]: 0,
  [Biome.Ice]: 0,
  [Biome.Tundra]: 0.3,
  [Biome.BorealForest]: 0.7,
  [Biome.TemperateForest]: 0.9,
  [Biome.Grassland]: 0.6,
  [Biome.Desert]: 0.1,
  [Biome.Savanna]: 0.6,
  [Biome.Jungle]: 1,
  [Biome.Swamp]: 0.9,
  [Biome.Rock]: 0.05,
};
