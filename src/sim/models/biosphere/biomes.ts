import type { SimComponent } from '../../core/component';
import { Biome } from '../../data/biomes';
import { isOcean } from '../geosphere/seaLevel';
import { potentialEvapotranspiration } from '../hydrology';

/** Above this height over the current sea surface, land is bare alpine rock. */
const ROCK_ELEVATION = 4500;
/** Lowlands below this elevation (m) with a big river and plenty of rain become swamps. */
const SWAMP_MAX_ELEVATION = 300;
const SWAMP_MIN_PRECIPITATION = 1200;
const SWAMP_MIN_DRAINAGE_AREA = 5e11;
const ARID = 0.2;
const SEMI_ARID = 0.5;
const DRY_SUBHUMID = 0.65;

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
  /** Current sea-surface elevation, m. */
  seaLevel?: number;
}

/** Precipitation / potential evapotranspiration; Infinity in climates with no PET. */
export function aridityIndex(precipitation: number, temperature: number): number {
  const pet = potentialEvapotranspiration(temperature);
  return pet > 0 ? Math.max(0, precipitation) / pet : Infinity;
}

/**
 * Biome of a cell from temperature and the UNEP-style aridity index P / PET,
 * plus alpine rock and river swamps. Hyper-arid (<0.05) and arid (<0.2)
 * climates share the desert biome; semi-arid (<0.5), dry sub-humid (<0.65)
 * and humid climates map to increasingly wooded existing biomes.
 */
export function classifyBiome(cell: BiomeInputs): Biome {
  const { elevation, temperature: t, precipitation: p } = cell;
  const seaLevel = cell.seaLevel ?? 0;
  if (isOcean(elevation, seaLevel)) return Biome.Ocean;
  if (cell.ice >= 0.5) return Biome.Ice;
  if (elevation - seaLevel > ROCK_ELEVATION) return Biome.Rock;
  if (t < -6) return Biome.Tundra;
  const aridity = aridityIndex(p, t);
  if (t < 3) return aridity >= SEMI_ARID ? Biome.BorealForest : Biome.Tundra;
  if (
    elevation - seaLevel < SWAMP_MAX_ELEVATION &&
    p >= SWAMP_MIN_PRECIPITATION &&
    cell.drainageArea >= SWAMP_MIN_DRAINAGE_AREA
  ) {
    return Biome.Swamp;
  }
  if (aridity < ARID) return Biome.Desert;
  if (t >= 20) {
    if (aridity < SEMI_ARID) return Biome.Grassland;
    return aridity < DRY_SUBHUMID ? Biome.Savanna : Biome.Jungle;
  }
  return aridity < DRY_SUBHUMID ? Biome.Grassland : Biome.TemperateForest;
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
        seaLevel: state.globals.seaLevel,
      });
    }
  },
};
