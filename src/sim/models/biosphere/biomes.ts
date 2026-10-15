import type { SimComponent } from '../../core/component';
import { Biome } from '../../data/biomes';
import { SEA_LEVEL } from '../geosphere/flowRouting';

/** Above this elevation (m) land is bare alpine rock regardless of climate. */
const ROCK_ELEVATION = 4500;
/** Lowlands below this elevation (m) with a big river and plenty of rain become swamps. */
const SWAMP_MAX_ELEVATION = 300;
const SWAMP_MIN_PRECIPITATION = 1200;
const SWAMP_MIN_DRAINAGE_AREA = 5e11;

export interface BiomeInputs {
  elevation: number;
  /** Annual mean temperature, °C. */
  temperature: number;
  /** Annual precipitation, mm/yr. */
  precipitation: number;
  /** Snow/ice cover, 0..1. */
  ice: number;
  /** Upstream drainage area, m². */
  drainageArea: number;
}

/**
 * Biome of a cell from its climate, after a simplified Whittaker diagram
 * (annual temperature × precipitation), plus alpine rock and river swamps.
 */
export function classifyBiome(cell: BiomeInputs): Biome {
  const { elevation, temperature: t, precipitation: p } = cell;
  if (elevation < SEA_LEVEL) return Biome.Ocean;
  if (cell.ice >= 0.5) return Biome.Ice;
  if (elevation > ROCK_ELEVATION) return Biome.Rock;
  if (t < -6) return Biome.Tundra;
  if (t < 3) return p >= 250 ? Biome.BorealForest : Biome.Tundra;
  if (
    elevation < SWAMP_MAX_ELEVATION &&
    p >= SWAMP_MIN_PRECIPITATION &&
    cell.drainageArea >= SWAMP_MIN_DRAINAGE_AREA
  ) {
    return Biome.Swamp;
  }
  if (p < 250) return Biome.Desert;
  if (t >= 20) {
    if (p >= 1800) return Biome.Jungle;
    return p >= 500 ? Biome.Savanna : Biome.Grassland;
  }
  return p >= 750 ? Biome.TemperateForest : Biome.Grassland;
}

/** Assigns every cell its biome from the current climate. */
export const biomeModel: SimComponent = {
  name: 'biomes',
  inputs: ['elevation', 'airTemperature', 'precipitation', 'iceCover', 'drainageArea'],
  outputs: ['biome'],
  runOneStep(state) {
    const { elevation, airTemperature, precipitation, iceCover, drainageArea, biome } =
      state.fields;
    for (let i = 0; i < biome.length; i++) {
      biome[i] = classifyBiome({
        elevation: elevation[i]!,
        temperature: airTemperature[i]!,
        precipitation: precipitation[i]!,
        ice: iceCover[i]!,
        drainageArea: drainageArea[i]!,
      });
    }
  },
};
