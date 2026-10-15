import type { SimComponent } from '../../core/component';
import { SEA_LEVEL } from '../geosphere/flowRouting';

/** Planetary albedo (surface plus typical cloud cover) of ice-free ocean and bare land. */
export const OCEAN_ALBEDO = 0.29;
export const LAND_ALBEDO = 0.31;
/** Albedo of white and black daisies (Daisyworld). */
export const WHITE_DAISY_ALBEDO = 0.65;
export const BLACK_DAISY_ALBEDO = 0.15;

export interface SurfaceAlbedoOptions {
  /** Albedo of bare land; Daisyworld uses a brighter ground. */
  landAlbedo?: number;
}

/**
 * Albedo of the ice-free surface, which the climate model then mixes with snow
 * and ice. Life changes it — here the daisies of Daisyworld; later vegetation,
 * deserts and cities — closing the loop between biosphere and climate.
 */
export function createSurfaceAlbedo(options: SurfaceAlbedoOptions = {}): SimComponent {
  const landAlbedo = options.landAlbedo ?? LAND_ALBEDO;
  return {
    name: 'surfaceAlbedo',
    inputs: ['elevation', 'daisyWhite', 'daisyBlack'],
    outputs: ['surfaceAlbedo'],
    runOneStep(state) {
      const { elevation, daisyWhite, daisyBlack, surfaceAlbedo } = state.fields;
      for (let i = 0; i < elevation.length; i++) {
        if (elevation[i]! < SEA_LEVEL) {
          surfaceAlbedo[i] = OCEAN_ALBEDO;
          continue;
        }
        const white = daisyWhite[i]!;
        const black = daisyBlack[i]!;
        surfaceAlbedo[i] =
          landAlbedo * (1 - white - black) +
          WHITE_DAISY_ALBEDO * white +
          BLACK_DAISY_ALBEDO * black;
      }
    },
  };
}
