import type { MapSource } from '../render/mapRenderer';
import type { HistorySeries } from '../sim/history';
import type { ScenarioId } from '../sim/scenarios';

/** Messages from the UI to the simulation worker. */
export type WorkerRequest =
  | { type: 'create'; scenario: ScenarioId; seed: number; width: number; height: number }
  | { type: 'run'; running: boolean }
  | { type: 'step' };

/** A copy of what the UI needs to draw one frame; field arrays are transferred, not shared. */
export interface Frame extends MapSource {
  scenario: ScenarioId;
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
  /** The whole recorded history, one array per series. */
  history: Record<HistorySeries, Float64Array>;
}

/** Messages from the simulation worker to the UI. */
export type WorkerResponse = { type: 'frame'; frame: Frame } | { type: 'error'; message: string };
