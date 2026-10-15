import type { MapSource } from '../render/mapRenderer';

/** Messages from the UI to the simulation worker. */
export type WorkerRequest =
  | { type: 'create'; seed: number; width: number; height: number }
  | { type: 'run'; running: boolean }
  | { type: 'step' };

/** A copy of what the UI needs to draw one frame; field arrays are transferred, not shared. */
export interface Frame extends MapSource {
  year: number;
  meanTemperature: number;
  /** Star luminosity relative to the present Sun. */
  solarInput: number;
  /** Atmospheric CO₂, ppm. */
  co2: number;
  /** Ice-covered fraction of the surface, 0..1. */
  iceFraction: number;
  /** Milliseconds per simulation component in the last step. */
  timings: Record<string, number>;
}

/** Messages from the simulation worker to the UI. */
export type WorkerResponse = { type: 'frame'; frame: Frame } | { type: 'error'; message: string };
