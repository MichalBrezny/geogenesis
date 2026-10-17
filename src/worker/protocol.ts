import type { MapSource } from '../render/mapRenderer';
import type { CivilizationState, ModelControls } from '../sim/core/planet';
import type { ToolUse } from '../sim/tools/tools';
import type { PlanetEvent } from '../sim/events';
import type { HistorySeries } from '../sim/history';
import type { ScenarioId } from '../sim/scenarios';
import type { Era } from '../sim/eras';
import type { PlanetStart } from '../sim/world';

/** Messages from the UI to the simulation worker. */
export type WorkerRequest =
  | {
      type: 'create';
      scenario: ScenarioId;
      seed: number;
      width: number;
      height: number;
      start: PlanetStart;
    }
  | { type: 'run'; running: boolean }
  | { type: 'step' }
  | { type: 'tool'; use: ToolUse }
  | { type: 'controls'; controls: Partial<ModelControls> }
  | { type: 'unlimitedEnergy'; enabled: boolean }
  | { type: 'save' }
  /** Pause between steps while running, ms. */
  | { type: 'speed'; delayMs: number }
  /** Contents of a save file (gzip-compressed, see sim/serialize.ts). */
  | { type: 'load'; bytes: ArrayBuffer };

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
  /** Ocean surface elevation relative to the ice-free datum, m. */
  seaLevel: number;
  /** Atmospheric O₂ (fraction) and CH₄ (ppm). */
  o2: number;
  ch4: number;
  /** Planet-wide cover (0..1) and first appearance (year or null) of each life class. */
  life: { cover: number[]; appeared: (number | null)[] };
  civilization: CivilizationState;
  /** Most recent notable events, oldest first. */
  events: PlanetEvent[];
  /** Simulated years the next step will cover. */
  stepYears: number;
  /** The planet's era (sets the step length), or null for scenarios without eras. */
  era: Era | null;
  energy: number;
  unlimitedEnergy: boolean;
  controls: ModelControls;
  /** Milliseconds per simulation component in the last step. */
  timings: Record<string, number>;
  /** The whole recorded history, one array per series. */
  history: Record<HistorySeries, Float64Array>;
}

/** Messages from the simulation worker to the UI. */
export type WorkerResponse =
  | { type: 'frame'; frame: Frame }
  | { type: 'error'; message: string }
  /** A tool could not be used; the UI explains why. */
  | { type: 'toolRefused'; reason: 'energy' | 'notAllowed' }
  | { type: 'saved'; bytes: ArrayBuffer; fileName: string };
