import type { SimComponent } from '../core/component';
import type { ModelControls, PlanetState } from '../core/planet';
import { LIFE_CLASSES } from '../data/lifeClasses';
import { recordEvent } from '../events';
import { complexBiomass } from '../models/biosphere/life';

export type GoalId = 'brighteningSun' | 'snowball' | 'cradle';
export type GoalStatus = 'active' | 'won' | 'lost';
export type ControlKey = keyof ModelControls;

/** Goal-owned data is deliberately restricted to JSON-safe scalar values. */
export type GoalMemory = Record<string, number | string | boolean | null>;

export interface GoalState {
  id: GoalId;
  status: GoalStatus;
  startYear: number;
  score: number;
  /** Year a sustained win condition first became true. */
  heldSince: number | null;
  outcomeYear: number | null;
  /** Stable string key describing the win or loss. */
  outcomeReason: string | null;
  memory: GoalMemory;
}

export interface GoalCondition {
  /** Translation key for the checklist label. */
  key: string;
  value: number;
  target: number;
  unit: string;
  met: boolean;
}

export interface GoalDefinition {
  id: GoalId;
  evaluate(state: PlanetState, goal: GoalState, dtYears: number): void;
  conditions(state: PlanetState, goal: GoalState): GoalCondition[];
  controlLimits?: Partial<Record<ControlKey, [number, number]>>;
}

const BRIGHTENING_TARGET_YEAR = 8.1e9;
const SNOWBALL_TIME_LIMIT = 1e9;
const SNOWBALL_HOLD_YEARS = 5e6;
const CRADLE_TIME_LIMIT = 2e9;
const COMPLEX_LIFE_EPSILON = 1e-8;

export function createGoal(id: GoalId, startYear: number): GoalState {
  const deadlineYear =
    id === 'brighteningSun'
      ? BRIGHTENING_TARGET_YEAR
      : startYear + (id === 'snowball' ? SNOWBALL_TIME_LIMIT : CRADLE_TIME_LIMIT);
  return {
    id,
    status: 'active',
    startYear,
    score: 0,
    heldSince: null,
    outcomeYear: null,
    outcomeReason: null,
    memory: {
      deadlineYear,
      biodiversityIntegral: 0,
      complexLifeSeen: id === 'brighteningSun',
    },
  };
}

function evaluationYear(state: PlanetState, dtYears: number): number {
  return state.globals.year + Math.max(0, dtYears);
}

function deadline(goal: GoalState): number {
  const value = goal.memory.deadlineYear;
  return typeof value === 'number' ? value : Number.POSITIVE_INFINITY;
}

function finish(
  goal: GoalState,
  status: Exclude<GoalStatus, 'active'>,
  year: number,
  reason: string,
) {
  goal.status = status;
  goal.outcomeYear = year;
  goal.outcomeReason = reason;
}

function hasEvent(
  state: PlanetState,
  key: PlanetState['events'][number]['key'],
  since: number,
): boolean {
  return state.events.some((event) => event.key === key && event.year >= since);
}

function hasLiquidOceans(state: PlanetState): boolean {
  return (
    state.globals.water > 1 &&
    state.globals.iceFraction < 0.95 &&
    !state.globals.runawayGreenhouse &&
    !hasEvent(state, 'oceansLost', 0)
  );
}

function complexLife(state: PlanetState): number {
  return complexBiomass(state.biota.cover);
}

function complexClassCount(state: PlanetState): number {
  return LIFE_CLASSES.reduce(
    (count, lifeClass, index) =>
      count + (lifeClass.tier !== 'microbes' && state.biota.cover[index]! > 0 ? 1 : 0),
    0,
  );
}

function updateComplexLifeMemory(state: PlanetState, goal: GoalState): boolean {
  const alive = complexLife(state) > COMPLEX_LIFE_EPSILON;
  if (alive) goal.memory.complexLifeSeen = true;
  return alive;
}

function sentienceReached(state: PlanetState, goal: GoalState): boolean {
  return state.civilization.sentientSince !== null || hasEvent(state, 'sentience', goal.startYear);
}

function landVertebrateClasses(state: PlanetState): number {
  return LIFE_CLASSES.reduce(
    (count, lifeClass, index) =>
      count + (lifeClass.tier === 'landVertebrates' && state.biota.cover[index]! > 0 ? 1 : 0),
    0,
  );
}

function percent(value: number): number {
  return value * 100;
}

const brighteningSun: GoalDefinition = {
  id: 'brighteningSun',
  controlLimits: {
    solarFactor: [0.92, 1.08],
    greenhouse: [0.8, 1.2],
    cloudAlbedo: [0.8, 1.3],
    surfaceAlbedo: [0.8, 1.3],
    airSeaHeat: [0.8, 1.2],
    rainfall: [0.8, 1.2],
  },
  evaluate(state, goal, dtYears) {
    const year = evaluationYear(state, dtYears);
    const elapsed = Math.max(0, year - goal.startYear);
    const previousIntegral = Number(goal.memory.biodiversityIntegral) || 0;
    goal.memory.biodiversityIntegral =
      previousIntegral + state.globals.biodiversity * Math.max(0, dtYears);
    const meanBiodiversity =
      elapsed > 0 ? Number(goal.memory.biodiversityIntegral) / elapsed : state.globals.biodiversity;
    goal.score = (elapsed / 1e6) * (1 + meanBiodiversity);

    const lifeAlive = updateComplexLifeMemory(state, goal);
    if (hasEvent(state, 'oceansLost', goal.startYear) || state.globals.water <= 1) {
      finish(goal, 'lost', year, 'oceansLost');
    } else if (
      state.globals.runawayGreenhouse ||
      hasEvent(state, 'runawayGreenhouse', goal.startYear)
    ) {
      finish(goal, 'lost', year, 'runawayGreenhouse');
    } else if (goal.memory.complexLifeSeen === true && !lifeAlive) {
      finish(goal, 'lost', year, 'complexLifeExtinct');
    } else if (year >= BRIGHTENING_TARGET_YEAR && hasLiquidOceans(state) && lifeAlive) {
      finish(goal, 'won', year, 'survivedBrightening');
    }
  },
  conditions(state, goal) {
    const alive = complexLife(state) > COMPLEX_LIFE_EPSILON;
    return [
      {
        key: 'goal.condition.liquidOceans',
        value: state.globals.water,
        target: 1,
        unit: 'goal.unit.mGel',
        met: hasLiquidOceans(state),
      },
      {
        key: 'goal.condition.complexLife',
        value: complexClassCount(state),
        target: 1,
        unit: '',
        met: alive,
      },
      {
        key: 'goal.condition.surviveUntil',
        value: state.globals.year / 1e9,
        target: BRIGHTENING_TARGET_YEAR / 1e9,
        unit: 'goal.unit.gyr',
        met: goal.status === 'won' || state.globals.year >= BRIGHTENING_TARGET_YEAR,
      },
    ];
  },
};

function thawed(state: PlanetState): boolean {
  return state.globals.iceFraction < 0.15 && state.globals.meanTemperature > 5;
}

const snowball: GoalDefinition = {
  id: 'snowball',
  controlLimits: {
    solarFactor: [0.9, 1.1],
    greenhouse: [0.8, 1.4],
    cloudAlbedo: [0.8, 1.3],
    surfaceAlbedo: [0.75, 1.3],
    volcanism: [0, 2],
  },
  evaluate(state, goal, dtYears) {
    const year = evaluationYear(state, dtYears);
    if (thawed(state)) {
      goal.heldSince ??= year;
    } else {
      goal.heldSince = null;
    }
    const remainingMyr = Math.max(0, deadline(goal) - year) / 1e6;
    goal.score = remainingMyr + state.globals.energy / 10;
    if (goal.heldSince !== null && year - goal.heldSince >= SNOWBALL_HOLD_YEARS) {
      finish(goal, 'won', year, 'snowballThawed');
    } else if (year >= deadline(goal)) {
      finish(goal, 'lost', year, 'timeExpired');
    }
  },
  conditions(state, goal) {
    const year = state.globals.year;
    const held = goal.heldSince === null ? 0 : Math.max(0, year - goal.heldSince);
    return [
      {
        key: 'goal.condition.iceCoverBelow',
        value: percent(state.globals.iceFraction),
        target: 15,
        unit: 'goal.unit.percent',
        met: state.globals.iceFraction < 0.15,
      },
      {
        key: 'goal.condition.temperatureAbove',
        value: state.globals.meanTemperature,
        target: 5,
        unit: 'goal.unit.celsius',
        met: state.globals.meanTemperature > 5,
      },
      {
        key: 'goal.condition.holdFor',
        value: held / 1e6,
        target: SNOWBALL_HOLD_YEARS / 1e6,
        unit: 'goal.unit.myr',
        met: held >= SNOWBALL_HOLD_YEARS,
      },
    ];
  },
};

const cradle: GoalDefinition = {
  id: 'cradle',
  controlLimits: {
    mutationRate: [0.5, 2],
    advanceRate: [0.5, 2],
    reproduction: [0.5, 2],
    thermalTolerance: [0.8, 1.3],
    solarFactor: [0.92, 1.08],
    greenhouse: [0.8, 1.2],
  },
  evaluate(state, goal, dtYears) {
    const year = evaluationYear(state, dtYears);
    const lifeAlive = updateComplexLifeMemory(state, goal);
    const remainingMyr = Math.max(0, deadline(goal) - year) / 1e6;
    goal.score = remainingMyr + landVertebrateClasses(state) * 100;
    if (sentienceReached(state, goal)) {
      finish(goal, 'won', year, 'sentience');
    } else if (goal.memory.complexLifeSeen === true && !lifeAlive) {
      finish(goal, 'lost', year, 'complexLifeExtinct');
    } else if (year >= deadline(goal)) {
      finish(goal, 'lost', year, 'timeExpired');
    }
  },
  conditions(state, goal) {
    const vertebrates = landVertebrateClasses(state);
    return [
      {
        key: 'goal.condition.complexLife',
        value: complexClassCount(state),
        target: 1,
        unit: '',
        met: complexLife(state) > COMPLEX_LIFE_EPSILON,
      },
      {
        key: 'goal.condition.landVertebrates',
        value: vertebrates,
        target: 1,
        unit: '',
        met: vertebrates > 0,
      },
      {
        key: 'goal.condition.sentience',
        value: sentienceReached(state, goal) ? 1 : 0,
        target: 1,
        unit: '',
        met: sentienceReached(state, goal),
      },
    ];
  },
};

/** Stable registry: adding a future goal only needs data plus an evaluator. */
export const GOALS: Readonly<Record<GoalId, GoalDefinition>> = {
  brighteningSun,
  snowball,
  cradle,
};

/** Final pipeline component for goal scenarios. */
export const goalTracker: SimComponent = {
  name: 'goals',
  inputs: [],
  outputs: [],
  runOneStep(state, dtYears) {
    const goal = state.goal;
    if (!goal || goal.status !== 'active') return;
    const previous = goal.status as GoalStatus;
    GOALS[goal.id].evaluate(state, goal, dtYears);
    if (previous === 'active' && goal.status !== 'active') {
      recordEvent(
        state,
        goal.status === 'won' ? 'goalWon' : 'goalLost',
        goal.outcomeReason ?? undefined,
        goal.outcomeYear ?? evaluationYear(state, dtYears),
      );
    }
  },
};

/** Enforces scenario ranges at the authoritative simulation boundary. */
export function clampGoalControls(
  state: PlanetState,
  changes: Partial<ModelControls>,
): Partial<ModelControls> {
  const limits = state.goal ? GOALS[state.goal.id].controlLimits : undefined;
  if (!limits) return { ...changes };
  const clamped: Partial<ModelControls> = {};
  for (const key of Object.keys(changes) as ControlKey[]) {
    const value = changes[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    const range = limits[key];
    clamped[key] = range ? Math.min(range[1], Math.max(range[0], value)) : value;
  }
  return clamped;
}
