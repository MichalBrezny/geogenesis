import { createPlanet, type PlanetOptions } from '../core/planet';
import { createRng } from '../core/rng';
import { createValueNoise3D, fractalNoise } from '../core/noise';
import { recordHistory } from '../history';
import { createClimate } from '../models/atmosphere/climate';
import { stellarEvolution } from '../models/atmosphere/star';
import { createSurfaceAlbedo } from '../models/atmosphere/surfaceAlbedo';
import { createDaisies } from '../models/biosphere/daisies';
import { createSimulation } from '../simulation';
import type { World } from '../world';

/** Albedo of Daisyworld's bare ground: brighter than Earth's land, as in the original model. */
export const DAISYWORLD_GROUND_ALBEDO = 0.4;

export interface DaisyworldOptions extends PlanetOptions {
  /** Star age at the start; the default begins while the star is still too faint for daisies. */
  startYear?: number;
  /** Include the daisies; without them the same planet shows the unregulated climate. */
  withDaisies?: boolean;
}

/**
 * Lovelock's Daisyworld: a land-only planet with no geology or carbon cycle,
 * where only the star brightens and only daisies respond. Time runs faster
 * than on a random planet so the star's whole main-sequence brightening fits
 * in one playthrough.
 */
export function createDaisyworld(options: DaisyworldOptions = {}): World {
  const planet = createPlanet(options);
  planet.globals.year = options.startYear ?? 2.5e9;
  planet.globals.atmosphere.co2 = 280;

  // Gentle rolling land everywhere: no oceans, so nothing but daisies sets the albedo.
  const noise = createValueNoise3D(createRng(planet.seed));
  const pos = planet.grid.cellPosition;
  for (let i = 0; i < planet.grid.cellCount; i++) {
    const p = i * 3;
    const relief = 400 + 300 * fractalNoise(noise, pos[p]!, pos[p + 1]!, pos[p + 2]!, 4, 2);
    planet.fields.elevation[i] = Math.max(50, relief);
    planet.fields.crustType[i] = 1;
  }

  const components = [
    stellarEvolution,
    createSurfaceAlbedo({ landAlbedo: DAISYWORLD_GROUND_ALBEDO }),
    // Classic Daisyworld has no ice–albedo feedback: snow is as bright as the ground.
    createClimate({ iceAlbedo: DAISYWORLD_GROUND_ALBEDO }),
  ];
  if (options.withDaisies ?? true) {
    components.push(createDaisies({ groundAlbedo: DAISYWORLD_GROUND_ALBEDO }));
  }
  components.push(recordHistory);
  const simulation = createSimulation(components, [
    'elevation',
    'daisyWhite',
    'daisyBlack',
    'biome',
  ]);
  simulation.step(planet, 0);
  return { planet, simulation, yearsPerStep: 5e6 };
}
