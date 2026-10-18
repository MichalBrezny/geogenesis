import { createPlanet, type PlanetOptions, type PlanetState } from '../core/planet';
import { createRng } from '../core/rng';
import { createValueNoise3D, fractalNoise } from '../core/noise';
import { recordHistory } from '../history';
import { createClimate } from '../models/atmosphere/climate';
import { stellarEvolution } from '../models/atmosphere/star';
import { createSurfaceAlbedo } from '../models/atmosphere/surfaceAlbedo';
import { createDaisies } from '../models/biosphere/daisies';
import { createSimulation } from '../simulation';
import { energyIncome, STARTING_ENERGY } from '../tools/tools';
import type { World } from '../world';

/** Albedo of Daisyworld's bare ground: brighter than Earth's land, as in the original model. */
export const DAISYWORLD_GROUND_ALBEDO = 0.4;
/** Classic Daisyworld isolates albedo feedback, so it has no axial seasons. */
export const DAISYWORLD_OBLIQUITY = 0;

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
  planet.controls.obliquity = DAISYWORLD_OBLIQUITY;
  planet.globals.year = options.startYear ?? 2.5e9;
  planet.globals.atmosphere.co2 = 280;
  planet.globals.water = 0;
  planet.globals.initialWater = 0;
  planet.globals.energy = STARTING_ENERGY;

  // Gentle rolling land everywhere: no oceans, so nothing but daisies sets the albedo.
  const noise = createValueNoise3D(createRng(planet.seed));
  const pos = planet.grid.cellPosition;
  for (let i = 0; i < planet.grid.cellCount; i++) {
    const p = i * 3;
    const relief = 400 + 300 * fractalNoise(noise, pos[p]!, pos[p + 1]!, pos[p + 2]!, 4, 2);
    planet.fields.elevation[i] = Math.max(50, relief);
    planet.fields.crustType[i] = 1;
  }

  const world = daisyworldFromPlanet(planet, options.withDaisies ?? true);
  world.simulation.step(planet, 0);
  return world;
}

/** Builds the Daisyworld simulation around an existing planet (new or loaded). */
export function daisyworldFromPlanet(planet: PlanetState, withDaisies = true): World {
  const components = [
    stellarEvolution,
    createSurfaceAlbedo({ landAlbedo: DAISYWORLD_GROUND_ALBEDO }),
    // Classic Daisyworld has no ice–albedo feedback: snow is as bright as the ground.
    createClimate({ iceAlbedo: DAISYWORLD_GROUND_ALBEDO }),
  ];
  if (withDaisies) {
    components.push(createDaisies({ groundAlbedo: DAISYWORLD_GROUND_ALBEDO }));
  }
  components.push(energyIncome, recordHistory);
  const simulation = createSimulation(components, [
    'elevation',
    'seasonalAmplitude',
    'oceanAnomaly',
    'precipitation',
    'iceThickness',
    'lowCloud',
    'daisyWhite',
    'daisyBlack',
    'biome',
    'vegetation',
  ]);
  return { planet, simulation, stepYears: () => 5e6, era: () => null };
}
