import type { MapSource } from '../render/mapRenderer';
import type {
  CivilizationState,
  DisasterSettings,
  ModelControls,
  PlanetParameters,
  TectonicRegime,
} from '../sim/core/planet';
import type { ToolUse } from '../sim/tools/tools';
import type { PlanetEvent } from '../sim/events';
import type { HistorySeries } from '../sim/history';
import type { ScenarioId } from '../sim/scenarios';
import type { Era } from '../sim/eras';
import type { PlanetStart } from '../sim/world';
import type { CellLife } from '../sim/models/biosphere/diversity';
import type { ControlKey, GoalCondition, GoalState } from '../sim/goals/goals';
import type { Device } from '../sim/tools/devices';
import type { Biosignature } from '../sim/models/biosphere/biosignature';

export interface FrameGoal extends GoalState {
  conditions: GoalCondition[];
  controlLimits?: Partial<Record<ControlKey, [number, number]>>;
}

/** Messages from the UI to the simulation worker. */
export type WorkerRequest =
  | {
      type: 'create';
      scenario: ScenarioId;
      seed: number;
      width: number;
      height: number;
      start: PlanetStart;
      planetParams?: Partial<PlanetParameters>;
    }
  | { type: 'run'; running: boolean }
  | { type: 'step' }
  | { type: 'tool'; use: ToolUse }
  | { type: 'controls'; controls: Partial<ModelControls> }
  | { type: 'disasters'; disasters: Partial<DisasterSettings> }
  | { type: 'unlimitedEnergy'; enabled: boolean }
  | { type: 'save' }
  /** Ask for the life in one cell (the inspected one); answered with a `cellLife` response. */
  | { type: 'inspect'; cell: number }
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
  /** Total atmospheric surface pressure and oxygen partial pressure, bar. */
  surfacePressure: number;
  o2Pressure: number;
  /** Ice-covered fraction of the surface, 0..1. */
  iceFraction: number;
  /** Ocean surface elevation relative to the ice-free datum, m. */
  seaLevel: number;
  /** Total extant water inventory, metres of global equivalent layer. */
  water: number;
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
  disasters: DisasterSettings;
  /** Scenario goal state plus its live, presentation-ready checklist. */
  goal: FrameGoal | null;
  /** Terraforming devices standing on the map. */
  devices: Device[];
  /** Whether a distant observer would see signs of life in the air. */
  biosignature: Biosignature;
  planetParams: PlanetParameters;
  magneticField: number;
  tectonicRegime: TectonicRegime;
  /** Milliseconds per simulation component in the last step. */
  timings: Record<string, number>;
  /** The whole recorded history, one array per series. */
  history: Record<HistorySeries, Float64Array>;
}

/** Messages from the simulation worker to the UI. */
export type WorkerResponse =
  | { type: 'frame'; frame: Frame }
  | { type: 'cellLife'; life: CellLife }
  | { type: 'error'; message: string }
  /** A tool could not be used; the UI explains why. */
  | { type: 'toolRefused'; reason: 'energy' | 'notAllowed' }
  | { type: 'saved'; bytes: ArrayBuffer; fileName: string };
