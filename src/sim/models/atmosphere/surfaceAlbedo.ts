import type { SimComponent } from '../../core/component';
import { Biome, BIOMES } from '../../data/biomes';
import { SEA_LEVEL } from '../geosphere/flowRouting';

/** Planetary albedo (surface plus typical cloud cover) of ice-free ocean and bare land. */
export const OCEAN_ALBEDO = 0.29;
export const LAND_ALBEDO = 0.31;
/** Bare rock and soil before plants cover the land. */
export const BARREN_ALBEDO = 0.32;
/** Albedo of white and black daisies (Daisyworld). */
export const WHITE_DAISY_ALBEDO = 0.65;
export const BLACK_DAISY_ALBEDO = 0.15;

export interface SurfaceAlbedoOptions {
  /** Albedo of bare land; Daisyworld uses a brighter ground. */
  landAlbedo?: number;
}

/**
 * Albedo of the ice-free surface, which the climate model then mixes with snow
 * and ice. Life changes it — biomes (dark forests, bright deserts) and the
 * daisies of Daisyworld — closing the loop between biosphere and climate.
 * Land without a biome (no biome model running) uses `landAlbedo`; otherwise the
 * biome's albedo applies in proportion to plant cover, the rest is bare ground.
 */
export function createSurfaceAlbedo(options: SurfaceAlbedoOptions = {}): SimComponent {
  const landAlbedo = options.landAlbedo ?? LAND_ALBEDO;
  return {
    name: 'surfaceAlbedo',
    inputs: ['elevation', 'biome', 'vegetation', 'daisyWhite', 'daisyBlack'],
    outputs: ['surfaceAlbedo'],
    runOneStep(state) {
      const { elevation, biome, vegetation, daisyWhite, daisyBlack, surfaceAlbedo } = state.fields;
      for (let i = 0; i < elevation.length; i++) {
        if (elevation[i]! < SEA_LEVEL) {
          surfaceAlbedo[i] = OCEAN_ALBEDO;
          continue;
        }
        const white = daisyWhite[i]!;
        const black = daisyBlack[i]!;
        const plants = vegetation[i]!;
        const ground =
          biome[i] === Biome.Ocean
            ? landAlbedo
            : BARREN_ALBEDO * (1 - plants) + BIOMES[biome[i] as Biome].albedo * plants;
        surfaceAlbedo[i] =
          ground * (1 - white - black) + WHITE_DAISY_ALBEDO * white + BLACK_DAISY_ALBEDO * black;
      }
    },
  };
}
